import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dataDir } from './gallery-store.js';
import { comfyUrl, localOutputFile } from './comfy.js';
import { renameWithRetry } from './json-store.js';
import { sendMediaBuffer } from './media-response.js';

const require = createRequire(import.meta.url);
let encoder = process.env.HEISS_FFMPEG_PATH;
if (!encoder) { try { const bundled = require('ffmpeg-static'); if (bundled && fs.existsSync(bundled)) encoder = bundled; } catch { /* System ffmpeg remains usable. */ } }
encoder ||= 'ffmpeg';
const dir = path.join(dataDir, '.video-previews');
const version = 'v1-384-12-8';
const maxSourceBytes = 512 * 1024 * 1024;
const maxCacheBytes = Math.max(16, Number(process.env.HEISS_VIDEO_PREVIEW_CACHE_MB) || 512) * 1024 * 1024;
const pending = new Map();
const remoteVersions = new Map();
const queue = [];
let running = false;
let lastSweep = 0;

function queued(work) {
  if (queue.length >= 24) return Promise.reject(new Error('Video preview queue is busy.'));
  return new Promise((resolve, reject) => { queue.push({ work, resolve, reject }); void drain(); });
}
async function drain() {
  if (running) return;
  running = true;
  while (queue.length) { const job = queue.shift(); try { job.resolve(await job.work()); } catch (error) { job.reject(error); } }
  running = false;
}

/** Only one low-priority, single-threaded child encodes at a time. */
function encode(input, output = 'pipe:1') {
  return new Promise((resolve, reject) => {
    const child = spawn(encoder, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '1', '-i', input,
      '-t', '8', '-map', '0:v:0', '-an', '-sn', '-dn', '-filter_threads', '1', '-vf', "fps=12,scale=w='min(384,iw)':h='min(384,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
      '-c:v', 'libx264', '-threads', '1', '-preset', 'veryfast', '-crf', '29', '-pix_fmt', 'yuv420p', '-map_metadata', '-1',
      '-movflags', output === 'pipe:1' ? 'frag_keyframe+empty_moov+default_base_moof' : '+faststart', '-f', 'mp4', output],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_LOW); } catch { /* Not all platforms permit nice. */ }
    const chunks = [];
    let length = 0;
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 60_000);
    child.stdout.on('data', (chunk) => { length += chunk.length; if (length > 8 * 1024 * 1024) child.kill('SIGKILL'); else chunks.push(chunk); });
    child.stderr.on('data', (chunk) => { if (stderr.length < 2000) stderr += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || timedOut) reject(new Error(timedOut ? 'Preview encoding timed out.' : `Preview encoding failed: ${stderr || code}`));
      else resolve(output === 'pipe:1' ? Buffer.concat(chunks) : output);
    });
  });
}

async function sweep() {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  const names = await fs.promises.readdir(dir);
  const entries = (await Promise.all(names.filter((n) => /\.(mp4|jpg)$/.test(n)).map(async (name) => {
    const file = path.join(dir, name); const stat = await fs.promises.stat(file); return { file, size: stat.size, used: stat.atimeMs };
  }))).sort((a, b) => a.used - b.used);
  let size = entries.reduce((n, e) => n + e.size, 0);
  if (size <= maxCacheBytes) return;
  for (const entry of entries) {
    if (size <= maxCacheBytes * .8 || Date.now() - entry.used < 15 * 60_000) break;
    await fs.promises.rm(entry.file, { force: true }); size -= entry.size;
  }
}

function coalesce(key, work) {
  if (pending.has(key)) return pending.get(key);
  const result = queued(work).finally(() => pending.delete(key));
  pending.set(key, result); return result;
}

function identityKey(identity) { return crypto.createHash('sha256').update(`${version}:${identity}`).digest('hex'); }
function comfySource(filename, subfolder, type) { return `${comfyUrl}/view?${new URLSearchParams({ filename, subfolder, type })}`; }

export async function getFileVideoPreview(file, identity = file) {
  const stat = await fs.promises.stat(file);
  if (stat.size > maxSourceBytes) throw new Error('This video is too large for a grid preview.');
  const key = identityKey(identity);
  const revision = crypto.createHash('sha256').update(`${stat.size}:${stat.mtimeMs}`).digest('hex');
  const output = path.join(dir, `${key}-${revision}.mp4`);
  if (fs.existsSync(output)) return output;
  return coalesce(key, async () => {
    await fs.promises.mkdir(dir, { recursive: true });
    const temporary = `${output}.${crypto.randomUUID()}.part`;
    try { await encode(file, temporary); await renameWithRetry(temporary, output); await sweep().catch(() => {}); return output; }
    finally { await fs.promises.rm(temporary, { force: true }); }
  });
}

export async function getComfyVideoPreview(filename, subfolder, type) {
  const source = comfySource(filename, subfolder, type);
  const local = localOutputFile(filename, subfolder, type);
  if (local) return getFileVideoPreview(local, source);
  const key = identityKey(source);
  const known = remoteVersions.get(key);
  if (known && Date.now() - known.checked < 60_000 && fs.existsSync(known.file)) return known.file;
  return coalesce(key, async () => {
    await fs.promises.mkdir(dir, { recursive: true });
    const tempSource = path.join(dir, `${key}.${crypto.randomUUID()}.source`);
    const temporary = `${tempSource}.part`;
    try {
      const headers = known?.etag ? { 'If-None-Match': known.etag } : known?.modified ? { 'If-Modified-Since': known.modified } : {};
      const response = await fetch(source, { headers, signal: AbortSignal.timeout(60_000) });
      if (response.status === 304 && known && fs.existsSync(known.file)) { known.checked = Date.now(); return known.file; }
      if (!response.ok || !response.body) throw new Error('Source video is unavailable.');
      if (Number(response.headers.get('content-length')) > maxSourceBytes) { await response.body.cancel(); throw new Error('Video is too large for a preview.'); }
      const hash = crypto.createHash('sha256'); let bytes = 0;
      const limit = new Transform({ transform(chunk, _encoding, callback) {
        bytes += chunk.length; hash.update(chunk); callback(bytes > maxSourceBytes ? new Error('Video is too large for a preview.') : null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), limit, fs.createWriteStream(tempSource, { flags: 'wx' }));
      const output = path.join(dir, `${key}-${hash.digest('hex')}.mp4`);
      if (!fs.existsSync(output)) { await encode(tempSource, temporary); await renameWithRetry(temporary, output); }
      remoteVersions.set(key, { file: output, checked: Date.now(), etag: response.headers.get('etag'), modified: response.headers.get('last-modified') });
      if (remoteVersions.size > 1000) remoteVersions.delete(remoteVersions.keys().next().value);
      await sweep().catch(() => {}); return output;
    } finally { await Promise.all([tempSource, temporary].map((file) => fs.promises.rm(file, { force: true }))); }
  });
}

/** Hiding/deleting the original also removes its cached plaintext preview, after any encoder finishes. */
export async function forgetItemVideoPreviews(item) {
  if (item?.type !== 'video' || !item.url) return 0;
  let identity;
  try {
    const url = new URL(item.url, 'http://heiss.local');
    if (url.pathname === '/comfy/view') identity = comfySource(url.searchParams.get('filename') || '', url.searchParams.get('subfolder') || '', url.searchParams.get('type') || 'output');
    if (url.pathname === '/api/library/file') identity = `library:${url.searchParams.get('folder')}:${url.searchParams.get('path')}`;
  } catch { return 0; }
  if (!identity) return 0;
  const key = identityKey(identity);
  await pending.get(key)?.catch(() => {});
  remoteVersions.delete(key);
  let removed = 0;
  for (const name of await fs.promises.readdir(dir).catch(() => [])) {
    if (!name.startsWith(`${key}-`)) continue;
    await fs.promises.rm(path.join(dir, name), { force: true }); removed++;
  }
  return removed;
}

/**
 * Hidden previews never touch disk, so they're kept in memory instead: a grid
 * asks for each one several times (the poster, then the video in byte ranges),
 * and encoding it again for every request left Hidden tiles waiting for minutes.
 * Keyed by item id and the source's digest; the route decrypts the original
 * with the caller's own unlock first, so a locked Hidden still serves nothing.
 */
const privateCacheBytes = 96 * 1024 * 1024;
const privatePreviews = new Map();
const privatePending = new Map();

/** Seekable loopback input supports MP4s whose metadata is at the end. No plaintext vault file is written. */
export async function getPrivateVideoPreview(buffer, id = '') {
  if (buffer.length > maxSourceBytes) throw new Error('This video is too large for a grid preview.');
  const key = `${id}:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
  const cached = privatePreviews.get(key);
  if (cached) { privatePreviews.delete(key); privatePreviews.set(key, cached); return cached; }
  if (privatePending.has(key)) return privatePending.get(key);
  const work = queued(() => encodePrivate(buffer)).then((preview) => {
    privatePreviews.set(key, preview);
    let total = 0;
    for (const [entry, bytes] of [...privatePreviews].reverse()) {
      total += bytes.length;
      if (total > privateCacheBytes) privatePreviews.delete(entry);
    }
    return preview;
  }).finally(() => privatePending.delete(key));
  privatePending.set(key, work);
  return work;
}

/** Drops Hidden previews from memory: one item's, or all of them. */
export function forgetPrivateVideoPreviews(id = '') {
  for (const key of privatePreviews.keys()) if (!id || key.startsWith(`${id}:`)) privatePreviews.delete(key);
}

async function encodePrivate(buffer) {
  const token = crypto.randomBytes(24).toString('hex');
  const server = http.createServer((req, res) => {
    if (req.url !== `/${token}` || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404).end(); return; }
    // Reuse Express's range writer with the small subset of response methods it needs.
    const response = Object.assign(res, { status(code) { this.statusCode = code; return this; }, send(bytes) { this.end(req.method === 'HEAD' ? undefined : bytes); } });
    sendMediaBuffer(req, response, buffer);
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return await encode(`http://127.0.0.1:${server.address().port}/${token}`);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

export function sendVideoPreview(req, res, file) {
  const now = new Date();
  fs.promises.stat(file).then((stat) => fs.promises.utimes(file, now, stat.mtime)).catch(() => {});
  res.sendFile(file, { dotfiles: 'allow', headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, max-age=60', 'Content-Disposition': 'inline' } });
}

/** Extract a still from the small preview; private frames remain in memory. */
export async function getVideoPoster(preview) {
  const file = typeof preview === 'string' ? `${preview}.jpg` : '';
  if (file && fs.existsSync(file)) return file;
  const work = () => new Promise((resolve, reject) => {
    const child = spawn(encoder, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', '-i', file ? preview : 'pipe:0', '-frames:v', '1', '-an', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '3', 'pipe:1'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let length = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
    child.stdout.on('data', (chunk) => { length += chunk.length; if (length > 2 * 1024 * 1024) child.kill('SIGKILL'); else chunks.push(chunk); });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', async (code) => {
      clearTimeout(timer);
      if (code !== 0 || !length) { reject(new Error('Video thumbnail is unavailable.')); return; }
      const bytes = Buffer.concat(chunks);
      try { if (file) await fs.promises.writeFile(file, bytes); resolve(file || bytes); } catch (error) { reject(error); }
    });
    child.stdin.end(file ? undefined : preview);
  });
  return file ? coalesce(`poster:${file}`, work) : queued(work);
}

export async function sendVideoPoster(req, res, preview) {
  const poster = await getVideoPoster(preview);
  if (typeof poster === 'string') res.sendFile(poster, { dotfiles: 'allow', headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=60' } });
  else res.type('image/jpeg').send(poster);
}

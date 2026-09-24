import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { comfyRecentlyUnreachable, comfyUrl, localOutputFile, noteComfyFetchError, noteComfyReachable } from "./comfy.js";
import { dataDir } from "./gallery-store.js";
import { renameWithRetry } from "./json-store.js";
import { loadSharp } from "./sharp-loader.js";

// Small on-demand cache of downscaled previews for the gallery grid, so a LAN client
// only has to pull a full-resolution image when it actually opens the viewer.
const thumbnailDir = path.join(dataDir, ".thumbnails");
const longestEdge = 768;
const quality = 72;
const pending = new Map();

// Folding the resize settings into the key means changing longestEdge/quality
// naturally starts a fresh cache generation instead of serving stale-sized files.
function cacheKey(filename, subfolder, type) {
  return crypto.createHash("sha1").update(`${type}:${subfolder}:${filename}:${longestEdge}:${quality}`).digest("hex");
}

function cachePath(key, sourceHash) {
  return path.join(thumbnailDir, `${key}-${sourceHash}.webp`);
}

/** The newest thumbnail already made for this output, whatever its source hash. */
function cachedThumbnail(key) {
  try {
    const found = fs.readdirSync(thumbnailDir)
      .filter((name) => name.startsWith(`${key}-`) && name.endsWith(".webp"))
      .map((name) => ({ file: path.join(thumbnailDir, name), time: fs.statSync(path.join(thumbnailDir, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time)[0];
    return found ? { file: found.file, etag: `"${path.basename(found.file, ".webp").slice(key.length + 1)}"` } : null;
  } catch {
    return null;
  }
}

/** The original's bytes: from ComfyUI, or from disk while ComfyUI is not answering. */
async function sourceBytes(filename, subfolder, type) {
  const params = new URLSearchParams({ filename, subfolder, type });
  const local = () => {
    const file = localOutputFile(filename, subfolder, type);
    return file ? fs.readFileSync(file) : undefined;
  };
  // ComfyUI just failed to answer: skip the slow refused connection when the file is here.
  if (comfyRecentlyUnreachable()) {
    const bytes = local();
    if (bytes) return bytes;
  }
  try {
    const response = await fetch(`${comfyUrl}/view?${params}`, { signal: AbortSignal.timeout(15000) });
    noteComfyReachable();
    return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
  } catch (error) {
    noteComfyFetchError(error);
    return local();
  }
}

/**
 * An output that is on this computer is identified by its size and modified
 * time, so a cached thumbnail is found with one stat instead of downloading
 * and hashing the full image on every request. A reused filename changes both.
 */
function localSource(filename, subfolder, type) {
  const file = localOutputFile(filename, subfolder, type);
  if (!file) return null;
  try {
    const stat = fs.statSync(file);
    const sourceHash = crypto.createHash("sha256").update(`local:${stat.size}:${stat.mtimeMs}`).digest("hex");
    return { file, sourceHash };
  } catch {
    return null;
  }
}

async function build(filename, subfolder, type) {
  const key = cacheKey(filename, subfolder, type);
  const local = localSource(filename, subfolder, type);
  if (local) {
    const file = cachePath(key, local.sourceHash);
    if (fs.existsSync(file)) return { file, etag: `\"${local.sourceHash}\"` };
    let source;
    try { source = fs.readFileSync(local.file); } catch { source = null; }
    if (source) return writeThumbnail(key, local.sourceHash, source);
  }
  // Not on this computer (a remote ComfyUI, or an input/temp file). ComfyUI
  // installations do not consistently provide a useful ETag, and a reused
  // filename could otherwise receive an unrelated old preview, so hash the bytes.
  const source = await sourceBytes(filename, subfolder, type);
  // ComfyUI is down and the file is not on this computer: an earlier thumbnail still beats nothing.
  if (source === undefined) return cachedThumbnail(key);
  if (!source) return null;
  const sourceHash = crypto.createHash("sha256").update(source).digest("hex");
  const file = cachePath(key, sourceHash);
  if (fs.existsSync(file)) return { file, etag: `\"${sourceHash}\"` };
  return writeThumbnail(key, sourceHash, source);
}

async function writeThumbnail(key, sourceHash, source) {
  const file = cachePath(key, sourceHash);
  const sharp = await loadSharp();
  if (!sharp) return { original: true };
  const resized = await sharp(source)
    .resize({ width: longestEdge, height: longestEdge, fit: "inside", withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();

  fs.mkdirSync(thumbnailDir, { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, resized);
  renameWithRetry(temp, file);
  // Best-effort: drop any earlier cached thumbnail for this resource under a stale ETag.
  for (const entry of fs.readdirSync(thumbnailDir)) {
    if (entry.startsWith(`${key}-`) && path.join(thumbnailDir, entry) !== file) {
      // Synchronous, so the stale file is gone by the time the new one is served.
      try { fs.rmSync(path.join(thumbnailDir, entry), { force: true }); } catch { /* in use (Windows); next build retries */ }
    }
  }
  return { file, etag: `\"${sourceHash}\"` };
}

// Concurrent requests for the same not-yet-cached image share one build instead of
// each downloading and resizing the source independently. Without sharp there is
// nothing to build: an earlier thumbnail, else `{ original: true }` (serve the full image).
export async function getThumbnail(filename, subfolder, type) {
  if (!(await loadSharp())) return cachedThumbnail(cacheKey(filename, subfolder, type)) || { original: true };
  const dedupeKey = `${type}:${subfolder}:${filename}`;
  if (pending.has(dedupeKey)) return pending.get(dedupeKey);
  const promise = build(filename, subfolder, type).finally(() => pending.delete(dedupeKey));
  pending.set(dedupeKey, promise);
  return promise;
}

// Vault assets are decrypted per request and must never leave a plaintext
// derivative on disk, so this resizes in memory only — nothing is cached.
export async function resizeInMemory(buffer, mime) {
  if (!mime?.startsWith("image/") || mime === "image/svg+xml") return null;
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    return await sharp(buffer)
      .resize({ width: longestEdge, height: longestEdge, fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();
  } catch {
    return null;
  }
}

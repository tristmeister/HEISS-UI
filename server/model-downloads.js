import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { comfyModelsDir, modelFolders } from './comfy.js';
import { renameWithRetry } from "./json-store.js";
import { freeBytesAt } from "./paths.js";

/**
 * Fetches text encoders and VAEs a model needs into ComfyUI's own folders. Only
 * files from HEISS's catalog can be requested (the caller passes an entry it
 * looked up by id), so a request can never point the server at an arbitrary URL
 * or path. One file downloads at a time; the rest wait in order. A stopped
 * download keeps its .part file plus a small .part.json note, so it resumes
 * where it left off, even after HEISS restarts.
 */

const allowedFolders = new Set(["text_encoders", "vae", "diffusion_models", "checkpoints", "loras"]);
const allowedHosts = new Set(["huggingface.co"]);

let queue = [];
let active = null;

function snapshot(entry) {
  if (!entry) return null;
  const { controller, ...rest } = entry;
  return rest;
}

export function downloadState() {
  return {
    // Downloads land in ComfyUI's models folder, so only a ComfyUI on this computer can take them.
    local: Boolean(comfyModelsDir()),
    active: snapshot(active),
    queued: queue.map(snapshot),
    recent: recent.map(snapshot),
    paused: pausedDownloads()
  };
}

/** Half-finished files on disk that nothing is fetching right now, from their .part.json notes. */
function pausedDownloads() {
  const busy = new Set([active, ...queue].filter(Boolean).map((entry) => `${entry.folder}/${entry.file}`));
  const found = [];
  for (const folder of allowedFolders) {
    for (const dir of folderDirs(folder)) {
      let names = [];
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const name of names) {
        if (!name.endsWith(".part.json")) continue;
        const file = name.slice(0, -".part.json".length);
        if (busy.has(`${folder}/${file}`)) continue;
        const received = fileSize(path.join(dir, `${file}.part`));
        if (!received) continue;
        try {
          const note = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
          found.push({ id: String(note.id || ""), file, folder, label: String(note.label || file), status: "paused", receivedBytes: received, totalBytes: Number(note.totalBytes || 0) });
        } catch {
          // A note that cannot be read just means that file starts over.
        }
      }
    }
  }
  return found;
}

const recent = [];
function remember(entry) {
  recent.unshift(entry);
  recent.splice(8);
}

function targetFor(spec) {
  const modelsDir = comfyModelsDir();
  if (!modelsDir) throw new Error("ComfyUI isn't on this computer. Download the file from the link and add it there.");
  if (!allowedFolders.has(spec.folder)) throw new Error("That file does not belong in a ComfyUI model folder.");
  const name = path.basename(String(spec.file || ""));
  if (!name || name !== spec.file || !/\.(safetensors|gguf)$/i.test(name)) throw new Error("That is not a model file HEISS can download.");
  const url = new URL(spec.url);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) throw new Error("Only Hugging Face downloads are supported.");
  // Land it where ComfyUI itself reads that kind from, so it shows up without a restart.
  const dirs = folderDirs(spec.folder);
  const dir = dirs.find((item) => path.basename(item) === spec.folder) || dirs[0] || path.join(modelsDir, spec.folder);
  return { dir, target: path.join(dir, name), partial: path.join(dir, `${name}.part`), note: path.join(dir, `${name}.part.json`) };
}

/** ComfyUI's own folders for this kind first (extra_model_paths.yaml included), then models/<folder>. */
function folderDirs(folder) {
  const subfolders = folder === "text_encoders" ? ["text_encoders", "clip"] : folder === "diffusion_models" ? ["diffusion_models", "unet"] : [folder];
  return modelFolders(folder, subfolders);
}

/** The file already sitting in any folder ComfyUI loads this kind from. */
function existingCopy(spec) {
  for (const dir of folderDirs(spec.folder)) {
    const file = path.join(dir, spec.file);
    if (fileSize(file) > 0) return file;
  }
  return "";
}

/** An error that trying again will not fix (full disk, gated file). */
function finalError(message) {
  const error = new Error(message);
  error.final = true;
  return error;
}

function gigabytes(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(bytes < 10 * 1024 ** 3 ? 1 : 0)} GB`;
}

function fileSize(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}

/** Queue one catalog file. Returns the queued entry, or the running one if it is already going. */
export function startDownload(spec) {
  const { dir } = targetFor(spec);
  const same = (entry) => entry && entry.folder === spec.folder && entry.file === spec.file;
  if (same(active)) return snapshot(active);
  const waiting = queue.find(same);
  if (waiting) return snapshot(waiting);
  const existing = existingCopy(spec);
  if (existing) {
    const size = fileSize(existing);
    const done = { id: spec.id, file: spec.file, folder: spec.folder, label: spec.label || spec.file, status: "done", already: true, receivedBytes: size, totalBytes: size, finishedAt: Date.now() };
    remember(done);
    return done;
  }
  const entry = {
    id: spec.id,
    file: spec.file,
    folder: spec.folder,
    label: spec.label || spec.file,
    url: spec.url,
    dir,
    status: "queued",
    receivedBytes: 0,
    totalBytes: Number(spec.bytes || 0),
    bytesPerSecond: 0,
    queuedAt: Date.now(),
    error: ""
  };
  queue.push(entry);
  pump();
  return snapshot(entry);
}

export function cancelDownload(id) {
  if (active && active.id === id) {
    active.controller?.abort();
    return snapshot(active);
  }
  const index = queue.findIndex((entry) => entry.id === id);
  if (index < 0) return null;
  const [entry] = queue.splice(index, 1);
  entry.status = entry.receivedBytes ? "paused" : "canceled";
  remember(entry);
  return snapshot(entry);
}

async function pump() {
  if (active || !queue.length) return;
  active = queue.shift();
  active.controller = new AbortController();
  active.status = "downloading";
  active.startedAt = Date.now();
  try {
    await fetchInto(active, active.controller.signal);
    active.status = "done";
  } catch (error) {
    const canceled = active.controller.signal.aborted;
    active.status = canceled ? "paused" : "error";
    active.error = canceled ? "" : error?.code === "ENOSPC" ? "The disk filled up. Free some space, then try again; it resumes where it stopped." : error.message || "Download failed.";
    // Retrying only helps when the network was the problem.
    active.retryable = canceled || !error?.final;
  }
  active.finishedAt = Date.now();
  const finished = active;
  active = null;
  delete finished.controller;
  finished.bytesPerSecond = 0;
  remember(finished);
  pump();
}

async function fetchInto(entry, signal) {
  const { dir, target, partial, note } = targetFor(entry);
  fs.mkdirSync(dir, { recursive: true });
  let offset = fileSize(partial);
  entry.receivedBytes = offset;
  // A whole .part left by a rename that failed last time: asking for the bytes after
  // its end would only get HTTP 416, so finish it without a request.
  const known = knownLength(note);
  if (offset && known && offset >= known) {
    if (offset === known) return finishDownload(entry, partial, target, note);
    offset = 0; // Longer than the file itself: start over.
  }
  let response = await fetch(entry.url, { redirect: "follow", signal, headers: offset ? { range: `bytes=${offset}-` } : {} });
  if (offset && response.status === 416) {
    // Nothing left past the end: complete if the server's size matches, else the part is not this file.
    const total = Number(/\/(\d+)\s*$/.exec(response.headers.get("content-range") || "")?.[1] || 0);
    if (total && total === offset) return finishDownload(entry, partial, target, note);
    await response.body?.cancel().catch(() => {});
    offset = 0;
    response = await fetch(entry.url, { redirect: "follow", signal });
  }
  if (offset && response.status === 200) offset = 0; // Range ignored: start over.
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) {
      throw finalError(`${entry.file} needs a Hugging Face login or licence acceptance (HTTP ${response.status}). Download it in your browser and put it in ComfyUI’s ${entry.folder} folder.`);
    }
    if (response.status === 404) throw finalError(`${entry.file} is no longer at its download address (HTTP 404).`);
    throw new Error(`Hugging Face answered ${response.status} for ${entry.file}.`);
  }
  // Catalog sizes are approximate; only the server's own length is a check.
  const length = Number(response.headers.get("content-length") || 0);
  // Several gigabytes onto a full disk would fail near the end; check first.
  const free = freeBytesAt(dir);
  const margin = 256 * 1024 * 1024;
  if (free !== null && length && free < length + margin) {
    await response.body.cancel().catch(() => {});
    throw finalError(`Not enough space: ${entry.file} needs ${gigabytes(length)}, and the disk has ${gigabytes(free)} free.`);
  }
  const expected = length ? offset + length : 0;
  if (expected) entry.totalBytes = expected;
  entry.receivedBytes = offset;
  try {
    // `exact` marks a length the server sent, not the catalog's estimate.
    fs.writeFileSync(note, JSON.stringify({ id: entry.id, label: entry.label, totalBytes: entry.totalBytes, exact: Boolean(expected) }));
  } catch {
    // Without the note it still resumes this session; only a restart forgets it.
  }
  // Speed over the last few seconds, for the time-left estimate.
  let windowStart = Date.now();
  let windowBytes = 0;
  await pipeline(
    Readable.fromWeb(response.body),
    new Transform({
      transform(chunk, _encoding, done) {
        entry.receivedBytes += chunk.length;
        windowBytes += chunk.length;
        const elapsed = Date.now() - windowStart;
        if (elapsed >= 1000) {
          const rate = (windowBytes * 1000) / elapsed;
          entry.bytesPerSecond = entry.bytesPerSecond ? entry.bytesPerSecond * 0.6 + rate * 0.4 : rate;
          windowStart = Date.now();
          windowBytes = 0;
        }
        done(null, chunk);
      }
    }),
    fs.createWriteStream(partial, { flags: offset ? "a" : "w" }),
    { signal }
  );
  // Without a published checksum the length is the check: a short file is not a model.
  if (expected && fileSize(partial) !== expected) {
    throw new Error(`${entry.file} arrived incomplete. Try again to resume it.`);
  }
  finishDownload(entry, partial, target, note);
}

function finishDownload(entry, partial, target, note) {
  entry.receivedBytes = fileSize(partial);
  entry.totalBytes = entry.receivedBytes;
  renameWithRetry(partial, target);
  fs.rmSync(note, { force: true });
}

/** The file's length as the server reported it on an earlier try, or 0 when unknown. */
function knownLength(note) {
  try {
    const saved = JSON.parse(fs.readFileSync(note, "utf8"));
    return saved.exact ? Number(saved.totalBytes || 0) : 0;
  } catch {
    return 0;
  }
}

/** Throws away a stopped download's partial file. */
export function discardDownload(spec) {
  cancelDownload(spec.id);
  for (const dir of folderDirs(spec.folder)) {
    fs.rmSync(path.join(dir, `${spec.file}.part`), { force: true });
    fs.rmSync(path.join(dir, `${spec.file}.part.json`), { force: true });
  }
}

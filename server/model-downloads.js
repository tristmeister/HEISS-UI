import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { comfyModelsDir } from './comfy.js';

/**
 * Fetches text encoders and VAEs a model needs into ComfyUI's own folders. Only
 * files from HEISS's catalog can be requested (the caller passes an entry it
 * looked up by id), so a request can never point the server at an arbitrary URL
 * or path. One file downloads at a time; the rest wait in order.
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
    active: snapshot(active),
    queued: queue.map(snapshot),
    recent: recent.map(snapshot)
  };
}

const recent = [];
function remember(entry) {
  recent.unshift(entry);
  recent.splice(8);
}

function targetFor(spec) {
  const modelsDir = comfyModelsDir();
  if (!modelsDir) throw new Error("ComfyUI is not on this computer, so HEISS cannot put files into its folders. Download it from the link instead.");
  if (!allowedFolders.has(spec.folder)) throw new Error("That file does not belong in a ComfyUI model folder.");
  const name = path.basename(String(spec.file || ""));
  if (!name || name !== spec.file || !/\.(safetensors|gguf)$/i.test(name)) throw new Error("That is not a model file HEISS can download.");
  const url = new URL(spec.url);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) throw new Error("HEISS only downloads model files from Hugging Face.");
  const dir = path.join(modelsDir, spec.folder);
  return { dir, target: path.join(dir, name), partial: path.join(dir, `${name}.part`) };
}

function fileSize(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}

/** Queue one catalog file. Returns the queued entry, or the running one if it is already going. */
export function startDownload(spec) {
  const { dir, target } = targetFor(spec);
  const same = (entry) => entry && entry.folder === spec.folder && entry.file === spec.file;
  if (same(active)) return snapshot(active);
  const waiting = queue.find(same);
  if (waiting) return snapshot(waiting);
  if (fileSize(target) > 0) {
    const done = { id: spec.id, file: spec.file, folder: spec.folder, label: spec.label || spec.file, status: "done", receivedBytes: fileSize(target), totalBytes: fileSize(target), finishedAt: Date.now() };
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
  entry.status = "canceled";
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
    active.status = canceled ? "canceled" : "error";
    active.error = canceled ? "" : error.message || "Download failed.";
  }
  active.finishedAt = Date.now();
  const finished = active;
  active = null;
  delete finished.controller;
  remember(finished);
  pump();
}

async function fetchInto(entry, signal) {
  const { dir, target, partial } = targetFor(entry);
  fs.mkdirSync(dir, { recursive: true });
  let offset = fileSize(partial);
  const response = await fetch(entry.url, { redirect: "follow", signal, headers: offset ? { range: `bytes=${offset}-` } : {} });
  if (offset && response.status === 200) offset = 0; // Range ignored: start over.
  if (!response.ok || !response.body) {
    throw new Error(`Hugging Face answered ${response.status} for ${entry.file}.`);
  }
  // Catalog sizes are approximate; only the server's own length is a check.
  const length = Number(response.headers.get("content-length") || 0);
  const expected = length ? offset + length : 0;
  if (expected) entry.totalBytes = expected;
  entry.receivedBytes = offset;
  await pipeline(
    Readable.fromWeb(response.body),
    new Transform({
      transform(chunk, _encoding, done) {
        entry.receivedBytes += chunk.length;
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
  fs.renameSync(partial, target);
}

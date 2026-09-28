import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { comfyOutputDir, normalizeFolderInput, root } from "./comfy.js";
import { dataDir, dedupeGallery, describeComfyGraph, gallery, galleryKey, galleryLimit, isGalleryHidden, listedInFolder, markGalleryReset, promptTitle, setGallery, setLibraryFileCheck, invalidateVisibleCache } from "./gallery-store.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { isInside, samePath } from "./paths.js";
import { parseA1111Parameters, readPngInfo } from "./png-text.js";
import { loadSharp } from "./sharp-loader.js";

/**
 * Earlier work in the gallery: images from other folders (old ComfyUI
 * outputs, an AUTOMATIC1111 or Forge folder) are shown where they are,
 * never copied, and images already in ComfyUI's output folder that the
 * gallery never saw (made in ComfyUI itself, or older than its history)
 * join as ordinary outputs.
 *
 * A prompt is read from the file's own metadata (ComfyUI's "prompt" chunk,
 * or A1111's "parameters") so it can be searched and shown. Nothing else is
 * taken from it.
 *
 * What is never read: HEISS UI's own folders (its data, where Hidden and
 * the thumbnail cache live, and the app itself), dot folders, and the
 * heiss-ui folder inside the output folder, whose files are either in the
 * gallery already, deleted on purpose, or a copy Hidden could not remove.
 */

const foldersPath = path.join(dataDir, "library-folders.json");
export const imagePattern = /\.(png|jpe?g|webp|gif|avif)$/i;
export const videoPattern = /\.(mp4|webm|mov|mkv)$/i;
const mediaPattern = /\.(png|jpe?g|webp|gif|avif|mp4|webm|mov|mkv)$/i;
export const scanFileLimit = 20000;
const scanDepth = 8;
const skippedNames = new Set(["node_modules", "__pycache__", "$RECYCLE.BIN", "System Volume Information"]);

function realPath(dir) {
  try { return fs.realpathSync(dir); } catch { return path.resolve(dir); }
}

let folders = loadFolders();

function loadFolders() {
  try {
    const value = readJsonFile(foldersPath);
    return (Array.isArray(value?.folders) ? value.folders : []).filter((folder) => folder?.id && folder?.path);
  } catch {
    return [];
  }
}

function saveFolders() {
  invalidateVisibleCache();
  writeJsonFile(foldersPath, { version: 1, folders });
}

export function libraryFolders() {
  return folders.map((folder) => ({ ...folder, available: folderAvailable(folder) }));
}

/** Folders HEISS UI keeps to itself: never listed, never served. */
function isOwnFolder(dir) {
  return [dataDir, root].some((own) => own && isInside(realPath(own), dir, { orSame: true }));
}

function isOutputFolder(dir) {
  return Boolean(comfyOutputDir) && isInside(realPath(comfyOutputDir), dir, { orSame: true });
}

const availability = new Map();
function folderAvailable(folder) {
  const cached = availability.get(folder.id);
  if (cached && Date.now() - cached.at < 5000) return cached.ok;
  let ok = false;
  try { ok = fs.statSync(folder.path).isDirectory(); } catch { ok = false; }
  availability.set(folder.id, { at: Date.now(), ok });
  return ok;
}

/* -------------------------------------------------------------- Metadata */

/** What a file says about itself: its size, and a prompt when it carries one. */
export async function readMediaInfo(file) {
  const info = { width: 0, height: 0, prompt: "", negative: "", model: "" };
  if (/\.png$/i.test(file)) {
    const png = readPngInfo(file);
    if (png) {
      info.width = png.width;
      info.height = png.height;
      const a1111 = png.text.parameters ? parseA1111Parameters(png.text.parameters) : null;
      if (a1111?.prompt) Object.assign(info, { prompt: a1111.prompt, negative: a1111.negative, model: a1111.model });
      else if (png.text.prompt) {
        // The size in the graph is what was asked for; the PNG's own is truer, so only the words are taken.
        try {
          const { prompt, negative, model } = describeComfyGraph(JSON.parse(png.text.prompt));
          Object.assign(info, { prompt, negative, model });
        } catch { /* not ComfyUI's graph */ }
      }
      return info;
    }
  }
  if (imagePattern.test(file)) {
    const sharp = await loadSharp();
    if (sharp) {
      try {
        const meta = await sharp(file).metadata();
        info.width = Number(meta.width || 0);
        info.height = Number(meta.height || 0);
      } catch { /* unreadable: shown without its size */ }
    }
  }
  return info;
}

/* ---------------------------------------------------------------- Walking */

const yieldToServer = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Media files under `base`, newest folders first as they come. `skip(dir)`
 * leaves a folder out. Symbolic links are only followed within `base`.
 */
async function walk(base, skip) {
  const files = [];
  const seen = new Set();
  let capped = false;
  const visit = async (dir, depth) => {
    if (files.length >= scanFileLimit) { capped = true; return; }
    const real = realPath(dir);
    if (seen.has(real) || !isInside(base, real, { orSame: true }) || skip(real)) return;
    seen.add(real);
    let entries = [];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= scanFileLimit) { capped = true; return; }
      if (entry.name.startsWith(".") || skippedNames.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stat = fs.statSync(full);
          isDir = stat.isDirectory();
          isFile = stat.isFile();
        } catch { continue; }
      }
      if (isDir && depth < scanDepth) await visit(full, depth + 1);
      else if (isFile && mediaPattern.test(entry.name)) {
        const resolved = realPath(full);
        if (isInside(base, resolved)) files.push(full);
      }
    }
    if (seen.size % 50 === 0) await yieldToServer();
  };
  await visit(base, 0);
  return { files, capped };
}

async function recordFor(file, { url, thumbnailUrl, library }) {
  let stat;
  try { stat = await fs.promises.stat(file); } catch { return null; }
  const type = videoPattern.test(file) ? "video" : "image";
  const meta = type === "image" ? await readMediaInfo(file) : { width: 0, height: 0, prompt: "", negative: "", model: "" };
  const name = path.basename(file);
  return {
    id: url,
    url,
    ...(type === "image" ? { thumbnailUrl } : {}),
    type,
    status: "done",
    prompt: meta.prompt,
    negative: meta.negative,
    filename: meta.prompt ? promptTitle(meta.prompt) : name.replace(/\.[^.]+$/, ""),
    outputName: name,
    createdAt: new Date(stat.mtimeMs).toISOString(),
    width: meta.width,
    height: meta.height,
    model: meta.model,
    settings: {},
    ...(library ? { library } : {})
  };
}

/** Adds records the gallery does not have yet, and leaves out anything once deleted from it. */
function addRecords(records) {
  const known = new Set(gallery.map(galleryKey));
  const fresh = records.filter((record) => record && !known.has(galleryKey(record)) && !isGalleryHidden(record));
  if (!fresh.length) return 0;
  // Thousands at once: browsers reload the page rather than take them as a delta.
  setGallery(dedupeGallery([...gallery, ...fresh]).slice(0, galleryLimit), { track: false });
  markGalleryReset();
  return fresh.length;
}

async function toRecords(files, describe) {
  const records = [];
  const known = new Set(gallery.map(galleryKey));
  for (const [index, file] of files.entries()) {
    const target = describe(file);
    // Only new files are opened; one already in the gallery is left alone.
    if (!target || known.has(target.url)) continue;
    records.push(await recordFor(file, target));
    if (index % 100 === 99) await yieldToServer();
  }
  return records;
}

/* ------------------------------------------------------- The output folder */

/**
 * Images in ComfyUI's output folder that the gallery does not know, added
 * as ordinary outputs (they open, upscale, hide and delete like any other).
 */
export async function importOutputFolder() {
  if (!comfyOutputDir) throw new Error("Set ComfyUI’s output folder first (Settings › Library).");
  const base = realPath(comfyOutputDir);
  try { if (!fs.statSync(base).isDirectory()) throw new Error("missing"); } catch { throw new Error("The output folder is not there any more."); }
  const own = path.join(base, "heiss-ui");
  const { files, capped } = await walk(base, (dir) => isInside(own, dir, { orSame: true }) || isOwnFolder(dir));
  const records = await toRecords(files, (file) => {
    const rel = path.relative(base, realPath(file));
    const subfolder = path.dirname(rel) === "." ? "" : path.dirname(rel);
    const params = new URLSearchParams({ filename: path.basename(rel), subfolder, type: "output" });
    return { url: `/comfy/view?${params}`, thumbnailUrl: `/comfy/thumb?${params}` };
  });
  return { added: addRecords(records), found: files.length, capped };
}

/* ------------------------------------------------------- Other folders */

function libraryUrl(kind, folderId, rel) {
  return `/api/library/${kind}?${new URLSearchParams({ folder: folderId, path: rel.split(path.sep).join("/") })}`;
}

const scans = new Map();

/** Looks through a registered folder again and adds what is new. */
export function scanLibraryFolder(id) {
  if (scans.has(id)) return scans.get(id);
  const folder = folders.find((entry) => entry.id === id);
  if (!folder) return Promise.reject(new Error("That folder is no longer added."));
  const run = (async () => {
    if (!folderAvailable(folder)) throw new Error(`${folder.name} is not reachable right now. Is the drive connected?`);
    const base = folder.path;
    const { files, capped } = await walk(base, (dir) => isOwnFolder(dir) || isOutputFolder(dir));
    const records = await toRecords(files, (file) => {
      const rel = path.relative(base, realPath(file));
      return { url: libraryUrl("file", folder.id, rel), thumbnailUrl: libraryUrl("thumb", folder.id, rel), library: { folder: folder.id, path: rel.split(path.sep).join("/") } };
    });
    const added = addRecords(records);
    folder.scannedAt = new Date().toISOString();
    folder.count = gallery.filter((item) => item.library?.folder === folder.id).length;
    saveFolders();
    return { added, found: files.length, capped, folder: { ...folder, available: true } };
  })().finally(() => scans.delete(id));
  scans.set(id, run);
  return run;
}

/**
 * Adds a folder of earlier images. The output folder (or one inside it) is
 * imported as ordinary outputs instead; HEISS UI's own folders are refused.
 */
export async function addLibraryFolder(input) {
  const dir = normalizeFolderInput(input);
  if (!dir) throw new Error("Choose a folder.");
  let stat;
  try { stat = fs.statSync(dir); } catch { throw new Error("That folder does not exist on this computer."); }
  if (!stat.isDirectory()) throw new Error("That is a file, not a folder.");
  const real = realPath(dir);
  if (isOwnFolder(real)) throw new Error("That is HEISS UI’s own folder. Choose the folder your earlier images are in.");
  if (isOutputFolder(real)) return { output: true, ...(await importOutputFolder()) };
  const existing = folders.find((folder) => samePath(folder.path, real));
  if (existing) return scanLibraryFolder(existing.id);
  const folder = {
    id: crypto.randomBytes(6).toString("hex"),
    path: real,
    name: path.basename(real) || real,
    addedAt: new Date().toISOString(),
    scannedAt: "",
    count: 0
  };
  folders = [...folders, folder];
  saveFolders();
  return scanLibraryFolder(folder.id);
}

/** Stops showing a folder: its images leave the gallery, the files stay where they are. */
export function removeLibraryFolder(id) {
  const folder = folders.find((entry) => entry.id === id);
  if (!folder) return { removed: 0 };
  folders = folders.filter((entry) => entry.id !== id);
  saveFolders();
  const before = gallery.length;
  setGallery(gallery.filter((item) => item.library?.folder !== id), { track: false });
  markGalleryReset();
  return { removed: before - gallery.length };
}

/** Every added folder again, for new images since last time. Quiet: a missing drive is not news. */
export async function rescanLibraryFolders() {
  for (const folder of folders) await scanLibraryFolder(folder.id).catch(() => null);
}

/* ------------------------------------------------------------- Serving */

/**
 * The file behind a library URL, or null. Only media files, only inside the
 * added folder (after following links), never HEISS UI's own folders or the
 * output folder, and never a dot folder.
 */
export function libraryFile(folderId, rel) {
  const folder = folders.find((entry) => entry.id === String(folderId || ""));
  const relative = String(rel || "");
  if (!folder || !relative || !mediaPattern.test(relative)) return null;
  if (relative.split(/[\\/]/).some((part) => !part || part.startsWith(".") || part === "..")) return null;
  const candidate = path.resolve(folder.path, relative);
  if (!isInside(folder.path, candidate)) return null;
  let real;
  try { real = fs.realpathSync(candidate); } catch { return null; }
  if (!isInside(folder.path, real) || isOwnFolder(real) || isOutputFolder(real)) return null;
  try { return fs.statSync(real).isFile() ? real : null; } catch { return null; }
}

// A library image shows while its file is there; a folder on a drive that is
// not connected keeps its images out of sight until it is back.
setLibraryFileCheck((item) => {
  const folder = folders.find((entry) => entry.id === item.library?.folder);
  if (!folder || !folderAvailable(folder)) return false;
  const file = path.resolve(folder.path, String(item.library?.path || ""));
  return isInside(folder.path, file) && listedInFolder(file);
});

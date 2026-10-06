import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { comfyOutputDir } from "./comfy.js";
import { outputFileCandidates } from "./gallery-store.js";
import { renameWithRetry } from "./json-store.js";
import { isInside } from "./paths.js";
import { forgetItemThumbnails } from "./thumbnails.js";
import { forgetItemVideoPreviews } from './video-previews.js';

/**
 * "Delete all finished images" moves them to a trash instead of deleting
 * them: one folder per clear, `.heiss-trash/<batch>/` inside ComfyUI's output
 * folder (same disk, so moving is instant and never runs out of space), with
 * a batch.json listing the gallery records and where each file came from.
 * A batch can be put back until it is purged, after HEISS_TRASH_DAYS (30).
 *
 * Only what the gallery cleared goes in: Hidden lives in its own encrypted
 * store and is never part of a clear. Folders starting with a dot are not
 * served as outputs (comfy.js), so the trash is not visible as one either.
 */

export const trashFolderName = ".heiss-trash";
export const trashDays = (() => {
  const days = Number(process.env.HEISS_TRASH_DAYS || 30);
  return Number.isFinite(days) && days >= 1 ? Math.min(365, days) : 30;
})();
const dayMs = 24 * 60 * 60 * 1000;

export function trashDir(baseDir = comfyOutputDir) {
  return baseDir ? path.join(path.resolve(baseDir), trashFolderName) : "";
}

function moveFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    renameWithRetry(from, to);
  } catch (error) {
    // Another disk after all (a symlinked subfolder): copy, then remove.
    if (error.code !== "EXDEV") throw error;
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    fs.unlinkSync(from);
  }
}

/** Every file of an item on this computer: the output and its upscale, inside the output folder only. */
function itemFiles(item, base) {
  const candidates = [
    ...outputFileCandidates(item, base),
    ...(item?.upscale?.url ? outputFileCandidates({ url: item.upscale.url }, base) : [])
  ];
  return [...new Set(candidates.map((file) => path.resolve(file)))].filter((file) => {
    if (!isInside(base, file) || isInside(path.join(base, trashFolderName), file, { orSame: true })) return false;
    try { return fs.lstatSync(file).isFile(); } catch { return false; }
  });
}

function readBatch(dir) {
  try {
    const batch = JSON.parse(fs.readFileSync(path.join(dir, "batch.json"), "utf8"));
    return batch && Array.isArray(batch.files) ? batch : null;
  } catch {
    return null;
  }
}

/**
 * Moves the files of these gallery items into a new trash batch. Returns
 * { batch, moved, skipped } like the old delete returned { deleted, skipped }.
 */
export function trashGalleryItems(items, baseDir = comfyOutputDir) {
  if (!baseDir) return { batch: "", moved: 0, skipped: 0 };
  const base = path.resolve(baseDir);
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
  const dir = path.join(base, trashFolderName, id);
  const files = [];
  const kept = [];
  let skipped = 0;
  for (const item of items) {
    let movedAny = false;
    for (const file of itemFiles(item, base)) {
      const rel = path.relative(base, file);
      try {
        moveFile(file, path.join(dir, "files", rel));
        files.push(rel);
        movedAny = true;
      } catch {
        skipped += 1;
      }
    }
    if (movedAny) {
      const { preview, previews, progress, ...record } = item;
      kept.push(record);
    }
  }
  if (!files.length) return { batch: "", moved: 0, skipped };
  fs.writeFileSync(path.join(dir, "batch.json"), JSON.stringify({ version: 1, id, createdAt: new Date().toISOString(), items: kept, files }, null, 2), { mode: 0o600 });
  return { batch: id, moved: files.length, skipped };
}

/** The batches in the trash, newest first. */
export function trashBatches(baseDir = comfyOutputDir) {
  const root = trashDir(baseDir);
  if (!root) return [];
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name); } catch { return []; }
  return names.map((name) => {
    const dir = path.join(root, name);
    const batch = readBatch(dir);
    let createdAt = batch?.createdAt || "";
    if (!Date.parse(createdAt)) { try { createdAt = fs.statSync(dir).mtime.toISOString(); } catch { createdAt = new Date(0).toISOString(); } }
    return { id: name, dir, createdAt, items: batch?.items?.length || 0, files: batch?.files?.length || 0, batch };
  }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** What Settings shows: how much is in the trash, and when the oldest goes for good. */
export function trashSummary(baseDir = comfyOutputDir) {
  const batches = trashBatches(baseDir);
  const oldest = batches.at(-1);
  return {
    batches: batches.length,
    items: batches.reduce((sum, batch) => sum + batch.items, 0),
    files: batches.reduce((sum, batch) => sum + batch.files, 0),
    days: trashDays,
    latest: batches[0]?.id || "",
    purgesAt: oldest ? new Date(Date.parse(oldest.createdAt) + trashDays * dayMs).toISOString() : ""
  };
}

/**
 * Puts a batch back (the newest when no id is given). A file whose place has
 * been taken since stays in the trash rather than overwrite anything.
 * Returns the gallery records whose output is back on disk.
 */
export function restoreTrash(batchId = "", baseDir = comfyOutputDir) {
  if (!baseDir) return { restored: [], missing: 0 };
  const base = path.resolve(baseDir);
  const found = trashBatches(base).find((batch) => (batchId ? batch.id === batchId : Boolean(batch.batch)));
  if (!found?.batch) return { restored: [], missing: 0 };
  let missing = 0;
  const back = new Set();
  for (const rel of found.batch.files) {
    const target = path.resolve(base, rel);
    const source = path.resolve(found.dir, "files", rel);
    if (!isInside(base, target) || !isInside(found.dir, source)) { missing += 1; continue; }
    if (fs.existsSync(target) || !fs.existsSync(source)) { missing += 1; continue; }
    try {
      moveFile(source, target);
      back.add(target);
    } catch {
      missing += 1;
    }
  }
  const restored = (found.batch.items || []).filter((item) => outputFileCandidates(item, base).some((file) => back.has(path.resolve(file))));
  // Whatever could not go back stays in the trash with its own record; an empty batch goes.
  const left = found.batch.files.filter((rel) => !back.has(path.resolve(base, rel)));
  if (left.length) {
    fs.writeFileSync(path.join(found.dir, "batch.json"), JSON.stringify({ ...found.batch, files: left, items: (found.batch.items || []).filter((item) => !restored.includes(item)) }, null, 2), { mode: 0o600 });
  } else {
    fs.rmSync(found.dir, { recursive: true, force: true });
  }
  return { restored, missing };
}

async function removeBatch(batch) {
  for (const item of batch.batch?.items || []) {
    await forgetItemThumbnails(item).catch(() => 0);
    await forgetItemVideoPreviews(item).catch(() => 0);
  }
  fs.rmSync(batch.dir, { recursive: true, force: true });
}

/** Deletes batches older than the retention for good. Returns how many went. */
export async function purgeTrash({ baseDir = comfyOutputDir, now = Date.now() } = {}) {
  let purged = 0;
  for (const batch of trashBatches(baseDir)) {
    if (now - Date.parse(batch.createdAt) < trashDays * dayMs) continue;
    try {
      await removeBatch(batch);
      purged += 1;
    } catch {
      // In use right now; the next sweep gets it.
    }
  }
  return purged;
}

/** "Empty trash": everything in it, now. */
export async function emptyTrash(baseDir = comfyOutputDir) {
  let removed = 0;
  for (const batch of trashBatches(baseDir)) {
    try {
      await removeBatch(batch);
      removed += 1;
    } catch {
      // Skipped; still listed next time.
    }
  }
  return removed;
}

/** Purges once shortly after start, then every six hours while running. */
export function scheduleTrashPurge() {
  const sweep = () => purgeTrash().catch((error) => console.warn(`[HEISS] Could not empty old trash: ${error.message}`));
  setTimeout(sweep, 30 * 1000).unref?.();
  setInterval(sweep, 6 * 60 * 60 * 1000).unref?.();
}

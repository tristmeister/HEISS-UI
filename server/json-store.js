import fs from "node:fs";
import path from "node:path";

/**
 * Crash-safe JSON files for everything HEISS UI remembers.
 *
 * A plain writeFileSync truncates the file first, so a crash, a full disk or a
 * killed process mid-write leaves half a file. Every loader here treats an
 * unreadable file as "nothing saved yet", and the next save then replaces the
 * user's stacks, preferences or password config with an empty one.
 *
 * Writes go to a temporary file that is flushed and then renamed over the
 * old one (atomic on the same disk), and the previous good copy is kept as
 * `.bak`. Reads fall back to that copy, and a corrupt file is set aside as
 * `.corrupt-<time>` instead of being overwritten, so nothing is lost silently.
 */

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Windows can refuse a rename for a moment while antivirus or an indexer holds the file.
 * The defaults wait about 0.3 s in total; `retries` and `step` (ms, growing linearly) stretch that.
 */
export function renameWithRetry(from, to, { retries = 5, step = 20 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (attempt >= retries || !["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
      sleepSync(step * (attempt + 1));
    }
  }
}

function parseFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * The saved value. Throws when there is none (missing, or corrupt with no good
 * backup), so callers keep their existing "fall back to defaults" catch.
 */
export function readJsonFile(file) {
  try {
    return parseFile(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      // A crash between writing the backup and the rename can leave only the backup.
      if (fs.existsSync(`${file}.bak`)) return parseFile(`${file}.bak`);
      throw error;
    }
    let backup;
    try {
      backup = parseFile(`${file}.bak`);
    } catch {
      backup = undefined;
    }
    try {
      renameWithRetry(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      // Leave it in place; the next write replaces it either way.
    }
    if (backup !== undefined) {
      console.warn(`[HEISS] ${path.basename(file)} was unreadable; restored the previous copy.`);
      return backup;
    }
    console.warn(`[HEISS] ${path.basename(file)} was unreadable and had no backup; it was set aside.`);
    throw error;
  }
}

export function writeJsonFile(file, value, { mode } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  const text = JSON.stringify(value, null, 2);
  const handle = fs.openSync(temporary, "w", mode);
  try {
    fs.writeSync(handle, text);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  if (fs.existsSync(file)) {
    // Every file here is only ever written this way, so the current one is whole.
    // Copying (not parsing) keeps this cheap for a large gallery saved often.
    try {
      fs.copyFileSync(file, `${file}.bak`);
      if (mode !== undefined) fs.chmodSync(`${file}.bak`, mode);
    } catch {
      // Keep the older backup.
    }
  }
  renameWithRetry(temporary, file);
}

/** Deleting on purpose must take the backup too, or the next read would bring the file back. */
export function removeJsonFile(file) {
  for (const target of [file, `${file}.bak`]) fs.rmSync(target, { force: true });
}

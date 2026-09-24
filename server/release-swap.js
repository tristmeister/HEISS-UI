/**
 * Swapping a downloaded release into place, and back out if it will not start.
 *
 * Everything lives in <install>/.update/:
 *   pending.json   the release the server downloaded, verified and unpacked
 *   staged/<name>  that release, unpacked
 *   backup/        the previous version, kept until the next update
 *   applied.json   what the last swap did, so a failed start can undo it
 *   result.json    how the last update ended, for Settings to report once
 *
 * The swap runs in scripts/start.mjs before the server loads, so no file of
 * the app is in use (Windows refuses to replace a loaded native module).
 * It only moves the app's own top-level entries; the user's data folder,
 * .env, node_modules and anything else in the folder stay where they are.
 *
 * No dependencies: this runs before the runtime packages are checked.
 */
import fs from "node:fs";
import path from "node:path";

/** Exit code the server uses to ask the supervisor for a restart. */
export const RESTART_CODE = 75;

/** Never moved, whatever a release lists. */
const KEEP = new Set(["data", ".env", "node_modules", ".update", ".git"]);

/** What releases before the manifest shipped at their top level. */
const LEGACY_ENTRIES = ["dist", "server", "workflows", "scripts", "package.json", "package-lock.json", "release.json", ".env.example", "README.md", "CHANGELOG.md", "LICENSE", "Start HEISS UI.command", "Start HEISS UI.bat"];

export const updateDir = (root) => path.join(root, ".update");
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/** The app's own top-level entries in an install or unpacked release. */
export function appEntries(dir) {
  const manifest = readJson(path.join(dir, "release.json"));
  const listed = Array.isArray(manifest?.files) && manifest.files.length ? manifest.files : LEGACY_ENTRIES;
  return listed.map(String).filter((name) => name && !KEEP.has(name) && !name.includes("/") && !name.includes("\\") && name !== ".." && name !== ".");
}

export function readPending(root) {
  const pending = readJson(path.join(updateDir(root), "pending.json"));
  if (!pending?.version || !pending?.dir) return null;
  const dir = path.resolve(updateDir(root), pending.dir);
  // Only ever swap in something that sits inside .update/staged.
  const staged = path.join(updateDir(root), "staged");
  if ((dir !== staged && !dir.startsWith(staged + path.sep)) || !fs.existsSync(dir)) return null;
  return { ...pending, dir };
}

export function writePending(root, pending) {
  fs.mkdirSync(updateDir(root), { recursive: true });
  writeJson(path.join(updateDir(root), "pending.json"), { ...pending, dir: path.relative(updateDir(root), pending.dir) });
}

export function writeResult(root, result) {
  fs.mkdirSync(updateDir(root), { recursive: true });
  writeJson(path.join(updateDir(root), "result.json"), { ...result, at: Date.now() });
}

/** How the last update ended; read once, then forgotten. */
export function takeResult(root) {
  const file = path.join(updateDir(root), "result.json");
  const result = readJson(file);
  fs.rmSync(file, { force: true });
  return result;
}

/** Checks an unpacked release looks whole before anything is moved. */
export function checkStaged(dir, version) {
  const manifest = readJson(path.join(dir, "release.json"));
  if (!manifest) return "The download has no release.json.";
  if (version && manifest.version !== version) return `The download says it is ${manifest.version}, not ${version}.`;
  for (const file of ["package.json", "server/index.js", "dist/index.html", "scripts/start.mjs"]) {
    if (!fs.existsSync(path.join(dir, file))) return `The download is missing ${file}.`;
  }
  return "";
}

const fileText = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };

/**
 * Moves the pending release into place and the current one into .update/backup.
 * Returns what changed, or null when nothing was pending. Throws only after
 * putting the old version back.
 */
export function applyPending(root, log = () => {}) {
  const pending = readPending(root);
  if (!pending) return null;
  const dir = updateDir(root);
  const from = readJson(path.join(root, "release.json"))?.version || "";
  const problem = checkStaged(pending.dir, pending.version);
  if (problem) {
    clearStaging(root);
    writeResult(root, { ok: false, from, to: pending.version, error: problem });
    log(`Skipped the update to ${pending.version}: ${problem}`);
    return null;
  }

  const backup = path.join(dir, "backup");
  fs.rmSync(backup, { recursive: true, force: true });
  fs.mkdirSync(backup, { recursive: true });
  const lockBefore = fileText(path.join(root, "package-lock.json"));
  const incoming = appEntries(pending.dir);
  const outgoing = [...new Set([...appEntries(root), ...incoming])];
  const moved = [];
  const placed = [];
  try {
    for (const name of outgoing) {
      if (!fs.existsSync(path.join(root, name))) continue;
      fs.renameSync(path.join(root, name), path.join(backup, name));
      moved.push(name);
    }
    for (const name of incoming) {
      if (!fs.existsSync(path.join(pending.dir, name))) continue;
      fs.renameSync(path.join(pending.dir, name), path.join(root, name));
      placed.push(name);
    }
  } catch (error) {
    // Put everything back exactly as it was.
    for (const name of placed) fs.rmSync(path.join(root, name), { recursive: true, force: true });
    for (const name of moved) fs.renameSync(path.join(backup, name), path.join(root, name));
    clearStaging(root);
    writeResult(root, { ok: false, from, to: pending.version, error: `Could not swap the files in: ${error.message}` });
    throw error;
  }

  const applied = { from, to: pending.version, moved, placed, lockChanged: fileText(path.join(root, "package-lock.json")) !== lockBefore };
  writeJson(path.join(dir, "applied.json"), applied);
  clearStaging(root);
  log(`Updated HEISS UI ${from || "?"} → ${pending.version}`);
  return applied;
}

/** Puts the backed-up version back after an update that would not start. */
export function rollback(root, reason, log = () => {}) {
  const dir = updateDir(root);
  const applied = readJson(path.join(dir, "applied.json"));
  const backup = path.join(dir, "backup");
  if (!applied || !fs.existsSync(backup)) return false;
  const failed = path.join(dir, "failed");
  fs.rmSync(failed, { recursive: true, force: true });
  fs.mkdirSync(failed, { recursive: true });
  for (const name of applied.placed || []) {
    if (fs.existsSync(path.join(root, name))) fs.renameSync(path.join(root, name), path.join(failed, name));
  }
  for (const name of applied.moved || []) {
    if (fs.existsSync(path.join(backup, name))) fs.renameSync(path.join(backup, name), path.join(root, name));
  }
  fs.rmSync(path.join(dir, "applied.json"), { force: true });
  writeResult(root, { ok: false, rolledBack: true, from: applied.from, to: applied.to, error: reason });
  log(`HEISS UI ${applied.to} did not start (${reason}). Went back to ${applied.from || "the previous version"}.`);
  return true;
}

/** The new version started: the update is done. The backup stays until the next one. */
export function confirmApplied(root) {
  const file = path.join(updateDir(root), "applied.json");
  const applied = readJson(file);
  if (!applied) return;
  fs.rmSync(file, { force: true });
  fs.rmSync(path.join(updateDir(root), "failed"), { recursive: true, force: true });
  writeResult(root, { ok: true, from: applied.from, to: applied.to });
}

export function clearStaging(root) {
  fs.rmSync(path.join(updateDir(root), "staged"), { recursive: true, force: true });
  fs.rmSync(path.join(updateDir(root), "pending.json"), { force: true });
}

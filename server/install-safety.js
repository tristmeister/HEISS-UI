/**
 * The safety net under node pack installs: quiet until something breaks.
 *
 * Before an install, a snapshot (a few KB): ComfyUI's Python packages, every
 * custom_nodes folder with its git commit, the packs and node types ComfyUI
 * had loaded. After the restart, a health check against it: a pack that loaded
 * before and fails now, node types that disappeared, or ComfyUI not coming
 * back at all. Undo removes what the install added and puts changed packages
 * back to their snapshot versions.
 *
 * What it can't undo: a pack's own install script or anything it compiled.
 * Copying the whole Python environment would cover that, at gigabytes a time.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dataDir } from "./gallery-store.js";
import { comfyPython, comfyRootDir, pipArgs, pythonEnv } from "./node-install.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";

const keep = 12;
const snapshotsDir = () => path.join(dataDir, "install-snapshots");

function runQuiet(command, args, { cwd, env, timeout = 10 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...(env || process.env), PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }, windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err = (err + chunk).slice(-4000); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(err.trim().split("\n").pop() || `exit ${code}`)); });
  });
}

/** A folder's git commit, read from .git without running git. "" when it isn't a checkout. */
export function gitHead(folder) {
  try {
    const gitDir = path.join(folder, ".git");
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (!head.startsWith("ref:")) return head;
    const ref = head.slice(4).trim();
    const loose = path.join(gitDir, ref);
    if (fs.existsSync(loose)) return fs.readFileSync(loose, "utf8").trim();
    const packed = fs.readFileSync(path.join(gitDir, "packed-refs"), "utf8");
    return packed.split("\n").find((line) => line.endsWith(` ${ref}`))?.split(" ")[0] || "";
  } catch {
    return "";
  }
}

export function customNodeFolders(root = comfyRootDir()) {
  const dir = root ? path.join(root, "custom_nodes") : "";
  if (!dir || !fs.existsSync(dir)) return {};
  const folders = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "__pycache__") continue;
    folders[entry.name] = gitHead(path.join(dir, entry.name));
  }
  return folders;
}

/** "name==version" lines as { name: version }, names normalized the way pip compares them. */
export function parseFreeze(text = "") {
  const packages = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z0-9._-]+)==([^\s;]+)/);
    if (match) packages[match[1].toLowerCase().replace(/[_.]+/g, "-")] = match[2];
  }
  return packages;
}

/**
 * What to run to put packages back: the ones the install added go, the ones it
 * changed or removed return to their old version.
 */
export function packageRestorePlan(before = {}, after = {}) {
  const uninstall = Object.keys(after).filter((name) => !(name in before)).sort();
  const reinstall = Object.entries(before).filter(([name, version]) => after[name] !== version).map(([name, version]) => `${name}==${version}`).sort();
  return { uninstall, reinstall };
}

async function pipFreeze(python) {
  return parseFreeze(await runQuiet(python, [...pipArgs(python), "list", "--format=freeze", "--disable-pip-version-check"], { env: pythonEnv(python), timeout: 120_000 }));
}

/**
 * Takes a snapshot before an install. `loaded`: pack folders ComfyUI has
 * loaded; `nodeTypes`: the node types it offers. Works without local access
 * too (ComfyUI on another computer): then only what ComfyUI reports is kept.
 */
export async function takeInstallSnapshot({ reason = "", packs = [], loaded = [], nodeTypes = [] } = {}) {
  const root = comfyRootDir();
  const python = root ? comfyPython(root) : "";
  let packages = null;
  if (python) {
    try {
      packages = await pipFreeze(python);
    } catch {
      packages = null;
    }
  }
  const snapshot = {
    id: `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 6)}`,
    at: new Date().toISOString(),
    reason,
    packs: packs.map((pack) => ({ key: pack.key, name: pack.name, folder: pack.folder || "" })),
    folders: customNodeFolders(root),
    packages,
    loaded: [...loaded],
    nodeTypes: [...nodeTypes],
    added: [],
    status: "pending"
  };
  saveInstallSnapshot(snapshot);
  return snapshot;
}

export function saveInstallSnapshot(snapshot) {
  fs.mkdirSync(snapshotsDir(), { recursive: true });
  writeJsonFile(path.join(snapshotsDir(), `${snapshot.id}.json`), snapshot);
  // Only the latest few are kept.
  const files = fs.readdirSync(snapshotsDir()).filter((name) => name.endsWith(".json")).sort();
  for (const old of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(snapshotsDir(), old), { force: true });
}

export function installSnapshot(id) {
  if (!/^[\w-]+$/.test(String(id || ""))) return null;
  try {
    return readJsonFile(path.join(snapshotsDir(), `${id}.json`));
  } catch {
    return null;
  }
}

/** Install history, newest first, without the bulky package lists. */
export function installHistory() {
  if (!fs.existsSync(snapshotsDir())) return [];
  return fs.readdirSync(snapshotsDir()).filter((name) => name.endsWith(".json")).sort().reverse().map((name) => {
    try {
      const { packages, nodeTypes, folders, ...rest } = readJsonFile(path.join(snapshotsDir(), name));
      return { ...rest, canUndo: rest.status !== "undone" && Boolean(rest.added?.length || packages) };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/** After the install: which folders are new since the snapshot. */
export function recordAddedFolders(snapshot, root = comfyRootDir()) {
  const now = customNodeFolders(root);
  snapshot.added = Object.keys(now).filter((name) => !(name in (snapshot.folders || {})));
  return snapshot.added;
}

/**
 * The health check after the restart. A regression: a pack that loaded before
 * the install and doesn't now (failed or gone), or node types ComfyUI offered
 * before and doesn't now. New packs failing to load are reported apart: they
 * cost nothing else, the workflow just won't run.
 */
export function installHealth(snapshot, { loaded = null, nodeTypes = null, failed = [], comfyBack = true } = {}) {
  if (!comfyBack) return { ok: false, comfyDown: true, broke: [], lostNodes: [], newFailed: [] };
  const before = new Set(snapshot.loaded || []);
  const now = new Set(loaded || []);
  const added = new Set(snapshot.added || []);
  const broke = loaded ? [...before].filter((pack) => !now.has(pack) || failed.includes(pack)) : failed.filter((pack) => before.has(pack));
  const lostNodes = nodeTypes ? (snapshot.nodeTypes || []).filter((type) => !nodeTypes.includes(type)) : [];
  const newFailed = failed.filter((pack) => added.has(pack) || !before.has(pack));
  return { ok: broke.length === 0 && lostNodes.length === 0, comfyDown: false, broke, lostNodes: lostNodes.slice(0, 40), newFailed };
}

/**
 * Undoes an install: deletes the folders it added (only those, and only inside
 * custom_nodes) and restores the Python packages it changed.
 */
export async function undoInstall(snapshot, root = comfyRootDir()) {
  const done = { removed: [], uninstalled: [], reinstalled: [], problems: [] };
  const base = root ? path.join(root, "custom_nodes") : "";
  if (!base || !fs.existsSync(base)) throw new Error("ComfyUI isn’t on this computer, so HEISS can’t undo the install from here. Remove the new folders in custom_nodes yourself.");
  for (const folder of snapshot.added || []) {
    const target = path.resolve(base, folder);
    if (path.dirname(target) !== path.resolve(base) || folder in (snapshot.folders || {})) continue;
    try {
      fs.rmSync(target, { recursive: true, force: true });
      done.removed.push(folder);
    } catch (error) {
      done.problems.push(`${folder}: ${error.message}`);
    }
  }
  const python = comfyPython(root);
  if (python && snapshot.packages) {
    try {
      const plan = packageRestorePlan(snapshot.packages, await pipFreeze(python));
      if (plan.uninstall.length) {
        await runQuiet(python, [...pipArgs(python), "uninstall", "-y", ...plan.uninstall, "--disable-pip-version-check"], { env: pythonEnv(python) });
        done.uninstalled = plan.uninstall;
      }
      if (plan.reinstall.length) {
        await runQuiet(python, [...pipArgs(python), "install", "--no-deps", ...plan.reinstall, "--disable-pip-version-check"], { env: pythonEnv(python) });
        done.reinstalled = plan.reinstall;
      }
    } catch (error) {
      done.problems.push(`Python packages: ${error.message}`);
    }
  }
  snapshot.status = "undone";
  snapshot.undone = { at: new Date().toISOString(), ...done };
  saveInstallSnapshot(snapshot);
  return done;
}

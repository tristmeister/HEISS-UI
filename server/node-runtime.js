/**
 * The Node.js a download brings along, in runtime/<folder>/ next to the app,
 * with runtime/current.txt naming the one the launcher starts. Windows,
 * macOS (Apple Silicon) and Linux (x64) downloads all carry one; the folder
 * is Node's own, as its official archive unpacks: node.exe at the top on
 * Windows, bin/node elsewhere.
 *
 * A release says which Node it wants (release.json `node`). When an update
 * wants a newer one, the updater fetches Node's official archive for this
 * system, checks it against nodejs.org's SHASUMS256.txt and unpacks it into a
 * folder of its own: the running node cannot be replaced (Windows) and should
 * not be (elsewhere), so versions sit side by side. current.txt only moves once
 * the updated app has started, and folders nobody points at are removed on a
 * later start.
 *
 * Copies without runtime/current.txt (older macOS and Linux downloads, a
 * system Node, a Git checkout) are left alone: they use whatever Node started them.
 */
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const distUrl = process.env.HEISS_NODE_DIST || "https://nodejs.org/dist";

export const runtimeDir = (root) => path.join(root, "runtime");
const currentFile = (root) => path.join(runtimeDir(root), "current.txt");

// Node names its archives after the system: win, darwin, linux.
const systemNames = { win32: "win", darwin: "darwin", linux: "linux" };
const folderPattern = /^node-v(\d+\.\d+\.\d+)-(win|darwin|linux)-([a-z0-9]+)$/;

/** The folder Node's official archive for this system unpacks to, which is also ours. */
export const runtimeFolder = (version, arch = process.arch, platform = process.platform) =>
  `node-v${String(version).replace(/^v/, "")}-${systemNames[platform] || "linux"}-${arch}`;

/** What a runtime folder name says: its version, system and architecture. Null for anything else. */
export function runtimeParts(folder = "") {
  const match = String(folder).match(folderPattern);
  return match ? { version: match[1], system: match[2], arch: match[3] } : null;
}

/** Node's archive for a runtime folder: a zip on Windows, a gzipped tarball elsewhere. */
export const runtimeArchive = (folder) => `${folder}${runtimeParts(folder)?.system === "win" ? ".zip" : ".tar.gz"}`;

/** Where the node executable sits inside a runtime folder. */
export const runtimeBinary = (folder) => (runtimeParts(folder)?.system === "win" ? "node.exe" : path.join("bin", "node"));

/** The runtime folder the launcher starts, or "" for a copy without a bundled Node. */
export function currentRuntime(root) {
  try {
    const name = fs.readFileSync(currentFile(root), "utf8").trim();
    return runtimeParts(name) ? name : "";
  } catch {
    return "";
  }
}

/** Whether an update wanting `version` needs a new runtime fetched. */
export function needsRuntime(root, version, platform = process.platform) {
  const current = currentRuntime(root);
  const parts = runtimeParts(current);
  // Only a copy that brought its own Node, for this system, gets a new one.
  if (!version || !parts || parts.system !== systemNames[platform]) return false;
  return current !== runtimeFolder(version, parts.arch, platform);
}

/** Points the launcher at `folder` (written whole, then renamed). */
export function activateRuntime(root, folder) {
  if (!runtimeParts(folder) || !fs.existsSync(path.join(runtimeDir(root), folder, runtimeBinary(folder)))) return false;
  const temp = `${currentFile(root)}.tmp`;
  fs.writeFileSync(temp, folder);
  fs.renameSync(temp, currentFile(root));
  return true;
}

/** The runtime folder the running node belongs to, if it is one of ours. */
function runningRuntime(root, execPath = process.execPath) {
  const relative = path.relative(runtimeDir(root), execPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return relative.split(path.sep)[0];
}

/** Removes runtime folders nothing uses: not current, not the one running this process. */
export function pruneRuntimes(root, log = () => {}) {
  const current = currentRuntime(root);
  if (!current) return;
  const running = runningRuntime(root);
  let entries = [];
  try { entries = fs.readdirSync(runtimeDir(root)); } catch { return; }
  for (const name of entries) {
    if (!/^node-v/.test(name) || name === current || name === running) continue;
    try {
      fs.rmSync(path.join(runtimeDir(root), name), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      log(`Removed the old Node.js runtime ${name}`);
    } catch {
      // Still in use (another HEISS window); the next start tries again.
    }
  }
}

/** Node's published SHA-256 for one of its files. */
export async function publishedSha256(version, file) {
  const response = await fetch(`${distUrl}/v${version}/SHASUMS256.txt`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Couldn’t get the Node.js checksums (${response.status}).`);
  const line = (await response.text()).split(/\r?\n/).find((row) => row.trim().endsWith(`  ${file}`));
  const sum = line?.split(/\s+/)[0]?.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sum || "")) throw new Error(`Node.js publishes no checksum for ${file}.`);
  return sum;
}

/** Downloads a file while hashing it; throws when the hash does not match. */
export async function downloadVerified(url, file, sha256, onBytes = () => {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`The Node.js download failed (${response.status}).`);
  const hash = crypto.createHash("sha256");
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      onBytes(chunk.length, Number(response.headers.get("content-length")) || 0);
      callback(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(response.body), counter, fs.createWriteStream(file));
  if (hash.digest("hex") !== sha256) {
    fs.rmSync(file, { force: true });
    throw new Error("The Node.js download does not match its published checksum.");
  }
}

/** The tar that unpacks Node's archives here: Windows' own bsdtar reads zips too. */
export function tarCommand(platform = process.platform) {
  return platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
}

/**
 * Fetches Node `version` for this system into runtime/, beside the one in use.
 * Returns the folder name; does not switch to it (activateRuntime does).
 */
export async function fetchRuntime(root, version, onBytes) {
  const current = runtimeParts(currentRuntime(root));
  const folder = runtimeFolder(version, current?.arch || process.arch);
  const target = path.join(runtimeDir(root), folder);
  if (fs.existsSync(path.join(target, runtimeBinary(folder)))) return folder;
  const archive = runtimeArchive(folder);
  const sha256 = await publishedSha256(version, archive);
  const work = path.join(runtimeDir(root), `.fetch-${process.pid}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  try {
    const file = path.join(work, archive);
    await downloadVerified(`${distUrl}/v${version}/${archive}`, file, sha256, onBytes);
    await execFileAsync(tarCommand(), [archive.endsWith(".zip") ? "-xf" : "-xzf", file, "-C", work], { timeout: 300000, windowsHide: true });
    if (!fs.existsSync(path.join(work, folder, runtimeBinary(folder)))) throw new Error("The Node.js download did not contain node.");
    fs.renameSync(path.join(work, folder), target);
    return folder;
  } finally {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

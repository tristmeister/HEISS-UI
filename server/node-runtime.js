/**
 * The Node.js a Windows download brings along, in runtime/<folder>/ next to
 * the app, with runtime/current.txt naming the one the launcher starts.
 *
 * A release says which Node it wants (release.json `node`). When an update
 * wants a newer one, the updater fetches Node's official Windows zip, checks it
 * against nodejs.org's SHASUMS256.txt and unpacks it into a folder of its own:
 * the running node.exe cannot be replaced, so versions sit side by side.
 * current.txt only moves once the updated app has started, and folders nobody
 * points at are removed on a later start.
 *
 * Copies without runtime/current.txt (macOS, Linux, a system Node, a Git
 * checkout) are left alone: they use whatever Node started them.
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

/** The folder Node's official Windows zip unpacks to, which is also ours. */
export const runtimeFolder = (version, arch = process.arch) => `node-v${String(version).replace(/^v/, "")}-win-${arch}`;

/** The runtime folder the launcher starts, or "" for a copy without a bundled Node. */
export function currentRuntime(root) {
  try {
    const name = fs.readFileSync(currentFile(root), "utf8").trim();
    return /^node-v[\d.]+-win-[a-z0-9]+$/.test(name) ? name : "";
  } catch {
    return "";
  }
}

/** Whether an update wanting `version` needs a new runtime fetched. */
export function needsRuntime(root, version, platform = process.platform) {
  if (platform !== "win32" || !version) return false;
  const current = currentRuntime(root);
  return Boolean(current) && current !== runtimeFolder(version, runtimeArch(current));
}

/** The architecture a runtime folder was made for; a new Node matches it. */
const runtimeArch = (folder) => folder.split("-win-")[1] || process.arch;

/** Points the launcher at `folder` (written whole, then renamed). */
export function activateRuntime(root, folder) {
  if (!folder || !fs.existsSync(path.join(runtimeDir(root), folder, "node.exe"))) return false;
  const temp = `${currentFile(root)}.tmp`;
  fs.writeFileSync(temp, folder);
  fs.renameSync(temp, currentFile(root));
  return true;
}

/** Removes runtime folders nothing uses: not current, not the one running this process. */
export function pruneRuntimes(root, log = () => {}) {
  const current = currentRuntime(root);
  if (!current) return;
  const running = path.basename(path.dirname(process.execPath));
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
  if (!response.ok) throw new Error(`Could not fetch Node.js checksums (${response.status}).`);
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

/**
 * Fetches Node `version` for Windows into runtime/, beside the one in use.
 * Returns the folder name; does not switch to it (activateRuntime does).
 */
export async function fetchRuntime(root, version, onBytes) {
  const folder = runtimeFolder(version, runtimeArch(currentRuntime(root)));
  const target = path.join(runtimeDir(root), folder);
  if (fs.existsSync(path.join(target, "node.exe"))) return folder;
  const zipName = `${folder}.zip`;
  const sha256 = await publishedSha256(version, zipName);
  const work = path.join(runtimeDir(root), `.fetch-${process.pid}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  try {
    const zip = path.join(work, zipName);
    await downloadVerified(`${distUrl}/v${version}/${zipName}`, zip, sha256, onBytes);
    await execFileAsync("tar", ["-xf", zip, "-C", work], { timeout: 300000, windowsHide: true });
    if (!fs.existsSync(path.join(work, folder, "node.exe"))) throw new Error("The Node.js download did not contain node.exe.");
    fs.renameSync(path.join(work, folder), target);
    return folder;
  } finally {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

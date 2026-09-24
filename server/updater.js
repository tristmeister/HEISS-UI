/**
 * One-click updates for release copies (a folder unpacked from a GitHub
 * release, not a Git checkout).
 *
 * "Install update" downloads the new release zip in the background, checks it
 * against its published SHA-256, unpacks it into .update/staged and marks it
 * pending. The swap itself happens in scripts/start.mjs on the next start,
 * which the app triggers by asking the supervisor for a restart. See
 * release-swap.js for how the swap and the rollback work.
 */
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { RESTART_CODE, checkStaged, clearStaging, readPending, takeResult, updateDir, writePending } from "./release-swap.js";

const execFileAsync = promisify(execFile);
export const releasesUrl = "https://github.com/tristmeister/HEISS-UI/releases";
// HEISS_RELEASE_API points the updater at a test feed with the same shape.
const latestApi = process.env.HEISS_RELEASE_API || "https://api.github.com/repos/tristmeister/HEISS-UI/releases/latest";

/** Newer by dotted numbers: 0.10.0 beats 0.9.9. */
export function isNewer(candidate, current) {
  const [a, b] = [candidate, current].map((value) => String(value || "").replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0));
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0);
  }
  return false;
}

/** The zip and where its checksum comes from: a .sha256 asset, or GitHub's own digest. */
export function pickAsset(release) {
  const version = String(release?.tag_name || "").replace(/^v/, "");
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const zip = assets.find((asset) => asset.name === `heiss-ui-${version}.zip`) || assets.find((asset) => /^heiss-ui-.*\.zip$/.test(asset.name));
  if (!zip) return null;
  const sumAsset = assets.find((asset) => asset.name === `${zip.name}.sha256`);
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(String(zip.digest || ""))?.[1]?.toLowerCase() || "";
  return { version, name: zip.name, url: zip.browser_download_url, size: Number(zip.size || 0), sha256: digest, sumUrl: sumAsset?.browser_download_url || "" };
}

let state = { status: "idle" };
let running = null;
// How the last update ended (from the supervisor), kept for this whole run.
let lastResult = null;

// GitHub allows 60 unauthenticated requests an hour: ask at most every ten
// minutes unless someone presses Check for updates.
let cachedRelease = { at: 0, response: null };
async function latestRelease(fresh = false) {
  if (!fresh && cachedRelease.response && Date.now() - cachedRelease.at < 10 * 60 * 1000) return cachedRelease.response;
  const response = await fetch(latestApi, { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(15000) });
  // No release published yet counts as up to date, not as a failure.
  if (response.status === 404) return (cachedRelease = { at: Date.now(), response: { release: null } }).response;
  if (!response.ok) throw new Error(`GitHub answered ${response.status} when checking for a new release.`);
  return (cachedRelease = { at: Date.now(), response: { release: await response.json() } }).response;
}

const readVersion = (root) => { try { return JSON.parse(fs.readFileSync(path.join(root, "release.json"), "utf8")).version || ""; } catch { return ""; } };

/** What Settings shows for a release copy. */
export async function releaseStatus(root, { fresh = false } = {}) {
  const current = readVersion(root);
  const supervised = typeof process.send === "function";
  const result = lastResult ?? (lastResult = takeResult(root) || false);
  const base = { ok: true, release: true, current, branch: "release", supervised, result: result || undefined };
  const pending = readPending(root);
  if (pending && isNewer(pending.version, current)) {
    return { ...base, available: true, latest: pending.version, url: pending.notesUrl || releasesUrl, download: { status: "ready", version: pending.version } };
  }
  const { release } = await latestRelease(fresh && state.status === "idle");
  if (!release) return { ...base, available: false, latest: current, url: releasesUrl };
  const asset = pickAsset(release);
  const latest = asset?.version || String(release.tag_name || "").replace(/^v/, "");
  const available = Boolean(latest) && isNewer(latest, current);
  return {
    ...base,
    available,
    latest,
    url: release.html_url || releasesUrl,
    size: asset?.size || 0,
    canInstall: Boolean(available && asset && (asset.sha256 || asset.sumUrl)),
    download: state.status === "idle" ? undefined : { ...state }
  };
}

async function expectedSha256(asset) {
  if (asset.sumUrl) {
    const response = await fetch(asset.sumUrl, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Could not fetch the checksum (${response.status}).`);
    const sum = /\b([0-9a-f]{64})\b/i.exec(await response.text())?.[1]?.toLowerCase();
    if (sum) return sum;
  }
  if (asset.sha256) return asset.sha256;
  throw new Error("This release has no published checksum, so it cannot be installed automatically.");
}

/** Unzips with what the system already has: tar (Windows 10+, macOS), ditto, unzip, then PowerShell. */
async function unzip(zip, dest) {
  const attempts = process.platform === "win32"
    ? [["tar", ["-xf", zip, "-C", dest]], ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`]]]
    : process.platform === "darwin"
      ? [["ditto", ["-x", "-k", zip, dest]], ["tar", ["-xf", zip, "-C", dest]]]
      : [["unzip", ["-q", "-o", zip, "-d", dest]], ["bsdtar", ["-xf", zip, "-C", dest]], ["python3", ["-m", "zipfile", "-e", zip, dest]]];
  const errors = [];
  for (const [command, args] of attempts) {
    try {
      await execFileAsync(command, args, { timeout: 300000, windowsHide: true });
      return;
    } catch (error) {
      errors.push(`${command}: ${error.code === "ENOENT" ? "not installed" : (error.stderr || error.message).toString().trim().split("\n")[0]}`);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(dest, { recursive: true });
    }
  }
  throw new Error(`Could not unpack the download (${errors.join("; ")}).`);
}

async function download(root, asset, notesUrl) {
  const dir = updateDir(root);
  clearStaging(root);
  fs.mkdirSync(dir, { recursive: true });
  const zipPath = path.join(dir, asset.name);
  const staged = path.join(dir, "staged");
  try {
    const sha256 = await expectedSha256(asset);
    state = { status: "downloading", version: asset.version, receivedBytes: 0, totalBytes: asset.size };
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
    if (!response.ok || !response.body) throw new Error(`The download failed (${response.status}).`);
    state.totalBytes = Number(response.headers.get("content-length")) || asset.size;
    const hash = crypto.createHash("sha256");
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        state.receivedBytes += chunk.length;
        callback(null, chunk);
      }
    });
    await pipeline(Readable.fromWeb(response.body), counter, fs.createWriteStream(zipPath));

    state = { ...state, status: "verifying" };
    const actual = hash.digest("hex");
    if (actual !== sha256) throw new Error("The download does not match its published checksum. Nothing was changed; try again.");

    state = { ...state, status: "unpacking" };
    fs.mkdirSync(staged, { recursive: true });
    await unzip(zipPath, staged);
    const top = fs.readdirSync(staged).filter((name) => !name.startsWith("."));
    const unpacked = top.length === 1 ? path.join(staged, top[0]) : staged;
    const problem = checkStaged(unpacked, asset.version);
    if (problem) throw new Error(problem);

    writePending(root, { version: asset.version, dir: unpacked, notesUrl, sha256, downloadedAt: Date.now() });
    state = { status: "ready", version: asset.version };
  } catch (error) {
    clearStaging(root);
    state = { status: "error", version: asset.version, error: error.message };
  } finally {
    fs.rmSync(zipPath, { force: true });
    running = null;
  }
}

/** Starts the background download of the latest release. */
export async function startReleaseUpdate(root) {
  if (running) return { ...state };
  // Always the current answer: a cached one could name a release older than the one on offer.
  const { release } = await latestRelease(true);
  const asset = pickAsset(release);
  if (!asset) throw new Error("The latest release has no HEISS UI download.");
  if (!isNewer(asset.version, readVersion(root))) throw new Error("This copy is already up to date.");
  state = { status: "downloading", version: asset.version, receivedBytes: 0, totalBytes: asset.size };
  running = download(root, asset, release.html_url || releasesUrl);
  return { ...state };
}

/** Asks scripts/start.mjs to restart the server, which swaps in a pending update. */
export function requestRestart() {
  if (typeof process.send !== "function") return false;
  setTimeout(() => process.exit(RESTART_CODE), 250);
  return true;
}

import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { printBanner } from './banner.js';
import { releaseStatus, requestRestart, startReleaseUpdate } from './updater.js';
import { PORT_IN_USE_CODE } from './release-swap.js';
import { allowLanActions, demoMode, comfy, comfyRecentlyUnreachable, localOutputFile, comfyOutputDir, comfyUrl, host, isLocalClient, isTrustedClient, noteComfyFetchError, noteComfyReachable, normalizeComfyUrl, optionsFor, port, root, setComfyFolderPaths, setComfyOutputDir, setComfyUrl } from './comfy.js';
import { inferModels, mockModelResult, offlineModelResult } from './models.js';
import { primeModelMetadata, setModelChoice } from './model-families.js';
import { catalogDownload } from './family-profiles.js';
import { cancelDownload, discardDownload, downloadState, startDownload } from './model-downloads.js';
import { sanitizeGenerateBody } from './validation.js';
import { addGalleryItems, dedupeGallery, deleteGalleryFiles, filterVisibleGallery, gallery, galleryKey, galleryLimit, dataDir, hideGalleryItems, makePendingItems, migrateLegacyPrompts, recordsFromComfyHistory, removeGalleryItems, saveGallery, setGallery, cleanupGalleryState, updateGalleryJob, pageGallery, galleryDelta, galleryRevisionValue, sortGallery } from './gallery-store.js';
import { getThumbnail, resizeInMemory } from './thumbnails.js';
import { jobs, runJob, runMockJob, setTerminalJob } from './jobs.js';
import { deleteImportedWorkflow, saveImportedWorkflow, userWorkflowsDir } from './custom-workflows.js';
import { applyBundles, createBundles, DEFAULT_COOLDOWN_MINUTES, dissolveBundle, listBundles, pendingSummary, setBundleCover } from './gallery-bundles.js';
import { galleryStats } from './stats.js';
import { loadWorkflowPreferences, markWorkflowUsed, previewWorkflowImport, saveWorkflowPreferences, workflowSummaries } from './workflow-catalog.js';
import { saveStartImage } from './start-images.js';
import { addDevicePasskey, addPasskey, changePassword, issueChallenge, unlockWithDevicePasskey, clearUnlockCookie, encryptionKeyFromRequest, erasePrivacy, isPrivacyEnabled, passkeyUnlockOptions, privacyStatusFor, removePasskey, revealGalleryItemsForRequest, setupPrivacy, setUnlockCookie, unlockBackoffMs, unlockWithPasskey, unlockWithPassword } from './privacy.js';
import { compactVaultBundles, deleteVaultItems, dissolveVaultBundle, eraseVault, retireVault, exportVaultBackup, findVaultItem, hideItems, patchVaultItem, readVaultAsset, setVaultBundleCover, unhideItems, vaultAssetsForExport, vaultBundlePendingSummary, vaultConfigured, vaultItems, vaultRevision } from './vault.js';
import { forgetComfyRun } from './hidden-traces.js';
import { sendGalleryExport } from './gallery-export.js';
import { applyLoraOps, clearLoraState, loadLoraLibrary, loadLoraStack, saveLoraLibrary, saveLoraStack } from './lora-stacks.js';
import { deleteUploadedReference, listReferenceAssets, readMultipartImage, readUploadedReference, referenceAssetFromGallery, saveUploadedReference, stageReferenceAssets } from './reference-assets.js';
import { nodePack, nodePacks } from './node-packs.js';
import { beginComfyRestart, comfyRestarting, noteComfyRestart } from './comfy-restart.js';
import { comfyRootDir, packInstallPlan } from './node-install.js';
import { linkModelFolders, modelFolderReport, unlinkModelFolder } from './model-folders.js';
import { packInstallRoutes, packInstallState, startPackInstall } from './pack-installer.js';
import { cancelModelInstall, downloadPlan, installState, managerAvailable, managerInfo, nodeInstallPlan, normalizeQuality, startModelInstall, upscalePlan, upscaleStatus } from './upscale.js';
import { findUpscaleTarget, hiddenTarget, runUpscaleJob, toggleUpscaleView } from './upscale-jobs.js';
import { autoDetectOutputDir, detectOutputDirs, inspectOutputDir, pickFolder } from './output-folder.js';

const app = express();
app.use(express.json({ limit: "25mb" }));
const execFileAsync = promisify(execFile);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

/**
 * How to run npm with execFile. On Windows npm is a .cmd, which Node refuses to
 * run without a shell since the CVE-2024-27980 fix (EINVAL), so run npm's own
 * JavaScript entry with this Node instead: the one npm started us with, else the
 * one installed next to node.exe. A shell is the last resort.
 */
function npmInvocation(args) {
  if (process.platform !== "win32") return { command: npmCommand, args, shell: false };
  const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")];
  const script = candidates.find((file) => file && /\.[cm]?js$/i.test(file) && fs.existsSync(file));
  if (script) return { command: process.execPath, args: [script, ...args], shell: false };
  const quote = (arg) => (/^[\w.:=@/\\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`);
  return { command: npmCommand, args: args.map(quote), shell: true };
}
let comfyCache = { info: null, stats: null, fetchedAt: 0 };

async function loadComfyContext({ force = false } = {}) {
  const fresh = !force && comfyCache.info && Date.now() - comfyCache.fetchedAt < 30000;
  if (fresh) return comfyCache;
  const info = await comfy("/object_info");
  const stats = await comfy("/system_stats").catch(() => ({}));
  // Where ComfyUI keeps models, extra_model_paths.yaml included, so headers can be read there too.
  setComfyFolderPaths(await comfy("/internal/folder_paths").catch(() => ({})));
  // Model-type detection is synchronous; fetch what it needs from a remote ComfyUI first.
  await primeModelMetadata({
    unet: optionsFor(info, "UNETLoader", "unet_name"),
    checkpoint: optionsFor(info, "CheckpointLoaderSimple", "ckpt_name")
  }).catch(() => null);
  comfyCache = { info, stats, fetchedAt: Date.now() };
  return comfyCache;
}

function refreshComfyContextSoon() {
  setTimeout(() => loadComfyContext({ force: true }).catch(() => null), 0);
}

async function recoverGalleryFromHistory() {
  cleanupGalleryState(jobs);
  const history = await comfy(`/history?max_items=${Math.min(galleryLimit, 500)}`).catch(() => ({}));
  const recovered = recordsFromComfyHistory(history);
  if (!recovered.length) return;
  const pending = gallery.filter((item) => item.status === "pending");
  setGallery(dedupeGallery([...pending, ...gallery, ...recovered]).slice(0, galleryLimit));
}

function requireLocal(req, res) {
  const remote = req.socket.remoteAddress || "";
  if (isTrustedClient(remote)) return true;
  res.status(403).json({ ok: false, error: "This action is only allowed from this computer or trusted local network." });
  return false;
}

function requireTrustedAccess(req, res) {
  const remote = req.socket.remoteAddress || "";
  if (isLocalClient(remote) || isTrustedClient(remote)) return true;
  res.status(403).json({ ok: false, error: "This app is only available from this computer or trusted local network." });
  return false;
}

function requireLanUnlock(req, res, next) {
  if (!req.path.startsWith("/api") && !req.path.startsWith("/comfy")) return next();
  if (req.path.startsWith("/api/privacy")) return next();
  const remote = req.socket.remoteAddress || "";
  if (isLocalClient(remote)) return next();
  if (!allowLanActions || !isTrustedClient(remote)) {
    res.status(403).json({ ok: false, error: "This app is only available from this computer unless LAN mode is enabled." });
    return;
  }
  if (!isPrivacyEnabled()) {
    res.status(403).json({ ok: false, error: "Set up Hidden on this computer first. Other devices unlock with its password." });
    return;
  }
  if (!encryptionKeyFromRequest(req)) {
    res.status(401).json({ ok: false, locked: true, error: "Enter the Hidden password to continue." });
    return;
  }
  next();
}

app.use(requireLanUnlock);

async function runRepoCommand(command, args) {
  const npm = command === npmCommand ? npmInvocation(args) : { command, args, shell: false };
  const { stdout = "", stderr = "" } = await execFileAsync(npm.command, npm.args, {
    cwd: root,
    shell: npm.shell,
    timeout: 600000,
    maxBuffer: 1024 * 1024
  });
  return `${stdout}${stderr}`.trim();
}

async function updateStatus({ fresh = false } = {}) {
  if (!fs.existsSync(path.join(root, ".git"))) {
    if (fs.existsSync(path.join(root, "release.json"))) return releaseStatus(root, { fresh });
    return { ok: false, available: false, current: "", latest: "", branch: "", error: "This copy is not a Git checkout." };
  }
  const branch = (await runRepoCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const current = (await runRepoCommand("git", ["rev-parse", "--short", "HEAD"])).trim();
  await runRepoCommand("git", ["fetch", "--quiet", "origin"]);
  const upstreamRef = branch && branch !== "HEAD" ? `origin/${branch}` : "origin/main";
  const latest = (await runRepoCommand("git", ["rev-parse", "--short", upstreamRef])).trim();
  const behindText = await runRepoCommand("git", ["rev-list", "--count", `${current}..${upstreamRef}`]);
  const behind = Number(behindText.trim() || 0);
  return { ok: true, available: behind > 0, current, latest, branch, behind };
}

function openFolder(folder) {
  if (process.platform === "win32") return execFile("explorer.exe", [folder]);
  if (process.platform === "darwin") return execFile("open", [folder]);
  return execFile("xdg-open", [folder]);
}

/** What Hidden needs from this computer before it can keep anything: where ComfyUI saves. */
async function hiddenReadiness() {
  const outputDir = comfyOutputDir || await autoDetectOutputDir().catch(() => "");
  return { outputDir: Boolean(outputDir), outputPath: outputDir || "" };
}

async function privacyPayload(req, key = encryptionKeyFromRequest(req)) {
  const status = privacyStatusFor(req);
  const unlocked = Boolean(key);
  if (unlocked) migrateLegacyPrompts(key);
  return {
    ...status,
    unlocked,
    // Nothing about what Hidden holds is shared with a locked browser, not even whether it is empty.
    vault: { unlocked, revision: unlocked ? vaultRevision() : 0 },
    readiness: await hiddenReadiness(),
    // Another device on the network signs in with the Hidden password before it sees anything.
    remote: !isLocalClient(req.socket?.remoteAddress || "")
  };
}

app.get("/api/privacy/status", async (req, res) => {
  res.json(await privacyPayload(req));
});

app.get("/api/network", (req, res) => {
  if (!requireLocal(req, res)) return;
  // Named, so a VPN or Docker adapter is not mistaken for the Wi-Fi address.
  const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, entries]) => (entries || [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => ({ name, address: entry.address, likelyVirtual: /^(docker|br-|veth|vbox|vmnet|utun|tun|tap|wg|zt|tailscale)/i.test(name) })));
  interfaces.sort((a, b) => Number(a.likelyVirtual) - Number(b.likelyVirtual));
  // Only a server listening beyond this computer can be opened from a phone.
  const listening = host === "0.0.0.0" || host === "::" || !["127.0.0.1", "localhost", "::1"].includes(host);
  res.json({ addresses: interfaces.map((item) => item.address), interfaces, port, listening });
});

function sessionSeconds(req) {
  const value = Number(req.body?.sessionSeconds || 0);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Looking after the computer (model folders and downloads, node installs,
 * ComfyUI's address and restarts, the output folder, updates, workflow files,
 * the Hidden password) happens at that computer. Other devices on the network
 * are for making and looking at images; the app hides these there too.
 */
function requireAdmin(req, res) {
  if (isLocalClient(req.socket.remoteAddress || "")) return true;
  res.status(403).json({ ok: false, reason: "computer-only", error: "Do this on the computer HEISS UI runs on." });
  return false;
}

/** Creating or erasing Hidden happens at the computer it runs on, never from the network. */
function requireThisComputer(req, res) {
  if (isLocalClient(req.socket.remoteAddress || "")) return true;
  res.status(403).json({ ok: false, error: "Only the computer HEISS UI runs on can do this." });
  return false;
}

app.post("/api/privacy/setup", async (req, res) => {
  if (!requireThisComputer(req, res)) return;
  try {
    // Creating the password does not need ComfyUI; hiding images later does, to
    // remove its copies, and says so then.
    // A Hidden left without its key ring can never be opened again; keep it aside rather than build on it.
    if (!isPrivacyEnabled() && vaultConfigured()) retireVault();
    const key = setupPrivacy(req.body?.password || "");
    setUnlockCookie(res, key, sessionSeconds(req));
    res.json({ ok: true, ...(await privacyPayload(req, key)), enabled: true, unlocked: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

async function slowDownGuessing() {
  const wait = unlockBackoffMs();
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
}

app.post("/api/privacy/unlock", async (req, res) => {
  if (!requireTrustedAccess(req, res)) return;
  await slowDownGuessing();
  const key = unlockWithPassword(req.body?.password || "");
  if (!key) {
    res.status(401).json({ ok: false, locked: true, error: "That password is incorrect." });
    return;
  }
  setUnlockCookie(res, key, sessionSeconds(req));
  res.json({ ok: true, ...(await privacyPayload(req, key)), enabled: true, unlocked: true });
});

app.get("/api/privacy/passkeys/options", (req, res) => {
  if (!requireTrustedAccess(req, res)) return;
  res.json({ ok: true, passkeys: passkeyUnlockOptions(), challenge: issueChallenge() });
});

app.post("/api/privacy/passkeys/unlock", async (req, res) => {
  if (!requireTrustedAccess(req, res)) return;
  await slowDownGuessing();
  const key = req.body?.secret
    ? unlockWithDevicePasskey(req.body, String(req.headers.origin || ""))
    : unlockWithPasskey(String(req.body?.id || ""), String(req.body?.prf || ""));
  if (!key) {
    res.status(401).json({ ok: false, locked: true, error: "This passkey isn’t set up for Hidden. Use your password." });
    return;
  }
  setUnlockCookie(res, key, sessionSeconds(req));
  res.json({ ok: true, ...(await privacyPayload(req, key)), enabled: true, unlocked: true });
});

function requireHiddenKey(req, res) {
  const key = encryptionKeyFromRequest(req);
  if (!key) res.status(401).json({ ok: false, locked: true, error: "Hidden is locked." });
  return key;
}

app.post("/api/privacy/passkeys", async (req, res) => {
  if (!requireLocal(req, res)) return;
  const key = requireHiddenKey(req, res);
  if (!key) return;
  try {
    if (req.body?.mode === "device") {
      const { passkey, secret } = addDevicePasskey(key, req.body || {});
      res.json({ ok: true, passkey, secret, ...(await privacyPayload(req, key)) });
      return;
    }
    const passkey = addPasskey(key, req.body || {});
    res.json({ ok: true, passkey, ...(await privacyPayload(req, key)) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.delete("/api/privacy/passkeys/:id", async (req, res) => {
  if (!requireLocal(req, res)) return;
  const key = requireHiddenKey(req, res);
  if (!key) return;
  removePasskey(String(req.params.id || ""));
  res.json({ ok: true, ...(await privacyPayload(req, key)) });
});

app.post("/api/privacy/password", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const key = requireHiddenKey(req, res);
  if (!key) return;
  try {
    changePassword(key, req.body?.password || "");
    res.json({ ok: true, ...(await privacyPayload(req, key)) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/privacy/lock", (req, res) => {
  if (!requireTrustedAccess(req, res)) return;
  clearUnlockCookie(res);
  res.json({ ok: true, enabled: isPrivacyEnabled(), unlocked: false, passkeys: privacyStatusFor({ headers: {} }).passkeys, vault: { unlocked: false, revision: 0 } });
});

/** Forgot the password: the only way back is to start over, and everything in Hidden goes. */
app.post("/api/privacy/erase", (req, res) => {
  if (!requireThisComputer(req, res)) return;
  if (req.body?.confirm !== "erase") {
    res.status(400).json({ ok: false, error: "Confirm erasing Hidden first." });
    return;
  }
  // Runs still rendering would otherwise seal their results with a key that no longer exists.
  for (const [id, job] of jobs) {
    if (!job.privateVault || job.terminalAt) continue;
    jobs.set(id, { ...job, status: "canceling", vaultKey: null });
  }
  eraseVault();
  erasePrivacy();
  clearUnlockCookie(res);
  res.json({ ok: true, enabled: false, unlocked: false, passkeys: [], vault: { unlocked: false, revision: 0 } });
});

/* ---------------------------------------------------------------- Hidden */

function hiddenPage(req, key) {
  const type = String(req.query.type || "");
  const includeFailed = req.query.includeFailed !== "0";
  const bundlesEnabled = req.query.bundles !== "0";
  // Runs that ComfyUI is still rendering live in memory until they are sealed.
  const running = gallery.filter((item) => item.privateVault && item.status !== "canceled");
  const items = sortGallery([...running, ...vaultItems(key, { bundles: bundlesEnabled })]).filter((item) => {
    if (type && item.type !== type) return false;
    if (!includeFailed && item.status === "error") return false;
    return true;
  });
  return { items, revision: Math.max(vaultRevision(), running.length ? galleryRevisionValue() : 0), totalApprox: items.length, hasMore: false, nextCursor: "" };
}

app.get("/api/hidden/gallery", (req, res) => {
  const key = requireHiddenKey(req, res);
  if (!key) return;
  cleanupGalleryState(jobs);
  try {
    const page = hiddenPage(req, key);
    if (Number(req.query.since || 0) && Number(req.query.since) === page.revision) {
      res.json({ unchanged: true, revision: page.revision });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.json(page);
  } catch {
    res.status(500).json({ ok: false, error: "Could not open Hidden with this key." });
  }
});

app.post("/api/hidden/hide", async (req, res) => {
  if (!requireLocal(req, res)) return;
  const key = requireHiddenKey(req, res);
  if (!key) return;
  const ids = new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String));
  const items = filterVisibleGallery(gallery).filter((item) => item.status === "done" && (ids.has(item.id) || ids.has(item.url)));
  if (!items.length) {
    res.status(404).json({ ok: false, error: "Those images are no longer in the gallery." });
    return;
  }
  if (items.some((item) => item.upscale?.status === "running")) {
    res.status(409).json({ ok: false, error: "Wait for the upscale to finish, then hide it." });
    return;
  }
  try {
    const result = await hideItems(key, items);
    // A marker keeps them from coming back out of ComfyUI's history if a copy stayed behind.
    hideGalleryItems(result.movedFrom || []);
    removeGalleryItems(result.movedFrom || []);
    await forgetComfyRun({ promptIds: result.promptIds });
    res.json({ ok: true, moved: result.moved.length, ids: (result.movedFrom || []).map((item) => item.id), hiddenIds: result.moved.map((item) => item.id), failed: result.failed, leftBehind: result.leftBehind, revision: galleryRevisionValue() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/hidden/unhide", (req, res) => {
  if (!requireLocal(req, res)) return;
  const key = requireHiddenKey(req, res);
  if (!key) return;
  try {
    const restored = unhideItems(key, (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String));
    addGalleryItems(restored);
    res.json({ ok: true, restored: restored.length, revision: galleryRevisionValue() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/hidden/export", (req, res) => {
  const key = requireHiddenKey(req, res);
  if (!key) return;
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="heiss-ui-hidden-${date}.zip"`);
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  sendGalleryExport(res, vaultAssetsForExport(key), { gallery: false });
});

const appVersion = (() => {
  try { return JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version || ""; } catch { return ""; }
})();

/**
 * How far a source checkout is past its release tag, so About can tell
 * "v0.2.0" from "v0.2.0 + 3". Release copies have no git and are exactly
 * their version.
 */
let describeCache = { at: 0, value: null };
async function commitsSinceRelease() {
  if (Date.now() - describeCache.at < 60000) return describeCache.value;
  let value = null;
  try {
    const { stdout } = await execFileAsync("git", ["describe", "--tags", "--long", "--match", "v[0-9]*"], { cwd: root, timeout: 3000 });
    const match = stdout.trim().match(/^(v[\d.]+)-(\d+)-g[0-9a-f]+$/);
    if (match) value = { tag: match[1], commits: Number(match[2]) };
  } catch {
    // No git, or no release tag yet.
  }
  describeCache = { at: Date.now(), value };
  return value;
}

app.get("/api/stats", async (_req, res) => {
  const since = await commitsSinceRelease();
  res.json({ ok: true, version: appVersion, sinceRelease: since, stats: galleryStats(gallery) });
});

// When this server process started, so the app can tell a restart (e.g. after an update) happened.
const serverStartedAt = Date.now();

app.get("/api/health", async (req, res) => {
  try {
    const stats = await comfy("/system_stats");
    res.json({ ok: true, comfyUrl, stats, startedAt: serverStartedAt, thisComputer: isLocalClient(req.socket.remoteAddress || "") });
  } catch (error) {
    res.status(503).json({ ok: false, thisComputer: isLocalClient(req.socket.remoteAddress || ""), restarting: comfyRestarting(), error: comfyRestarting() ? "ComfyUI is restarting." : error.message, startedAt: serverStartedAt });
  }
});

app.get("/api/comfy/status", async (_req, res) => {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${comfyUrl}/system_stats`, { signal: controller.signal });
    noteComfyReachable();
    const latencyMs = Math.round(performance.now() - startedAt);
    if (!response.ok) {
      res.json({ connected: false, isMock: demoMode, url: comfyUrl, latencyMs, ...restartFields(false), error: `HTTP ${response.status}${demoMode ? " (Demo Mode Active)" : ""}` });
      return;
    }
    const stats = await response.json();
    const device = stats?.devices?.[0]?.name || "";
    res.json({
      ...restartFields(true),
      connected: true,
      url: comfyUrl,
      latencyMs,
      version: stats?.system?.comfyui_version || "",
      device
    });
  } catch (error) {
    // A timeout counts here too: this poll is the app asking whether ComfyUI is there.
    noteComfyFetchError(error?.name === "AbortError" ? new Error("timed out") : error);
    const latencyMs = Math.round(performance.now() - startedAt);
    const message = error?.name === "AbortError" ? "Connection timed out" : error?.message || "Connection failed";
    res.json({ connected: false, isMock: demoMode, url: comfyUrl, latencyMs, ...restartFields(false), error: `${message}${demoMode ? " (Demo Mode Active)" : ""}` });
  } finally {
    clearTimeout(timeout);
  }
});

/** A restart HEISS asked for, as the status poll reports it: restarting, and since when. */
function restartFields(connected) {
  const restart = noteComfyRestart(connected);
  return restart?.phase === "restarting" ? { restarting: true, restartStartedAt: restart.startedAt } : restart?.phase === "failed" ? { restartFailed: true } : {};
}

/** What to say when ComfyUI does not answer: restarting on purpose, or simply not there. */
function comfyDownMessage(detail = "") {
  if (comfyRestarting()) return "ComfyUI is restarting. Try again in a few seconds.";
  return `ComfyUI is not reachable at ${comfyUrl}. Start it, then try again.${detail ? ` (${detail})` : ""}`;
}

app.get("/api/models", async (_req, res) => {
  try {
    const { info, stats } = await loadComfyContext({ force: true });
    res.json(inferModels(info, stats));
  } catch {
    res.json(demoMode ? mockModelResult() : offlineModelResult(comfyUrl));
  }
});

app.put("/api/models/types", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    setModelChoice(req.body?.source, req.body?.name, req.body?.type);
    const { info, stats } = await loadComfyContext();
    res.json(inferModels(info, stats));
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/models/downloads", (_req, res) => {
  res.json({ ok: true, ...downloadState() });
});

// Fetches a missing text encoder or VAE. Only ids from HEISS's own catalog are
// accepted, so the server never downloads from a URL a request supplies.
app.post("/api/models/downloads", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const spec = catalogDownload(req.body?.id);
  if (!spec) {
    res.status(400).json({ ok: false, error: "Unknown file." });
    return;
  }
  try {
    const download = startDownload(spec);
    // Already on disk: rescan now so the model page catches up without another click.
    if (download?.already) await loadComfyContext({ force: true }).catch(() => null);
    res.json({ ok: true, download, ...downloadState() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/models/downloads/cancel", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = String(req.body?.id || "");
  const spec = req.body?.discard ? catalogDownload(id) : null;
  if (spec) discardDownload(spec);
  else cancelDownload(id);
  res.json({ ok: true, ...downloadState() });
});

app.get("/api/paths", async (_req, res) => {
  await autoDetectOutputDir();
  res.json({ outputDir: comfyOutputDir, galleryDir: dataDir, workflowsDir: userWorkflowsDir });
});

app.post("/api/config/output-dir", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const outputDir = setComfyOutputDir(req.body?.outputDir || "");
    res.json({ ok: true, outputDir, galleryDir: dataDir, workflowsDir: userWorkflowsDir, report: await inspectOutputDir(outputDir) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/output-dir", async (req, res) => {
  if (!requireLocal(req, res)) return;
  await autoDetectOutputDir();
  res.json({ outputDir: comfyOutputDir, report: await inspectOutputDir(comfyOutputDir), canBrowse: isLocalClient(req.socket.remoteAddress || "") });
});

app.post("/api/output-dir/check", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json(await inspectOutputDir(req.body?.outputDir || ""));
});

app.get("/api/output-dir/detect", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ candidates: await detectOutputDirs() });
});

app.post("/api/output-dir/browse", async (req, res) => {
  // The picker opens on this machine's screen, so only its own browser may ask.
  if (!isLocalClient(req.socket.remoteAddress || "")) {
    res.status(403).json({ ok: false, error: "The folder picker only opens on the computer running HEISS UI." });
    return;
  }
  try {
    const picked = await pickFolder(req.body?.start || comfyOutputDir);
    res.json(picked ? { ok: true, path: picked, report: await inspectOutputDir(picked) } : { ok: true, canceled: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/workflows", async (_req, res) => {
  try {
    const { info, stats } = await loadComfyContext().catch(() => ({ info: {}, stats: {} }));
    const models = Object.keys(info || {}).length ? inferModels(info, stats) : demoMode ? mockModelResult() : offlineModelResult(comfyUrl);
    const preferences = loadWorkflowPreferences();
    res.json({ workflows: workflowSummaries({ info, profiles: models.profiles, preferences }), preferences });
  } catch {
    const models = demoMode ? mockModelResult() : offlineModelResult(comfyUrl);
    const preferences = loadWorkflowPreferences();
    res.json({ workflows: workflowSummaries({ info: {}, profiles: models.profiles, preferences }), preferences });
  }
});

app.put("/api/workflows/preferences", (req, res) => {
  if (!requireLocal(req, res)) return;
  try {
    const current = loadWorkflowPreferences();
    const favorites = Array.isArray(req.body?.favorites) ? req.body.favorites.map(String) : current.favorites;
    const preferences = {
      favorites,
      lastUsed: { ...current.lastUsed, ...(req.body?.lastUsed || {}) },
      thumbnails: { ...current.thumbnails, ...(req.body?.thumbnails || {}) }
    };
    saveWorkflowPreferences(preferences);
    res.json({ ok: true, preferences });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/workflows/import/preview", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const raw = req.body?.workflow || req.body;
    const { info } = await loadComfyContext().catch(() => ({ info: {} }));
    res.json({ ok: true, preview: previewWorkflowImport(raw, req.body?.filename || "", info) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/workflows/import", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const raw = req.body?.workflow || req.body;
    const { info } = await loadComfyContext().catch(() => ({ info: {} }));
    const normalized = (Array.isArray(raw?.nodes) && Array.isArray(raw?.links)) || raw?.prompt
      ? { graph: previewWorkflowImport(raw, req.body?.filename || "", info).graph, heissUi: req.body?.metadata || {} }
      : raw;
    const workflow = saveImportedWorkflow(normalized, req.body?.metadata || {});
    const { graph, ...summary } = workflow;
    res.json({ ok: true, workflow: summary });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

function bundleOptions(source = {}) {
  return {
    mode: source.mode === "job" ? "job" : "smart",
    cooldownMinutes: Math.max(0, Math.min(1440, Number(source.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES)))
  };
}

function bundleSourceItems() {
  // Hidden items group only with each other, inside Hidden.
  return revealGalleryItemsForRequest(filterVisibleGallery(gallery).filter((item) => item.status !== "canceled"));
}

app.get("/api/gallery/bundles", (req, res) => {
  const options = bundleOptions(req.query);
  res.json({ bundles: listBundles(), pending: pendingSummary(bundleSourceItems(req), options), ...options });
});

app.post("/api/gallery/bundles/compact", (req, res) => {
  if (!requireLocal(req, res)) return;
  const options = bundleOptions(req.body || {});
  const created = createBundles(bundleSourceItems(req), options);
  res.json({
    ok: true,
    created: created.length,
    items: created.reduce((total, bundle) => total + bundle.itemIds.length, 0),
    // The browser plays the settle animation on just these, so scrolling an
    // existing stack back into view does not replay it.
    ids: created.map((bundle) => bundle.id)
  });
});

function vaultBundleOptions(source = {}) {
  return {
    mode: source.mode === "job" ? "job" : "smart",
    cooldownMinutes: Math.max(0, Math.min(1440, Number(source.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES)))
  };
}

app.get("/api/vault/bundles", (req, res) => {
  // Locked means no info at all - not even a run count - so there is nothing
  // else to compute here without the key.
  const result = vaultBundlePendingSummary(req, vaultBundleOptions(req.query));
  if (result.locked) return res.json({ locked: true, pending: { runs: 0, items: 0, itemIds: [] } });
  res.json({ locked: false, pending: result.pending, ...vaultBundleOptions(req.query) });
});

app.post("/api/vault/bundles/compact", (req, res) => {
  if (!requireLocal(req, res)) return;
  try {
    res.json({ ok: true, ...compactVaultBundles(req, vaultBundleOptions(req.body || {})) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/vault/bundles/:id/cover", (req, res) => {
  if (!requireLocal(req, res)) return;
  try {
    res.json(setVaultBundleCover(req, String(req.params.id), String(req.body?.itemId || "")));
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.delete("/api/vault/bundles/:id", (req, res) => {
  if (!requireLocal(req, res)) return;
  try {
    res.json(dissolveVaultBundle(req, String(req.params.id)));
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/gallery/bundles/:id/cover", (req, res) => {
  if (!requireLocal(req, res)) return;
  try {
    res.json(setBundleCover(String(req.params.id), String(req.body?.itemId || "")));
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.delete("/api/gallery/bundles/:id", (req, res) => {
  if (!requireLocal(req, res)) return;
  try {
    res.json(dissolveBundle(String(req.params.id)));
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.delete("/api/workflows/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = deleteImportedWorkflow(decodeURIComponent(req.params.id).replace(/^custom:/, ""));
    const preferences = loadWorkflowPreferences();
    preferences.favorites = preferences.favorites.filter((id) => id !== `custom:${result.id}` && id !== result.id);
    delete preferences.lastUsed[`custom:${result.id}`];
    delete preferences.thumbnails[`custom:${result.id}`];
    saveWorkflowPreferences(preferences);
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

/** The gallery with its runs collapsed; a run can straddle a page, so it collapses first. */
function bundledPage(req) {
  const type = String(req.query.type || "");
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
  const cursor = String(req.query.cursor || "");
  const includeFailed = req.query.includeFailed !== "0";
  const merged = sortGallery(filterVisibleGallery(gallery)).filter((item) => {
    if (type && item.type !== type) return false;
    if (!includeFailed && item.status === "error") return false;
    return item.status !== "canceled";
  });
  const collapsed = applyBundles(merged, { enabled: req.query.bundles !== "0" });
  const start = cursor ? Math.max(0, collapsed.findIndex((item) => String(item.id) === cursor) + 1) : 0;
  const items = collapsed.slice(start, start + limit);
  const nextCursor = start + limit < collapsed.length ? String(items.at(-1)?.id || "") : "";
  return { items, nextCursor, hasMore: Boolean(nextCursor), revision: galleryRevisionValue(), totalApprox: collapsed.length };
}

app.get("/api/gallery", (req, res) => {
  cleanupGalleryState(jobs);
  const type = String(req.query.type || "");
  const limit = Number(req.query.limit || 0);
  const cursor = String(req.query.cursor || "");
  const includeFailed = req.query.includeFailed !== "0";
  const page = listBundles().length
    ? bundledPage(req)
    : pageGallery({ type, limit: limit || 200, cursor, includeFailed });
  res.json({
    ...page,
    items: revealGalleryItemsForRequest(page.items).map((item) => item.bundle
      ? { ...item, bundle: { ...item.bundle, items: revealGalleryItemsForRequest(item.bundle.items || []) } }
      : item),
    outputs: revealGalleryItemsForRequest(cursor || limit ? page.items : filterVisibleGallery(gallery))
  });
});

app.get("/api/gallery/delta", (req, res) => {
  const since = Number(req.query.since || 0);
  // Collapsed runs only come out of a full page, so with any run grouped the
  // browser reloads rather than patching tiles in and out of their stacks -
  // but only when something actually changed since its last page.
  if (listBundles().length) {
    const revision = galleryRevisionValue();
    res.json({ revision, reset: since !== revision, upserts: [], removes: [] });
    return;
  }
  const type = String(req.query.type || "");
  const includeFailed = req.query.includeFailed !== "0";
  const delta = galleryDelta({ since, type, includeFailed });
  res.json({ ...delta, upserts: revealGalleryItemsForRequest(delta.upserts || []) });
});

function hiddenDownloadName(asset, variant) {
  const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "video/mp4": ".mp4", "video/webm": ".webm" }[asset.mime] || "";
  const stem = String(asset.item.prompt || asset.name || "hidden").replace(/\s+/g, " ").trim().slice(0, 48).replace(/[^\w .-]+/g, "").trim() || "hidden";
  return `${stem}${variant === "upscale" ? " upscaled" : ""}${ext}`;
}

app.get("/api/vault/media/:id", (req, res) => {
  const variant = req.query.variant === "upscale" ? "upscale" : "original";
  const asset = readVaultAsset(req, req.params.id, variant);
  if (!asset) {
    res.status(404).json({ ok: false, error: "Hidden is locked, or this item is gone." });
    return;
  }
  res.setHeader("Content-Type", asset.mime || "application/octet-stream");
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  const name = encodeURIComponent(hiddenDownloadName(asset, variant));
  res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${name}`);
  res.send(asset.buffer);
});

app.get("/api/vault/thumbnail/:id", async (req, res) => {
  const asset = readVaultAsset(req, req.params.id, req.query.variant === "upscale" ? "upscale" : "original");
  if (!asset) {
    res.status(404).end();
    return;
  }
  // Resized in memory only, from the already-decrypted buffer this request holds —
  // never written to disk, so no plaintext derivative of a vault item persists.
  const resized = await resizeInMemory(asset.buffer, asset.mime);
  res.setHeader("Content-Type", resized ? "image/webp" : (asset.mime || "application/octet-stream"));
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.send(resized || asset.buffer);
});

app.get("/api/vault/export", (req, res) => {
  const backup = exportVaultBackup(encryptionKeyFromRequest(req));
  if (!backup) {
    res.status(401).json({ ok: false, error: "Unlock Hidden before backing it up." });
    return;
  }
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="heiss-ui-hidden-${new Date().toISOString().slice(0, 10)}.backup"`);
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.send(backup);
});

app.delete("/api/loras", (req, res) => {
  if (!requireLocal(req, res)) return;
  clearLoraState();
  res.json({ ok: true });
});

app.get("/api/loras/library", (_req, res) => {
  const library = loadLoraLibrary();
  res.json({ found: library !== null, library: library || { strengths: {}, snapshots: {} } });
});

app.put("/api/loras/library", (req, res) => {
  try {
    res.json({ ok: true, library: saveLoraLibrary(req.body?.library) });
  } catch (error) {
    res.status(500).json({ ok: false, error: `Could not save the LoRA library: ${error.message}` });
  }
});

// Clients send edits, not whole copies, so two devices never overwrite each other.
app.post("/api/loras/library/ops", (req, res) => {
  try {
    res.json({ ok: true, library: applyLoraOps(req.body?.ops) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/loras/:workflowId", (req, res) => {
  const loras = loadLoraStack(req.params.workflowId);
  res.json({ found: loras !== null, loras: loras || [] });
});

app.put("/api/loras/:workflowId", (req, res) => {
  try {
    res.json({ ok: true, loras: saveLoraStack(req.params.workflowId, req.body?.loras) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/gallery/export", (req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="heiss-ui-gallery-${date}.zip"`);
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  sendGalleryExport(res, []);
});

app.post("/api/gallery/recover", async (req, res) => {
  if (!requireLocal(req, res)) return;
  await recoverGalleryFromHistory();
  res.json({ ok: true, revision: galleryRevisionValue() });
});

app.post("/api/start-image", (req, res) => {
  if (!requireLocal(req, res)) return;
  try {
    const result = saveStartImage({ dataUrl: req.body?.dataUrl || req.body?.startImage || "", name: req.body?.name || req.body?.startImageName || "" });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/reference-assets", (req, res) => {
  try {
    res.json(listReferenceAssets(req, {
      source: req.query.source === "generation" ? "generation" : "upload",
      cursor: String(req.query.cursor || ""),
      limit: Number(req.query.limit || 60)
    }));
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/reference-assets/upload", async (req, res) => {
  if (!requireLocal(req, res)) return;
  try {
    const upload = await readMultipartImage(req);
    const asset = await saveUploadedReference(upload);
    res.status(201).json({ ok: true, asset });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/reference-assets/from-gallery", (req, res) => {
  if (!requireLocal(req, res)) return;
  try {
    const asset = referenceAssetFromGallery(req, String(req.body?.galleryItemId || ""));
    res.json({ ok: true, asset });
  } catch (error) {
    res.status(404).json({ ok: false, error: error.message });
  }
});

app.get("/api/reference-assets/:id/media", (req, res) => {
  const asset = readUploadedReference(req.params.id, "media");
  if (!asset) return res.status(404).json({ ok: false, error: "Reference image was not found." });
  res.type(asset.mime).setHeader("Cache-Control", "private, max-age=3600");
  res.sendFile(asset.file);
});

app.get("/api/reference-assets/:id/thumbnail", (req, res) => {
  const asset = readUploadedReference(req.params.id, "thumbnail");
  if (!asset) return res.status(404).json({ ok: false, error: "Reference thumbnail was not found." });
  res.type(asset.mime).setHeader("Cache-Control", "private, max-age=86400");
  res.sendFile(asset.file);
});

app.delete("/api/reference-assets/:id", (req, res) => {
  if (!requireLocal(req, res)) return;
  try {
    res.json(deleteUploadedReference(req.params.id));
  } catch (error) {
    res.status(404).json({ ok: false, error: error.message });
  }
});

/**
 * Where HEISS UI looks for ComfyUI. Testing tries an address without saving;
 * saving writes it to .env (like the output folder) and takes effect at once.
 */
app.post("/api/comfy-url", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const candidate = normalizeComfyUrl(req.body?.url);
  if (!candidate) {
    res.status(400).json({ ok: false, error: "That doesn’t look like an address. Try something like 127.0.0.1:8188." });
    return;
  }
  let reachable = false;
  let detail = "";
  try {
    const response = await fetch(`${candidate}/system_stats`, { signal: AbortSignal.timeout(4000) });
    reachable = response.ok;
    if (!response.ok) detail = `It answered with HTTP ${response.status}; is that ComfyUI?`;
  } catch (error) {
    detail = error?.name === "TimeoutError" ? "Nothing answered there within 4 seconds." : "Nothing is listening at that address.";
  }
  if (req.body?.save && reachable) {
    try {
      setComfyUrl(candidate);
      comfyCache = { info: null, stats: null, fetchedAt: 0 };
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
      return;
    }
  }
  res.json({ ok: true, url: candidate, reachable, saved: Boolean(req.body?.save && reachable), detail, current: comfyUrl });
});

app.post("/api/generate", async (req, res) => {
  const requestKey = encryptionKeyFromRequest(req);
  const hidden = Boolean(req.body?.privateVault);
  // Checked before anything reaches ComfyUI, so a Hidden prompt never runs in the open.
  if (hidden && !isPrivacyEnabled()) {
    res.status(400).json({ ok: false, reason: "setup", error: "Set up Hidden before generating into it." });
    return;
  }
  if (hidden && !requestKey) {
    res.status(401).json({ ok: false, locked: true, reason: "locked", error: "Hidden is locked. Unlock it to generate." });
    return;
  }
  let body;
  let isMockJob = false;
  let context = null;
  try {
    context = await loadComfyContext();
  } catch (error) {
    // Placeholder generations are only for agent and UI testing without a GPU.
    if (!demoMode) {
      res.status(503).json({ ok: false, restarting: comfyRestarting(), error: comfyDownMessage(error?.message) });
      return;
    }
  }
  if (context) {
    try {
      body = sanitizeGenerateBody(req.body, context.info, context.stats);
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
      return;
    }
  } else {
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) {
      res.status(400).json({ error: "Prompt is required." });
      return;
    }
    isMockJob = true;
    body = {
      kind: req.body?.kind === "video" ? "video" : "image",
      prompt,
      negative: String(req.body?.negative || ""),
      model: String(req.body?.model || "flux1-schnell.safetensors"),
      width: Number(req.body?.width || 1024),
      height: Number(req.body?.height || 1024),
      steps: Number(req.body?.steps || 4),
      cfg: Number(req.body?.cfg || 1),
      count: Number(req.body?.count || 1),
      sampler: String(req.body?.sampler || "euler"),
      scheduler: String(req.body?.scheduler || "simple"),
      seed: String(req.body?.seed || ""),
      startImageId: String(req.body?.startImageId || ""),
      startImageName: String(req.body?.startImageName || "")
    };
  }
  // What is made from a Hidden image stays hidden, wherever it was asked for.
  const fromHidden = [...(req.body?.referenceAssets || []).map((item) => item?.assetId), req.body?.startImageId].some((id) => String(id || "").startsWith("vault:"));
  if (fromHidden && !requestKey) {
    res.status(401).json({ ok: false, locked: true, reason: "locked", error: "That reference is in Hidden. Unlock Hidden to use it." });
    return;
  }
  body.privateVault = hidden || fromHidden;
  // An older page (or a draft restored from before the reference library) can
  // send only the image's id; treat it as the reference instead of losing it.
  if (!isMockJob && !body.referenceAssets?.length && body.startImageId && !body.startImage) {
    // Not a library id (an old start-image upload): keep the legacy path for it.
    body.referenceAssets = await stageReferenceAssets(req, [{ slot: "reference", assetId: body.startImageId }]).catch(() => []);
  }
  if (!isMockJob && body.referenceAssets?.length && !body.referenceAssets.every((item) => item.comfyName)) {
    try {
      body.referenceAssets = await stageReferenceAssets(req, body.referenceAssets, { unique: body.privateVault });
      body.startImageId ||= body.referenceAssets[0]?.assetId || "";
      body.startImageName ||= body.referenceAssets[0]?.name || "";
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
      return;
    }
  }
  // Every image this run handed ComfyUI: all of them go after a Hidden run, and
  // after a normal one, the copies of any Hidden image used as its reference.
  const staged = (body.referenceAssets || []).filter((item) => item.comfyName);
  body.stagedInputNames = staged.map((item) => item.comfyName);
  body.hiddenInputNames = staged.filter((item) => String(item.assetId || "").startsWith("vault:")).map((item) => item.comfyName);
  // A random seed is drawn here rather than inside the graph, so the gallery
  // records the number that actually ran and the image can be made again.
  if (!/^\d+$/.test(String(body.seed ?? "").trim())) {
    body.seed = String(crypto.randomInt(1, 2 ** 31));
    body.seedRandom = true;
  }
  const clientJobId = String(req.body?.clientJobId || "").replace(/[^\w-]/g, "");
  const id = clientJobId || crypto.randomUUID();
  body.clientJobId = id;
  body.createdAt = new Date().toISOString();
  body.startedAt = Date.now();
  const items = makePendingItems(id, body);
  markWorkflowUsed(body.profileId || body.model || body.workflow || "");
  setGallery(dedupeGallery([...items, ...gallery]).slice(0, galleryLimit));
  jobs.set(id, { status: "queued", kind: body.kind, prompt: body.prompt, outputs: [], items, startedAt: body.startedAt, privateVault: body.privateVault, vaultKey: body.privateVault ? requestKey : null });
  res.json({ jobId: id, items, hidden: body.privateVault, revision: galleryRevisionValue() });
  if (isMockJob) {
    setTimeout(() => runMockJob(id, body), 0);
  } else {
    setTimeout(() => runJob(id, body), 0);
  }
});

/** Setup polls with fresh=1 so a node pack installed a moment ago is not hidden behind the 30s cache. */
async function upscaleContext(res, { force = false } = {}) {
  try {
    const { info } = await loadComfyContext({ force });
    return info;
  } catch {
    res.status(503).json({ ok: false, offline: true, restarting: comfyRestarting(), error: comfyRestarting() ? "ComfyUI is restarting; smart upscale is back with it." : "ComfyUI is offline, so smart upscale is unavailable.", install: installState() });
    return null;
  }
}

app.get("/api/upscale/status", async (req, res) => {
  const info = await upscaleContext(res, { force: req.query.fresh === "1" });
  if (!info) return;
  const status = upscaleStatus(info, req.query.quality);
  // Only worth the extra round trips while the nodes still need installing.
  if (!status.nodesInstalled) status.nodeSetup = { manager: await managerAvailable(), pack: nodePack("seedvr2"), autoInstall: packInstallRoutes("seedvr2"), ...nodeInstallPlan() };
  // The face pass has its own two packs; each missing one gets the same install panel.
  if (!status.faceDetail.nodesInstalled) {
    const missing = new Set(status.faceDetail.missingNodes);
    const manager = await managerAvailable();
    status.faceDetail.setup = ["impactpack", "impactsubpack"]
      .filter((id) => nodePack(id).nodes.some((node) => missing.has(node)))
      .map((id) => ({ manager, pack: nodePack(id), autoInstall: packInstallRoutes(id), ...packInstallPlan(nodePacks[id], comfyRootDir(), process.platform) }));
  }
  res.json({ ok: true, ...status });
});

// Download progress never needs ComfyUI, so it keeps reporting while ComfyUI restarts.
app.get("/api/upscale/install", (_req, res) => {
  res.json({ ok: true, install: installState() });
});

app.post("/api/upscale/install/preview", async (req, res) => {
  const info = await upscaleContext(res);
  if (!info) return;
  const quality = normalizeQuality(req.body?.quality);
  const status = upscaleStatus(info, quality);
  if (!status.nodesInstalled) {
    res.status(400).json({ ok: false, error: `ComfyUI is missing the SeedVR2 nodes: ${status.missingNodes.join(", ")}. Install the SeedVR2 VideoUpscaler custom nodes first.` });
    return;
  }
  res.json({ ok: true, ...downloadPlan(quality, info) });
});

app.post("/api/upscale/install", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const info = await upscaleContext(res);
  if (!info) return;
  try {
    res.json({ ok: true, install: startModelInstall(normalizeQuality(req.body?.quality), info) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/upscale/install/cancel", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ ok: true, install: cancelModelInstall() });
});

app.post("/api/upscale", async (req, res) => {
  const info = await upscaleContext(res);
  if (!info) return;
  const quality = normalizeQuality(req.body?.quality);
  const faceDetail = Boolean(req.body?.faceDetail);
  const status = upscaleStatus(info, quality);
  if (!status.ready) {
    res.status(400).json({ ok: false, error: status.nodesInstalled ? "The SeedVR2 models are not installed yet." : `ComfyUI is missing the SeedVR2 nodes: ${status.missingNodes.join(", ")}.`, status });
    return;
  }
  if (faceDetail && !status.faceDetail.nodesInstalled) {
    res.status(400).json({ ok: false, error: `Face detail needs the Impact Pack nodes: ${status.faceDetail.missingNodes.join(", ")}.` });
    return;
  }
  // Say exactly why an image cannot be upscaled; the tile shows this in a popover.
  const itemId = String(req.body?.galleryItemId || "");
  const hiddenKey = encryptionKeyFromRequest(req);
  // A Hidden image upscales the same way; only where the result goes differs.
  const hiddenItem = findUpscaleTarget(itemId) ? null : findVaultItem(hiddenKey, itemId);
  const item = findUpscaleTarget(itemId) || hiddenItem;
  if (!item) {
    res.status(404).json({ ok: false, reason: "missing", error: "The server no longer has this image in its gallery. It may have been deleted or cleared on another device; reload to catch up." });
    return;
  }
  if (item.type !== "image") {
    res.status(400).json({ ok: false, reason: "video", error: "Only images can be upscaled. Video upscaling is not built in yet." });
    return;
  }
  if (item.status !== "done") {
    res.status(409).json({ ok: false, reason: "unfinished", error: "This image has not finished rendering yet. Upscale it once it is done." });
    return;
  }
  if (item.upscale?.status === "running") {
    res.status(409).json({ ok: false, error: "This image is already being upscaled." });
    return;
  }
  let imageName = "";
  try {
    const asset = referenceAssetFromGallery(req, item.id);
    const [staged] = await stageReferenceAssets(req, [{ assetId: asset.id, slot: "upscale", source: asset.source }]);
    imageName = staged?.comfyName || "";
  } catch (error) {
    res.status(400).json({ ok: false, reason: "source", error: `Could not read the original file to send to ComfyUI: ${error.message}` });
    return;
  }
  if (!imageName) {
    res.status(502).json({ ok: false, reason: "source", error: "ComfyUI did not accept the original image. Check that ComfyUI is running and its input folder is writable." });
    return;
  }
  const jobId = crypto.randomUUID();
  const body = {
    galleryItemId: item.id,
    imageName,
    quality,
    faceDetail,
    width: Number(item.width || 0),
    height: Number(item.height || 0),
    prompt: item.prompt || "",
    sourceModel: item.model || "",
    sourceSettings: item.settings || {}
  };
  const plan = upscalePlan(body);
  jobs.set(jobId, { status: "queued", kind: "upscale", galleryItemId: item.id, startedAt: Date.now(), outputs: [] });
  res.json({ ok: true, jobId, plan, revision: galleryRevisionValue() });
  setTimeout(() => hiddenItem
    ? runUpscaleJob(jobId, body, info, hiddenTarget(item.id, hiddenKey, [imageName]))
    : runUpscaleJob(jobId, body, info), 0);
});

// Stops an image's running upscale. runUpscaleJob sees the canceled job and resets the tile.
app.post("/api/upscale/cancel", async (req, res) => {
  const itemId = String(req.body?.galleryItemId || "");
  const entry = [...jobs].find(([, job]) => job.kind === "upscale" && job.galleryItemId === itemId && !job.terminalAt);
  if (!entry) {
    // Nothing is running it (the server restarted mid-upscale): just clear the spinner.
    const item = findUpscaleTarget(itemId);
    if (item?.upscale?.status === "running") updateGalleryJob(item.id, { upscale: { ...item.upscale, status: "canceled", progress: null } });
    res.json({ ok: true, stale: true });
    return;
  }
  const [jobId, job] = entry;
  setTerminalJob(jobId, { status: "canceled" });
  if (job.promptId) {
    await comfy("/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ delete: [job.promptId] }) }).catch(() => null);
    await comfy("/interrupt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt_id: job.promptId }) }).catch(() => null);
  }
  res.json({ ok: true });
});

app.post("/api/upscale/toggle", (req, res) => {
  try {
    const itemId = String(req.body?.galleryItemId || "");
    const key = encryptionKeyFromRequest(req);
    const hiddenItem = findUpscaleTarget(itemId) ? null : findVaultItem(key, itemId);
    if (hiddenItem) {
      if (!hiddenItem.upscale?.url) throw new Error("This image has no upscale to switch to.");
      const active = typeof req.body?.active === "boolean" ? req.body.active : !hiddenItem.upscaleActive;
      patchVaultItem(key, itemId, { upscaleActive: active });
      res.json({ ok: true, upscaleActive: active, revision: galleryRevisionValue() });
      return;
    }
    const item = toggleUpscaleView(itemId, req.body?.active);
    res.json({ ok: true, upscaleActive: Boolean(item.upscaleActive), revision: galleryRevisionValue() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.json({ status: "missing" });
    return;
  }
  const { vaultKey, ...safeJob } = job;
  // What a Hidden run made, or even what it was asked, is for an unlocked browser only.
  if (job.privateVault && !encryptionKeyFromRequest(req)) {
    res.json({ status: safeJob.status, privateVault: true });
    return;
  }
  res.json({ ...safeJob, items: revealGalleryItemsForRequest(safeJob.items || []) });
});

app.post("/api/jobs/:id/cancel", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    const changed = updateGalleryJob(req.params.id, { status: "canceled" });
    await comfy("/interrupt", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
    res.json({ ok: true, stale: true, changed });
    return;
  }
  jobs.set(req.params.id, { ...job, status: "canceling" });
  updateGalleryJob(req.params.id, { status: "canceled" });
  try {
    if (job.promptId) {
      await comfy("/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ delete: [job.promptId] })
      });
      await comfy("/interrupt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt_id: job.promptId })
      });
    }
  } catch {
    await comfy("/interrupt", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
  }
  res.json({ ok: true });
});

app.post("/api/queue/cancel", async (_req, res) => {
  for (const [id, job] of jobs) {
    if (job.status === "queued" || job.status === "running" || job.status === "canceling") {
      setTerminalJob(id, { status: "canceled" });
      updateGalleryJob(id, { status: "canceled" });
    }
  }
  setGallery(gallery.map((item) => (item.status === "pending" ? { ...item, status: "canceled" } : item)));
  saveGallery();
  await comfy("/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clear: true }) }).catch(() => null);
  await comfy("/interrupt", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
  res.json({ ok: true });
});

app.post("/api/gallery/clear", (req, res) => {
  if (!requireAdmin(req, res)) return;
  // Clearing the gallery never touches Hidden; that has its own erase.
  const cleared = gallery.filter((item) => item.status === "done" && !item.privateVault);
  const files = deleteGalleryFiles(cleared);
  hideGalleryItems(cleared);
  setGallery(gallery.filter((item) => item.status !== "done" || item.privateVault));
  saveGallery();
  res.json({ ok: true, files, outputs: revealGalleryItemsForRequest(filterVisibleGallery(gallery)) });
});

app.post("/api/gallery/errors/clear", (_req, res) => {
  const cleared = gallery.filter((item) => item.status === "error" || item.status === "canceled");
  hideGalleryItems(cleared);
  setGallery(gallery.filter((item) => item.status !== "error" && item.status !== "canceled"));
  saveGallery();
  res.json({ ok: true, outputs: revealGalleryItemsForRequest(filterVisibleGallery(gallery)) });
});

app.post("/api/cache/clear", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  for (const [id, job] of jobs) {
    if (job.status === "queued" || job.status === "running" || job.status === "canceling") {
      setTerminalJob(id, { status: "canceled" });
      updateGalleryJob(id, { status: "canceled" });
    }
  }
  setGallery(gallery.filter((item) => item.status === "done").map(({ preview, progress, ...item }) => item).slice(0, galleryLimit));
  saveGallery();
  await comfy("/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clear: true }) }).catch(() => null);
  await comfy("/interrupt", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
  await comfy("/free", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(() => null);
  res.json({ ok: true, outputs: revealGalleryItemsForRequest(filterVisibleGallery(gallery)) });
});

// Model folders ComfyUI is not reading, and adding them to its extra_model_paths.yaml.
// HEISS can only look at (and change) the machine it runs on, so a remote ComfyUI gets none of this.
const comfyIsLocal = () => {
  try { return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(comfyUrl).hostname); } catch { return false; }
};

app.get("/api/model-folders", async (_req, res) => {
  try {
    res.json(await modelFolderReport({ local: comfyIsLocal() }));
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/model-folders", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
    res.json(await linkModelFolders(paths, { picked: String(req.body?.picked || "") }));
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.delete("/api/model-folders", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json(await unlinkModelFolder(String(req.body?.path || "")));
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

// The person points at a folder the scan missed; it still has to read as a models folder.
app.post("/api/model-folders/pick", async (req, res) => {
  if (!isLocalClient(req.socket.remoteAddress || "")) {
    res.status(403).json({ ok: false, error: "The folder picker only opens on the computer running HEISS UI." });
    return;
  }
  try {
    const picked = await pickFolder("", "Choose the folder that holds your models");
    res.json(picked ? { ok: true, path: picked } : { ok: true, canceled: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

// One-click node pack installs, by registry id only (see pack-installer.js).
app.post("/api/node-packs/:id/install", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json({ ok: true, install: await startPackInstall(String(req.params.id)) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/node-packs/:id/install", (req, res) => {
  res.json({ ok: true, install: packInstallState(String(req.params.id)) });
});

app.get("/api/comfy/manager", async (_req, res) => {
  res.json({ ok: true, ...(await managerInfo()) });
});

// ComfyUI is started outside HEISS UI, so only ComfyUI-Manager can restart it in place.
app.post("/api/comfy/restart", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  // A dropped connection below means "already going down" only if ComfyUI was
  // up to begin with; otherwise "restarting" would show for minutes over nothing.
  const up = await fetch(`${comfyUrl}/system_stats`, { signal: AbortSignal.timeout(4000) }).then((response) => response.ok, () => false);
  if (!up) {
    res.status(503).json({ ok: false, error: "ComfyUI isn’t running, so there’s nothing to restart. Start it, and the studio connects by itself." });
    return;
  }
  let sawManager = false;
  // Manager 4 (built into ComfyUI) and the Manager custom node from 3.4x only
  // take a bodyless POST; older custom nodes took a GET. A 404/405 just means
  // "not this one", try the next.
  const attempts = [["POST", "/v2/manager/reboot"], ["POST", "/manager/reboot"], ["GET", "/v2/manager/reboot"], ["GET", "/api/manager/reboot"], ["GET", "/manager/reboot"]];
  for (const [method, route] of attempts) {
    let response;
    try {
      response = await fetch(`${comfyUrl}${route}`, { method, signal: AbortSignal.timeout(5000) });
    } catch {
      // ComfyUI dropping the connection mid-answer means it is already going down.
      beginComfyRestart();
      res.json({ ok: true });
      return;
    }
    if (response.ok) {
      beginComfyRestart();
      res.json({ ok: true });
      return;
    }
    if (response.status === 403) {
      res.status(403).json({ ok: false, error: "ComfyUI-Manager refused the restart. Lower its security_level to normal in the Manager config, or restart ComfyUI by hand." });
      return;
    }
    if (response.status !== 404 && response.status !== 405) sawManager = true;
  }
  res.status(501).json({ ok: false, error: sawManager ? "ComfyUI-Manager could not restart ComfyUI." : "Restarting needs ComfyUI-Manager. Newer ComfyUI ships it switched off: start ComfyUI with --enable-manager." });
});

app.delete("/api/gallery/:id", (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const inGallery = gallery.some((item) => item.id === id || item.url === id);
  // Only an id the gallery does not know can be a Hidden one, and only then is a key needed.
  let vault = { removed: 0 };
  if (!inGallery && vaultConfigured()) {
    const key = encryptionKeyFromRequest(req);
    if (!key) {
      res.status(401).json({ ok: false, locked: true, error: "Unlock Hidden to delete from it." });
      return;
    }
    vault = deleteVaultItems(key, [id]);
  }
  const before = gallery.length;
  const removed = gallery.filter((item) => item.id === id || item.url === id);
  const files = deleteGalleryFiles(removed);
  hideGalleryItems(removed);
  setGallery(gallery.filter((item) => item.id !== id && item.url !== id));
  if (gallery.length !== before) saveGallery();
  res.json({ ok: true, files, vault, removed: before - gallery.length + vault.removed, outputs: revealGalleryItemsForRequest(filterVisibleGallery(gallery)) });
});

app.post("/api/open-output-folder", (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!comfyOutputDir || !fs.existsSync(comfyOutputDir)) {
    res.status(404).json({ ok: false, error: "Output folder is not configured." });
    return;
  }
  openFolder(comfyOutputDir);
  res.json({ ok: true, outputDir: comfyOutputDir });
});

app.get("/api/update/status", async (req, res) => {
  if (!requireLocal(req, res)) return;
  try {
    res.json(await updateStatus({ fresh: req.query.fresh === "1" }));
  } catch (error) {
    res.status(500).json({ ok: false, available: false, error: error.message });
  }
});

app.post("/api/update/install", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const before = await updateStatus();
    if (!before.ok) {
      res.status(400).json(before);
      return;
    }
    if (!before.available) {
      res.json({ ...before, updated: false, message: "Already up to date." });
      return;
    }
    if (before.release) {
      // A release copy has no git to pull: download the new release, swap it in on restart.
      if (!before.canInstall && before.download?.status !== "ready") {
        res.json({ ...before, updated: false, message: `HEISS UI ${before.latest} is out. Download it from ${before.url} and replace this folder (keep your data folder).` });
        return;
      }
      if (before.download?.status === "ready") { res.json({ ...before, updated: false }); return; }
      res.json({ ...before, updated: false, download: await startReleaseUpdate(root) });
      return;
    }
    const branch = before.branch && before.branch !== "HEAD" ? before.branch : "main";
    const pull = await runRepoCommand("git", ["pull", "--ff-only", "origin", branch]);
    const install = await runRepoCommand(npmCommand, ["install"]);
    const build = await runRepoCommand(npmCommand, ["run", "build"]);
    const after = await updateStatus();
    res.json({ ...after, updated: true, restartRequired: true, logs: { pull, install, build } });
  } catch (error) {
    res.status(500).json({ ok: false, updated: false, error: error.message });
  }
});

// Only a release started through scripts/start.mjs can restart itself (and swap in an update).
app.post("/api/update/restart", (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!requestRestart()) {
    res.status(409).json({ ok: false, error: "This copy was not started with its launcher, so it cannot restart itself. Stop it and start it again." });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/shutdown", (_req, res) => {
  if (!requireLocal(_req, res)) return;
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 250);
});

app.get("/comfy/thumb", async (req, res) => {
  const filename = String(req.query.filename || "");
  const subfolder = String(req.query.subfolder || "");
  const type = String(req.query.type || "output");
  if (!filename) { res.status(400).json({ error: "filename is required." }); return; }
  try {
    const thumbnail = await getThumbnail(filename, subfolder, type);
    if (!thumbnail) { res.status(404).json({ error: "Source image is unavailable." }); return; }
    // No sharp (see sharp-loader.js): the full image stands in for the thumbnail.
    if (thumbnail.original) { res.redirect(302, `/comfy/view?${new URLSearchParams({ filename, subfolder, type })}`); return; }
    if (req.headers["if-none-match"] === thumbnail.etag) { res.status(304).end(); return; }
    if (thumbnail.etag) res.setHeader("ETag", thumbnail.etag);
    // This URL identifies an output filename, not immutable image bytes. Its
    // ETag is a source-content hash, so revalidation safely handles reuse.
    res.setHeader("Cache-Control", "private, no-cache");
    res.type("image/webp");
    await pipeline(fs.createReadStream(thumbnail.file), res);
  } catch (error) {
    if (!res.headersSent) res.status(502).json({ error: error.message }); else res.destroy();
  }
});

app.get("/comfy/*path", async (req, res) => {
  try {
    const query = req.originalUrl.split("?")[1] ? `?${req.originalUrl.split("?")[1]}` : "";
    const proxyPath = Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path;
    // Forward conditional headers so an unchanged image gets a 304 instead of a
    // full re-transfer over a slow LAN link, and stream the body instead of
    // buffering it so bytes start moving to the client as soon as they arrive.
    const conditional = {};
    for (const header of ["if-none-match", "if-modified-since", "range", "if-range"]) {
      if (req.headers[header]) conditional[header] = req.headers[header];
    }
    // ComfyUI is stopped or restarting: outputs still open from the output folder.
    const localFile = () => (proxyPath === "view" ? localOutputFile(String(req.query.filename || ""), String(req.query.subfolder || ""), String(req.query.type || "output")) : null);
    const sendLocal = (file) => res.sendFile(file, { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } });
    // It just failed to answer: go straight to disk instead of waiting ~2 s for another refusal (Windows).
    const known = comfyRecentlyUnreachable() ? localFile() : null;
    if (known) { sendLocal(known); return; }
    let response;
    try {
      response = await fetch(`${comfyUrl}/${proxyPath}${query}`, { headers: conditional });
      noteComfyReachable();
    } catch (error) {
      noteComfyFetchError(error);
      const file = localFile();
      if (!file) throw error;
      sendLocal(file);
      return;
    }
    res.status(response.status);
    const etag = response.headers.get("etag");
    const lastModified = response.headers.get("last-modified");
    const contentLength = response.headers.get("content-length");
    if (etag) res.setHeader("ETag", etag);
    if (lastModified) res.setHeader("Last-Modified", lastModified);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    for (const header of ["accept-ranges", "content-range", "content-disposition"]) {
      const value = response.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    if (response.status === 304 || !response.body) { res.end(); return; }
    res.type(response.headers.get("content-type") || "application/octet-stream");
    await pipeline(Readable.fromWeb(response.body), res);
  } catch (error) {
    if (!res.headersSent) res.status(502).json({ error: error.message }); else res.destroy();
  }
});

const dist = path.join(root, "dist");
// An unknown API route must fail as JSON, never fall through to the app page.
app.all("/api/*splat", (_req, res) => res.status(404).json({ ok: false, error: "Unknown API route. Restart HEISS UI if it was just updated." }));

if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*splat", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

setTimeout(() => recoverGalleryFromHistory().catch(() => null), 1200);

app.listen(port, host, (error) => {
  // Express 5 hands a failed listen to this callback instead of throwing.
  if (error) {
    console.error(error.code === "EADDRINUSE"
      ? `\n  Port ${port} is already in use. HEISS UI may already be running: http://localhost:${port}\n`
      : `\n  HEISS UI could not start: ${error.message}\n`);
    // A distinct code, so scripts/start.mjs does not blame (and roll back) a fresh update for it.
    process.exit(error.code === "EADDRINUSE" ? PORT_IN_USE_CODE : 1);
  }
  // localhost rather than 127.0.0.1: same server, but browsers only allow passkeys
  // (Touch ID, Windows Hello for Hidden) on a name, never on an address.
  const shownHost = host === "0.0.0.0" || host === "::" || host === "127.0.0.1" ? "localhost" : host;
  // Under `npm run dev*` the page comes from Vite; this server only answers the API.
  const dev = /^dev/.test(process.env.npm_lifecycle_event || "");
  const pagePort = dev ? 5173 : port;
  Promise.resolve(printBanner({ version: appVersion, url: `http://${shownHost}:${pagePort}`, comfyUrl })).then(async () => {
    // Listening beyond this computer: say where a phone can open it.
    if (host === "0.0.0.0" || host === "::") {
      const addresses = Object.values(os.networkInterfaces()).flatMap((entries) => entries || []).filter((entry) => entry.family === "IPv4" && !entry.internal);
      for (const entry of addresses) console.log(`    ➜  Network   http://${entry.address}:${pagePort}`);
      if (addresses.length) console.log("");
    }
    // Starting before ComfyUI is fine, but say so instead of leaving people to guess.
    const answering = await fetch(`${comfyUrl}/system_stats`, { signal: AbortSignal.timeout(3000) }).then((response) => response.ok, () => false);
    if (!answering && !demoMode) console.log(`    ComfyUI isn’t answering at ${comfyUrl} yet. Start it; the studio connects by itself.\n`);
  }).catch(() => {});
  // Tells scripts/start.mjs this version runs, so a fresh update is kept.
  process.send?.({ type: "ready", version: appVersion });
});

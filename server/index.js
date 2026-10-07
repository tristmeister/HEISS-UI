// First: keeps a copy of data/ before a new version's stores load and migrate it.
import { dropSnapshots } from "./data-snapshot.js";
// Next, so a crash anywhere below, even while starting, is written down (data/logs).
import "./crash-log-install.js";
import { addProbe, logDir } from "./crash-log.js";
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
import { releaseStatus, requestRestart, saveUpdatePrefs, startReleaseUpdate, warmReleaseCheck } from './updater.js';
import { PORT_IN_USE_CODE, removeForeignLaunchers } from './release-swap.js';
import { allowLanActions, lan, lanListening, saveLanSetting, demoMode, comfy, comfyRecentlyUnreachable, inDotFolder, localOutputFile, outputMediaPattern, comfyOutputDir, comfyUrl, host, noteComfyFetchError, noteComfyReachable, normalizeComfyUrl, optionsFor, port, root, setComfyFolderPaths, setComfyOutputDir, setComfyUrl, requestedPort, setListeningPort } from './comfy.js';
import { canAdmin, clientOf, deviceSession, studioPasswordSet } from './access.js';
import { limitedCheck, registerAccessRoutes } from './access-routes.js';
import { requestGuard } from './request-guard.js';
import { stripMetadata } from './metadata-strip.js';
import { httpsListening, httpsProblem, startServers } from './listen.js';
import { httpsPort, inspectTls, startupTls, tlsHostNames, tlsSummary } from './tls.js';
import { envFileKeys, writeLocalEnvValue } from './env.js';
import { inferModels, mockModelResult, offlineModelResult } from './models.js';
import { families } from './family-catalog.js';
import { primeModelMetadata, setModelChoice } from './model-families.js';
import { catalogDownload } from './family-profiles.js';
import { cancelDownload, discardDownload, downloadState, replaceDownload, startDownload } from './model-downloads.js';
import { sanitizeGenerateBody } from './validation.js';
import { addGalleryItems, dedupeGallery, deleteGalleryFiles, writeGalleryNow, filterVisibleGallery, gallery, galleryKey, galleryLimit, dataDir, hideGalleryItems, makePendingItems, migrateLegacyPrompts, recordsFromComfyHistory, removeGalleryItems, saveGallery, setGallery, cleanupGalleryState, updateGalleryJob, pageGallery, galleryDelta, galleryRevisionValue, sortGallery } from './gallery-store.js';
import { galleryFilter, setGalleryFavorites } from './gallery-store.js';
import { buildStats, forgetItemThumbnails, forgetLegacyHiddenThumbnails, getFileThumbnail, getThumbnail, resizeInMemory } from './thumbnails.js';
import { clearPromptHistory, forgetPrompts, listPrompts, promptHistoryEnabled, promptKey, recordPrompt, setPromptHistoryEnabled, setPromptPinned } from './prompt-history.js';
import { addLibraryFolder, fillVideoSizes, importOutputFolder, libraryFile, libraryFolders, removeLibraryFolder, rescanLibraryFolders, scanLibraryFolder } from './library.js';
import { forgetItemVideoPreviews, forgetPrivateVideoPreviews, getComfyVideoPoster, getComfyVideoPreview, getFileVideoPoster, getFileVideoPreview, getPrivateVideoPreview, sendVideoPreview, sendVideoPoster } from './video-previews.js';
import { sendMediaBuffer } from './media-response.js';
import { civitaiPrefs, saveCivitaiPrefs } from './civitai.js';
import { emptyTrash, restoreTrash, scheduleTrashPurge, trashGalleryItems, trashSummary } from './gallery-trash.js';
import { jobs, queueClearsAt, runJob, runMockJob, setTerminalJob } from './jobs.js';
import { cancelPrompt, cancelPrompts } from './comfy-queue.js';
import { loraInfos } from './lora-info.js';
import { hfEndpoint, hfTokenStatus, saveHfToken } from './hf-access.js';
import { deleteImportedWorkflow, getCustomWorkflow, saveImportedWorkflow, userWorkflowsDir, validateGraph } from './custom-workflows.js';
import { applyBundles, createBundles, DEFAULT_COOLDOWN_MINUTES, dissolveBundle, listBundles, pendingSummary, setBundleCover } from './gallery-bundles.js';
import { galleryStats } from './stats.js';
import { describeHardware } from './hardware.js';
import { starterPlan } from './starter-models.js';
import { findComfy, findComfyNow, nearbyAddresses } from './comfy-finder.js';
import { loadWorkflowPreferences, markWorkflowUsed, previewWorkflowImport, saveWorkflowPreferences, workflowSummaries } from './workflow-catalog.js';
import { saveStartImage } from './start-images.js';
import { addDevicePasskey, addPasskey, changePassword, issueChallenge, unlockWithDevicePasskey, clearUnlockCookie, encryptionKeyFromRequest, erasePrivacy, isPrivacyEnabled, passkeyUnlockOptions, privacyStatusFor, removePasskey, revealGalleryItemsForRequest, setupPrivacy, setUnlockCookie, unlockWithPasskey, unlockWithPassword } from './privacy.js';
import { compactVaultBundles, deleteVaultItems, dissolveVaultBundle, eraseVault, retireVault, exportVaultBackup, findVaultItem, hideItems, patchVaultItem, readVaultAsset, setVaultBundleCover, unhideItems, vaultAssetsForExport, vaultBundlePendingSummary, vaultConfigured, vaultItems, vaultRevision } from './vault.js';
import { forgetComfyRun } from './hidden-traces.js';
import { adoptHiddenRuns, forgetHiddenRunKeys, settleHiddenRuns, withoutHiddenRuns } from './hidden-runs.js';
import { sendGalleryExport } from './gallery-export.js';
import { applyLoraOps, clearLoraState, loadLoraLibrary, loadLoraStack, saveLoraLibrary, saveLoraStack } from './lora-stacks.js';
import { inpaintInputNames, prepareInpaint } from './inpaint.js';
import { deleteUploadedReference, listReferenceAssets, readMultipartImage, readUploadedReference, referenceAssetFromGallery, saveUploadedReference, stageReferenceAssets } from './reference-assets.js';
import { nodePack, nodePacks } from './node-packs.js';
import { beginComfyRestart, comfyRestartStartedAt, comfyRestarting, finishComfyRestart, lastComfyRestart, noteComfyRestart } from './comfy-restart.js';
import { failedPacks, loadedPacks, logTextFromRaw, packLabel, restartChanges } from './restart-insights.js';
import { comfyRestartEstimate, generationEstimate, recordComfyRestart, upscaleEstimate } from './timings.js';
import { upscaleWork } from './upscale-timing.js';
import { comfyRootDir, packInstallPlan } from './node-install.js';
import { linkModelFolders, modelFolderReport, unlinkModelFolder } from './model-folders.js';
import { packInstallRoutes, packInstallState, startPackInstall } from './pack-installer.js';
import { prepareImport } from './workflow-import.js';
import { recentFromHistory, savedWorkflowList } from './workflow-sources.js';
import { convertWithComfyPage, resetComfyPage } from './comfy-page-convert.js';
import { startWorkflowSetup, undoWorkflowSetup, workflowSetupState } from './workflow-setup.js';
import { installHistory } from './install-safety.js';
import { listDownload } from './workflow-models.js';
import { cancelModelInstall, downloadPlan, installState, managerAvailable, managerInfo, nodeInstallPlan, normalizeQuality, startModelInstall, upscalePlan, upscaleQualities, upscaleStatus } from './upscale.js';
import { findUpscaleTarget, startUpscale, toggleUpscaleView } from './upscale-jobs.js';
import { planRunUpscale } from './run-upscale.js';
import { autoDetectOutputDir, detectOutputDirs, inspectOutputDir, outputDirChoice, pickFolder } from './output-folder.js';
import { compressJson, serveApp } from './http-assets.js';
import { describeGitError, updateCheckout } from './git-update.js';
import { diagnostics, diagnosticsText } from './diagnostics.js';

// Thumbnails building and waiting, in every heartbeat and crash line.
addProbe("thumbs", () => buildStats());

const app = express();
// Before anything reads a body: other websites and rebound hostnames stop here (request-guard.js).
app.use(requestGuard({ lan: () => allowLanActions, extraHosts: tlsHostNames }));
app.use(express.json({ limit: "25mb" }));
// A body that is not valid JSON, or too big, gets a plain JSON answer, not Express's HTML page with a stack trace and file paths.
app.use((error, _req, res, next) => {
  if (!error || (error.type !== "entity.parse.failed" && error.type !== "entity.too.large")) return next(error);
  res.status(error.type === "entity.too.large" ? 413 : 400).json({ ok: false, error: error.type === "entity.too.large" ? "That request is too large." : "That request wasn't valid JSON." });
});
// Gallery pages and model lists travel compressed to phones and tablets; this computer skips the work.
app.use(compressJson({ skip: (req) => clientOf(req).thisComputer }));
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
  // Hidden runs HEISS UI lost track of are sealed first, and never join the gallery either way.
  await settleHiddenRuns().catch(() => null);
  const history = withoutHiddenRuns(await comfy(`/history?max_items=${Math.min(galleryLimit, 500)}`).catch(() => ({})));
  const recovered = recordsFromComfyHistory(history);
  if (!recovered.length) return;
  const pending = gallery.filter((item) => item.status === "pending");
  setGallery(dedupeGallery([...pending, ...gallery, ...recovered]).slice(0, galleryLimit));
}

/** This computer, or another device that signed in (the gate below has already checked). */
function requireLocal(req, res) {
  const client = clientOf(req);
  if (client.thisComputer || (client.network && deviceSession(req))) return true;
  res.status(403).json({ ok: false, error: "Only this computer or a signed-in device can do this." });
  return false;
}

/**
 * The gate for other devices. This computer goes straight through. Anyone
 * else is answered only in LAN mode, from a private network address (or
 * through a proxy, which always counts as someone else), and only once
 * signed in with the studio password. /api/access is how they sign in.
 */
function requireSignedIn(req, res, next) {
  if (!req.path.startsWith("/api") && !req.path.startsWith("/comfy")) return next();
  const client = clientOf(req);
  if (client.thisComputer) return next();
  if (!client.network) {
    res.status(403).json({ ok: false, reason: "lan-off", error: "Only this computer can open the studio. To use it on other devices, turn them on in Settings › Connection." });
    return;
  }
  if (req.path.startsWith("/api/access/")) return next();
  if (!deviceSession(req)) {
    res.setHeader("X-HEISS-Sign-In", "1");
    res.status(401).json({ ok: false, reason: "sign-in", error: "Sign in with the studio password to continue." });
    return;
  }
  next();
}

app.use(requireSignedIn);
registerAccessRoutes(app);

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

async function updateStatus({ fresh = false, auto = false } = {}) {
  if (!fs.existsSync(path.join(root, ".git"))) {
    if (fs.existsSync(path.join(root, "release.json"))) return releaseStatus(root, { fresh, auto, dataDir });
    return { ok: false, available: false, current: "", latest: "", branch: "", error: "This copy isn’t a Git checkout." };
  }
  // A checkout updates by hand with git: the automatic check leaves it alone.
  if (auto) return { ok: true, available: false, release: false };
  // git's own output (spawn ENOENT, "Could not resolve host") becomes plain words.
  const git = (args, step = "fetch") => runRepoCommand("git", args).catch((error) => { throw new Error(describeGitError(error, step)); });
  const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const current = (await git(["rev-parse", "--short", "HEAD"])).trim();
  await git(["fetch", "--quiet", "origin"]);
  const upstreamRef = branch && branch !== "HEAD" ? `origin/${branch}` : "origin/main";
  const latest = (await git(["rev-parse", "--short", upstreamRef])).trim();
  const behindText = await git(["rev-list", "--count", `${current}..${upstreamRef}`]);
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

/**
 * Images hidden before hiding cleaned up after itself left cached thumbnails
 * behind; the first unlock after the update finds and removes them, once.
 */
let oldHiddenThumbnailsChecked = false;
function forgetOldHiddenThumbnails(key) {
  if (oldHiddenThumbnailsChecked) return;
  oldHiddenThumbnailsChecked = true;
  try {
    const names = vaultItems(key, { bundles: false }).flatMap((item) => [item.outputName, item.upscale?.outputName]);
    const removed = forgetLegacyHiddenThumbnails(names);
    if (removed) console.log(`[HEISS] Removed ${removed} thumbnail${removed === 1 ? "" : "s"} left behind by images hidden before.`);
  } catch {
    oldHiddenThumbnailsChecked = false;
  }
}

async function privacyPayload(req, key = encryptionKeyFromRequest(req)) {
  const status = privacyStatusFor(req);
  const unlocked = Boolean(key);
  if (unlocked) {
    migrateLegacyPrompts(key);
    forgetOldHiddenThumbnails(key);
    // What Hidden runs made after HEISS UI lost track of them joins Hidden now.
    try { adoptHiddenRuns(key); } catch { /* the next unlocked request tries again */ }
  }
  return {
    ...status,
    unlocked,
    // Nothing about what Hidden holds is shared with a locked browser, not even whether it is empty.
    vault: { unlocked, revision: unlocked ? vaultRevision() : 0 },
    readiness: await hiddenReadiness(),
    // Another device, signed in with the studio password; Hidden itself still opens with its own.
    remote: !clientOf(req).thisComputer
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
  res.json({
    addresses: interfaces.map((item) => item.address), interfaces, port, listening: lanListening,
    // saved: what the next start does. source: who decides it now (flag and shell outrank the switch).
    lan: { saved: lan.saved, source: lan.source, supervised: typeof process.send === "function", hiddenReady: isPrivacyEnabled() },
    // HTTPS for other devices (tls.js). `next`: what .env says now, used from the next start.
    tls: networkTls(clientOf(req).thisComputer)
  });
});

// HTTPS set in the shell outranks Settings, like HOST does.
const tlsFromShell = ["HEISS_TLS_CERT", "HEISS_TLS_KEY"].some((name) => process.env[name] && !envFileKeys.has(name));

/** HTTPS as it runs, and as .env has it for the next start. File paths only for this computer. */
function networkTls(thisComputer) {
  const hidePaths = (summary) => (thisComputer ? summary : { ...summary, certPath: "", keyPath: "" });
  const next = inspectTls(process.env.HEISS_TLS_CERT || "", process.env.HEISS_TLS_KEY || "");
  return { ...hidePaths(tlsSummary(startupTls, { active: httpsListening })), problem: httpsProblem, next: hidePaths(tlsSummary(next)), fromShell: tlsFromShell };
}

/**
 * Settings › Connection › HTTPS: check a certificate and key and keep them in
 * .env, or clear them. Used from the next start. Only this computer can,
 * since it decides how every other device connects.
 */
app.post("/api/network/tls", (req, res) => {
  if (!requireThisComputer(req, res)) return;
  if (tlsFromShell) {
    res.status(409).json({ ok: false, error: "HTTPS is set with HEISS_TLS_CERT and HEISS_TLS_KEY where HEISS UI starts. Change it there." });
    return;
  }
  const off = !req.body?.cert && !req.body?.key;
  const report = off ? null : inspectTls(String(req.body?.cert || ""), String(req.body?.key || ""));
  if (report && !report.ok) {
    res.status(400).json({ ok: false, error: report.error, tls: tlsSummary(report) });
    return;
  }
  try {
    writeLocalEnvValue("HEISS_TLS_CERT", report ? report.certPath : "");
    writeLocalEnvValue("HEISS_TLS_KEY", report ? report.keyPath : "");
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
    return;
  }
  res.json({ ok: true, tls: report ? tlsSummary(report) : null, restartNeeded: true });
});

// The Settings switch for other devices. It takes effect when HEISS UI starts again.
app.post("/api/network/lan", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const enabled = Boolean(req.body?.enabled);
  try {
    saveLanSetting(enabled);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
    return;
  }
  res.json({ ok: true, saved: enabled, restartNeeded: lan.source === "setting" && enabled !== lanListening });
});

function sessionSeconds(req) {
  const value = Number(req.body?.sessionSeconds || 0);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Looking after the computer (model folders and downloads, node installs,
 * ComfyUI's address and restarts, the output folder, updates, workflow files,
 * clearing the gallery) happens at that computer. A signed-in device may too
 * when the owner turned on "Trust other devices with admin" (access.js).
 * Anywhere else the server refuses them and the app hides them.
 */
function requireAdmin(req, res) {
  if (canAdmin(req)) return true;
  res.status(403).json({ ok: false, reason: "computer-only", error: "Do this on the computer running HEISS UI. Other devices can be allowed in Settings › Connection." });
  return false;
}

/** Creating, erasing or re-keying Hidden happens at the computer it runs on, never from the network. */
function requireThisComputer(req, res) {
  if (clientOf(req).thisComputer) return true;
  res.status(403).json({ ok: false, reason: "this-computer", error: "Only the computer running HEISS UI can do this." });
  return false;
}

app.post("/api/privacy/setup", async (req, res) => {
  if (!requireThisComputer(req, res)) return;
  try {
    // Creating the password does not need ComfyUI; hiding images later does, to
    // remove its copies, and says so then.
    // A Hidden left without its key ring can never be opened again; keep it aside rather than build on it.
    if (!isPrivacyEnabled() && vaultConfigured()) { retireVault(); forgetPrivateVideoPreviews(); }
    const key = await setupPrivacy(req.body?.password || "");
    setUnlockCookie(res, key, sessionSeconds(req), req);
    res.json({ ok: true, ...(await privacyPayload(req, key)), enabled: true, unlocked: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/privacy/unlock", async (req, res) => {
  if (!requireLocal(req, res)) return;
  const key = await limitedCheck(req, res, () => unlockWithPassword(req.body?.password || ""), "That password is incorrect.");
  if (!key) return;
  setUnlockCookie(res, key, sessionSeconds(req), req);
  res.json({ ok: true, ...(await privacyPayload(req, key)), enabled: true, unlocked: true });
});

app.get("/api/privacy/passkeys/options", (req, res) => {
  if (!requireLocal(req, res)) return;
  res.json({ ok: true, passkeys: passkeyUnlockOptions(), challenge: issueChallenge() });
});

app.post("/api/privacy/passkeys/unlock", async (req, res) => {
  if (!requireLocal(req, res)) return;
  const key = await limitedCheck(req, res, async () => (req.body?.secret
    ? unlockWithDevicePasskey(req.body, String(req.headers.origin || ""))
    : unlockWithPasskey(String(req.body?.id || ""), String(req.body?.prf || ""))), "This passkey isn’t set up for Hidden. Use your password.");
  if (!key) return;
  setUnlockCookie(res, key, sessionSeconds(req), req);
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
  if (!requireThisComputer(req, res)) return;
  const key = requireHiddenKey(req, res);
  if (!key) return;
  try {
    await changePassword(key, req.body?.password || "");
    res.json({ ok: true, ...(await privacyPayload(req, key)) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/privacy/lock", (req, res) => {
  if (!requireLocal(req, res)) return;
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
  forgetPrivateVideoPreviews();
  forgetHiddenRunKeys();
  // Copies taken before an update may still hold Hidden's older records.
  try { dropSnapshots(); } catch { /* held open (Windows); they go within 14 days anyway */ }
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
  try { adoptHiddenRuns(key); } catch { /* tried again with the next page */ }
  try {
    const page = hiddenPage(req, key);
    if (Number(req.query.since || 0) && Number(req.query.since) === page.revision) {
      res.json({ unchanged: true, revision: page.revision });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.json(page);
  } catch {
    res.status(500).json({ ok: false, error: "Can’t open Hidden with this key." });
  }
});

app.post("/api/hidden/hide", async (req, res) => {
  if (!requireLocal(req, res)) return;
  const key = requireHiddenKey(req, res);
  if (!key) return;
  const ids = new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String));
  const items = filterVisibleGallery(gallery).filter((item) => item.status === "done" && (ids.has(item.id) || ids.has(item.url)));
  if (items.some((item) => item.library)) {
    res.status(400).json({ ok: false, error: "Images from an added folder stay in that folder, so they can’t move into Hidden." });
    return;
  }
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
    // Nothing of them stays in the open: the gallery's copy of their prompts (and its
    // backup), their cached thumbnails, the prompt history, and what ComfyUI kept of them.
    writeGalleryNow();
    writeGalleryNow();
    // A prompt that now only belongs to Hidden leaves the prompt history too.
    const stillShown = new Set(filterVisibleGallery(gallery).map((item) => promptKey(item.prompt)));
    forgetPrompts((result.movedFrom || []).map((item) => item.prompt || ""), stillShown);
    for (const item of result.movedFrom || []) {
      await forgetItemThumbnails(item).catch(() => 0);
      await forgetItemVideoPreviews(item).catch(() => 0);
    }
    await forgetComfyRun({ promptIds: result.promptIds, inputNames: result.inputNames });
    res.json({ ok: true, moved: result.moved.length, ids: (result.movedFrom || []).map((item) => item.id), hiddenIds: result.moved.map((item) => item.id), failed: result.failed, leftBehind: result.leftBehind, revision: galleryRevisionValue() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/hidden/unhide", async (req, res) => {
  if (!requireLocal(req, res)) return;
  const key = requireHiddenKey(req, res);
  if (!key) return;
  try {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String);
    const restored = await unhideItems(key, ids);
    for (const id of ids) forgetPrivateVideoPreviews(id);
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

// How a second start finds out HEISS UI already holds the port (see launch.js).
app.get("/api/ping", (_req, res) => res.json({ ok: true, app: "heiss-ui", version: appVersion }));

/**
 * How far a source checkout is past its release tag, so About can tell
 * "v0.2.0" from "v0.2.0 + 3". Release copies have no git and are exactly
 * their version.
 */
let describeCache = { at: 0, value: null };
async function commitsSinceRelease() {
  if (Date.now() - describeCache.at < 60000) return describeCache.value;
  // Stale is fine for a version line: answer at once and look again behind it.
  if (describeCache.at) { void describeNow(); return describeCache.value; }
  return describeNow();
}

let describing = null;
function describeNow() {
  describing ||= readDescribe().finally(() => { describing = null; });
  return describing;
}

async function readDescribe() {
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
// Known before About first asks.
void describeNow();

/**
 * What a generation with these settings should take here, for the composer:
 * `ms` once this model's estimates are trusted, and `queueMs` when HEISS's own
 * queue has to finish first. Empty when there is nothing honest to say.
 */
app.get("/api/estimate", (req, res) => {
  const query = req.query || {};
  const body = {
    kind: query.kind === "video" ? "video" : "image",
    model: String(query.model || ""),
    profileId: String(query.profileId || ""),
    family: String(query.family || ""),
    width: Number(query.width) || 0,
    height: Number(query.height) || 0,
    count: Number(query.count) || 1,
    steps: Number(query.steps) || 0,
    frames: Number(query.frames) || 0
  };
  const now = Date.now();
  const estimate = generationEstimate(body, { now });
  // Variations run one after another as separate runs: the first as things stand, the rest with the model loaded.
  const runs = Math.max(1, Math.min(8, Number(query.runs) || 1));
  const rest = runs > 1 ? generationEstimate(body, { now, warm: true }) : null;
  // Smart upscale is part of each run: its time, from the upscales this machine has made, is added to every one.
  const upscaleQuality = body.kind === "image" && upscaleQualities.includes(query.upscale) ? query.upscale : "";
  const plan = upscaleQuality ? upscalePlan({ width: body.width, height: body.height, quality: upscaleQuality }) : null;
  const upscale = plan ? upscaleEstimate({ quality: upscaleQuality, faceDetail: query.faceDetail === "1", work: upscaleWork({ width: plan.estimatedWidth, height: plan.estimatedHeight, count: body.count }) }) : null;
  const trusted = estimate?.trusted && (runs === 1 || rest?.trusted) && (!plan || upscale?.trusted);
  const clears = queueClearsAt(now);
  const queueMs = clears === null ? null : Math.max(0, clears - now);
  const upscaleMs = upscale?.totalMs || 0;
  res.json({ ok: true, ...(trusted ? { ms: estimate.totalMs + upscaleMs + (runs - 1) * ((rest?.totalMs || 0) + upscaleMs) } : {}), ...(queueMs ? { queueMs } : {}) });
});

app.get("/api/stats", async (_req, res) => {
  const since = await commitsSinceRelease();
  res.json({ ok: true, version: appVersion, sinceRelease: since, stats: galleryStats(gallery) });
});

// What ComfyUI runs on (GPU, memory and the budget fit hints use). See server/hardware.js.
app.get("/api/hardware", async (_req, res) => {
  const stats = comfyCache.stats?.devices ? comfyCache.stats : await comfy("/system_stats", { signal: AbortSignal.timeout(3000) }).catch(() => null);
  res.json({ ok: true, hardware: await describeHardware({ stats, comfyUrl }) });
});

// Versions, system and GPU for a bug report (Settings › About, and a failed card's Copy report).
app.get("/api/diagnostics", async (_req, res) => {
  const since = await commitsSinceRelease();
  const install = fs.existsSync(path.join(root, ".git"))
    ? `Git checkout${since?.commits ? `, ${since.tag} + ${since.commits}` : ""}`
    : fs.existsSync(path.join(root, "release.json")) ? "release" : "";
  const stats = await fetch(`${comfyUrl}/system_stats`, { signal: AbortSignal.timeout(3000) }).then((response) => (response.ok ? response.json() : null), () => null);
  const report = diagnostics({ version: appVersion, install, stats, comfyLocal: comfyIsLocal() });
  res.json({ ok: true, ...report, text: diagnosticsText(report) });
});

// When this server process started, so the app can tell a restart (e.g. after an update) happened.
const serverStartedAt = Date.now();

// The latest lines of today's log (crash-log.js), for the crash kit and bug reports. This computer only.
app.get("/api/logs", (req, res) => {
  if (!requireLocal(req, res)) return;
  const lines = Math.max(1, Math.min(500, Number(req.query.lines || 100)));
  try {
    const text = fs.readFileSync(path.join(logDir, `heiss-${new Date().toISOString().slice(0, 10)}.log`), "utf8");
    res.type("text/plain").send(text.trimEnd().split("\n").slice(-lines).join("\n"));
  } catch {
    res.type("text/plain").send("");
  }
});

app.get("/api/health", async (req, res) => {
  try {
    // Only whether ComfyUI answers: its system_stats (command line, paths) stay here.
    await comfy("/system_stats");
    res.json({ ok: true, comfyUrl, startedAt: serverStartedAt, thisComputer: canAdmin(req), atComputer: clientOf(req).thisComputer });
  } catch (error) {
    res.status(503).json({ ok: false, thisComputer: canAdmin(req), atComputer: clientOf(req).thisComputer, restarting: comfyRestarting(), error: comfyRestarting() ? "ComfyUI is restarting." : error.message, startedAt: serverStartedAt });
  }
});

/** Switch to an address where ComfyUI turned up by itself, and remember it like a saved one. */
function adoptFoundComfy(found) {
  try {
    setComfyUrl(found);
  } catch {
    return false; // .env could not be written; the saved address stays.
  }
  comfyCache = { info: null, stats: null, fetchedAt: 0 };
  console.log(`    Found ComfyUI at ${found}. Using it from now on.\n`);
  return true;
}

app.get("/api/comfy/status", async function comfyStatus(req, res) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${comfyUrl}/system_stats`, { signal: controller.signal });
    noteComfyReachable();
    const latencyMs = Math.round(performance.now() - startedAt);
    if (!response.ok) {
      res.json({ connected: false, isMock: demoMode, url: comfyUrl, latencyMs, ...restartFields(), error: `HTTP ${response.status}${demoMode ? " (Demo Mode Active)" : ""}` });
      return;
    }
    const stats = await response.json();
    const device = stats?.devices?.[0]?.name || "";
    res.json({
      ...restartFields(),
      connected: true,
      url: comfyUrl,
      latencyMs,
      version: stats?.system?.comfyui_version || "",
      device,
      ...(res.locals.foundComfy ? { found: res.locals.foundComfy } : {})
    });
  } catch (error) {
    // Demo mode makes placeholder images without ComfyUI, so to the app it is connected.
    if (demoMode) {
      res.json({ connected: true, isMock: true, url: comfyUrl, latencyMs: 0, device: "Demo mode" });
      return;
    }
    // A timeout counts here too: this poll is the app asking whether ComfyUI is there.
    noteComfyFetchError(error?.name === "AbortError" ? new Error("timed out") : error);
    // Not at this address: on this computer it may well be on the other usual port (Desktop uses 8000).
    const found = comfyRestarting() || res.locals.foundComfy ? "" : await findComfyNow(comfyUrl);
    if (found && adoptFoundComfy(found)) {
      res.locals.foundComfy = found;
      return comfyStatus(req, res);
    }
    const latencyMs = Math.round(performance.now() - startedAt);
    const message = error?.name === "AbortError" ? "Connection timed out" : error?.message || "Connection failed";
    res.json({ connected: false, isMock: demoMode, url: comfyUrl, latencyMs, ...restartFields(), nearby: nearbyAddresses(comfyUrl), error: `${message}${demoMode ? " (Demo Mode Active)" : ""}` });
  } finally {
    clearTimeout(timeout);
  }
});

/**
 * A restart HEISS asked for, as the status poll reports it: restarting, since
 * when and how long it usually takes; and the one that just ended, so every
 * device that watched it can say how it went. The server's own watcher moves
 * the restart along; this only reads it.
 */
function restartFields() {
  const fields = {};
  const last = lastComfyRestart();
  if (last) fields.lastRestart = last;
  if (!comfyRestarting()) return fields;
  const estimate = comfyRestartEstimate();
  const startedAt = comfyRestartStartedAt();
  return { ...fields, restarting: true, restartStartedAt: startedAt, restartElapsedMs: Date.now() - startedAt, ...(estimate ? { restartTypicalMs: estimate.typicalMs } : {}) };
}

/** The node packs ComfyUI has loaded right now, or null when it cannot say. */
async function currentPacks(timeout = 8000) {
  try {
    return loadedPacks(await comfy("/object_info", { signal: AbortSignal.timeout(timeout) }));
  } catch {
    return comfyCache.info ? loadedPacks(comfyCache.info) : null;
  }
}

/**
 * Follows a restart until ComfyUI is back (or clearly is not), independent of
 * any tab polling, so its time is measured to about a second. Once back, it
 * compares the loaded packs with before and reads ComfyUI's startup log for
 * packs that failed to load. Only a plain restart, one that changed nothing,
 * counts toward the usual time.
 */
let restartWatch = null;
function watchComfyRestart() {
  if (restartWatch) return restartWatch;
  restartWatch = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    for (;;) {
      const up = await fetch(`${comfyUrl}/system_stats`, { signal: AbortSignal.timeout(1500) }).then((response) => response.ok, () => false);
      const step = noteComfyRestart(up);
      if (!step) return { ok: up, failedPacks: [] };
      if (step.phase === "failed") return { ok: false, failedPacks: [] };
      if (step.phase === "back") {
        const after = await currentPacks();
        const log = await comfy("/internal/logs/raw", { signal: AbortSignal.timeout(4000) }).then(logTextFromRaw, () => "");
        const changes = restartChanges(step.packs, after, failedPacks(log));
        if (changes.plain && step.durationMs) recordComfyRestart(step.durationMs);
        finishComfyRestart({
          durationMs: step.durationMs,
          newPacks: changes.newPacks.map(packLabel),
          failedPacks: changes.failedPacks.map(packLabel)
        });
        refreshComfyContextSoon();
        resetComfyPage().catch(() => {});
        return { ok: true, failedPacks: changes.failedPacks, newPacks: changes.newPacks };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  })().catch((error) => { console.warn(`[HEISS] Lost track of the ComfyUI restart: ${error.message}`); return { ok: false, failedPacks: [] }; }).finally(() => { restartWatch = null; });
  return restartWatch;
}

/** What to say when ComfyUI does not answer: restarting on purpose, or simply not there. */
function comfyDownMessage(detail = "") {
  if (comfyRestarting()) return "ComfyUI is restarting. Try again in a few seconds.";
  return `Can’t reach ComfyUI at ${comfyUrl}. Start it, then try again.${detail ? ` (${detail})` : ""}`;
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
  // "list:<file>": a file an imported workflow names, from ComfyUI-Manager's model list, resolved here again.
  const spec = String(req.body?.id || "").startsWith("list:") ? await listDownload(req.body.id) : catalogDownload(req.body?.id);
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

// First models for an empty studio, sized for this hardware. Their files are
// ordinary catalog downloads, fetched through the route above.
app.get("/api/starter-models", async (_req, res) => {
  const context = await loadComfyContext().catch(() => null);
  const hardware = await describeHardware({ stats: context?.stats, comfyUrl });
  res.json({ ok: true, hardware, local: downloadState().local, families: starterPlan({ hardware, info: context?.info }) });
});

app.post("/api/models/downloads/cancel", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = String(req.body?.id || "");
  const spec = req.body?.discard ? catalogDownload(id) : null;
  if (spec) discardDownload(spec);
  else cancelDownload(id);
  res.json({ ok: true, ...downloadState() });
});

// A Hugging Face token for gated downloads: kept in .env, only ever sent to huggingface.co, never shown back.
app.get("/api/settings/hf-token", (_req, res) => {
  res.json({ ok: true, ...hfTokenStatus(), mirror: hfEndpoint()?.origin || "" });
});

app.post("/api/settings/hf-token", (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json({ ok: true, ...saveHfToken(req.body?.token), mirror: hfEndpoint()?.origin || "" });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

// "Download again" for a catalog file a run found damaged: the broken copy goes first.
app.post("/api/models/downloads/replace", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  // "list:<file>": a file an imported workflow names, from ComfyUI-Manager's model list, resolved here again.
  const spec = String(req.body?.id || "").startsWith("list:") ? await listDownload(req.body.id) : catalogDownload(req.body?.id);
  if (!spec) {
    res.status(400).json({ ok: false, error: "Unknown file." });
    return;
  }
  try {
    res.json({ ok: true, download: replaceDownload(spec), ...downloadState() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/paths", async (_req, res) => {
  await autoDetectOutputDir();
  res.json({ outputDir: comfyOutputDir, galleryDir: dataDir, workflowsDir: userWorkflowsDir });
});

app.post("/api/config/output-dir", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    // Only a folder ComfyUI writes to: HEISS serves and clears what is in it.
    const choice = await outputDirChoice(req.body?.outputDir || "");
    if (!choice.ok) {
      res.status(400).json({ ok: false, error: choice.error, report: choice.report });
      return;
    }
    const outputDir = setComfyOutputDir(choice.dir);
    res.json({ ok: true, outputDir, galleryDir: dataDir, workflowsDir: userWorkflowsDir, report: await inspectOutputDir(outputDir) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/output-dir", async (req, res) => {
  if (!requireLocal(req, res)) return;
  await autoDetectOutputDir();
  res.json({ outputDir: comfyOutputDir, report: await inspectOutputDir(comfyOutputDir), canBrowse: clientOf(req).thisComputer });
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
  if (!clientOf(req).thisComputer) {
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

/** What the import picker offers besides a file: recent runs from ComfyUI's history and the workflows saved in ComfyUI. */
app.get("/api/workflows/sources", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const [history, saved] = await Promise.all([
    comfy("/history?max_items=64", { timeout: 15_000 }).catch(() => null),
    comfy("/userdata?dir=workflows&recurse=true&split=false&full_info=true", { timeout: 15_000 }).catch(() => null)
  ]);
  res.json({ ok: true, comfy: Boolean(history || saved), recent: history ? recentFromHistory(history) : [], saved: saved ? savedWorkflowList(saved) : [] });
});

/** A saved workflow's file from ComfyUI's user folder; the path stays inside "workflows/". */
async function savedWorkflowFile(relative = "") {
  const clean = String(relative).replace(/\\/g, "/");
  if (!clean || clean.split("/").some((part) => part === ".." || part.startsWith(".")) || !/\.json$/i.test(clean)) throw new Error("That isn’t a saved workflow.");
  const body = await comfy(`/userdata/${encodeURIComponent(`workflows/${clean}`)}`, { timeout: 15_000 });
  return body instanceof ArrayBuffer ? Buffer.from(body).toString("utf8") : body;
}

const importFetchers = {
  history: () => comfy("/history?max_items=200", { timeout: 20_000 }),
  saved: savedWorkflowFile
};
// ComfyUI's own page converts canvas workflows when Playwright is around; HEISS_COMFY_PAGE=0 turns it off.
const pageConvert = process.env.HEISS_COMFY_PAGE === "0" ? null : convertWithComfyPage;

app.post("/api/workflows/import/preview", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const body = req.body || {};
    const request = body.source || body.media ? body : { source: "file", workflow: body.workflow || body, filename: body.filename || "" };
    const { info } = await loadComfyContext().catch(() => ({ info: {} }));
    res.json({ ok: true, preview: await prepareImport(request, { info, fetchers: importFetchers, pageConvert }) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/workflows/import", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { info } = await loadComfyContext().catch(() => ({ info: {} }));
    // The review's own notes (the node list, what was guessed, the question) aren't part of the workflow.
    const { nodes: _nodes, guessed: _guessed, question: _question, confidence: _confidence, ...metadata } = req.body?.metadata || {};
    let normalized;
    if (req.body?.graph && typeof req.body.graph === "object") {
      // A graph from the preview (history, an image, a converted file).
      normalized = { graph: req.body.graph, heissUi: metadata };
    } else {
      const raw = req.body?.workflow || req.body;
      normalized = (Array.isArray(raw?.nodes) && Array.isArray(raw?.links)) || raw?.prompt
        ? { graph: (await prepareImport({ source: "file", workflow: raw, filename: req.body?.filename || "" }, { info, pageConvert })).graph, heissUi: metadata }
        : raw;
    }
    validateGraph(normalized.graph || normalized);
    const workflow = saveImportedWorkflow(normalized, metadata);
    const { graph, ...summary } = workflow;
    res.json({ ok: true, workflow: summary });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

/** What ComfyUI has loaded now: pack folders and node types, for the install health check. */
async function comfyLoadState() {
  const info = await comfy("/object_info", { timeout: 60_000 });
  return { loaded: loadedPacks(info), nodeTypes: Object.keys(info || {}) };
}

const setupDeps = {
  comfyState: comfyLoadState,
  restartComfy: restartComfyNow,
  // The restart watcher reports once ComfyUI is back (or clearly isn't).
  waitForRestart: async () => (await (restartWatch || watchComfyRestart())) || { ok: false, failedPacks: [] }
};

/**
 * Installs the node packs an import needs. Registry packs need no approval;
 * a pack from outside the registry is installed only when the person said yes
 * to it (`approved`).
 */
app.post("/api/workflows/setup", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const approved = new Set((req.body?.approved || []).map(String));
    const packs = (Array.isArray(req.body?.packs) ? req.body.packs : [])
      .filter((pack) => pack?.key && pack?.name && (pack.registry || approved.has(String(pack.key))))
      .slice(0, 24)
      .map((pack) => ({
        key: String(pack.key), name: String(pack.name).slice(0, 120), managerId: String(pack.managerId || ""),
        version: String(pack.version || ""), repository: String(pack.repository || ""), folder: String(pack.folder || ""),
        commit: /^[0-9a-f]{40}$/i.test(String(pack.commit || "")) ? String(pack.commit) : "", registry: Boolean(pack.registry)
      }));
    res.json({ ok: true, setup: startWorkflowSetup({ packs, workflowName: String(req.body?.workflowName || "").slice(0, 120) }, setupDeps) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/workflows/setup", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ ok: true, setup: workflowSetupState() });
});

app.post("/api/workflows/setup/undo", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json({ ok: true, undone: await undoWorkflowSetup(String(req.body?.snapshotId || ""), setupDeps) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/installs", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ ok: true, installs: installHistory() });
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

/** A gallery search from the query string (q, favorites=1), or null. Search results are never stacked. */
function searchFilter(req) {
  return galleryFilter({ q: String(req.query.q || "").slice(0, 200), favorites: req.query.favorites === "1" });
}

/** The gallery with its runs collapsed; a run can straddle a page, so it collapses first. */
function bundledPage(req) {
  const type = String(req.query.type || "");
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
  const cursor = String(req.query.cursor || "");
  const includeFailed = req.query.includeFailed !== "0";
  const filter = searchFilter(req);
  const merged = sortGallery(filterVisibleGallery(gallery)).filter((item) => {
    if (type && item.type !== type) return false;
    if (!includeFailed && item.status === "error") return false;
    if (filter && !filter(item)) return false;
    return item.status !== "canceled";
  });
  const collapsed = applyBundles(merged, { enabled: req.query.bundles !== "0" && !filter });
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
    : pageGallery({ type, limit: limit || 200, cursor, includeFailed, filter: searchFilter(req) });
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
  const delta = galleryDelta({ since, type, includeFailed, filter: searchFilter(req) });
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
  // Shared without its settings: the prompt and workflow inside the file stay in Hidden.
  const bytes = req.query.clean === "1" ? stripMetadata(asset.buffer).buffer : asset.buffer;
  if (asset.mime?.startsWith('video/')) sendMediaBuffer(req, res, bytes, asset.mime);
  else res.send(bytes);
});

app.get('/api/vault/video-preview/:id', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const asset = readVaultAsset(req, req.params.id, 'original');
  if (!asset || asset.item.type !== 'video') { res.status(404).end(); return; }
  try {
    const preview = await getPrivateVideoPreview(asset.buffer, req.params.id);
    if (req.query.poster === '1') await sendVideoPoster(req, res, preview);
    else sendMediaBuffer(req, res, preview);
  }
  catch { if (!res.headersSent) res.status(503).end(); }
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
    res.status(500).json({ ok: false, error: `Couldn’t save the LoRA library: ${error.message}` });
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

// What each LoRA ComfyUI lists was trained for and its trigger words, from the files themselves.
app.get("/api/loras/info", async (_req, res) => {
  try {
    const { info } = await loadComfyContext();
    res.json({ ok: true, loras: await loraInfos(optionsFor(info, "LoraLoader", "lora_name")) });
  } catch (error) {
    res.status(503).json({ ok: false, loras: {}, error: comfyDownMessage(error?.message) });
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

/* ------------------------------------------ Favourites, prompts, earlier work */

app.post("/api/gallery/favorite", (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).slice(0, 500);
  const changed = setGalleryFavorites(ids, Boolean(req.body?.favorite));
  res.json({ ok: true, items: revealGalleryItemsForRequest(changed), revision: galleryRevisionValue() });
});

// A Hidden image keeps its star inside Hidden's encrypted list.
app.post("/api/hidden/favorite", (req, res) => {
  const key = requireHiddenKey(req, res);
  if (!key) return;
  const favorite = Boolean(req.body?.favorite);
  const items = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).slice(0, 500)
    .map((id) => patchVaultItem(key, id, (item) => (favorite ? { favorite: true } : { favorite: undefined })))
    .filter(Boolean);
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.json({ ok: true, items, revision: vaultRevision() });
});

app.get("/api/prompts", (_req, res) => {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.json({ prompts: listPrompts(), enabled: promptHistoryEnabled() });
});

app.post("/api/prompts/enabled", (req, res) => {
  const prompts = setPromptHistoryEnabled(req.body?.enabled !== false);
  res.json({ ok: true, prompts, enabled: promptHistoryEnabled() });
});

app.post("/api/prompts/pin", (req, res) => {
  res.json({ ok: true, prompts: setPromptPinned(String(req.body?.text || ""), Boolean(req.body?.pinned)) });
});

app.post("/api/prompts/forget", (req, res) => {
  res.json({ ok: true, prompts: forgetPrompts([String(req.body?.text || "")]) });
});

app.post("/api/prompts/clear", (req, res) => {
  res.json({ ok: true, prompts: clearPromptHistory({ keepPinned: req.body?.keepPinned !== false }) });
});

app.get("/api/civitai", (_req, res) => {
  res.json(civitaiPrefs());
});

app.post("/api/civitai", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ ok: true, ...saveCivitaiPrefs({ enabled: req.body?.enabled === true }) });
});

// Adding folders of earlier images happens at the computer: it reads that computer's disks.
app.get("/api/library/folders", (req, res) => {
  if (!requireThisComputer(req, res)) return;
  res.json({ folders: libraryFolders() });
});

app.post("/api/library/folders", async (req, res) => {
  if (!requireThisComputer(req, res)) return;
  try {
    let dir = String(req.body?.path || "");
    if (!dir) {
      dir = await pickFolder(req.body?.start || "", "Choose a folder of earlier images");
      if (!dir) { res.json({ ok: true, canceled: true, folders: libraryFolders() }); return; }
    }
    // Which folder is ComfyUI's output decides how a folder is read (library.js), so find it first.
    await autoDetectOutputDir();
    const result = await addLibraryFolder(dir);
    res.json({ ok: true, ...result, folders: libraryFolders(), revision: galleryRevisionValue() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message, folders: libraryFolders() });
  }
});

app.post("/api/library/folders/:id/scan", async (req, res) => {
  if (!requireThisComputer(req, res)) return;
  try {
    await autoDetectOutputDir();
    res.json({ ok: true, ...(await scanLibraryFolder(req.params.id)), folders: libraryFolders(), revision: galleryRevisionValue() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message, folders: libraryFolders() });
  }
});

app.delete("/api/library/folders/:id", (req, res) => {
  if (!requireThisComputer(req, res)) return;
  res.json({ ok: true, ...removeLibraryFolder(req.params.id), folders: libraryFolders(), revision: galleryRevisionValue() });
});

app.post("/api/library/output", async (req, res) => {
  if (!requireThisComputer(req, res)) return;
  try {
    await autoDetectOutputDir();
    res.json({ ok: true, output: true, ...(await importOutputFolder()), revision: galleryRevisionValue() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/library/file", (req, res) => {
  const file = libraryFile(req.query.folder, req.query.path);
  if (!file) { res.status(404).json({ ok: false, error: "That image is gone." }); return; }
  const disposition = req.query.download === "1" ? "attachment" : "inline";
  res.sendFile(file, { headers: { "Cache-Control": "private, max-age=0, must-revalidate", "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(path.basename(file))}` } });
});

app.get('/api/library/video-preview', async (req, res) => {
  const file = libraryFile(req.query.folder, req.query.path);
  if (!file || !/\.(mp4|webm|mov|mkv)$/i.test(file)) { res.status(404).end(); return; }
  try {
    const identity = `library:${String(req.query.folder)}:${String(req.query.path)}`;
    if (req.query.poster === '1') await sendVideoPoster(req, res, await getFileVideoPoster(file, identity));
    else sendVideoPreview(req, res, await getFileVideoPreview(file, identity));
  }
  catch { if (!res.headersSent) res.status(503).end(); }
});

app.get("/api/library/thumb", async (req, res) => {
  const file = libraryFile(req.query.folder, req.query.path);
  if (!file || !/\.(png|jpe?g|webp|gif|avif)$/i.test(file)) { res.status(404).end(); return; }
  try {
    const thumbnail = await getFileThumbnail(file);
    if (!thumbnail) { res.status(404).end(); return; }
    if (thumbnail.original) { res.sendFile(file, { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } }); return; }
    if (req.headers["if-none-match"] === thumbnail.etag) { res.status(304).end(); return; }
    if (thumbnail.etag) res.setHeader("ETag", thumbnail.etag);
    res.setHeader("Cache-Control", "private, no-cache");
    res.type("image/webp");
    await pipeline(fs.createReadStream(thumbnail.file), res);
  } catch (error) {
    if (!res.headersSent) res.status(502).json({ error: error.message }); else res.destroy();
  }
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
      source: ["generation", "hidden"].includes(req.query.source) ? req.query.source : "upload",
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
  if (!asset) return res.status(404).json({ ok: false, error: "That reference image is gone." });
  res.type(asset.mime).setHeader("Cache-Control", "private, max-age=3600");
  res.sendFile(asset.file);
});

app.get("/api/reference-assets/:id/thumbnail", (req, res) => {
  const asset = readUploadedReference(req.params.id, "thumbnail");
  if (!asset) return res.status(404).json({ ok: false, error: "That reference image is gone." });
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
    if (!response.ok) detail = `It answered with HTTP ${response.status}. Is that ComfyUI?`;
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
      res.status(400).json({ error: "Enter a prompt." });
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
  // Smart upscale: the run's images upscale at this effort as part of the run itself (smartUpscalePrepare).
  const autoUpscale = req.body?.autoUpscale;
  body.autoUpscale = body.kind === "image" && upscaleQualities.includes(autoUpscale?.quality)
    ? { quality: autoUpscale.quality, faceDetail: Boolean(autoUpscale.faceDetail) }
    : null;
  // Recent prompts are the gallery's: nothing made for Hidden is ever written there.
  if (!body.privateVault) try { recordPrompt(body.prompt); } catch { /* a run matters more than its history */ }
  // An older page (or a draft restored from before the reference library) can
  // send only the image's id; treat it as the reference instead of losing it.
  if (!isMockJob && !body.referenceAssets?.length && body.startImageId && !body.startImage) {
    // Not a library id (an old start-image upload): keep the legacy path for it.
    body.referenceAssets = await stageReferenceAssets(req, [{ slot: "reference", assetId: body.startImageId }], { unique: body.privateVault, generation: body }).catch(() => []);
  }
  if (!isMockJob && body.referenceAssets?.length && !body.referenceAssets.every((item) => item.comfyName)) {
    try {
      body.referenceAssets = await stageReferenceAssets(req, body.referenceAssets, { unique: body.privateVault, generation: body });
      body.startImageId ||= body.referenceAssets[0]?.assetId || "";
      body.startImageName ||= body.referenceAssets[0]?.name || "";
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
      return;
    }
  }
  // A painted mask becomes a crop, its masks and where to stitch them back (inpaint.js).
  // The mask itself goes no further: it is never stored with the run.
  if (body.inpaint) {
    try {
      body.inpaint = isMockJob ? null : await prepareInpaint(req, body);
    } catch (error) {
      await forgetComfyRun({ inputNames: (body.referenceAssets || []).filter((item) => item.temporary).map((item) => item.comfyName) });
      res.status(400).json({ ok: false, error: error.message });
      return;
    }
  }
  // An empty painted mask falls back to a normal run, so apply normal sizing too.
  if (body.inpaint?.box) {
    const { box, image, work } = body.inpaint;
    console.log(`[HEISS] Inpaint: repainting ${box.width}×${box.height} at ${box.x},${box.y} of ${image?.width}×${image?.height}, sampled at ${work.width}×${work.height}, strength ${body.inpaint.strength}`);
  }
  // Said back to the page: a mask was sent but nothing in it was painted, so this runs as a plain edit.
  const inpaintSkipped = Boolean(!isMockJob && req.body?.inpaint?.mask && !body.inpaint);
  if (!isMockJob && req.body?.inpaint && !body.inpaint && body.referenceAssets?.length) {
    try {
      const [first, ...others] = body.referenceAssets;
      const [replacement] = await stageReferenceAssets(req, [first], { unique: body.privateVault, generation: body });
      if (first.temporary) await forgetComfyRun({ inputNames: [first.comfyName] });
      body.referenceAssets = [replacement, ...others];
    } catch (error) {
      await forgetComfyRun({ inputNames: (body.referenceAssets || []).filter((item) => item.temporary).map((item) => item.comfyName) });
      res.status(400).json({ ok: false, error: error.message });
      return;
    }
  }
  // Plain img2img samples at the staged image's size, irrespective of the empty latent controls.
  const startSize = body.referenceAssets?.[0];
  const inputFamily = families[body.family];
  if (!body.inpaint && inputFamily?.img2img && !inputFamily.references && startSize?.width) {
    body.requestedSize = { width: body.width, height: body.height };
    body.width = startSize.width;
    body.height = startSize.height;
  }
  // Every image this run handed ComfyUI: all of them go after a Hidden run, and
  // after a normal one, temporary resized copies and any Hidden references.
  const staged = (body.referenceAssets || []).filter((item) => item.comfyName);
  const inpaintNames = inpaintInputNames(body.inpaint);
  body.stagedInputNames = [...staged.map((item) => item.comfyName), ...inpaintNames];
  const fromHiddenImage = String(body.referenceAssets?.[0]?.assetId || "").startsWith("vault:");
  body.hiddenInputNames = [
    ...staged.filter((item) => item.temporary || String(item.assetId || "").startsWith("vault:")).map((item) => item.comfyName),
    ...(fromHiddenImage ? inpaintNames : [])
  ];
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
  res.json({ jobId: id, items, hidden: body.privateVault, revision: galleryRevisionValue(), ...(inpaintSkipped ? { notice: "Nothing painted showed up in the mask, so this ran as a normal edit of the whole picture." } : {}) });
  if (isMockJob) {
    setTimeout(() => runMockJob(id, body), 0);
  } else {
    setTimeout(() => runJob(id, body, { prepare: body.autoUpscale ? (graph) => smartUpscalePrepare(graph, body) : null }).catch(() => null), 0);
  }
});

/** Setup polls with fresh=1 so a node pack installed a moment ago is not hidden behind the 30s cache. */
async function upscaleContext(res, { force = false } = {}) {
  try {
    const { info } = await loadComfyContext({ force });
    return info;
  } catch {
    res.status(503).json({ ok: false, offline: true, restarting: comfyRestarting(), error: comfyRestarting() ? "ComfyUI is restarting. Smart upscale is back when it’s done." : "ComfyUI is offline, so smart upscale isn’t available.", install: installState() });
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
    res.status(400).json({ ok: false, error: status.nodesInstalled ? "The SeedVR2 models aren’t installed yet." : `ComfyUI is missing the SeedVR2 nodes: ${status.missingNodes.join(", ")}.`, status });
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
    res.status(404).json({ ok: false, reason: "missing", error: "This image is no longer in the gallery. It may have been deleted on another device. Reload the page." });
    return;
  }
  if (item.type !== "image") {
    res.status(400).json({ ok: false, reason: "video", error: "Only images can be upscaled." });
    return;
  }
  if (item.library) {
    res.status(400).json({ ok: false, reason: "library", error: "Images from an added folder stay in that folder, so they can’t be upscaled." });
    return;
  }
  if (item.status !== "done") {
    res.status(409).json({ ok: false, reason: "unfinished", error: "This image is still rendering. Upscale it when it’s done." });
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
    res.status(400).json({ ok: false, reason: "source", error: `Couldn’t read the original image: ${error.message}` });
    return;
  }
  if (!imageName) {
    res.status(502).json({ ok: false, reason: "source", error: "ComfyUI didn’t accept the original image. Make sure ComfyUI is running and can write to its input folder." });
    return;
  }
  const customWorkflow = String(item.model || "").startsWith("custom:") ? getCustomWorkflow(item.model) : null;
  const { jobId, plan } = startUpscale({ item, imageName, quality, faceDetail, info, customWorkflow, hiddenKey: hiddenItem ? hiddenKey : null });
  res.json({ ok: true, jobId, plan, revision: galleryRevisionValue() });
});

/**
 * Smart upscale (2K / 4K in the size menu) goes into the run's own graph, so
 * a run and its upscale are one ComfyUI job (run-upscale.js). When ComfyUI's
 * node list is out of reach the run still goes ahead, without the upscale.
 */
async function smartUpscalePrepare(graph, body) {
  const { info } = await loadComfyContext().catch(() => ({ info: null }));
  if (!info) return { skipped: "Smart upscale couldn’t check ComfyUI’s nodes", quality: body.autoUpscale?.quality };
  const customWorkflow = String(body.model || "").startsWith("custom:") ? getCustomWorkflow(body.model) : null;
  return planRunUpscale(graph, body, info, customWorkflow);
}

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
  if (job.promptId) await cancelPrompt(job.promptId).catch(() => null);
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
    // Nothing here runs it any more (HEISS restarted): only the tile is left to settle.
    // Its prompt id went with the job, so ComfyUI is left alone rather than interrupted blindly.
    const changed = updateGalleryJob(req.params.id, { status: "canceled" });
    res.json({ ok: true, stale: true, changed });
    return;
  }
  jobs.set(req.params.id, { ...job, status: "canceling" });
  // Its pictures are saved and only Smart upscale is left: they stay, and runJob delivers them.
  if (!job.keepsPicture) updateGalleryJob(req.params.id, { status: "canceled" });
  // Without a prompt id yet, runJob takes it back out of ComfyUI as soon as /prompt answers.
  if (job.promptId) await cancelPrompt(job.promptId).catch(() => null);
  res.json({ ok: true });
});

app.post("/api/queue/cancel", async (_req, res) => {
  const promptIds = cancelOwnJobs();
  setGallery(gallery.map((item) => (item.status === "pending" && !jobs.get(item.jobId)?.keepsPicture ? { ...item, status: "canceled" } : item)));
  saveGallery();
  // Only HEISS's own prompts: ComfyUI's queue also holds runs from its own UI and other apps.
  await cancelPrompts(promptIds);
  res.json({ ok: true });
});

app.post("/api/gallery/clear", (req, res) => {
  if (!requireAdmin(req, res)) return;
  // Clearing the gallery never touches Hidden; that has its own erase. Nor images
  // shown from another folder (library.js): their files are not in the output
  // folder, so no trash could bring them back; Settings › Library removes those.
  const clears = (item) => item.status === "done" && !item.privateVault && !item.library;
  const cleared = gallery.filter(clears);
  // Into the trash, not deleted: it can be put back until the trash empties itself (gallery-trash.js).
  const trash = trashGalleryItems(cleared);
  hideGalleryItems(cleared);
  setGallery(gallery.filter((item) => !clears(item)));
  saveGallery();
  res.json({ ok: true, files: { deleted: trash.moved, skipped: trash.skipped }, trash: { batch: trash.batch, moved: trash.moved, days: trashSummary().days }, outputs: revealGalleryItemsForRequest(filterVisibleGallery(gallery)) });
});

app.get("/api/gallery/trash", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ ok: true, ...trashSummary() });
});

// Undo for a clear, or Settings' Restore: the newest batch unless one is named.
app.post("/api/gallery/trash/restore", (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { restored, missing } = restoreTrash(String(req.body?.batch || ""));
    if (restored.length) addGalleryItems(restored);
    res.json({ ok: true, restored: restored.length, missing, revision: galleryRevisionValue(), trash: trashSummary(), outputs: revealGalleryItemsForRequest(filterVisibleGallery(gallery)) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/gallery/trash/empty", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const removed = await emptyTrash();
    res.json({ ok: true, removed, trash: trashSummary() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
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
  const promptIds = cancelOwnJobs();
  setGallery(gallery.filter((item) => item.status === "done").map(({ preview, progress, ...item }) => item).slice(0, galleryLimit));
  saveGallery();
  await cancelPrompts(promptIds);
  await freeComfyMemory().catch(() => null);
  res.json({ ok: true, outputs: revealGalleryItemsForRequest(filterVisibleGallery(gallery)) });
});

// Unloads models and frees what ComfyUI caches, without touching any run: ComfyUI does it between prompts.
app.post("/api/comfy/free", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    await freeComfyMemory();
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({ ok: false, error: comfyDownMessage(error?.message) });
  }
});

/** Marks every HEISS job still waiting or running as canceled, and returns the prompt ids ComfyUI knows them by. */
function cancelOwnJobs() {
  const promptIds = [];
  for (const [id, job] of jobs) {
    if (job.status === "queued" || job.status === "running" || job.status === "canceling") {
      if (job.promptId) promptIds.push(job.promptId);
      // Only upscaling now: its pictures stay, and runJob delivers them once ComfyUI lets go.
      if (job.keepsPicture) {
        jobs.set(id, { ...job, status: "canceling" });
        continue;
      }
      setTerminalJob(id, { status: "canceled" });
      updateGalleryJob(id, { status: "canceled" });
    }
  }
  return promptIds;
}

function freeComfyMemory() {
  return comfy("/free", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }), timeout: 15_000 });
}

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
  if (!clientOf(req).thisComputer) {
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
    // `override`: the person was told ComfyUI-Manager refused it and chose to install anyway.
    res.json({ ok: true, install: await startPackInstall(String(req.params.id), { overrideManager: req.body?.override === "manager-security" }) });
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

/**
 * Restarts ComfyUI through ComfyUI-Manager and starts following it. ComfyUI is
 * started outside HEISS UI, so only Manager can restart it in place.
 * Resolves to { ok } or { ok: false, status, error }.
 */
async function restartComfyNow() {
  // A dropped connection below means "already going down" only if ComfyUI was
  // up to begin with; otherwise "restarting" would show for minutes over nothing.
  const up = await fetch(`${comfyUrl}/system_stats`, { signal: AbortSignal.timeout(4000) }).then((response) => response.ok, () => false);
  if (!up) return { ok: false, status: 503, error: "ComfyUI isn’t running. Start it and the studio connects." };
  // What ComfyUI has loaded now, so the restart can tell what it brought in.
  const packs = await currentPacks(6000);
  const begin = () => {
    beginComfyRestart(Date.now(), { packs });
    watchComfyRestart();
  };
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
      begin();
      return { ok: true };
    }
    if (response.ok) {
      begin();
      return { ok: true };
    }
    if (response.status === 403) return { ok: false, status: 403, error: "ComfyUI-Manager’s security level blocks the restart. Set security_level = normal in Manager’s config.ini, or restart ComfyUI yourself." };
    if (response.status !== 404 && response.status !== 405) sawManager = true;
  }
  return { ok: false, status: 501, error: sawManager ? "ComfyUI-Manager couldn’t restart ComfyUI." : "Restarting needs ComfyUI-Manager, which newer ComfyUI versions turn off. Start ComfyUI with --enable-manager." };
}

app.post("/api/comfy/restart", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const result = await restartComfyNow();
  if (result.ok) res.json({ ok: true });
  else res.status(result.status || 500).json({ ok: false, error: result.error });
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
    forgetPrivateVideoPreviews(id);
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
    res.status(404).json({ ok: false, error: "Set ComfyUI’s output folder first (Settings › Library)." });
    return;
  }
  openFolder(comfyOutputDir);
  res.json({ ok: true, outputDir: comfyOutputDir });
});

app.get("/api/update/status", async (req, res) => {
  if (!requireLocal(req, res)) return;
  const auto = req.query.auto === "1";
  try {
    res.json(await updateStatus({ fresh: req.query.fresh === "1", auto }));
  } catch (error) {
    // The automatic check never reports a failure: offline is a choice, not news.
    if (auto) res.json({ ok: false, available: false, quiet: true });
    else res.status(500).json({ ok: false, available: false, error: error.message });
  }
});

app.post("/api/update/prefs", (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json({ ok: true, prefs: saveUpdatePrefs(dataDir, req.body || {}) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
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
        res.json({ ...before, updated: false, message: before.unsigned
          ? `HEISS UI ${before.latest} isn’t signed with the release key, so it wasn’t installed. To install it anyway, download it from ${before.url} and replace this folder, keeping the data folder.`
          : `HEISS UI ${before.latest} is available. Download it from ${before.url} and replace this folder, keeping the data folder.` });
        return;
      }
      if (before.download?.status === "ready") { res.json({ ...before, updated: false }); return; }
      res.json({ ...before, updated: false, download: await startReleaseUpdate(root) });
      return;
    }
    const branch = before.branch && before.branch !== "HEAD" ? before.branch : "main";
    // Refuses local changes, and goes back to this commit if the new one will not install or build.
    const { pull, install, build } = await updateCheckout({ run: runRepoCommand, npm: npmCommand, branch, log: (message) => console.warn(`[HEISS] ${message}`) });
    const after = await updateStatus();
    res.json({ ...after, updated: true, restartRequired: true, logs: { pull, install, build } });
  } catch (error) {
    res.status(500).json({ ok: false, updated: false, error: error.message, ...(error.rolledBack ? { rolledBack: true } : {}), ...(error.localChanges ? { localChanges: error.localChanges } : {}) });
  }
});

// Only a release started through scripts/start.mjs can restart itself (and swap in an update).
app.post("/api/update/restart", (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!requestRestart()) {
    res.status(409).json({ ok: false, error: "This copy wasn’t started with its launcher, so it can’t restart from here. Stop it and start it again." });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/shutdown", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 250);
});

app.get('/comfy/video-preview', async (req, res) => {
  const filename = String(req.query.filename || '');
  const subfolder = String(req.query.subfolder || '');
  const type = String(req.query.type || 'output');
  if (!['output', 'input', 'temp'].includes(type) || !/\.(mp4|webm|mov|mkv)$/i.test(filename) || filename !== path.basename(filename) || /[\\/]/.test(filename) || inDotFolder(subfolder)) {
    res.status(404).end(); return;
  }
  try {
    // The still comes from the original, ahead of any preview still being encoded.
    if (req.query.poster === '1') await sendVideoPoster(req, res, await getComfyVideoPoster(filename, subfolder, type));
    else sendVideoPreview(req, res, await getComfyVideoPreview(filename, subfolder, type));
  }
  catch { if (!res.headersSent) res.status(503).end(); }
});

app.get("/comfy/thumb", async (req, res) => {
  const filename = String(req.query.filename || "");
  const subfolder = String(req.query.subfolder || "");
  const type = String(req.query.type || "output");
  if (!filename) { res.status(400).json({ error: "filename is required." }); return; }
  // The same outputs /comfy/view serves, and nothing else.
  if (!["output", "input", "temp"].includes(type) || !outputMediaPattern.test(filename) || inDotFolder(req.query.subfolder)) { res.status(404).json({ error: "Not an output." }); return; }
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

/**
 * "Share without settings" for an output: the whole file, with the prompt and
 * workflow ComfyUI wrote into it taken out (metadata-strip.js). Buffered, since
 * the file changes; never cached, since the plain one lives at the same address.
 */
async function sendWithoutSettings(req, res, localFile) {
  const params = new URLSearchParams(Object.entries(req.query).filter(([key]) => key !== "clean").map(([key, value]) => [key, String(value)]));
  let bytes = null;
  let type = "";
  const known = comfyRecentlyUnreachable() ? localFile() : null;
  if (!known) {
    try {
      const response = await fetch(`${comfyUrl}/view?${params}`, { signal: AbortSignal.timeout(120000) });
      noteComfyReachable();
      if (!response.ok) {
        res.status(response.status).json({ ok: false, error: "ComfyUI doesn’t have this file." });
        return;
      }
      bytes = Buffer.from(await response.arrayBuffer());
      type = response.headers.get("content-type") || "";
    } catch (error) {
      noteComfyFetchError(error);
    }
  }
  if (!bytes) {
    const file = known || localFile();
    if (!file) {
      res.status(502).json({ ok: false, error: "ComfyUI isn’t answering and the file isn’t in the output folder." });
      return;
    }
    bytes = fs.readFileSync(file);
    type = "";
  }
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.type(type || path.extname(String(req.query.filename || "")) || "application/octet-stream");
  res.send(stripMetadata(bytes).buffer);
}

app.get("/comfy/*path", async (req, res) => {
  try {
    const query = req.originalUrl.split("?")[1] ? `?${req.originalUrl.split("?")[1]}` : "";
    const proxyPath = Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path;
    // Only ComfyUI's image route, for images, videos and sound among its outputs, inputs
    // and previews. Its other GET routes (settings, logs, Manager's) are not for the studio's visitors,
    // and neither are dot folders among the outputs (the gallery's trash, gallery-trash.js).
    if (proxyPath !== "view" || !["output", "input", "temp"].includes(String(req.query.type || "output")) || !outputMediaPattern.test(String(req.query.filename || "")) || inDotFolder(req.query.subfolder)) {
      res.status(404).json({ ok: false, error: "Not an output." });
      return;
    }
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
    if (req.query.clean === "1") {
      await sendWithoutSettings(req, res, localFile);
      return;
    }
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
app.all("/api/*splat", (_req, res) => res.status(404).json({ ok: false, error: "Unknown API route. If HEISS UI was updated, restart it." }));

if (fs.existsSync(dist)) serveApp(app, dist);

setTimeout(() => recoverGalleryFromHistory().catch(() => null)
  // A library scan skips the output folder, so it has to be known before one runs.
  .then(() => (libraryFolders().length ? autoDetectOutputDir() : null))
  .then(() => rescanLibraryFolders())
  // Videos imported before their size was read get it now.
  .then(() => fillVideoSizes()).catch(() => null), 1200);
scheduleTrashPurge();
warmReleaseCheck(root, dataDir);
try { removeForeignLaunchers(root); } catch { /* a launcher in use or read-only: harmless */ }

// Under `npm run dev*` the page comes from Vite, which forwards to this exact port, so it stays put there.
const dev = /^dev/.test(process.env.npm_lifecycle_event || "");
startServers(app, {
  host,
  port,
  fallback: !dev,
  onFatal(error) {
    let message = `\n  HEISS UI couldn’t start: ${error.message}\n`;
    // Where the running copy answered: this computer, or the one address HOST names.
    const runningHost = !error.host || error.host === "127.0.0.1" ? "localhost" : error.host.includes(":") ? `[${error.host}]` : error.host;
    if (error.heissRunning) message = `\n  HEISS UI is already running: http://${runningHost}:${error.port}\n`;
    else if (error.code === "EADDRINUSE") message = dev
      ? `\n  Port ${port} is already in use. Stop what uses it, or set another PORT in .env.\n`
      : `\n  Ports ${port} to ${port + 9} are all in use. Set another PORT in .env.\n`;
    console.error(message);
    // A distinct code, so scripts/start.mjs does not blame (and roll back) a fresh update for it.
    const exit = () => process.exit(error.code === "EADDRINUSE" ? PORT_IN_USE_CODE : 1);
    // The launcher opens the copy that is already running instead.
    if (error.heissRunning && process.send) process.send({ type: "already-running", url: `http://${runningHost}:${error.port}` }, exit);
    else exit();
  },
  onListening({ plan, port: listening, moved }) {
    // From here on everything that names the address (banner, phone links in Settings) uses this one.
    setListeningPort(listening);
    if (moved) console.log(`\n  Port ${requestedPort} is in use, so HEISS UI is on ${listening} this time.`);
    // localhost rather than 127.0.0.1: same server, but browsers only allow passkeys
    // (Touch ID, Windows Hello for Hidden) on a name, never on an address.
    const shownHost = host === "0.0.0.0" || host === "::" || host === "127.0.0.1" ? "localhost" : host;
    const pagePort = dev ? 5173 : listening;
    Promise.resolve(printBanner({ version: appVersion, url: `http://${shownHost}:${pagePort}`, comfyUrl })).then(async () => {
      // Listening beyond this computer: say where a phone can open it.
      if ((host === "0.0.0.0" || host === "::") && !plan.tlsProblem) {
        const addresses = plan.httpsHost
          ? startupTls.names.filter((name) => !name.startsWith("*.")).map((name) => `https://${name.includes(":") ? `[${name}]` : name}:${httpsPort}`)
          : Object.values(os.networkInterfaces()).flatMap((entries) => entries || []).filter((entry) => entry.family === "IPv4" && !entry.internal).map((entry) => `http://${entry.address}:${pagePort}`);
        for (const address of addresses) console.log(`    ➜  Network   ${address}`);
        if (addresses.length) console.log(studioPasswordSet()
          ? "    Other devices sign in with the studio password.\n"
          : isPrivacyEnabled()
            ? "    Other devices sign in with your Hidden password until you set a studio password (Settings › Connection).\n"
            : "    Other devices sign in with a studio password: set one in Settings › Connection first.\n");
      }
      // Starting before ComfyUI is fine, but say so instead of leaving people to guess.
      const answering = await fetch(`${comfyUrl}/system_stats`, { signal: AbortSignal.timeout(3000) }).then((response) => response.ok, () => false);
      const found = answering || demoMode ? "" : await findComfy({ current: comfyUrl });
      if (!(found && adoptFoundComfy(found)) && !answering && !demoMode) console.log(`    ComfyUI isn’t answering at ${comfyUrl} yet. The studio connects once it starts.\n`);
    }).catch(() => {});
    // Tells scripts/start.mjs this version runs, so a fresh update is kept, and where to open it.
    process.send?.({ type: "ready", version: appVersion, url: `http://${shownHost}:${pagePort}` });
  }
});

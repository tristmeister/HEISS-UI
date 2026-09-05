import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { allowLanActions, comfy, comfyOutputDir, comfyUrl, host, isLocalClient, isTrustedClient, port, root, setComfyOutputDir } from './comfy.js';
import { inferModels, mockModelResult } from './models.js';
import { sanitizeGenerateBody } from './validation.js';
import { dedupeGallery, deleteGalleryFiles, filterVisibleGallery, gallery, galleryLimit, dataDir, hideGalleryItems, makePendingItems, recordsFromComfyHistory, saveGallery, setGallery, cleanupGalleryState, updateGalleryJob, pageGallery, galleryDelta, galleryRevisionValue, sortGallery, writeGalleryNow } from './gallery-store.js';
import { jobs, runJob, runMockJob, setTerminalJob } from './jobs.js';
import { deleteImportedWorkflow, saveImportedWorkflow, userWorkflowsDir } from './custom-workflows.js';
import { applyBundles, createBundles, DEFAULT_COOLDOWN_MINUTES, dissolveBundle, listBundles, pendingSummary, setBundleCover } from './gallery-bundles.js';
import { loadWorkflowPreferences, markWorkflowUsed, previewWorkflowImport, saveWorkflowPreferences, workflowSummaries } from './workflow-catalog.js';
import { saveStartImage } from './start-images.js';
import { clearUnlockCookie, encryptionKeyFromRequest, isPrivacyEnabled, privacyStatusFor, revealGalleryItemsForRequest, setPrivacyPassword, setUnlockCookie, verifyPrivacyPassword } from './privacy.js';
import { clearVault, compactVaultBundles, deleteVaultItem, dissolveVaultBundle, exportVaultBackup, readVaultAsset, setVaultBundleCover, vaultBundlePendingSummary, vaultConfigured, vaultGalleryItemsForRequest, vaultStatusFor } from './vault.js';

const app = express();
app.use(express.json({ limit: "25mb" }));
const execFileAsync = promisify(execFile);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
let comfyCache = { info: null, stats: null, fetchedAt: 0 };

async function loadComfyContext({ force = false } = {}) {
  const fresh = !force && comfyCache.info && Date.now() - comfyCache.fetchedAt < 30000;
  if (fresh) return comfyCache;
  const info = await comfy("/object_info");
  const stats = await comfy("/system_stats").catch(() => ({}));
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
    res.status(403).json({ ok: false, error: "Set a privacy password on this computer before using LAN mode." });
    return;
  }
  if (!encryptionKeyFromRequest(req)) {
    res.status(401).json({ ok: false, locked: true, error: "Unlock J AI Studio with the LAN password." });
    return;
  }
  next();
}

app.use(requireLanUnlock);

async function runRepoCommand(command, args) {
  const { stdout = "", stderr = "" } = await execFileAsync(command, args, {
    cwd: root,
    timeout: 600000,
    maxBuffer: 1024 * 1024
  });
  return `${stdout}${stderr}`.trim();
}

async function updateStatus() {
  if (!fs.existsSync(path.join(root, ".git"))) {
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

app.get("/api/privacy/status", (req, res) => {
  res.json({ ...privacyStatusFor(req), vault: vaultStatusFor(req) });
});

app.get("/api/network", (req, res) => {
  if (!requireLocal(req, res)) return;
  const addresses = Object.values(os.networkInterfaces()).flatMap((entries) => entries || [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
  res.json({ addresses, port });
});

app.post("/api/privacy/setup", (req, res) => {
  if (!requireLocal(req, res)) return;
  try {
    if (isPrivacyEnabled()) {
      res.status(400).json({ ok: false, error: "Privacy password is already set." });
      return;
    }
    const key = setPrivacyPassword(req.body?.password || "");
    setUnlockCookie(res, key);
    writeGalleryNow();
    res.json({ ok: true, ...privacyStatusFor(req), enabled: true, unlocked: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/privacy/unlock", (req, res) => {
  if (!requireTrustedAccess(req, res)) return;
  const key = verifyPrivacyPassword(req.body?.password || "");
  if (!key) {
    res.status(401).json({ ok: false, locked: true, error: "Password did not match." });
    return;
  }
  setUnlockCookie(res, key);
  res.json({ ok: true, enabled: true, unlocked: true });
});

app.post("/api/privacy/lock", (_req, res) => {
  if (!requireTrustedAccess(_req, res)) return;
  clearUnlockCookie(res);
  res.json({ ok: true, enabled: isPrivacyEnabled(), unlocked: false });
});

app.get("/api/health", async (_req, res) => {
  try {
    const stats = await comfy("/system_stats");
    res.json({ ok: true, comfyUrl, stats });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
  }
});

app.get("/api/comfy/status", async (_req, res) => {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`${comfyUrl}/system_stats`, { signal: controller.signal });
    const latencyMs = Math.round(performance.now() - startedAt);
    if (!response.ok) {
      res.json({ connected: false, isMock: true, url: comfyUrl, latencyMs, error: `HTTP ${response.status} (Demo Mode Active)` });
      return;
    }
    const stats = await response.json();
    const device = stats?.devices?.[0]?.name || "";
    res.json({
      connected: true,
      url: comfyUrl,
      latencyMs,
      version: stats?.system?.comfyui_version || "",
      device
    });
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const message = error?.name === "AbortError" ? "Connection timed out" : error?.message || "Connection failed";
    res.json({ connected: false, isMock: true, url: comfyUrl, latencyMs, error: `${message} (Demo Mode Active)` });
  } finally {
    clearTimeout(timeout);
  }
});

app.get("/api/models", async (_req, res) => {
  try {
    const { info, stats } = await loadComfyContext({ force: true });
    res.json(inferModels(info, stats));
  } catch {
    res.json(mockModelResult());
  }
});

app.get("/api/paths", (_req, res) => {
  res.json({ outputDir: comfyOutputDir, galleryDir: dataDir, workflowsDir: userWorkflowsDir });
});

app.post("/api/config/output-dir", (req, res) => {
  if (!requireLocal(req, res)) return;
  try {
    const outputDir = setComfyOutputDir(req.body?.outputDir || "");
    res.json({ ok: true, outputDir, galleryDir: dataDir, workflowsDir: userWorkflowsDir });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/workflows", async (_req, res) => {
  try {
    const { info, stats } = await loadComfyContext().catch(() => ({ info: {}, stats: {} }));
    const models = Object.keys(info || {}).length ? inferModels(info, stats) : mockModelResult();
    const preferences = loadWorkflowPreferences();
    res.json({ workflows: workflowSummaries({ info, profiles: models.profiles, preferences }), preferences });
  } catch {
    const models = mockModelResult();
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
  if (!requireLocal(req, res)) return;
  try {
    const raw = req.body?.workflow || req.body;
    const { info } = await loadComfyContext().catch(() => ({ info: {} }));
    res.json({ ok: true, preview: previewWorkflowImport(raw, req.body?.filename || "", info) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/workflows/import", async (req, res) => {
  if (!requireLocal(req, res)) return;
  try {
    const raw = req.body?.workflow || req.body;
    const { info } = await loadComfyContext().catch(() => ({ info: {} }));
    const normalized = (Array.isArray(raw?.nodes) && Array.isArray(raw?.links)) || raw?.prompt
      ? { graph: previewWorkflowImport(raw, req.body?.filename || "", info).graph, jAiStudio: req.body?.metadata || {} }
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

function bundleSourceItems(req) {
  // Private items never take part in a run, so the vault is not consulted here.
  // Prompts are decrypted for this request only: with a privacy password set
  // they are encrypted at rest, so an unrevealed item has no prompt to group by
  // and would silently fall back to batch-only grouping.
  return revealGalleryItemsForRequest(
    filterVisibleGallery(gallery).filter((item) => item.status !== "canceled"),
    req
  );
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
  if (!requireLocal(req, res)) return;
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

function vaultAwarePage(req) {
  const type = String(req.query.type || "");
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
  const cursor = String(req.query.cursor || "");
  const includeFailed = req.query.includeFailed !== "0";
  const bundlesEnabled = req.query.bundles !== "0";
  const merged = sortGallery([...filterVisibleGallery(gallery), ...vaultGalleryItemsForRequest(req, { bundles: bundlesEnabled })]).filter((item) => {
    if (type && item.type !== type) return false;
    if (!includeFailed && item.status === "error") return false;
    return item.status !== "canceled";
  });
  // Collapse runs before paginating; a bundle that straddles a page boundary
  // could never be assembled correctly in the browser.
  const collapsed = applyBundles(merged, { enabled: bundlesEnabled });
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
  const page = vaultConfigured()
    ? vaultAwarePage(req)
    : pageGallery({ type, limit: limit || 200, cursor, includeFailed });
  res.json({
    ...page,
    items: revealGalleryItemsForRequest(page.items, req).map((item) => item.bundle
      ? { ...item, bundle: { ...item.bundle, items: revealGalleryItemsForRequest(item.bundle.items || [], req) } }
      : item),
    outputs: revealGalleryItemsForRequest(cursor || limit ? page.items : filterVisibleGallery(gallery), req)
  });
});

app.get("/api/gallery/delta", (req, res) => {
  if (vaultConfigured()) {
    res.json({ revision: galleryRevisionValue(), reset: true, upserts: [], removes: [] });
    return;
  }
  const since = Number(req.query.since || 0);
  const type = String(req.query.type || "");
  const includeFailed = req.query.includeFailed !== "0";
  const delta = galleryDelta({ since, type, includeFailed });
  res.json({ ...delta, upserts: revealGalleryItemsForRequest(delta.upserts || [], req) });
});

app.get("/api/vault/media/:id", (req, res) => {
  const asset = readVaultAsset(req, req.params.id);
  if (!asset) {
    res.status(404).json({ ok: false, error: "Private item is locked or no longer available." });
    return;
  }
  res.setHeader("Content-Type", asset.item.mime || "application/octet-stream");
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Content-Disposition", "inline");
  res.send(asset.buffer);
});

app.get("/api/vault/thumbnail/:id", (req, res) => {
  const asset = readVaultAsset(req, req.params.id);
  if (!asset) {
    res.status(404).end();
    return;
  }
  // The encrypted source doubles as the preview until a resize dependency is installed.
  // It is still lazy-loaded and never exists as a plaintext thumbnail on disk.
  res.setHeader("Content-Type", asset.item.mime || "application/octet-stream");
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.send(asset.buffer);
});

app.get("/api/vault/export", (req, res) => {
  const backup = exportVaultBackup(req);
  if (!backup) {
    res.status(401).json({ ok: false, error: "Unlock Private Vault before exporting it." });
    return;
  }
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="jai-private-vault-${new Date().toISOString().slice(0, 10)}.backup"`);
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.send(backup);
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

app.post("/api/generate", async (req, res) => {
  const requestKey = encryptionKeyFromRequest(req);
  if (isPrivacyEnabled() && !requestKey) {
    res.status(401).json({ ok: false, locked: true, error: "Unlock privacy mode before generating so prompts can be encrypted." });
    return;
  }
  let body;
  let isMockJob = false;
  try {
    const { info, stats } = await loadComfyContext();
    body = sanitizeGenerateBody(req.body, info, stats);
  } catch {
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
  body.privateVault = Boolean(req.body?.privateVault);
  if (body.privateVault && !isPrivacyEnabled()) {
    res.status(400).json({ ok: false, error: "Create a privacy password before using Private Vault." });
    return;
  }
  if (body.privateVault && !requestKey) {
    res.status(401).json({ ok: false, locked: true, error: "Unlock Private Vault before generating." });
    return;
  }
  if (body.privateVault && !isMockJob && !comfyOutputDir) {
    res.status(400).json({ ok: false, error: "Set COMFY_OUTPUT_DIR before using Private Vault so J AI can encrypt and remove Comfy output files." });
    return;
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
  res.json({ jobId: id, items: revealGalleryItemsForRequest(items, req), revision: galleryRevisionValue() });
  if (isMockJob) {
    setTimeout(() => runMockJob(id, body), 0);
  } else {
    setTimeout(() => runJob(id, body), 0);
    refreshComfyContextSoon();
  }
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.json({ status: "missing" });
    return;
  }
  const key = encryptionKeyFromRequest(req);
  const safeJob = { ...job, items: revealGalleryItemsForRequest(job.items || [], req) };
  if (isPrivacyEnabled() && !key) delete safeJob.prompt;
  res.json(safeJob);
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
  const cleared = gallery.filter((item) => item.status === "done");
  const files = deleteGalleryFiles(cleared);
  const vault = vaultConfigured() ? clearVault(req) : { removed: 0 };
  if (vault.locked) {
    res.status(401).json({ ok: false, locked: true, error: "Unlock Private Vault before clearing it." });
    return;
  }
  hideGalleryItems(cleared);
  setGallery(gallery.filter((item) => item.status !== "done"));
  saveGallery();
  res.json({ ok: true, files, vault, outputs: revealGalleryItemsForRequest(gallery, req) });
});

app.post("/api/gallery/errors/clear", (_req, res) => {
  const cleared = gallery.filter((item) => item.status === "error" || item.status === "canceled");
  hideGalleryItems(cleared);
  setGallery(gallery.filter((item) => item.status !== "error" && item.status !== "canceled"));
  saveGallery();
  res.json({ ok: true, outputs: revealGalleryItemsForRequest(gallery, _req) });
});

app.post("/api/cache/clear", async (_req, res) => {
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
  res.json({ ok: true, outputs: revealGalleryItemsForRequest(gallery, _req) });
});

app.delete("/api/gallery/:id", (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const vault = vaultConfigured() ? deleteVaultItem(req, id) : { removed: 0 };
  if (vault.locked) {
    res.status(401).json({ ok: false, locked: true, error: "Unlock Private Vault before deleting it." });
    return;
  }
  const before = gallery.length;
  const removed = gallery.filter((item) => item.id === id || item.url === id);
  const files = deleteGalleryFiles(removed);
  hideGalleryItems(removed);
  setGallery(gallery.filter((item) => item.id !== id && item.url !== id));
  if (gallery.length !== before) saveGallery();
  res.json({ ok: true, files, vault, removed: before - gallery.length + vault.removed, outputs: revealGalleryItemsForRequest(gallery, req) });
});

app.post("/api/open-output-folder", (req, res) => {
  if (!requireLocal(req, res)) return;
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
    res.json(await updateStatus());
  } catch (error) {
    res.status(500).json({ ok: false, available: false, error: error.message });
  }
});

app.post("/api/update/install", async (req, res) => {
  if (!requireLocal(req, res)) return;
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

app.post("/api/shutdown", (_req, res) => {
  if (!requireLocal(_req, res)) return;
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 250);
});

app.get("/comfy/*path", async (req, res) => {
  try {
    const query = req.originalUrl.split("?")[1] ? `?${req.originalUrl.split("?")[1]}` : "";
    const proxyPath = Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path;
    // Forward conditional headers so an unchanged image gets a 304 instead of a
    // full re-transfer over a slow LAN link, and stream the body instead of
    // buffering it so bytes start moving to the client as soon as they arrive.
    const conditional = {};
    if (req.headers["if-none-match"]) conditional["if-none-match"] = req.headers["if-none-match"];
    if (req.headers["if-modified-since"]) conditional["if-modified-since"] = req.headers["if-modified-since"];
    const response = await fetch(`${comfyUrl}/${proxyPath}${query}`, { headers: conditional });
    res.status(response.status);
    const etag = response.headers.get("etag");
    const lastModified = response.headers.get("last-modified");
    const contentLength = response.headers.get("content-length");
    if (etag) res.setHeader("ETag", etag);
    if (lastModified) res.setHeader("Last-Modified", lastModified);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    if (response.status === 304 || !response.body) { res.end(); return; }
    res.type(response.headers.get("content-type") || "application/octet-stream");
    await pipeline(Readable.fromWeb(response.body), res);
  } catch (error) {
    if (!res.headersSent) res.status(502).json({ error: error.message }); else res.destroy();
  }
});

const dist = path.join(root, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*splat", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

setTimeout(() => recoverGalleryFromHistory().catch(() => null), 1200);

app.listen(port, host, () => {
  console.log(`J AI Studio listening on http://${host}:${port}`);
});

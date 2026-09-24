import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { comfy, comfyOutputDir } from "./comfy.js";
import { dataDir, generationSettings, outputFileCandidates, promptTitle } from "./gallery-store.js";
import { encryptionKeyFromRequest, passwordWrapForBackup } from "./privacy.js";
import {
  applyBundlesToItems,
  createBundleRecords,
  dissolveBundle as dissolveBundleRecord,
  pendingSummary as pendingSummaryOf,
  pruneBundles,
  setBundleCover as setBundleCoverRecord
} from "./bundle-runs.js";

/*
 * Hidden: everything a person hides, encrypted on this computer.
 *
 * One encrypted manifest lists the items, their prompts and settings, and a
 * key per file; every file sits next to it encrypted under its own key. The
 * manifest is sealed with the master key from the key ring, so without an
 * unlocked session there is nothing to read: not the prompts, not the file
 * names, not even how many items there are.
 */

// A dot-directory keeps ciphertext out of ordinary Finder views as well as out of HEISS UI's visible output paths.
const vaultDir = path.join(dataDir, ".private-vault");
const assetsDir = path.join(vaultDir, "assets");
const manifestPath = path.join(vaultDir, "manifest.enc");
const headerPath = path.join(vaultDir, "vault.json");

let revision = Date.now();
/** Moves whenever anything in Hidden changes, so an open Hidden view knows to reload. */
export function vaultRevision() { return revision; }
export function bumpVaultRevision() { revision = Math.max(revision + 1, Date.now()); return revision; }

function b64(value) { return Buffer.from(value).toString("base64url"); }
function fromB64(value) { return Buffer.from(String(value || ""), "base64url"); }

function encrypt(buffer, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([Buffer.from("JVA1"), iv, cipher.getAuthTag(), data]);
}

function decrypt(buffer, key) {
  if (buffer.length < 32 || buffer.subarray(0, 4).toString("utf8") !== "JVA1") throw new Error("Invalid Hidden asset.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, buffer.subarray(4, 16));
  decipher.setAuthTag(buffer.subarray(16, 32));
  return Buffer.concat([decipher.update(buffer.subarray(32)), decipher.final()]);
}

function readManifest(key) {
  if (!fs.existsSync(manifestPath)) return { version: 1, items: [], bundles: [] };
  const plain = decrypt(fs.readFileSync(manifestPath), key);
  const parsed = JSON.parse(plain.toString("utf8"));
  return {
    version: 1,
    items: Array.isArray(parsed.items) ? parsed.items : [],
    // Creative runs for Hidden's own items live inside the same ciphertext.
    bundles: Array.isArray(parsed.bundles) ? parsed.bundles : []
  };
}

function writeManifest(manifest, key) {
  fs.mkdirSync(assetsDir, { recursive: true });
  const full = { version: 1, items: manifest.items, bundles: manifest.bundles || [] };
  const tempPath = `${manifestPath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, encrypt(Buffer.from(JSON.stringify(full)), key), { mode: 0o600 });
  fs.renameSync(tempPath, manifestPath);
  // The plaintext header says only that Hidden exists; older versions also kept a count here.
  fs.writeFileSync(headerPath, JSON.stringify({ version: 2 }, null, 2));
  bumpVaultRevision();
}

/** Encrypts one file under a fresh key; returns what the manifest keeps about it. */
function sealAsset(buffer) {
  const assetKey = crypto.randomBytes(32);
  const assetFile = `${crypto.randomUUID()}.bin`;
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, assetFile), encrypt(buffer, assetKey), { mode: 0o600 });
  return { assetFile, assetKey: b64(assetKey) };
}

function openAsset(record) {
  return decrypt(fs.readFileSync(path.join(assetsDir, record.assetFile)), fromB64(record.assetKey));
}

function dropAssets(item) {
  for (const file of [item?.assetFile, item?.upscale?.assetFile]) {
    if (file) { try { fs.unlinkSync(path.join(assetsDir, file)); } catch { /* already gone */ } }
  }
}

function mimeFor(filename, type) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  if (type === "video" || ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

/**
 * The bytes of something ComfyUI just made, and the file it made them in so
 * that copy can go. Without a known output folder the bytes still come over
 * ComfyUI's API, and `sourcePath` stays empty: the caller says a copy was left.
 */
async function sourceFromOutput(output) {
  const source = String(output?.url || "");
  if (source.startsWith("data:")) {
    const match = source.match(/^data:([^;,]+)?((?:;[^,]+)*),(.*)$/s);
    if (!match) throw new Error("Invalid generated preview.");
    const isBase64 = match[2].split(";").includes("base64");
    const data = isBase64 ? match[3] : decodeURIComponent(match[3]);
    return { buffer: Buffer.from(data, isBase64 ? "base64" : "utf8"), sourcePath: "", mime: match[1] || mimeFor(output.filename, output.type) };
  }
  const parsed = new URL(source, "http://heiss.local");
  const filename = String(parsed.searchParams.get("filename") || "");
  const subfolder = String(parsed.searchParams.get("subfolder") || "");
  const outputType = String(parsed.searchParams.get("type") || "output");
  if (!filename || path.basename(filename) !== filename) throw new Error("Hidden only accepts files ComfyUI generated.");
  const mime = mimeFor(filename, output.type);
  if (comfyOutputDir && outputType === "output") {
    const base = path.resolve(comfyOutputDir);
    const candidate = path.resolve(base, subfolder, filename);
    if (candidate !== base && !candidate.startsWith(`${base}${path.sep}`)) throw new Error("Unsafe ComfyUI output path.");
    if (fs.existsSync(candidate)) return { buffer: fs.readFileSync(candidate), sourcePath: candidate, mime };
  }
  const data = await comfy(`/view?${new URLSearchParams({ filename, subfolder, type: outputType })}`);
  return { buffer: Buffer.from(data), sourcePath: "", mime };
}

/** Reads a finished gallery item's own file (and its upscale), wherever it lives. */
async function galleryItemBytes(item, url) {
  if (!url) return null;
  const candidates = outputFileCandidates({ ...item, url, id: url, outputName: url === item.url ? item.outputName : item.upscale?.outputName });
  const base = comfyOutputDir ? path.resolve(comfyOutputDir) : "";
  const file = candidates.find((candidate) => {
    const resolved = path.resolve(candidate);
    if (!base || !resolved.startsWith(`${base}${path.sep}`)) return false;
    try { return fs.statSync(resolved).isFile(); } catch { return false; }
  });
  const name = url === item.url ? item.outputName || item.filename : item.upscale?.outputName;
  if (file) return { buffer: fs.readFileSync(file), sourcePath: file, mime: mimeFor(file, item.type) };
  if (String(url).startsWith("/comfy/")) {
    const data = await comfy(String(url).replace(/^\/comfy/, ""));
    return { buffer: Buffer.from(data), sourcePath: "", mime: mimeFor(name, item.type) };
  }
  if (String(url).startsWith("data:")) return sourceFromOutput({ url, filename: name, type: item.type });
  throw new Error("The original file is no longer there.");
}

/* Upscales of Hidden items run like any other; their progress lives here in
   memory while they run, so a progress tick never rewrites the manifest. */
const runtimeUpscales = new Map();

export function setRuntimeUpscale(itemId, patch) {
  if (patch) runtimeUpscales.set(itemId, { ...(runtimeUpscales.get(itemId) || {}), ...patch });
  else runtimeUpscales.delete(itemId);
  bumpVaultRevision();
}

function viewItem(item) {
  const { assetFile, assetKey, upscale, ...rest } = item;
  const running = runtimeUpscales.get(item.id);
  let nextUpscale;
  if (upscale || running) {
    const { assetFile: upscaleFile, assetKey: upscaleKey, ...state } = upscale || {};
    nextUpscale = { ...state, ...(running || {}) };
    if (upscaleFile && (!running || running.status !== "running")) {
      nextUpscale.url = `/api/vault/media/${encodeURIComponent(item.id)}?variant=upscale`;
      nextUpscale.thumbnailUrl = `/api/vault/thumbnail/${encodeURIComponent(item.id)}?variant=upscale`;
    }
  }
  return {
    ...rest,
    ...(nextUpscale ? { upscale: nextUpscale } : {}),
    privateVault: true,
    url: `/api/vault/media/${encodeURIComponent(item.id)}`,
    thumbnailUrl: `/api/vault/thumbnail/${encodeURIComponent(item.id)}`
  };
}

export function vaultConfigured() { return fs.existsSync(manifestPath); }

/** Manifest items are already plaintext once decrypted - no separate reveal step. */
function vaultBundleCandidate(item) {
  return Boolean(item) && item.status === "done" && Boolean(item.id) && !String(item.id).startsWith("bundle:");
}

export function vaultItems(key, { bundles: bundlesEnabled = true } = {}) {
  if (!key) return [];
  const manifest = readManifest(key);
  const items = manifest.items.map(viewItem);
  // Pruning here (not just on delete) means a bundle that lost a member to
  // some other path still self-heals the next time Hidden is opened.
  const activeIds = new Set(items.filter(vaultBundleCandidate).map((item) => item.id));
  const { bundles: pruned, changed } = pruneBundles(manifest.bundles, activeIds);
  if (changed) writeManifest({ ...manifest, bundles: pruned }, key);
  return applyBundlesToItems(items, pruned, vaultBundleCandidate, { domain: "vault", enabled: bundlesEnabled });
}

export function vaultGalleryItemsForRequest(req, options = {}) {
  try {
    return vaultItems(encryptionKeyFromRequest(req), options);
  } catch {
    return [];
  }
}

export function findVaultItem(key, id) {
  if (!key || !id) return null;
  try {
    const item = readManifest(key).items.find((entry) => entry.id === id);
    return item ? viewItem(item) : null;
  } catch {
    return null;
  }
}

export function vaultBundlePendingSummary(req, options = {}) {
  const key = encryptionKeyFromRequest(req);
  if (!key) return { locked: true };
  try {
    const manifest = readManifest(key);
    return { locked: false, pending: pendingSummaryOf(manifest.items, manifest.bundles, vaultBundleCandidate, options) };
  } catch {
    return { locked: true };
  }
}

export function compactVaultBundles(req, options = {}) {
  const key = encryptionKeyFromRequest(req);
  if (!key) throw new Error("Hidden is locked.");
  const manifest = readManifest(key);
  const { bundles: nextBundles, created } = createBundleRecords(manifest.items, manifest.bundles, vaultBundleCandidate, options);
  if (created.length) writeManifest({ ...manifest, bundles: nextBundles }, key);
  return { created: created.length, items: created.reduce((total, bundle) => total + bundle.itemIds.length, 0), ids: created.map((bundle) => bundle.id) };
}

export function setVaultBundleCover(req, bundleId, itemId) {
  const key = encryptionKeyFromRequest(req);
  if (!key) throw new Error("Hidden is locked.");
  const manifest = readManifest(key);
  writeManifest({ ...manifest, bundles: setBundleCoverRecord(manifest.bundles, bundleId, itemId) }, key);
  return { ok: true, id: bundleId, coverId: itemId };
}

export function dissolveVaultBundle(req, bundleId) {
  const key = encryptionKeyFromRequest(req);
  if (!key) throw new Error("Hidden is locked.");
  const manifest = readManifest(key);
  writeManifest({ ...manifest, bundles: dissolveBundleRecord(manifest.bundles, bundleId) }, key);
  return { ok: true, id: bundleId };
}

function removeSourceFiles(paths) {
  let left = 0;
  for (const sourcePath of paths) {
    if (!sourcePath) { left += 1; continue; }
    try { if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath); } catch { left += 1; }
  }
  return left;
}

/**
 * Encrypts what a Hidden run made. Returns the items as the browser sees them
 * and how many plaintext copies ComfyUI kept that could not be removed.
 */
export async function storeHiddenOutputs(key, outputs, body, existing = []) {
  if (!key) throw new Error("Hidden locked before this run finished, so its result could not be saved.");
  const sources = [];
  for (const output of outputs) sources.push(await sourceFromOutput(output));
  const manifest = readManifest(key);
  const created = [];
  const sealedFiles = [];
  try {
    for (const [index, output] of outputs.entries()) {
      const source = sources[index];
      const sealed = sealAsset(source.buffer);
      sealedFiles.push(sealed.assetFile);
      created.push({
        id: crypto.randomUUID(),
        jobId: body.clientJobId || "",
        index,
        ...sealed,
        mime: source.mime,
        outputName: output.filename || "",
        filename: promptTitle(body.prompt),
        type: output.type === "video" ? "video" : "image",
        status: "done",
        prompt: body.prompt || "",
        negative: body.negative || "",
        createdAt: existing[index]?.createdAt || body.createdAt || new Date().toISOString(),
        durationMs: Number(body.startedAt ? Date.now() - body.startedAt : 0),
        width: Number(body.width || 0),
        height: Number(body.height || 0),
        model: body.model || "",
        referenceImage: body.startImageId || "",
        referenceImageName: body.startImageName || "",
        startImageId: body.startImageId || "",
        settings: generationSettings(body)
      });
    }
    manifest.items.unshift(...created);
    writeManifest(manifest, key);
  } catch (error) {
    for (const file of sealedFiles) { try { fs.unlinkSync(path.join(assetsDir, file)); } catch {} }
    throw error;
  }
  const leftBehind = removeSourceFiles(sources.map((source) => source.sourcePath).filter((_, index) => !String(outputs[index]?.url || "").startsWith("data:")));
  return { items: created.map(viewItem), leftBehind };
}

/** Changes an item's own fields, such as which of original and upscale it shows. */
export function patchVaultItem(key, id, patch) {
  const manifest = readManifest(key);
  const item = manifest.items.find((entry) => entry.id === id);
  if (!item) return null;
  Object.assign(item, typeof patch === "function" ? patch(item) : patch);
  writeManifest(manifest, key);
  return viewItem(item);
}

/** Encrypts a finished upscale into its Hidden item, replacing any earlier one. */
export async function attachVaultUpscale(key, itemId, output, state) {
  const source = await sourceFromOutput(output);
  const manifest = readManifest(key);
  const item = manifest.items.find((entry) => entry.id === itemId);
  if (!item) {
    removeSourceFiles([source.sourcePath]);
    throw new Error("That image left Hidden while it was upscaling.");
  }
  const sealed = sealAsset(source.buffer);
  const previous = item.upscale?.assetFile;
  item.upscale = { ...state, ...sealed, mime: source.mime, outputName: output.filename || "", status: "done" };
  item.upscaleActive = true;
  writeManifest(manifest, key);
  if (previous) { try { fs.unlinkSync(path.join(assetsDir, previous)); } catch {} }
  return { item: viewItem(item), leftBehind: removeSourceFiles([source.sourcePath]) };
}

function readAsset(key, id, variant = "original") {
  if (!key) return null;
  try {
    const item = readManifest(key).items.find((entry) => entry.id === id);
    if (!item) return null;
    const record = variant === "upscale" ? item.upscale : item;
    if (!record?.assetFile) return null;
    return { item: viewItem(item), mime: record.mime || item.mime, name: record.outputName || item.outputName || "", buffer: openAsset(record) };
  } catch { return null; }
}

export function readVaultAsset(req, id, variant = "original") {
  return readAsset(encryptionKeyFromRequest(req), id, variant);
}

export function readVaultAssetWithKey(key, id, variant = "original") {
  return readAsset(key, id, variant);
}

export function* vaultAssetsForExport(key) {
  if (!key) return;
  let manifest;
  try { manifest = readManifest(key); } catch { return; }
  for (const item of manifest.items) {
    try {
      yield { item, buffer: openAsset(item) };
    } catch {
      // A missing or damaged asset should not prevent exporting the rest.
    }
  }
}

/**
 * Moves finished gallery items into Hidden: their files are encrypted, the
 * plaintext originals (and upscales) removed from ComfyUI's output folder, and
 * their records dropped from the gallery by the caller. Items that cannot be
 * read are left where they are and reported.
 */
export async function hideItems(key, items) {
  if (!key) throw new Error("Unlock Hidden first.");
  const prepared = [];
  const failed = [];
  for (const item of items) {
    try {
      const original = await galleryItemBytes(item, item.url);
      let upscale = null;
      if (item.upscale?.url && item.upscale.status === "done") {
        upscale = await galleryItemBytes(item, item.upscale.url).catch(() => null);
      }
      prepared.push({ item, original, upscale });
    } catch (error) {
      failed.push({ id: item.id, error: error.message });
    }
  }
  if (!prepared.length) return { moved: [], failed, leftBehind: 0, promptIds: [] };
  const manifest = readManifest(key);
  const sealedFiles = [];
  const moved = [];
  try {
    for (const { item, original, upscale } of prepared) {
      const sealed = sealAsset(original.buffer);
      sealedFiles.push(sealed.assetFile);
      let upscaleRecord;
      if (upscale) {
        const sealedUpscale = sealAsset(upscale.buffer);
        sealedFiles.push(sealedUpscale.assetFile);
        const { url, thumbnailUrl, progress, jobId, ...state } = item.upscale;
        upscaleRecord = { ...state, ...sealedUpscale, mime: upscale.mime, status: "done" };
      }
      const { url, thumbnailUrl, preview, previews, bundle, optimistic, upscale: _, upscaleActive, privateVault, vaultLocked, promptProtected, ...meta } = item;
      moved.push({
        ...meta,
        id: crypto.randomUUID(),
        ...sealed,
        mime: original.mime,
        type: item.type === "video" ? "video" : "image",
        status: "done",
        hiddenAt: new Date().toISOString(),
        ...(upscaleRecord ? { upscale: upscaleRecord, upscaleActive: Boolean(upscaleActive) } : {})
      });
    }
    manifest.items.unshift(...moved);
    manifest.items.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    writeManifest(manifest, key);
  } catch (error) {
    for (const file of sealedFiles) { try { fs.unlinkSync(path.join(assetsDir, file)); } catch {} }
    throw error;
  }
  const leftBehind = removeSourceFiles(prepared.flatMap(({ original, upscale }) => [original.sourcePath, ...(upscale ? [upscale.sourcePath] : [])]));
  return {
    moved: moved.map(viewItem),
    movedFrom: prepared.map(({ item }) => item),
    failed,
    leftBehind,
    promptIds: prepared.map(({ item }) => item.promptId || "").filter(Boolean)
  };
}

function uniqueOutputPath(base, name) {
  const safe = path.basename(String(name || "")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || `heiss-${Date.now()}.png`;
  const ext = path.extname(safe);
  const stem = path.basename(safe, ext);
  let candidate = path.join(base, safe);
  let suffix = 2;
  while (fs.existsSync(candidate)) candidate = path.join(base, `${stem}-${suffix++}${ext}`);
  return candidate;
}

function viewParams(file, base) {
  const relative = path.relative(base, file);
  return new URLSearchParams({ filename: path.basename(relative), subfolder: path.dirname(relative) === "." ? "" : path.dirname(relative), type: "output" });
}

/**
 * Puts Hidden items back in the gallery: decrypted into ComfyUI's output
 * folder as ordinary files, with their prompts and settings intact. Returns
 * the gallery records for the caller to add.
 */
export function unhideItems(key, ids) {
  if (!key) throw new Error("Unlock Hidden first.");
  if (!comfyOutputDir) throw new Error("HEISS UI needs to know ComfyUI's output folder to put images back. Set it under Library.");
  const base = path.resolve(comfyOutputDir);
  const manifest = readManifest(key);
  const wanted = new Set(ids);
  const restored = [];
  const written = [];
  const leaving = manifest.items.filter((item) => wanted.has(item.id));
  try {
    for (const item of leaving) {
      const file = uniqueOutputPath(base, item.outputName || `${item.id}${item.type === "video" ? ".mp4" : ".png"}`);
      fs.writeFileSync(file, openAsset(item));
      written.push(file);
      const params = viewParams(file, base);
      const url = `/comfy/view?${params}`;
      let upscale;
      if (item.upscale?.assetFile) {
        const upscaleFile = uniqueOutputPath(base, item.upscale.outputName || `${path.basename(file, path.extname(file))}-upscale.png`);
        fs.writeFileSync(upscaleFile, openAsset(item.upscale));
        written.push(upscaleFile);
        const upscaleParams = viewParams(upscaleFile, base);
        const { assetFile, assetKey, mime, ...state } = item.upscale;
        upscale = { ...state, status: "done", url: `/comfy/view?${upscaleParams}`, thumbnailUrl: `/comfy/thumb?${upscaleParams}`, outputName: path.basename(upscaleFile) };
      }
      const { assetFile, assetKey, mime, hiddenAt, upscale: _, upscaleActive, ...meta } = item;
      restored.push({
        ...meta,
        id: url,
        url,
        thumbnailUrl: item.type === "video" ? undefined : `/comfy/thumb?${params}`,
        outputName: path.basename(file),
        status: "done",
        ...(upscale ? { upscale, upscaleActive: Boolean(upscaleActive) } : {})
      });
    }
    manifest.items = manifest.items.filter((item) => !wanted.has(item.id));
    manifest.bundles = pruneBundles(manifest.bundles, new Set(manifest.items.map((item) => item.id))).bundles;
    writeManifest(manifest, key);
  } catch (error) {
    for (const file of written) { try { fs.unlinkSync(file); } catch {} }
    throw error;
  }
  for (const item of leaving) dropAssets(item);
  return restored;
}

export function deleteVaultItems(key, ids) {
  if (!key) return { locked: true, removed: 0 };
  const manifest = readManifest(key);
  const wanted = new Set(ids);
  const removed = manifest.items.filter((item) => wanted.has(item.id));
  if (!removed.length) return { removed: 0 };
  manifest.items = manifest.items.filter((item) => !wanted.has(item.id));
  // Keep any bundle that referenced these ids from stranding a lone survivor.
  manifest.bundles = pruneBundles(manifest.bundles, new Set(manifest.items.map((item) => item.id))).bundles;
  writeManifest(manifest, key);
  for (const item of removed) dropAssets(item);
  return { removed: removed.length };
}

/** Removes Hidden from this computer entirely: every item and the manifest. */
export function eraseVault() {
  fs.rmSync(vaultDir, { recursive: true, force: true });
  runtimeUpscales.clear();
  bumpVaultRevision();
}

export function exportVaultBackup(key) {
  if (!key) return null;
  try {
    const manifest = readManifest(key);
    const assets = [];
    for (const item of manifest.items) {
      for (const record of [item, item.upscale]) {
        if (record?.assetFile) assets.push({ file: record.assetFile, data: b64(fs.readFileSync(path.join(assetsDir, record.assetFile))) });
      }
    }
    return Buffer.from(JSON.stringify({
      format: "heiss-ui-hidden-backup",
      version: 2,
      exportedAt: new Date().toISOString(),
      // The master key, sealed by the password, so the backup opens with it alone.
      keyring: passwordWrapForBackup(),
      manifest: b64(fs.readFileSync(manifestPath)),
      assets
    }));
  } catch { return null; }
}

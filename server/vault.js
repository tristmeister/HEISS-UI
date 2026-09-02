import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { comfyOutputDir } from "./comfy.js";
import { dataDir, generationSettings, promptTitle } from "./gallery-store.js";
import { activePrivacyKey, encryptionKeyFromRequest } from "./privacy.js";
import {
  applyBundlesToItems,
  createBundleRecords,
  DEFAULT_COOLDOWN_MINUTES,
  dissolveBundle as dissolveBundleRecord,
  pendingSummary as pendingSummaryOf,
  pruneBundles,
  setBundleCover as setBundleCoverRecord
} from "./bundle-runs.js";

// A dot-directory keeps ciphertext out of ordinary Finder views as well as out of J AI's visible output paths.
const vaultDir = path.join(dataDir, ".private-vault");
const assetsDir = path.join(vaultDir, "assets");
const manifestPath = path.join(vaultDir, "manifest.enc");
const headerPath = path.join(vaultDir, "vault.json");

function b64(value) { return Buffer.from(value).toString("base64url"); }
function fromB64(value) { return Buffer.from(String(value || ""), "base64url"); }

function encrypt(buffer, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([Buffer.from("JVA1"), iv, cipher.getAuthTag(), data]);
}

function decrypt(buffer, key) {
  if (buffer.length < 32 || buffer.subarray(0, 4).toString("utf8") !== "JVA1") throw new Error("Invalid private-vault asset.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, buffer.subarray(4, 16));
  decipher.setAuthTag(buffer.subarray(16, 32));
  return Buffer.concat([decipher.update(buffer.subarray(32)), decipher.final()]);
}

function header() {
  try { return JSON.parse(fs.readFileSync(headerPath, "utf8")); } catch { return { version: 1, assetCount: 0 }; }
}

function writeHeader(assetCount) {
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(headerPath, JSON.stringify({ version: 1, assetCount: Math.max(0, Number(assetCount) || 0), updatedAt: new Date().toISOString() }, null, 2));
}

function readManifest(key) {
  if (!fs.existsSync(manifestPath)) return { version: 1, items: [], bundles: [] };
  const plain = decrypt(fs.readFileSync(manifestPath), key);
  const parsed = JSON.parse(plain.toString("utf8"));
  return {
    version: 1,
    items: Array.isArray(parsed.items) ? parsed.items : [],
    // Creative-run records for the vault's own items. Stored inside the same
    // ciphertext as the items themselves - there is no separate plaintext
    // file, so a run's existence is invisible without the unlock key, same as
    // everything else in here.
    bundles: Array.isArray(parsed.bundles) ? parsed.bundles : []
  };
}

function writeManifest(manifest, key) {
  fs.mkdirSync(assetsDir, { recursive: true });
  const full = { version: 1, items: manifest.items, bundles: manifest.bundles || [] };
  const tempPath = `${manifestPath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, encrypt(Buffer.from(JSON.stringify(full)), key), { mode: 0o600 });
  fs.renameSync(tempPath, manifestPath);
  writeHeader(full.items.length);
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

function sourceFromOutput(output) {
  const source = String(output?.url || "");
  if (source.startsWith("data:")) {
    const match = source.match(/^data:([^;,]+)?((?:;[^,]+)*),(.*)$/s);
    if (!match) throw new Error("Invalid generated preview.");
    const isBase64 = match[2].split(";").includes("base64");
    const data = isBase64 ? match[3] : decodeURIComponent(match[3]);
    return { buffer: Buffer.from(data, isBase64 ? "base64" : "utf8"), sourcePath: "", mime: match[1] || mimeFor(output.filename, output.type) };
  }
  if (!comfyOutputDir) throw new Error("Private Vault needs COMFY_OUTPUT_DIR so J AI can encrypt and remove Comfy outputs.");
  const parsed = new URL(source, "http://jai.local");
  const filename = String(parsed.searchParams.get("filename") || "");
  const subfolder = String(parsed.searchParams.get("subfolder") || "");
  const outputType = String(parsed.searchParams.get("type") || "output");
  if (!filename || outputType !== "output" || path.basename(filename) !== filename) throw new Error("Private Vault only accepts generated Comfy output files.");
  const base = path.resolve(comfyOutputDir);
  const candidate = path.resolve(base, subfolder, filename);
  if (candidate !== base && !candidate.startsWith(`${base}${path.sep}`)) throw new Error("Unsafe Comfy output path.");
  return { buffer: fs.readFileSync(candidate), sourcePath: candidate, mime: mimeFor(filename, output.type) };
}

function viewItem(item) {
  return {
    ...item,
    privateVault: true,
    url: `/api/vault/media/${encodeURIComponent(item.id)}`,
    thumbnailUrl: `/api/vault/thumbnail/${encodeURIComponent(item.id)}`
  };
}

function lockedItems() {
  return Array.from({ length: header().assetCount }, (_, index) => ({
    id: `private-vault-locked-${index}`,
    filename: "Private item",
    type: "image",
    status: "done",
    privateVault: true,
    vaultLocked: true,
    createdAt: ""
  }));
}

export function vaultConfigured() { return fs.existsSync(manifestPath) || header().assetCount > 0; }

export function vaultStatusFor(req) {
  const vault = header();
  return { enabled: vaultConfigured(), unlocked: Boolean(encryptionKeyFromRequest(req)), assetCount: vault.assetCount || 0 };
}

/** Manifest items are already plaintext once decrypted - no separate reveal step. */
function vaultBundleCandidate(item) {
  return Boolean(item) && item.status === "done" && Boolean(item.id) && !String(item.id).startsWith("bundle:");
}

export function vaultGalleryItemsForRequest(req, { bundles: bundlesEnabled = true } = {}) {
  const key = encryptionKeyFromRequest(req);
  if (!key) return lockedItems();
  try {
    const manifest = readManifest(key);
    const items = manifest.items.map(viewItem);
    // Pruning here (not just on delete) means a bundle that lost a member to
    // some other path still self-heals the next time the vault is opened.
    const activeIds = new Set(items.filter(vaultBundleCandidate).map((item) => item.id));
    const { bundles: pruned, changed } = pruneBundles(manifest.bundles, activeIds);
    if (changed) writeManifest({ ...manifest, bundles: pruned }, key);
    return applyBundlesToItems(items, pruned, vaultBundleCandidate, { domain: "vault", enabled: bundlesEnabled });
  } catch {
    return lockedItems();
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
  if (!key) throw new Error("Private Vault is locked.");
  const manifest = readManifest(key);
  const { bundles: nextBundles, created } = createBundleRecords(manifest.items, manifest.bundles, vaultBundleCandidate, options);
  if (created.length) writeManifest({ ...manifest, bundles: nextBundles }, key);
  return { created: created.length, items: created.reduce((total, bundle) => total + bundle.itemIds.length, 0), ids: created.map((bundle) => bundle.id) };
}

export function setVaultBundleCover(req, bundleId, itemId) {
  const key = encryptionKeyFromRequest(req);
  if (!key) throw new Error("Private Vault is locked.");
  const manifest = readManifest(key);
  const nextBundles = setBundleCoverRecord(manifest.bundles, bundleId, itemId);
  writeManifest({ ...manifest, bundles: nextBundles }, key);
  return { ok: true, id: bundleId, coverId: itemId };
}

export function dissolveVaultBundle(req, bundleId) {
  const key = encryptionKeyFromRequest(req);
  if (!key) throw new Error("Private Vault is locked.");
  const manifest = readManifest(key);
  const nextBundles = dissolveBundleRecord(manifest.bundles, bundleId);
  writeManifest({ ...manifest, bundles: nextBundles }, key);
  return { ok: true, id: bundleId };
}

export function storePrivateOutputs(outputs, body, existing = []) {
  const key = activePrivacyKey();
  if (!key) throw new Error("Private Vault is locked. Unlock it before generating.");
  return storePrivateOutputsWithKey(outputs, body, existing, key);
}

export function storePrivateOutputsWithKey(outputs, body, existing = [], key) {
  if (!key) throw new Error("Private Vault is locked. Unlock it before generating.");
  const manifest = readManifest(key);
  const created = [];
  const encryptedFiles = [];
  let committed = false;
  try {
    for (const [index, output] of outputs.entries()) {
      const source = sourceFromOutput(output);
      const assetKey = crypto.randomBytes(32);
      const assetFile = `${crypto.randomUUID()}.bin`;
      const assetPath = path.join(assetsDir, assetFile);
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.writeFileSync(assetPath, encrypt(source.buffer, assetKey), { mode: 0o600 });
      encryptedFiles.push(assetPath);
      const item = {
        id: crypto.randomUUID(),
        jobId: body.clientJobId || "",
        index,
        assetFile,
        assetKey: b64(assetKey),
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
      };
      created.push({ item, sourcePath: source.sourcePath });
    }
    manifest.items.unshift(...created.map(({ item }) => item));
    writeManifest(manifest, key);
    committed = true;
    for (const { sourcePath } of created) {
      if (sourcePath && fs.existsSync(sourcePath)) {
        try { fs.unlinkSync(sourcePath); } catch { /* Keep the encrypted item; surface a recovery warning on the next scan. */ }
      }
    }
    return created.map(({ item }) => viewItem(item));
  } catch (error) {
    if (!committed) for (const file of encryptedFiles) { try { fs.unlinkSync(file); } catch {} }
    throw error;
  }
}

export function readVaultAsset(req, id) {
  const key = encryptionKeyFromRequest(req);
  if (!key) return null;
  try {
    const item = readManifest(key).items.find((entry) => entry.id === id);
    if (!item) return null;
    const assetPath = path.join(assetsDir, item.assetFile);
    return { item, buffer: decrypt(fs.readFileSync(assetPath), fromB64(item.assetKey)) };
  } catch { return null; }
}

export function deleteVaultItem(req, id) {
  const key = encryptionKeyFromRequest(req);
  if (!key) return { locked: true, removed: 0 };
  const manifest = readManifest(key);
  const removed = manifest.items.filter((item) => item.id === id);
  if (!removed.length) return { removed: 0 };
  manifest.items = manifest.items.filter((item) => item.id !== id);
  // Keep any bundle that referenced this id from stranding a lone survivor.
  const { bundles: pruned } = pruneBundles(manifest.bundles, new Set(manifest.items.map((item) => item.id)));
  manifest.bundles = pruned;
  writeManifest(manifest, key);
  for (const item of removed) { try { fs.unlinkSync(path.join(assetsDir, item.assetFile)); } catch {} }
  return { removed: removed.length };
}

export function clearVault(req) {
  const key = encryptionKeyFromRequest(req);
  if (!key) return { locked: true, removed: 0 };
  const manifest = readManifest(key);
  const removed = manifest.items;
  writeManifest({ version: 1, items: [], bundles: [] }, key);
  for (const item of removed) { try { fs.unlinkSync(path.join(assetsDir, item.assetFile)); } catch {} }
  return { removed: removed.length };
}

export function exportVaultBackup(req) {
  const key = encryptionKeyFromRequest(req);
  if (!key) return null;
  try {
    const manifest = readManifest(key);
    return Buffer.from(JSON.stringify({
      format: "jai-private-vault-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      manifest: b64(fs.readFileSync(manifestPath)),
      assets: manifest.items.map((item) => ({ file: item.assetFile, data: b64(fs.readFileSync(path.join(assetsDir, item.assetFile))) }))
    }));
  } catch { return null; }
}

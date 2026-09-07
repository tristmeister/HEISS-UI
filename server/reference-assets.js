import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Busboy from "busboy";
import sharp from "sharp";
import { comfy, comfyOutputDir } from "./comfy.js";
import { dataDir, filterVisibleGallery, gallery, galleryKey, outputFileCandidates } from "./gallery-store.js";
import { readVaultAsset, vaultGalleryItemsForRequest } from "./vault.js";

const assetsDir = path.join(dataDir, "reference-assets");
const filesDir = path.join(assetsDir, "files");
const thumbsDir = path.join(assetsDir, "thumbnails");
const manifestPath = path.join(assetsDir, "index.json");
const maxUploadBytes = Math.max(1024, Number(process.env.JAI_REFERENCE_MAX_BYTES || 25 * 1024 * 1024));
const maxPixels = Math.max(1_000_000, Number(process.env.JAI_REFERENCE_MAX_PIXELS || 80_000_000));
const acceptedMimes = new Set(["image/png", "image/jpeg", "image/webp"]);

function safeName(value = "reference-image") {
  return path.basename(String(value || "reference-image")).replace(/[^\w.() -]+/g, "-").slice(0, 180) || "reference-image";
}

function mimeExtension(mime = "") {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

function mimeFromName(name = "") {
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.webp$/i.test(name)) return "image/webp";
  return "image/png";
}

function ensureDirs() {
  fs.mkdirSync(filesDir, { recursive: true });
  fs.mkdirSync(thumbsDir, { recursive: true });
}

function loadManifest() {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeManifest(items) {
  ensureDirs();
  const temporary = `${manifestPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(items, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, manifestPath);
}

function publicUploadAsset(record) {
  return {
    id: record.id,
    source: "upload",
    name: record.name,
    mime: record.mime,
    width: record.width,
    height: record.height,
    size: record.size,
    createdAt: record.createdAt,
    thumbnailUrl: `/api/reference-assets/${encodeURIComponent(record.id)}/thumbnail`,
    url: `/api/reference-assets/${encodeURIComponent(record.id)}/media`,
    privacyDomain: "gallery"
  };
}

function encodedGalleryId(item) {
  return `gallery:${Buffer.from(String(galleryKey(item))).toString("base64url")}`;
}

function galleryAsset(item) {
  const vault = Boolean(item.privateVault || item.id && String(item.url || "").startsWith("/api/vault/"));
  return {
    id: vault ? `vault:${item.id}` : encodedGalleryId(item),
    source: vault ? "vault" : "generation",
    name: item.outputName || item.filename || "Generated image",
    mime: item.mime || mimeFromName(item.outputName || item.filename || item.url),
    width: Number(item.width || 0),
    height: Number(item.height || 0),
    size: Number(item.size || 0),
    createdAt: item.createdAt || "",
    thumbnailUrl: item.thumbnailUrl || item.url || "",
    url: item.url || "",
    privacyDomain: vault ? "vault" : "gallery",
    galleryItemId: item.id
  };
}

function paginate(items, cursor = "", limit = 60) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 60)));
  const start = Math.max(0, Number(cursor || 0) || 0);
  const page = items.slice(start, start + safeLimit);
  const next = start + safeLimit;
  return { items: page, nextCursor: next < items.length ? String(next) : "", hasMore: next < items.length };
}

export function listReferenceAssets(req, { source = "upload", cursor = "", limit = 60 } = {}) {
  if (source === "generation") {
    const publicItems = filterVisibleGallery(gallery).filter((item) => item.status === "done" && item.type === "image" && item.url);
    const privateItems = vaultGalleryItemsForRequest(req, { bundles: false }).filter((item) => item.status === "done" && item.type === "image" && item.url);
    const items = [...publicItems, ...privateItems]
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
      .map(galleryAsset);
    return paginate(items, cursor, limit);
  }
  const items = loadManifest()
    .filter((item) => item.source === "upload")
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
    .map(publicUploadAsset);
  return paginate(items, cursor, limit);
}

export function readMultipartImage(req) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let found = false;
    let limited = false;
    let name = "reference-image";
    let mime = "";
    const chunks = [];
    let size = 0;
    let parser;
    try {
      parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: maxUploadBytes, fields: 4 } });
    } catch (error) {
      reject(new Error(`Invalid multipart upload: ${error.message}`));
      return;
    }
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    parser.on("file", (field, file, info) => {
      if (field !== "image" || found) {
        file.resume();
        return;
      }
      found = true;
      name = safeName(info.filename);
      mime = String(info.mimeType || "").toLowerCase();
      file.on("limit", () => { limited = true; });
      file.on("data", (chunk) => {
        size += chunk.length;
        chunks.push(chunk);
      });
      file.on("error", fail);
    });
    parser.on("error", fail);
    parser.on("finish", () => {
      if (settled) return;
      if (!found) return fail(new Error("Choose an image to upload."));
      if (limited || size > maxUploadBytes) return fail(new Error(`Reference image exceeds the ${Math.round(maxUploadBytes / 1024 / 1024)} MB limit.`));
      settled = true;
      resolve({ buffer: Buffer.concat(chunks), name, mime, size });
    });
    req.pipe(parser);
  });
}

async function inspectImage(buffer, declaredMime = "") {
  const metadata = await sharp(buffer, { limitInputPixels: maxPixels }).metadata();
  const mime = metadata.format === "jpeg" ? "image/jpeg" : metadata.format === "webp" ? "image/webp" : metadata.format === "png" ? "image/png" : "";
  if (!mime || !acceptedMimes.has(mime)) throw new Error("Reference image must be a PNG, JPEG, or WebP file.");
  if (declaredMime && acceptedMimes.has(declaredMime) && declaredMime !== mime) throw new Error("The uploaded image type does not match its contents.");
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!width || !height || width * height > maxPixels) throw new Error("Reference image dimensions are invalid or too large.");
  return { mime, width, height };
}

export async function saveUploadedReference({ buffer, name, mime: declaredMime = "" }) {
  if (!buffer?.length) throw new Error("Uploaded image is empty.");
  if (buffer.length > maxUploadBytes) throw new Error(`Reference image exceeds the ${Math.round(maxUploadBytes / 1024 / 1024)} MB limit.`);
  const inspected = await inspectImage(buffer, declaredMime);
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const existing = loadManifest().find((item) => item.hash === hash && item.source === "upload");
  if (existing && fs.existsSync(path.join(filesDir, existing.file)) && fs.existsSync(path.join(thumbsDir, existing.thumbnail))) return publicUploadAsset(existing);
  ensureDirs();
  const id = crypto.randomUUID();
  const ext = mimeExtension(inspected.mime);
  const file = `${id}.${ext}`;
  const thumbnail = `${id}.webp`;
  fs.writeFileSync(path.join(filesDir, file), buffer, { mode: 0o600 });
  await sharp(buffer, { limitInputPixels: maxPixels }).rotate().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(thumbsDir, thumbnail));
  const record = {
    id,
    source: "upload",
    name: safeName(name),
    mime: inspected.mime,
    width: inspected.width,
    height: inspected.height,
    size: buffer.length,
    hash,
    file,
    thumbnail,
    createdAt: new Date().toISOString()
  };
  writeManifest([record, ...loadManifest()]);
  return publicUploadAsset(record);
}

export function readUploadedReference(id, variant = "media") {
  const record = loadManifest().find((item) => item.id === String(id || "") && item.source === "upload");
  if (!record) return null;
  const isThumb = variant === "thumbnail";
  const file = path.join(isThumb ? thumbsDir : filesDir, isThumb ? record.thumbnail : record.file);
  const base = path.resolve(isThumb ? thumbsDir : filesDir);
  const resolved = path.resolve(file);
  if (!resolved.startsWith(`${base}${path.sep}`) || !fs.existsSync(resolved)) return null;
  return { file: resolved, mime: isThumb ? "image/webp" : record.mime, name: record.name };
}

export function deleteUploadedReference(id) {
  const records = loadManifest();
  const record = records.find((item) => item.id === String(id || "") && item.source === "upload");
  if (!record) throw new Error("Uploaded reference image was not found.");
  for (const [baseDir, filename] of [[filesDir, record.file], [thumbsDir, record.thumbnail]]) {
    const base = path.resolve(baseDir);
    const target = path.resolve(baseDir, filename || "");
    if (filename && target.startsWith(`${base}${path.sep}`)) {
      try { fs.unlinkSync(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  writeManifest(records.filter((item) => item.id !== record.id));
  return { ok: true, id: record.id };
}

function decodeGalleryReference(id = "") {
  if (!String(id).startsWith("gallery:")) return "";
  try { return Buffer.from(String(id).slice(8), "base64url").toString("utf8"); } catch { return ""; }
}

function findGalleryItem(id = "") {
  const decoded = decodeGalleryReference(id);
  const wanted = decoded || String(id || "");
  return filterVisibleGallery(gallery).find((item) => galleryKey(item) === wanted || item.id === wanted || item.url === wanted) || null;
}

async function publicGalleryBuffer(item) {
  const base = comfyOutputDir ? path.resolve(comfyOutputDir) : "";
  const file = outputFileCandidates(item).find((candidate) => {
    const resolved = path.resolve(candidate);
    return base && resolved.startsWith(`${base}${path.sep}`) && fs.existsSync(resolved) && fs.statSync(resolved).isFile();
  });
  if (file) return { buffer: fs.readFileSync(file), mime: mimeFromName(file), name: item.outputName || path.basename(file) };
  if (!String(item.url || "").startsWith("/comfy/")) throw new Error("Generated reference image is no longer available.");
  const relative = String(item.url).replace(/^\/comfy/, "");
  const data = await comfy(relative);
  return { buffer: Buffer.from(data), mime: mimeFromName(item.outputName || item.filename || item.url), name: item.outputName || item.filename || "generated-image.png" };
}

export function referenceAssetFromGallery(req, galleryItemId) {
  const publicItem = filterVisibleGallery(gallery).find((item) => item.type === "image" && item.status === "done" && (item.id === galleryItemId || item.url === galleryItemId || galleryKey(item) === galleryItemId));
  if (publicItem) return galleryAsset(publicItem);
  const vaultItem = vaultGalleryItemsForRequest(req, { bundles: false }).find((item) => item.type === "image" && item.status === "done" && item.id === galleryItemId);
  if (vaultItem) return galleryAsset(vaultItem);
  throw new Error("Generated reference image was not found or is not accessible.");
}

async function bytesForReference(req, id) {
  if (String(id).startsWith("vault:")) {
    const vault = readVaultAsset(req, String(id).slice(6));
    if (!vault || vault.item?.type !== "image") throw new Error("Private reference image is locked or unavailable.");
    return { buffer: vault.buffer, mime: vault.item.mime || mimeFromName(vault.item.outputName), name: vault.item.outputName || "private-reference.png" };
  }
  const upload = loadManifest().find((item) => item.id === id && item.source === "upload");
  if (upload) {
    const file = path.resolve(filesDir, upload.file);
    if (!file.startsWith(`${path.resolve(filesDir)}${path.sep}`) || !fs.existsSync(file)) throw new Error("Uploaded reference image is unavailable.");
    return { buffer: fs.readFileSync(file), mime: upload.mime, name: upload.name };
  }
  const item = findGalleryItem(id);
  if (!item || item.type !== "image" || item.status !== "done") throw new Error("Generated reference image is unavailable.");
  return publicGalleryBuffer(item);
}

async function uploadBufferToComfy({ buffer, mime, name }) {
  await inspectImage(buffer, mime);
  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  const filename = `j-ai-studio-reference-${hash}.${mimeExtension(mime)}`;
  const form = new FormData();
  form.append("image", new Blob([buffer], { type: mime }), filename);
  form.append("type", "input");
  form.append("overwrite", "false");
  const uploaded = await comfy("/upload/image", { method: "POST", body: form });
  return { comfyName: uploaded.name || filename, name: safeName(name), mime };
}

export async function stageReferenceAssets(req, references = []) {
  const staged = [];
  for (const reference of Array.isArray(references) ? references : []) {
    const assetId = String(reference?.assetId || "");
    const slot = String(reference?.slot || "reference");
    if (!assetId) continue;
    const bytes = await bytesForReference(req, assetId);
    const uploaded = await uploadBufferToComfy(bytes);
    staged.push({ slot, assetId, source: String(reference?.source || ""), ...uploaded });
  }
  return staged;
}

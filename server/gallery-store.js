import fs from "node:fs";
import path from "node:path";
import { comfyOutputDir, root } from './comfy.js';
import { protectGalleryItemForStorage } from './privacy.js';

export const dataDir = process.env.JAI_DATA_DIR ? path.resolve(process.env.JAI_DATA_DIR) : path.join(root, "data");
export const galleryPath = path.join(dataDir, "gallery.json");
export const hiddenGalleryPath = path.join(dataDir, "gallery-hidden.json");
export const galleryLimit = Number(process.env.JAI_GALLERY_LIMIT || 50000);

const changeLogLimit = Number(process.env.JAI_GALLERY_CHANGELOG_LIMIT || 10000);
let galleryRevision = Date.now();
let saveTimer = null;
const galleryChanges = [];

function loadGallery() {
  try {
    const staleAfter = 30 * 60 * 1000;
    return JSON.parse(fs.readFileSync(galleryPath, "utf8")).map((item) => {
      let next = item;
      if (next.status === "pending" && Date.now() - Date.parse(next.createdAt || 0) > staleAfter) {
        next = { ...next, status: "canceled" };
      }
      // Backfill thumbnailUrl for items saved before the thumbnail pipeline existed.
      if (next.type === "image" && !next.thumbnailUrl && typeof next.url === "string" && next.url.startsWith("/comfy/view?")) {
        next = { ...next, thumbnailUrl: next.url.replace("/comfy/view?", "/comfy/thumb?") };
      }
      return next;
    });
  } catch {
    return [];
  }
}

export let gallery = loadGallery();
export let hiddenGalleryIds = loadHiddenGalleryIds();

function loadHiddenGalleryIds() {
  try {
    const raw = JSON.parse(fs.readFileSync(hiddenGalleryPath, "utf8"));
    if (Array.isArray(raw)) {
      const migrated = new Map(raw.filter((key) => !String(key).startsWith("/comfy/view?")).map((key) => [key, Date.now()]));
      fs.writeFileSync(hiddenGalleryPath, JSON.stringify(Object.fromEntries(migrated), null, 2));
      return migrated;
    }
    return new Map(Object.entries(raw).map(([key, value]) => [key, Number(value) || 0]));
  } catch {
    return new Map();
  }
}

function galleryTime(item) {
  const parsed = Date.parse(item?.createdAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function galleryKey(item) {
  return item?.url || item?.id || item?.outputName || item?.filename || "";
}

export function galleryRevisionValue() {
  return galleryRevision;
}

export function sortGallery(items = gallery) {
  return [...items].sort((a, b) => {
    const timeDelta = galleryTime(b) - galleryTime(a);
    if (timeDelta) return timeDelta;
    const aIndex = Number(a.index ?? 0);
    const bIndex = Number(b.index ?? 0);
    if (a.jobId && b.jobId && a.jobId === b.jobId && aIndex !== bIndex) return aIndex - bIndex;
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
}

function bumpRevision(changes = {}) {
  galleryRevision = Math.max(galleryRevision + 1, Date.now());
  const upserts = Array.isArray(changes.upserts) ? changes.upserts : [];
  const removes = Array.isArray(changes.removes) ? changes.removes : [];
  if (upserts.length || removes.length) {
    galleryChanges.push({ revision: galleryRevision, upserts, removes });
    if (galleryChanges.length > changeLogLimit) galleryChanges.splice(0, galleryChanges.length - changeLogLimit);
  }
  return galleryRevision;
}

function diffGallery(before, after) {
  const beforeMap = new Map(before.map((item) => [galleryKey(item), item]).filter(([key]) => key));
  const afterMap = new Map(after.map((item) => [galleryKey(item), item]).filter(([key]) => key));
  const upserts = [];
  const removes = [];
  for (const [key, item] of afterMap) {
    const previous = beforeMap.get(key);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(item)) upserts.push(item);
  }
  for (const key of beforeMap.keys()) {
    if (!afterMap.has(key)) removes.push(key);
  }
  return { upserts, removes };
}

export function setGallery(items, options = {}) {
  const before = gallery;
  gallery = sortGallery(items).slice(0, galleryLimit);
  if (options.track !== false) {
    const changes = diffGallery(before, gallery);
    if (changes.upserts.length || changes.removes.length) bumpRevision(changes);
  }
  if (options.persist !== false) saveGallery();
}

export function isComfyOutputItem(item) {
  return Boolean(item?.url && String(item.url).startsWith("/comfy/view?"));
}

export function hideGalleryItems(items) {
  const hiddenAt = Date.now();
  const removes = [];
  for (const item of items) {
    const key = galleryKey(item);
    if (key) {
      hiddenGalleryIds.set(key, hiddenAt);
      removes.push(key);
    }
  }
  if (removes.length) bumpRevision({ removes });
  saveHiddenGalleryIds();
}

export function isGalleryHidden(item) {
  const key = galleryKey(item);
  if (!key || !hiddenGalleryIds.has(key)) return false;
  const hiddenAt = Number(hiddenGalleryIds.get(key) || 0);
  const createdAt = Date.parse(item?.createdAt || "");
  if (hiddenAt && Number.isFinite(createdAt) && createdAt > hiddenAt) return false;
  return true;
}

export function filterVisibleGallery(items) {
  return items.filter((item) => {
    if (isGalleryHidden(item)) return false;
    if (isComfyOutputItem(item)) return hasExistingOutputFile(item);
    return !isGalleryHidden(item);
  });
}

function visibleItems({ type = "", includeFailed = true } = {}) {
  return sortGallery(filterVisibleGallery(gallery)).filter((item) => {
    if (type && item.type !== type) return false;
    if (!includeFailed && item.status === "error") return false;
    return item.status !== "canceled";
  });
}

function cursorFor(item) {
  if (!item) return "";
  return `${galleryTime(item)}|${encodeURIComponent(String(item.id || item.url || ""))}`;
}

function afterCursor(item, cursor = "") {
  if (!cursor) return true;
  const [timeText, encodedId = ""] = String(cursor).split("|");
  const cursorTime = Number(timeText || 0);
  const cursorId = decodeURIComponent(encodedId);
  const itemTime = galleryTime(item);
  if (itemTime < cursorTime) return true;
  if (itemTime > cursorTime) return false;
  return String(item.id || item.url || "").localeCompare(cursorId) > 0;
}

export function pageGallery({ type = "", limit = 200, cursor = "", includeFailed = true } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit || 200)));
  const all = visibleItems({ type, includeFailed });
  const start = cursor ? all.findIndex((item) => afterCursor(item, cursor)) : 0;
  const pageStart = Math.max(0, start);
  const items = all.slice(pageStart, pageStart + safeLimit);
  const nextCursor = pageStart + safeLimit < all.length ? cursorFor(items[items.length - 1]) : "";
  return { items, nextCursor, hasMore: Boolean(nextCursor), revision: galleryRevision, totalApprox: all.length };
}

export function galleryDelta({ since = 0, type = "", includeFailed = true } = {}) {
  const numericSince = Number(since || 0);
  const earliest = galleryChanges[0]?.revision || galleryRevision;
  if (!numericSince || numericSince < earliest - 1) {
    return { revision: galleryRevision, reset: true, upserts: [], removes: [] };
  }
  const upsertMap = new Map();
  const removes = new Set();
  for (const change of galleryChanges) {
    if (change.revision <= numericSince) continue;
    for (const item of change.upserts || []) {
      const key = galleryKey(item);
      if (!key) continue;
      upsertMap.set(key, item);
      removes.delete(key);
    }
    for (const key of change.removes || []) {
      removes.add(key);
      upsertMap.delete(key);
    }
  }
  const upserts = [...upsertMap.values()].filter((item) => {
    if (type && item.type !== type) return false;
    if (!includeFailed && item.status === "error") return false;
    return item.status !== "canceled" && !isGalleryHidden(item);
  });
  return { revision: galleryRevision, reset: false, upserts, removes: [...removes] };
}

export function outputFileCandidates(item) {
  if (!comfyOutputDir) return [];
  const keys = [item?.url, item?.id, item?.outputName, item?.filename].filter(Boolean);
  const candidates = [];
  for (const key of keys) {
    let filename = "";
    let subfolder = "";
    if (String(key).startsWith("/comfy/view?")) {
      const params = new URLSearchParams(String(key).split("?")[1] || "");
      filename = params.get("filename") || "";
      subfolder = params.get("subfolder") || "";
    } else if (String(key).startsWith("http")) {
      try {
        const parsed = new URL(String(key));
        filename = parsed.searchParams.get("filename") || path.basename(parsed.pathname);
        subfolder = parsed.searchParams.get("subfolder") || "";
      } catch {
        filename = path.basename(String(key));
      }
    } else {
      filename = path.basename(String(key));
    }
    if (!filename || filename === "." || filename === "/") continue;
    const base = path.resolve(comfyOutputDir);
    const withSubfolder = subfolder && path.basename(base).toLowerCase() !== path.basename(subfolder).toLowerCase()
      ? path.resolve(base, subfolder, filename)
      : path.resolve(base, filename);
    candidates.push(withSubfolder);
  }
  return [...new Set(candidates)];
}

export function deleteGalleryFiles(items) {
  const base = comfyOutputDir ? path.resolve(comfyOutputDir) : "";
  if (!base) return { deleted: 0, skipped: 0 };
  let deleted = 0;
  let skipped = 0;
  for (const item of items) {
    for (const file of outputFileCandidates(item)) {
      const resolved = path.resolve(file);
      if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
        skipped += 1;
        continue;
      }
      try {
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          fs.unlinkSync(resolved);
          deleted += 1;
        }
      } catch {
        skipped += 1;
      }
    }
  }
  return { deleted, skipped };
}

export function hasExistingOutputFile(item) {
  if (!comfyOutputDir) return true;
  return outputFileCandidates(item).some((file) => {
    const resolved = path.resolve(file);
    const base = path.resolve(comfyOutputDir);
    if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) return false;
    try {
      return fs.existsSync(resolved) && fs.statSync(resolved).isFile();
    } catch {
      return false;
    }
  });
}

export function saveGallery() {
  if (saveTimer) return;
  saveTimer = setTimeout(writeGalleryNow, 250);
}

export function writeGalleryNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  fs.mkdirSync(dataDir, { recursive: true });
  // Private-vault jobs exist only while Comfy is rendering. Their finished records
  // live in the encrypted vault manifest, never in the ordinary gallery JSON.
  const persistable = gallery.filter((item) => !item.privateVault).slice(0, galleryLimit).map(({ preview, ...rest }) => protectGalleryItemForStorage(rest));
  fs.writeFileSync(galleryPath, JSON.stringify(persistable, null, 2));
}

export function saveHiddenGalleryIds() {
  fs.mkdirSync(dataDir, { recursive: true });
  const entries = [...hiddenGalleryIds.entries()].slice(-galleryLimit * 2);
  fs.writeFileSync(hiddenGalleryPath, JSON.stringify(Object.fromEntries(entries), null, 2));
}

export function promptTitle(text = "") {
  const oneLine = String(text).replace(/\s+/g, " ").trim();
  return oneLine.length > 68 ? `${oneLine.slice(0, 65)}...` : oneLine || "Untitled prompt";
}

export function outputsFrom(history) {
  const urls = [];
  for (const output of Object.values(history.outputs || {})) {
    const images = Array.isArray(output?.images) ? output.images : [];
    const videos = Array.isArray(output?.videos) ? output.videos : [];
    for (const item of [...images, ...videos]) {
      const filename = typeof item?.filename === "string" ? item.filename : "";
      if (!filename) continue;
      const params = new URLSearchParams({
        filename,
        subfolder: item.subfolder || "",
        type: item.type || "output"
      });
      const isVideo = filename.endsWith(".mp4");
      urls.push({ url: `/comfy/view?${params}`, thumbnailUrl: isVideo ? undefined : `/comfy/thumb?${params}`, filename, type: isVideo ? "video" : "image" });
    }
  }
  return urls;
}

export function recordsFromComfyHistory(history) {
  const records = [];
  for (const [promptId, item] of Object.entries(history || {})) {
    const graph = item?.prompt?.[2] || {};
    const textNodes = Object.values(graph).filter((node) => node?.class_type === "CLIPTextEncode");
    const prompt = textNodes[0]?.inputs?.text || "";
    const negative = textNodes[1]?.inputs?.text || "";
    const latentNode = Object.values(graph).find((node) => /Latent/i.test(node?.class_type || "") && (node?.inputs?.width || node?.inputs?.height));
    const latent = latentNode?.inputs || {};
    const modelLoader = Object.values(graph).find((node) => node?.inputs?.unet_name || node?.inputs?.ckpt_name);
    const model = modelLoader?.inputs?.unet_name || modelLoader?.inputs?.ckpt_name || "";
    const loras = Object.values(graph)
      .filter((node) => node?.class_type === "LoraLoader" && node?.inputs?.lora_name)
      .map((node) => ({
        name: node.inputs.lora_name,
        enabled: true,
        strength: Number(node.inputs.strength_model ?? node.inputs.strength_clip ?? 0.7)
      }));
    const rawCreatedAt = Number(item?.prompt?.[3]?.create_time || Date.now());
    const createdAtMs = rawCreatedAt > 0 && rawCreatedAt < 1e12 ? rawCreatedAt * 1000 : rawCreatedAt;
    for (const output of outputsFrom(item)) {
      const record = {
        ...output,
        id: output.url,
        jobId: promptId,
        status: "done",
        prompt,
        negative,
        filename: promptTitle(prompt) || output.filename,
        outputName: output.filename,
        createdAt: new Date(createdAtMs).toISOString(),
        width: Number(latent.width || 0),
        height: Number(latent.height || 0),
        model,
        settings: loras.length ? { loras } : {}
      };
      if (hasExistingOutputFile(record)) records.push(record);
    }
  }
  return records;
}

export function makePendingItems(id, body) {
  const count = body.kind === "image" ? Math.max(1, Math.min(8, Number(body.count || 1))) : 1;
  const title = promptTitle(body.prompt);
  const createdAt = body.createdAt || new Date().toISOString();
  return Array.from({ length: count }, (_, index) => ({
    id: `${id}-${index}`,
    jobId: id,
    index,
    url: "",
    filename: body.kind === "image" && count > 1 ? `${title} ${index + 1}` : title,
    type: body.kind === "video" ? "video" : "image",
    status: "pending",
    prompt: body.prompt || "",
    negative: body.negative || "",
    createdAt,
    width: Number(body.width || 0),
    height: Number(body.height || 0),
    model: body.model || "",
    referenceImage: body.startImageId || "",
    referenceImageName: body.startImageName || "",
    startImageId: body.startImageId || "",
    settings: generationSettings(body),
    privateVault: Boolean(body.privateVault)
  }));
}

export function removeGalleryJob(id, options = {}) {
  const before = gallery;
  gallery = gallery.filter((item) => item.jobId !== id);
  const changes = diffGallery(before, gallery);
  if (changes.upserts.length || changes.removes.length) bumpRevision(changes);
  if (options.persist !== false) saveGallery();
}

export function dedupeGallery(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.url || item.id;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function cleanupGalleryState(jobs) {
  let changed = false;
  const before = gallery;
  const doneKeys = new Set(
    gallery
      .filter((item) => item.status === "done")
      .map((item) => `${item.jobId || ""}|${item.prompt || ""}|${item.model || ""}|${item.width || ""}|${item.height || ""}`)
  );
  gallery = gallery.filter((item) => {
    if (item.status !== "pending") return true;
    if (item.jobId && !jobs.has(item.jobId)) {
      item.status = "error";
      item.filename = "Generation interrupted";
      changed = true;
      return true;
    }
    if (gallery.some((next) => next.status === "done" && next.jobId && next.jobId === item.jobId)) {
      changed = true;
      return false;
    }
    const key = `${item.jobId || ""}|${item.prompt || ""}|${item.model || ""}|${item.width || ""}|${item.height || ""}`;
    if (item.jobId && doneKeys.has(key)) {
      changed = true;
      return false;
    }
    return true;
  });
  if (changed) {
    bumpRevision(diffGallery(before, gallery));
    saveGallery();
  }
}

export function generationSettings(body) {
  const settings = {
    workflow: body.workflow || "",
    profileId: body.profileId || "",
    steps: Number(body.steps || 0),
    cfg: Number(body.cfg || 0),
    sampler: body.sampler || "",
    scheduler: body.scheduler || "",
    seed: body.seed || "Random",
    textEncoder: body.textEncoder || "",
    vae: body.vae || "",
    clipType: body.clipType || "",
    weightDtype: body.weightDtype || "",
    referenceImageName: body.startImageName || ""
  };
  if (body.kind === "image") {
    settings.count = Number(body.count || 1);
    const loras = Array.isArray(body.loras)
      ? body.loras.filter((item) => item?.enabled !== false && item?.name).slice(0, 4).map((item) => ({
        name: String(item.name || ""),
        enabled: true,
        strength: Number(item.strength ?? 0.7)
      }))
      : [];
    if (loras.length) settings.loras = loras;
    if (body.startImage || body.startImageId) settings.denoise = Number(body.denoise || 0);
  }
  if (body.kind === "video") {
    settings.frames = Number(body.frames || 0);
    settings.fps = Number(body.fps || 0);
  }
  return settings;
}

export function replaceGalleryJob(id, outputs, body, jobs, status = "done") {
  const title = promptTitle(body.prompt);
  const job = jobs.get(id) || {};
  const durationMs = job.startedAt ? Date.now() - job.startedAt : 0;
  const existing = gallery.filter((item) => item.jobId === id);
  const completed = outputs.map((item, index) => ({
    ...item,
    id: item.url,
    jobId: id,
    status,
    prompt: body.prompt || "",
    negative: body.negative || "",
    filename: title || item.filename,
    createdAt: existing[index]?.createdAt || new Date().toISOString(),
    durationMs,
    width: Number(body.width || 0),
    height: Number(body.height || 0),
    model: body.model || "",
    referenceImage: body.startImageId || "",
    referenceImageName: body.startImageName || "",
    startImageId: body.startImageId || "",
    settings: generationSettings(body),
    outputName: item.filename,
    index
  }));
  let nextIndex = 0;
  const replaced = [];
  gallery.forEach((item) => {
    if (item.jobId !== id) {
      replaced.push(item);
      return;
    }
    if (completed[nextIndex]) replaced.push(completed[nextIndex++]);
  });
  while (completed[nextIndex]) replaced.unshift(completed[nextIndex++]);
  setGallery(dedupeGallery(replaced).slice(0, galleryLimit));
  return completed;
}

export function updateGalleryJob(id, patch, options = {}) {
  let changed = false;
  const before = gallery;
  gallery = gallery.map((item) => {
    if (item.jobId === id || item.id === id || item.url === id) {
      changed = true;
      return { ...item, ...patch };
    }
    return item;
  });
  if (changed) {
    bumpRevision(diffGallery(before, gallery));
    if (options.persist !== false) saveGallery();
  }
  return changed;
}

export function updateGalleryJobPreviews(id, previews = []) {
  if (!Array.isArray(previews) || !previews.length) return false;
  let changed = false;
  let fallbackIndex = 0;
  const before = gallery;
  gallery = gallery.map((item) => {
    if (item.jobId !== id) return item;
    const index = Number.isInteger(item.index) ? item.index : fallbackIndex;
    fallbackIndex += 1;
    const preview = previews[index];
    if (!preview || item.preview === preview) return item;
    changed = true;
    return { ...item, preview };
  });
  if (changed) bumpRevision(diffGallery(before, gallery));
  return changed;
}

import fs from "node:fs";
import path from "node:path";
import { comfy, comfyModelsDir } from './comfy.js';
import { dataDir } from './gallery-store.js';

/**
 * Which built-in graph a model file belongs to. Filenames lie (fine-tunes get
 * renamed, "flux1-krea-dev" is a Flux model), so the weights themselves are the
 * first witness: a safetensors header lists every tensor name and shape, and the
 * same key signatures ComfyUI's model_detection.py uses identify the architecture.
 *
 * Resolution order, strongest first:
 *   1. choice   - the user picked "Use as …" for this file
 *   2. file     - tensor keys read from the local file (ComfyUI on this machine)
 *   3. metadata - modelspec.architecture via ComfyUI's /view_metadata (remote ComfyUI)
 *   4. name     - filename patterns
 *   5. default  - checkpoints fall back to the SD-style checkpoint graph
 */

export const modelTypes = {
  krea2: { label: "Krea 2", sources: ["unet", "checkpoint"] },
  "z-image": { label: "Z-Image", sources: ["unet"] },
  wan: { label: "Wan video", sources: ["unet"] },
  checkpoint: { label: "SD / SDXL checkpoint", sources: ["checkpoint"] }
};

export const modelSources = ["unet", "checkpoint"];

const sourceFolders = {
  unet: ["diffusion_models", "unet"],
  checkpoint: ["checkpoints"]
};

// ComfyUI's /view_metadata folder names for the same sources.
const metadataFolders = { unet: "diffusion_models", checkpoint: "checkpoints" };

const choicesPath = () => path.join(dataDir, "model-types.json");
let choicesCache = null;

function choiceKey(source, name) {
  return `${source}:${name}`;
}

export function loadModelChoices() {
  if (choicesCache) return choicesCache;
  try {
    const raw = JSON.parse(fs.readFileSync(choicesPath(), "utf8"));
    choicesCache = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    choicesCache = {};
  }
  return choicesCache;
}

/** Remember "Use as …" for one file; an empty type goes back to detection. */
export function setModelChoice(source, name, type) {
  const safeSource = String(source || "");
  const safeName = String(name || "").trim();
  const safeType = String(type || "");
  if (!modelSources.includes(safeSource)) throw new Error("Unknown model folder.");
  if (!safeName || safeName.length > 1024) throw new Error("Choose a model file.");
  if (safeType && !modelTypes[safeType]?.sources.includes(safeSource)) {
    throw new Error(`${modelTypes[safeType]?.label || "That type"} cannot load from this folder.`);
  }
  const next = { ...loadModelChoices() };
  if (safeType) next[choiceKey(safeSource, safeName)] = safeType;
  else delete next[choiceKey(safeSource, safeName)];
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(choicesPath(), JSON.stringify(next, null, 2));
  choicesCache = next;
  return next;
}

/* ------------------------------------------------------------ Filenames */

function isKrea2Name(name = "") {
  // FLUX.1 Krea [dev] is a Flux fine-tune, not Krea 2.
  return /krea/i.test(name) && !/flux|krea[-_ .]?1(?!\d)/i.test(name);
}

/**
 * Raw (the undistilled base) and Turbo share every tensor, so only the filename
 * can tell them apart. Anything not clearly Raw is treated as Turbo, the model
 * most people run.
 */
export function isKrea2RawName(name = "") {
  const base = String(name).split(/[\\/]/).pop() || "";
  return /raw|base/i.test(base) && !/turbo|tdm|distill/i.test(base);
}

/**
 * Raw samples with a resolution-dependent timestep shift: mu runs linearly from
 * 0.5 at 256 image tokens to 1.15 at 6400 (16 px per token), like diffusers'
 * Krea2Pipeline. Turbo is distilled for a fixed 1.15, which ComfyUI already uses.
 */
export function krea2RawShift(width, height) {
  const tokens = Math.ceil(Number(width || 1024) / 16) * Math.ceil(Number(height || 1024) / 16);
  const mu = 0.5 + (tokens - 256) * (1.15 - 0.5) / (6400 - 256);
  return Math.round(mu * 1000) / 1000;
}

/**
 * Z-Image Base versus Turbo, again by name alone. The official base file has no
 * marker ("z_image_bf16"), so a bare z_image plus precision tags counts as Base
 * too. Everything else is Turbo, which most fine-tunes build on.
 */
export function isZImageBaseName(name = "") {
  const base = String(name).split(/[\\/]/).pop() || "";
  if (/turbo|distill|lightning|\d+[-_ ]?steps?/i.test(base)) return false;
  if (/base|raw/i.test(base)) return true;
  return /^z[-_ ]?image(?:[-_](?:bf16|fp16|fp32|fp8\w*|nvfp4|int8|scaled|e4m3fn))*\.safetensors$/i.test(base);
}

function isZImageName(name = "") {
  return /z[-_ ]?anime|z[-_ ]?image/i.test(name);
}

function isWanName(name = "") {
  return /wan/i.test(name);
}

function typeFromName(name = "") {
  if (isKrea2Name(name)) return "krea2";
  if (isZImageName(name)) return "z-image";
  if (isWanName(name)) return "wan";
  return "";
}

/* ------------------------------------------------------------ Tensor headers */

// Headers of multi-billion-parameter models run to a few MB; anything far past
// that is not a header worth parsing.
const maxHeaderBytes = 64 * 1024 * 1024;
const headerCache = new Map();

export function readSafetensorsHeader(file) {
  const fd = fs.openSync(file, "r");
  try {
    const lengthBytes = Buffer.alloc(8);
    if (fs.readSync(fd, lengthBytes, 0, 8, 0) < 8) return null;
    const length = Number(lengthBytes.readBigUInt64LE(0));
    if (!length || length > maxHeaderBytes) return null;
    const header = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const count = fs.readSync(fd, header, read, length - read, 8 + read);
      if (!count) return null;
      read += count;
    }
    const parsed = JSON.parse(header.toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The architecture a header describes: one of our types, "other" for weights we
 * recognise as something else, or "" when there is nothing to go on. Keys may
 * carry a prefix (model.diffusion_model. in all-in-one checkpoints), so match
 * on the suffix.
 */
export function typeFromHeader(header) {
  if (!header || typeof header !== "object") return "";
  const keys = Object.keys(header).filter((key) => key !== "__metadata__");
  if (!keys.length) return "";
  const find = (suffix) => keys.find((key) => key === suffix || key.endsWith(`.${suffix}`));
  if (find("txtfusion.projector.weight")) return "krea2";
  const capEmbedder = find("cap_embedder.1.weight");
  // Lumina 2 and Z-Image share a layout; Z-Image is the 3840-wide one. Any
  // other width is a variant we have not seen, so let the filename decide.
  if (capEmbedder && find("noise_refiner.0.attention.k_norm.weight")) {
    const width = Number(header[capEmbedder]?.shape?.[0]);
    return width === 3840 ? "z-image" : width === 2304 ? "other" : "";
  }
  if (find("head.modulation")) return "wan";
  if (keys.some((key) => key.includes("input_blocks."))) return "checkpoint";
  return "other";
}

function localModelFile(source, name) {
  const modelsDir = comfyModelsDir();
  if (!modelsDir || !/\.safetensors$/i.test(name)) return "";
  const parts = String(name).split(/[\\/]/).filter(Boolean);
  if (parts.some((part) => part === "..")) return "";
  for (const folder of sourceFolders[source] || []) {
    const base = path.join(modelsDir, folder);
    const file = path.join(base, ...parts);
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch {
      // Not in this folder.
    }
  }
  return "";
}

function typeFromLocalFile(source, name) {
  const file = localModelFile(source, name);
  if (!file) return "";
  let stat;
  try { stat = fs.statSync(file); } catch { return ""; }
  const key = `${file}:${stat.size}:${stat.mtimeMs}`;
  if (headerCache.has(key)) return headerCache.get(key);
  let type = "";
  try { type = typeFromHeader(readSafetensorsHeader(file)); } catch { type = ""; }
  headerCache.set(key, type);
  return type;
}

/* ------------------------------------------------------------ ComfyUI metadata */

// source:name -> architecture string ("" when the file carries none).
const metadataCache = new Map();

export function typeFromArchitecture(architecture = "") {
  const text = String(architecture || "").trim();
  if (!text) return "";
  if (/krea[-_ .]?2/i.test(text)) return "krea2";
  if (/z[-_ ]?image/i.test(text)) return "z-image";
  if (/\bwan/i.test(text)) return "wan";
  if (/stable-diffusion|sdxl|sd[-_ ]?1|sd[-_ ]?2/i.test(text)) return "checkpoint";
  return "other";
}

/**
 * Fetch safetensors metadata for models this machine cannot read directly, so a
 * remote ComfyUI still gets better than filename guesses. Only the __metadata__
 * block comes back (no tensor names), so this is weaker than a local header.
 */
export async function primeModelMetadata(lists = {}, { concurrency = 6 } = {}) {
  const queue = [];
  for (const source of modelSources) {
    for (const name of lists[source] || []) {
      const key = choiceKey(source, name);
      if (metadataCache.has(key) || !/\.safetensors$/i.test(name)) continue;
      if (typeFromLocalFile(source, name)) continue;
      queue.push({ source, name, key });
    }
  }
  async function worker() {
    while (queue.length) {
      const { source, name, key } = queue.shift();
      try {
        const metadata = await comfy(`/view_metadata/${metadataFolders[source]}?filename=${encodeURIComponent(name)}`);
        metadataCache.set(key, String(metadata?.["modelspec.architecture"] || ""));
      } catch (error) {
        // 404 means "no metadata block" and is worth remembering; anything else
        // (ComfyUI restarting, timeouts) gets retried on the next scan.
        if (/Comfy 404/.test(error?.message || "")) metadataCache.set(key, "");
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
}

/* ------------------------------------------------------------ Resolution */

/** { type, via } for one file. type is "" when no built-in graph fits. */
export function classifyModel(source, name) {
  const allowed = (type) => Boolean(type && modelTypes[type]?.sources.includes(source));
  const fallback = source === "checkpoint" ? "checkpoint" : "";
  const chosen = loadModelChoices()[choiceKey(source, name)];
  if (allowed(chosen)) return { type: chosen, via: "choice" };

  // A readable header is the truth, including "this is something else": a Flux
  // file named after Krea must not be routed to the Krea graph.
  const fromFile = typeFromLocalFile(source, name);
  if (fromFile) return { type: allowed(fromFile) ? fromFile : fallback, via: "file" };

  const fromMetadata = typeFromArchitecture(metadataCache.get(choiceKey(source, name)));
  if (fromMetadata) return { type: allowed(fromMetadata) ? fromMetadata : fallback, via: "metadata" };

  const fromName = typeFromName(name);
  if (allowed(fromName)) return { type: fromName, via: "name" };
  return { type: fallback, via: fallback ? "default" : "" };
}

export function modelTypeChoices() {
  return Object.fromEntries(modelSources.map((source) => [
    source,
    Object.entries(modelTypes)
      .filter(([, type]) => type.sources.includes(source))
      .map(([value, type]) => ({ value, label: type.label }))
  ]));
}

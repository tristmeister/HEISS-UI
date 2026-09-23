import fs from "node:fs";
import path from "node:path";
import { comfy, comfyModelsDir } from './comfy.js';
import { dataDir } from './gallery-store.js';
import { families, familyFromHeader, familyFromName, isKrea2Raw, isZImageBase, knownFamilies, variantFor } from './family-catalog.js';

/**
 * Which family (and variant) a model file belongs to, and which parts an
 * all-in-one checkpoint carries. Filenames lie (fine-tunes get renamed,
 * "flux1-krea-dev" is a Flux model), so the weights are the first witness.
 *
 * Resolution order, strongest first:
 *   1. choice   - the user picked "Use as …" for this file
 *   2. file     - tensor keys read from the local file (ComfyUI on this machine)
 *   3. metadata - modelspec fields via ComfyUI's /view_metadata (remote ComfyUI)
 *   4. name     - filename patterns
 *   5. default  - checkpoints fall back to the SD family, which loads itself
 */

export const modelSources = ["unet", "checkpoint"];

const sourceFolders = {
  unet: ["diffusion_models", "unet"],
  checkpoint: ["checkpoints"]
};

// ComfyUI's /view_metadata folder names for the same sources.
const metadataFolders = { unet: "diffusion_models", checkpoint: "checkpoints" };

/* ------------------------------------------------------------ Choices */

const choicesPath = () => path.join(dataDir, "model-types.json");
let choicesCache = null;

// Earlier builds stored coarser type names; read them as today's families.
const legacyChoices = { "z-image": "zimage", wan: "wan22_5b", checkpoint: "" };

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

function saveChoices(next) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(choicesPath(), JSON.stringify(next, null, 2));
  choicesCache = next;
}

/** "family" or "family/variant", checked against what that folder can load. */
function parseChoice(value, source) {
  if (typeof value !== "string") return null;
  const raw = Object.hasOwn(legacyChoices, value) ? legacyChoices[value] : value;
  if (!raw) return null;
  const [familyId, variantId = ""] = raw.split("/");
  const family = families[familyId];
  if (!family || !family.sources.includes(source)) return null;
  if (variantId && !family.variants.some((variant) => variant.id === variantId)) return null;
  return { family: familyId, variant: variantId };
}

/** Remember "Use as …" for one file; an empty choice goes back to detection. */
export function setModelChoice(source, name, choice) {
  const safeSource = String(source || "");
  const safeName = String(name || "").trim();
  const safeChoice = String(choice || "");
  if (!modelSources.includes(safeSource)) throw new Error("Unknown model folder.");
  if (!safeName || safeName.length > 1024) throw new Error("Choose a model file.");
  if (safeChoice && !parseChoice(safeChoice, safeSource)) {
    const family = families[safeChoice.split("/")[0]];
    throw new Error(family ? `${family.label} cannot load from this folder.` : "Unknown model type.");
  }
  const next = { ...loadModelChoices() };
  if (safeChoice) next[choiceKey(safeSource, safeName)] = safeChoice;
  else delete next[choiceKey(safeSource, safeName)];
  saveChoices(next);
  return next;
}

/** Options for the "Use as …" picker: every family, and each variant where there is a choice to make. */
export function modelTypeChoices() {
  return Object.fromEntries(modelSources.map((source) => [
    source,
    Object.entries(families)
      .filter(([, family]) => family.sources.includes(source))
      .flatMap(([id, family]) => family.variants.length > 1
        ? family.variants.map((variant) => ({ value: `${id}/${variant.id}`, label: `${family.label} · ${variant.label}` }))
        : [{ value: id, label: family.label }])
  ]));
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

function localModelFile(source, name) {
  const modelsDir = comfyModelsDir();
  if (!modelsDir || !/\.safetensors$/i.test(name)) return "";
  const parts = String(name).split(/[\\/]/).filter(Boolean);
  if (parts.some((part) => part === "..")) return "";
  for (const folder of sourceFolders[source] || []) {
    const file = path.join(modelsDir, folder, ...parts);
    try { if (fs.statSync(file).isFile()) return file; } catch { /* next folder */ }
  }
  return "";
}

/** The local header of a model file, cached by size and mtime; null when out of reach. */
export function modelHeader(source, name) {
  const file = localModelFile(source, name);
  if (!file) return null;
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  const key = `${file}:${stat.size}:${stat.mtimeMs}`;
  if (!headerCache.has(key)) {
    let header = null;
    try { header = readSafetensorsHeader(file); } catch { header = null; }
    headerCache.set(key, header);
  }
  return headerCache.get(key);
}

/**
 * Which parts an all-in-one checkpoint carries, from its tensor prefixes
 * (ComfyUI's text_encoder_key_prefix / vae_key_prefix). null when unreadable.
 */
export function bundledParts(header) {
  if (!header) return null;
  const keys = Object.keys(header);
  const encoder = keys.some((key) => key.startsWith("text_encoders.") || key.startsWith("cond_stage_model.") || key.startsWith("conditioner.embedders."));
  const vae = keys.some((key) => key.startsWith("first_stage_model.") || key.startsWith("vae."));
  return { encoder, vae };
}

/* ------------------------------------------------------------ ComfyUI metadata */

// source:name -> __metadata__ block ({} when the file carries none).
const metadataCache = new Map();

/** A family from safetensors metadata (modelspec, kohya ss_* fields), or "". */
export function familyFromMetadata(metadata = {}) {
  const text = [metadata["modelspec.architecture"], metadata["modelspec.title"], metadata.ss_base_model_version]
    .filter(Boolean).join(" ").toLowerCase();
  if (!text) return "";
  if (/krea[-_ .]?2/.test(text)) return "krea2";
  if (/z[-_ ]?image/.test(text)) return "zimage";
  if (/qwen[-_ ]?image/.test(text)) return "qwen_image";
  if (/chroma/.test(text)) return "chroma";
  if (/hidream/.test(text)) return "hidream";
  if (/flux[-_. ]?2|klein/.test(text)) return "";
  if (/flux/.test(text)) return "flux1";
  if (/stable-diffusion-v3|sd3/.test(text)) return "sd3";
  if (/xl/.test(text)) return "sdxl";
  if (/stable-diffusion-v2|sd_?v?2/.test(text)) return "sd2";
  if (/stable-diffusion-v1|sd_?v?1/.test(text)) return "sd15";
  return "";
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
      if (modelHeader(source, name)) continue;
      queue.push({ source, name, key });
    }
  }
  async function worker() {
    while (queue.length) {
      const { source, name, key } = queue.shift();
      try {
        const metadata = await comfy(`/view_metadata/${metadataFolders[source]}?filename=${encodeURIComponent(name)}`);
        metadataCache.set(key, metadata && typeof metadata === "object" ? metadata : {});
      } catch (error) {
        // 404 means "no metadata block" and is worth remembering; anything else
        // (ComfyUI restarting, timeouts) gets retried on the next scan.
        if (/Comfy 404/.test(error?.message || "")) metadataCache.set(key, {});
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
}

/* ------------------------------------------------------------ Learned facts */

// Checkpoints that turned out to lack a text encoder or VAE when ComfyUI loaded
// them. Only needed where the header is out of reach; kept with the choices.
const learnedKey = (name) => `learned:${name}`;

export function rememberMissingParts(name, missing = {}) {
  const current = loadModelChoices()[learnedKey(name)] || {};
  saveChoices({ ...loadModelChoices(), [learnedKey(name)]: { encoder: Boolean(current.encoder || missing.encoder), vae: Boolean(current.vae || missing.vae) } });
}

/** Which parts a checkpoint carries: its header, what a failed run taught us, or an assumption. */
function bundledFor(name, header) {
  const fromHeader = bundledParts(header);
  if (fromHeader) return { ...fromHeader, known: true };
  const learned = loadModelChoices()[learnedKey(name)];
  if (learned) return { encoder: !learned.encoder, vae: !learned.vae, known: true };
  // Unknown until ComfyUI tries: assume all-in-one, which is what checkpoints/ usually holds.
  return { encoder: true, vae: true, known: false };
}

/* ------------------------------------------------------------ Resolution */

/**
 * Everything HEISS knows about one model file:
 *   family   - a key of `families` (runnable), a `knownFamilies` id, or ""
 *   variant  - the variant object within the family
 *   via      - how we know: choice, file, metadata, name, default
 *   bundled  - { encoder, vae, known } for checkpoints, null for diffusion models
 *   detail   - family-specific facts from the header (e.g. Flux schnell)
 */
export function classifyModel(source, name) {
  const base = String(name).split(/[\\/]/).pop() || "";
  const header = modelHeader(source, name);
  const bundled = source === "checkpoint" ? bundledFor(name, header) : null;
  const finish = (familyId, via, detail = null, variantId = "") => {
    let id = familyId || "";
    // Wan 2.1 14B and Wan 2.2 14B share every key; the high/low-noise pair shows in the name.
    if (id === "wan21" && /(high|low)[-_ ]?noise/i.test(base)) id = "wan22_14b";
    const family = families[id];
    const variant = family
      ? (variantId && family.variants.find((item) => item.id === variantId)) || variantFor(id, base, header, detail)
      : null;
    return { family: id, variant, via, bundled, detail, header };
  };

  const chosen = parseChoice(loadModelChoices()[choiceKey(source, name)], source);
  if (chosen) return finish(chosen.family, "choice", null, chosen.variant);

  if (header) {
    const { family, detail } = familyFromHeader(header);
    if (family && family !== "other") return finish(family, "file", detail);
    // A checkpoint ComfyUI can load but we cannot place still runs as an SD-family file.
    if (family === "other") return source === "checkpoint" ? finish("sdxl", "default") : finish("other", "file");
  }

  const fromMetadata = familyFromMetadata(metadataCache.get(choiceKey(source, name)) || {});
  if (fromMetadata && families[fromMetadata]?.sources.includes(source)) return finish(fromMetadata, "metadata");

  const fromName = familyFromName(name, source);
  if (fromName === "sdxl_or_sd15") return finish(/1[._]?5|sd15|v1[-_]5/i.test(base) ? "sd15" : "sdxl", "default");
  if (fromName && families[fromName]?.sources.includes(source)) return finish(fromName, "name");
  return finish("", "");
}

export function familyLabel(id) {
  return families[id]?.label || knownFamilies[id] || "";
}

/* ------------------------------------------------------------ Krea 2 Raw shift */

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

export { isKrea2Raw as isKrea2RawName, isZImageBase as isZImageBaseName };

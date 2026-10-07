import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { localOutputFile, modelFolders } from "./comfy.js";
import { dataDir } from "./gallery-store.js";
import { readJsonFile, renameWithRetryAsync, writeJsonFile } from "./json-store.js";
import { withPngText } from "./png-text.js";

/**
 * Civitai-ready PNGs (beta, off unless switched on in Settings › Library).
 *
 * ComfyUI saves its graph in every PNG, which Civitai does not read. With
 * this on, each new PNG from the gallery also gets the "parameters" text
 * AUTOMATIC1111 writes: the prompt with its LoRAs as <lora:name:weight>, the
 * negative prompt, then steps, sampler, CFG, seed, size and model. Civitai
 * reads that to fill in an upload and link the model and LoRAs by hash.
 *
 * It is written into the file in ComfyUI's output folder right after a run,
 * so the file you download, share or pick up from the folder all carry it.
 * Never for Hidden: those runs are sealed before this could see them, and
 * the caller skips them anyway.
 */

const prefsPath = path.join(dataDir, "civitai.json");
const hashesPath = path.join(dataDir, "model-hashes.json");

let prefs = loadPrefs();

function loadPrefs() {
  try {
    const value = readJsonFile(prefsPath);
    return { enabled: value?.enabled === true };
  } catch {
    return { enabled: false };
  }
}

export function civitaiPrefs() {
  return { ...prefs };
}

export function saveCivitaiPrefs(next = {}) {
  prefs = { enabled: next.enabled === true };
  writeJsonFile(prefsPath, prefs);
  return civitaiPrefs();
}

const appVersion = (() => {
  try { return JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version || ""; } catch { return ""; }
})();

/* ------------------------------------------------------------ Names */

const samplerNames = {
  euler: "Euler",
  euler_ancestral: "Euler a",
  heun: "Heun",
  dpm_2: "DPM2",
  dpm_2_ancestral: "DPM2 a",
  lms: "LMS",
  dpm_fast: "DPM fast",
  dpm_adaptive: "DPM adaptive",
  dpmpp_2s_ancestral: "DPM++ 2S a",
  dpmpp_sde: "DPM++ SDE",
  dpmpp_2m: "DPM++ 2M",
  dpmpp_2m_sde: "DPM++ 2M SDE",
  dpmpp_3m_sde: "DPM++ 3M SDE",
  ddim: "DDIM",
  uni_pc: "UniPC",
  lcm: "LCM"
};

const scheduleNames = {
  karras: "Karras",
  exponential: "Exponential",
  sgm_uniform: "SGM Uniform",
  simple: "Simple",
  beta: "Beta",
  ddim_uniform: "DDIM Uniform",
  kl_optimal: "KL Optimal"
};

/** ComfyUI's sampler as AUTOMATIC1111 names it, where there is a name for it. */
export function a1111Sampler(sampler = "") {
  return samplerNames[sampler] || String(sampler || "");
}

function stem(name = "") {
  return path.basename(String(name || "").replace(/\\/g, "/")).replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i, "");
}

function field(value) {
  const text = String(value);
  return /[,:"]/.test(text) ? JSON.stringify(text) : text;
}

/**
 * The A1111 "parameters" text for one image. `hashes` maps a model or LoRA
 * file name to its AutoV2 hash (first ten hex digits of its SHA-256), for
 * those already worked out.
 */
export function parametersText(body = {}, { width = 0, height = 0, hashes = {} } = {}) {
  const loras = (Array.isArray(body.loras) ? body.loras : []).filter((lora) => lora?.name && lora.enabled !== false);
  const loraTags = loras.map((lora) => `<lora:${stem(lora.name)}:${Number(Number(lora.strength ?? 0.7).toFixed(2))}>`);
  const prompt = [String(body.prompt || "").trim(), ...loraTags].filter(Boolean).join(" ");
  const lines = [prompt];
  if (String(body.negative || "").trim()) lines.push(`Negative prompt: ${String(body.negative).trim()}`);
  const modelFile = body.modelName || body.model || "";
  const settings = [];
  if (Number(body.steps) > 0) settings.push(["Steps", Number(body.steps)]);
  if (body.sampler) settings.push(["Sampler", a1111Sampler(body.sampler)]);
  if (body.scheduler && body.scheduler !== "normal") settings.push(["Schedule type", scheduleNames[body.scheduler] || body.scheduler]);
  if (Number(body.cfg) > 0) settings.push(["CFG scale", Number(body.cfg)]);
  if (/^\d+$/.test(String(body.seed ?? "").trim())) settings.push(["Seed", String(body.seed).trim()]);
  const w = Number(width || body.width || 0);
  const h = Number(height || body.height || 0);
  if (w && h) settings.push(["Size", `${w}x${h}`]);
  if (modelFile && hashes[modelFile]) settings.push(["Model hash", hashes[modelFile]]);
  if (modelFile && !String(modelFile).startsWith("custom:")) settings.push(["Model", stem(modelFile)]);
  const hasReference = Boolean(body.startImageId || body.startImage || body.referenceAssets?.length);
  if (hasReference && Number(body.denoise) > 0 && Number(body.denoise) < 1) settings.push(["Denoising strength", Number(body.denoise)]);
  const loraHashes = loras.filter((lora) => hashes[lora.name]).map((lora) => `${stem(lora.name)}: ${hashes[lora.name]}`);
  if (loraHashes.length) settings.push(["Lora hashes", loraHashes.join(", ")]);
  if (appVersion) settings.push(["Version", `HEISS UI ${appVersion}`]);
  if (settings.length) lines.push(settings.map(([key, value]) => `${key}: ${field(value)}`).join(", "));
  return lines.join("\n");
}

/* ------------------------------------------------------------ Hashes */

let hashCache = null;
const hashing = new Set();

function loadHashes() {
  if (hashCache) return hashCache;
  try { hashCache = readJsonFile(hashesPath) || {}; } catch { hashCache = {}; }
  return hashCache;
}

const folderKinds = {
  checkpoint: ["checkpoints", ["checkpoints"]],
  unet: ["diffusion_models", ["diffusion_models", "unet"]],
  lora: ["loras", ["loras"]]
};

function localModel(kinds, name) {
  const parts = String(name || "").split(/[\\/]/).filter(Boolean);
  if (!parts.length || parts.some((part) => part === "..")) return "";
  for (const kind of kinds) {
    for (const dir of modelFolders(...folderKinds[kind])) {
      const file = path.join(dir, ...parts);
      try { if (fs.statSync(file).isFile()) return file; } catch { /* next folder */ }
    }
  }
  return "";
}

/**
 * A model file's AutoV2 hash when it is already known. Otherwise it is worked
 * out in the background (a big model takes a few seconds to read) and the
 * next image carries it: a run never waits for a hash.
 */
export function knownHash(kinds, name) {
  const file = localModel(kinds, name);
  if (!file) return "";
  let stat;
  try { stat = fs.statSync(file); } catch { return ""; }
  const key = `${file}|${stat.size}|${Math.round(stat.mtimeMs)}`;
  const cache = loadHashes();
  if (cache[key]) return String(cache[key]).slice(0, 10);
  if (!hashing.has(key)) {
    hashing.add(key);
    const hash = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("data", (data) => hash.update(data))
      .on("error", () => hashing.delete(key))
      .on("end", () => {
        hashing.delete(key);
        loadHashes()[key] = hash.digest("hex");
        try { writeJsonFile(hashesPath, hashCache); } catch { /* next run tries again */ }
      });
  }
  return "";
}

function hashesFor(body) {
  const hashes = {};
  const modelFile = body.modelName || body.model || "";
  if (modelFile && !String(modelFile).startsWith("custom:")) {
    const kinds = body.source === "checkpoint" ? ["checkpoint"] : body.source === "unet" ? ["unet"] : ["checkpoint", "unet"];
    const hash = knownHash(kinds, modelFile);
    if (hash) hashes[modelFile] = hash;
  }
  for (const lora of Array.isArray(body.loras) ? body.loras : []) {
    if (!lora?.name) continue;
    const hash = knownHash(["lora"], lora.name);
    if (hash) hashes[lora.name] = hash;
  }
  return hashes;
}

/* ------------------------------------------------------------ Writing */

function outputFile(output) {
  try {
    const params = new URL(String(output?.url || ""), "http://heiss.local").searchParams;
    return localOutputFile(params.get("filename") || "", params.get("subfolder") || "", params.get("type") || "output");
  } catch {
    return null;
  }
}

/**
 * Writes the parameters text into a run's PNGs in the output folder. A file
 * this cannot reach (ComfyUI on another computer) or that is not a PNG is
 * left as it is. Never throws: a run's images matter more than their tags.
 *
 * The files are read and written off the main thread, all at once, each into
 * a temporary file renamed over the original, so nothing ever reads one
 * half-written and the server keeps answering while a 4K PNG is rewritten.
 */
export async function writeCivitaiParameters(outputs, body) {
  if (!prefs.enabled || body?.privateVault) return 0;
  const hashes = hashesFor(body);
  const files = (outputs || [])
    .filter((output) => output?.type !== "video")
    .map(outputFile)
    .filter((file) => file && /\.png$/i.test(file));
  const written = await Promise.all([...new Set(files)].map(async (file) => {
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.heiss-tmp`;
    try {
      const buffer = await fs.promises.readFile(file);
      const width = buffer.length > 24 ? buffer.readUInt32BE(16) : 0;
      const height = buffer.length > 24 ? buffer.readUInt32BE(20) : 0;
      const next = withPngText(buffer, "parameters", parametersText(body, { width, height, hashes }));
      if (!next) return 0;
      await fs.promises.writeFile(temp, next);
      await renameWithRetryAsync(temp, file);
      return 1;
    } catch {
      // Read-only folder, or the file moved: it simply goes without.
      await fs.promises.rm(temp, { force: true }).catch(() => {});
      return 0;
    }
  }));
  return written.reduce((sum, one) => sum + one, 0);
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { comfy, comfyModelsDir, comfyOutputDir, optionsFor } from "./comfy.js";

// SeedVR2 restores detail rather than interpolating it, so the pipeline mirrors
// the reference workflow: soften the source with a lanczos pre-scale, then let
// the model rebuild the short side at the requested resolution.
export const upscaleQualities = ["fast", "balanced", "high"];

/**
 * Every file HEISS UI may download, with the exact size and SHA-256 Hugging Face
 * publishes for it (the same hashes the SeedVR2 node's own registry checks).
 * Knowing them up front means the download dialog never guesses a size and a
 * finished download is verified before anything tries to load it.
 */
export const modelFiles = {
  "seedvr2_ema_3b_fp8_e4m3fn.safetensors": {
    repo: "numz/SeedVR2_comfyUI", label: "SeedVR2 3B", detail: "fp8", bytes: 3_391_544_696,
    sha256: "3bf1e43ebedd570e7e7a0b1b60d6a02e105978f505c8128a241cde99a8240cff"
  },
  "seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors": {
    repo: "AInVFX/SeedVR2_comfyUI", label: "SeedVR2 7B", detail: "fp8, last block fp16", bytes: 8_466_296_338,
    sha256: "3d68b5ec0b295ae28092e355c8cad870edd00b817b26587d0cb8f9dd2df19bb2"
  },
  "seedvr2_ema_7b_fp8_e4m3fn.safetensors": {
    repo: "numz/SeedVR2_comfyUI", label: "SeedVR2 7B", detail: "fp8", bytes: 8_239_729_704,
    sha256: "1fdbf3877b7d1eb266038d3a165a977f17dbb4daa4a0f0d334d5461476963037"
  },
  "seedvr2_ema_7b_fp16.safetensors": {
    repo: "numz/SeedVR2_comfyUI", label: "SeedVR2 7B", detail: "fp16", bytes: 16_479_334_424,
    sha256: "7b8241aa957606ab6cfb66edabc96d43234f9819c5392b44d2492d9f0b0bbe4a"
  },
  "ema_vae_fp16.safetensors": {
    repo: "numz/SeedVR2_comfyUI", label: "SeedVR2 VAE", detail: "fp16", bytes: 501_324_814,
    sha256: "20678548f420d98d26f11442d3528f8b8c94e57ee046ef93dbb7633da8612ca1"
  }
};

/**
 * Each tier lists its DiT weights best first. Balanced prefers the mixed fp8
 * build: the plain 7B fp8 file shows artifacts the SeedVR2 authors fixed by
 * keeping the last block in fp16. The plain one still counts if it is already
 * on disk, so nobody re-downloads 8 GB for a small quality difference.
 */
const ditTiers = {
  fast: ["seedvr2_ema_3b_fp8_e4m3fn.safetensors"],
  balanced: ["seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors", "seedvr2_ema_7b_fp8_e4m3fn.safetensors"],
  high: ["seedvr2_ema_7b_fp16.safetensors"]
};
const vaeFile = "ema_vae_fp16.safetensors";

/**
 * Names the SeedVR2 node (2.5+) always offers in its dropdowns, downloaded or
 * not: it fetches a missing one itself on first use, with no progress anyone can
 * see. So a listed registry name proves nothing; only the file on disk does.
 * Names outside this list are files the node discovered on disk, so those count.
 */
const nodeRegistryNames = new Set([
  "seedvr2_ema_3b-Q4_K_M.gguf", "seedvr2_ema_3b-Q8_0.gguf", "seedvr2_ema_3b_fp8_e4m3fn.safetensors", "seedvr2_ema_3b_fp16.safetensors",
  "seedvr2_ema_7b-Q4_K_M.gguf", "seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors", "seedvr2_ema_7b_fp16.safetensors",
  "seedvr2_ema_7b_sharp-Q4_K_M.gguf", "seedvr2_ema_7b_sharp_fp8_e4m3fn_mixed_block35_fp16.safetensors", "seedvr2_ema_7b_sharp_fp16.safetensors",
  "ema_vae_fp16.safetensors"
]);

const presets = {
  fast: { preScale: 1, targetScale: 1.5, maxShort: 1280, blocksToSwap: 16, tileSize: 768 },
  balanced: { preScale: 0.7, targetScale: 2, maxShort: 2048, blocksToSwap: 32, tileSize: 1024 },
  high: { preScale: 0.7, targetScale: 3, maxShort: 2816, blocksToSwap: 36, tileSize: 1024 }
};

export const upscaleNodeClasses = ["SeedVR2LoadDiTModel", "SeedVR2LoadVAEModel", "SeedVR2VideoUpscaler"];
export const faceDetailNodeClasses = ["FaceDetailer", "UltralyticsDetectorProvider", "SAMLoader"];

const repoOverride = process.env.HEISS_SEEDVR2_HF_REPO || process.env.JAI_SEEDVR2_HF_REPO || "";

export function normalizeQuality(value = "") {
  const quality = String(value || "").toLowerCase();
  return upscaleQualities.includes(quality) ? quality : "balanced";
}

function downloadUrl(file) {
  const repo = (repoOverride && modelFiles[file].repo === "numz/SeedVR2_comfyUI") ? repoOverride : modelFiles[file].repo;
  return `https://huggingface.co/${repo}/resolve/main/${encodeURIComponent(file)}?download=true`;
}

/**
 * SeedVR2 keeps its weights in ComfyUI/models/SEEDVR2. The output folder is the
 * only Comfy path HEISS UI already knows, so derive the sibling models folder from
 * it unless an explicit override is set.
 */
export function seedvr2ModelDir() {
  const override = String(process.env.HEISS_SEEDVR2_MODEL_DIR || process.env.JAI_SEEDVR2_MODEL_DIR || "").trim();
  if (override) return path.resolve(override);
  const models = comfyModelsDir();
  if (models) return path.join(models, "SEEDVR2");
  if (!comfyOutputDir) return "";
  return path.join(path.dirname(path.resolve(comfyOutputDir)), "models", "SEEDVR2");
}

function fileSize(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

/** A known file only counts when it is complete; a stray short copy is not a model. */
function onDisk(dir, file) {
  if (!dir) return false;
  const size = fileSize(path.join(dir, file));
  return size > 0 && (!modelFiles[file] || size === modelFiles[file].bytes);
}

function partialBytes(dir, file) {
  return dir ? fileSize(path.join(dir, `${file}.part`)) : 0;
}

function diskDitFiles(dir) {
  if (!dir) return [];
  try {
    return fs.readdirSync(dir).filter((name) => /seedvr2/i.test(name) && /\.(safetensors|gguf)$/i.test(name) && onDisk(dir, name));
  } catch {
    return [];
  }
}

/**
 * What SeedVR2 can load right now, by the name its loader expects. With a known
 * local models folder that is the disk plus whatever the node discovered on
 * other model paths. A remote ComfyUI (no folder) has to be taken at its word;
 * its node downloads anything missing on first use.
 */
function available(info, dir) {
  const ditOptions = optionsFor(info, "SeedVR2LoadDiTModel", "model").map(String);
  const vaeOptions = optionsFor(info, "SeedVR2LoadVAEModel", "model").map(String);
  if (!dir) return { dit: ditOptions.filter((name) => /seedvr2/i.test(name)), vae: vaeOptions, remote: true };
  const discovered = (options) => options.filter((name) => !nodeRegistryNames.has(path.basename(name)));
  const dit = [...new Set([...diskDitFiles(dir), ...discovered(ditOptions).filter((name) => /seedvr2/i.test(name))])];
  const vae = [...new Set([...(onDisk(dir, vaeFile) ? [vaeFile] : []), ...discovered(vaeOptions)])];
  return { dit, vae, remote: false };
}

const byBase = (list, file) => list.find((name) => path.basename(name) === file);

/** The tier's own weight when present, then its alternates, then any SeedVR2 weight at all. */
function resolveDit(quality, have) {
  for (const file of ditTiers[quality]) {
    const found = byBase(have.dit, file);
    if (found) return { file: found };
  }
  return have.dit[0] ? { file: have.dit[0], substituted: true } : { file: ditTiers[quality][0], missing: true };
}

function resolveVae(have) {
  const found = byBase(have.vae, vaeFile) || have.vae[0];
  return found ? { file: found } : { file: vaeFile, missing: true };
}

/** The files this tier would download: its preferred DiT (unless a tier alternate is here) and the VAE. */
export function requiredModelsFor(quality, info, dir = seedvr2ModelDir()) {
  const tier = ditTiers[normalizeQuality(quality)];
  const have = available(info, dir);
  const ditPresent = tier.some((file) => byBase(have.dit, file));
  const ditFile = tier.find((file) => byBase(have.dit, file)) || tier[0];
  return [
    { key: "dit", file: ditFile, present: ditPresent },
    { key: "vae", file: vaeFile, present: Boolean(byBase(have.vae, vaeFile) || have.vae.length) }
  ].map((model) => ({ ...model, ...modelFiles[model.file], partialBytes: model.present ? 0 : partialBytes(dir, model.file) }));
}

function missingNodeClasses(info, classes) {
  return classes.filter((className) => !info?.[className]);
}

/**
 * Several packs ship nodes called SeedVR2-something with entirely different
 * class names. Reporting what is actually loaded turns "nodes missing" on a
 * machine that visibly has SeedVR2 into a diagnosis the user can act on.
 */
function detectedSeedVR2Nodes(info) {
  return Object.keys(info || {}).filter((name) => /seedvr2/i.test(name)).sort();
}

/* ------------------------------------------------------------ node install */

export const seedvr2Repository = "https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git";
const seedvr2Folder = "ComfyUI-SeedVR2_VideoUpscaler";

/** The ComfyUI folder itself, when it sits on this machine next to the models folder we found. */
export function comfyRootDir() {
  const models = comfyModelsDir();
  return models ? path.dirname(models) : "";
}

/**
 * The Python that ComfyUI runs with, so pip installs into the right place.
 * Covers a venv inside ComfyUI, the Desktop app's standalone env and the
 * Windows portable build; anything else falls back to a plain `python`.
 */
export function comfyPython(root, platform = process.platform) {
  if (!root) return "";
  const win = platform === "win32";
  const paths = win ? path.win32 : path.posix;
  const candidates = win
    ? [[".venv", "Scripts", "python.exe"], ["venv", "Scripts", "python.exe"], ["..", "python_embeded", "python.exe"], ["..", "python_embedded", "python.exe"]]
    : [[".venv", "bin", "python"], ["venv", "bin", "python"], ["..", "standalone-env", "bin", "python3"], ["..", ".venv", "bin", "python"]];
  const found = candidates.map((parts) => paths.join(root, ...parts)).find((file) => fs.existsSync(file));
  return found ? paths.resolve(found) : "";
}

/**
 * Setup without ComfyUI Manager: clone the pack into custom_nodes and install
 * its requirements with ComfyUI's own Python. On a machine we can see, the
 * paths are the real ones; if the pack folder is already there but the nodes
 * do not load, only the requirements are missing.
 *
 * Windows gets two spellings. Windows Terminal opens PowerShell 5.1, which
 * knows neither `cd /d` nor `&&` and will not run a quoted path without `&`;
 * `if ($?)` chains steps there the way `&&` does in cmd. Elsewhere a missing
 * environment falls back to `python3`, since many Linux systems have no `python`.
 */
export function nodeInstallPlan(root = comfyRootDir(), platform = process.platform) {
  const win = platform === "win32";
  const paths = win ? path.win32 : path.posix;
  const customNodes = root ? paths.join(root, "custom_nodes") : "";
  const python = comfyPython(root, platform);
  const cloned = Boolean(customNodes) && fs.existsSync(paths.join(customNodes, seedvr2Folder));
  const requirements = paths.join(seedvr2Folder, "requirements.txt");
  const folder = customNodes || paths.join("ComfyUI", "custom_nodes");
  const clone = `git clone ${seedvr2Repository}`;
  const commands = [];
  if (win) {
    const exe = python ? `"${python}"` : "python";
    const steps = [`Set-Location "${folder}"`, ...(cloned ? [] : [clone]), `${python ? "& " : ""}${exe} -m pip install -r ${requirements}`];
    commands.push({ shell: "powershell", label: "PowerShell", command: steps.map((step, i) => (i ? `if ($?) { ${step} }` : step)).join("; ") });
    commands.push({ shell: "cmd", label: "Command Prompt", command: [`cd /d "${folder}"`, ...(cloned ? [] : [clone]), `${exe} -m pip install -r ${requirements}`].join(" && ") });
  } else {
    const exe = python ? `"${python}"` : "python3";
    commands.push({ shell: "sh", label: "Terminal", command: [`cd "${folder}"`, ...(cloned ? [] : [clone]), `${exe} -m pip install -r ${requirements}`].join(" && ") });
  }
  return {
    exact: Boolean(customNodes && python),
    customNodesDir: customNodes,
    python,
    cloned,
    needsGit: !cloned,
    commands
  };
}

/** Manager 4 (pip, off unless ComfyUI starts with --enable-manager) and the older git install answer on different routes. */
export async function managerAvailable() {
  for (const route of ["/v2/manager/version", "/manager/version"]) {
    try {
      await comfy(route);
      return true;
    } catch {
      // Try the next route.
    }
  }
  return false;
}

/** Free space where the models would land; the nearest existing parent answers for a folder not made yet. */
export function freeBytesAt(dir) {
  if (!dir || typeof fs.statfsSync !== "function") return null;
  let current = path.resolve(dir);
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const stats = fs.statfsSync(current);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
  return null;
}

export function upscaleStatus(info = {}, quality = "balanced") {
  const normalized = normalizeQuality(quality);
  const missingNodes = missingNodeClasses(info, upscaleNodeClasses);
  const modelDir = seedvr2ModelDir();
  const have = available(info, modelDir);
  const models = requiredModelsFor(normalized, info, modelDir);
  const missingModels = models.filter((model) => !model.present);
  // A tier can still run on a weight the user already has, so only demand a
  // download when SeedVR2 has nothing at all to load.
  const canSubstitute = have.dit.length > 0 && have.vae.length > 0;
  return {
    quality: normalized,
    nodesInstalled: missingNodes.length === 0,
    missingNodes,
    detectedNodes: detectedSeedVR2Nodes(info),
    modelDir,
    remote: have.remote,
    canDownload: Boolean(modelDir),
    freeBytes: freeBytesAt(modelDir),
    models: models.map(({ key, file, label, detail, bytes, present, partialBytes }) => ({ key, file, label, detail, bytes, present, partialBytes })),
    missingModels: missingModels.map((model) => model.key),
    downloadBytes: missingModels.reduce((sum, model) => sum + model.bytes - model.partialBytes, 0),
    needsDownload: missingModels.length > 0 && !canSubstitute,
    substituting: missingModels.length > 0 && canSubstitute,
    ready: missingNodes.length === 0 && (missingModels.length === 0 || canSubstitute),
    faceDetail: {
      nodesInstalled: missingNodeClasses(info, faceDetailNodeClasses).length === 0,
      missingNodes: missingNodeClasses(info, faceDetailNodeClasses),
      detectors: optionsFor(info, "UltralyticsDetectorProvider", "model_name").map(String),
      samModels: optionsFor(info, "SAMLoader", "model_name").map(String)
    },
    install: installSnapshot()
  };
}

/* ---------------------------------------------------------------- downloads */

let install = null;

function installSnapshot() {
  if (!install) return null;
  const { controller, ...rest } = install;
  return { ...rest, files: rest.files?.map((file) => ({ ...file })) };
}

export function installState() {
  return installSnapshot();
}

class VerifyError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Hashes what an earlier attempt left behind so a resumed file is still checked end to end. */
async function hashExisting(file, hash, signal) {
  await pipeline(fs.createReadStream(file), new Transform({
    transform(chunk, _encoding, done) { hash.update(chunk); done(); }
  }), { signal });
}

/**
 * One file, resumable: a `.part` from a cancelled or failed attempt is picked up
 * with a Range request instead of starting over. Bytes are hashed as they
 * stream, so verification costs nothing extra, and the write respects
 * backpressure so a fast link cannot balloon memory.
 */
async function downloadOne(entry, dir, onProgress, signal) {
  const spec = modelFiles[entry.file];
  const target = path.join(dir, entry.file);
  const partial = `${target}.part`;
  let offset = fileSize(partial);
  if (offset > spec.bytes) {
    fs.rmSync(partial, { force: true });
    offset = 0;
  }
  let hash = crypto.createHash("sha256");
  if (offset) {
    entry.phase = "resuming";
    await hashExisting(partial, hash, signal);
  }
  entry.phase = "downloading";
  let received = offset;
  onProgress(received);
  if (offset < spec.bytes) {
    const response = await fetch(downloadUrl(entry.file), { redirect: "follow", signal, headers: offset ? { range: `bytes=${offset}-` } : {} });
    if (offset && response.status === 200) {
      // The server ignored the range: start this file over.
      offset = 0;
      received = 0;
      hash = crypto.createHash("sha256");
    }
    if (!response.ok || !response.body) {
      throw new Error(`Hugging Face answered ${response.status} for ${entry.file}. Place it in ${dir} by hand, or try again.`);
    }
    await pipeline(
      Readable.fromWeb(response.body),
      new Transform({
        transform(chunk, _encoding, done) {
          hash.update(chunk);
          received += chunk.length;
          onProgress(received);
          done(null, chunk);
        }
      }),
      fs.createWriteStream(partial, { flags: offset ? "a" : "w" }),
      { signal }
    );
  }
  entry.phase = "verifying";
  const digest = hash.digest("hex");
  if (received !== spec.bytes || digest !== spec.sha256) {
    fs.rmSync(partial, { force: true });
    throw new VerifyError(`${entry.file} did not match its published checksum, so it was thrown away.`);
  }
  fs.renameSync(partial, target);
  rememberValidated(dir, entry.file, spec);
  entry.phase = "verified";
}

/**
 * The SeedVR2 node re-hashes a registry model on first use unless its cache
 * already vouches for it. We just verified the same hash, so record it the way
 * the node does and spare the first upscale a multi-gigabyte re-read.
 */
function rememberValidated(dir, file, spec) {
  if (!nodeRegistryNames.has(file)) return;
  const cachePath = path.join(dir, ".validation_cache.json");
  try {
    let cache = {};
    try { cache = JSON.parse(fs.readFileSync(cachePath, "utf8")) || {}; } catch { cache = {}; }
    const stat = fs.statSync(path.join(dir, file));
    cache[file] = { size: stat.size, mtime: stat.mtimeMs / 1000, hash: spec.sha256 };
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  } catch {
    // Only a speed-up; the node validates on its own without it.
  }
}

/** Retries network hiccups with backoff; a checksum miss gets one clean retry from zero. */
async function downloadWithRetry(entry, dir, onProgress, signal) {
  let verifyRetries = 1;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await downloadOne(entry, dir, onProgress, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof VerifyError) {
        if (verifyRetries-- <= 0) throw error;
        continue;
      }
      if (attempt >= 3) throw error;
      entry.phase = "retrying";
      await sleep(1500 * (attempt + 1));
    }
  }
}

export function downloadPlan(quality, info) {
  const dir = seedvr2ModelDir();
  const files = requiredModelsFor(quality, info, dir)
    .filter((model) => !model.present)
    .map(({ key, file, label, detail, bytes, partialBytes }) => ({ key, file, label, detail, bytes, partialBytes }));
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const remainingBytes = files.reduce((sum, file) => sum + file.bytes - file.partialBytes, 0);
  return { quality: normalizeQuality(quality), modelDir: dir, files, totalBytes, remainingBytes, freeBytes: freeBytesAt(dir) };
}

export function startModelInstall(quality, info) {
  if (install?.status === "running") return installSnapshot();
  const plan = downloadPlan(quality, info);
  const dir = plan.modelDir;
  if (!dir) throw new Error("Set the ComfyUI output folder (or HEISS_SEEDVR2_MODEL_DIR) so HEISS UI knows where to install SeedVR2 models.");
  if (!plan.files.length) {
    install = { status: "done", quality: plan.quality, files: [], receivedBytes: 0, totalBytes: 0, startedAt: Date.now(), finishedAt: Date.now() };
    return installSnapshot();
  }
  // Leave room to breathe: a disk filled to the last byte takes ComfyUI down with it.
  const headroom = 512 * 1024 * 1024;
  if (plan.freeBytes !== null && plan.freeBytes < plan.remainingBytes + headroom) {
    const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    throw new Error(`Not enough disk space: the models need ${gb(plan.remainingBytes)} but only ${gb(plan.freeBytes)} is free on that drive.`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const controller = new AbortController();
  install = {
    status: "running",
    dir,
    quality: plan.quality,
    current: plan.files[0].file,
    files: plan.files.map((file) => ({ file: file.file, label: file.label, detail: file.detail, bytes: file.partialBytes, totalBytes: file.bytes, phase: "queued", done: false })),
    receivedBytes: plan.totalBytes - plan.remainingBytes,
    totalBytes: plan.totalBytes,
    bytesPerSecond: 0,
    startedAt: Date.now(),
    error: "",
    controller
  };
  const state = install;
  let sampleAt = Date.now();
  let sampleBytes = state.receivedBytes;
  (async () => {
    try {
      for (const entry of state.files) {
        state.current = entry.file;
        await downloadWithRetry(entry, dir, (received) => {
          entry.bytes = received;
          state.receivedBytes = state.files.reduce((sum, item) => sum + item.bytes, 0);
          const now = Date.now();
          if (now - sampleAt >= 500) {
            const rate = Math.max(0, (state.receivedBytes - sampleBytes) / ((now - sampleAt) / 1000));
            state.bytesPerSecond = state.bytesPerSecond ? state.bytesPerSecond * 0.7 + rate * 0.3 : rate;
            sampleAt = now;
            sampleBytes = state.receivedBytes;
          }
        }, controller.signal);
        entry.done = true;
        entry.bytes = entry.totalBytes;
      }
      if (install === state) install = { ...installSnapshot(), status: "done", current: "", bytesPerSecond: 0, finishedAt: Date.now() };
    } catch (error) {
      const canceled = controller.signal.aborted;
      if (install === state) {
        install = {
          ...installSnapshot(),
          status: canceled ? "canceled" : "error",
          bytesPerSecond: 0,
          error: canceled ? "" : error.message || "Model download failed.",
          finishedAt: Date.now()
        };
      }
    }
  })();
  return installSnapshot();
}

export function cancelModelInstall() {
  install?.controller?.abort();
  return installSnapshot();
}

/* ------------------------------------------------------------------- sizing */

function roundTo(value, step = 16) {
  return Math.max(step, Math.round(value / step) * step);
}

/**
 * Works from whatever the source happens to be: the short side sets the target,
 * the pre-scale keeps the model input inside a sane VRAM budget, and the output
 * is capped so a very large source cannot queue an impossible job.
 */
export function upscalePlan({ width, height, quality = "balanced" }) {
  const normalized = normalizeQuality(quality);
  const preset = presets[normalized];
  const sourceWidth = Math.max(1, Math.round(Number(width) || 0));
  const sourceHeight = Math.max(1, Math.round(Number(height) || 0));
  const shortSide = Math.min(sourceWidth, sourceHeight);
  const longSide = Math.max(sourceWidth, sourceHeight);
  const aspect = longSide / shortSide;
  const target = Math.min(roundTo(shortSide * preset.targetScale), preset.maxShort);
  const resolution = Math.max(target, roundTo(shortSide));
  // Never hand the model an input so small that it has nothing to restore.
  const preScale = Math.min(1, Math.max(preset.preScale, 256 / shortSide));
  return {
    quality: normalized,
    preScale: Number(preScale.toFixed(3)),
    resolution,
    maxResolution: resolution,
    blocksToSwap: preset.blocksToSwap,
    tileSize: preset.tileSize,
    sourceWidth,
    sourceHeight,
    estimatedWidth: sourceWidth >= sourceHeight ? Math.round(resolution * aspect) : resolution,
    estimatedHeight: sourceWidth >= sourceHeight ? resolution : Math.round(resolution * aspect),
    scale: Number((resolution / shortSide).toFixed(2))
  };
}

/* -------------------------------------------------------------------- graph */

function faceDetailStack(graph, body, imageSource, info) {
  const settings = body.sourceSettings || {};
  const model = String(body.sourceModel || "");
  const textEncoder = String(settings.textEncoder || "");
  const vae = String(settings.vae || "");
  if (!model || !textEncoder || !vae) {
    throw new Error("Face detail needs the original model, text encoder, and VAE, which this image did not record.");
  }
  const detector = optionsFor(info, "UltralyticsDetectorProvider", "model_name").find((name) => /face/i.test(String(name)));
  if (!detector) throw new Error("No Ultralytics face detector model is installed for the Impact Pack.");
  const sam = optionsFor(info, "SAMLoader", "model_name").map(String).find((name) => name && name !== "None");
  graph["10"] = { class_type: "UNETLoader", inputs: { unet_name: model, weight_dtype: String(settings.weightDtype || "default") } };
  graph["11"] = { class_type: "CLIPLoader", inputs: { clip_name: textEncoder, type: String(settings.clipType || "wan"), device: "default" } };
  graph["12"] = { class_type: "VAELoader", inputs: { vae_name: vae } };
  graph["13"] = { class_type: "CLIPTextEncode", inputs: { text: String(body.prompt || ""), clip: ["11", 0] } };
  graph["14"] = { class_type: "ConditioningZeroOut", inputs: { conditioning: ["13", 0] } };
  graph["15"] = { class_type: "UltralyticsDetectorProvider", inputs: { model_name: detector } };
  if (sam) graph["16"] = { class_type: "SAMLoader", inputs: { model_name: sam, device_mode: "AUTO" } };
  graph["17"] = {
    class_type: "FaceDetailer",
    inputs: {
      image: imageSource,
      model: ["10", 0],
      clip: ["11", 0],
      vae: ["12", 0],
      positive: ["13", 0],
      negative: ["14", 0],
      bbox_detector: ["15", 0],
      ...(sam ? { sam_model_opt: ["16", 0] } : {}),
      guide_size: 1024,
      guide_size_for: true,
      max_size: 1024,
      seed: Number(body.seed || crypto.randomInt(1, 2 ** 31)),
      steps: Number(settings.steps || 4),
      cfg: Number(settings.cfg || 1),
      sampler_name: String(settings.sampler || "er_sde"),
      scheduler: String(settings.scheduler || "simple"),
      denoise: 0.2,
      feather: 5,
      noise_mask: true,
      force_inpaint: true,
      bbox_threshold: 0.5,
      bbox_dilation: 10,
      bbox_crop_factor: 3,
      sam_detection_hint: "center-1",
      sam_dilation: 0,
      sam_threshold: 0.93,
      sam_bbox_expansion: 0,
      sam_mask_hint_threshold: 0.7,
      sam_mask_hint_use_negative: "False",
      drop_size: 10,
      wildcard: "",
      cycle: 1,
      inpaint_model: false,
      noise_mask_feather: 20
    }
  };
  return ["17", 0];
}

/**
 * The loaders list the devices this machine actually has (cuda:N, mps) and
 * whether a separate offload device exists. Block swapping needs one, and on
 * Apple silicon there is none, so it switches off there instead of failing.
 */
function devicesFor(info, nodeClass) {
  const devices = optionsFor(info, nodeClass, "device").map(String);
  const offloads = optionsFor(info, nodeClass, "offload_device").map(String);
  const device = devices.find((name) => name !== "none" && name !== "cpu") || devices[0] || "cuda:0";
  const offload = offloads.length ? (offloads.includes("cpu") && device !== "cpu" ? "cpu" : "none") : "cpu";
  return { device, offload };
}

export function upscaleGraph(body, info = {}) {
  const plan = upscalePlan(body);
  const have = available(info, seedvr2ModelDir());
  const dit = resolveDit(plan.quality, have);
  const vae = resolveVae(have);
  if (dit.missing || vae.missing) throw new Error("SeedVR2 models are not installed yet.");
  const ditDevices = devicesFor(info, "SeedVR2LoadDiTModel");
  const vaeDevices = devicesFor(info, "SeedVR2LoadVAEModel");
  const swap = ditDevices.offload !== "none";
  const graph = {
    "1": { class_type: "LoadImage", inputs: { image: String(body.imageName || "") } },
    "2": { class_type: "ImageScaleBy", inputs: { image: ["1", 0], upscale_method: "bicubic", scale_by: plan.preScale } },
    "3": {
      class_type: "SeedVR2LoadDiTModel",
      inputs: {
        model: dit.file,
        device: ditDevices.device,
        blocks_to_swap: swap ? plan.blocksToSwap : 0,
        swap_io_components: swap,
        offload_device: ditDevices.offload,
        cache_model: false,
        attention_mode: "sdpa"
      }
    },
    "4": {
      class_type: "SeedVR2LoadVAEModel",
      inputs: {
        model: vae.file,
        device: vaeDevices.device,
        encode_tiled: true,
        encode_tile_size: plan.tileSize,
        encode_tile_overlap: 128,
        decode_tiled: true,
        decode_tile_size: plan.tileSize,
        decode_tile_overlap: 128,
        tile_debug: "false",
        offload_device: vaeDevices.offload,
        cache_model: false
      }
    },
    "5": {
      class_type: "SeedVR2VideoUpscaler",
      inputs: {
        image: ["2", 0],
        dit: ["3", 0],
        vae: ["4", 0],
        seed: Number(body.seed || crypto.randomInt(1, 2 ** 31)),
        resolution: plan.resolution,
        max_resolution: plan.maxResolution,
        batch_size: 1,
        uniform_batch_size: false,
        color_correction: "lab",
        temporal_overlap: 0,
        prepend_frames: 0,
        input_noise_scale: 0,
        latent_noise_scale: 0,
        offload_device: devicesFor(info, "SeedVR2VideoUpscaler").offload,
        enable_debug: false
      }
    }
  };
  let output = ["5", 0];
  if (body.faceDetail) output = faceDetailStack(graph, body, output, info);
  graph["9"] = { class_type: "SaveImage", inputs: { images: output, filename_prefix: "heiss-ui/upscale" } };
  return { graph, plan };
}

export async function uploadUpscaleSource({ buffer, mime = "image/png", name = "upscale-source.png" }) {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  const extension = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  const filename = `heiss-ui-upscale-${hash}.${extension}`;
  const form = new FormData();
  form.append("image", new Blob([buffer], { type: mime }), filename);
  form.append("type", "input");
  form.append("overwrite", "false");
  const uploaded = await comfy("/upload/image", { method: "POST", body: form });
  return uploaded.name || filename || name;
}

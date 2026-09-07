import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { comfy, comfyOutputDir, optionsFor } from "./comfy.js";

// SeedVR2 restores detail rather than interpolating it, so the pipeline mirrors
// the reference workflow: soften the source with a lanczos pre-scale, then let
// the model rebuild the short side at the requested resolution.
export const upscaleQualities = ["fast", "balanced", "high"];

const ditModels = {
  fast: { file: "seedvr2_ema_3b_fp8_e4m3fn.safetensors", approxBytes: 3_600_000_000, label: "SeedVR2 3B (fp8)" },
  balanced: { file: "seedvr2_ema_7b_fp8_e4m3fn.safetensors", approxBytes: 7_800_000_000, label: "SeedVR2 7B (fp8)" },
  high: { file: "seedvr2_ema_7b_fp16.safetensors", approxBytes: 15_300_000_000, label: "SeedVR2 7B (fp16)" }
};

const vaeModel = { file: "ema_vae_fp16.safetensors", approxBytes: 500_000_000, label: "SeedVR2 VAE" };

const presets = {
  fast: { dit: "fast", preScale: 1, targetScale: 1.5, maxShort: 1280, blocksToSwap: 16, tileSize: 768 },
  balanced: { dit: "balanced", preScale: 0.7, targetScale: 2, maxShort: 2048, blocksToSwap: 32, tileSize: 1024 },
  high: { dit: "high", preScale: 0.7, targetScale: 3, maxShort: 2816, blocksToSwap: 36, tileSize: 1024 }
};

export const upscaleNodeClasses = ["SeedVR2LoadDiTModel", "SeedVR2LoadVAEModel", "SeedVR2VideoUpscaler"];
export const faceDetailNodeClasses = ["FaceDetailer", "UltralyticsDetectorProvider", "SAMLoader"];

const hfRepo = process.env.JAI_SEEDVR2_HF_REPO || "numz/SeedVR2_comfyUI";

export function normalizeQuality(value = "") {
  const quality = String(value || "").toLowerCase();
  return upscaleQualities.includes(quality) ? quality : "balanced";
}

function downloadUrl(file) {
  return `https://huggingface.co/${hfRepo}/resolve/main/${encodeURIComponent(file)}?download=true`;
}

/**
 * SeedVR2 keeps its weights in ComfyUI/models/SEEDVR2. The output folder is the
 * only Comfy path J AI already knows, so derive the sibling models folder from
 * it unless an explicit override is set.
 */
export function seedvr2ModelDir() {
  const override = String(process.env.JAI_SEEDVR2_MODEL_DIR || "").trim();
  if (override) return path.resolve(override);
  const comfyRoot = String(process.env.JAI_COMFY_ROOT || "").trim();
  if (comfyRoot) return path.join(path.resolve(comfyRoot), "models", "SEEDVR2");
  if (!comfyOutputDir) return "";
  return path.join(path.dirname(path.resolve(comfyOutputDir)), "models", "SEEDVR2");
}

function fileOnDisk(file) {
  const dir = seedvr2ModelDir();
  if (!dir) return "";
  const resolved = path.join(dir, file);
  try {
    return fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : "";
  } catch {
    return "";
  }
}

function installedDitOptions(info) {
  return optionsFor(info, "SeedVR2LoadDiTModel", "model").map(String);
}

function installedVaeOptions(info) {
  return optionsFor(info, "SeedVR2LoadVAEModel", "model").map(String);
}

function modelPresent(file, options) {
  return options.some((option) => path.basename(option) === file) || Boolean(fileOnDisk(file));
}

/**
 * Any DiT weight the user already has beats a multi-gigabyte download, so a tier
 * whose preferred file is missing falls back to whatever SeedVR2 already lists.
 */
function resolveDitFile(quality, info) {
  const preferred = ditModels[presets[quality].dit].file;
  const options = installedDitOptions(info);
  if (modelPresent(preferred, options)) {
    return { file: options.find((option) => path.basename(option) === preferred) || preferred, downloaded: false };
  }
  const fallback = options.find((option) => /seedvr2/i.test(option));
  return fallback ? { file: fallback, substituted: true } : { file: preferred, missing: true };
}

function resolveVaeFile(info) {
  const options = installedVaeOptions(info);
  if (modelPresent(vaeModel.file, options)) {
    return { file: options.find((option) => path.basename(option) === vaeModel.file) || vaeModel.file };
  }
  const fallback = options[0];
  return fallback ? { file: fallback, substituted: true } : { file: vaeModel.file, missing: true };
}

export function requiredModelsFor(quality, info) {
  const dit = ditModels[presets[normalizeQuality(quality)].dit];
  return [
    { key: "dit", ...dit, present: modelPresent(dit.file, installedDitOptions(info)) },
    { key: "vae", ...vaeModel, present: modelPresent(vaeModel.file, installedVaeOptions(info)) }
  ];
}

function missingNodeClasses(info, classes) {
  return classes.filter((className) => !info?.[className]);
}

export function upscaleStatus(info = {}, quality = "balanced") {
  const normalized = normalizeQuality(quality);
  const missingNodes = missingNodeClasses(info, upscaleNodeClasses);
  const models = requiredModelsFor(normalized, info);
  const missingModels = models.filter((model) => !model.present);
  const modelDir = seedvr2ModelDir();
  // A tier can still run on a weight the user already has, so only demand a
  // download when SeedVR2 offers nothing at all.
  const hasAnyDit = installedDitOptions(info).some((option) => /seedvr2/i.test(option));
  const hasAnyVae = installedVaeOptions(info).length > 0;
  const canSubstitute = hasAnyDit && hasAnyVae;
  return {
    quality: normalized,
    nodesInstalled: missingNodes.length === 0,
    missingNodes,
    modelDir,
    canDownload: Boolean(modelDir),
    models: models.map(({ key, file, label, approxBytes, present }) => ({ key, file, label, approxBytes, present })),
    missingModels: missingModels.map((model) => model.key),
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
  return rest;
}

export async function probeDownloadSizes(quality, info) {
  const missing = requiredModelsFor(quality, info).filter((model) => !model.present);
  const files = [];
  for (const model of missing) {
    let bytes = model.approxBytes;
    let exact = false;
    try {
      const response = await fetch(downloadUrl(model.file), { method: "HEAD", redirect: "follow" });
      const length = Number(response.headers.get("content-length") || 0);
      if (response.ok && length > 0) {
        bytes = length;
        exact = true;
      }
    } catch {
      // Fall back to the published approximate size when the CDN is unreachable.
    }
    files.push({ key: model.key, file: model.file, label: model.label, bytes, exact });
  }
  return { files, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0) };
}

async function downloadOne(file, dir, onProgress, signal) {
  const target = path.join(dir, file);
  const partial = `${target}.part`;
  const response = await fetch(downloadUrl(file), { redirect: "follow", signal });
  if (!response.ok || !response.body) {
    throw new Error(`Could not download ${file} from Hugging Face (${response.status}). Place it in ${dir} manually and try again.`);
  }
  const total = Number(response.headers.get("content-length") || 0);
  let received = 0;
  const out = fs.createWriteStream(partial);
  try {
    for await (const chunk of Readable.fromWeb(response.body)) {
      out.write(chunk);
      received += chunk.length;
      onProgress(received, total);
    }
  } finally {
    await new Promise((resolve) => out.end(resolve));
  }
  fs.renameSync(partial, target);
  return received;
}

export function startModelInstall(quality, info) {
  if (install?.status === "running") return installSnapshot();
  const dir = seedvr2ModelDir();
  if (!dir) throw new Error("Set the ComfyUI output folder (or JAI_SEEDVR2_MODEL_DIR) so J AI knows where to install SeedVR2 models.");
  const missing = requiredModelsFor(quality, info).filter((model) => !model.present);
  if (!missing.length) {
    install = { status: "done", files: [], receivedBytes: 0, totalBytes: 0, startedAt: Date.now(), finishedAt: Date.now() };
    return installSnapshot();
  }
  fs.mkdirSync(dir, { recursive: true });
  const controller = new AbortController();
  install = {
    status: "running",
    dir,
    quality: normalizeQuality(quality),
    current: missing[0].file,
    files: missing.map((model) => ({ file: model.file, label: model.label, bytes: 0, totalBytes: model.approxBytes, done: false })),
    receivedBytes: 0,
    totalBytes: missing.reduce((sum, model) => sum + model.approxBytes, 0),
    startedAt: Date.now(),
    error: "",
    controller
  };
  (async () => {
    try {
      for (const entry of install.files) {
        install.current = entry.file;
        await downloadOne(entry.file, dir, (received, total) => {
          entry.bytes = received;
          if (total) entry.totalBytes = total;
          install.receivedBytes = install.files.reduce((sum, item) => sum + item.bytes, 0);
          install.totalBytes = install.files.reduce((sum, item) => sum + item.totalBytes, 0);
        }, controller.signal);
        entry.done = true;
        entry.bytes = entry.totalBytes;
      }
      install = { ...installSnapshot(), status: "done", current: "", finishedAt: Date.now(), restartHint: true };
    } catch (error) {
      const canceled = controller.signal.aborted;
      install = {
        ...installSnapshot(),
        status: canceled ? "canceled" : "error",
        error: canceled ? "" : error.message || "Model download failed.",
        finishedAt: Date.now()
      };
    }
  })();
  return installSnapshot();
}

export function cancelModelInstall() {
  install?.controller?.abort();
  return installSnapshot();
}

export function installState() {
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
    ditKey: preset.dit,
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

export function upscaleGraph(body, info = {}) {
  const plan = upscalePlan(body);
  const dit = resolveDitFile(plan.quality, info);
  const vae = resolveVaeFile(info);
  if (dit.missing || vae.missing) throw new Error("SeedVR2 models are not installed yet.");
  const graph = {
    "1": { class_type: "LoadImage", inputs: { image: String(body.imageName || "") } },
    "2": { class_type: "ImageScaleBy", inputs: { image: ["1", 0], upscale_method: "bicubic", scale_by: plan.preScale } },
    "3": {
      class_type: "SeedVR2LoadDiTModel",
      inputs: {
        model: dit.file,
        device: "cuda:0",
        blocks_to_swap: plan.blocksToSwap,
        swap_io_components: true,
        offload_device: "cpu",
        cache_model: false,
        attention_mode: "sdpa"
      }
    },
    "4": {
      class_type: "SeedVR2LoadVAEModel",
      inputs: {
        model: vae.file,
        device: "cuda:0",
        encode_tiled: true,
        encode_tile_size: plan.tileSize,
        encode_tile_overlap: 128,
        decode_tiled: true,
        decode_tile_size: plan.tileSize,
        decode_tile_overlap: 128,
        tile_debug: "false",
        offload_device: "cpu",
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
        offload_device: "cpu",
        enable_debug: false
      }
    }
  };
  let output = ["5", 0];
  if (body.faceDetail) output = faceDetailStack(graph, body, output, info);
  graph["9"] = { class_type: "SaveImage", inputs: { images: output, filename_prefix: "j-ai-studio/upscale" } };
  return { graph, plan };
}

export async function uploadUpscaleSource({ buffer, mime = "image/png", name = "upscale-source.png" }) {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  const extension = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  const filename = `j-ai-studio-upscale-${hash}.${extension}`;
  const form = new FormData();
  form.append("image", new Blob([buffer], { type: mime }), filename);
  form.append("type", "input");
  form.append("overwrite", "false");
  const uploaded = await comfy("/upload/image", { method: "POST", body: form });
  return uploaded.name || filename || name;
}

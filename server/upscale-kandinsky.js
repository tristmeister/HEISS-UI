import path from "node:path";
import { comfyModelsDir, optionsFor } from "./comfy.js";
import { nodePacks } from "./node-packs.js";

/**
 * Kandinsky ImageSR 2.0 as Smart upscale's second engine: a one-step,
 * prompt-free super-resolution model at a fixed 2× or 4×. Where SeedVR2
 * rebuilds the short side at a chosen resolution, Kandinsky multiplies the
 * picture by its factor, so its efforts are the factors themselves.
 *
 * Its weights are not downloaded here: the native pack converts them into its
 * own checkpoints (int8 ConvRot, W4A8, bf16), so the status reports what
 * ComfyUI already lists in diffusion_models and vae, and says where a missing
 * one goes.
 */
export const kandinskyQualities = ["x2", "x4"];
export const kandinskyNodeClasses = nodePacks.kandinskysr2.nodes;

export function isKandinsky(quality = "") {
  return kandinskyQualities.includes(String(quality));
}

// The pack's own order: int8 ConvRot is its recommended default, W4A8 fits 4 GB cards, bf16 and raw last.
const ditOrder = [/int8[-_]?convrot/i, /w4a8/i, /bf16/i, /./];
// The FLUX.1 VAE (16 channels). The FLUX.2 VAE and other families' VAEs do not fit this model.
const vaeOrder = [/^ae-bf16\.safetensors$/i, /^ae\.safetensors$/i, /^flux1?[-_.](dev[-_.]|schnell[-_.])?(ae|vae)\b.*\.safetensors$/i];
const defaultDit = "kandinsky-imagesr-2.0-int8-convrot.safetensors";
const defaultVae = "ae.safetensors";

// The long side Kandinsky may write. A large source is scaled down first so ×4 stays a job ComfyUI can finish.
export const kandinskyMaxLong = 8192;

function pick(names, order) {
  for (const pattern of order) {
    const found = names.find((name) => pattern.test(path.basename(name)));
    if (found) return found;
  }
  return "";
}

/** The weights ComfyUI can load for Kandinsky right now, best first, by the names its loaders expect. */
export function kandinskyModels(info = {}) {
  const dits = optionsFor(info, "KandinskyImageSR2Loader", "model_name").map(String)
    .filter((name) => /kandinsky.*(image)?sr|imagesr/i.test(path.basename(name)));
  const vaes = optionsFor(info, "VAELoader", "vae_name").map(String)
    .filter((name) => vaeOrder.some((pattern) => pattern.test(path.basename(name))));
  return { dit: pick(dits, ditOrder), vae: pick(vaes, vaeOrder) };
}

/** The same shape as SeedVR2's status, so setup, Settings and the tiles read it the same way. */
export function kandinskyStatus(info = {}, quality = "x2") {
  const missingNodes = kandinskyNodeClasses.filter((className) => !info?.[className]);
  const have = kandinskyModels(info);
  const models = [
    { key: "dit", file: have.dit || defaultDit, label: "Kandinsky ImageSR 2.0", detail: "models/diffusion_models", bytes: 0, present: Boolean(have.dit), partialBytes: 0 },
    { key: "vae", file: have.vae || defaultVae, label: "FLUX.1 VAE", detail: "models/vae", bytes: 0, present: Boolean(have.vae), partialBytes: 0 }
  ];
  const missingModels = models.filter((model) => !model.present).map((model) => model.key);
  return {
    engine: "kandinsky",
    quality: isKandinsky(quality) ? quality : "x2",
    nodesInstalled: missingNodes.length === 0,
    missingNodes,
    detectedNodes: Object.keys(info || {}).filter((name) => /kandinsky/i.test(name)).sort(),
    modelDir: comfyModelsDir() || "",
    remote: false,
    canDownload: false,
    manualModels: true,
    freeBytes: null,
    models,
    missingModels,
    downloadBytes: 0,
    needsDownload: false,
    substituting: false,
    fallbackFile: "",
    ready: missingNodes.length === 0 && missingModels.length === 0
  };
}

function roundTo(value, step = 16) {
  return Math.max(step, Math.round(value / step) * step);
}

/**
 * The factor sets the size: the output is exactly factor × the input. A
 * `target` (an older 2K/4K size pick) or the size cap scales the source down
 * first, never the result, since the model restores best from a smaller input.
 */
export function kandinskyPlan({ width, height, quality = "x2", target = 0 }, targets = []) {
  const normalized = isKandinsky(quality) ? quality : "x2";
  const factor = normalized === "x4" ? 4 : 2;
  const sourceWidth = Math.max(1, Math.round(Number(width) || 0));
  const sourceHeight = Math.max(1, Math.round(Number(height) || 0));
  const longSide = Math.max(sourceWidth, sourceHeight);
  const goal = Math.min(targets.includes(Number(target)) ? Number(target) : longSide * factor, kandinskyMaxLong);
  // Never shrink the input below what the model can still read detail from, but the size cap
  // comes last: a very long panorama gives up its short side before it passes the cap.
  const floor = 128 / Math.min(sourceWidth, sourceHeight);
  const cap = kandinskyMaxLong / (longSide * factor);
  const preScale = Math.min(1, cap, Math.max(goal / (longSide * factor), floor));
  const inputWidth = Math.round(sourceWidth * preScale);
  const inputHeight = Math.round(sourceHeight * preScale);
  const estimatedWidth = inputWidth * factor;
  const estimatedHeight = inputHeight * factor;
  const resolution = roundTo(Math.min(estimatedWidth, estimatedHeight));
  return {
    engine: "kandinsky",
    quality: normalized,
    factor,
    preScale: Number(preScale.toFixed(4)),
    resolution,
    maxResolution: resolution,
    sourceWidth,
    sourceHeight,
    estimatedWidth,
    estimatedHeight,
    scale: Number((Math.min(estimatedWidth, estimatedHeight) / Math.min(sourceWidth, sourceHeight)).toFixed(2))
  };
}

/**
 * LoadImage "1" and SaveImage "9", like the SeedVR2 graph, so the gallery
 * arrow and the run-embedded upscale (embedUpscale) use it unchanged.
 * `source` is the picture to upscale (the face pass's output when it runs).
 */
export function kandinskyGraph(body, info, graph, source, targets = []) {
  const plan = kandinskyPlan(body, targets);
  const have = kandinskyModels(info);
  if (!have.dit || !have.vae) throw new Error("The Kandinsky ImageSR 2.0 model or the FLUX.1 VAE isn’t in ComfyUI’s model folders yet.");
  let input = source;
  if (plan.preScale < 1) {
    graph["2"] = { class_type: "ImageScaleBy", inputs: { image: source, upscale_method: "lanczos", scale_by: plan.preScale } };
    input = ["2", 0];
  }
  graph["3"] = { class_type: "KandinskyImageSR2Loader", inputs: { model_name: have.dit, compute_dtype: "bfloat16", fast_gelu_fusion: false } };
  graph["4"] = { class_type: "VAELoader", inputs: { vae_name: have.vae } };
  graph["5"] = {
    class_type: "KandinskyImageSR2Upscale",
    inputs: {
      model: ["3", 0],
      vae: ["4", 0],
      image: input,
      upscale_factor: String(plan.factor),
      creativity: 4,
      overlap: 0.25,
      tile_batch_size: 1,
      one_step_t_override: 0,
      vae_decode_mode: "fast_latent_blend"
    }
  };
  graph["9"] = { class_type: "SaveImage", inputs: { images: ["5", 0], filename_prefix: "heiss-ui/upscale" } };
  return { graph, plan: { ...plan, model: have.dit } };
}

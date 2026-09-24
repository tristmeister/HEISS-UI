import crypto from "node:crypto";
import { families, sanaConf } from './family-catalog.js';
import { krea2RawShift } from './model-families.js';

/**
 * One graph builder for every family in family-catalog.js. The request arrives
 * validated (validation.js resolved the family, variant, which parts the
 * checkpoint carries and which encoder/VAE files fill the rest), so this only
 * wires nodes: load, patch, apply LoRAs, encode, sample, decode, save.
 */

const clipLoaders = [null, "CLIPLoader", "DualCLIPLoader", "TripleCLIPLoader", "QuadrupleCLIPLoader"];

function builder() {
  const graph = {};
  let next = 1;
  const add = (class_type, inputs) => {
    const id = String(next++);
    graph[id] = { class_type, inputs };
    return id;
  };
  return { graph, add };
}

function enabledLoras(body, limit = 8) {
  return Array.isArray(body.loras)
    ? body.loras.filter((item) => item?.enabled !== false && item?.name).slice(0, limit)
    : [];
}

/** Chains ComfyUI's own LoraLoader: the same strength on model and text encoder. */
function chainLoras(add, body, model, clip) {
  let currentModel = model;
  let currentClip = clip;
  for (const lora of enabledLoras(body)) {
    const strength = Number(lora.strength ?? 0.7);
    const id = add("LoraLoader", { model: currentModel, clip: currentClip, lora_name: lora.name, strength_model: strength, strength_clip: strength });
    currentModel = [id, 0];
    currentClip = [id, 1];
  }
  return { model: currentModel, clip: currentClip };
}

function modelSamplingPatch(add, spec, model, body) {
  if (!spec) return model;
  if (spec.node === "ModelSamplingFlux") {
    const width = Number(body.width || 1024);
    const height = Number(body.height || 1024);
    return [add("ModelSamplingFlux", { model, max_shift: spec.shift, base_shift: spec.shift, width, height }), 0];
  }
  return [add(spec.node, { model, shift: spec.shift }), 0];
}

export function familyGraph(body) {
  const family = families[body.family];
  if (!family) throw new Error("This model type is not supported.");
  const variant = family.variants.find((item) => item.id === body.variant) || family.variants.at(-1);
  const { graph, add } = builder();
  const seed = Number(body.seed || crypto.randomInt(1, 2 ** 31));
  const width = Number(body.width || family.size[0]);
  const height = Number(body.height || family.size[1]);
  const count = Math.max(1, Math.min(8, Number(body.count || 1)));
  const frames = Number(body.frames || family.frames || 33);
  const bundled = body.source === "checkpoint" ? (body.bundled || { encoder: true, vae: true }) : { encoder: false, vae: false };
  if (family.sampling === "sana") return sanaGraph({ add, graph, body, variant, seed, width, height, count });

  // ---- Load
  let model;
  let clip = null;
  let vae = null;
  if (body.source === "checkpoint") {
    const id = add("CheckpointLoaderSimple", { ckpt_name: body.model });
    model = [id, 0];
    if (bundled.encoder && !family.neverBundledEncoder) clip = [id, 1];
    if (bundled.vae && !body.vae) vae = [id, 2];
  } else {
    model = [add("UNETLoader", { unet_name: body.model, weight_dtype: body.weightDtype || "default" }), 0];
  }
  if (!clip) {
    const files = (body.encoders || []).slice(0, family.slots.length);
    const loader = clipLoaders[files.length];
    if (!loader || files.some((file) => !file)) throw new Error("Choose a text encoder for every slot this model needs.");
    const inputs = files.length === 1 ? { clip_name: files[0] } : Object.fromEntries(files.map((file, index) => [`clip_name${index + 1}`, file]));
    if (family.clipType && files.length <= 2) inputs.type = family.clipType;
    if (files.length <= 2) inputs.device = "default";
    clip = [add(loader, inputs), 0];
  }
  if (!vae) {
    if (!body.vae) throw new Error("Choose a VAE for this model.");
    vae = [add("VAELoader", { vae_name: body.vae }), 0];
  }

  // ---- Patches before LoRAs
  const clipSkip = typeof family.clipSkip === "function" ? family.clipSkip(String(body.model || "").split(/[\\/]/).pop()) : 0;
  if (clipSkip) clip = [add("CLIPSetLastLayer", { clip, stop_at_clip_layer: clipSkip }), 0];
  if (family.t5Padding) clip = [add("T5TokenizerOptions", { clip, min_padding: 0, min_length: 0 }), 0];
  if (family.enhancer && body.krea2Enhancer) {
    model = [add("ComfyUI-Krea2T-Enhancer", { model, enabled: true, strength: 1.5, debug: false }), 0];
  }

  // ---- LoRAs, then the sampling patches so they sit last
  // A pair's second file: Wan's low-noise half (LoRAs apply to both halves),
  // or Ideogram's unconditional model (it never sees the prompt, so no LoRAs).
  let lowModel = null;
  let partnerModel = null;
  if (family.pair) {
    if (!body.pairModel) throw new Error(`${family.label} needs its ${family.pair.label.toLowerCase()} too.`);
    partnerModel = [add("UNETLoader", { unet_name: body.pairModel, weight_dtype: body.weightDtype || "default" }), 0];
    if (family.sampling === "pair") lowModel = partnerModel;
  }
  ({ model, clip } = chainLoras(add, body, model, clip));
  if (lowModel) lowModel = chainLoras(add, body, lowModel, clip).model;

  const sampling = variant.modelSampling || family.modelSampling;
  model = modelSamplingPatch(add, sampling, model, body);
  if (lowModel) lowModel = modelSamplingPatch(add, sampling, lowModel, body);
  if (variant.vpred && body.vpredPatch) {
    model = [add("ModelSamplingDiscrete", { model, sampling: "v_prediction", zsnr: true }), 0];
  }
  // Krea 2 Raw's shift follows the image size (Turbo keeps ComfyUI's fixed 1.15).
  if (variant.rawShift) model = modelSamplingPatch(add, { node: "ModelSamplingFlux", shift: krea2RawShift(width, height) }, model, body);

  // ---- MiniMax H3: its own conditioning + latent node, guidance-free, video with audio
  if (family.sampling === "h3") {
    const h3 = add("MiniMaxH3ImageToVideo", { clip, vae, prompt: body.prompt || "", width, height, length: frames });
    const audioVae = [add("VAELoader", { vae_name: body.audioVae }), 0];
    const sampled = customSampler(add, {
      model, seed, steps: body.steps, sampler: body.sampler || "res_multistep",
      guider: add("BasicGuider", { model, conditioning: [h3, 0] }),
      sigmas: add("BasicScheduler", { model, scheduler: body.scheduler || "simple", steps: Number(body.steps || 20), denoise: 1 }),
      latent: [h3, 1]
    });
    const images = add("VAEDecode", { samples: sampled, vae });
    const audio = add("VAEDecodeAudio", { samples: sampled, vae: audioVae });
    const video = add("CreateVideo", { images: [images, 0], audio: [audio, 0], fps: Number(body.fps || family.fps || 24) });
    add("SaveVideo", { video: [video, 0], filename_prefix: "heiss-ui/video", format: "mp4", codec: "h264" });
    return graph;
  }

  // ---- Ideogram 4: the main model (CFG eased off for the last 30% of steps)
  // and the unconditional one, blended by a dual guider on its own schedule.
  if (family.sampling === "ideogram4") {
    const steps = Number(body.steps || 20);
    const preset = ideogram4Preset(steps);
    const conditioned = [add("CFGOverride", { model, cfg: 3, start_percent: 0.7, end_percent: 1 }), 0];
    const positive = [add("CLIPTextEncode", { text: body.prompt || "", clip }), 0];
    const negative = [add("ConditioningZeroOut", { conditioning: positive }), 0];
    const guider = add("DualModelGuider", { model: conditioned, model_negative: partnerModel, positive, negative, cfg: Number(body.cfg || 7) });
    const sigmas = add("Ideogram4Scheduler", { steps, width, height, mu: preset.mu, std: preset.std });
    const latent = [add("EmptyFlux2LatentImage", { width, height, batch_size: count }), 0];
    const samples = customSampler(add, { seed, sampler: body.sampler || "euler", guider, sigmas, latent });
    add("SaveImage", { images: [add("VAEDecode", { samples, vae }), 0], filename_prefix: "heiss-ui/image" });
    return graph;
  }

  // ---- MageFlow: one node encodes prompt and negative and makes the latent.
  if (family.sampling === "mage") {
    const encoded = add("TextEncodeMageFlowEdit", { clip, prompt: body.prompt || "", negative_prompt: body.negative || "", width, height, batch_size: count });
    const samples = [add("KSampler", {
      model, seed, steps: Number(body.steps || 30), cfg: Number(body.cfg || 1),
      sampler_name: body.sampler || "euler", scheduler: body.scheduler || "simple",
      positive: [encoded, 0], negative: [encoded, 1], latent_image: [encoded, 2], denoise: 1
    }), 0];
    add("SaveImage", { images: [add("VAEDecode", { samples, vae }), 0], filename_prefix: "heiss-ui/image" });
    return graph;
  }

  // ---- Conditioning
  const negativeMode = variant.negative || family.negative || "text";
  // Some models were trained with a system prompt in front of every caption.
  const promptText = `${variant.promptPrefix || ""}${body.prompt || ""}`;
  const negativeText = `${variant.negativePrefix || ""}${body.negative || ""}`;
  let positive;
  let negative = null;
  if (negativeMode === "qwen21") {
    const encoded = add("TextEncodeQwenImage21", { clip, prompt: body.prompt || "", negative_prompt: body.negative || "", vae, resolution: 1024 });
    positive = [encoded, 0];
    negative = [encoded, 1];
  } else {
    positive = [add("CLIPTextEncode", { text: promptText, clip }), 0];
    if (variant.guidance) positive = [add("FluxGuidance", { conditioning: positive, guidance: variant.guidance }), 0];
    if (negativeMode === "text") negative = [add("CLIPTextEncode", { text: negativeText, clip }), 0];
    else if (negativeMode === "zero") negative = [add("ConditioningZeroOut", { conditioning: positive }), 0];
  }

  // ---- Latent (optionally from a start image)
  let latent;
  let denoise = 1;
  const startImage = body.startImageComfy ? [add("LoadImage", { image: body.startImageComfy }), 0] : null;
  if (family.latent === "Wan22ImageToVideoLatent") {
    const inputs = { vae, width, height, length: frames, batch_size: 1 };
    if (startImage) inputs.start_image = startImage;
    latent = [add("Wan22ImageToVideoLatent", inputs), 0];
  } else if (family.kind === "video") {
    latent = [add(family.latent, { width, height, length: frames, batch_size: 1 }), 0];
  } else if (startImage && family.img2img) {
    latent = [add("VAEEncode", { pixels: startImage, vae }), 0];
    denoise = Number(body.denoise ?? 0.65);
  } else {
    latent = [add(family.latent, { width, height, batch_size: count }), 0];
  }

  // ---- Sample
  let samples;
  if (family.sampling === "custom") {
    const sigmas = family.scheduler === "flux2"
      ? add("Flux2Scheduler", { steps: Number(body.steps || 20), width, height })
      : add("BasicScheduler", { model, scheduler: body.scheduler || "simple", steps: Number(body.steps || 20), denoise: 1 });
    const guider = negative
      ? add("CFGGuider", { model, positive, negative, cfg: Number(body.cfg || 1) })
      : add("BasicGuider", { model, conditioning: positive });
    samples = customSampler(add, { model, seed, sampler: body.sampler || "euler", guider, sigmas, latent });
  } else if (family.sampling === "pair") {
    // High noise lays out the motion for the first half of the steps, low noise finishes.
    const steps = Number(body.steps || 20);
    const split = Math.max(1, Math.floor(steps / 2));
    const shared = { noise_seed: seed, steps, cfg: Number(body.cfg || 1), sampler_name: body.sampler || "euler", scheduler: body.scheduler || "simple", positive, negative };
    const high = add("KSamplerAdvanced", { ...shared, model, add_noise: "enable", latent_image: latent, start_at_step: 0, end_at_step: split, return_with_leftover_noise: "enable" });
    samples = [add("KSamplerAdvanced", { ...shared, model: lowModel, add_noise: "disable", latent_image: [high, 0], start_at_step: split, end_at_step: 10000, return_with_leftover_noise: "disable" }), 0];
  } else {
    samples = [add("KSampler", {
      model, seed, steps: Number(body.steps || 20), cfg: Number(body.cfg || 1),
      sampler_name: body.sampler || "euler", scheduler: body.scheduler || "simple",
      positive, negative: negative || positive, latent_image: latent, denoise
    }), 0];
  }

  // ---- Decode and save
  const images = [add("VAEDecode", { samples, vae }), 0];
  if (family.kind === "video") {
    const video = add("CreateVideo", { images, fps: Number(body.fps || family.fps || 16) });
    add("SaveVideo", { video: [video, 0], filename_prefix: "heiss-ui/video", format: "mp4", codec: "h264" });
  } else {
    add("SaveImage", { images, filename_prefix: "heiss-ui/image" });
  }
  return graph;
}

/**
 * Sana through the ExtraModels nodes: its loader, Gemma for the prompt (with
 * Sana's own instruction preamble) and the plain Gemma encode for the negative,
 * the 32-channel latent and the DC-AE VAE. Every loader fetches its weights
 * from Hugging Face the first time.
 */
function sanaGraph({ add, graph, body, variant, seed, width, height, count }) {
  // ComfyUI-SANA runs the whole diffusers pipeline (encoder, scheduler, VAE) in one node.
  if (body.source === "sana_diffusers") {
    const model = [add("SanaModelLoader", { model: body.model, device: "auto", dtype: "bfloat16" }), 0];
    const images = [add("SanaGenerate", {
      sana_model: model, prompt: body.prompt || "", negative_prompt: variant.negative === "none" ? "" : body.negative || "",
      width, height, steps: Number(body.steps || 20), guidance_scale: Number(body.cfg || 4.5), seed, batch_size: count
    }), 0];
    add("SaveImage", { images, filename_prefix: "heiss-ui/image" });
    return graph;
  }
  const settings = { conf: sanaConf(body.model), dtype: variant.dtype || "BF16", gemmaDevice: "cpu", gemmaDtype: "default", ...body.sana };
  let model = [add("SanaCheckpointLoader", { ckpt_name: body.model, model: settings.conf, dtype: settings.dtype, enable_cfg_passthrough: true }), 0];
  const gemma = [add("GemmaLoader", { model_name: "Efficient-Large-Model/gemma-2-2b-it", device: settings.gemmaDevice, dtype: settings.gemmaDtype }), 0];
  const vae = [add("ExtraVAELoader", { vae_name: "mit-han-lab/dc-ae-f32c32-sana-1.1-diffusers", vae_type: "dcae-f32c32-sana-1.1-diffusers", dtype: settings.dtype }), 0];
  const positive = [add("SanaTextEncode", { text: body.prompt || "", GEMMA: gemma }), 0];
  const negative = [add("GemmaTextEncode", { text: variant.negative === "none" ? "" : body.negative || "", GEMMA: gemma }), 0];
  let cfg = Number(body.cfg || 1);
  if (variant.id === "sprint") {
    model = [add("ScmModelSampling", { model, cfg_scale: cfg, zsnr: false }), 0];
    cfg = 1;
  }
  const latent = [add("EmptySanaLatentImage", { width, height, batch_size: count }), 0];
  const samples = [add("KSampler", {
    model, seed, steps: Number(body.steps || 20), cfg,
    sampler_name: body.sampler || "euler", scheduler: body.scheduler || "normal",
    positive, negative, latent_image: latent, denoise: 1
  }), 0];
  const images = [add("VAEDecode", { samples, vae }), 0];
  add("SaveImage", { images, filename_prefix: "heiss-ui/image" });
  return graph;
}

/**
 * Ideogram 4's schedule follows how many steps you give it, like Comfy-Org's
 * presets: Turbo (12 steps) shifts toward detail, Quality (48) narrows the spread.
 */
export function ideogram4Preset(steps) {
  if (steps <= 14) return { mu: 0.5, std: 1.75 };
  if (steps >= 36) return { mu: 0, std: 1.5 };
  return { mu: 0, std: 1.75 };
}

function customSampler(add, { seed, sampler, guider, sigmas, latent }) {
  const noise = add("RandomNoise", { noise_seed: seed });
  const samplerNode = add("KSamplerSelect", { sampler_name: sampler });
  return [add("SamplerCustomAdvanced", { noise: [noise, 0], guider: [guider, 0], sampler: [samplerNode, 0], sigmas: [sigmas, 0], latent_image: latent }), 0];
}

import { missingNodes, nodeRange, optionsFor } from './comfy.js';
import { inferModels } from './models.js';
import { workflowFor, workflowIds } from './workflow-registry.js';
import { getCustomWorkflow } from './custom-workflows.js';
import { inpaintingEnabled } from './features.js';
import { families, guidanceFor, rapidFor } from './family-catalog.js';

export function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
  const safeMin = Number.isFinite(Number(min)) ? Number(min) : -Number.MAX_SAFE_INTEGER;
  const safeMax = Number.isFinite(Number(max)) ? Number(max) : Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(number)) return safeFallback;
  return Math.max(safeMin, Math.min(safeMax, number));
}

export function clampInteger(value, fallback, min, max) {
  return Math.round(clampNumber(value, fallback, min, max));
}

export function snapNumber(value, fallback, range = {}) {
  const step = Number(range.step || 1) || 1;
  const min = Number.isFinite(Number(range.min)) ? Number(range.min) : -Number.MAX_SAFE_INTEGER;
  const max = Number.isFinite(Number(range.max)) ? Number(range.max) : Number.MAX_SAFE_INTEGER;
  const base = clampNumber(value, fallback, min, max);
  const snapped = Math.round(base / step) * step;
  return Math.max(min, Math.min(max, snapped));
}

export function snapInteger(value, fallback, range = {}) {
  return Math.round(snapNumber(value, fallback, range));
}

export function ensureOption(info, node, key, value, label) {
  const selected = String(value || "");
  if (!selected) throw new Error(`${label} is required for this workflow.`);
  const options = optionsFor(info, node, key);
  if (options.length && !options.includes(selected)) {
    throw new Error(`${label} “${selected}” isn’t available in ComfyUI.`);
  }
}

function sanitizeLoras(input = {}, info = {}, profile = null, kind = "image", maxLoras = 8) {
  if (!profile?.capabilities?.lora) return [];
  const installed = optionsFor(info, "LoraLoader", "lora_name");
  if (!installed.length) return [];
  const strengthRange = nodeRange(info, "LoraLoader", "strength_model", { default: 0.7, min: -100, max: 100, step: 0.01 });
  const raw = Array.isArray(input.loras) ? input.loras : [];
  const sanitized = [];
  // Disabled entries don't take a slot: apply the workflow's limit to enabled LoRAs only.
  for (const item of raw.filter((entry) => entry && entry.enabled !== false).slice(0, maxLoras)) {
    const name = String(item.name || "").trim();
    if (!name) continue;
    if (!installed.includes(name)) throw new Error(`LoRA “${name}” isn’t available in ComfyUI.`);
    sanitized.push({
      name,
      enabled: true,
      strength: snapNumber(item.strength, strengthRange.default ?? 0.7, strengthRange)
    });
  }
  return sanitized;
}

/**
 * A painted mask on the first reference: only for a model that can inpaint,
 * with a reference to paint on. The mask itself is checked when it is read
 * (inpaint.js); here only its shape and the two settings.
 */
function sanitizeInpaint(input, profile, referenceAssets) {
  const mask = String(input.inpaint?.mask || "");
  if (!inpaintingEnabled || !mask || !profile.capabilities.inpaint || !referenceAssets.length) return null;
  if (!mask.startsWith("data:image/png;base64,")) throw new Error("The painted mask didn’t come through. Paint it again.");
  const fallback = profile.defaults.inpaintStrength ?? 1;
  const strength = Number(input.inpaint.strength);
  const feather = Number(input.inpaint.feather);
  return {
    mask,
    strength: Number.isFinite(strength) ? Math.round(Math.min(1, Math.max(0.05, strength)) * 100) / 100 : fallback,
    feather: Number.isFinite(feather) ? Math.min(1, Math.max(0, feather)) : 0.4
  };
}

/**
 * HEISS Rapid for this run, as the graph builder takes it ({ at, smooth }), or
 * null. Only on a text-to-image run of a model that has it ready: a start
 * picture, references or an inpaint mask set the layout themselves. The
 * client decides whether it was asked for (preference, and the seed rule:
 * docs/rapid.md); `rapidAt` / `rapidSmooth` are for scripts/bench-rapid.mjs.
 */
const SMOOTH_FROM_STEPS = 12;
// Rapid's speed choice (Settings › Features): how far it moves each part's switch point from the family's own.
// Faster: the half-size start runs longer and guidance stops sooner; Careful: the other way.
const RAPID_SPEED_SHIFT = { careful: 0.1, balanced: 0, faster: -0.1 };
const speedShift = (input) => RAPID_SPEED_SHIFT[input.rapidSpeed] ?? 0;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function sanitizeRapid(input, profile, { referenceAssets, inpaint }) {
  if (input.rapid !== true || profile.capabilities?.rapid !== true || profile.kind !== "image") return null;
  if (inpaint || referenceAssets.length || input.startImage || input.startImageId) return null;
  const family = families[profile.family];
  const spec = rapidFor(family, family?.variants.find((item) => item.id === profile.variant));
  if (!spec) return null;
  const at = Number(input.rapidAt);
  // The smoothing step after the switch costs one full-size step: worth it on longer runs, where it is a few
  // percent; on a 4-8 step distill it eats most of the gain (measured, docs/rapid.md). The benchmark can force it.
  const steps = Number(input.steps) || Number(profile.defaults?.steps) || 0;
  const smooth = typeof input.rapidSmooth === "boolean" ? input.rapidSmooth : spec.smooth !== false && steps >= SMOOTH_FROM_STEPS;
  return { at: Number.isFinite(at) && at >= 0.3 && at <= 0.99 ? at : Math.round(clamp(spec.at + speedShift(input), 0.45, 0.95) * 100) / 100, smooth };
}

/**
 * HEISS Rapid Guidance for this run ({ until }) or null: asked for, ready, and
 * a run with CFG above 1 (below it there is no second pass to save). Like
 * Rapid's start, the client applies the seed rule. `rapidCfgUntil` is for the benchmark.
 */
export function sanitizeRapidGuidance(input, profile, cfg, { referenceAssets = [], inpaint = null } = {}) {
  if (input.rapidGuidance !== true || profile.capabilities?.rapidGuidance !== true || !(Number(cfg) > 1)) return null;
  // From noise only: a low-strength img2img or inpaint starts below the cut-off and would lose CFG altogether.
  if (inpaint || referenceAssets.length || input.startImage || input.startImageId) return null;
  const family = families[profile.family];
  const variant = family?.variants.find((item) => item.id === profile.variant);
  // Without a negative pass (negative "none": BasicGuider) there is no CFG to cut.
  if ((variant?.negative || family?.negative) === "none") return null;
  const spec = guidanceFor(family, variant);
  if (!spec) return null;
  const until = Number(input.rapidCfgUntil);
  return { until: Number.isFinite(until) && until >= 0 && until <= 1 ? until : Math.round(clamp(spec.until - speedShift(input), 0.1, 0.6) * 100) / 100 };
}

/**
 * A built-in family request, checked against the profile HEISS built for that
 * model file: encoders must be files that fit their slot, the VAE must fit (or
 * be the checkpoint's own), and nothing the model needs may be missing.
 */
function sanitizeFamilyBody(input, info, stats) {
  const kind = input.kind === "video" ? "video" : "image";
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("Enter a prompt.");
  const profiles = inferModels(info, stats).profiles || [];
  const profile = profiles.find((item) => item.id === input.profileId)
    || profiles.find((item) => item.workflow === input.workflow && item.model === input.model);
  if (!profile) throw new Error("ComfyUI doesn’t list this model. Rescan models and try again.");
  if (profile.kind !== kind) throw new Error(`The selected model isn’t a ${kind} model.`);
  if (!profile.ready) {
    throw new Error(`${profile.displayName} still needs: ${profile.missing.map((item) => item.label).join(", ")}.`);
  }
  const requested = Array.isArray(input.textEncoders) ? input.textEncoders : [input.textEncoder];
  const encoders = profile.encoderSlots.map((slot, index) => {
    const wanted = String(requested[index] || "");
    if (wanted && !slot.options.includes(wanted)) throw new Error(`${wanted} doesn’t fit this model’s ${slot.label} slot.`);
    return wanted || slot.default;
  });
  const vae = String(input.vae || "");
  if (vae && !profile.options.vaes.includes(vae)) throw new Error(`${vae} isn’t a VAE this model can use.`);
  const resolvedVae = vae || (profile.vaeBuiltIn ? "" : profile.defaults.vae);
  if (input.sampler) ensureOption(info, "KSampler", "sampler_name", input.sampler, "Sampler");
  if (input.scheduler) ensureOption(info, "KSampler", "scheduler", input.scheduler, "Scheduler");
  const c = profile.constraints || {};
  const supplied = Array.isArray(input.referenceAssets) ? input.referenceAssets.slice(0, 8) : [];
  const slots = (profile.mediaInputs || []).map((item) => item.id);
  // A model with reference slots takes an image per slot, in slot order; others keep the first as a start image.
  const referenceAssets = slots.length
    ? slots.map((slot) => supplied.find((item) => item?.slot === slot)).filter(Boolean)
    : supplied;
  if (profile.capabilities.startImageRequired && !referenceAssets.length && !input.startImage && !input.startImageId) {
    throw new Error(`${profile.displayName} makes a video from a picture. Add a start image first.`);
  }
  const inpaint = sanitizeInpaint(input, profile, referenceAssets);
  const cfg = snapNumber(input.cfg, profile.defaults.cfg, c.cfg);
  return {
    kind,
    workflow: profile.workflow,
    profileId: profile.id,
    family: profile.family,
    variant: profile.variant,
    source: profile.source,
    model: profile.model,
    bundled: profile.source === "checkpoint" ? { encoder: profile.encoderBuiltIn, vae: profile.vaeBuiltIn } : null,
    // A quantized checkpoint (NF4) loads through its format's node, with the same inputs.
    checkpointLoader: profile.checkpointLoader || "",
    encoders,
    textEncoder: encoders[0] || "",
    clipType: profile.defaults.clipType || "",
    vae: resolvedVae,
    audioVae: profile.audioVae,
    pairModel: profile.pairModel,
    clipVision: profile.clipVision || "",
    vpredPatch: profile.vpredPatch,
    krea2Enhancer: profile.family === "krea2" && Boolean(info["ComfyUI-Krea2T-Enhancer"]),
    sana: profile.sana || null,
    weightDtype: String(input.weightDtype || "default"),
    prompt,
    negative: String(input.negative || ""),
    width: snapInteger(input.width, c.width?.default, c.width),
    height: snapInteger(input.height, c.height?.default, c.height),
    steps: snapInteger(input.steps, profile.defaults.steps, c.steps),
    cfg,
    denoise: snapNumber(input.denoise, profile.defaults.denoise ?? 1, c.denoise),
    sampler: String(input.sampler || profile.defaults.sampler || ""),
    scheduler: String(input.scheduler || profile.defaults.scheduler || ""),
    seed: String(input.seed || ""),
    count: profile.capabilities.variations === false ? 1 : snapInteger(input.count, 1, c.count),
    frames: kind === "video" ? snapInteger(input.frames, c.frames?.default, c.frames) : 0,
    fps: kind === "video" ? snapInteger(input.fps, c.fps?.default, c.fps) : 0,
    startImage: profile.capabilities.startImage ? String(input.startImage || "") : "",
    startImageId: profile.capabilities.startImage ? String(input.startImageId || "") : "",
    startImageName: String(input.startImageName || ""),
    referenceAssets,
    autoResizeInputs: input.autoResizeInputs !== false,
    inpaint,
    rapid: sanitizeRapid(input, profile, { referenceAssets, inpaint }),
    rapidGuidance: sanitizeRapidGuidance(input, profile, cfg, { referenceAssets, inpaint }),
    promptPolicy: null,
    loras: sanitizeLoras(input, info, profile, kind, 8),
    // A retry after the GPU ran out of memory while decoding; only where this ComfyUI has the node.
    tiledDecode: Boolean(input.tiledDecode) && Boolean(info.VAEDecodeTiled) && profile.family !== "sana",
    profileLabel: profile.displayName
  };
}

export function sanitizeGenerateBody(input = {}, info = {}, stats = {}) {
  if (String(input.workflow || "").startsWith("family:")) return sanitizeFamilyBody(input, info, stats);
  const kind = input.kind === "video" ? "video" : "image";
  const workflow = String(input.workflow || "");
  const customWorkflow = workflow.startsWith("custom:") ? getCustomWorkflow(workflow) : null;
  const workflowInfo = workflowFor(workflow) || customWorkflow;
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("Enter a prompt.");
  if (!String(input.model || "").trim()) throw new Error("Choose a supported model first.");
  if (!workflowInfo) throw new Error("There’s no workflow for this model.");
  if (!customWorkflow && !workflowIds().includes(workflow)) throw new Error("There’s no workflow for this model.");
  if (kind !== workflowInfo.kind) throw new Error(`The selected model isn’t a ${kind} workflow.`);
  const referenceAssets = Array.isArray(input.referenceAssets)
    ? input.referenceAssets.slice(0, 8).map((item) => ({
      slot: String(item?.slot || "reference").replace(/[^a-z0-9._-]/gi, "").slice(0, 80) || "reference",
      assetId: String(item?.assetId || "").slice(0, 2048),
      source: String(item?.source || "").slice(0, 40)
    })).filter((item) => item.assetId)
    : [];
  for (const mediaInput of workflowInfo.mediaInputs || []) {
    const supplied = referenceAssets.filter((item) => item.slot === mediaInput.id).length;
    const legacySupplied = mediaInput.id === (workflowInfo.mediaInputs?.[0]?.id || "reference") && Boolean(input.startImage || input.startImageId);
    if ((mediaInput.required || Number(mediaInput.min || 0) > 0) && supplied < Number(mediaInput.min || 1) && !legacySupplied) {
      throw new Error(`${mediaInput.label || "Reference image"} is required for this workflow.`);
    }
    if (supplied > Number(mediaInput.max || 1)) throw new Error(`${mediaInput.label || "Reference image"} accepts at most ${mediaInput.max || 1} image.`);
  }
  const missing = missingNodes(info, workflowInfo.requiredNodes);
  if (missing.length) throw new Error(`ComfyUI is missing nodes this model needs: ${missing.join(", ")}`);
  const profiles = inferModels(info, stats).profiles || [];
  const profile = profiles.find((item) => item.kind === kind && item.workflow === workflow && item.model === input.model);
  if (!profile) throw new Error("ComfyUI doesn’t list this model. Rescan models and try again.");
  if ((workflowInfo.needsTextEncoder && !input.textEncoder) || (workflowInfo.needsVae && !input.vae)) {
    throw new Error("This workflow needs a text encoder and VAE.");
  }

  if (workflowInfo.modelNode && workflowInfo.modelKey) {
    ensureOption(info, workflowInfo.modelNode, workflowInfo.modelKey, input.model, "Model");
  }
  if (customWorkflow?.controls?.model?.node && customWorkflow?.controls?.model?.input && (input.modelName || customWorkflow.defaults?.model)) {
    const classType = customWorkflow.graph?.[customWorkflow.controls.model.node]?.class_type;
    ensureOption(info, classType, customWorkflow.controls.model.input, input.modelName || customWorkflow.defaults.model, "Model");
  }
  if (workflowInfo.needsTextEncoder || workflowInfo.capabilities?.textEncoder) {
    ensureOption(info, "CLIPLoader", "clip_name", input.textEncoder, "Text encoder");
  }
  if (workflowInfo.needsVae || workflowInfo.capabilities?.vae) {
    ensureOption(info, "VAELoader", "vae_name", input.vae, "VAE");
  }
  if (input.sampler) ensureOption(info, "KSampler", "sampler_name", input.sampler, "Sampler");
  if (input.scheduler) ensureOption(info, "KSampler", "scheduler", input.scheduler, "Scheduler");

  const latentNode = workflowInfo.latentNode || "EmptyLatentImage";
  const widthRange = nodeRange(info, latentNode, "width", { default: kind === "video" ? 512 : 1024, min: 16, max: 16384 });
  const heightRange = nodeRange(info, latentNode, "height", { default: kind === "video" ? 288 : 1024, min: 16, max: 16384 });
  const countRange = nodeRange(info, latentNode, "batch_size", { default: 1, min: 1, max: 8 });
  const frameRange = nodeRange(info, latentNode, "length", { default: 33, min: 1, max: 16384 });
  const fpsRange = nodeRange(info, "CreateVideo", "fps", { default: 16, min: 1, max: 120 });
  const stepsRange = nodeRange(info, "KSampler", "steps", { default: kind === "video" ? 12 : 8, min: 1, max: 10000 });
  const cfgRange = nodeRange(info, "KSampler", "cfg", { default: kind === "video" ? 5 : 1, min: 0, max: 100 });
  const denoiseRange = nodeRange(info, "KSampler", "denoise", { default: 1, min: 0, max: 1 });

  const loras = sanitizeLoras(input, info, profile, kind, customWorkflow?.loraStack?.max || 8);
  return {
    ...input,
    kind,
    workflow,
    prompt,
    negative: String(input.negative || ""),
    model: String(input.model || ""),
    modelName: String(input.modelName || customWorkflow?.defaults?.model || ""),
    textEncoder: String(input.textEncoder || ""),
    vae: String(input.vae || ""),
    clipType: String(input.clipType || "wan"),
    weightDtype: String(input.weightDtype || "default"),
    width: snapInteger(input.width, widthRange.default, widthRange),
    height: snapInteger(input.height, heightRange.default, heightRange),
    steps: snapInteger(input.steps, stepsRange.default, stepsRange),
    cfg: snapNumber(input.cfg, cfgRange.default, cfgRange),
    denoise: snapNumber(input.denoise, denoiseRange.default, denoiseRange),
    sampler: String(input.sampler || ""),
    scheduler: String(input.scheduler || ""),
    seed: String(input.seed || ""),
    count: workflowInfo.capabilities?.variations === false ? 1 : snapInteger(input.count, countRange.default, countRange),
    frames: snapInteger(input.frames, frameRange.default, frameRange),
    fps: snapInteger(input.fps, fpsRange.default, fpsRange),
    startImage: String(input.startImage || ""),
    startImageId: String(input.startImageId || ""),
    startImageName: String(input.startImageName || ""),
    referenceAssets,
    autoResizeInputs: input.autoResizeInputs !== false,
    // Rapid is for built-in models only; an imported workflow samples its own way.
    rapid: null,
    rapidGuidance: null,
    promptPolicy: workflowInfo.promptComposition ? {
      policy: workflowInfo.promptComposition.policy,
      version: workflowInfo.promptComposition.version
    } : null,
    loras
  };
}

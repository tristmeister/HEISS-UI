import { missingNodes, nodeRange, optionsFor } from './comfy.js';
import { inferModels } from './models.js';
import { workflowFor, workflowIds } from './workflow-registry.js';
import { getCustomWorkflow } from './custom-workflows.js';

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
    throw new Error(`${label} is not installed or ComfyUI cannot see it: ${selected}`);
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
    if (!installed.includes(name)) throw new Error(`LoRA is not installed or ComfyUI cannot see it: ${name}`);
    sanitized.push({
      name,
      enabled: true,
      strength: snapNumber(item.strength, strengthRange.default ?? 0.7, strengthRange)
    });
  }
  return sanitized;
}

/**
 * A built-in family request, checked against the profile HEISS built for that
 * model file: encoders must be files that fit their slot, the VAE must fit (or
 * be the checkpoint's own), and nothing the model needs may be missing.
 */
function sanitizeFamilyBody(input, info, stats) {
  const kind = input.kind === "video" ? "video" : "image";
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("Prompt is required.");
  const profiles = inferModels(info, stats).profiles || [];
  const profile = profiles.find((item) => item.id === input.profileId)
    || profiles.find((item) => item.workflow === input.workflow && item.model === input.model);
  if (!profile) throw new Error("ComfyUI does not currently expose this model. Rescan models and try again.");
  if (profile.kind !== kind) throw new Error(`The selected model is not a ${kind} model.`);
  if (!profile.ready) {
    throw new Error(`${profile.displayName} still needs: ${profile.missing.map((item) => item.label).join(", ")}.`);
  }
  const requested = Array.isArray(input.textEncoders) ? input.textEncoders : [input.textEncoder];
  const encoders = profile.encoderSlots.map((slot, index) => {
    const wanted = String(requested[index] || "");
    if (wanted && !slot.options.includes(wanted)) throw new Error(`${wanted} does not fit the ${slot.label} slot of this model.`);
    return wanted || slot.default;
  });
  const vae = String(input.vae || "");
  if (vae && !profile.options.vaes.includes(vae)) throw new Error(`${vae} is not a VAE this model can use.`);
  const resolvedVae = vae || (profile.vaeBuiltIn ? "" : profile.defaults.vae);
  if (input.sampler) ensureOption(info, "KSampler", "sampler_name", input.sampler, "Sampler");
  if (input.scheduler) ensureOption(info, "KSampler", "scheduler", input.scheduler, "Scheduler");
  const c = profile.constraints || {};
  const referenceAssets = Array.isArray(input.referenceAssets) ? input.referenceAssets.slice(0, 8) : [];
  return {
    kind,
    workflow: profile.workflow,
    profileId: profile.id,
    family: profile.family,
    variant: profile.variant,
    source: profile.source,
    model: profile.model,
    bundled: profile.source === "checkpoint" ? { encoder: profile.encoderBuiltIn, vae: profile.vaeBuiltIn } : null,
    encoders,
    textEncoder: encoders[0] || "",
    clipType: profile.defaults.clipType || "",
    vae: resolvedVae,
    audioVae: profile.audioVae,
    pairModel: profile.pairModel,
    vpredPatch: profile.vpredPatch,
    krea2Enhancer: profile.family === "krea2" && Boolean(info["ComfyUI-Krea2T-Enhancer"]),
    weightDtype: String(input.weightDtype || "default"),
    prompt,
    negative: String(input.negative || ""),
    width: snapInteger(input.width, c.width?.default, c.width),
    height: snapInteger(input.height, c.height?.default, c.height),
    steps: snapInteger(input.steps, profile.defaults.steps, c.steps),
    cfg: snapNumber(input.cfg, profile.defaults.cfg, c.cfg),
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
    promptPolicy: null,
    loras: sanitizeLoras(input, info, profile, kind, 8),
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
  if (!prompt) throw new Error("Prompt is required.");
  if (!String(input.model || "").trim()) throw new Error("Choose a supported model first.");
  if (!workflowInfo) throw new Error("This model does not have a supported workflow.");
  if (!customWorkflow && !workflowIds().includes(workflow)) throw new Error("This model does not have a supported workflow.");
  if (kind !== workflowInfo.kind) throw new Error(`The selected model is not a ${kind} workflow.`);
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
  if (missing.length) throw new Error(`ComfyUI is missing required nodes for this model: ${missing.join(", ")}`);
  const profiles = inferModels(info, stats).profiles || [];
  const profile = profiles.find((item) => item.kind === kind && item.workflow === workflow && item.model === input.model);
  if (!profile) throw new Error("ComfyUI does not currently expose this model as a runnable workflow.");
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
    promptPolicy: workflowInfo.promptComposition ? {
      policy: workflowInfo.promptComposition.policy,
      version: workflowInfo.promptComposition.version
    } : null,
    loras
  };
}

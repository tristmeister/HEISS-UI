import { missingNodes, nodeRange, optionsFor, textRange } from './comfy.js';
import { loadCustomWorkflows, workflowOptionIssues } from './custom-workflows.js';
import { modelTypeChoices } from './model-families.js';
import { familyProfiles } from './family-profiles.js';

export function modelBasename(name = "") {
  return String(name).split(/[\\/]/).pop() || name;
}

export function prettyModelName(name = "") {
  const base = modelBasename(name).replace(/\.(safetensors|ckpt|pt|bin)$/i, "");
  return base
    .replace(/distill/ig, "")
    .replace(/aio/ig, "")
    .replace(/[_-]+/g, " ")
    .replace(/\bfp(\d+)\b/ig, "FP$1")
    .replace(/\bti2v\b/ig, "TI2V")
    .replace(/\b(\d+)step\b/ig, "$1-Step")
    .replace(/\bz anime\b/ig, "Z-Anime")
    .replace(/\bz image\b/ig, "Z-Image")
    .replace(/\bwan(\d)/ig, "Wan $1")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function isNvfp4Model(name = "") {
  return /nvfp4/i.test(name);
}

export function torchVersionAtLeast(version = "", major, minor) {
  const match = String(version).match(/(\d+)\.(\d+)/);
  if (!match) return false;
  const currentMajor = Number(match[1]);
  const currentMinor = Number(match[2]);
  return currentMajor > major || (currentMajor === major && currentMinor >= minor);
}

export function torchSupportsNvfp4(stats = {}) {
  return torchVersionAtLeast(stats?.system?.pytorch_version, 2, 8);
}

export function snapDimension(value, meta = {}) {
  const step = Number(meta.step || 1) || 1;
  const min = Number(meta.min || step) || step;
  const max = Number(meta.max || 16384) || 16384;
  const snapped = Math.round(value / step) * step;
  return Math.max(min, Math.min(max, snapped));
}

export function detectedDefault(meta = {}, fallback) {
  const value = Number(meta.default);
  return Number.isFinite(value) ? value : fallback;
}

export function aspectSet(defaults, ratios, ranges = {}) {
  const defaultArea = Math.max(1, Number(defaults.width || 1024) * Number(defaults.height || 1024));
  const seen = new Set();
  return ratios.map(([label, ratioW, ratioH]) => {
    const scale = Math.sqrt(defaultArea / Math.max(1, ratioW * ratioH));
    const w = snapDimension(ratioW * scale, ranges.width);
    const h = snapDimension(ratioH * scale, ranges.height);
    const value = `${w}x${h}`;
    if (seen.has(value)) return null;
    seen.add(value);
    return { label, value, w, h, default: w === defaults.width && h === defaults.height };
  }).filter(Boolean);
}

function customAspectSet(defaults, ratios = [], ranges = {}) {
  if (!Array.isArray(ratios) || !ratios.length) return aspectSet(defaults, [
    ["1:1", 1, 1],
    ["16:9", 16, 9],
    ["9:16", 9, 16],
    ["4:3", 4, 3],
    ["3:4", 3, 4]
  ], ranges);
  return ratios.map((item) => {
    if (Array.isArray(item)) return item;
    return [item.label || item.value || "Custom", Number(item.w || 1), Number(item.h || 1)];
  }).length ? aspectSet(defaults, ratios.map((item) => Array.isArray(item) ? item : [item.label || item.value || "Custom", Number(item.w || 1), Number(item.h || 1)]), ranges) : [];
}

export function buildProfile({ id, kind, label, displayName, description, model, workflow, family, defaults, aspects, options = {}, capabilities = {}, constraints = {}, mediaInputs = [], aspectPolicy = "manual", maxLoras = 8 }) {
  return {
    id,
    kind,
    label,
    displayName: displayName || label,
    description: description || modelBasename(model),
    model,
    workflow,
    family,
    defaults,
    aspectPresets: aspects,
    options,
    constraints,
    mediaInputs,
    aspectPolicy: aspectPolicy === "reference" ? "reference" : "manual",
    // How many LoRAs the workflow's loader accepts (rgthree stacks take 4).
    maxLoras: Math.max(1, Math.min(8, Number(maxLoras) || 8)),
    capabilities: {
      prompt: true,
      negativePrompt: kind === "image",
      steps: true,
      seed: true,
      cfg: true,
      sampler: true,
      scheduler: true,
      variations: kind === "image",
      frames: kind === "video",
      fps: kind === "video",
      textEncoder: false,
      vae: false,
      clipType: false,
      weightDtype: false,
      startImage: false,
      denoise: false,
      ...capabilities
    }
  };
}

export function inferModels(info, stats = {}) {
  const missingCoreImageNodes = missingNodes(info, ["KSampler", "CLIPTextEncode", "VAEDecode", "SaveImage"]);
  if (missingCoreImageNodes.length) {
    return emptyModelResult({ reason: `ComfyUI is missing required image nodes: ${missingCoreImageNodes.join(", ")}` });
  }
  const unets = optionsFor(info, "UNETLoader", "unet_name");
  const checkpoints = optionsFor(info, "CheckpointLoaderSimple", "ckpt_name");
  const clips = optionsFor(info, "CLIPLoader", "clip_name");
  const clipTypes = optionsFor(info, "CLIPLoader", "type");
  const vaes = optionsFor(info, "VAELoader", "vae_name");
  const samplers = optionsFor(info, "KSampler", "sampler_name");
  const schedulers = optionsFor(info, "KSampler", "scheduler");
  const weightDtypes = optionsFor(info, "UNETLoader", "weight_dtype");
  const loras = optionsFor(info, "LoraLoader", "lora_name");
  const canUseLoras = Boolean(info.LoraLoader && loras.length);
  const incompatibleModels = unets.filter((name) => isNvfp4Model(name) && !torchSupportsNvfp4(stats));
  const textMeta = textRange(info, "CLIPTextEncode", "text");
  const samplerRange = {
    steps: nodeRange(info, "KSampler", "steps", { default: 20, min: 1, max: 10000, step: 1 }),
    cfg: nodeRange(info, "KSampler", "cfg", { default: 8, min: 0, max: 100, step: 0.1 }),
    denoise: nodeRange(info, "KSampler", "denoise", { default: 1, min: 0, max: 1, step: 0.01 })
  };
  const { profiles, modelFiles } = familyProfiles(info, {
    prettyModelName, buildProfile, aspectSet, textMeta, samplerRange, samplers, schedulers, weightDtypes, loras, canUseLoras,
    incompatible: (name) => incompatibleModels.includes(name)
  });

  for (const workflow of loadCustomWorkflows()) {
    const missing = missingNodes(info, workflow.requiredNodes);
    if (missing.length || workflowOptionIssues(workflow, info).length) continue;
    const defaults = workflow.defaults || {};
    const controls = workflow.controls || {};
    const widthRange = controls.width ? nodeRange(info, workflow.graph?.[controls.width.node]?.class_type, controls.width.input, { default: Number(defaults.width || 1024), min: 16, max: 16384, step: 8 }) : {};
    const heightRange = controls.height ? nodeRange(info, workflow.graph?.[controls.height.node]?.class_type, controls.height.input, { default: Number(defaults.height || 1024), min: 16, max: 16384, step: 8 }) : {};
    const countRange = controls.count ? nodeRange(info, workflow.graph?.[controls.count.node]?.class_type, controls.count.input, { default: Number(defaults.count || 1), min: 1, max: 4096, step: 1 }) : {};
    const frameRange = controls.frames ? nodeRange(info, workflow.graph?.[controls.frames.node]?.class_type, controls.frames.input, { default: Number(defaults.frames || 33), min: 1, max: 16384, step: 1 }) : {};
    const fpsRange = controls.fps ? nodeRange(info, workflow.graph?.[controls.fps.node]?.class_type, controls.fps.input, { default: Number(defaults.fps || 16), min: 1, max: 120, step: 1 }) : {};
    if (Number(defaults.width)) widthRange.default = Number(defaults.width);
    if (Number(defaults.height)) heightRange.default = Number(defaults.height);
    if (Number(defaults.count)) countRange.default = Number(defaults.count);
    if (Number(defaults.frames)) frameRange.default = Number(defaults.frames);
    if (Number(defaults.fps)) fpsRange.default = Number(defaults.fps);
    profiles.push(buildProfile({
      id: workflow.profileId,
      kind: workflow.kind,
      label: workflow.name,
      displayName: workflow.name,
      description: workflow.description,
      model: workflow.profileId,
      workflow: workflow.profileId,
      family: workflow.family,
      defaults: {
        width: detectedDefault(widthRange, Number(defaults.width || 1024)),
        height: detectedDefault(heightRange, Number(defaults.height || 1024)),
        steps: Number(defaults.steps || detectedDefault(samplerRange.steps, workflow.kind === "video" ? 12 : 20)),
        cfg: Number(defaults.cfg || detectedDefault(samplerRange.cfg, workflow.kind === "video" ? 5 : 7)),
        sampler: defaults.sampler || samplers[0] || "",
        scheduler: defaults.scheduler || schedulers[0] || "",
        textEncoder: defaults.textEncoder || "",
        vae: defaults.vae || "",
        clipType: defaults.clipType || "",
        weightDtype: defaults.weightDtype || "default",
        frames: detectedDefault(frameRange, Number(defaults.frames || 33)),
        fps: detectedDefault(fpsRange, Number(defaults.fps || 16)),
        denoise: Number(defaults.denoise || 1)
      },
      aspects: customAspectSet({ width: detectedDefault(widthRange, Number(defaults.width || 1024)), height: detectedDefault(heightRange, Number(defaults.height || 1024)) }, workflow.aspectRatios, { width: widthRange, height: heightRange }),
      options: { textEncoders: clips, vaes, clipTypes, weightDtypes, samplers, schedulers },
      constraints: { prompt: textMeta, negative: textMeta, width: widthRange, height: heightRange, count: countRange, frames: frameRange, fps: fpsRange, ...samplerRange },
      capabilities: workflow.capabilities,
      mediaInputs: workflow.mediaInputs || [],
      aspectPolicy: workflow.aspectPolicy,
      maxLoras: workflow.loraStack?.max
    }));
  }

  const imageProfiles = profiles.filter((profile) => profile.kind === "image");
  const videoProfiles = profiles.filter((profile) => profile.kind === "video");
  const unsupportedModels = modelFiles.filter((file) => !file.supported).map((file) => file.name);
  // A ready model is the better first pick than one still waiting on files.
  const firstReady = (list) => (list.find((profile) => profile.ready !== false) || list[0])?.id || "";
  return {
    imageModels: imageProfiles.map((profile) => ({ label: profile.label, value: profile.id })),
    videoModels: videoProfiles.map((profile) => ({ label: profile.label, value: profile.id })),
    profiles,
    unsupportedModels,
    modelFiles,
    modelTypeChoices: modelTypeChoices(),
    textEncoders: clips,
    vaes,
    clipTypes,
    weightDtypes,
    samplers,
    schedulers,
    loras,
    defaults: {
      imageModel: firstReady(imageProfiles),
      videoModel: firstReady(videoProfiles)
    },
    capabilities: {
      image: imageProfiles.length > 0,
      video: videoProfiles.length > 0,
      startImage: profiles.some((profile) => profile.capabilities.startImage)
    }
  };
}

/** No ComfyUI to ask: nothing to offer, and say why instead of blaming missing nodes. */
export function offlineModelResult(comfyUrl = "") {
  return { ...inferModels({}, {}), reason: `ComfyUI is not reachable${comfyUrl ? ` at ${comfyUrl}` : ""}.` };
}

/** Fake models for HEISS_DEMO=1 (agent and UI testing without ComfyUI). */
export function mockModelResult() {
  const imageProfiles = [
    buildProfile({
      id: "mock-flux-schnell",
      kind: "image",
      label: "FLUX.1 Schnell (Demo)",
      displayName: "FLUX.1 Schnell (Demo)",
      description: "Fast 4-step image model for offline testing mode",
      model: "flux1-schnell.safetensors",
      workflow: "builtin-flux-schnell",
      family: "flux",
      defaults: { width: 1024, height: 1024, steps: 4, cfg: 1, sampler: "euler", scheduler: "simple" },
      capabilities: { lora: true, startImage: true, startImageRequired: false }
    }),
    buildProfile({
      id: "mock-sdxl-turbo",
      kind: "image",
      label: "SDXL Turbo (Demo)",
      displayName: "SDXL Turbo (Demo)",
      description: "Realtime 1-step SDXL model",
      model: "sd_xl_turbo_1.0.safetensors",
      workflow: "builtin-sdxl-turbo",
      family: "sdxl",
      defaults: { width: 1024, height: 1024, steps: 1, cfg: 1, sampler: "euler_ancestral", scheduler: "normal" },
      capabilities: { lora: true, startImage: true, startImageRequired: false }
    }),
    buildProfile({
      id: "mock-illustrious",
      kind: "image",
      label: "Illustrious SDXL (Demo)",
      displayName: "Illustrious SDXL (Demo)",
      description: "Anime & Illustration specialized model",
      model: "illustrious-xl-v1.0.safetensors",
      workflow: "builtin-illustrious",
      family: "sdxl",
      defaults: { width: 832, height: 1216, steps: 24, cfg: 7, sampler: "dpmpp_2m", scheduler: "karras" },
      capabilities: { lora: true, startImage: true, startImageRequired: false }
    })
  ];

  const videoProfiles = [
    buildProfile({
      id: "mock-wan-video",
      kind: "video",
      label: "Wan 2.1 Video (Demo)",
      displayName: "Wan 2.1 Video (Demo)",
      description: "16-frame video generation in offline testing mode",
      model: "wan2.1_i2v_480p.safetensors",
      workflow: "builtin-wan-video",
      family: "wan",
      defaults: { width: 832, height: 480, steps: 20, cfg: 6, frames: 16, fps: 16, sampler: "uni_pc", scheduler: "normal" },
      capabilities: { lora: false, startImage: true, startImageRequired: false }
    })
  ];

  // File names, exactly like ComfyUI's LoraLoader list (objects here crashed the picker).
  const loras = ["cyberpunk_neon_v1.safetensors", "film_grain_35mm.safetensors", "anime_watercolor.safetensors"];

  const samplers = ["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_sde", "uni_pc"];
  const schedulers = ["normal", "karras", "exponential", "simple", "beta"];

  return {
    isMock: true,
    imageModels: imageProfiles.map((p) => ({ label: p.label, value: p.id })),
    videoModels: videoProfiles.map((p) => ({ label: p.label, value: p.id })),
    profiles: [...imageProfiles, ...videoProfiles],
    unsupportedModels: [],
    textEncoders: [],
    vaes: [],
    clipTypes: [],
    weightDtypes: ["default", "fp8_e4m3fn", "fp8_e5m2"],
    samplers,
    schedulers,
    loras,
    defaults: {
      imageModel: imageProfiles[0].id,
      videoModel: videoProfiles[0].id
    },
    capabilities: {
      image: true,
      video: true,
      startImage: true
    }
  };
}

function emptyModelResult(extra = {}) {
  return {
    imageModels: [],
    videoModels: [],
    profiles: [],
    unsupportedModels: [],
    textEncoders: [],
    vaes: [],
    clipTypes: [],
    weightDtypes: [],
    loras: [],
    samplers: [],
    schedulers: [],
    defaults: { imageModel: "", videoModel: "" },
    capabilities: { image: false, video: false, startImage: false },
    ...extra
  };
}

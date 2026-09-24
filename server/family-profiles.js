import fs from 'node:fs';
import path from 'node:path';
import { hasNode, missingNodes, modelFolders, nodeRange, optionsFor } from './comfy.js';
import { encoderDownloads, families, knownFamilies, modelDownloads, sanaConf, sanaLabel, sanaLatentNode, sanaPresets, sanaRunnerFor, vaeDownloads } from './family-catalog.js';
import { missingPackPart } from './node-install.js';
import { classifyModel, familyLabel } from './model-families.js';
import { classifyEncoder, classifyVae, encoderKinds, rankEncoders, rankVaes, vaeKinds } from './model-components.js';

/**
 * Turns every model file ComfyUI lists into a profile the studio can run, from
 * the family catalog: which variant it is, which parts its checkpoint carries,
 * which installed encoders and VAE fill the rest (best first), and exactly what
 * is still missing, with where to get it.
 */

const clipLoaderClass = [null, "CLIPLoader", "DualCLIPLoader", "TripleCLIPLoader", "QuadrupleCLIPLoader"];

function downloadsFor(list = [], folder, prefix) {
  return list.map((item, index) => ({ id: `${prefix}:${index}`, folder, label: item.file, ...item }));
}

const downloadSources = {
  encoder: [encoderDownloads, "text_encoders"],
  vae: [vaeDownloads, "vae"],
  model: [modelDownloads, "diffusion_models"]
};

/** Every catalog download HEISS will fetch, by id. The only files the download route accepts. */
export function catalogDownload(id = "") {
  const [kind, key, index] = String(id).split(":");
  const [source, folder] = downloadSources[kind] || [];
  const entry = source && Object.hasOwn(source, key) ? source[key][Number(index)] : null;
  if (!entry) return null;
  return { id, folder, label: entry.file, ...entry };
}

function nodesFor(family, variant, needsEncoderLoader, needsVaeLoader) {
  const nodes = new Set(family.requiredNodes || []);
  if (family.sampling !== "h3") nodes.add(family.latent);
  if (needsEncoderLoader) nodes.add(clipLoaderClass[family.slots.length]);
  if (needsVaeLoader || family.audioVae) nodes.add("VAELoader");
  const sampling = variant.modelSampling || family.modelSampling;
  if (sampling) nodes.add(sampling.node);
  if (variant.rawShift) nodes.add("ModelSamplingFlux");
  if (variant.vpred) nodes.add("ModelSamplingDiscrete");
  if (family.t5Padding) nodes.add("T5TokenizerOptions");
  if (family.sampling === "pair") nodes.add("KSamplerAdvanced");
  if (family.kind === "video") ["CreateVideo", "SaveVideo"].forEach((node) => nodes.add(node));
  return [...nodes];
}

function clipTypeAvailable(info, family) {
  if (!family.clipType || family.slots.length > 2) return true;
  const loader = family.slots.length === 2 ? "DualCLIPLoader" : "CLIPLoader";
  return optionsFor(info, loader, "type").includes(family.clipType);
}

function legacyProfileId(familyId, source, name) {
  if (familyId === "zimage" && source === "unet") return `image:unet-z:${name}`;
  if ((familyId === "sdxl" || familyId === "sd15") && source === "checkpoint") return `image:checkpoint:${name}`;
  if (familyId === "krea2") return `image:${source === "checkpoint" ? "krea2-checkpoint" : "krea2"}:${name}`;
  if (familyId === "wan22_5b" && source === "unet") return `video:wan:${name}`;
  return "";
}

/**
 * The Sana entries beyond checkpoints: ExtraModels presets already downloaded
 * to ComfyUI/models/sana (its loader lists every preset, fetched or not, and
 * fetches on first run) and ComfyUI-SANA's diffusers folders. Sana weights you
 * do not have never show, like any other model.
 */
function sanaFiles(info) {
  const presetNames = new Set(optionsFor(info, "SanaCheckpointLoader", "ckpt_name"));
  const folders = modelFolders("sana", ["sana", "Sana"]);
  const downloaded = (preset) => folders.some((dir) => fs.existsSync(path.join(dir, preset.dir, "checkpoints", `${preset.name.split("/").pop()}.pth`)));
  const presets = sanaPresets.filter((preset) => !preset.hidden && presetNames.has(preset.name) && downloaded(preset))
    .map((preset) => ({ source: "sana", name: preset.name, preset }));
  const diffusers = optionsFor(info, "SanaModelLoader", "model").filter((name) => /sana/i.test(name))
    .map((name) => ({ source: "sana_diffusers", name }));
  return [...presets, ...diffusers];
}

/**
 * How the ExtraModels nodes should load a Sana model. Gemma only runs on CUDA
 * or the CPU there (and only in FP32 on the CPU), so Macs encode on the CPU.
 */
function sanaSettings(info, name, variant, detail, cuda) {
  return {
    conf: sanaConf(name, detail),
    dtype: variant.dtype || "BF16",
    gemmaDevice: cuda ? "cuda" : "cpu",
    gemmaDtype: cuda ? "BF16" : "default",
    // ExtraModels' own latent node only works on ComfyUI builds from before the native one.
    latent: hasNode(info, sanaLatentNode) ? sanaLatentNode : "EmptySanaLatentImage"
  };
}

/**
 * @param helpers { prettyModelName, buildProfile, aspectSet, textMeta, samplerRange, samplers, schedulers, weightDtypes, loras, canUseLoras, incompatible, cuda }
 */
export function familyProfiles(info, helpers) {
  const { prettyModelName, buildProfile, aspectSet, textMeta, samplerRange, samplers, schedulers, weightDtypes, loras, canUseLoras, incompatible, cuda = false } = helpers;
  const unets = optionsFor(info, "UNETLoader", "unet_name");
  const checkpoints = optionsFor(info, "CheckpointLoaderSimple", "ckpt_name");
  const encoderFiles = optionsFor(info, "CLIPLoader", "clip_name").map(classifyEncoder);
  const vaeFiles = optionsFor(info, "VAELoader", "vae_name")
    .filter((name) => !/^(pixel_space|taesd|taesdxl|taesd3|taef1)$/i.test(name))
    .map(classifyVae);

  const profiles = [];
  const modelFiles = [];
  // Sana runs on a custom node pack: downloaded ExtraModels presets, or
  // diffusers folders ComfyUI-SANA lists (see sanaFiles).
  const files = [
    ...unets.map((name) => ({ source: "unet", name })),
    ...checkpoints.map((name) => ({ source: "checkpoint", name })),
    ...sanaFiles(info)
  ];
  const lowNoisePartners = new Set();

  for (const { source, name, preset } of files) {
    const base = String(name).split(/[\\/]/).pop() || name;
    // The second file of a pair (Wan's low-noise half, Ideogram's unconditional
    // model) runs with its partner and is not a model of its own, whatever its weights say.
    const pairOwner = source === "unet" ? Object.entries(families).find(([, spec]) => spec.pair?.owns.test(base) && spec.pair.isPartner(base)) : null;
    if (pairOwner) {
      const [ownerId, owner] = pairOwner;
      lowNoisePartners.add(name);
      modelFiles.push({ name, source, family: ownerId, via: "name", label: owner.label, choice: ownerId, supported: true, reason: owner.pair.runsAs, missing: [] });
      continue;
    }
    const info2 = source.startsWith("sana")
      ? { family: "sana", variant: families.sana.variants.find((item) => !item.match || item.match(name)), via: "preset", bundled: null, detail: null, header: null }
      : classifyModel(source, name);
    const family = families[info2.family];
    const fileEntry = {
      name, source, family: info2.family, via: info2.via,
      label: familyLabel(info2.family) + (info2.variant && family?.variants.length > 1 ? ` · ${info2.variant.label}` : ""),
      choice: family ? (family.variants.length > 1 ? `${info2.family}/${info2.variant?.id}` : info2.family) : "",
      supported: false, reason: "", missing: []
    };
    if (!source.startsWith("sana")) modelFiles.push(fileEntry);

    if (!family || !family.sources.includes(source)) {
      fileEntry.reason = knownFamilies[info2.family] && info2.family !== "other"
        ? `${knownFamilies[info2.family]} can’t run in HEISS UI yet.`
        : "Model type not recognized. Pick it below.";
      continue;
    }
    if (incompatible(name)) {
      fileEntry.reason = "Needs PyTorch 2.8 or newer (NVFP4).";
      continue;
    }

    // Pairs show as one entry and run both files: the partner named after this
    // one, else any partner file of the same family in the folder.
    let pairModel = "";
    if (family.pair) {
      const named = family.pair.partnerOf(name);
      pairModel = named !== name && unets.includes(named) ? named
        : unets.find((other) => {
          const otherBase = String(other).split(/[\\/]/).pop() || other;
          return other !== name && family.pair.owns.test(otherBase) && family.pair.isPartner(otherBase);
        }) || "";
    }

    const variant = info2.variant || family.variants.at(-1);
    const runner = family.sampling === "sana" ? sanaRunnerFor(source) : null;
    const diffusersRunner = source === "sana_diffusers";
    // Families with their own loaders fetch encoder and VAE themselves; count them as carried.
    const bundled = family.ownLoaders ? { encoder: true, vae: true, known: true }
      : source === "checkpoint" ? info2.bundled : { encoder: false, vae: false, known: true };
    const encoderBuiltIn = bundled.encoder && !family.neverBundledEncoder;
    const missing = [];

    const encoderSlots = encoderBuiltIn ? [] : family.slots.map((slot) => {
      const options = rankEncoders(encoderFiles, slot);
      if (!options.length) {
        const key = slot.download || slot.kinds[0];
        missing.push({
          part: "encoder", slot: slot.slot, label: `${slot.label} text encoder`, kind: slot.kinds[0],
          detail: `Any ${encoderKinds[slot.kinds[0]]?.label || slot.label} text encoder in ComfyUI/models/text_encoders works.`,
          downloads: downloadsFor(encoderDownloads[key], "text_encoders", `encoder:${key}`)
        });
      }
      return { slot: slot.slot, label: slot.label, options, default: options[0] || "" };
    });

    const vaeOptions = rankVaes(vaeFiles, family.vae);
    if (!bundled.vae && !vaeOptions.length) {
      const key = family.vae[0];
      missing.push({
        part: "vae", label: vaeKinds[key]?.label || "VAE", kind: key,
        detail: `Put a ${vaeKinds[key]?.label || "matching VAE"} in ComfyUI/models/vae.`,
        downloads: downloadsFor(vaeDownloads[key], "vae", `vae:${key}`)
      });
    }
    let audioVae = "";
    if (family.audioVae) {
      const audioOptions = rankVaes(vaeFiles, family.audioVae);
      audioVae = audioOptions[0] || "";
      if (!audioVae) {
        const key = family.audioVae[0];
        missing.push({ part: "vae", label: vaeKinds[key].label, kind: key, detail: "H3 decodes its sound with a separate VAE.", downloads: downloadsFor(vaeDownloads[key], "vae", `vae:${key}`) });
      }
    }
    if (family.pair && !pairModel) {
      const key = family.pair.download?.(base);
      missing.push({ part: "model", label: family.pair.label, detail: family.pair.detail(base), downloads: key ? downloadsFor(modelDownloads[key], "diffusion_models", `model:${key}`) : [] });
    }
    const nodes = runner ? [] : missingNodes(info, nodesFor(family, variant, !encoderBuiltIn, !bundled.vae));
    // A family that runs on a custom node pack names it (family.pack, or its runner's).
    const needs = runner || family;
    const packPart = needs.pack && missingPackPart(info, needs.pack, { extra: needs.variantNodes?.[variant.id] || [], detail: needs.note });
    if (packPart) {
      missing.push(packPart);
    } else if (!packPart && (nodes.length || !clipTypeAvailable(info, family))) {
      missing.push({ part: "comfy", label: "Newer ComfyUI", detail: `This ComfyUI cannot run ${family.label} yet${nodes.length ? ` (missing ${nodes.join(", ")})` : ""}. Update ComfyUI.`, downloads: [] });
    }

    const [width, height] = variant.size || family.size;
    const latentNode = runner ? runner.sizeNode : family.latent;
    const step = family.sizeStep || 8;
    // Some latent nodes accept 0 ("use the reference image's size"); a picked size never goes below 64.
    const widthRange = { ...nodeRange(info, latentNode, "width", { default: width, min: 64, max: 8192, step }), step: Math.max(step, 8) };
    const heightRange = { ...nodeRange(info, latentNode, "height", { default: height, min: 64, max: 8192, step }), step: Math.max(step, 8) };
    widthRange.min = Math.max(64, Number(widthRange.min) || 0);
    heightRange.min = Math.max(64, Number(heightRange.min) || 0);
    widthRange.default = width;
    heightRange.default = height;
    const countRange = nodeRange(info, latentNode, "batch_size", { default: 1, min: 1, max: 8, step: 1 });
    const frameRange = family.kind === "video" ? nodeRange(info, latentNode, "length", { default: family.frames, min: 1, max: 1000, step: family.frameStep || 1 }) : {};
    if (family.kind === "video") frameRange.default = family.frames;
    const fpsRange = family.kind === "video" ? { ...nodeRange(info, "CreateVideo", "fps", { default: family.fps, min: 1, max: 120, step: 1 }), default: family.fps } : {};
    const negativeMode = variant.negative || family.negative || "text";
    const vpredPatch = Boolean(variant.vpred && !(info2.header && "v_pred" in info2.header));

    fileEntry.supported = true;
    fileEntry.missing = missing.map((item) => item.label);
    if (missing.length) fileEntry.reason = `Needs ${missing.map((item) => item.label).join(", ")}.`;

    const pick = (options, preferred, fallback) => (options.includes(preferred) ? preferred : fallback || options[0] || "");
    const profile = buildProfile({
      id: legacyProfileId(info2.family, source, name) || `${family.kind}:${info2.family}:${source}:${name}`,
      kind: family.kind,
      label: sanaLabel(name) && runner ? sanaLabel(name) : `${prettyModelName(name)} · ${family.label}`,
      displayName: (runner && sanaLabel(name)) || prettyModelName(name),
      description: preset ? `NVIDIA ${preset.label}, downloaded by ComfyUI on first use`
        : diffusersRunner ? `${family.label}${variant.id === "sprint" ? " Sprint" : ""} through ComfyUI-SANA`
        : `${family.label}${family.variants.length > 1 ? ` ${variant.label}` : ""}${source === "checkpoint" ? " checkpoint" : ""}`,
      model: name,
      workflow: `family:${info2.family}`,
      family: info2.family,
      defaults: {
        width, height,
        // The diffusers pipeline's flow DPM-solver needs fewer steps than KSampler's Euler.
        steps: diffusersRunner && variant.id !== "sprint" ? 20 : variant.defaults.steps, cfg: variant.defaults.cfg,
        sampler: pick(samplers, variant.defaults.sampler, samplers.includes("euler") ? "euler" : ""),
        scheduler: pick(schedulers, variant.defaults.scheduler, schedulers.includes("simple") ? "simple" : ""),
        textEncoder: encoderSlots[0]?.default || "",
        vae: bundled.vae ? "" : vaeOptions[0] || "",
        clipType: family.clipType || "",
        weightDtype: weightDtypes.includes("default") ? "default" : weightDtypes[0] || "default",
        denoise: family.img2img ? 0.65 : 1,
        ...(family.kind === "video" ? { frames: family.frames, fps: family.fps } : {})
      },
      aspects: aspectSet({ width, height }, family.aspects, { width: widthRange, height: heightRange }),
      options: { vaes: vaeOptions, samplers, schedulers, loras, weightDtypes },
      constraints: {
        prompt: textMeta, negative: textMeta, width: widthRange, height: heightRange, count: countRange,
        ...(family.kind === "video" ? { frames: frameRange, fps: fpsRange } : {}),
        ...samplerRange
      },
      capabilities: {
        negativePrompt: negativeMode === "text" || negativeMode === "qwen21",
        variations: family.kind === "image" && family.sampling !== "pair",
        textEncoder: encoderSlots.length > 0,
        vae: !family.ownLoaders,
        weightDtype: source === "unet",
        // ComfyUI-SANA runs the whole diffusers pipeline in one node, with its own scheduler.
        ...(diffusersRunner ? { sampler: false, scheduler: false } : {}),
        // ComfyUI's LoRA loader cannot patch a model it did not build.
        lora: canUseLoras && !family.ownLoaders,
        startImage: Boolean(family.img2img || family.startImage),
        denoise: Boolean(family.img2img),
        frames: family.kind === "video",
        fps: family.kind === "video"
      }
    });
    Object.assign(profile, {
      source,
      variant: variant.id,
      variantLabel: variant.label,
      encoderSlots,
      vaeBuiltIn: Boolean(bundled.vae),
      encoderBuiltIn,
      bundledKnown: bundled.known !== false,
      audioVae,
      pairModel,
      vpredPatch,
      detectedBy: info2.via,
      missing,
      ready: missing.length === 0,
      ...(family.sampling === "sana" ? { sana: sanaSettings(info, name, variant, info2.detail, cuda) } : {})
    });
    profiles.push(profile);
  }
  return { profiles, modelFiles, lowNoisePartners };
}

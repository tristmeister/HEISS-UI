import { missingNodes, nodeRange, optionsFor } from './comfy.js';
import { encoderDownloads, families, knownFamilies, sanaConf, sanaPresets, vaeDownloads } from './family-catalog.js';
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

/** Every catalog download HEISS will fetch, by id. The only files the download route accepts. */
export function catalogDownload(id = "") {
  const [kind, key, index] = String(id).split(":");
  const source = kind === "encoder" ? encoderDownloads : kind === "vae" ? vaeDownloads : null;
  const entry = source?.[key]?.[Number(index)];
  if (!entry) return null;
  return { id, folder: kind === "encoder" ? "text_encoders" : "vae", label: entry.file, ...entry };
}

function nodesFor(family, variant, needsEncoderLoader, needsVaeLoader) {
  const nodes = new Set(family.requiredNodes || []);
  if (family.sampling !== "h3") nodes.add(family.latent);
  if (needsEncoderLoader) nodes.add(clipLoaderClass[family.slots.length]);
  if (needsVaeLoader || family.audioVae) nodes.add("VAELoader");
  if (variant.id === "sprint" && family.sampling === "sana") nodes.add("ScmModelSampling");
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
 * How the ExtraModels nodes should load a Sana model. Gemma only runs on CUDA
 * or the CPU there (and only in FP32 on the CPU), so Macs encode on the CPU.
 */
function sanaSettings(name, variant, detail, cuda) {
  return {
    conf: sanaConf(name, detail),
    dtype: variant.dtype || "BF16",
    gemmaDevice: cuda ? "cuda" : "cpu",
    gemmaDtype: cuda ? "BF16" : "default"
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
  // Sana presets are names the ExtraModels loader downloads itself, listed only once that pack is in.
  const sanaNames = new Set(optionsFor(info, "SanaCheckpointLoader", "ckpt_name"));
  const files = [
    ...unets.map((name) => ({ source: "unet", name })),
    ...checkpoints.map((name) => ({ source: "checkpoint", name })),
    ...sanaPresets.filter((preset) => sanaNames.has(preset.name)).map((preset) => ({ source: "sana", name: preset.name, preset }))
  ];
  const lowNoisePartners = new Set();

  for (const { source, name, preset } of files) {
    const info2 = preset
      ? { family: "sana", variant: families.sana.variants.find((item) => !item.match || item.match(name)), via: "preset", bundled: null, detail: null, header: null }
      : classifyModel(source, name);
    const family = families[info2.family];
    const base = String(name).split(/[\\/]/).pop() || name;
    const fileEntry = {
      name, source, family: info2.family, via: info2.via,
      label: familyLabel(info2.family) + (info2.variant && family?.variants.length > 1 ? ` · ${info2.variant.label}` : ""),
      choice: family ? (family.variants.length > 1 ? `${info2.family}/${info2.variant?.id}` : info2.family) : "",
      supported: false, reason: "", missing: []
    };
    if (!preset) modelFiles.push(fileEntry);

    if (!family || !family.sources.includes(source)) {
      fileEntry.reason = knownFamilies[info2.family] && info2.family !== "other"
        ? `${knownFamilies[info2.family]} is not something HEISS can run yet.`
        : "HEISS cannot tell what kind of model this is. Pick it below.";
      continue;
    }
    if (incompatible(name)) {
      fileEntry.reason = "Needs PyTorch 2.8 or newer (NVFP4).";
      continue;
    }

    // Wan 2.2 14B ships as a high-noise/low-noise pair; show one entry, run both.
    let pairModel = "";
    if (family.pair) {
      if (/low[-_ ]?noise/i.test(base)) {
        lowNoisePartners.add(name);
        fileEntry.supported = true;
        fileEntry.reason = "Runs as the second half of its high-noise model.";
        continue;
      }
      const partner = name.replace(/high([-_ ]?)noise/i, (_match, sep) => `low${sep}noise`);
      pairModel = partner !== name && unets.includes(partner) ? partner : "";
    }

    const variant = info2.variant || family.variants.at(-1);
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
      missing.push({ part: "model", label: "Low-noise model", detail: `Wan 2.2 14B also needs the matching low-noise file next to ${base} in diffusion_models.`, downloads: [] });
    }
    const nodes = missingNodes(info, nodesFor(family, variant, !encoderBuiltIn, !bundled.vae));
    if (family.nodePack && nodes.length) {
      const { name: pack, repository } = family.nodePack;
      missing.push({ part: "comfy", label: `${pack} nodes`, detail: `${family.label} runs through the ${pack} custom nodes. Run \`git clone ${repository}\` in ComfyUI/custom_nodes, install its requirements.txt with ComfyUI's Python, then restart ComfyUI.`, downloads: [] });
    } else if (nodes.length || !clipTypeAvailable(info, family)) {
      missing.push({ part: "comfy", label: "Newer ComfyUI", detail: `This ComfyUI cannot run ${family.label} yet${nodes.length ? ` (missing ${nodes.join(", ")})` : ""}. Update ComfyUI.`, downloads: [] });
    }

    const [width, height] = variant.size || family.size;
    const latentNode = family.latent === "MiniMaxH3ImageToVideo" ? "MiniMaxH3ImageToVideo" : family.latent;
    const step = family.sizeStep || 8;
    const widthRange = { ...nodeRange(info, latentNode, "width", { default: width, min: 64, max: 8192, step }), step: Math.max(step, 8) };
    const heightRange = { ...nodeRange(info, latentNode, "height", { default: height, min: 64, max: 8192, step }), step: Math.max(step, 8) };
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
      label: preset ? preset.label : `${prettyModelName(name)} · ${family.label}`,
      displayName: preset ? preset.label : prettyModelName(name),
      description: preset ? `NVIDIA ${preset.label}, downloaded by ComfyUI on first use` : `${family.label}${family.variants.length > 1 ? ` ${variant.label}` : ""}${source === "checkpoint" ? " checkpoint" : ""}`,
      model: name,
      workflow: `family:${info2.family}`,
      family: info2.family,
      defaults: {
        width, height,
        steps: variant.defaults.steps, cfg: variant.defaults.cfg,
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
      ...(family.sampling === "sana" ? { sana: sanaSettings(name, variant, info2.detail, cuda) } : {})
    });
    profiles.push(profile);
  }
  return { profiles, modelFiles, lowNoisePartners };
}

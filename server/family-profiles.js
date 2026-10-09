import fs from 'node:fs';
import path from 'node:path';
import { hasNode, missingNodes, modelFolders, nodeRange, optionsFor } from './comfy.js';
import { MAX_BATCH, checkpointDownloads, encoderDownloads, families, knownFamilies, modelDownloads, quantFormats, sanaConf, sanaLabel, sanaLatentNode, sanaPresets, sanaRunnerFor, vaeDownloads, variantDefaults, visionDownloads, visionKinds } from './family-catalog.js';
import { existingCopy } from './model-downloads.js';
import { inpaintingEnabled } from './features.js';
import { inpaintNodes } from './inpaint.js';
import { ggufEncoderNames, ggufModelNames, isGguf } from './gguf.js';
import { missingPackPart } from './node-install.js';
import { classifyModel, familyLabel, modelFileBytes } from './model-families.js';
import { classifyEncoder, classifyVae, encoderKinds, rankEncoders, rankVaes, vaeKinds } from './model-components.js';

/**
 * Turns every model file ComfyUI lists into a profile the studio can run, from
 * the family catalog: which variant it is, which parts its checkpoint carries,
 * which installed encoders and VAE fill the rest (best first), and exactly what
 * is still missing, with where to get it.
 */

const clipLoaderClass = [null, "CLIPLoader", "DualCLIPLoader", "TripleCLIPLoader", "QuadrupleCLIPLoader"];

/** What a download is called in the queue and the top pill: the part, not its file name. */
function partLabel(kind, key, file) {
  if (kind === "encoder" && encoderKinds[key]) return `${encoderKinds[key].label} text encoder`;
  if (kind === "vae" && vaeKinds[key]) return vaeKinds[key].label;
  if (kind === "vision" && visionKinds[key]) return `${visionKinds[key].label} encoder`;
  return file;
}

/** Who publishes a Hugging Face file: the repo's owner ("Comfy-Org", a community converter). */
export function downloadSource(url = "") {
  const match = /^https:\/\/huggingface\.co\/([^/]+)\/([^/]+)\//.exec(String(url));
  return match ? { source: match[1], repo: `${match[1]}/${match[2]}` } : {};
}

function downloadsFor(list = [], folder, prefix, { apple = false } = {}) {
  const [kind, key] = prefix.split(":");
  return forDevice(list.map((item, index) => withDisk({ id: `${prefix}:${index}`, folder, label: partLabel(kind, key, item.file), ...downloadSource(item.url), ...item })), { apple });
}

/**
 * A part's downloads in the order to offer them. MPS has no float8, and
 * ComfyUI keeps quantized fp8 files (`fp8` in the catalog) in fp8, so on a Mac
 * they fail to load ("Trying to convert Float8_e4m3fn to the MPS backend"):
 * there any other build of the same part goes first. Otherwise the catalog's order.
 */
export function forDevice(downloads, { apple = false } = {}) {
  if (!apple) return downloads;
  return [...downloads].sort((a, b) => Number(Boolean(a.fp8)) - Number(Boolean(b.fp8)));
}

/** `onDisk`: fetched already (even before a restart), ComfyUI just has not listed it yet. */
function withDisk(entry) {
  return existingCopy(entry) ? { ...entry, onDisk: true } : entry;
}

const downloadSources = {
  encoder: [encoderDownloads, "text_encoders"],
  vae: [vaeDownloads, "vae"],
  model: [modelDownloads, "diffusion_models"],
  checkpoint: [checkpointDownloads, "checkpoints"],
  vision: [visionDownloads, "clip_vision"]
};

/** Every catalog download HEISS will fetch, by id. The only files the download route accepts. */
/**
 * Reference slots for a family that reads images as guidance (an edit model).
 * The first is "reference", like every other model's, so remix and drop-to-
 * reference land in it; each further slot shows once the one before is filled.
 */
// ReferenceLatent edits scale, encode and chain each image; an encoder that reads images needs nothing more.
const referenceLatentNodes = ["ImageScaleToTotalPixels", "VAEEncode", "ReferenceLatent", "GetImageSize"];
/**
 * Inpainting needs a family that can take an image in (an edit model's
 * reference, or img2img's start image) through the shared graph, plus the
 * core nodes the crop-and-stitch graph adds (inpaint.js).
 */
const ownGraphs = new Set(["ideogram4", "mage", "h3", "sana", "pair"]);
function canInpaint(family, info, references) {
  if (!inpaintingEnabled) return false;
  if (family.kind !== "image" || ownGraphs.has(family.sampling) || family.ownLoaders) return false;
  if (!references && !family.img2img) return false;
  return inpaintNodes.every((node) => hasNode(info, node));
}

function canReference(family, info) {
  if (!family.references) return false;
  return family.referenceVia === "encoder" || referenceLatentNodes.every((node) => hasNode(info, node));
}

export function referenceSlots(count = 0) {
  return Array.from({ length: Math.max(0, Number(count) || 0) }, (_, index) => ({
    id: index ? `reference_${index + 1}` : "reference",
    kind: "image",
    required: false,
    min: 0,
    max: 1,
    label: index ? `Reference ${index + 1}` : "Reference image",
    role: "reference",
    ...(index ? { follows: index > 1 ? `reference_${index}` : "reference" } : {})
  }));
}

/**
 * One catalog download by id, with the builds listed after it for the same
 * part as `alternatives`: tried in order if this one is gone or gated.
 */
export function catalogDownload(id = "") {
  const [kind, key, index] = String(id).split(":");
  const [source, folder] = downloadSources[kind] || [];
  const list = source && Object.hasOwn(source, key) ? source[key] : [];
  const at = Number(index);
  const entry = Number.isInteger(at) ? list[at] : null;
  if (!entry) return null;
  const spec = (item, position) => ({ id: `${kind}:${key}:${position}`, folder, label: partLabel(kind, key, item.file), ...item });
  return { ...spec(entry, at), alternatives: list.slice(at + 1).map((item, offset) => spec(item, at + 1 + offset)) };
}

/** A part's first download on this device (see forDevice), as catalogDownload gives it. */
export function preferredDownload(kind, key, device = {}) {
  const [source] = downloadSources[kind] || [];
  const list = source && Object.hasOwn(source, key) ? source[key] : [];
  const [first] = forDevice(list.map((item, index) => ({ fp8: item.fp8, index })), device);
  return first ? catalogDownload(`${kind}:${key}:${first.index}`) : null;
}

/**
 * Catalog downloads for one exact file name in one models folder, so a file an
 * imported workflow names gets the same Download button as a family's parts.
 * Only an exact match: a file under a subfolder, or any other build, is not the
 * file the workflow asks for.
 */
export function catalogDownloadsForFile(file = "", folder = "") {
  const found = [];
  for (const [kind, [source, sourceFolder]] of Object.entries(downloadSources)) {
    if (sourceFolder !== folder) continue;
    for (const [key, list] of Object.entries(source)) {
      list.forEach((entry, index) => {
        if (entry.file === file) found.push(withDisk({ id: `${kind}:${key}:${index}`, folder, label: partLabel(kind, key, entry.file), ...downloadSource(entry.url), ...entry }));
      });
    }
  }
  return found;
}

/** The core nodes a family needs; a ComfyUI without one of them gets "Newer ComfyUI" instead of a failed run. */
export function nodesFor(family, variant, needsEncoderLoader, needsVaeLoader) {
  const nodes = new Set(family.requiredNodes || []);
  if (family.sampling !== "h3") nodes.add(family.latent);
  if (needsEncoderLoader) nodes.add(clipLoaderClass[family.slots.length]);
  if (needsVaeLoader || family.audioVae) nodes.add("VAELoader");
  const sampling = variant.modelSampling || family.modelSampling;
  if (sampling) nodes.add(sampling.node);
  if (variant.rawShift) nodes.add("ModelSamplingFlux");
  if (variant.vpred) nodes.add("ModelSamplingDiscrete");
  if (variant.t5Padding || family.t5Padding) nodes.add("T5TokenizerOptions");
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
 * @param helpers { prettyModelName, buildProfile, aspectSet, textMeta, samplerRange, samplers, schedulers, weightDtypes, loras, canUseLoras, incompatible, cuda, apple }
 * cuda / apple: ComfyUI runs on an NVIDIA GPU / on Apple Silicon (MPS).
 */
export function familyProfiles(info, helpers) {
  const { prettyModelName, buildProfile, aspectSet, textMeta, samplerRange, samplers, schedulers, weightDtypes, loras, canUseLoras, incompatible, cuda = false, apple = false } = helpers;
  const device = { apple };
  // GGUF files load through ComfyUI-GGUF's twins of the core loaders (see gguf.js).
  const unets = [...optionsFor(info, "UNETLoader", "unet_name"), ...ggufModelNames(info)];
  const checkpoints = optionsFor(info, "CheckpointLoaderSimple", "ckpt_name");
  const encoderFiles = [...optionsFor(info, "CLIPLoader", "clip_name"), ...ggufEncoderNames(info)].map(classifyEncoder);
  const vaeFiles = optionsFor(info, "VAELoader", "vae_name")
    .filter((name) => !/^(pixel_space|taesd|taesdxl|taesd3|taef1)$/i.test(name))
    .map(classifyVae);
  const visionFiles = optionsFor(info, "CLIPVisionLoader", "clip_name");

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
      label: familyLabel(info2.family) + (info2.variant && family?.variants.length > 1 && !info2.variant.label.includes(family.label) ? ` · ${info2.variant.label}` : ""),
      choice: family ? (family.variants.length > 1 ? `${info2.family}/${info2.variant?.id}` : info2.family) : "",
      supported: false, reason: "", missing: []
    };
    if (!source.startsWith("sana")) modelFiles.push(fileEntry);

    if (!family || !family.sources.includes(source)) {
      fileEntry.reason = knownFamilies[info2.family] && info2.family !== "other"
        ? `${knownFamilies[info2.family]} isn’t supported yet.`
        : "Unknown type. Choose one to use it.";
      continue;
    }
    if (incompatible(name)) {
      fileEntry.reason = "Needs PyTorch 2.8 or newer (NVFP4).";
      continue;
    }
    // A quantized format needs its own loader, whatever the family (or "Use as …") says.
    const quant = info2.quant ? quantFormats[info2.quant] : null;
    const quantLoader = quant?.loaders[source] || "";
    if (quant && !quantLoader) {
      fileEntry.quant = info2.quant;
      fileEntry.reason = quant.reason;
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
          detail: slot.detail || `Any ${encoderKinds[slot.kinds[0]]?.label || slot.label} text encoder in ComfyUI/models/text_encoders works.`,
          downloads: downloadsFor(encoderDownloads[key], "text_encoders", `encoder:${key}`, device)
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
        downloads: downloadsFor(vaeDownloads[key], "vae", `vae:${key}`, device)
      });
    }
    let audioVae = "";
    if (family.audioVae) {
      const audioOptions = rankVaes(vaeFiles, family.audioVae);
      audioVae = audioOptions[0] || "";
      if (!audioVae) {
        const key = family.audioVae[0];
        missing.push({ part: "vae", label: vaeKinds[key].label, kind: key, detail: "H3 decodes its sound with a separate VAE.", downloads: downloadsFor(vaeDownloads[key], "vae", `vae:${key}`, device) });
      }
    }
    // An image-to-video model that also reads its start image with a vision encoder.
    let clipVision = "";
    if (family.clipVision) {
      clipVision = visionFiles.find((file) => family.clipVision.some((kind) => visionKinds[kind]?.test.test(file))) || "";
      if (!clipVision) {
        const key = family.clipVision[0];
        missing.push({ part: "vision", label: `${visionKinds[key].label} encoder`, kind: key, detail: `${family.label} reads the start image with it. Put it in ComfyUI/models/clip_vision.`, downloads: downloadsFor(visionDownloads[key], "clip_vision", `vision:${key}`, device) });
      }
    }
    if (family.pair && !pairModel) {
      const key = family.pair.download?.(base);
      missing.push({ part: "model", label: family.pair.label, detail: family.pair.detail(base), downloads: key ? downloadsFor(modelDownloads[key], "diffusion_models", `model:${key}`, device) : [] });
    }
    const ggufPart = isGguf(name) && missingPackPart(info, "gguf", { detail: "ComfyUI loads GGUF models through the ComfyUI-GGUF custom nodes." });
    if (ggufPart) missing.push(ggufPart);
    const nodes = runner ? [] : missingNodes(info, nodesFor(family, variant, !encoderBuiltIn, !bundled.vae));
    // A family that runs on a custom node pack names it (family.pack, or its runner's); a
    // quantized file, its format's loader pack.
    const needs = runner || family;
    const packPart = (quant && missingPackPart(info, quant.pack, { detail: `This is a ${quant.label} file. ComfyUI reads it through these nodes.` }))
      || (needs.pack && missingPackPart(info, needs.pack, { extra: needs.variantNodes?.[variant.id] || [], detail: needs.note }));
    if (packPart) {
      missing.push(packPart);
    } else if (!packPart && (nodes.length || !clipTypeAvailable(info, family))) {
      missing.push({ part: "comfy", label: "Newer ComfyUI", detail: `This version of ComfyUI can’t run ${family.label} yet${nodes.length ? ` (missing ${nodes.join(", ")})` : ""}. Update ComfyUI, then restart it.`, downloads: [] });
    }
    // What ComfyUI itself lacks comes first: the files are no use until it can run them.
    missing.sort((a, b) => Number(b.part === "comfy") - Number(a.part === "comfy"));

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
    const countRange = nodeRange(info, latentNode, "batch_size", { default: 1, min: 1, max: MAX_BATCH, step: 1 });
    countRange.max = Math.min(MAX_BATCH, Number(countRange.max) || MAX_BATCH);
    const frameRange = family.kind === "video" ? nodeRange(info, latentNode, "length", { default: family.frames, min: 1, max: 1000, step: family.frameStep || 1 }) : {};
    if (family.kind === "video") frameRange.default = family.frames;
    const fpsRange = family.kind === "video" ? { ...nodeRange(info, "CreateVideo", "fps", { default: family.fps, min: 1, max: 120, step: 1 }), default: family.fps } : {};
    const negativeMode = variant.negative || family.negative || "text";
    const vpredPatch = Boolean(variant.vpred && !(info2.header && "v_pred" in info2.header));

    fileEntry.supported = true;
    fileEntry.missing = missing.map((item) => item.label);
    if (missing.length) fileEntry.reason = `Needs ${missing.map((item) => item.label).join(", ")}.`;

    const pick = (options, preferred, fallback) => (options.includes(preferred) ? preferred : fallback || options[0] || "");
    // A runner that samples in its own way (ComfyUI-SANA) sets its own steps and CFG.
    const settings = { ...variantDefaults(variant, name, device), ...(variant.id !== "sprint" ? runner?.defaults : null) };
    const references = canReference(family, info) ? family.references : 0;
    // Image-to-video runs from a picture: one start image, and no run without it.
    const startSlot = family.startImage === "required"
      ? [{ id: "reference", kind: "image", required: true, min: 1, max: 1, label: "Start image", role: "start" }]
      : null;
    const profile = buildProfile({
      mediaInputs: startSlot || referenceSlots(references),
      aspectPolicy: references ? "reference" : "manual",
      id: legacyProfileId(info2.family, source, name) || `${family.kind}:${info2.family}:${source}:${name}`,
      kind: family.kind,
      label: sanaLabel(name) && runner ? sanaLabel(name) : `${prettyModelName(name)} · ${family.label}`,
      displayName: (runner && sanaLabel(name)) || prettyModelName(name),
      description: preset ? `NVIDIA ${preset.label}, downloaded by ComfyUI on first use`
        : diffusersRunner ? `${family.label}${variant.id === "sprint" ? " Sprint" : ""} through ComfyUI-SANA`
        : `${family.variants.length > 1 && !variant.label.includes(family.label) ? `${family.label} ${variant.label}` : family.variants.length > 1 ? variant.label : family.label}${source === "checkpoint" ? " checkpoint" : ""}`,
      model: name,
      workflow: `family:${info2.family}`,
      family: info2.family,
      defaults: {
        width, height,
        steps: settings.steps, cfg: settings.cfg,
        sampler: pick(samplers, settings.sampler, samplers.includes("euler") ? "euler" : ""),
        scheduler: pick(schedulers, settings.scheduler, schedulers.includes("simple") ? "simple" : ""),
        textEncoder: encoderSlots[0]?.default || "",
        vae: bundled.vae ? "" : vaeOptions[0] || "",
        clipType: family.clipType || "",
        weightDtype: weightDtypes.includes("default") ? "default" : weightDtypes[0] || "default",
        denoise: family.img2img ? 0.65 : 1,
        // An edit model rebuilds the painted part from scratch; img2img keeps a little of what was there.
        inpaintStrength: references ? 1 : 0.8,
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
        weightDtype: source === "unet" && !isGguf(name),
        // ComfyUI-SANA runs the whole diffusers pipeline in one node, with its own scheduler.
        ...(diffusersRunner ? { sampler: false, scheduler: false } : {}),
        // ComfyUI's LoRA loader cannot patch a model it did not build.
        lora: canUseLoras && !family.ownLoaders,
        startImage: Boolean(family.img2img || family.startImage),
        startImageRequired: family.startImage === "required",
        denoise: Boolean(family.img2img),
        inpaint: canInpaint(family, info, references),
        frames: family.kind === "video",
        fps: family.kind === "video"
      }
    });
    Object.assign(profile, {
      source,
      familyName: family.label,
      variant: variant.id,
      variantLabel: variant.label,
      encoderSlots,
      vaeBuiltIn: Boolean(bundled.vae),
      encoderBuiltIn,
      bundledKnown: bundled.known !== false,
      audioVae,
      pairModel,
      clipVision,
      vpredPatch,
      ...(quantLoader ? { quant: info2.quant, checkpointLoader: quantLoader } : {}),
      detectedBy: info2.via,
      missing,
      ready: missing.length === 0,
      // For the model menu's quiet size note; 0 when the file is on another computer.
      weightBytes: source.startsWith("sana") ? 0 : modelFileBytes(source, name),
      ...(family.sampling === "sana" ? { sana: sanaSettings(info, name, variant, info2.detail, cuda) } : {})
    });
    profiles.push(profile);
  }
  return { profiles, modelFiles, lowNoisePartners };
}

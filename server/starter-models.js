import { optionsFor } from "./comfy.js";
import { families, starterModels } from "./family-catalog.js";
import { catalogDownload } from "./family-profiles.js";
import { fitsHardware } from "./hardware.js";
import { classifyEncoder, classifyVae, rankEncoders, rankVaes } from "./model-components.js";
import { existingCopy } from "./model-downloads.js";

/**
 * The "pick a first model" plan: every starter version with exactly the files
 * it still needs (text encoders and VAE ComfyUI already has are left out, and
 * a checkpoint carries its own), their sizes, and whether it fits the
 * hardware ComfyUI runs on. The files are ordinary catalog downloads, so they
 * go through the same queue, resume and progress as the setup panel's "Get
 * all". The model file comes last: the studio lists the model only once every
 * part it needs is in place, so it is ready the moment it appears.
 */
export function starterPlan({ hardware = null, info = null, onDisk = existingCopy } = {}) {
  const encoders = info ? optionsFor(info, "CLIPLoader", "clip_name").map(classifyEncoder) : [];
  const vaes = info ? optionsFor(info, "VAELoader", "vae_name").map(classifyVae) : [];
  const listed = new Set(info ? [...optionsFor(info, "UNETLoader", "unet_name"), ...optionsFor(info, "CheckpointLoaderSimple", "ckpt_name")] : []);
  const withDisk = (spec) => ({ ...spec, onDisk: Boolean(onDisk(spec)) });

  return starterModels.map((card) => {
    const versions = card.versions.map((version) => {
      const familyId = version.family || card.family;
      const family = families[familyId];
      const model = catalogDownload(version.model);
      if (!family || !model) throw new Error(`Starter ${card.family}/${version.id} names no catalog file.`);
      const parts = [];
      // A checkpoint carries its text encoders and VAE.
      if (!version.model.startsWith("checkpoint:")) {
        for (const slot of family.slots) {
          if (rankEncoders(encoders, slot).length) continue;
          const spec = catalogDownload(version.encoders?.[slot.slot] || `encoder:${slot.download || slot.kinds[0]}:0`);
          if (spec) parts.push({ ...withDisk(spec), part: "encoder" });
        }
        if (!rankVaes(vaes, family.vae).length) {
          const spec = catalogDownload(`vae:${family.vae[0]}:0`);
          if (spec) parts.push({ ...withDisk(spec), part: "vae" });
        }
      }
      const downloads = [...parts, { ...withDisk(model), part: "model" }]
        .map(({ id, file, folder, label, bytes, url, onDisk: here, part }) => ({ id, file, folder, label, bytes, url, onDisk: here, part }));
      const memoryGB = hardware?.unified && version.appleMemory ? version.appleMemory : version.memory;
      return {
        id: version.id,
        family: familyId,
        label: version.label,
        // On a Mac an fp8 file loads at full precision: it saves download, not memory.
        detail: hardware?.unified && version.appleDetail ? version.appleDetail : version.detail,
        memoryGB,
        ...(version.ram ? { ramGB: version.ram } : {}),
        fp8: Boolean(version.fp8),
        file: model.file,
        downloads,
        totalBytes: downloads.reduce((sum, item) => sum + (item.bytes || 0), 0),
        remainingBytes: downloads.reduce((sum, item) => sum + (item.onDisk ? 0 : item.bytes || 0), 0),
        installed: listed.has(model.file) || downloads.at(-1).onDisk,
        fits: fitsHardware(hardware, { memoryGB, ramGB: version.ram || 0 })
      };
    });
    return { family: card.family, title: card.title, blurb: card.blurb, versions, best: bestVersion(versions, hardware) };
  });
}

/**
 * The largest version that fits. On a Mac an fp8 file takes the memory of the
 * full-precision one, so a tie there goes to the version that is not fp8;
 * otherwise to the one listed first.
 */
export function bestVersion(versions, hardware) {
  const fitting = versions.filter((version) => version.fits);
  if (!fitting.length) return null;
  const top = Math.max(...fitting.map((version) => version.memoryGB));
  const tied = fitting.filter((version) => version.memoryGB === top);
  return (hardware?.unified ? tied.find((version) => !version.fp8) : null)?.id || tied[0].id;
}

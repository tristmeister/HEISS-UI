/**
 * Every ComfyUI custom node pack HEISS knows how to ask for. A model family,
 * a runner or a feature names its pack by id; setup panels then offer the same
 * two routes for all of them (ComfyUI-Manager's Git URL install, or one
 * terminal command) and notice by themselves when the nodes arrive.
 *
 * id: { name, repository, folder (its custom_nodes folder), nodes (classes
 *       that prove it is loaded), search (optional: what finds it in
 *       Manager's node list), manager (optional: its id there, so one click
 *       can queue the install in Manager), note (optional, one line for the
 *       panel) }
 */
export const nodePacks = {
  seedvr2: {
    name: "SeedVR2 Video Upscaler",
    repository: "https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git",
    folder: "ComfyUI-SeedVR2_VideoUpscaler",
    search: "SeedVR2",
    manager: "seedvr2_videoupscaler",
    nodes: ["SeedVR2LoadDiTModel", "SeedVR2LoadVAEModel", "SeedVR2VideoUpscaler"]
  },
  extramodels: {
    name: "ComfyUI_ExtraModels",
    // NVIDIA's own Sana docs point at this fork; the city96 original in Manager's list lacks Sprint.
    repository: "https://github.com/lawrence-cj/ComfyUI_ExtraModels.git",
    folder: "ComfyUI_ExtraModels",
    nodes: ["SanaCheckpointLoader", "GemmaLoader", "SanaTextEncode", "GemmaTextEncode", "ExtraVAELoader"],
    note: "Install it by Git URL: Manager's search finds the older city96 original."
  },
  impactpack: {
    name: "ComfyUI Impact Pack",
    repository: "https://github.com/ltdrdata/ComfyUI-Impact-Pack.git",
    folder: "ComfyUI-Impact-Pack",
    search: "Impact Pack",
    manager: "comfyui-impact-pack",
    nodes: ["FaceDetailer", "SAMLoader"]
  },
  impactsubpack: {
    name: "ComfyUI Impact Subpack",
    repository: "https://github.com/ltdrdata/ComfyUI-Impact-Subpack.git",
    folder: "ComfyUI-Impact-Subpack",
    search: "Impact Subpack",
    manager: "comfyui-impact-subpack",
    nodes: ["UltralyticsDetectorProvider"]
  },
  comfyui_sana: {
    name: "ComfyUI-SANA",
    repository: "https://github.com/geoffitect/ComfyUI-SANA.git",
    folder: "ComfyUI-SANA",
    nodes: ["SanaModelLoader", "SanaGenerate"]
  }
};

export function nodePack(id) {
  const pack = nodePacks[id];
  if (!pack) throw new Error(`Unknown node pack: ${id}`);
  return { id, ...pack };
}

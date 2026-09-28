/**
 * Every ComfyUI custom node pack HEISS knows how to ask for. A model family,
 * a runner or a feature names its pack by id; setup panels then offer the same
 * two routes for all of them (ComfyUI-Manager's Git URL install, or one
 * terminal command) and notice by themselves when the nodes arrive.
 *
 * id: { name, repository, folder (its custom_nodes folder), nodes (classes
 *       that prove it is loaded), commit and ref (the reviewed version HEISS
 *       installs, see below), search (optional: what finds it in Manager's
 *       node list), manager (optional: its id there, so one click can queue
 *       the install in Manager), note (optional, one line for the panel) }
 *
 * commit pins the exact code a one-click install clones: a pack's moving
 * branch could change under us, and whatever lands in custom_nodes runs with
 * ComfyUI's rights. It is the latest tagged release where the pack tags them,
 * else the default branch as it was when reviewed; `ref` says which, for
 * people reading the install panel. Moving to a newer version is a reviewed
 * change here, never automatic. Last reviewed 2026-09-28.
 */
export const nodePacks = {
  seedvr2: {
    name: "SeedVR2 Video Upscaler",
    repository: "https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git",
    folder: "ComfyUI-SeedVR2_VideoUpscaler",
    commit: "5a4bf428f3735cc72ac760d40f372f94dec28422",
    ref: "v2.5.23",
    search: "SeedVR2",
    manager: "seedvr2_videoupscaler",
    nodes: ["SeedVR2LoadDiTModel", "SeedVR2LoadVAEModel", "SeedVR2VideoUpscaler"]
  },
  extramodels: {
    name: "ComfyUI_ExtraModels",
    // NVIDIA's own Sana docs point at this fork; the city96 original in Manager's list lacks Sprint.
    repository: "https://github.com/lawrence-cj/ComfyUI_ExtraModels.git",
    folder: "ComfyUI_ExtraModels",
    commit: "09e895cf35384979e0bb9a1ea01fe8f3db913516",
    ref: "main, 2025-06-06",
    nodes: ["SanaCheckpointLoader", "GemmaLoader", "SanaTextEncode", "GemmaTextEncode", "ExtraVAELoader"],
    note: "Install it by Git URL: Manager's search finds the older city96 original."
  },
  impactpack: {
    name: "ComfyUI Impact Pack",
    repository: "https://github.com/ltdrdata/ComfyUI-Impact-Pack.git",
    folder: "ComfyUI-Impact-Pack",
    commit: "ba09fbc4c05688667e7bfda35823933c9fe09196",
    ref: "8.28",
    search: "Impact Pack",
    manager: "comfyui-impact-pack",
    nodes: ["FaceDetailer", "SAMLoader"]
  },
  impactsubpack: {
    name: "ComfyUI Impact Subpack",
    repository: "https://github.com/ltdrdata/ComfyUI-Impact-Subpack.git",
    folder: "ComfyUI-Impact-Subpack",
    commit: "5b4e55058ae48e18e1c6d974000461ad1e240135",
    ref: "1.3.4",
    search: "Impact Subpack",
    manager: "comfyui-impact-subpack",
    nodes: ["UltralyticsDetectorProvider"]
  },
  comfyui_sana: {
    name: "ComfyUI-SANA",
    repository: "https://github.com/geoffitect/ComfyUI-SANA.git",
    folder: "ComfyUI-SANA",
    commit: "f515a0c807604fe755b5a5d2826488420402d193",
    ref: "master, 2026-06-25",
    nodes: ["SanaModelLoader", "SanaGenerate"]
  }
};

export function nodePack(id) {
  const pack = nodePacks[id];
  if (!pack) throw new Error(`Unknown node pack: ${id}`);
  return { id, ...pack };
}

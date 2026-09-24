/**
 * Every model family HEISS can run, as data: how to recognise its weights, which
 * text encoders and VAE it needs, how its graph is shaped, and the settings its
 * makers ship. Values come from Comfy-Org's own workflow templates and the model
 * cards; key signatures mirror ComfyUI's comfy/model_detection.py, checked in the
 * same order so the same file is never read two ways.
 */

const hf = (repo, file) => `https://huggingface.co/${repo}/resolve/main/${file}`;

/* ------------------------------------------------------------ Downloads */

// Where to get each part. The first entry is what a Download button fetches;
// abliterated builds lead wherever a ComfyUI-ready one exists.
export const encoderDownloads = {
  clip_l: [{ file: "clip_l.safetensors", url: hf("comfyanonymous/flux_text_encoders", "clip_l.safetensors"), bytes: 246_144_152 }],
  clip_g: [{ file: "clip_g.safetensors", url: hf("Comfy-Org/stable-diffusion-3.5-fp8", "text_encoders/clip_g.safetensors") }],
  t5xl: [{ file: "pony-v7-pile-t5xl.fp16.safetensors", url: hf("purplesmartai/pony-v7-base", "text_encoder/model.fp16.safetensors") }],
  t5xxl: [
    { file: "t5xxl_fp8_e4m3fn_scaled.safetensors", url: hf("comfyanonymous/flux_text_encoders", "t5xxl_fp8_e4m3fn_scaled.safetensors") },
    { file: "t5xxl_fp16.safetensors", url: hf("comfyanonymous/flux_text_encoders", "t5xxl_fp16.safetensors") }
  ],
  umt5xxl: [{ file: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", url: hf("Comfy-Org/Wan_2.1_ComfyUI_repackaged", "split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors") }],
  byt5_glyph: [{ file: "byt5_small_glyphxl_fp16.safetensors", url: hf("Comfy-Org/HunyuanVideo_1.5_repackaged", "split_files/text_encoders/byt5_small_glyphxl_fp16.safetensors") }],
  qwen3_06b: [{ file: "qwen_3_06b_base.safetensors", url: hf("circlestone-labs/Anima", "split_files/text_encoders/qwen_3_06b_base.safetensors") }],
  // "Heretic" builds are abliterated with the Heretic tool; DreamFast and ethanfel
  // ship them converted for ComfyUI's single-file loaders.
  qwen3_4b: [
    { file: "qwen3-4b-heretic_fp8_e4m3fn.safetensors", url: hf("DreamFast/qwen3-4b-heretic", "comfyui/qwen3-4b-heretic_fp8_e4m3fn.safetensors"), bytes: 4_410_000_000 },
    { file: "qwen_3_4b.safetensors", url: hf("Comfy-Org/z_image_turbo", "split_files/text_encoders/qwen_3_4b.safetensors") }
  ],
  qwen3_8b: [
    { file: "qwen3-8b-heretic_fp8_e4m3fn.safetensors", url: hf("DreamFast/qwen3-8b-heretic", "comfyui/qwen3-8b-heretic_fp8_e4m3fn.safetensors"), bytes: 9_440_000_000 },
    { file: "qwen_3_8b_fp8mixed.safetensors", url: hf("Comfy-Org/flux2-klein-9B", "split_files/text_encoders/qwen_3_8b_fp8mixed.safetensors") }
  ],
  qwen3vl_4b: [
    { file: "qwen3-vl-4b-heretic_fp8_e4m3fn.safetensors", url: hf("DreamFast/Qwen3-VL-4b-Heretic-ComfyUI", "qwen3-vl-4b-heretic_fp8_e4m3fn.safetensors"), bytes: 4_830_000_000 },
    { file: "qwen3vl_4b_fp8_scaled.safetensors", url: hf("Comfy-Org/Krea-2", "text_encoders/qwen3vl_4b_fp8_scaled.safetensors") }
  ],
  qwen3vl_8b: [
    { file: "qwen3-vl-8b-heretic-1.3.0_fp8_e4m3fn.safetensors", url: hf("DreamFast/Qwen3-VL-8B-Heretic-1.3.0", "comfyui/qwen3-vl-8b-heretic-1.3.0_fp8_e4m3fn.safetensors"), bytes: 10_020_000_000 },
    { file: "qwen3vl_8b_int8_convrot.safetensors", url: hf("Comfy-Org/Qwen-Image-2.1", "text_encoders/qwen3vl_8b_int8_convrot.safetensors") }
  ],
  qwen3vl_32b: [
    { file: "qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot.safetensors", url: hf("ethanfel/Qwen3-VL-32B-Ultra-Heretic-H3-ComfyUI-INT8-ConvRot", "qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot.safetensors"), bytes: 26_360_000_000 },
    { file: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", url: hf("Comfy-Org/MiniMax-H3", "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors") }
  ],
  qwen25vl_7b: [
    { file: "qwen_2.5_vl_7b_huihui_abliterated_int8_convrot.safetensors", url: hf("ethanfel/Qwen2.5-VL-7B-Huihui-Abliterated-ComfyUI-ConvRot-INT8", "qwen_2.5_vl_7b_huihui_abliterated_int8_convrot.safetensors"), bytes: 10_060_000_000 },
    { file: "qwen_2.5_vl_7b_fp8_scaled.safetensors", url: hf("Comfy-Org/Qwen-Image_ComfyUI", "split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors") }
  ],
  mistral3_24b: [{ file: "mistral_3_small_flux2_bf16.safetensors", url: hf("Comfy-Org/flux2-dev", "split_files/text_encoders/mistral_3_small_flux2_bf16.safetensors") }],
  llama31_8b: [{ file: "llama_3.1_8b_instruct_fp8_scaled.safetensors", url: hf("Comfy-Org/HiDream-I1_ComfyUI", "split_files/text_encoders/llama_3.1_8b_instruct_fp8_scaled.safetensors") }],
  ministral3_3b: [{ file: "ministral-3-3b.safetensors", url: hf("Comfy-Org/ERNIE-Image", "text_encoders/ministral-3-3b.safetensors") }],
  gemma2_2b: [{ file: "gemma_2_2b_fp16.safetensors", url: hf("Comfy-Org/Lumina_Image_2.0_Repackaged", "split_files/text_encoders/gemma_2_2b_fp16.safetensors") }],
  hidream_clip_l: [{ file: "clip_l_hidream.safetensors", url: hf("Comfy-Org/HiDream-I1_ComfyUI", "split_files/text_encoders/clip_l_hidream.safetensors") }],
  hidream_clip_g: [{ file: "clip_g_hidream.safetensors", url: hf("Comfy-Org/HiDream-I1_ComfyUI", "split_files/text_encoders/clip_g_hidream.safetensors") }]
};

export const vaeDownloads = {
  sd15: [{ file: "vae-ft-mse-840000-ema-pruned.safetensors", url: hf("stabilityai/sd-vae-ft-mse-original", "vae-ft-mse-840000-ema-pruned.safetensors") }],
  sdxl: [{ file: "sdxl_vae.safetensors", url: hf("stabilityai/sdxl-vae", "sdxl_vae.safetensors") }],
  flux1: [{ file: "ae.safetensors", url: hf("Comfy-Org/Lumina_Image_2.0_Repackaged", "split_files/vae/ae.safetensors") }],
  // SD3.5's VAE only ships inside its checkpoints or Stability's gated repo.
  sd3: [],
  aura: [{ file: "pony-v7-vae.fp16.safetensors", url: hf("purplesmartai/pony-v7-base", "vae/diffusion_pytorch_model.fp16.safetensors") }],
  flux2: [{ file: "flux2-vae.safetensors", url: hf("Comfy-Org/flux2-dev", "split_files/vae/flux2-vae.safetensors") }],
  wan21: [{ file: "wan_2.1_vae.safetensors", url: hf("Comfy-Org/Wan_2.1_ComfyUI_repackaged", "split_files/vae/wan_2.1_vae.safetensors") }],
  wan22: [{ file: "wan2.2_vae.safetensors", url: hf("Comfy-Org/Wan_2.2_ComfyUI_Repackaged", "split_files/vae/wan2.2_vae.safetensors") }],
  qwen_image: [{ file: "qwen_image_vae.safetensors", url: hf("Comfy-Org/Qwen-Image_ComfyUI", "split_files/vae/qwen_image_vae.safetensors") }],
  qwen_image_21: [{ file: "qwen_image_2.1_vae_bf16.safetensors", url: hf("Comfy-Org/Qwen-Image-2.1", "vae/qwen_image_2.1_vae_bf16.safetensors") }],
  hunyuan15: [{ file: "hunyuanvideo15_vae_fp16.safetensors", url: hf("Comfy-Org/HunyuanVideo_1.5_repackaged", "split_files/vae/hunyuanvideo15_vae_fp16.safetensors") }],
  h3_video: [{ file: "minimax_h3_video_vae_int8_convrot.safetensors", url: hf("Comfy-Org/MiniMax-H3", "vae/minimax_h3_video_vae_int8_convrot.safetensors") }],
  h3_audio: [{ file: "minimax_h3_audio_vae_fp32.safetensors", url: hf("Comfy-Org/MiniMax-H3", "vae/minimax_h3_audio_vae_fp32.safetensors") }],
  mage_flow: [{ file: "mage_flow_vae_bf16.safetensors", url: hf("Comfy-Org/Mage-Flow", "vae/mage_flow_vae_bf16.safetensors") }]
};

// Second model files a family runs next to the one you pick (see `pair`).
export const modelDownloads = {
  ideogram4_uncond_fp8: [{ file: "ideogram4_unconditional_fp8_scaled.safetensors", url: hf("Comfy-Org/Ideogram-4", "diffusion_models/ideogram4_unconditional_fp8_scaled.safetensors") }],
  ideogram4_uncond_int8: [{ file: "ideogram4_unconditional_int8_convrot.safetensors", url: hf("Comfy-Org/Ideogram-4", "diffusion_models/ideogram4_unconditional_int8_convrot.safetensors") }]
};

/* ------------------------------------------------------------ Families */

const square = [["1:1", 1, 1], ["16:9", 16, 9], ["9:16", 9, 16], ["4:3", 4, 3], ["3:4", 3, 4], ["2.35:1", 235, 100]];
const portraitFirst = [["2:3", 2, 3], ["1:1", 1, 1], ["3:2", 3, 2], ["16:9", 16, 9], ["9:16", 9, 16], ["4:3", 4, 3], ["3:4", 3, 4]];
const wide = [["16:9", 16, 9], ["9:16", 9, 16], ["1:1", 1, 1], ["4:3", 4, 3], ["3:4", 3, 4], ["2.35:1", 235, 100]];

const speedName = /lightning|dmd2?|hyper|turbo|lcm|pcm|\d+[-_ ]?steps?|tcd|flash/i;

/**
 * slots: text encoder inputs in loader order. kinds: accepted encoder kinds.
 * vae: accepted VAE kinds (first is the one to download). sampling: "ksampler",
 * "custom" (SamplerCustomAdvanced), "pair" (Wan 2.2 14B), "h3", "sana",
 * "ideogram4" (two models through a dual guider), "mage" (its own encode node).
 * pair: a second model file the family runs next to the picked one (see pairSpec).
 * promptPrefix / negativePrefix: system text the model was trained to see first.
 * pack: a node-packs.js id when the family runs on custom nodes. ownLoaders:
 * the pack loads encoder and VAE itself (no pickers, no LoRAs).
 * variants: first whose `match` passes wins; the last one is the fallback.
 * MODELS.md walks through adding a family.
 */
export const families = {
  sd15: {
    label: "SD 1.5", kind: "image", sources: ["checkpoint", "unet"],
    slots: [{ slot: "clip", label: "CLIP-L", kinds: ["clip_l"] }], clipType: "stable_diffusion",
    vae: ["sd15"], latent: "EmptyLatentImage", sizeStep: 8, negative: "text", img2img: true,
    aspects: portraitFirst, clipSkip: (name) => (/anything|nai|counterfeit|meina|abyss|anime/i.test(name) ? -2 : 0),
    variants: [
      { id: "fast", label: "Fast (LCM/Lightning)", match: (name) => speedName.test(name), defaults: { steps: 6, cfg: 1.5, sampler: "lcm", scheduler: "sgm_uniform" } },
      { id: "standard", label: "SD 1.5", defaults: { steps: 25, cfg: 7, sampler: "dpmpp_2m", scheduler: "karras" } }
    ],
    size: [512, 512]
  },
  sd2: {
    label: "SD 2.x", kind: "image", sources: ["checkpoint"],
    slots: [{ slot: "clip", label: "CLIP-H", kinds: ["clip_h"] }], clipType: "stable_diffusion",
    vae: ["sd15"], latent: "EmptyLatentImage", sizeStep: 8, negative: "text", img2img: true, aspects: square,
    variants: [{ id: "standard", label: "SD 2.x", defaults: { steps: 25, cfg: 7, sampler: "dpmpp_2m", scheduler: "karras" } }],
    size: [768, 768]
  },
  sdxl: {
    label: "SDXL", kind: "image", sources: ["checkpoint", "unet"],
    slots: [{ slot: "clip_l", label: "CLIP-L", kinds: ["clip_l"] }, { slot: "clip_g", label: "CLIP-G", kinds: ["clip_g"] }], clipType: "sdxl",
    vae: ["sdxl"], latent: "EmptyLatentImage", sizeStep: 8, negative: "text", img2img: true, aspects: portraitFirst,
    // Pony, Illustrious and NoobAI descend from NovelAI-style training on the
    // penultimate CLIP layer; speed merges of them keep that need.
    clipSkip: (name) => (/pony|pdxl|autismmix|illustrious|noob|ilxl/i.test(name) ? -2 : 0),
    variants: [
      { id: "turbo", label: "SDXL Turbo", match: (name) => /sd_?xl_?turbo|sdxlturbo/i.test(name), size: [512, 512], defaults: { steps: 1, cfg: 1, sampler: "euler_ancestral", scheduler: "normal" } },
      { id: "hyper", label: "Hyper", match: (name) => /hyper/i.test(name), defaults: { steps: 8, cfg: 1, sampler: "ddim", scheduler: "sgm_uniform" } },
      { id: "dmd2", label: "DMD2", match: (name) => /dmd/i.test(name), defaults: { steps: 8, cfg: 1, sampler: "lcm", scheduler: "sgm_uniform" } },
      { id: "lcm", label: "LCM", match: (name) => /lcm|pcm|tcd/i.test(name), defaults: { steps: 6, cfg: 1.5, sampler: "lcm", scheduler: "sgm_uniform" } },
      { id: "lightning", label: "Lightning", match: (name) => /lightning|turbo|\d+[-_ ]?steps?/i.test(name), defaults: { steps: 6, cfg: 1, sampler: "euler", scheduler: "sgm_uniform" } },
      // NoobAI v-pred merges often lack the v_pred key ComfyUI looks for, so HEISS sets the mode itself.
      { id: "vpred", label: "V-prediction", match: (name, header) => Boolean(header && "v_pred" in header) || /v[-_ ]?pred/i.test(name), vpred: true, defaults: { steps: 30, cfg: 4.5, sampler: "euler", scheduler: "normal" } },
      { id: "pony", label: "Pony", match: (name) => /pony|pdxl|autismmix/i.test(name), defaults: { steps: 25, cfg: 7, sampler: "euler_ancestral", scheduler: "normal" } },
      { id: "anime", label: "Illustrious / NoobAI", match: (name) => /illustrious|noob|ilxl|wai[-_]?nsfw|animagine/i.test(name), defaults: { steps: 28, cfg: 5, sampler: "euler_ancestral", scheduler: "normal" } },
      { id: "standard", label: "SDXL", defaults: { steps: 25, cfg: 7, sampler: "dpmpp_2m", scheduler: "karras" } }
    ],
    size: [1024, 1024]
  },
  auraflow: {
    label: "Pony V7 / AuraFlow", kind: "image", sources: ["checkpoint", "unet"],
    slots: [{ slot: "t5", label: "Pile T5-XL", kinds: ["t5xl"] }], clipType: "stable_diffusion",
    vae: ["aura", "sdxl"], latent: "EmptyLatentImage", sizeStep: 16, negative: "text", img2img: true, aspects: portraitFirst,
    variants: [{ id: "standard", label: "Pony V7", defaults: { steps: 30, cfg: 3.5, sampler: "euler", scheduler: "simple" } }],
    size: [1024, 1024]
  },
  sd3: {
    label: "SD 3.5", kind: "image", sources: ["checkpoint", "unet"],
    slots: [
      { slot: "clip_l", label: "CLIP-L", kinds: ["clip_l"] },
      { slot: "clip_g", label: "CLIP-G", kinds: ["clip_g"] },
      { slot: "t5", label: "T5-XXL", kinds: ["t5xxl"] }
    ], clipType: null,
    vae: ["sd3"], latent: "EmptySD3LatentImage", sizeStep: 16, negative: "text", img2img: true, aspects: square,
    variants: [
      { id: "turbo", label: "Turbo", match: (name) => /turbo/i.test(name), defaults: { steps: 4, cfg: 1.2, sampler: "euler", scheduler: "sgm_uniform" } },
      { id: "standard", label: "SD 3.5", defaults: { steps: 20, cfg: 4, sampler: "euler", scheduler: "sgm_uniform" } }
    ],
    size: [1024, 1024]
  },
  flux1: {
    label: "Flux.1", kind: "image", sources: ["unet", "checkpoint"],
    slots: [{ slot: "clip_l", label: "CLIP-L", kinds: ["clip_l"] }, { slot: "t5", label: "T5-XXL", kinds: ["t5xxl"] }], clipType: "flux",
    vae: ["flux1"], latent: "EmptySD3LatentImage", sizeStep: 16, negative: "zero", img2img: true, aspects: square,
    variants: [
      { id: "schnell", label: "Schnell", match: (name, header, detail) => detail?.schnell === true || (detail?.schnell === undefined && /schnell/i.test(name)), defaults: { steps: 4, cfg: 1, sampler: "euler", scheduler: "simple" } },
      // De-distilled fine-tunes trade Flux guidance back for real CFG, so the negative prompt works again.
      { id: "dedistilled", label: "De-distilled", match: (name) => /de[-_ ]?distill/i.test(name), negative: "text", defaults: { steps: 28, cfg: 3, sampler: "euler", scheduler: "simple" } },
      { id: "fast", label: "Dev, fast", match: (name) => speedName.test(name), guidance: 3.5, defaults: { steps: 8, cfg: 1, sampler: "euler", scheduler: "simple" } },
      { id: "dev", label: "Dev", guidance: 3.5, defaults: { steps: 20, cfg: 1, sampler: "euler", scheduler: "simple" } }
    ],
    size: [1024, 1024]
  },
  flux2_dev: {
    label: "Flux.2 Dev", kind: "image", sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "Mistral 3 Small", kinds: ["mistral3_24b"] }], clipType: "flux2",
    vae: ["flux2"], latent: "EmptyFlux2LatentImage", sizeStep: 16, negative: "none", sampling: "custom", scheduler: "flux2", aspects: square,
    requiredNodes: ["EmptyFlux2LatentImage", "Flux2Scheduler", "SamplerCustomAdvanced", "BasicGuider", "FluxGuidance"],
    variants: [
      { id: "fast", label: "Fast", match: (name) => speedName.test(name), guidance: 4, defaults: { steps: 8, cfg: 1, sampler: "euler", scheduler: "simple" } },
      { id: "dev", label: "Dev", guidance: 4, defaults: { steps: 28, cfg: 1, sampler: "euler", scheduler: "simple" } }
    ],
    size: [1024, 1024]
  },
  flux2_klein_4b: {
    label: "Flux.2 Klein 4B", kind: "image", sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "Qwen3 4B", kinds: ["qwen3_4b"] }], clipType: "flux2",
    vae: ["flux2"], latent: "EmptyFlux2LatentImage", sizeStep: 16, sampling: "custom", scheduler: "flux2", aspects: square,
    requiredNodes: ["EmptyFlux2LatentImage", "Flux2Scheduler", "SamplerCustomAdvanced", "CFGGuider"],
    variants: [
      { id: "base", label: "Base", match: (name) => /base/i.test(name) && !speedName.test(name), negative: "text", defaults: { steps: 20, cfg: 5, sampler: "euler", scheduler: "simple" } },
      { id: "distilled", label: "Distilled", negative: "zero", defaults: { steps: 4, cfg: 1, sampler: "euler", scheduler: "simple" } }
    ],
    size: [1024, 1024]
  },
  flux2_klein_9b: {
    label: "Flux.2 Klein 9B", kind: "image", sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "Qwen3 8B", kinds: ["qwen3_8b"] }], clipType: "flux2",
    vae: ["flux2"], latent: "EmptyFlux2LatentImage", sizeStep: 16, sampling: "custom", scheduler: "flux2", aspects: square,
    requiredNodes: ["EmptyFlux2LatentImage", "Flux2Scheduler", "SamplerCustomAdvanced", "CFGGuider"],
    variants: [
      { id: "base", label: "Base", match: (name) => /base/i.test(name) && !speedName.test(name), negative: "text", defaults: { steps: 20, cfg: 5, sampler: "euler", scheduler: "simple" } },
      { id: "distilled", label: "Distilled", negative: "zero", defaults: { steps: 4, cfg: 1, sampler: "euler", scheduler: "simple" } }
    ],
    size: [1024, 1024]
  },
  chroma: {
    label: "Chroma", kind: "image", sources: ["unet", "checkpoint"],
    slots: [{ slot: "t5", label: "T5-XXL", kinds: ["t5xxl"] }], clipType: "chroma", t5Padding: true,
    vae: ["flux1"], latent: "EmptySD3LatentImage", sizeStep: 16, negative: "text", img2img: true, aspects: square,
    modelSampling: { node: "ModelSamplingAuraFlow", shift: 1 },
    variants: [
      { id: "fast", label: "Fast", match: (name) => speedName.test(name), defaults: { steps: 10, cfg: 1, sampler: "euler", scheduler: "beta" } },
      { id: "standard", label: "Chroma", defaults: { steps: 26, cfg: 3.5, sampler: "euler", scheduler: "beta" } }
    ],
    size: [1024, 1024]
  },
  hidream: {
    label: "HiDream I1", kind: "image", sources: ["unet", "checkpoint"], neverBundledEncoder: true,
    slots: [
      { slot: "clip_l", label: "CLIP-L (HiDream)", kinds: ["clip_l"], prefer: /hidream/i, download: "hidream_clip_l" },
      { slot: "clip_g", label: "CLIP-G (HiDream)", kinds: ["clip_g"], prefer: /hidream/i, download: "hidream_clip_g" },
      { slot: "t5", label: "T5-XXL", kinds: ["t5xxl"] },
      { slot: "llama", label: "Llama 3.1 8B", kinds: ["llama31_8b"] }
    ], clipType: null,
    vae: ["flux1"], latent: "EmptySD3LatentImage", sizeStep: 16, img2img: true, aspects: square,
    variants: [
      { id: "fast", label: "Fast", match: (name) => /fast/i.test(name), negative: "text", modelSampling: { node: "ModelSamplingSD3", shift: 3 }, defaults: { steps: 16, cfg: 1, sampler: "lcm", scheduler: "normal" } },
      { id: "dev", label: "Dev", match: (name) => /dev/i.test(name), negative: "text", modelSampling: { node: "ModelSamplingSD3", shift: 6 }, defaults: { steps: 28, cfg: 1, sampler: "lcm", scheduler: "normal" } },
      { id: "full", label: "Full", negative: "text", modelSampling: { node: "ModelSamplingSD3", shift: 3 }, defaults: { steps: 50, cfg: 5, sampler: "uni_pc", scheduler: "simple" } }
    ],
    size: [1024, 1024]
  },
  qwen_image: {
    label: "Qwen-Image", kind: "image", sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "Qwen2.5-VL 7B", kinds: ["qwen25vl_7b"] }], clipType: "qwen_image",
    vae: ["qwen_image", "wan21"], latent: "EmptySD3LatentImage", sizeStep: 16, img2img: true, aspects: square,
    modelSampling: { node: "ModelSamplingAuraFlow", shift: 3.1 },
    variants: [
      { id: "fast", label: "Lightning", match: (name) => speedName.test(name), negative: "text", defaults: { steps: 8, cfg: 1, sampler: "euler", scheduler: "simple" } },
      { id: "2512", label: "Qwen-Image 2512", match: (name) => /2512/.test(name), negative: "text", defaults: { steps: 50, cfg: 4, sampler: "euler", scheduler: "simple" } },
      { id: "standard", label: "Qwen-Image", negative: "text", defaults: { steps: 20, cfg: 2.5, sampler: "euler", scheduler: "simple" } }
    ],
    size: [1328, 1328]
  },
  qwen_image_21: {
    label: "Qwen-Image 2.1", kind: "image", sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "Qwen3-VL 8B", kinds: ["qwen3vl_8b"] }], clipType: "qwen_image",
    vae: ["qwen_image_21"], latent: "EmptyLatentImage", sizeStep: 32, negative: "qwen21", aspects: square,
    requiredNodes: ["TextEncodeQwenImage21"],
    variants: [{ id: "standard", label: "Qwen-Image 2.1", defaults: { steps: 25, cfg: 1, sampler: "euler", scheduler: "simple" } }],
    size: [1024, 1024]
  },
  zimage: {
    label: "Z-Image", kind: "image", sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "Qwen3 4B", kinds: ["qwen3_4b"] }], clipType: "lumina2",
    vae: ["flux1"], latent: "EmptySD3LatentImage", sizeStep: 16, negative: "text", img2img: true, aspects: square,
    variants: [
      { id: "base", label: "Base", match: (name) => isZImageBase(name), defaults: { steps: 30, cfg: 4, sampler: "res_multistep", scheduler: "simple" } },
      { id: "turbo", label: "Turbo", defaults: { steps: 8, cfg: 1, sampler: "res_multistep", scheduler: "simple" } }
    ],
    size: [1024, 1024]
  },
  krea2: {
    label: "Krea 2", kind: "image", sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "Qwen3-VL 4B", kinds: ["qwen3vl_4b"] }], clipType: "krea2",
    vae: ["qwen_image"], latent: "EmptyLatentImage", sizeStep: 16, negative: "text", img2img: true, aspects: square, enhancer: true,
    variants: [
      { id: "raw", label: "Raw", match: (name) => isKrea2Raw(name), rawShift: true, defaults: { steps: 28, cfg: 4.5, sampler: "euler", scheduler: "simple" } },
      { id: "turbo", label: "Turbo", defaults: { steps: 8, cfg: 1, sampler: "euler", scheduler: "simple" } }
    ],
    size: [1024, 1024]
  },
  anima: {
    label: "Anima", kind: "image", sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "Qwen3 0.6B", kinds: ["qwen3_06b"] }], clipType: "stable_diffusion",
    vae: ["qwen_image", "wan21"], latent: "EmptyLatentImage", sizeStep: 16, negative: "text", img2img: true, aspects: portraitFirst,
    variants: [{ id: "standard", label: "Anima", defaults: { steps: 30, cfg: 4, sampler: "euler", scheduler: "simple" } }],
    size: [1024, 1024]
  },
  wan21: {
    label: "Wan 2.1", kind: "video", sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "UMT5-XXL", kinds: ["umt5xxl"] }], clipType: "wan",
    vae: ["wan21"], latent: "EmptyHunyuanLatentVideo", sizeStep: 16, frameStep: 4, negative: "text", aspects: wide,
    modelSampling: { node: "ModelSamplingSD3", shift: 8 },
    variants: [
      { id: "fast", label: "Fast", match: (name) => speedName.test(name) || /causvid|lightx2v|self[-_]?forcing/i.test(name), defaults: { steps: 6, cfg: 1, sampler: "euler", scheduler: "simple" } },
      { id: "standard", label: "Wan 2.1", defaults: { steps: 30, cfg: 6, sampler: "uni_pc", scheduler: "simple" } }
    ],
    size: [832, 480], frames: 33, fps: 16
  },
  wan22_5b: {
    label: "Wan 2.2 5B", kind: "video", sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "UMT5-XXL", kinds: ["umt5xxl"] }], clipType: "wan",
    vae: ["wan22"], latent: "Wan22ImageToVideoLatent", sizeStep: 32, frameStep: 4, negative: "text", startImage: true, aspects: wide,
    modelSampling: { node: "ModelSamplingSD3", shift: 8 },
    variants: [
      { id: "fast", label: "Fast", match: (name) => speedName.test(name), defaults: { steps: 6, cfg: 1, sampler: "euler", scheduler: "simple" } },
      { id: "standard", label: "Wan 2.2 5B", defaults: { steps: 20, cfg: 5, sampler: "uni_pc", scheduler: "simple" } }
    ],
    size: [1280, 704], frames: 121, fps: 24
  },
  wan22_14b: {
    label: "Wan 2.2 14B", kind: "video", sources: ["unet"],
    pair: {
      owns: /wan/i, isPartner: (base) => /low[-_ ]?noise/i.test(base),
      partnerOf: (name) => name.replace(/high([-_ ]?)noise/i, (_match, sep) => `low${sep}noise`),
      label: "Low-noise model", runsAs: "Runs as the second half of its high-noise model.",
      detail: (base) => `Wan 2.2 14B also needs the matching low-noise file next to ${base} in diffusion_models.`
    },
    slots: [{ slot: "encoder", label: "UMT5-XXL", kinds: ["umt5xxl"] }], clipType: "wan",
    vae: ["wan21"], latent: "EmptyHunyuanLatentVideo", sizeStep: 16, frameStep: 4, negative: "text", sampling: "pair", aspects: wide,
    modelSampling: { node: "ModelSamplingSD3", shift: 8 },
    variants: [
      { id: "fast", label: "Fast (4-step)", match: (name) => speedName.test(name) || /lightx2v|rapid/i.test(name), modelSampling: { node: "ModelSamplingSD3", shift: 5 }, defaults: { steps: 4, cfg: 1, sampler: "euler", scheduler: "simple" } },
      { id: "standard", label: "Wan 2.2 14B", defaults: { steps: 20, cfg: 3.5, sampler: "euler", scheduler: "simple" } }
    ],
    size: [832, 480], frames: 81, fps: 16
  },
  hunyuan15: {
    label: "HunyuanVideo 1.5", kind: "video", sources: ["unet", "checkpoint"],
    slots: [
      { slot: "encoder", label: "Qwen2.5-VL 7B", kinds: ["qwen25vl_7b"] },
      { slot: "glyph", label: "ByT5 Glyph", kinds: ["byt5_glyph"] }
    ], clipType: "hunyuan_video_15",
    vae: ["hunyuan15"], latent: "EmptyHunyuanVideo15Latent", sizeStep: 16, frameStep: 4, negative: "text", aspects: wide,
    modelSampling: { node: "ModelSamplingSD3", shift: 7 },
    requiredNodes: ["EmptyHunyuanVideo15Latent"],
    variants: [
      { id: "step_distilled", label: "Step-distilled", match: (name) => /step[-_ ]?distill/i.test(name) || speedName.test(name), defaults: { steps: 8, cfg: 1, sampler: "euler", scheduler: "simple" } },
      { id: "cfg_distilled", label: "CFG-distilled", match: (name) => /cfg[-_ ]?distill/i.test(name), defaults: { steps: 20, cfg: 1, sampler: "euler", scheduler: "simple" } },
      { id: "p720", label: "720p", match: (name) => /720p/i.test(name), size: [1280, 720], defaults: { steps: 20, cfg: 6, sampler: "euler", scheduler: "simple" } },
      { id: "standard", label: "HunyuanVideo 1.5", defaults: { steps: 20, cfg: 6, sampler: "euler", scheduler: "simple" } }
    ],
    size: [848, 480], frames: 61, fps: 24
  },
  minimax_h3: {
    label: "MiniMax H3", kind: "video", sources: ["unet", "checkpoint"], audio: true,
    slots: [{ slot: "encoder", label: "Qwen3-VL 32B", kinds: ["qwen3vl_32b"] }], clipType: "minimax",
    vae: ["h3_video"], audioVae: ["h3_audio"], latent: "MiniMaxH3ImageToVideo", sizeStep: 32, negative: "none", sampling: "h3", aspects: wide,
    requiredNodes: ["MiniMaxH3ImageToVideo", "SamplerCustomAdvanced", "BasicGuider", "VAEDecodeAudio", "CreateVideo"],
    variants: [
      { id: "fast", label: "Turbo", match: (name) => speedName.test(name), defaults: { steps: 6, cfg: 1, sampler: "res_multistep", scheduler: "simple" } },
      { id: "standard", label: "MiniMax H3", defaults: { steps: 20, cfg: 1, sampler: "res_multistep", scheduler: "simple" } }
    ],
    size: [1344, 768], frames: 56, fps: 24
  },
  // Lumina Image 2.0 and its fine-tunes (Neta Lumina, NetaYume). Gemma reads a
  // system prompt before yours, as it did in training; the anime fine-tunes
  // were trained on their own, with a matching one for the negative.
  lumina2: {
    label: "Lumina Image 2.0", kind: "image", sources: ["checkpoint", "unet"],
    slots: [{ slot: "encoder", label: "Gemma 2 2B", kinds: ["gemma2_2b"] }], clipType: "lumina2",
    vae: ["flux1"], latent: "EmptySD3LatentImage", sizeStep: 16, negative: "text", img2img: true, aspects: portraitFirst,
    variants: [
      {
        id: "neta", label: "Neta Lumina / NetaYume", match: (name) => /neta|yume/i.test(name),
        modelSampling: { node: "ModelSamplingAuraFlow", shift: 4 },
        promptPrefix: "You are an assistant designed to generate high quality anime images based on textual prompts. <Prompt Start> ",
        negativePrefix: "You are an assistant designed to generate low-quality images based on textual prompts <Prompt Start> ",
        defaults: { steps: 30, cfg: 4, sampler: "res_multistep", scheduler: "simple" }
      },
      {
        id: "standard", label: "Lumina Image 2.0",
        modelSampling: { node: "ModelSamplingAuraFlow", shift: 6 },
        promptPrefix: "You are an assistant designed to generate superior images with the superior degree of image-text alignment based on textual prompts or user prompts. <Prompt Start> ",
        defaults: { steps: 25, cfg: 4, sampler: "res_multistep", scheduler: "simple" }
      }
    ],
    size: [1024, 1024]
  },
  // Ideogram 4 samples with two models: the main one for your prompt and an
  // unconditional one for the negative pass, blended by a dual guider whose
  // CFG eases off for the last 30% of steps. Its scheduler follows the steps:
  // Comfy-Org's Turbo (12), Default (20) and Quality (48) presets.
  ideogram4: {
    label: "Ideogram 4", kind: "image", sources: ["unet"],
    slots: [{ slot: "encoder", label: "Qwen3-VL 8B", kinds: ["qwen3vl_8b"] }], clipType: "ideogram4",
    vae: ["flux2"], latent: "EmptyFlux2LatentImage", sizeStep: 16, negative: "none", sampling: "ideogram4", aspects: square,
    requiredNodes: ["EmptyFlux2LatentImage", "Ideogram4Scheduler", "DualModelGuider", "CFGOverride", "SamplerCustomAdvanced", "KSamplerSelect", "RandomNoise", "ConditioningZeroOut"],
    pair: {
      owns: /ideogram/i, isPartner: (base) => /uncond/i.test(base),
      partnerOf: (name) => name.replace(/ideogram[-_ ]?4[-_ ]?/i, (match) => `${match}unconditional_`),
      label: "Unconditional model", runsAs: "Ideogram 4 runs this next to its main model.",
      detail: (base) => `Ideogram 4 also needs its unconditional model next to ${base} in diffusion_models.`,
      download: (name) => (/int8/i.test(name) ? "ideogram4_uncond_int8" : "ideogram4_uncond_fp8")
    },
    variants: [{ id: "standard", label: "Ideogram 4", defaults: { steps: 20, cfg: 7, sampler: "euler", scheduler: "simple" } }],
    size: [1024, 1024]
  },
  // Mage-Flow encodes prompt and negative in one node that also makes the latent.
  mage_flow: {
    label: "MageFlow", kind: "image", sources: ["unet"],
    slots: [{ slot: "encoder", label: "Qwen3-VL 4B", kinds: ["qwen3vl_4b"] }], clipType: "mage",
    vae: ["mage_flow"], latent: "TextEncodeMageFlowEdit", sizeStep: 16, negative: "text", sampling: "mage", aspects: square,
    requiredNodes: ["TextEncodeMageFlowEdit"],
    variants: [
      { id: "turbo", label: "Turbo", match: (name) => speedName.test(name), negative: "none", defaults: { steps: 4, cfg: 1, sampler: "euler", scheduler: "simple" } },
      { id: "standard", label: "MageFlow", defaults: { steps: 30, cfg: 5, sampler: "euler", scheduler: "simple" } }
    ],
    size: [1024, 1024]
  },
  // ERNIE-Image: Ministral 3 3B through the Flux.2 text path, the Flux.2 VAE and latent, plain KSampler.
  ernie: {
    label: "ERNIE-Image", kind: "image", sources: ["unet"],
    slots: [{ slot: "encoder", label: "Ministral 3 3B", kinds: ["ministral3_3b"] }], clipType: "flux2",
    vae: ["flux2"], latent: "EmptyFlux2LatentImage", sizeStep: 16, negative: "text", img2img: true, aspects: square,
    requiredNodes: ["EmptyFlux2LatentImage"],
    variants: [
      { id: "turbo", label: "Turbo", match: (name) => speedName.test(name), negative: "zero", defaults: { steps: 8, cfg: 1, sampler: "euler", scheduler: "simple" } },
      { id: "standard", label: "ERNIE-Image", defaults: { steps: 20, cfg: 4, sampler: "euler", scheduler: "simple" } }
    ],
    size: [1024, 1024]
  },
  // NVIDIA's Sana is not native to ComfyUI; one of two custom node packs runs
  // it (see sanaRunners), each loading its own Gemma 2 2B encoder and DC-AE VAE.
  // Settings follow NVlabs/Sana's ComfyUI workflows.
  sana: {
    label: "Sana", kind: "image", sources: ["sana", "sana_diffusers", "checkpoint"], ownLoaders: true,
    slots: [], clipType: null, vae: [],
    latent: "EmptyHunyuanImageLatent", sizeStep: 32, negative: "text", sampling: "sana", aspects: square,
    variants: [
      // Sprint is a consistency model: its CFG goes in through ScmModelSampling, KSampler stays at 1.
      { id: "sprint", label: "Sprint", match: (name, header, detail) => detail?.sprint ?? /sprint/i.test(name), negative: "none", dtype: "FP32", defaults: { steps: 2, cfg: 4.5, sampler: "scm", scheduler: "sgm_uniform" } },
      { id: "4k", label: "4K", match: (name) => /4k/i.test(name), size: [4096, 4096], defaults: { steps: 28, cfg: 4.5, sampler: "euler", scheduler: "normal" } },
      { id: "2k", label: "2K", match: (name) => /2k/i.test(name), size: [2048, 2048], defaults: { steps: 28, cfg: 4.5, sampler: "euler", scheduler: "normal" } },
      { id: "512", label: "512px", match: (name) => /512px/i.test(name), size: [512, 512], defaults: { steps: 28, cfg: 4.5, sampler: "euler", scheduler: "normal" } },
      { id: "standard", label: "Sana", defaults: { steps: 28, cfg: 4.5, sampler: "euler", scheduler: "normal" } }
    ],
    size: [1024, 1024]
  }
};

/**
 * The two packs that run Sana, by model source. ExtraModels samples with
 * ComfyUI's own KSampler (live previews) and fetches its presets itself, but
 * its encoder and attention are CUDA-or-CPU only. ComfyUI-SANA wraps the
 * diffusers pipeline, so it also runs on Apple Silicon, and loads folders from
 * models/diffusers. Local Sana checkpoints go through ExtraModels.
 */
/**
 * ExtraModels' EmptySanaLatentImage reads a `device` that ComfyUI's
 * EmptyLatentImage no longer has, so it fails on current ComfyUI. Sana's
 * latent is 32 channels at 1/32 scale; ComfyUI's own Hunyuan Image latent has
 * that scale, and the sampler trims an empty latent to the model's channels.
 */
export const sanaLatentNode = "EmptyHunyuanImageLatent";

export const sanaRunners = {
  sana: {
    pack: "extramodels", variantNodes: { sprint: ["ScmModelSampling"] },
    note: "Sana is not built into ComfyUI; these custom nodes run it.",
    sizeNode: sanaLatentNode
  },
  sana_diffusers: {
    pack: "comfyui_sana", note: "Sana is not built into ComfyUI; these custom nodes run it, on Apple Silicon too.",
    sizeNode: "SanaGenerate"
  }
};

export const sanaRunnerFor = (source) => sanaRunners[source === "sana_diffusers" ? "sana_diffusers" : "sana"];

/** A friendly name for a Sana preset or a diffusers folder of one. */
export function sanaLabel(name = "") {
  const base = String(name).split(/[\\/]/).pop() || "";
  const preset = sanaPresets.find((item) => item.name.split("/").pop() === base.replace(/_diffusers$/i, ""));
  return preset?.label || "";
}

/**
 * Sana models the ExtraModels loader fetches by name, in the order HEISS lists
 * them. `conf` is the loader's model config (it picks its own for these, but
 * the input is required); `dir` is where the loader downloads it, under
 * ComfyUI/models/sana. Older duplicates of the same weights are left out.
 */
export const sanaPresets = [
  { name: "Efficient-Large-Model/SANA1.5_4.8B_1024px", dir: "models--sana--sana-1.5-4800m-1024px", label: "SANA 1.5 4.8B", conf: "SanaMS1.5_4800M_P1_D60" },
  { name: "Efficient-Large-Model/SANA1.5_1.6B_1024px", dir: "models--sana--sana-1.5-1600m-1024px", label: "SANA 1.5 1.6B", conf: "SanaMS1.5_1600M_P1_D20" },
  { name: "Efficient-Large-Model/Sana_Sprint_1.6B_1024px", dir: "models--sana--sana-sprint-1600m-1024px", label: "SANA Sprint 1.6B", conf: "SanaSprint_1600M_P1_D20" },
  { name: "Efficient-Large-Model/Sana_Sprint_0.6B_1024px", dir: "models--sana--sana-sprint-600m-1024px", label: "SANA Sprint 0.6B", conf: "SanaSprint_600M_P1_D28" },
  { name: "Efficient-Large-Model/Sana_1600M_4Kpx_BF16", dir: "models--sana--sana-1600m-4kpx-bf16", label: "Sana 1.6B 4K", conf: "SanaMS_1600M_P1_D20_4K" },
  { name: "Efficient-Large-Model/Sana_1600M_2Kpx_BF16", dir: "models--sana--sana-1600m-2kpx-bf16", label: "Sana 1.6B 2K", conf: "SanaMS_1600M_P1_D20_2K" },
  { name: "Efficient-Large-Model/Sana_1600M_1024px_MultiLing", dir: "models--sana--sana-1600m-1024px-multilingual", label: "Sana 1.6B Multilingual", conf: "SanaMS_1600M_P1_D20" },
  { name: "Efficient-Large-Model/Sana_600M_1024px", dir: "models--sana--sana-600m-1024px", label: "Sana 0.6B", conf: "SanaMS_600M_P1_D28" },
  { name: "Efficient-Large-Model/Sana_600M_512px", dir: "models--sana--sana-600m-512px", label: "Sana 0.6B 512px", conf: "SanaMS_600M_P1_D28", hidden: true },
  { name: "Efficient-Large-Model/Sana_1600M_1024px", dir: "models--sana--sana-1600m-1024px", label: "Sana 1.6B", conf: "SanaMS_1600M_P1_D20", hidden: true }
];

/**
 * The ExtraModels config for a Sana file of our own: a preset's, else from the
 * header's depth and width (1.5 adds q/k norms, Sprint a CFG embedder), else
 * from the name.
 */
export function sanaConf(name = "", detail = null) {
  const preset = sanaPresets.find((item) => item.name === name);
  if (preset) return preset.conf;
  const base = String(name).split(/[\\/]/).pop() || "";
  const sprint = detail?.sprint ?? /sprint/i.test(base);
  const depth = detail?.depth || (/4[._]?8b|4800m/i.test(base) ? 60 : /0[._]?6b|600m/i.test(base) ? 28 : 20);
  if (depth === 60) return "SanaMS1.5_4800M_P1_D60";
  if (depth === 28) return sprint ? "SanaSprint_600M_P1_D28" : "SanaMS_600M_P1_D28";
  if (sprint) return "SanaSprint_1600M_P1_D20";
  if (/4k/i.test(base)) return "SanaMS_1600M_P1_D20_4K";
  if (/2k/i.test(base)) return "SanaMS_1600M_P1_D20_2K";
  return (detail?.qkNorm ?? /1[._]?5/.test(base)) ? "SanaMS1.5_1600M_P1_D20" : "SanaMS_1600M_P1_D20";
}

// Recognised so HEISS can say what they are, but not runnable here yet.
export const knownFamilies = {
  ltx: "LTX-2 video (needs its two-stage audio pipeline; not in HEISS UI yet)",
  ltxv: "LTX-Video",
  hunyuan_video: "HunyuanVideo 1.0",
  newbie: "NewBie (Lumina-based, needs its own text encoders; not in HEISS UI yet)",
  wan_i2v: "Wan image-to-video (needs a start image; not in HEISS UI yet)",
  wan_other: "Wan VACE / Fun / camera model",
  qwen_image_edit: "Qwen-Image Edit (image editing model)",
  sdxl_refiner: "SDXL Refiner (used after a base model, not on its own)",
  inpaint: "Inpainting model",
  kandinsky5: "Kandinsky 5",
  cosmos: "Cosmos",
  other: "Unknown architecture"
};

/* ------------------------------------------------------------ Names */

export function isKrea2Raw(name = "") {
  const base = String(name).split(/[\\/]/).pop() || "";
  return /raw|base/i.test(base) && !/turbo|tdm|distill/i.test(base);
}

export function isZImageBase(name = "") {
  const base = String(name).split(/[\\/]/).pop() || "";
  if (/turbo|distill|lightning|\d+[-_ ]?steps?/i.test(base)) return false;
  if (/base|raw/i.test(base)) return true;
  return /^z[-_ ]?image(?:[-_](?:bf16|fp16|fp32|fp8\w*|nvfp4|int8\w*|scaled|e4m3fn))*\.safetensors$/i.test(base);
}

/** Filename guesses, for when the weights are out of reach (a remote ComfyUI). */
export function familyFromName(name = "", source = "unet") {
  const base = String(name).split(/[\\/]/).pop() || "";
  const tests = [
    ["sana", /(^|[^a-z])sana([^a-z]|$)/i],
    ["ideogram4", /ideogram/i],
    ["mage_flow", /mage[-_ ]?flow/i],
    ["ernie", /(^|[^a-z])ernie([^a-z]|$)/i],
    ["lumina2", /lumina|neta[-_ ]?yume|netayume|neta[-_ ]?lumina/i],
    ["minimax_h3", /minimax[-_ ]?h3|\bh3[-_]/i],
    ["wan22_14b", /wan[-_ ]?2[._]?2.*(high|low)[-_ ]?noise|(high|low)[-_ ]?noise.*wan/i],
    ["wan22_5b", /wan[-_ ]?2[._]?2.*5b|ti2v/i],
    ["wan21", /wan[-_ ]?2[._]?1.*t2v|wan.*t2v/i],
    ["hunyuan15", /hunyuan[-_ ]?video[-_ ]?1[._]?5|hunyuanvideo1\.?5/i],
    ["qwen_image_21", /qwen[-_ ]?image[-_ ]?2[._]?1/i],
    ["qwen_image", /qwen[-_ ]?image/i],
    ["krea2", /krea/i],
    ["flux2_klein_9b", /klein.*9b/i],
    ["flux2_klein_4b", /klein/i],
    ["flux2_dev", /flux[-_. ]?2/i],
    ["chroma", /chroma/i],
    ["hidream", /hidream/i],
    ["zimage", /z[-_ ]?image|z[-_ ]?anime/i],
    ["anima", /\banima/i],
    ["flux1", /flux|schnell/i],
    ["sd3", /sd[-_ ]?3|stable[-_ ]?diffusion[-_ ]?3/i],
    ["auraflow", /pony[-_ ]?v7|auraflow/i],
    ["sdxl", /xl|pony|illustrious|noob|animagine/i],
    ["sd15", /sd[-_ ]?1[._]?5|v1[-_]5/i]
  ];
  for (const [family, pattern] of tests) {
    // "flux1-krea-dev" is Flux, not Krea 2.
    if (family === "krea2" && /flux|krea[-_ .]?1(?!\d)/i.test(base)) continue;
    if (pattern.test(base)) return family;
  }
  // Anything else in checkpoints/ is most likely an SD-family all-in-one.
  return source === "checkpoint" ? "sdxl_or_sd15" : "";
}

/* ------------------------------------------------------------ Headers */

const prefixes = ["model.diffusion_model.", "model.model.", "net."];

/** The diffusion model's own keys, prefix stripped (unet_prefix_from_state_dict). */
export function diffusionKeys(header) {
  const all = Object.keys(header || {}).filter((key) => key !== "__metadata__");
  let best = "";
  let bestCount = 5;
  for (const prefix of prefixes) {
    const count = all.filter((key) => key.startsWith(prefix)).length;
    if (count > bestCount) { best = prefix; bestCount = count; }
  }
  if (!best) return new Map(all.map((key) => [key, header[key]]));
  return new Map(all.filter((key) => key.startsWith(best)).map((key) => [key.slice(best.length), header[key]]));
}

const dim = (keys, key, axis = 0) => {
  const shape = keys.get(key)?.shape;
  return Array.isArray(shape) ? Number(shape[axis < 0 ? shape.length + axis : axis]) : NaN;
};

/**
 * { family, detail } from a header, in ComfyUI's detection order. family is one
 * of `families`, a `knownFamilies` id, or "" when the header has nothing to say.
 */
export function familyFromHeader(header) {
  if (!header) return { family: "" };
  const keys = diffusionKeys(header);
  if (!keys.size) return { family: "" };
  const has = (key) => keys.has(key);
  if (has("joint_blocks.0.context_block.attn.qkv.weight")) return { family: "sd3" };
  if (has("double_layers.0.attn.w1q.weight")) return { family: "auraflow" };
  if (has("txt_in.individual_token_refiner.blocks.0.norm1.weight")) {
    if (!has("vision_in.proj.0.weight")) return { family: "hunyuan_video" };
    return dim(keys, "img_in.proj.weight", 1) === 98 ? { family: "other" } : { family: "hunyuan15" };
  }
  const fluxLike = (has("double_blocks.0.img_attn.norm.key_norm.weight") || has("double_blocks.0.img_attn.norm.key_norm.scale"))
    && (has("img_in.weight") || has("distilled_guidance_layer.norms.0.weight") || has("distilled_guidance_layer.norms.0.scale"));
  if (fluxLike) {
    if (["distilled_guidance_layer.0.norms.0.weight", "distilled_guidance_layer.0.norms.0.scale", "distilled_guidance_layer.norms.0.weight", "distilled_guidance_layer.norms.0.scale"].some(has)) {
      return has("nerf_blocks.0.norm.weight") || has("nerf_blocks.0.norm.scale") ? { family: "other" } : { family: "chroma" };
    }
    if (has("double_stream_modulation_img.lin.weight")) {
      // Three tapped encoder layers x the encoder's width (comfy/sd.py: "3-layer tap -> 12288").
      const context = dim(keys, "txt_in.weight", 1);
      if (context === 7680) return { family: "flux2_klein_4b" };
      if (context === 12288) return { family: "flux2_klein_9b" };
      if (context === 15360) return { family: "flux2_dev" };
      return { family: "flux2_dev", detail: { unsure: true } };
    }
    if (dim(keys, "img_in.weight", 1) === 384) return { family: "inpaint" };
    return { family: "flux1", detail: { schnell: !has("guidance_in.in_layer.weight") } };
  }
  if (has("video_patch_proj.weight") && has("audio_patch_proj.weight")) return { family: "minimax_h3" };
  // Sana's GLUMBConv feed-forward, in its own and in diffusers' naming.
  if (has("blocks.0.mlp.inverted_conv.conv.weight") || has("transformer_blocks.0.ff.conv_inverted.weight")) {
    const native = has("blocks.0.mlp.inverted_conv.conv.weight");
    const block = native ? /^blocks\.(\d+)\./ : /^transformer_blocks\.(\d+)\./;
    const depth = Math.max(...[...keys.keys()].map((key) => Number(block.exec(key)?.[1] ?? -1))) + 1;
    const sprint = native ? has("cfg_embedder.mlp.0.weight") : [...keys.keys()].some((key) => key.includes("guidance"));
    const qkNorm = has(native ? "blocks.0.attn.q_norm.weight" : "transformer_blocks.0.attn1.norm_q.weight");
    return { family: "sana", detail: { depth, sprint, qkNorm } };
  }
  if (has("adaln_single.emb.timestep_embedder.linear_1.bias") && !has("pos_embed.proj.bias")) {
    return { family: has("audio_adaln_single.linear.weight") ? "ltx" : "ltxv" };
  }
  if (has("cap_embedder.1.weight") && has("noise_refiner.0.attention.k_norm.weight")) {
    const width = dim(keys, "cap_embedder.1.weight", 0);
    if (has("dec_net.cond_embed.weight")) return { family: "other" };
    if (width === 3840) return { family: "zimage" };
    if (width !== 2304) return { family: "other" };
    // NewBie keeps Lumina's body but adds a pooled CLIP input, so it needs other encoders.
    return has("clip_text_pooled_proj.0.weight") ? { family: "newbie" } : { family: "lumina2" };
  }
  if (has("head.modulation")) {
    if (["vace_patch_embedding.weight", "control_adapter.conv.weight"].some(has)) return { family: "wan_other" };
    if (dim(keys, "head.head.weight", 0) / 4 === 48) return { family: "wan22_5b" };
    if (has("img_emb.proj.0.bias") || dim(keys, "patch_embedding.weight", 1) >= 36) return { family: "wan_i2v" };
    // Wan 2.2 14B and Wan 2.1 14B share every key; the high/low-noise pair is a naming convention.
    return { family: "wan21", detail: { width: dim(keys, "head.modulation", -1) } };
  }
  if (has("caption_projection.0.linear.weight")) return { family: "hidream" };
  if (has("blocks.0.mlp.layer1.weight")) {
    return has("llm_adapter.blocks.0.cross_attn.q_proj.weight") ? { family: "anima" } : { family: "cosmos" };
  }
  if (has("txt_norm.weight")) {
    if (has("transformer_blocks.0.attn.norm_added_q.weight") && has("transformer_blocks.0.img_mlp.w1.weight")) return { family: "other" };
    if (dim(keys, "txt_norm.weight", 0) === 2560 && dim(keys, "proj_out.weight", 0) === 128) return { family: "mage_flow" };
    if (has("__index_timestep_zero__") || has("time_text_embed.addition_t_embedding.weight")) return { family: "qwen_image_edit" };
    return { family: "qwen_image" };
  }
  if (has("embed_image_indicator.weight")) return { family: "ideogram4" };
  if (has("txtfusion.projector.weight")) return { family: "krea2" };
  if (has("visual_transformer_blocks.0.cross_attention.key_norm.weight")) return { family: "kandinsky5" };
  if (has("layers.0.mlp.linear_fc2.weight")) return { family: "ernie" };
  if (has("input_blocks.0.0.weight")) {
    if (dim(keys, "input_blocks.0.0.weight", 1) > 4) return { family: "inpaint" };
    const context = [1, 2, 4, 5, 7, 8]
      .map((block) => dim(keys, `input_blocks.${block}.1.transformer_blocks.0.attn2.to_k.weight`, 1))
      .find((value) => Number.isFinite(value));
    if (context === 768) return { family: "sd15" };
    if (context === 1024) return { family: "sd2" };
    if (context === 2048) return { family: "sdxl" };
    if (context === 1280) return { family: "sdxl_refiner" };
    return { family: "other" };
  }
  return { family: "other" };
}

/** The variant of a family a file is, by name (and header where it can tell). */
export function variantFor(familyId, name = "", header = null, detail = null) {
  const family = families[familyId];
  if (!family) return null;
  const base = String(name).split(/[\\/]/).pop() || "";
  return family.variants.find((variant) => !variant.match || variant.match(base, header, detail)) || family.variants.at(-1);
}

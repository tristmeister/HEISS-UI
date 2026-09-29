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
// abliterated builds lead wherever a ComfyUI-ready one exists. `fp8`: the file
// is quantized fp8 (per-layer scales, read from its header), which ComfyUI
// keeps in fp8 and a Mac cannot load, so there these go last (forDevice in
// family-profiles.js). A plain fp8 file loads at full precision on a Mac and
// is not flagged. `sha256` is the file's Hugging Face LFS hash (its paths-info
// API), checked after every download; an entry without one is checked by
// length only.
export const encoderDownloads = {
  clip_l: [{ file: "clip_l.safetensors", url: hf("comfyanonymous/flux_text_encoders", "clip_l.safetensors"), bytes: 246_144_152, sha256: "660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd" }],
  clip_g: [{ file: "clip_g.safetensors", url: hf("Comfy-Org/stable-diffusion-3.5-fp8", "text_encoders/clip_g.safetensors"), bytes: 1_389_382_176, sha256: "ec310df2af79c318e24d20511b601a591ca8cd4f1fce1d8dff822a356bcdb1f4" }],
  t5xl: [{ file: "pony-v7-pile-t5xl.fp16.safetensors", url: hf("purplesmartai/pony-v7-base", "text_encoder/model.fp16.safetensors"), bytes: 2_950_448_704, sha256: "decf9b70814ed5e9965bfca9fbd0483462e2bf743790663025b7742f8c014c72" }],
  t5xxl: [
    { file: "t5xxl_fp8_e4m3fn_scaled.safetensors", fp8: true, url: hf("comfyanonymous/flux_text_encoders", "t5xxl_fp8_e4m3fn_scaled.safetensors"), bytes: 5_157_348_688, sha256: "a498f0485dc9536735258018417c3fd7758dc3bccc0a645feaa472b34955557a" },
    { file: "t5xxl_fp16.safetensors", url: hf("comfyanonymous/flux_text_encoders", "t5xxl_fp16.safetensors"), bytes: 9_787_841_024, sha256: "6e480b09fae049a72d2a8c5fbccb8d3e92febeb233bbe9dfe7256958a9167635" }
  ],
  umt5xxl: [
    { file: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", fp8: true, url: hf("Comfy-Org/Wan_2.1_ComfyUI_repackaged", "split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"), bytes: 6_735_906_897, sha256: "c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68" },
    { file: "umt5_xxl_fp16.safetensors", url: hf("Comfy-Org/Wan_2.1_ComfyUI_repackaged", "split_files/text_encoders/umt5_xxl_fp16.safetensors"), bytes: 11_366_399_385, sha256: "7b8850f1961e1cf8a77cca4c964a358d303f490833c6c087d0cff4b2f99db2af" }
  ],
  byt5_glyph: [{ file: "byt5_small_glyphxl_fp16.safetensors", url: hf("Comfy-Org/HunyuanVideo_1.5_repackaged", "split_files/text_encoders/byt5_small_glyphxl_fp16.safetensors"), bytes: 438_643_184, sha256: "516910bb4c9b225370290e40585d1b0e6c8cd3583690f7eec2f7fb593990fb48" }],
  qwen3_06b: [{ file: "qwen_3_06b_base.safetensors", url: hf("circlestone-labs/Anima", "split_files/text_encoders/qwen_3_06b_base.safetensors"), bytes: 1_192_135_096, sha256: "cd2a512003e2f9f3cd3c32a9c3573f820bb28c940f73c57b1ddaa983d9223eba" }],
  // "Heretic" builds are abliterated with the Heretic tool; DreamFast and ethanfel
  // ship them converted for ComfyUI's single-file loaders.
  qwen3_4b: [
    { file: "qwen3-4b-heretic_fp8_e4m3fn.safetensors", url: hf("DreamFast/qwen3-4b-heretic", "comfyui/qwen3-4b-heretic_fp8_e4m3fn.safetensors"), bytes: 4_411_666_704, sha256: "f4ce8b26dcb710a73d3e81fd4bdb10daf8d063496b23655de4aa2e435b5f2d18" },
    { file: "qwen_3_4b.safetensors", url: hf("Comfy-Org/z_image_turbo", "split_files/text_encoders/qwen_3_4b.safetensors"), bytes: 8_044_982_048, sha256: "6c671498573ac2f7a5501502ccce8d2b08ea6ca2f661c458e708f36b36edfc5a" }
  ],
  qwen3_8b: [
    { file: "qwen3-8b-heretic_fp8_e4m3fn.safetensors", fp8: true, url: hf("DreamFast/qwen3-8b-heretic", "comfyui/qwen3-8b-heretic_fp8_e4m3fn.safetensors"), bytes: 9_435_845_548, sha256: "7869b38a7830fd021e36a1f00a1e012ac5c9afe36b974a8e5e67b311e654443e" },
    { file: "qwen_3_8b_fp8mixed.safetensors", fp8: true, url: hf("Comfy-Org/vae-text-encorder-for-flux-klein-9b", "split_files/text_encoders/qwen_3_8b_fp8mixed.safetensors"), bytes: 8_664_848_742, sha256: "abad16806e0cbabc54e0325d6565847443fe396d5f0be38bb3cd3fe75a1201d6" }
  ],
  qwen3vl_4b: [
    { file: "qwen3-vl-4b-heretic_fp8_e4m3fn.safetensors", fp8: true, url: hf("DreamFast/Qwen3-VL-4b-Heretic-ComfyUI", "qwen3-vl-4b-heretic_fp8_e4m3fn.safetensors"), bytes: 4_831_492_476, sha256: "7443c2b8df026a3271b3095d5d1dc07800dc5cf460b6e3586692253c7a7bc17c" },
    { file: "qwen3vl_4b_fp8_scaled.safetensors", fp8: true, url: hf("Comfy-Org/Krea-2", "text_encoders/qwen3vl_4b_fp8_scaled.safetensors"), bytes: 5_242_467_968, sha256: "54bd5144df0bbc25dd6ccadfcb826b521445a1b06ae5a42570bdd2974ca87094" }
  ],
  qwen3vl_8b: [
    { file: "qwen3-vl-8b-heretic-1.3.0_fp8_e4m3fn.safetensors", url: hf("DreamFast/Qwen3-VL-8B-Heretic-1.3.0", "comfyui/qwen3-vl-8b-heretic-1.3.0_fp8_e4m3fn.safetensors"), bytes: 10_017_064_632, sha256: "7f8ec20de729e2d99f3a04852d4c4499c1677cda167f5ea63d21b0882a5c32b5" },
    { file: "qwen3vl_8b_int8_convrot.safetensors", url: hf("Comfy-Org/Qwen-Image-2.1", "text_encoders/qwen3vl_8b_int8_convrot.safetensors"), bytes: 9_350_798_360, sha256: "8bfd0f6e12abf2d2d697ecc888e5e90b0d6741d6708f05799f53afa560452e8f" }
  ],
  qwen3vl_32b: [
    { file: "qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot.safetensors", url: hf("ethanfel/Qwen3-VL-32B-Ultra-Heretic-H3-ComfyUI-INT8-ConvRot", "qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot.safetensors"), bytes: 26_363_476_151, sha256: "d84547412144b7c50a6ec77437a889b869d3ace88da77ef1775d3d2a4901c192" },
    { file: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", url: hf("Comfy-Org/MiniMax-H3", "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"), bytes: 15_687_142_551, sha256: "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6" }
  ],
  qwen25vl_7b: [
    { file: "qwen_2.5_vl_7b_huihui_abliterated_int8_convrot.safetensors", url: hf("ethanfel/Qwen2.5-VL-7B-Huihui-Abliterated-ComfyUI-ConvRot-INT8", "qwen_2.5_vl_7b_huihui_abliterated_int8_convrot.safetensors"), bytes: 10_064_106_602, sha256: "3dc4aae7dc34000c95de546cb220f1b67e51c86d7095fb9e3d19cec7032f5df7" },
    { file: "qwen_2.5_vl_7b_fp8_scaled.safetensors", fp8: true, url: hf("Comfy-Org/Qwen-Image_ComfyUI", "split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors"), bytes: 9_384_670_680, sha256: "cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4" }
  ],
  // fp8 first: half the size of bf16, and what fits next to Flux.2 Dev on most machines.
  mistral3_24b: [
    { file: "mistral_3_small_flux2_fp8.safetensors", fp8: true, url: hf("Comfy-Org/flux2-dev", "split_files/text_encoders/mistral_3_small_flux2_fp8.safetensors"), bytes: 18_034_640_095, sha256: "e3467b7d912a234fb929cdf215dc08efdb011810b44bc21081c4234cc75b370e" },
    { file: "mistral_3_small_flux2_bf16.safetensors", url: hf("Comfy-Org/flux2-dev", "split_files/text_encoders/mistral_3_small_flux2_bf16.safetensors"), bytes: 35_584_897_447, sha256: "7d79902f60b1aeb3a6de2cfad02f4367b5e300a1387de3d03ac717cfa3df117c" }
  ],
  llama31_8b: [{ file: "llama_3.1_8b_instruct_fp8_scaled.safetensors", fp8: true, url: hf("Comfy-Org/HiDream-I1_ComfyUI", "split_files/text_encoders/llama_3.1_8b_instruct_fp8_scaled.safetensors"), bytes: 9_081_258_056, sha256: "9f86897bbeb933ef4fd06297740edb8dd962c94efcd92b373a11460c33765ea6" }],
  ministral3_3b: [{ file: "ministral-3-3b.safetensors", url: hf("Comfy-Org/ERNIE-Image", "text_encoders/ministral-3-3b.safetensors"), bytes: 7_717_637_511, sha256: "49a750a128863854eac7d85e1a277a7b44bf6ec3646405b84686dfeeca3708ca" }],
  gemma2_2b: [{ file: "gemma_2_2b_fp16.safetensors", url: hf("Comfy-Org/Lumina_Image_2.0_Repackaged", "split_files/text_encoders/gemma_2_2b_fp16.safetensors"), bytes: 5_232_958_283, sha256: "29761442862f8d064d3f854bb6fabf4379dcff511a7f6ba9405a00bd0f7e2dbd" }],
  hidream_clip_l: [{ file: "clip_l_hidream.safetensors", url: hf("Comfy-Org/HiDream-I1_ComfyUI", "split_files/text_encoders/clip_l_hidream.safetensors"), bytes: 247_586_528, sha256: "706fdb88e22e18177b207837c02f4b86a652abca0302821f2bfa24ac6aea4f71" }],
  hidream_clip_g: [{ file: "clip_g_hidream.safetensors", url: hf("Comfy-Org/HiDream-I1_ComfyUI", "split_files/text_encoders/clip_g_hidream.safetensors"), bytes: 1_389_743_104, sha256: "3771e70e36450e5199f30bad61a53faae85a2e02606974bcda0a6a573c0519d5" }]
};

// Vision encoders that read a start image for image-to-video models (models/clip_vision).
export const visionDownloads = {
  sigclip_384: [{ file: "sigclip_vision_patch14_384.safetensors", url: hf("Comfy-Org/sigclip_vision_384", "sigclip_vision_patch14_384.safetensors"), bytes: 856_505_640, sha256: "1fee501deabac72f0ed17610307d7131e3e9d1e838d0363aa3c2b97a6e03fb33" }]
};

/** Which vision encoder a clip_vision file is, by name (they have no other use here). */
export const visionKinds = {
  sigclip_384: { label: "SigLIP vision (384)", test: /sig(clip|lip).*384|384.*sig(clip|lip)/i }
};

export const vaeDownloads = {
  sd15: [{ file: "vae-ft-mse-840000-ema-pruned.safetensors", url: hf("stabilityai/sd-vae-ft-mse-original", "vae-ft-mse-840000-ema-pruned.safetensors"), bytes: 334_641_190, sha256: "735e4c3a447a3255760d7f86845f09f937809baa529c17370d83e4c3758f3c75" }],
  sdxl: [{ file: "sdxl_vae.safetensors", url: hf("stabilityai/sdxl-vae", "sdxl_vae.safetensors"), bytes: 334_641_164, sha256: "63aeecb90ff7bc1c115395962d3e803571385b61938377bc7089b36e81e92e2e" }],
  flux1: [{ file: "ae.safetensors", url: hf("Comfy-Org/Lumina_Image_2.0_Repackaged", "split_files/vae/ae.safetensors"), bytes: 335_304_388, sha256: "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38" }],
  // SD3.5's VAE only ships inside its checkpoints or Stability's gated repo.
  sd3: [],
  aura: [{ file: "pony-v7-vae.fp16.safetensors", url: hf("purplesmartai/pony-v7-base", "vae/diffusion_pytorch_model.fp16.safetensors"), bytes: 167_335_342, sha256: "bcb60880a46b63dea58e9bc591abe15f8350bde47b405f9c38f4be70c6161e68" }],
  flux2: [{ file: "flux2-vae.safetensors", url: hf("Comfy-Org/flux2-dev", "split_files/vae/flux2-vae.safetensors"), bytes: 336_213_556, sha256: "d64f3a68e1cc4f9f4e29b6e0da38a0204fe9a49f2d4053f0ec1fa1ca02f9c4b5" }],
  wan21: [{ file: "wan_2.1_vae.safetensors", url: hf("Comfy-Org/Wan_2.1_ComfyUI_repackaged", "split_files/vae/wan_2.1_vae.safetensors"), bytes: 253_815_318, sha256: "2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b" }],
  wan22: [{ file: "wan2.2_vae.safetensors", url: hf("Comfy-Org/Wan_2.2_ComfyUI_Repackaged", "split_files/vae/wan2.2_vae.safetensors"), bytes: 1_409_400_960, sha256: "e40321bd36b9709991dae2530eb4ac303dd168276980d3e9bc4b6e2b75fed156" }],
  qwen_image: [{ file: "qwen_image_vae.safetensors", url: hf("Comfy-Org/Qwen-Image_ComfyUI", "split_files/vae/qwen_image_vae.safetensors"), bytes: 253_806_246, sha256: "a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f" }],
  qwen_image_21: [{ file: "qwen_image_2.1_vae_bf16.safetensors", url: hf("Comfy-Org/Qwen-Image-2.1", "vae/qwen_image_2.1_vae_bf16.safetensors"), bytes: 675_509_688, sha256: "bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9" }],
  hunyuan15: [{ file: "hunyuanvideo15_vae_fp16.safetensors", url: hf("Comfy-Org/HunyuanVideo_1.5_repackaged", "split_files/vae/hunyuanvideo15_vae_fp16.safetensors"), bytes: 2_521_292_758, sha256: "e7c3091949c27e2d55ae6d5df917b99dadfebbf308e5a50d0ade0d16c90297ae" }],
  h3_video: [{ file: "minimax_h3_video_vae_int8_convrot.safetensors", url: hf("Comfy-Org/MiniMax-H3", "vae/minimax_h3_video_vae_int8_convrot.safetensors"), bytes: 2_811_065_184, sha256: "52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e" }],
  h3_audio: [{ file: "minimax_h3_audio_vae_fp32.safetensors", url: hf("Comfy-Org/MiniMax-H3", "vae/minimax_h3_audio_vae_fp32.safetensors"), bytes: 605_254_808, sha256: "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48" }],
  mage_flow: [{ file: "mage_flow_vae_bf16.safetensors", url: hf("Comfy-Org/Mage-Flow", "vae/mage_flow_vae_bf16.safetensors"), bytes: 345_053_056, sha256: "34e076dc1e8a15321e1e07be5111d59cf16dd10b804b7c7e20b4de29013427e0" }]
};

// Second model files a family runs next to the one you pick (see `pair`).
// Comfy-Org's fp8_scaled halves are quantized fp8 (see fp8 on encoderDownloads).
const wan22 = (file, bytes, sha256) => [{ file, ...(file.includes("fp8_scaled") ? { fp8: true } : {}), url: hf("Comfy-Org/Wan_2.2_ComfyUI_Repackaged", `split_files/diffusion_models/${file}`), bytes, sha256 }];
export const modelDownloads = {
  wan22_t2v_low_fp8: wan22("wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors", 14_293_923_632, "e71b96d7c82e638694c5e7fb98fac4bfb0e4ddc5fbbb4b1df40da8f0f1278a97"),
  wan22_t2v_low_fp16: wan22("wan2.2_t2v_low_noise_14B_fp16.safetensors", 28_577_095_592, "431d1613ffa809ae1f735b661a01788c6d74991f51efd01f45d5aee955ccd224"),
  wan22_i2v_low_fp8: wan22("wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors", 14_294_742_832, "5471a457b6ac404202a5fbe6c11595a3d5641fc766b00f38763f72303fffc21e"),
  wan22_i2v_low_fp16: wan22("wan2.2_i2v_low_noise_14B_fp16.safetensors", 28_577_914_792, "edb89340c8a6fbf1a70e76a839ae01eaf7d289f05ea1ebd6b1a3fc6f533826e9"),
  ideogram4_uncond_fp8: [{ file: "ideogram4_unconditional_fp8_scaled.safetensors", fp8: true, url: hf("Comfy-Org/Ideogram-4", "diffusion_models/ideogram4_unconditional_fp8_scaled.safetensors"), bytes: 9_280_741_293, sha256: "9b359007dae162cca7591d00868feea733eb7c56e56e3a214a4d5a9a2a07cd60" }],
  ideogram4_uncond_int8: [{ file: "ideogram4_unconditional_int8_convrot.safetensors", url: hf("Comfy-Org/Ideogram-4", "diffusion_models/ideogram4_unconditional_int8_convrot.safetensors"), bytes: 9_583_465_712, sha256: "cd03ed94f244c9cb705e7d30ca0f40b5f5b004bb20674117adff88d16416c23d" }],
  // Starter models (see starterModels below).
  krea2_turbo_fp8: [{ file: "krea2_turbo_fp8_scaled.safetensors", fp8: true, label: "Krea 2 Turbo", url: hf("Comfy-Org/Krea-2", "diffusion_models/krea2_turbo_fp8_scaled.safetensors"), bytes: 13_141_730_784, sha256: "eb4dd8c612cfd10f64f25b057e6e6bbcb5737c94a7372177e456dbf7579502f1" }],
  krea2_turbo_bf16: [{ file: "krea2_turbo_bf16.safetensors", label: "Krea 2 Turbo", url: hf("Comfy-Org/Krea-2", "diffusion_models/krea2_turbo_bf16.safetensors"), bytes: 26_283_332_608, sha256: "78bbf8f4165eda19cea3cb06c78089221932a39e2eed8af9da741f942c47ffb3" }],
  krea2_raw_bf16: [{ file: "krea2_raw_bf16.safetensors", label: "Krea 2 Raw", url: hf("Comfy-Org/Krea-2", "diffusion_models/krea2_raw_bf16.safetensors"), bytes: 26_283_332_608, sha256: "f99bb0ff8e362b77342bc4994e0c50906fe7ef7074864b181b7d48d2fa6d03d7" }],
  flux2_klein_4b_fp8: [{ file: "flux-2-klein-4b-fp8.safetensors", fp8: true, label: "Flux.2 Klein 4B", url: hf("black-forest-labs/FLUX.2-klein-4b-fp8", "flux-2-klein-4b-fp8.safetensors"), bytes: 4_070_624_520, sha256: "97ed34fe0567e436200f2faee3939b88f2b5d99f8af2a4dc16532c4245c0ccb6" }],
  flux2_klein_4b: [{ file: "flux-2-klein-4b.safetensors", label: "Flux.2 Klein 4B", url: hf("Comfy-Org/vae-text-encorder-for-flux-klein-4b", "split_files/diffusion_models/flux-2-klein-4b.safetensors"), bytes: 7_751_105_712, sha256: "ec3d4e733a771f61c052fb4856c48b336c55eaf2c65487c2a1faeb9bbda7a343" }],
  flux2_dev_fp8: [{ file: "flux2_dev_fp8mixed.safetensors", fp8: true, label: "Flux.2 Dev", url: hf("Comfy-Org/flux2-dev", "split_files/diffusion_models/flux2_dev_fp8mixed.safetensors"), bytes: 35_455_599_592, sha256: "863a82e4ff950a42a6b0e80bea824828f129eb1a8fbbdbd9e8cb29859127b486" }]
};

// Whole checkpoints (model, text encoders and VAE in one file), for models/checkpoints.
export const checkpointDownloads = {
  realvisxl5_lightning: [{ file: "RealVisXL_V5.0_Lightning_fp16.safetensors", label: "RealVisXL V5.0 Lightning", url: hf("SG161222/RealVisXL_V5.0_Lightning", "RealVisXL_V5.0_Lightning_fp16.safetensors"), bytes: 6_938_065_512, sha256: "fabcadd9330dcc4f9702063428d40b9d4d07168d8acefc819b8d1d9db466b3ec" }],
  realvisxl5: [{ file: "RealVisXL_V5.0_fp16.safetensors", label: "RealVisXL V5.0", url: hf("SG161222/RealVisXL_V5.0", "RealVisXL_V5.0_fp16.safetensors"), bytes: 6_938_065_488, sha256: "6a35a7855770ae9820a3c931d4964c3817b6d9e3c6f9c4dabb5b3a94e5643b80" }],
  sdxl_base: [{ file: "sd_xl_base_1.0.safetensors", label: "SDXL 1.0", url: hf("stabilityai/stable-diffusion-xl-base-1.0", "sd_xl_base_1.0.safetensors"), bytes: 6_938_078_334, sha256: "31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b" }]
};

/**
 * First models for an empty studio: three families, each in three versions
 * sized for different amounts of memory, small to large. Every file is
 * ungated, so one tap fetches it all without a Hugging Face login.
 *
 * model: the catalog download of the model file. encoders: a slot's download
 * when it is not the slot's first. memory: GPU memory (GB) the version runs
 * comfortably in. appleMemory: what a Mac would need instead (the size at full
 * precision), and appleDetail how the version is described there. A model
 * download flagged `fp8` cannot load on a Mac (docs/hardware-notes.md), so
 * there that version never counts as fitting. ram: system memory it wants
 * besides. The studio highlights the largest version that fits and never
 * hides the others.
 */
export const starterModels = [
  {
    family: "krea2", title: "Krea 2", blurb: "Photographic, with natural light and real texture.",
    versions: [
      { id: "turbo-fp8", label: "Turbo", detail: "8 steps · compact", appleDetail: "8 steps · fp8, not for Macs", model: "model:krea2_turbo_fp8:0", memory: 16, appleMemory: 32 },
      { id: "turbo", label: "Turbo", detail: "8 steps · full precision", model: "model:krea2_turbo_bf16:0", memory: 32, ram: 48 },
      { id: "raw", label: "Raw", detail: "28 steps · follows a negative prompt", model: "model:krea2_raw_bf16:0", memory: 32, ram: 48 }
    ]
  },
  {
    family: "flux2_klein_4b", title: "Flux.2", blurb: "Quick and versatile, and it can work from reference images.",
    versions: [
      { id: "klein-fp8", label: "Klein 4B", detail: "4 steps · compact", appleDetail: "4 steps · fp8, not for Macs", model: "model:flux2_klein_4b_fp8:0", memory: 8, appleMemory: 12 },
      { id: "klein", label: "Klein 4B", detail: "4 steps · full precision", model: "model:flux2_klein_4b:0", memory: 12 },
      { id: "dev", label: "Dev", family: "flux2_dev", detail: "28 steps · the largest Flux", appleDetail: "28 steps · fp8, not for Macs", model: "model:flux2_dev_fp8:0", encoders: { encoder: "encoder:mistral3_24b:0" }, memory: 32, appleMemory: 80, ram: 64 }
    ]
  },
  {
    family: "sdxl", title: "SDXL", blurb: "Light and quick, with the largest world of LoRAs.",
    versions: [
      { id: "lightning", label: "RealVisXL Lightning", detail: "6 steps · fastest", model: "checkpoint:realvisxl5_lightning:0", memory: 6 },
      { id: "realvis", label: "RealVisXL", detail: "25 steps · photographic", model: "checkpoint:realvisxl5:0", memory: 8 },
      { id: "base", label: "SDXL 1.0", detail: "25 steps · the original, for its LoRAs", model: "checkpoint:sdxl_base:0", memory: 8 }
    ]
  }
];

/* ------------------------------------------------------------ Families */

const square = [["1:1", 1, 1], ["16:9", 16, 9], ["9:16", 9, 16], ["4:3", 4, 3], ["3:4", 3, 4], ["2.35:1", 235, 100]];
const portraitFirst = [["2:3", 2, 3], ["1:1", 1, 1], ["3:2", 3, 2], ["16:9", 16, 9], ["9:16", 9, 16], ["4:3", 4, 3], ["3:4", 3, 4]];
const wide = [["16:9", 16, 9], ["9:16", 9, 16], ["1:1", 1, 1], ["4:3", 4, 3], ["3:4", 3, 4], ["2.35:1", 235, 100]];

const speedName = /lightning|dmd2?|hyper|turbo|lcm|pcm|\d+[-_ ]?steps?|tcd|flash/i;
const hy15Shift = (shift) => ({ node: "ModelSamplingSD3", shift });

/**
 * slots: text encoder inputs in loader order. kinds: accepted encoder kinds;
 * only: a name a file of that kind must also have, where the model needs its
 * own build of an encoder whose shapes others share (the header cannot tell
 * them apart), with `detail` saying why when it is missing.
 * vae: accepted VAE kinds (first is the one to download). sampling: "ksampler",
 * "custom" (SamplerCustomAdvanced), "pair" (Wan 2.2 14B), "h3", "sana",
 * "ideogram4" (two models through a dual guider), "mage" (its own encode node).
 * pair: a second model file the family runs next to the picked one (see pairSpec).
 * promptPrefix / negativePrefix: system text the model was trained to see first.
 * imageToVideo: `latent` is an image-to-video node (WanImageToVideo and the
 * like) that takes both conditionings, the VAE and the start image, and hands
 * back conditionings and latent; startImage: "required" makes the composer ask
 * for that picture. clipVision: vision encoder kinds that also read it.
 * refines: a family the detection finds, which a name pattern narrows to this
 * one (the weights cannot tell them apart); weightsTell: only when the weights
 * were out of reach, because they can. excludes: a name that marks a sibling
 * with the same layout, which is `as` (a knownFamilies id) instead.
 * pack: a node-packs.js id when the family runs on custom nodes. ownLoaders:
 * the pack loads encoder and VAE itself (no pickers, no LoRAs).
 * variants: first whose `match` passes wins; the last one is the fallback.
 * A variant's `apple` replaces some of its defaults when ComfyUI runs on Apple
 * Silicon (MPS), where a setting is known to break; `stepsFromName` takes the
 * steps from a count in the file name ("…_4step"), for files distilled for
 * exactly that many (see variantDefaults).
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
    // SD 2.0 and 2.1 come as 768 px v-prediction models and 512 px "base" ones
    // (v2-1_512-ema-pruned, 512-base-ema); the weights look the same.
    variants: [
      { id: "base", label: "Base (512)", match: (name) => /512|(^|[^a-z])base([^a-z]|$)/i.test(name), size: [512, 512], defaults: { steps: 25, cfg: 7, sampler: "dpmpp_2m", scheduler: "karras" } },
      { id: "standard", label: "SD 2.x", defaults: { steps: 25, cfg: 7, sampler: "dpmpp_2m", scheduler: "karras" } }
    ],
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
      { id: "dmd2", label: "DMD2", match: (name) => /dmd/i.test(name), defaults: { steps: 4, cfg: 1, sampler: "lcm", scheduler: "sgm_uniform" } },
      { id: "lcm", label: "LCM", match: (name) => /lcm|pcm|tcd/i.test(name), defaults: { steps: 6, cfg: 1.5, sampler: "lcm", scheduler: "sgm_uniform" } },
      // SDXL-Lightning's steps must equal the count its file is distilled for (2, 4 or 8); DMD2's card uses 4.
      { id: "lightning", label: "Lightning", match: (name) => /lightning|turbo|\d+[-_ ]?steps?/i.test(name), stepsFromName: true, defaults: { steps: 6, cfg: 1, sampler: "euler", scheduler: "sgm_uniform" } },
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
    references: 3,
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
    references: 3,
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
    references: 3,
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
      // HiDream's CLIPs are its own fine-tunes with the same shapes as everyone
      // else's; Flux's clip_l gives black images (ComfyUI issue 7715).
      { slot: "clip_l", label: "CLIP-L (HiDream)", kinds: ["clip_l"], only: /hidream/i, download: "hidream_clip_l", detail: "HiDream needs its own CLIP-L (clip_l_hidream). Flux’s gives black images." },
      { slot: "clip_g", label: "CLIP-G (HiDream)", kinds: ["clip_g"], only: /hidream/i, download: "hidream_clip_g", detail: "HiDream is made for its own CLIP-G (clip_g_hidream)." },
      { slot: "t5", label: "T5-XXL", kinds: ["t5xxl"] },
      { slot: "llama", label: "Llama 3.1 8B", kinds: ["llama31_8b"] }
    ], clipType: null,
    vae: ["flux1"], latent: "EmptySD3LatentImage", sizeStep: 16, img2img: true, aspects: square,
    variants: [
      { id: "fast", label: "Fast", match: (name) => /fast/i.test(name), negative: "zero", modelSampling: { node: "ModelSamplingSD3", shift: 3 }, defaults: { steps: 16, cfg: 1, sampler: "lcm", scheduler: "normal" } },
      { id: "dev", label: "Dev", match: (name) => /dev/i.test(name), negative: "zero", modelSampling: { node: "ModelSamplingSD3", shift: 6 }, defaults: { steps: 28, cfg: 1, sampler: "lcm", scheduler: "normal" } },
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
      // Qwen-Image-Lightning comes as 4-step and 8-step builds; each wants its own count.
      { id: "fast", label: "Lightning", match: (name) => speedName.test(name), negative: "text", stepsFromName: true, defaults: { steps: 8, cfg: 1, sampler: "euler", scheduler: "simple" } },
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
    // Edits: its text encoder reads reference images (up to 16; the composer offers three).
    references: 3, referenceVia: "encoder",
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
    // The card: er_sde as the default sampler (both Comfy-Org templates use it);
    // Anima-Turbo "at CFG 1 and 8-12 steps", where euler suits it best.
    variants: [
      { id: "turbo", label: "Turbo", match: (name) => speedName.test(name), negative: "zero", defaults: { steps: 10, cfg: 1, sampler: "euler", scheduler: "simple" } },
      { id: "standard", label: "Anima", defaults: { steps: 30, cfg: 4, sampler: "er_sde", scheduler: "simple" } }
    ],
    size: [1024, 1024]
  },
  wan21: {
    label: "Wan 2.1", kind: "video", sources: ["unet", "checkpoint"],
    slots: [{ slot: "encoder", label: "UMT5-XXL", kinds: ["umt5xxl"] }], clipType: "wan",
    vae: ["wan21"], latent: "EmptyHunyuanLatentVideo", sizeStep: 16, frameStep: 4, negative: "text", aspects: wide,
    modelSampling: { node: "ModelSamplingSD3", shift: 8 },
    variants: [
      { id: "fast", label: "Fast", match: (name) => speedName.test(name) || /causvid|lightx2v|self[-_]?forcing/i.test(name), defaults: { steps: 6, cfg: 1, sampler: "euler", scheduler: "simple" } },
      // uni_pc corrupts video on Apple Silicon (float32 rounding in its
      // coefficients; ComfyUI issues 7027, 15921, 16573), euler does not.
      { id: "standard", label: "Wan 2.1", apple: { sampler: "euler" }, defaults: { steps: 30, cfg: 6, sampler: "uni_pc", scheduler: "simple" } }
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
      { id: "standard", label: "Wan 2.2 5B", apple: { sampler: "euler" }, defaults: { steps: 20, cfg: 5, sampler: "uni_pc", scheduler: "simple" } }
    ],
    size: [1280, 704], frames: 121, fps: 24
  },
  wan22_14b: {
    label: "Wan 2.2 14B", kind: "video", sources: ["unet"],
    // Wan 2.1 14B and Wan 2.2 14B share every key; the high/low-noise pair is a naming convention.
    refines: { family: "wan21", name: /(high|low)[-_ ]?noise/i },
    pair: {
      owns: /^(?!.*i2v).*wan/i, isPartner: (base) => /low[-_ ]?noise/i.test(base),
      partnerOf: (name) => name.replace(/high([-_ ]?)noise/i, (_match, sep) => `low${sep}noise`),
      label: "Low-noise model", runsAs: "Runs as the second half of its high-noise model.",
      detail: (base) => `Wan 2.2 14B also needs the matching low-noise file next to ${base} in diffusion_models.`,
      // Comfy-Org's low-noise half of the same task and precision.
      download: (name) => `wan22_${/i2v/i.test(name) ? "i2v" : "t2v"}_low_${/fp16|bf16/i.test(name) ? "fp16" : "fp8"}`
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
  // Wan 2.2 14B image-to-video, as Comfy-Org's template runs it: WanImageToVideo
  // puts the start image into both conditionings and makes the latent, then the
  // high/low-noise pair samples at shift 5 (20 steps at CFG 3.5, or 4 at CFG 1
  // with the lightx2v LoRAs). Its weights take 36 input channels (the picture
  // and its mask ride along), which is how it is told from text-to-video.
  wan22_14b_i2v: {
    label: "Wan 2.2 14B I2V", kind: "video", sources: ["unet"],
    refines: { family: "wan22_14b", name: /i2v/i, weightsTell: true },
    // Wan 2.2 Fun inpaint shares this layout exactly; it needs its own nodes.
    excludes: { name: /fun[-_ ]|inpaint|camera|control|vace|animate|s2v/i, as: "wan_other" },
    pair: {
      owns: /wan.*i2v|i2v.*wan/i, isPartner: (base) => /low[-_ ]?noise/i.test(base),
      partnerOf: (name) => name.replace(/high([-_ ]?)noise/i, (_match, sep) => `low${sep}noise`),
      label: "Low-noise model", runsAs: "Runs as the second half of its high-noise model.",
      detail: (base) => `Wan 2.2 14B I2V also needs the matching low-noise file next to ${base} in diffusion_models.`,
      download: (name) => `wan22_i2v_low_${/fp16|bf16/i.test(name) ? "fp16" : "fp8"}`
    },
    slots: [{ slot: "encoder", label: "UMT5-XXL", kinds: ["umt5xxl"] }], clipType: "wan",
    vae: ["wan21"], latent: "WanImageToVideo", imageToVideo: true, startImage: "required",
    sizeStep: 16, frameStep: 4, negative: "text", sampling: "pair", aspects: wide,
    modelSampling: { node: "ModelSamplingSD3", shift: 5 },
    requiredNodes: ["WanImageToVideo", "LoadImage"],
    variants: [
      { id: "fast", label: "Fast (4-step)", match: (name) => speedName.test(name) || /lightx2v|rapid/i.test(name), defaults: { steps: 4, cfg: 1, sampler: "euler", scheduler: "simple" } },
      { id: "standard", label: "Wan 2.2 14B I2V", defaults: { steps: 20, cfg: 3.5, sampler: "euler", scheduler: "simple" } }
    ],
    // The template's 640×640 is the area; the aspect follows the picture you pick.
    size: [832, 480], frames: 81, fps: 16
  },
  hunyuan15: {
    label: "HunyuanVideo 1.5", kind: "video", sources: ["unet", "checkpoint"],
    slots: [
      { slot: "encoder", label: "Qwen2.5-VL 7B", kinds: ["qwen25vl_7b"] },
      { slot: "glyph", label: "ByT5 Glyph", kinds: ["byt5_glyph"] }
    ], clipType: "hunyuan_video_15",
    vae: ["hunyuan15"], latent: "EmptyHunyuanVideo15Latent", sizeStep: 16, frameStep: 4, negative: "text", aspects: wide,
    // Tencent's table (model card): shift 5 at 480p, 9 for 720p text-to-video.
    // Comfy-Org's 720p template keeps 20 steps for time; the CFG-distilled
    // models "must use 50 steps to generate correct results".
    modelSampling: hy15Shift(5),
    requiredNodes: ["EmptyHunyuanVideo15Latent"],
    variants: [
      // Tencent ships step-distilled weights for 480p image-to-video only; lightx2v's
      // 4-step 480p text-to-video build runs without CFG at shift 9 (its README).
      { id: "fast", label: "Fast (4-step)", match: (name) => speedName.test(name) || /lightx2v/i.test(name), stepsFromName: true, modelSampling: hy15Shift(9), defaults: { steps: 4, cfg: 1, sampler: "euler", scheduler: "simple" } },
      { id: "cfg_distilled_720", label: "720p CFG-distilled", match: (name) => /cfg[-_ ]?distill/i.test(name) && /720p/i.test(name), size: [1280, 720], modelSampling: hy15Shift(9), defaults: { steps: 50, cfg: 1, sampler: "euler", scheduler: "simple" } },
      { id: "cfg_distilled", label: "CFG-distilled", match: (name) => /cfg[-_ ]?distill/i.test(name), defaults: { steps: 50, cfg: 1, sampler: "euler", scheduler: "simple" } },
      { id: "p720", label: "720p", match: (name) => /720p/i.test(name), size: [1280, 720], modelSampling: hy15Shift(9), defaults: { steps: 20, cfg: 6, sampler: "euler", scheduler: "simple" } },
      { id: "standard", label: "HunyuanVideo 1.5", defaults: { steps: 20, cfg: 6, sampler: "euler", scheduler: "simple" } }
    ],
    size: [848, 480], frames: 121, fps: 24
  },
  // HunyuanVideo 1.5 image-to-video (Comfy-Org's 720p I2V template): the start
  // image goes in through HunyuanVideo15ImageToVideo and, read by a SigLIP
  // vision encoder, as guidance; 20 steps at CFG 6. Shift follows Tencent's
  // table: 5 at 480p, 7 at 720p and for the 480p step-distilled model. The I2V
  // weights have the same layout as text-to-video, so only the name tells them apart.
  hunyuan15_i2v: {
    label: "HunyuanVideo 1.5 I2V", kind: "video", sources: ["unet", "checkpoint"],
    refines: { family: "hunyuan15", name: /i2v/i },
    slots: [
      { slot: "encoder", label: "Qwen2.5-VL 7B", kinds: ["qwen25vl_7b"] },
      { slot: "glyph", label: "ByT5 Glyph", kinds: ["byt5_glyph"] }
    ], clipType: "hunyuan_video_15",
    vae: ["hunyuan15"], latent: "HunyuanVideo15ImageToVideo", imageToVideo: true, startImage: "required", clipVision: ["sigclip_384"],
    sizeStep: 16, frameStep: 4, negative: "text", aspects: wide,
    modelSampling: hy15Shift(5),
    requiredNodes: ["HunyuanVideo15ImageToVideo", "CLIPVisionLoader", "CLIPVisionEncode", "LoadImage"],
    variants: [
      { id: "step_distilled", label: "Step-distilled", match: (name) => /step[-_ ]?distill/i.test(name) || speedName.test(name), modelSampling: hy15Shift(7), defaults: { steps: 8, cfg: 1, sampler: "euler", scheduler: "simple" } },
      { id: "cfg_distilled_720", label: "720p CFG-distilled", match: (name) => /cfg[-_ ]?distill/i.test(name) && /720p/i.test(name), size: [1280, 720], modelSampling: hy15Shift(7), defaults: { steps: 50, cfg: 1, sampler: "euler", scheduler: "simple" } },
      { id: "cfg_distilled", label: "CFG-distilled", match: (name) => /cfg[-_ ]?distill/i.test(name), defaults: { steps: 50, cfg: 1, sampler: "euler", scheduler: "simple" } },
      { id: "p720", label: "720p", match: (name) => /720p/i.test(name), size: [1280, 720], modelSampling: hy15Shift(7), defaults: { steps: 20, cfg: 6, sampler: "euler", scheduler: "simple" } },
      { id: "standard", label: "HunyuanVideo 1.5 I2V", defaults: { steps: 20, cfg: 6, sampler: "euler", scheduler: "simple" } }
    ],
    size: [848, 480], frames: 121, fps: 24
  },
  minimax_h3: {
    label: "MiniMax H3", kind: "video", sources: ["unet", "checkpoint"], audio: true,
    slots: [{ slot: "encoder", label: "Qwen3-VL 32B", kinds: ["qwen3vl_32b"] }], clipType: "minimax",
    vae: ["h3_video"], audioVae: ["h3_audio"], latent: "MiniMaxH3ImageToVideo", sizeStep: 32, negative: "none", sampling: "h3", aspects: wide,
    requiredNodes: ["MiniMaxH3ImageToVideo", "SamplerCustomAdvanced", "BasicGuider", "VAEDecodeAudio", "CreateVideo"],
    variants: [
      // Turbo is distilled for 4 or 8 steps (lightx2v's LoRAs); Comfy-Org's template runs the 8-step one.
      { id: "fast", label: "Turbo", match: (name) => speedName.test(name), stepsFromName: true, defaults: { steps: 8, cfg: 1, sampler: "res_multistep", scheduler: "simple" } },
      { id: "standard", label: "MiniMax H3", defaults: { steps: 20, cfg: 1, sampler: "res_multistep", scheduler: "simple" } }
    ],
    // 5 seconds, as the template and the node's own default: H3 is trained on 5 to 15 s.
    size: [1344, 768], frames: 124, fps: 24
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
    note: "Sana isn’t built into ComfyUI. These custom nodes run it.",
    sizeNode: sanaLatentNode
  },
  sana_diffusers: {
    pack: "comfyui_sana", note: "Sana isn’t built into ComfyUI. These custom nodes run it, on Apple Silicon too.",
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
  ltx: "LTX-2 video (needs its two-stage audio pipeline)",
  ltxv: "LTX-Video",
  hunyuan_video: "HunyuanVideo 1.0",
  newbie: "NewBie (Lumina-based, needs its own text encoders)",
  wan_i2v: "Wan 2.1 image-to-video (needs CLIP vision)",
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
    // Only a name that starts as Pony V7 does ("pony-v7-base"): SDXL merges named
    // "CyberRealistic Pony v7" or "ponyXL v7" are SDXL.
    ["auraflow", /^(?!.*xl)pony[-_ ]?(diffusion[-_ ]?)?v7(?!\d)|auraflow/i],
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
    // Wan 2.2 14B I2V: the picture and its mask ride in as 20 more input channels, with no CLIP vision (Wan 2.1's has img_emb).
    if (!has("img_emb.proj.0.bias") && dim(keys, "patch_embedding.weight", 1) === 36 && dim(keys, "head.modulation", -1) === 5120) return { family: "wan22_14b_i2v" };
    if (has("img_emb.proj.0.bias") || dim(keys, "patch_embedding.weight", 1) >= 36) return { family: "wan_i2v" };
    // Wan 2.2 14B and Wan 2.1 14B share every key; the high/low-noise pair is a naming convention.
    return { family: "wan21", detail: { width: dim(keys, "head.modulation", -1) } };
  }
  if (has("caption_projection.0.linear.weight")) return { family: "hidream" };
  if (has("blocks.0.mlp.layer1.weight")) {
    return has("llm_adapter.blocks.0.cross_attn.q_proj.weight") ? { family: "anima" } : { family: "cosmos" };
  }
  // Qwen-Image 2.1 renamed Qwen-Image's text input (txt_in.text_norm, no txt_norm) and fused its MLP.
  if (["txt_in.text_norm.weight", "modulation.1.weight", "transformer_blocks.0.attn.norm_q.weight", "img_in.weight", "proj_out.weight"].every(has)
    && (has("transformer_blocks.0.img_mlp.gate_up.weight") || has("transformer_blocks.0.img_mlp.proj.weight"))) return { family: "qwen_image_21" };
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
  // No signature we know: an architecture newer than this build, so its name gets a say.
  return { family: "other", detail: { unrecognized: true } };
}

/* ------------------------------------------------------------ Quantized files */

/**
 * Quantized formats ComfyUI's own loaders cannot read. The family detection
 * above still names the model (an NF4 Flux keeps Flux's keys), but the file
 * only runs through its format's loader, so it is never "ready" without one.
 * `loaders`: per model source, the node that loads it in place of ComfyUI's
 * own (same inputs), from `pack`. No loader for a source: not runnable here,
 * and `reason` says why.
 */
export const quantFormats = {
  svdq: {
    label: "Nunchaku SVDQuant",
    loaders: {},
    reason: "A Nunchaku (SVDQuant) file. These only run through the ComfyUI-nunchaku loader nodes, which aren’t supported yet. Use a regular or GGUF build of this model."
  },
  nf4: {
    label: "bitsandbytes NF4",
    pack: "bnb_nf4",
    loaders: { checkpoint: "CheckpointLoaderNF4" },
    reason: "A bitsandbytes NF4 file outside checkpoints/. Only the NF4 checkpoint loader reads these. Put the all-in-one NF4 checkpoint in checkpoints/, or use a regular build."
  }
};

// Tensor suffixes each format adds next to (or instead of) the plain weights.
const quantMarkers = [
  ["svdq", /\.(qweight|wscales|wcscales|wtscale|smooth_factor|smooth_factor_orig)$/],
  ["nf4", /\.(absmax|quant_map|nested_absmax|nested_quant_map|quant_state\.bitsandbytes__(nf4|fp4))$/]
];

/**
 * Which quantized format a file is in, from its tensor keys, else its
 * metadata; by name only when the weights are out of reach. "" for anything
 * ComfyUI loads natively (fp8, int8 ConvRot, NVFP4 and the like).
 */
export function quantFromHeader(header, name = "") {
  if (header) {
    for (const key of Object.keys(header)) {
      if (key === "__metadata__") continue;
      const found = quantMarkers.find(([, pattern]) => pattern.test(key));
      if (found) return found[0];
    }
    const metadata = JSON.stringify(header.__metadata__ || {});
    if (/nunchaku|svdquant|svdq/i.test(metadata)) return "svdq";
    if (/bitsandbytes|bnb[-_]?nf4/i.test(metadata)) return "nf4";
    return "";
  }
  const base = String(name).split(/[\\/]/).pop() || "";
  if (/svdq|nunchaku/i.test(base)) return "svdq";
  if (/(^|[^a-z])(bnb[-_]?)?nf4([^a-z]|$)/i.test(base)) return "nf4";
  return "";
}

/**
 * The family a detected one narrows to by name (see `refines`): Wan 2.1 14B
 * named high/low noise is Wan 2.2 14B, and HunyuanVideo 1.5 named i2v is its
 * image-to-video model. A refinement the weights can make is only taken from
 * the name when they were out of reach.
 */
export function refinedFamily(familyId = "", name = "", weightsRead = false) {
  const base = String(name).split(/[\\/]/).pop() || "";
  let id = familyId;
  for (let step = 0; step < 4; step += 1) {
    const next = Object.entries(families).find(([, spec]) => spec.refines?.family === id && spec.refines.name.test(base) && !(weightsRead && spec.refines.weightsTell));
    if (!next) break;
    id = next[0];
  }
  // A sibling with the very same layout that only its name gives away, and that runs elsewhere.
  const excludes = families[id]?.excludes;
  return excludes && excludes.name.test(base) ? excludes.as : id;
}

/* ------------------------------------------------------------ Speed LoRAs */

/**
 * The settings a model file starts at: its variant's defaults, the step count
 * in its name where the variant is distilled for exactly that many
 * (`stepsFromName`), and the variant's `apple` overrides when ComfyUI runs on
 * Apple Silicon.
 */
export function variantDefaults(variant, name = "", { apple = false } = {}) {
  const steps = variant.stepsFromName ? stepsInName(name) : 0;
  return { ...variant.defaults, ...(steps ? { steps } : null), ...(apple ? variant.apple : null) };
}

/** "sdxl_lightning_4step", "Qwen-Image-Lightning-8steps-V1.1" → 4, 8; 0 when the name gives none. */
export function stepsInName(name = "") {
  const base = String(name).split(/[\\/]/).pop() || "";
  const match = /(?:^|[^a-z0-9.])(\d{1,2})[-_ ]?steps?(?![a-z])/i.exec(base);
  const steps = Number(match?.[1] || 0);
  return steps >= 1 && steps <= 50 ? steps : 0;
}

/** The variant of a family a file is, by name (and header where it can tell). */
export function variantFor(familyId, name = "", header = null, detail = null) {
  const family = families[familyId];
  if (!family) return null;
  const base = String(name).split(/[\\/]/).pop() || "";
  return family.variants.find((variant) => !variant.match || variant.match(base, header, detail)) || family.variants.at(-1);
}

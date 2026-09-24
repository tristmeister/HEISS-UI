import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Point ComfyUI and the data folder at a scratch tree before the modules read them.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-model-types-"));
process.env.HEISS_COMFY_ROOT = path.join(scratch, "ComfyUI");
process.env.HEISS_DATA_DIR = path.join(scratch, "data");
const dirs = Object.fromEntries(["diffusion_models", "checkpoints", "text_encoders", "vae"].map((name) => {
  const dir = path.join(scratch, "ComfyUI", "models", name);
  fs.mkdirSync(dir, { recursive: true });
  return [name, dir];
}));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { classifyModel, krea2RawShift, readSafetensorsHeader, setModelChoice } = await import("./model-families.js");
const { familyFromHeader } = await import("./family-catalog.js");
const { encoderKindFromHeader, vaeLayoutFromHeader } = await import("./model-components.js");
const { inferModels } = await import("./models.js");
const { familyGraph } = await import("./family-graph.js");
const { sanitizeGenerateBody } = await import("./validation.js");

/* ------------------------------------------------------------ fixtures */

const t = (shape) => ({ dtype: "F16", shape, data_offsets: [0, 0] });
// Real checkpoints carry thousands of prefixed keys; ComfyUI only trusts a prefix used more than five times.
const filler = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`filler.${index}.weight`, { dtype: "F16", shape: [1], data_offsets: [0, 0] }]));
const prefixed = (prefix, header) => Object.fromEntries(Object.entries({ ...header, ...filler }).map(([key, value]) => [`${prefix}${key}`, value]));

const headers = {
  krea2: { "txtfusion.projector.weight": t([3072, 12]), "first.weight": t([3072, 64]) },
  zimage: { "cap_embedder.1.weight": t([3840, 2560]), "noise_refiner.0.attention.k_norm.weight": t([128]) },
  fluxDev: { "double_blocks.0.img_attn.norm.key_norm.scale": t([128]), "img_in.weight": t([3072, 64]), "guidance_in.in_layer.weight": t([3072, 256]) },
  fluxSchnell: { "double_blocks.0.img_attn.norm.key_norm.scale": t([128]), "img_in.weight": t([3072, 64]) },
  klein4b: { "double_blocks.0.img_attn.norm.key_norm.scale": t([128]), "img_in.weight": t([3072, 128]), "double_stream_modulation_img.lin.weight": t([1, 1]), "txt_in.weight": t([3072, 7680]) },
  chroma: { "double_blocks.0.img_attn.norm.key_norm.scale": t([128]), "distilled_guidance_layer.norms.0.scale": t([1]) },
  sd3: { "joint_blocks.0.context_block.attn.qkv.weight": t([1, 1]) },
  wan5b: { "head.modulation": t([1, 2, 3072]), "head.head.weight": t([192, 3072]) },
  wan14b: { "head.modulation": t([1, 2, 5120]), "head.head.weight": t([64, 5120]), "patch_embedding.weight": t([5120, 16, 1, 2, 2]) },
  h3: { "video_patch_proj.weight": t([1, 1]), "audio_patch_proj.weight": t([1, 1]) },
  qwenImage: { "txt_norm.weight": t([3584]), "img_in.weight": t([3072, 64]) },
  hidream: { "caption_projection.0.linear.weight": t([1, 1]) },
  aura: { "double_layers.0.attn.w1q.weight": t([1, 1]) },
  sdxlUnet: { "input_blocks.0.0.weight": t([320, 4, 3, 3]), "input_blocks.4.1.transformer_blocks.0.attn2.to_k.weight": t([640, 2048]) },
  sd15Unet: { "input_blocks.0.0.weight": t([320, 4, 3, 3]), "input_blocks.1.1.transformer_blocks.0.attn2.to_k.weight": t([320, 768]) }
};

const encoders = {
  clip_l: { "text_model.encoder.layers.0.mlp.fc1.weight": t([3072, 768]) },
  clip_g: { "text_model.encoder.layers.30.mlp.fc1.weight": t([5120, 1280]) },
  t5xxl: { "encoder.block.23.layer.1.DenseReluDense.wi_1.weight": t([10240, 4096]), "shared.weight": t([32128, 4096]) },
  umt5: { "encoder.block.23.layer.1.DenseReluDense.wi_1.weight": t([10240, 4096]), "encoder.block.1.layer.0.SelfAttention.relative_attention_bias.weight": t([32, 64]) },
  qwen3_4b: { "model.layers.0.post_attention_layernorm.weight": t([2560]), "model.layers.0.self_attn.q_norm.weight": t([128]) },
  qwen3vl_4b: { "model.visual.deepstack_merger_list.0.norm.weight": t([1]), "model.visual.merger.linear_fc2.weight": t([2560, 1]) },
  qwen25vl: { "model.layers.0.self_attn.k_proj.bias": t([512]) }
};

const vaes = {
  kl4: { "decoder.conv_in.weight": t([512, 4, 3, 3]) },
  kl16: { "decoder.conv_in.weight": t([512, 16, 3, 3]) },
  flux2: { "decoder.conv_in.weight": t([512, 32, 3, 3]), "bn.running_mean": t([128]) },
  wan16: { "decoder.middle.0.residual.0.gamma": t([384]) },
  wan48: { "decoder.middle.0.residual.0.gamma": t([384]), "decoder.upsamples.0.upsamples.0.residual.2.weight": t([1]) }
};

function writeSafetensors(file, header) {
  const json = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(json.length));
  fs.writeFileSync(file, Buffer.concat([length, json]));
}

function put(folder, name, header) {
  writeSafetensors(path.join(dirs[folder], name), header);
  return name;
}

const list = (values) => ({ input: { required: values } });
const node = () => list({});

function objectInfo({ unets = [], checkpoints = [], clips = [], vaeFiles = [], clipTypes, extra = {} } = {}) {
  const nodes = ["CLIPTextEncode", "VAEDecode", "SaveImage", "EmptyLatentImage", "EmptySD3LatentImage", "EmptyFlux2LatentImage", "Flux2Scheduler",
    "SamplerCustomAdvanced", "CFGGuider", "BasicGuider", "BasicScheduler", "KSamplerSelect", "RandomNoise", "FluxGuidance", "ConditioningZeroOut",
    "ModelSamplingFlux", "ModelSamplingAuraFlow", "ModelSamplingSD3", "ModelSamplingDiscrete", "CLIPSetLastLayer", "KSamplerAdvanced",
    "EmptyHunyuanLatentVideo", "Wan22ImageToVideoLatent", "CreateVideo", "SaveVideo", "TripleCLIPLoader", "QuadrupleCLIPLoader", "T5TokenizerOptions",
    "LoadImage", "VAEEncode", "MiniMaxH3ImageToVideo", "VAEDecodeAudio", "EmptyHunyuanVideo15Latent"];
  return {
    ...Object.fromEntries(nodes.map((name) => [name, node()])),
    UNETLoader: list({ unet_name: [unets], weight_dtype: [["default", "fp8_e4m3fn"]] }),
    CheckpointLoaderSimple: list({ ckpt_name: [checkpoints] }),
    CLIPLoader: list({ clip_name: [clips], type: [clipTypes || ["stable_diffusion", "lumina2", "krea2", "qwen_image", "wan", "flux2", "chroma", "minimax"]] }),
    DualCLIPLoader: list({ clip_name1: [clips], clip_name2: [clips], type: [["sdxl", "flux", "hunyuan_video_15"]] }),
    VAELoader: list({ vae_name: [vaeFiles] }),
    LoraLoader: list({ lora_name: [["style.safetensors"]] }),
    KSampler: list({ sampler_name: [["euler", "euler_ancestral", "res_multistep", "uni_pc", "dpmpp_2m", "lcm", "ddim"]], scheduler: [["simple", "normal", "karras", "sgm_uniform", "beta"]] }),
    ...extra
  };
}

/* ------------------------------------------------------------ recognition */

test("safetensors headers are read from disk", () => {
  const file = put("diffusion_models", "roundtrip.safetensors", { __metadata__: { format: "pt" }, ...headers.krea2 });
  assert.deepEqual(readSafetensorsHeader(path.join(dirs.diffusion_models, file))["txtfusion.projector.weight"].shape, [3072, 12]);
});

test("model families come from the weights, in ComfyUI's order", () => {
  const family = (header) => familyFromHeader(header).family;
  assert.equal(family(headers.krea2), "krea2");
  assert.equal(family(headers.zimage), "zimage");
  assert.equal(family({ ...headers.zimage, "cap_embedder.1.weight": t([2304, 2304]) }), "lumina2");
  assert.equal(family(headers.fluxDev), "flux1");
  assert.equal(familyFromHeader(headers.fluxSchnell).detail.schnell, true);
  assert.equal(family(headers.klein4b), "flux2_klein_4b");
  assert.equal(family({ ...headers.klein4b, "txt_in.weight": t([3072, 12288]) }), "flux2_klein_9b");
  assert.equal(family({ ...headers.klein4b, "txt_in.weight": t([6144, 15360]) }), "flux2_dev");
  assert.equal(family(headers.chroma), "chroma");
  assert.equal(family(headers.sd3), "sd3");
  assert.equal(family(headers.wan5b), "wan22_5b");
  assert.equal(family(headers.wan14b), "wan21");
  assert.equal(family(headers.h3), "minimax_h3");
  assert.equal(family(headers.qwenImage), "qwen_image");
  assert.equal(family(headers.hidream), "hidream");
  assert.equal(family(headers.aura), "auraflow");
  assert.equal(family(prefixed("model.diffusion_model.", headers.sdxlUnet)), "sdxl", "all-in-one checkpoints carry a prefix");
  assert.equal(family(prefixed("model.diffusion_model.", headers.sd15Unet)), "sd15");
});

test("text encoders and VAEs are told apart by shape", () => {
  assert.equal(encoderKindFromHeader(encoders.clip_l), "clip_l");
  assert.equal(encoderKindFromHeader(encoders.clip_g), "clip_g");
  assert.equal(encoderKindFromHeader(encoders.t5xxl), "t5xxl");
  assert.equal(encoderKindFromHeader(encoders.umt5), "umt5xxl", "UMT5 keeps a position bias in every block");
  assert.equal(encoderKindFromHeader(encoders.qwen3_4b), "qwen3_4b");
  assert.equal(encoderKindFromHeader(encoders.qwen3vl_4b), "qwen3vl_4b");
  assert.equal(encoderKindFromHeader(encoders.qwen25vl), "qwen25vl_7b");
  assert.equal(vaeLayoutFromHeader(vaes.kl4), "kl4");
  assert.equal(vaeLayoutFromHeader(vaes.kl16), "kl16");
  assert.equal(vaeLayoutFromHeader(vaes.flux2), "flux2");
  assert.equal(vaeLayoutFromHeader(vaes.wan16), "wan16");
  assert.equal(vaeLayoutFromHeader(vaes.wan48), "wan48");
});

test("the weights win over the filename, and names fill in when files are out of reach", () => {
  put("diffusion_models", "krea2_but_actually_flux.safetensors", headers.fluxDev);
  put("diffusion_models", "myRealismMix_v2.safetensors", headers.krea2);
  assert.equal(classifyModel("unet", "krea2_but_actually_flux.safetensors").family, "flux1");
  assert.deepEqual([classifyModel("unet", "myRealismMix_v2.safetensors").family, classifyModel("unet", "myRealismMix_v2.safetensors").via], ["krea2", "file"]);
  assert.equal(classifyModel("unet", "remote/flux1-krea-dev.safetensors").family, "flux1", "FLUX.1 Krea is Flux");
  assert.equal(classifyModel("unet", "remote/z_image_turbo_bf16.safetensors").variant.id, "turbo");
  assert.equal(classifyModel("unet", "remote/z_image_bf16.safetensors").variant.id, "base");
  assert.equal(classifyModel("unet", "remote/krea2_raw_bf16.safetensors").variant.id, "raw");
  assert.equal(classifyModel("unet", "remote/wan2.2_t2v_high_noise_14B_fp8.safetensors").family, "wan22_14b");
  const unknownCheckpoint = classifyModel("checkpoint", "remote/cyberrealisticPony_v8.safetensors");
  assert.deepEqual([unknownCheckpoint.family, unknownCheckpoint.variant.id], ["sdxl", "pony"]);
});

test("a chosen type (and variant) overrides detection and can be undone", () => {
  setModelChoice("unet", "mystery.safetensors", "krea2/raw");
  const chosen = classifyModel("unet", "mystery.safetensors");
  assert.deepEqual([chosen.family, chosen.variant.id, chosen.via], ["krea2", "raw", "choice"]);
  setModelChoice("unet", "mystery.safetensors", "");
  assert.equal(classifyModel("unet", "mystery.safetensors").family, "");
  assert.throws(() => setModelChoice("unet", "x.safetensors", "sd2"), /cannot load from this folder/);
  assert.throws(() => setModelChoice("loras", "x.safetensors", "krea2"), /Unknown model folder/);
});

test("checkpoints report which parts they carry", () => {
  put("checkpoints", "juggernautXL.safetensors", {
    ...prefixed("model.diffusion_model.", headers.sdxlUnet),
    "conditioner.embedders.0.transformer.text_model.x": t([1]),
    "first_stage_model.decoder.conv_in.weight": t([512, 4, 3, 3])
  });
  put("checkpoints", "zImageRealism_fp8.safetensors", headers.zimage);
  assert.deepEqual(classifyModel("checkpoint", "juggernautXL.safetensors").bundled, { encoder: true, vae: true, known: true });
  const bare = classifyModel("checkpoint", "zImageRealism_fp8.safetensors");
  assert.deepEqual([bare.family, bare.bundled.encoder, bare.bundled.vae], ["zimage", false, false]);
});

/* ------------------------------------------------------------ profiles */

test("profiles fill missing parts from compatible files, abliterated first", () => {
  const clips = [
    put("text_encoders", "qwen_3_4b.safetensors", encoders.qwen3_4b),
    put("text_encoders", "qwen3-4b-heretic_fp8_e4m3fn.safetensors", encoders.qwen3_4b),
    put("text_encoders", "qwen3VL4BAbliteratedComfyui_v10.safetensors", encoders.qwen3vl_4b)
  ];
  const vaeFiles = [put("vae", "ae.safetensors", vaes.kl16), put("vae", "qwen_image_vae.safetensors", vaes.wan16)];
  const models = inferModels(objectInfo({ unets: ["myRealismMix_v2.safetensors"], checkpoints: ["zImageRealism_fp8.safetensors", "juggernautXL.safetensors"], clips, vaeFiles }));
  const z = models.profiles.find((profile) => profile.model === "zImageRealism_fp8.safetensors");
  assert.equal(z.ready, true);
  assert.deepEqual(z.encoderSlots[0].options, ["qwen3-4b-heretic_fp8_e4m3fn.safetensors", "qwen_3_4b.safetensors"], "heretic (abliterated) first, Krea's VL encoder left out");
  assert.equal(z.defaults.vae, "ae.safetensors");
  assert.equal(z.defaults.sampler, "res_multistep");
  const krea = models.profiles.find((profile) => profile.model === "myRealismMix_v2.safetensors");
  assert.deepEqual([krea.encoderSlots[0].default, krea.defaults.vae], ["qwen3VL4BAbliteratedComfyui_v10.safetensors", "qwen_image_vae.safetensors"]);
  const xl = models.profiles.find((profile) => profile.model === "juggernautXL.safetensors");
  assert.deepEqual([xl.encoderBuiltIn, xl.vaeBuiltIn, xl.encoderSlots.length, xl.defaults.vae], [true, true, 0, ""]);
  assert.equal(xl.id, "image:checkpoint:juggernautXL.safetensors", "existing ids survive for gallery history");
});

test("missing parts are named, with downloads, and keep the model from running", () => {
  const models = inferModels(objectInfo({ unets: ["flux1-dev-fp8.safetensors"], clips: [], vaeFiles: [] }));
  const flux = models.profiles.find((profile) => profile.family === "flux1");
  assert.equal(flux.ready, false);
  assert.deepEqual(flux.missing.map((item) => item.label), ["CLIP-L text encoder", "T5-XXL text encoder", "Flux VAE (ae)"]);
  assert.match(flux.missing[1].downloads[0].url, /t5xxl/);
  assert.equal(flux.missing[1].downloads[0].id, "encoder:t5xxl:0");
  assert.equal(models.defaults.imageModel, flux.id);
  assert.throws(() => sanitizeGenerateBody({ kind: "image", workflow: flux.workflow, profileId: flux.id, model: flux.model, prompt: "a cat" },
    objectInfo({ unets: ["flux1-dev-fp8.safetensors"] })), /still needs: CLIP-L text encoder/);
});

test("an old ComfyUI is told to update instead of failing mid-run", () => {
  const models = inferModels(objectInfo({ unets: ["myRealismMix_v2.safetensors"], clips: ["qwen3VL4BAbliteratedComfyui_v10.safetensors"], vaeFiles: ["qwen_image_vae.safetensors"], clipTypes: ["wan"] }));
  const krea = models.profiles.find((profile) => profile.family === "krea2");
  assert.deepEqual(krea.missing.map((item) => item.part), ["comfy"]);
});

test("Wan 2.2 14B appears once and runs its high/low-noise pair", () => {
  const unets = ["wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors", "wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors"];
  const clips = [put("text_encoders", "umt5_xxl_fp8_e4m3fn_scaled.safetensors", encoders.umt5)];
  const vaeFiles = [put("vae", "wan_2.1_vae.safetensors", vaes.wan16)];
  const models = inferModels(objectInfo({ unets, clips, vaeFiles }));
  const wan = models.profiles.filter((profile) => profile.family === "wan22_14b");
  assert.equal(wan.length, 1);
  assert.equal(wan[0].pairModel, unets[1]);
  assert.equal(wan[0].ready, true);
  const graph = familyGraph({ family: "wan22_14b", variant: "standard", source: "unet", model: unets[0], pairModel: unets[1], encoders: clips, vae: vaeFiles[0], prompt: "a fox", steps: 20, cfg: 3.5, seed: 1, width: 832, height: 480, frames: 81, fps: 16 });
  const samplers = Object.values(graph).filter((item) => item.class_type === "KSamplerAdvanced");
  assert.deepEqual(samplers.map((item) => [item.inputs.start_at_step, item.inputs.end_at_step, item.inputs.add_noise]), [[0, 10, "enable"], [10, 10000, "disable"]]);
  assert.equal(Object.values(graph).filter((item) => item.class_type === "UNETLoader").length, 2);
});

/* ------------------------------------------------------------ graphs */

const byType = (graph, type) => Object.values(graph).filter((item) => item.class_type === type);

test("Flux.1 loads its two encoders, applies guidance, and zeroes the negative", () => {
  const graph = familyGraph({ family: "flux1", variant: "dev", source: "unet", model: "flux1-dev.safetensors", encoders: ["clip_l.safetensors", "t5xxl_fp16.safetensors"], vae: "ae.safetensors", prompt: "a cat", width: 1024, height: 1024, steps: 20, cfg: 1, seed: 3 });
  assert.deepEqual(byType(graph, "DualCLIPLoader")[0].inputs, { clip_name1: "clip_l.safetensors", clip_name2: "t5xxl_fp16.safetensors", type: "flux", device: "default" });
  assert.equal(byType(graph, "FluxGuidance")[0].inputs.guidance, 3.5);
  assert.equal(byType(graph, "ConditioningZeroOut").length, 1);
  assert.equal(byType(graph, "EmptySD3LatentImage").length, 1);
});

test("an all-in-one SDXL checkpoint uses its own parts; Pony gets clip skip 2", () => {
  const graph = familyGraph({ family: "sdxl", variant: "pony", source: "checkpoint", bundled: { encoder: true, vae: true }, model: "ponyDiffusionV6XL.safetensors", prompt: "score_9", negative: "", width: 832, height: 1216, steps: 25, cfg: 7, seed: 5 });
  const [loader] = Object.entries(graph).find(([, item]) => item.class_type === "CheckpointLoaderSimple");
  assert.deepEqual(byType(graph, "CLIPSetLastLayer")[0].inputs, { clip: [loader, 1], stop_at_clip_layer: -2 });
  assert.deepEqual(byType(graph, "VAEDecode")[0].inputs.vae, [loader, 2]);
  assert.equal(byType(graph, "VAELoader").length, 0);
});

test("a model-only checkpoint gets separate encoder and VAE loaders", () => {
  const graph = familyGraph({ family: "zimage", variant: "turbo", source: "checkpoint", bundled: { encoder: false, vae: false }, model: "zImageRealism_fp8.safetensors", encoders: ["qwen_3_4b.safetensors"], vae: "ae.safetensors", prompt: "a cat", steps: 8, cfg: 1, seed: 1 });
  assert.equal(byType(graph, "CLIPLoader")[0].inputs.type, "lumina2");
  assert.equal(byType(graph, "VAELoader")[0].inputs.vae_name, "ae.safetensors");
  assert.equal(byType(graph, "CheckpointLoaderSimple").length, 1);
});

test("Flux.2 Klein samples through its own scheduler and guider", () => {
  const graph = familyGraph({ family: "flux2_klein_4b", variant: "distilled", source: "unet", model: "flux-2-klein-4b.safetensors", encoders: ["qwen_3_4b.safetensors"], vae: "flux2-vae.safetensors", prompt: "a cat", width: 1024, height: 1024, steps: 4, cfg: 1, seed: 1 });
  assert.deepEqual(byType(graph, "Flux2Scheduler")[0].inputs, { steps: 4, width: 1024, height: 1024 });
  assert.equal(byType(graph, "CFGGuider")[0].inputs.cfg, 1);
  assert.equal(byType(graph, "SamplerCustomAdvanced").length, 1);
  assert.equal(byType(graph, "EmptyFlux2LatentImage").length, 1);
});

test("Krea 2 Raw patches the shift after the LoRAs, behind the enhancer", () => {
  const graph = familyGraph({ family: "krea2", variant: "raw", source: "unet", model: "krea2_raw.safetensors", encoders: ["te.safetensors"], vae: "vae.safetensors", prompt: "a cat", width: 1024, height: 1024, steps: 28, cfg: 4.5, seed: 1, krea2Enhancer: true, loras: [{ name: "a.safetensors", strength: 0.5 }] });
  const ids = Object.fromEntries(Object.entries(graph).map(([id, item]) => [item.class_type, id]));
  assert.deepEqual(graph[ids.LoraLoader].inputs.model, [ids["ComfyUI-Krea2T-Enhancer"], 0]);
  assert.deepEqual(graph[ids.ModelSamplingFlux].inputs.model, [ids.LoraLoader, 0]);
  assert.equal(graph[ids.ModelSamplingFlux].inputs.max_shift, krea2RawShift(1024, 1024));
  assert.deepEqual(graph[ids.KSampler].inputs.model, [ids.ModelSamplingFlux, 0]);
  assert.equal(krea2RawShift(1024, 1024), 0.906);
});

test("MiniMax H3 decodes video and audio from the same latent", () => {
  const graph = familyGraph({ family: "minimax_h3", variant: "standard", source: "unet", model: "h3.safetensors", encoders: ["qwen3vl_32b.safetensors"], vae: "h3v.safetensors", audioVae: "h3a.safetensors", prompt: "waves", width: 1344, height: 768, frames: 56, fps: 24, steps: 20, seed: 1 });
  const video = byType(graph, "CreateVideo")[0].inputs;
  assert.ok(video.audio && video.images);
  assert.equal(byType(graph, "MiniMaxH3ImageToVideo")[0].inputs.length, 56);
  assert.equal(byType(graph, "VAELoader").length, 2);
});

test("validation fills encoders from the profile and rejects files that do not fit", () => {
  const info = objectInfo({ checkpoints: ["zImageRealism_fp8.safetensors"], clips: ["qwen_3_4b.safetensors", "qwen3-4b-heretic_fp8_e4m3fn.safetensors"], vaeFiles: ["ae.safetensors"] });
  const profile = inferModels(info).profiles.find((item) => item.family === "zimage");
  const body = sanitizeGenerateBody({ kind: "image", workflow: profile.workflow, profileId: profile.id, model: profile.model, prompt: "a cat" }, info);
  assert.deepEqual([body.encoders, body.vae, body.source, body.bundled], [["qwen3-4b-heretic_fp8_e4m3fn.safetensors"], "ae.safetensors", "checkpoint", { encoder: false, vae: false }]);
  assert.throws(() => sanitizeGenerateBody({ kind: "image", workflow: profile.workflow, profileId: profile.id, prompt: "a cat", textEncoders: ["ae.safetensors"] }, info), /does not fit/);
});

test("a staged reference image becomes the start image of a built-in graph", async () => {
  const { imageGraph } = await import("./graphs.js");
  const graph = await imageGraph({ workflow: "family:krea2", family: "krea2", variant: "turbo", source: "unet", model: "krea2.safetensors", encoders: ["te.safetensors"], vae: "vae.safetensors", prompt: "a cat", steps: 8, cfg: 1, seed: 1, denoise: 0.6, referenceAssets: [{ slot: "reference", assetId: "a1", comfyName: "staged-ref.png" }] });
  assert.equal(byType(graph, "LoadImage")[0].inputs.image, "staged-ref.png");
  assert.equal(byType(graph, "VAEEncode").length, 1);
  assert.equal(byType(graph, "KSampler")[0].inputs.denoise, 0.6);
});

/* ------------------------------------------------------------ Sana */

const sanaNodes = (presets) => ({
  SanaCheckpointLoader: list({ ckpt_name: [presets], model: [["SanaMS1.5_1600M_P1_D20"]], dtype: [["auto", "FP32", "FP16", "BF16"]] }),
  GemmaLoader: node(), SanaTextEncode: node(), GemmaTextEncode: node(), ExtraVAELoader: node(), ScmModelSampling: node(),
  EmptySanaLatentImage: node(),
  EmptyHunyuanImageLatent: list({ width: ["INT", { default: 2048, min: 64, max: 16384, step: 32 }], height: ["INT", { default: 2048, min: 64, max: 16384, step: 32 }], batch_size: ["INT", { default: 1, min: 1, max: 4096 }] })
});
// Where the ExtraModels loader leaves a preset it has fetched.
const downloadSanaPreset = (dir, file) => {
  const target = path.join(scratch, "ComfyUI", "models", "sana", dir, "checkpoints");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, file), "");
};

test("Sana is recognised from its own and diffusers-style weights", () => {
  const blocks = (prefix, count, extra = {}) => ({ ...Object.fromEntries(Array.from({ length: count }, (_, i) => [`${prefix}.${i}.norm.weight`, t([1])])), ...extra });
  assert.deepEqual(familyFromHeader(blocks("blocks", 20, { "blocks.0.mlp.inverted_conv.conv.weight": t([11200, 2240, 1, 1]), "blocks.0.attn.q_norm.weight": t([2240]) })),
    { family: "sana", detail: { depth: 20, sprint: false, qkNorm: true } });
  assert.deepEqual(familyFromHeader(blocks("blocks", 28, { "blocks.0.mlp.inverted_conv.conv.weight": t([1, 1, 1, 1]), "cfg_embedder.mlp.0.weight": t([1, 1]) })).detail,
    { depth: 28, sprint: true, qkNorm: false });
  assert.equal(familyFromHeader(blocks("transformer_blocks", 20, { "transformer_blocks.0.ff.conv_inverted.weight": t([1, 1, 1, 1]), "adaln_single.emb.timestep_embedder.linear_1.bias": t([1]) })).family, "sana", "not LTX-Video");
  const local = put("checkpoints", "mySanaTune.safetensors", blocks("blocks", 60, { "blocks.0.mlp.inverted_conv.conv.weight": t([1, 1, 1, 1]) }));
  assert.equal(classifyModel("checkpoint", local).family, "sana");
  assert.equal(classifyModel("checkpoint", "Sana_Sprint_0.6B_1024px.pth").variant.id, "sprint");
});

test("downloaded Sana presets appear once the ExtraModels nodes are in, and runs need nothing else", () => {
  const presets = ["Efficient-Large-Model/SANA1.5_1.6B_1024px", "Efficient-Large-Model/Sana_Sprint_1.6B_1024px", "Efficient-Large-Model/Sana_1600M_4Kpx_BF16", "Efficient-Large-Model/Sana_1600M_512px", "Efficient-Large-Model/SANA1.5_4.8B_1024px"];
  const info = objectInfo({ extra: sanaNodes(presets) });
  // The loader lists every preset; only the ones it has fetched are models you have.
  assert.equal(inferModels(info).profiles.filter((profile) => profile.family === "sana").length, 0);
  downloadSanaPreset("models--sana--sana-1.5-1600m-1024px", "SANA1.5_1.6B_1024px.pth");
  downloadSanaPreset("models--sana--sana-sprint-1600m-1024px", "Sana_Sprint_1.6B_1024px.pth");
  downloadSanaPreset("models--sana--sana-1600m-4kpx-bf16", "Sana_1600M_4Kpx_BF16.pth");
  downloadSanaPreset("models--sana--sana-1600m-512px", "Sana_1600M_512px.pth");
  info.KSampler.input.required.sampler_name[0].push("scm");
  const sana = inferModels(info).profiles.filter((profile) => profile.family === "sana");
  assert.deepEqual(sana.map((profile) => [profile.displayName, profile.variant, profile.ready]), [
    ["SANA 1.5 1.6B", "standard", true], ["SANA Sprint 1.6B", "sprint", true], ["Sana 1.6B 4K", "4k", true]
  ]);
  const [standard, sprint, big] = sana;
  assert.deepEqual([standard.capabilities.vae, standard.capabilities.lora, standard.capabilities.textEncoder, standard.constraints.width.step], [false, false, false, 32]);
  assert.deepEqual([sprint.defaults.sampler, sprint.capabilities.negativePrompt, big.defaults.width], ["scm", false, 4096]);

  const body = sanitizeGenerateBody({ kind: "image", workflow: sprint.workflow, profileId: sprint.id, prompt: "an astronaut" }, info, { devices: [{ type: "cuda" }] });
  const graph = familyGraph(body);
  assert.deepEqual(byType(graph, "SanaCheckpointLoader")[0].inputs, { ckpt_name: presets[1], model: "SanaSprint_1600M_P1_D20", dtype: "FP32", enable_cfg_passthrough: true });
  assert.deepEqual([byType(graph, "GemmaLoader")[0].inputs.device, byType(graph, "GemmaLoader")[0].inputs.dtype], ["cuda", "BF16"]);
  assert.equal(byType(graph, "ScmModelSampling")[0].inputs.cfg_scale, 4.5);
  assert.deepEqual([byType(graph, "KSampler")[0].inputs.cfg, byType(graph, "KSampler")[0].inputs.sampler_name], [1, "scm"]);
  assert.equal(byType(graph, "SanaTextEncode")[0].inputs.text, "an astronaut");
  // ExtraModels' own latent node fails on current ComfyUI; the native 1/32 one stands in.
  assert.deepEqual([byType(graph, "EmptySanaLatentImage").length, byType(graph, "EmptyHunyuanImageLatent")[0].inputs.batch_size], [0, 1]);
  assert.equal(byType(graph, "SaveImage").length, 1);
  assert.equal(byType(graph, "CheckpointLoaderSimple").length + byType(graph, "VAELoader").length + byType(graph, "CLIPLoader").length, 0);

  const mac = familyGraph(sanitizeGenerateBody({ kind: "image", workflow: standard.workflow, profileId: standard.id, prompt: "a cat", negative: "blurry" }, info, { devices: [{ type: "mps" }] }));
  assert.deepEqual(byType(mac, "GemmaLoader")[0].inputs.device, "cpu");
  assert.equal(byType(mac, "GemmaTextEncode")[0].inputs.text, "blurry");
  assert.equal(byType(mac, "ScmModelSampling").length, 0);
});

test("a Sana file without the ExtraModels nodes says which pack to install", () => {
  const models = inferModels(objectInfo({ checkpoints: ["Sana_1600M_1024px.pth"] }));
  const sana = models.profiles.find((profile) => profile.family === "sana");
  assert.equal(sana.ready, false);
  assert.deepEqual(sana.missing.map((item) => item.label), ["ComfyUI_ExtraModels nodes"]);
  assert.match(sana.missing[0].install.commands[0].command, /git clone https:\/\/github.com\/lawrence-cj\/ComfyUI_ExtraModels\.git/);
  assert.equal(sana.missing[0].nodePack.id, "extramodels");
  assert.equal(models.profiles.filter((profile) => profile.family === "sana").length, 1, "no extra placeholder next to a real Sana file");
});

test("with no Sana weights anywhere, no Sana model shows, whatever packs are in", () => {
  for (const devices of [[{ type: "mps" }], [{ type: "cuda" }]]) {
    assert.equal(inferModels(objectInfo(), { devices }).profiles.filter((profile) => profile.family === "sana").length, 0);
  }
  const packs = objectInfo({ extra: { SanaModelLoader: list({ model: [["(no diffusers models found)"]] }), SanaGenerate: node() } });
  assert.equal(inferModels(packs).profiles.filter((profile) => profile.family === "sana").length, 0);
});

test("ComfyUI-SANA diffusers folders run as one pipeline node", () => {
  const info = objectInfo({ extra: {
    SanaModelLoader: list({ model: [["Sana_Sprint_0.6B_1024px_diffusers", "flux-dev-diffusers"]] }),
    SanaGenerate: list({ width: ["INT", { default: 1024, min: 256, max: 4096, step: 32 }], height: ["INT", { default: 1024, min: 256, max: 4096, step: 32 }], batch_size: ["INT", { default: 1, min: 1, max: 16 }] })
  } });
  const sana = inferModels(info).profiles.filter((profile) => profile.family === "sana");
  assert.deepEqual(sana.map((profile) => [profile.displayName, profile.variant, profile.ready, profile.capabilities.sampler]), [["SANA Sprint 0.6B", "sprint", true, false]]);
  const graph = familyGraph(sanitizeGenerateBody({ kind: "image", workflow: sana[0].workflow, profileId: sana[0].id, prompt: "a fox", count: 2 }, info));
  assert.deepEqual(byType(graph, "SanaModelLoader")[0].inputs, { model: "Sana_Sprint_0.6B_1024px_diffusers", device: "auto", dtype: "bfloat16" });
  const run = byType(graph, "SanaGenerate")[0].inputs;
  assert.deepEqual([run.prompt, run.steps, run.guidance_scale, run.batch_size, run.width], ["a fox", 2, 4.5, 2, 1024]);
  assert.equal(byType(graph, "KSampler").length, 0);
});

test("every node pack is one registry entry, and a missing one comes with both install routes", async () => {
  const { nodePacks } = await import("./node-packs.js");
  const { missingPackPart } = await import("./node-install.js");
  for (const [id, pack] of Object.entries(nodePacks)) {
    assert.match(pack.repository, /^https:\/\/github\.com\/.+\.git$/, id);
    assert.ok(pack.folder && pack.nodes.length, id);
  }
  assert.equal(missingPackPart({ SanaModelLoader: {}, SanaGenerate: {} }, "comfyui_sana"), null);
  const part = missingPackPart({}, "seedvr2");
  assert.deepEqual([part.part, part.nodePack.repository, part.missingNodes.length], ["comfy", nodePacks.seedvr2.repository, 3]);
  assert.ok(part.install.commands.length >= 1);
});

test("one-click pack installs only take registry ids, and run locally with ComfyUI's Python", async () => {
  const { packInstallRoutes, packInstallState, startPackInstall } = await import("./pack-installer.js");
  await assert.rejects(() => startPackInstall("https://evil.example/pack.git"), /Unknown node pack/);
  const root = path.join(scratch, "ComfyUI");
  assert.deepEqual(packInstallRoutes("seedvr2", root), { manager: true, local: false });
  // A ComfyUI of our own: its venv Python, and the pack already cloned so no git is needed.
  const windows = process.platform === "win32";
  const python = windows ? path.join(root, ".venv", "Scripts", "python.exe") : path.join(root, ".venv", "bin", "python");
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, "#!/bin/sh\necho pip \"$@\"\n", { mode: 0o755 });
  fs.mkdirSync(path.join(root, "custom_nodes", "ComfyUI-SANA"), { recursive: true });
  fs.writeFileSync(path.join(root, "custom_nodes", "ComfyUI-SANA", "requirements.txt"), "diffusers\n");
  assert.deepEqual(packInstallRoutes("comfyui_sana", root), { manager: false, local: true });
  // The stand-in Python is a shell script, which Windows cannot run.
  if (windows) return;
  const started = await startPackInstall("comfyui_sana");
  assert.equal(started.route, "local");
  let state = started;
  for (let i = 0; i < 50 && state.status === "running"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    state = packInstallState("comfyui_sana");
  }
  assert.equal(state.status, "done", state.error);
  assert.match(state.log, /pip -m pip install -r requirements.txt/);
});

/* ------------------------------------------------------------ Lumina 2, Ideogram 4, MageFlow, ERNIE */

const newNodes = () => Object.fromEntries(["Ideogram4Scheduler", "DualModelGuider", "CFGOverride", "TextEncodeMageFlowEdit"].map((name) => [name, node()]));
const newTypes = ["stable_diffusion", "lumina2", "krea2", "qwen_image", "wan", "flux2", "chroma", "minimax", "ideogram4", "mage"];

test("the four new families are told apart by their weights, as ComfyUI does", () => {
  assert.equal(familyFromHeader({ "cap_embedder.1.weight": t([2304, 2304]), "noise_refiner.0.attention.k_norm.weight": t([96]) }).family, "lumina2");
  assert.equal(familyFromHeader({ "cap_embedder.1.weight": t([2304, 2304]), "noise_refiner.0.attention.k_norm.weight": t([96]), "clip_text_pooled_proj.0.weight": t([1, 1]) }).family, "newbie");
  assert.equal(familyFromHeader({ "embed_image_indicator.weight": t([1, 1]), "input_proj.weight": t([1, 128]) }).family, "ideogram4");
  assert.equal(familyFromHeader({ "txt_norm.weight": t([2560]), "proj_out.weight": t([128, 1]) }).family, "mage_flow");
  assert.equal(familyFromHeader({ "txt_norm.weight": t([3584]), "proj_out.weight": t([64, 1]) }).family, "qwen_image", "Qwen-Image keeps its own");
  assert.equal(familyFromHeader({ "layers.0.mlp.linear_fc2.weight": t([1, 1]) }).family, "ernie");
  assert.equal(vaeLayoutFromHeader({ "student.dconv_encoder.proj_out.weight": t([1, 1]) }), "mage");
});

test("Ideogram 4 pairs with its unconditional model, and offers the matching one when it is missing", async () => {
  const { catalogDownload } = await import("./family-profiles.js");
  const clips = [put("text_encoders", "qwen3vl_8b_fp8_scaled.safetensors", { "model.visual.deepstack_merger_list.0.norm.weight": t([1]), "model.visual.merger.linear_fc2.weight": t([4096, 1]) })];
  const vaeFiles = [put("vae", "flux2-vae.safetensors", vaes.flux2)];
  const main = put("diffusion_models", "ideogram4_int8_convrot.safetensors", { "embed_image_indicator.weight": t([1, 1]) });
  const lonely = inferModels(objectInfo({ unets: [main], clips, vaeFiles, clipTypes: newTypes, extra: newNodes() })).profiles.find((profile) => profile.family === "ideogram4");
  assert.deepEqual(lonely.missing.map((item) => item.label), ["Unconditional model"]);
  assert.equal(lonely.missing[0].downloads[0].id, "model:ideogram4_uncond_int8:0");
  assert.deepEqual(catalogDownload("model:ideogram4_uncond_int8:0").folder, "diffusion_models");
  assert.equal(catalogDownload("model:__proto__:0"), null);

  const partner = "ideogram4_unconditional_int8_convrot.safetensors";
  const info = objectInfo({ unets: [main, partner], clips, vaeFiles, clipTypes: newTypes, extra: newNodes() });
  const models = inferModels(info);
  const ideogram = models.profiles.filter((profile) => profile.family === "ideogram4");
  assert.equal(ideogram.length, 1, "the unconditional file is not a model of its own");
  assert.deepEqual([ideogram[0].ready, ideogram[0].pairModel, ideogram[0].capabilities.negativePrompt, ideogram[0].defaults.cfg], [true, partner, false, 7]);
  assert.equal(models.modelFiles.find((file) => file.name === partner).reason, "Ideogram 4 runs this next to its main model.");

  const graph = familyGraph(sanitizeGenerateBody({ kind: "image", workflow: ideogram[0].workflow, profileId: ideogram[0].id, prompt: "a poster that says HEISS", steps: 12 }, info));
  const guider = byType(graph, "DualModelGuider")[0].inputs;
  const [cfgOverride] = Object.entries(graph).find(([, item]) => item.class_type === "CFGOverride");
  assert.deepEqual(guider.model, [cfgOverride, 0]);
  assert.equal(graph[guider.model_negative[0]].inputs.unet_name, partner);
  assert.deepEqual(byType(graph, "CFGOverride")[0].inputs.cfg, 3);
  assert.deepEqual(byType(graph, "Ideogram4Scheduler")[0].inputs, { steps: 12, width: 1024, height: 1024, mu: 0.5, std: 1.75 }, "12 steps is the Turbo preset");
  assert.equal(byType(graph, "ConditioningZeroOut").length, 1);
});

test("MageFlow encodes and makes its latent in one node; Turbo drops the negative", () => {
  const clips = [put("text_encoders", "qwen3vl_4b_bf16.safetensors", encoders.qwen3vl_4b)];
  const vaeFiles = [put("vae", "mage_flow_vae_bf16.safetensors", { "student.dconv_encoder.proj_out.weight": t([1, 1]) }), "ae.safetensors"];
  const unets = [put("diffusion_models", "mage_flow_int8_convrot.safetensors", { "txt_norm.weight": t([2560]), "proj_out.weight": t([128, 1]) }), "mage_flow_turbo_int8_convrot.safetensors"];
  const info = objectInfo({ unets, clips, vaeFiles, clipTypes: newTypes, extra: { ...newNodes(), TextEncodeMageFlowEdit: list({ width: ["INT", { default: 0, min: 0, max: 8192, step: 16 }], height: ["INT", { default: 0, min: 0, max: 8192, step: 16 }], batch_size: ["INT", { default: 1, min: 1, max: 4096 }] }) } });
  const mage = inferModels(info).profiles.filter((profile) => profile.family === "mage_flow");
  assert.deepEqual(mage.map((profile) => [profile.variant, profile.ready, profile.defaults.steps, profile.defaults.cfg, profile.defaults.vae]), [
    ["standard", true, 30, 5, "mage_flow_vae_bf16.safetensors"], ["turbo", true, 4, 1, "mage_flow_vae_bf16.safetensors"]
  ]);
  assert.equal(mage[0].constraints.width.min, 64, "0 means 'from the reference image', never a size to pick");
  assert.equal(mage[1].capabilities.negativePrompt, false);
  const graph = familyGraph(sanitizeGenerateBody({ kind: "image", workflow: mage[0].workflow, profileId: mage[0].id, prompt: "a lighthouse", negative: "blurry", count: 2 }, info));
  const [encodeId, encode] = Object.entries(graph).find(([, item]) => item.class_type === "TextEncodeMageFlowEdit");
  assert.deepEqual([encode.inputs.prompt, encode.inputs.negative_prompt, encode.inputs.batch_size], ["a lighthouse", "blurry", 2]);
  assert.deepEqual(byType(graph, "KSampler")[0].inputs.latent_image, [encodeId, 2]);
  assert.equal(byType(graph, "CLIPLoader")[0].inputs.type, "mage");
});

test("ERNIE-Image runs Ministral through the Flux.2 path; Turbo zeroes the negative", () => {
  const clips = [put("text_encoders", "ministral-3-3b.safetensors", { "model.layers.0.post_attention_layernorm.weight": t([3072]) })];
  const vaeFiles = [put("vae", "flux2-vae.safetensors", vaes.flux2)];
  const unets = [put("diffusion_models", "ernie-image.safetensors", { "layers.0.mlp.linear_fc2.weight": t([1, 1]) }), "ernie-image-turbo.safetensors"];
  const info = objectInfo({ unets, clips, vaeFiles, clipTypes: newTypes });
  const ernie = inferModels(info).profiles.filter((profile) => profile.family === "ernie");
  assert.deepEqual(ernie.map((profile) => [profile.variant, profile.ready, profile.defaults.steps, profile.defaults.cfg]), [["standard", true, 20, 4], ["turbo", true, 8, 1]]);
  const base = familyGraph(sanitizeGenerateBody({ kind: "image", workflow: ernie[0].workflow, profileId: ernie[0].id, prompt: "a cat", negative: "dog" }, info));
  assert.deepEqual([byType(base, "CLIPLoader")[0].inputs.type, byType(base, "EmptyFlux2LatentImage").length, byType(base, "CLIPTextEncode").length], ["flux2", 1, 2]);
  const turbo = familyGraph(sanitizeGenerateBody({ kind: "image", workflow: ernie[1].workflow, profileId: ernie[1].id, prompt: "a cat" }, info));
  assert.equal(byType(turbo, "ConditioningZeroOut").length, 1);
});

test("Lumina 2 and NetaYume read their system prompt first, with Gemma and the Flux VAE", () => {
  const graph = familyGraph({ family: "lumina2", variant: "neta", source: "checkpoint", bundled: { encoder: true, vae: true }, model: "NetaYumev35_pretrained_all_in_one.safetensors", prompt: "a girl in an orange grove", negative: "blurry", steps: 30, cfg: 4, seed: 1 });
  const [positive, negative] = byType(graph, "CLIPTextEncode").map((item) => item.inputs.text);
  assert.equal(positive, "You are an assistant designed to generate high quality anime images based on textual prompts. <Prompt Start> a girl in an orange grove");
  assert.equal(negative, "You are an assistant designed to generate low-quality images based on textual prompts <Prompt Start> blurry");
  assert.equal(byType(graph, "ModelSamplingAuraFlow")[0].inputs.shift, 4);
  const clips = [put("text_encoders", "gemma_2_2b_fp16.safetensors", { "model.layers.0.post_feedforward_layernorm.weight": t([2304]) })];
  const unets = [put("diffusion_models", "lumina_2.safetensors", { "cap_embedder.1.weight": t([2304, 2304]), "noise_refiner.0.attention.k_norm.weight": t([96]) })];
  const lumina = inferModels(objectInfo({ unets, clips, vaeFiles: [put("vae", "ae.safetensors", vaes.kl16)], clipTypes: newTypes })).profiles.find((profile) => profile.family === "lumina2");
  assert.deepEqual([lumina.variant, lumina.ready, lumina.defaults.sampler, lumina.encoderSlots[0].default], ["standard", true, "res_multistep", "gemma_2_2b_fp16.safetensors"]);
});

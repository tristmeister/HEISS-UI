import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Point ComfyUI and the data folder at a scratch tree before the modules read them.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-model-settings-"));
process.env.HEISS_COMFY_ROOT = path.join(scratch, "ComfyUI");
process.env.HEISS_DATA_DIR = path.join(scratch, "data");
const dirs = Object.fromEntries(["diffusion_models", "checkpoints", "text_encoders", "vae", "loras"].map((name) => {
  const dir = path.join(scratch, "ComfyUI", "models", name);
  fs.mkdirSync(dir, { recursive: true });
  return [name, dir];
}));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { classifyModel } = await import("./model-families.js");
const { stepsInName, variantFor } = await import("./family-catalog.js");
const { inferModels } = await import("./models.js");
const { sanitizeGenerateBody } = await import("./validation.js");

const t = (shape) => ({ dtype: "F16", shape, data_offsets: [0, 0] });
function put(folder, name, header) {
  const json = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(json.length));
  fs.writeFileSync(path.join(dirs[folder], name), Buffer.concat([length, json]));
  return name;
}
const zimage = { "cap_embedder.1.weight": t([3840, 2560]), "noise_refiner.0.attention.k_norm.weight": t([128]) };
const klein4b = { "double_blocks.0.img_attn.norm.key_norm.scale": t([128]), "img_in.weight": t([3072, 128]), "double_stream_modulation_img.lin.weight": t([1, 1]), "txt_in.weight": t([3072, 7680]) };
const wan14b = { "head.modulation": t([1, 2, 5120]), "head.head.weight": t([64, 5120]), "patch_embedding.weight": t([5120, 16, 1, 2, 2]) };

const list = (values) => ({ input: { required: values } });
const nodes = ["CLIPTextEncode", "VAEDecode", "SaveImage", "EmptyLatentImage", "EmptySD3LatentImage", "EmptyFlux2LatentImage", "Flux2Scheduler", "SamplerCustomAdvanced", "CFGGuider",
  "BasicGuider", "KSamplerSelect", "RandomNoise", "ConditioningZeroOut", "ModelSamplingSD3", "ModelSamplingAuraFlow", "KSamplerAdvanced", "EmptyHunyuanLatentVideo", "CreateVideo", "SaveVideo", "LoadImage", "VAEEncode"];
function objectInfo({ unets = [], checkpoints = [], clips = [], vaeFiles = [], loras = [] } = {}) {
  return {
    ...Object.fromEntries(nodes.map((name) => [name, list({})])),
    UNETLoader: list({ unet_name: [unets], weight_dtype: [["default"]] }),
    CheckpointLoaderSimple: list({ ckpt_name: [checkpoints] }),
    CLIPLoader: list({ clip_name: [clips], type: [["lumina2", "flux2", "wan", "stable_diffusion"]] }),
    DualCLIPLoader: list({ clip_name1: [clips], clip_name2: [clips], type: [["sdxl"]] }),
    VAELoader: list({ vae_name: [vaeFiles] }),
    LoraLoader: list({ lora_name: [loras], strength_model: ["FLOAT", { default: 1, min: -100, max: 100, step: 0.01 }] }),
    KSampler: list({ sampler_name: [["euler", "res_multistep", "lcm", "ddim", "dpmpp_2m", "euler_ancestral", "uni_pc"]], scheduler: [["simple", "sgm_uniform", "karras", "normal", "beta"]] })
  };
}

test("a renamed fine-tune runs at its family's usual settings: Turbo or Distilled unless the name says base or raw", () => {
  assert.equal(variantFor("zimage", "myZMerge_v3.safetensors").id, "turbo");
  assert.equal(variantFor("zimage", "z_image_turbo_bf16.safetensors").id, "turbo");
  assert.equal(variantFor("zimage", "z_image_base_bf16.safetensors").id, "base");
  assert.equal(variantFor("zimage", "z_image_bf16.safetensors").id, "base", "the plain Z-Image release is the base model");
  assert.equal(variantFor("flux2_klein_4b", "flux-2-klein-4b-fp8.safetensors").id, "distilled");
  assert.equal(variantFor("flux2_klein_4b", "flux-2-klein-base-4b.safetensors").id, "base");
  assert.equal(variantFor("flux2_klein_9b", "myKleinMerge.safetensors").id, "distilled");
  assert.equal(variantFor("krea2", "MuseByStableYogi_V35Int8Extended.safetensors").id, "turbo", "most Krea 2 fine-tunes are built on Turbo");
  assert.equal(variantFor("krea2", "krea2_turbo_bf16.safetensors").id, "turbo");
  assert.equal(variantFor("krea2", "krea2_raw_bf16.safetensors").id, "raw");
  put("diffusion_models", "renamed_klein.safetensors", klein4b);
  assert.equal(classifyModel("unet", "renamed_klein.safetensors").variant.id, "distilled");
});

test("img2img strength starts at 0.65 for every family", () => {
  const info = objectInfo({ checkpoints: ["sdxl_turbo_1.0.safetensors", "juggernaut.safetensors"], unets: [put("diffusion_models", "z_image_bf16.safetensors", zimage)] });
  const profiles = inferModels(info).profiles;
  for (const model of ["juggernaut.safetensors", "sdxl_turbo_1.0.safetensors", "z_image_bf16.safetensors"]) {
    assert.equal(profiles.find((item) => item.model === model).defaults.denoise, 0.65, model);
  }
});

test("a stacked speed LoRA leaves the model's variant and settings as they are", () => {
  const high = put("diffusion_models", "wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors", wan14b);
  const low = put("diffusion_models", "wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors", wan14b);
  const speed = "wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors";
  const info = objectInfo({ unets: [high, low], clips: ["umt5_xxl_fp8_e4m3fn_scaled.safetensors"], vaeFiles: ["wan_2.1_vae.safetensors"], loras: [speed] });
  const profile = inferModels(info).profiles.find((item) => item.model === high);
  assert.equal(profile.variant, "standard");
  assert.equal("speedLoras" in profile, false);
  const request = { kind: "video", workflow: profile.workflow, profileId: profile.id, model: high, prompt: "waves", steps: 20, cfg: 3.5 };
  assert.equal(sanitizeGenerateBody({ ...request, loras: [{ name: speed, strength: 1 }] }, info).variant, "standard");
});

const mps = { devices: [{ type: "mps", name: "mps" }] };
const cuda = { devices: [{ type: "cuda", name: "cuda:0 NVIDIA GeForce RTX 4090" }] };
const profileFor = (info, model, stats = cuda) => inferModels(info, stats).profiles.find((item) => item.model === model);

test("on a Mac, Wan video starts on euler: uni_pc corrupts video on Apple Silicon", () => {
  const info = objectInfo({ unets: ["wan2.1_t2v_1.3B_fp16.safetensors", "wan2.2_ti2v_5B_fp16.safetensors"] });
  for (const model of ["wan2.1_t2v_1.3B_fp16.safetensors", "wan2.2_ti2v_5B_fp16.safetensors"]) {
    assert.equal(profileFor(info, model).defaults.sampler, "uni_pc", model);
    assert.equal(profileFor(info, model, mps).defaults.sampler, "euler", model);
  }
});

test("on a Mac, a part's other build comes before its quantized fp8 one", () => {
  const info = objectInfo({ unets: ["sd3.5_large.safetensors", "wan2.1_t2v_1.3B_fp16.safetensors"] });
  const t5 = (stats) => profileFor(info, "sd3.5_large.safetensors", stats).missing.find((item) => item.slot === "t5").downloads;
  assert.deepEqual(t5(cuda).map((item) => item.id), ["encoder:t5xxl:0", "encoder:t5xxl:1"]);
  assert.deepEqual(t5(mps).map((item) => [item.id, item.file]), [["encoder:t5xxl:1", "t5xxl_fp16.safetensors"], ["encoder:t5xxl:0", "t5xxl_fp8_e4m3fn_scaled.safetensors"]]);
  const umt5 = profileFor(info, "wan2.1_t2v_1.3B_fp16.safetensors", mps).missing.find((item) => item.part === "encoder").downloads;
  assert.equal(umt5[0].file, "umt5_xxl_fp16.safetensors");
});

test("a step count in the file name is read as written", () => {
  assert.equal(stepsInName("sdxl_lightning_4step.safetensors"), 4);
  assert.equal(stepsInName("models/sdxl_lightning_8step_unet.safetensors"), 8);
  assert.equal(stepsInName("Qwen-Image-Lightning-8steps-V1.1.safetensors"), 8);
  assert.equal(stepsInName("qwen_image_lightning_4-steps_merged.safetensors"), 4);
  assert.equal(stepsInName("RealVisXL_V5.0_Lightning_fp16.safetensors"), 0);
  assert.equal(stepsInName("juggernautXL_v9Rdphoto2Lightning.safetensors"), 0);
});

test("files distilled for a step count start at that count; the rest at their variant's", () => {
  const info = objectInfo({
    checkpoints: ["sdxl_lightning_2step.safetensors", "sdxl_lightning_8step.safetensors", "juggernautXL_lightning.safetensors", "dmd2_sdxl_merge.safetensors"],
    unets: ["qwen_image_lightning_4steps_merged.safetensors", "qwen_image_lightning_merged.safetensors", "minimax_h3_turbo_4step.safetensors", "minimax_h3_turbo.safetensors", "minimax_h3_fl2va_pruned_int8_convrot.safetensors"]
  });
  const steps = (model) => profileFor(info, model).defaults.steps;
  assert.deepEqual(["sdxl_lightning_2step.safetensors", "sdxl_lightning_8step.safetensors", "juggernautXL_lightning.safetensors"].map(steps), [2, 8, 6]);
  assert.equal(steps("dmd2_sdxl_merge.safetensors"), 4, "DMD2's card: 4 steps");
  assert.deepEqual(["qwen_image_lightning_4steps_merged.safetensors", "qwen_image_lightning_merged.safetensors"].map(steps), [4, 8]);
  assert.deepEqual(["minimax_h3_turbo_4step.safetensors", "minimax_h3_turbo.safetensors", "minimax_h3_fl2va_pruned_int8_convrot.safetensors"].map(steps), [4, 8, 20]);
  assert.equal(profileFor(info, "minimax_h3_fl2va_pruned_int8_convrot.safetensors").defaults.frames, 124, "5 seconds, H3's shortest trained length");
});

test("HunyuanVideo 1.5 takes Tencent's shift per resolution and task, and 50 steps when CFG-distilled", async () => {
  const { families, variantFor } = await import("./family-catalog.js");
  const settings = (name) => {
    const family = classifyModel("unet", `remote/${name}`).family;
    const variant = variantFor(family, name);
    return [family, variant.id, (variant.modelSampling || families[family].modelSampling).shift, variant.defaults.steps, variant.defaults.cfg];
  };
  assert.deepEqual(settings("hunyuanvideo1.5_480p_t2v_fp16.safetensors"), ["hunyuan15", "standard", 5, 20, 6]);
  assert.deepEqual(settings("hunyuanvideo1.5_720p_t2v_fp16.safetensors"), ["hunyuan15", "p720", 9, 20, 6]);
  assert.deepEqual(settings("hunyuanvideo1.5_480p_t2v_cfg_distilled_fp8_scaled.safetensors"), ["hunyuan15", "cfg_distilled", 5, 50, 1]);
  assert.deepEqual(settings("hunyuanvideo1.5_480p_i2v_fp16.safetensors"), ["hunyuan15_i2v", "standard", 5, 20, 6]);
  assert.deepEqual(settings("hunyuanvideo1.5_720p_i2v_fp16.safetensors"), ["hunyuan15_i2v", "p720", 7, 20, 6]);
  assert.deepEqual(settings("hunyuanvideo1.5_720p_i2v_cfg_distilled_fp16.safetensors"), ["hunyuan15_i2v", "cfg_distilled_720", 7, 50, 1]);
  assert.deepEqual(settings("hunyuanvideo1.5_480p_i2v_cfg_distilled_fp16.safetensors"), ["hunyuan15_i2v", "cfg_distilled", 5, 50, 1]);
  assert.deepEqual(settings("hunyuanvideo1.5_480p_i2v_step_distilled_fp16.safetensors"), ["hunyuan15_i2v", "step_distilled", 7, 8, 1]);
  assert.equal(variantFor("hunyuan15", "hunyuanvideo1.5_t2v_step_distilled.safetensors").id, "standard", "no step-distilled text-to-video from Tencent");
  assert.deepEqual(settings("hunyuanvideo1.5_t2v_480p_lightx2v_4step.safetensors").slice(1), ["fast", 9, 4, 1]);
  assert.equal(families.hunyuan15.frames, 121);
});

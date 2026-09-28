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
const { isKleinDistilled, isKrea2Turbo, isZImageTurbo, speedVariantFor, variantFor } = await import("./family-catalog.js");
const { inferModels } = await import("./models.js");
const { familyGraph } = await import("./family-graph.js");
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

test("renamed Z-Image and Klein files run at their full-step settings unless they say they are distilled", () => {
  assert.equal(variantFor("zimage", "myZMerge_v3.safetensors").id, "base");
  assert.equal(variantFor("zimage", "z_image_turbo_bf16.safetensors").id, "turbo");
  assert.equal(variantFor("zimage", "moodyPorn_zit_v4.safetensors").id, "turbo", "ZIT is the community's name for Turbo fine-tunes");
  assert.equal(variantFor("zimage", "z_image_bf16.safetensors").id, "base");
  assert.equal(variantFor("flux2_klein_4b", "flux-2-klein-4b-fp8.safetensors").id, "distilled", "BFL's distilled release has no 'distilled' in its name");
  assert.equal(variantFor("flux2_klein_4b", "flux-2-klein-base-4b.safetensors").id, "base");
  assert.equal(variantFor("flux2_klein_9b", "myKleinMerge.safetensors").id, "base");
});

test("a Krea 2 fine-tune runs as Turbo unless its name or metadata says Raw", () => {
  assert.equal(variantFor("krea2", "MuseByStableYogi_V35Int8Extended.safetensors").id, "turbo", "most Krea 2 fine-tunes are built on Turbo");
  assert.equal(variantFor("krea2", "myKreaFinetune.safetensors").id, "turbo");
  assert.equal(variantFor("krea2", "krea2_turbo_bf16.safetensors").id, "turbo");
  assert.equal(variantFor("krea2", "krea2_raw_bf16.safetensors").id, "raw");
  assert.equal(variantFor("krea2", "myKrea_base_merge.safetensors").id, "raw");
  assert.equal(isKrea2Turbo("renamed.safetensors", { __metadata__: { "modelspec.title": "Krea 2 Raw base" } }), false, "metadata that says base wins");
});

test("a file's own metadata outranks its name when it says base or distilled", () => {
  assert.equal(isZImageTurbo("renamed.safetensors", { __metadata__: { "modelspec.title": "Z-Image Turbo" } }), true);
  assert.equal(isKleinDistilled("flux-2-klein-4b.safetensors", { __metadata__: { "modelspec.title": "FLUX.2 [klein] Base 4B" } }), false);
  put("diffusion_models", "renamed_z.safetensors", { __metadata__: { "modelspec.title": "Z-Image-Turbo" }, ...zimage });
  assert.equal(classifyModel("unet", "renamed_z.safetensors").variant.id, "turbo");
  put("diffusion_models", "renamed_klein.safetensors", klein4b);
  assert.equal(classifyModel("unet", "renamed_klein.safetensors").variant.id, "base");
});

test("img2img strength comes from the family, not one number for all", () => {
  const info = objectInfo({ checkpoints: ["sdxl_turbo_1.0.safetensors", "juggernaut.safetensors"], unets: [put("diffusion_models", "z_image_bf16.safetensors", zimage)] });
  const profiles = inferModels(info).profiles;
  assert.equal(profiles.find((item) => item.model === "juggernaut.safetensors").defaults.denoise, 0.75);
  assert.equal(profiles.find((item) => item.model === "sdxl_turbo_1.0.safetensors").defaults.denoise, 0.5);
  assert.equal(profiles.find((item) => item.model === "z_image_bf16.safetensors").defaults.denoise, 0.6);
});

test("speed LoRAs are told apart from LoRAs that only mention a fast model", () => {
  assert.equal(speedVariantFor("wan22_14b", "wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors")?.id, "fast");
  assert.equal(speedVariantFor("sdxl", "Hyper-SDXL-8steps-lora.safetensors")?.id, "hyper");
  assert.equal(speedVariantFor("sdxl", "lcm-lora-sdxl.safetensors")?.id, "lcm");
  assert.equal(speedVariantFor("sdxl", "dmd2_sdxl_4step_lora_fp16.safetensors")?.id, "dmd2");
  assert.equal(speedVariantFor("qwen_image", "Qwen-Image-Lightning-8steps-V1.0.safetensors")?.id, "fast");
  assert.equal(speedVariantFor("zimage", "zimage_turbo_anime_style.safetensors"), null, "a style trained on Turbo is not a speed LoRA");
  assert.equal(speedVariantFor("sdxl", "hyperrealism_v2.safetensors"), null);
  assert.equal(speedVariantFor("sdxl", "mylora_3000steps.safetensors"), null, "a training step count is not a sampling one");
  assert.equal(speedVariantFor("qwen_image_21", "Qwen-Image-Lightning-8steps.safetensors"), null, "no few-step variant, nothing to switch to");
});

test("a stacked speed LoRA offers its settings and runs the model as its few-step variant", () => {
  const high = put("diffusion_models", "wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors", wan14b);
  const low = put("diffusion_models", "wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors", wan14b);
  const speed = "wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors";
  const info = objectInfo({ unets: [high, low], clips: ["umt5_xxl_fp8_e4m3fn_scaled.safetensors"], vaeFiles: ["wan_2.1_vae.safetensors"], loras: [speed, "style.safetensors"] });
  const profile = inferModels(info).profiles.find((item) => item.model === high);
  assert.equal(profile.variant, "standard");
  assert.deepEqual(profile.speedLoras, { [speed]: "fast" });
  assert.deepEqual(profile.speedVariants.fast, { label: "Fast (4-step)", steps: 4, cfg: 1, sampler: "euler", scheduler: "simple" });
  const request = { kind: "video", workflow: profile.workflow, profileId: profile.id, model: high, prompt: "waves", steps: 4, cfg: 1 };
  const plain = sanitizeGenerateBody({ ...request, loras: [{ name: "style.safetensors", strength: 1 }] }, info);
  assert.equal(plain.variant, "standard");
  const fast = sanitizeGenerateBody({ ...request, loras: [{ name: speed, strength: 1 }] }, info);
  assert.equal(fast.variant, "fast");
  const shifts = Object.values(familyGraph(fast)).filter((node) => node.class_type === "ModelSamplingSD3").map((node) => node.inputs.shift);
  assert.deepEqual([...new Set(shifts)], [5], "lightx2v runs at the 4-step template's shift");
});

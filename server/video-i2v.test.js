import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-video-i2v-"));
process.env.HEISS_COMFY_ROOT = path.join(scratch, "ComfyUI");
process.env.HEISS_DATA_DIR = path.join(scratch, "data");
const dirs = Object.fromEntries(["diffusion_models", "text_encoders", "vae", "clip_vision"].map((name) => {
  const dir = path.join(scratch, "ComfyUI", "models", name);
  fs.mkdirSync(dir, { recursive: true });
  return [name, dir];
}));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { classifyModel } = await import("./model-families.js");
const { familyFromHeader } = await import("./family-catalog.js");
const { catalogDownload } = await import("./family-profiles.js");
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
const wanI2v = { "head.modulation": t([1, 2, 5120]), "head.head.weight": t([64, 5120]), "patch_embedding.weight": t([5120, 36, 1, 2, 2]) };
const hunyuan15 = { "txt_in.individual_token_refiner.blocks.0.norm1.weight": t([1]), "vision_in.proj.0.weight": t([1]), "img_in.proj.weight": t([2048, 65, 1, 2, 2]) };

const list = (values) => ({ input: { required: values } });
const nodes = ["CLIPTextEncode", "VAEDecode", "SaveImage", "EmptyLatentImage", "KSamplerAdvanced", "ModelSamplingSD3", "CreateVideo", "SaveVideo", "LoadImage",
  "WanImageToVideo", "HunyuanVideo15ImageToVideo", "CLIPVisionEncode", "EmptyHunyuanLatentVideo", "EmptyHunyuanVideo15Latent"];
function objectInfo({ unets = [], clips = [], vaeFiles = [], vision = [] } = {}) {
  return {
    ...Object.fromEntries(nodes.map((name) => [name, list({})])),
    UNETLoader: list({ unet_name: [unets], weight_dtype: [["default"]] }),
    CheckpointLoaderSimple: list({ ckpt_name: [[]] }),
    CLIPLoader: list({ clip_name: [clips], type: [["wan"]] }),
    DualCLIPLoader: list({ clip_name1: [clips], clip_name2: [clips], type: [["hunyuan_video_15"]] }),
    VAELoader: list({ vae_name: [vaeFiles] }),
    CLIPVisionLoader: list({ clip_name: [vision] }),
    KSampler: list({ sampler_name: [["euler"]], scheduler: [["simple"]] })
  };
}
const classes = (graph) => Object.values(graph).map((node) => node.class_type);

test("Wan 2.2 14B I2V is read from its weights; Wan 2.1 I2V and Fun inpaint stay apart", () => {
  assert.equal(familyFromHeader(wanI2v).family, "wan22_14b_i2v");
  assert.equal(familyFromHeader({ ...wanI2v, "img_emb.proj.0.bias": t([1]) }).family, "wan_i2v");
  put("diffusion_models", "wan2.2_fun_inpaint_high_noise_14B_fp8_scaled.safetensors", wanI2v);
  assert.equal(classifyModel("unet", "wan2.2_fun_inpaint_high_noise_14B_fp8_scaled.safetensors").family, "wan_other");
  assert.equal(classifyModel("unet", "remote/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors").family, "wan22_14b_i2v", "out of reach, the name says i2v");
  const t2v = put("diffusion_models", "wan2.2_i2v_named_but_t2v_high_noise.safetensors", { "head.modulation": t([1, 2, 5120]), "head.head.weight": t([64, 5120]), "patch_embedding.weight": t([5120, 16, 1, 2, 2]) });
  assert.equal(classifyModel("unet", t2v).family, "wan22_14b", "readable weights outrank an i2v in the name");
});

test("Wan 2.2 14B I2V asks for a start image and runs its pair through WanImageToVideo", () => {
  const high = put("diffusion_models", "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", wanI2v);
  const low = put("diffusion_models", "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors", wanI2v);
  const info = objectInfo({ unets: [high, low], clips: ["umt5_xxl_fp8_e4m3fn_scaled.safetensors"], vaeFiles: ["wan_2.1_vae.safetensors"] });
  const models = inferModels(info);
  const profile = models.profiles.find((item) => item.model === high);
  assert.equal(profile.family, "wan22_14b_i2v");
  assert.equal(profile.ready, true);
  assert.equal(profile.pairModel, low);
  assert.equal(models.profiles.filter((item) => item.family === "wan22_14b_i2v").length, 1, "the low-noise half is not a model of its own");
  assert.deepEqual(profile.mediaInputs.map((input) => [input.id, input.required, input.role]), [["reference", true, "start"]]);
  assert.equal(profile.capabilities.startImageRequired, true);
  assert.deepEqual([profile.defaults.steps, profile.defaults.cfg, profile.defaults.width, profile.defaults.height, profile.defaults.frames], [20, 3.5, 832, 480, 81]);

  const request = { kind: "video", workflow: profile.workflow, profileId: profile.id, model: high, prompt: "the dragon turns" };
  assert.throws(() => sanitizeGenerateBody(request, info), /Add a start image/);
  const body = sanitizeGenerateBody({ ...request, referenceAssets: [{ slot: "reference", assetId: "upload:1" }] }, info);
  const graph = familyGraph({ ...body, startImageComfy: "dragon.png" });
  const i2v = Object.entries(graph).find(([, node]) => node.class_type === "WanImageToVideo");
  assert.ok(i2v, "WanImageToVideo builds conditioning and latent");
  assert.equal(graph[i2v[1].inputs.start_image[0]].inputs.image, "dragon.png");
  const samplers = Object.values(graph).filter((node) => node.class_type === "KSamplerAdvanced");
  assert.equal(samplers.length, 2);
  assert.deepEqual(samplers[0].inputs.positive, [i2v[0], 0]);
  assert.deepEqual(samplers[0].inputs.latent_image, [i2v[0], 2]);
  assert.ok(!classes(graph).includes("EmptyHunyuanLatentVideo"));
  assert.deepEqual([...new Set(Object.values(graph).filter((node) => node.class_type === "ModelSamplingSD3").map((node) => node.inputs.shift))], [5]);
});

test("HunyuanVideo 1.5 I2V is told by name, fetches its vision encoder, and reads the start image with it", () => {
  const model = put("diffusion_models", "hunyuanvideo1.5_720p_i2v_fp16.safetensors", hunyuan15);
  assert.equal(classifyModel("unet", model).family, "hunyuan15_i2v");
  const clips = ["qwen_2.5_vl_7b_fp8_scaled.safetensors", "byt5_small_glyphxl_fp16.safetensors"];
  const base = { unets: [model], clips, vaeFiles: ["hunyuanvideo15_vae_fp16.safetensors"] };
  const waiting = inferModels(objectInfo(base)).profiles.find((item) => item.model === model);
  assert.equal(waiting.ready, false);
  const vision = waiting.missing.find((item) => item.part === "vision");
  assert.equal(vision.downloads[0].id, "vision:sigclip_384:0");
  assert.equal(catalogDownload("vision:sigclip_384:0").folder, "clip_vision");

  const info = objectInfo({ ...base, vision: ["sigclip_vision_patch14_384.safetensors"] });
  const profile = inferModels(info).profiles.find((item) => item.model === model);
  assert.equal(profile.ready, true);
  assert.deepEqual([profile.variant, profile.defaults.width, profile.defaults.height, profile.defaults.cfg, profile.defaults.frames], ["p720", 1280, 720, 6, 121]);
  const body = sanitizeGenerateBody({ kind: "video", workflow: profile.workflow, profileId: profile.id, model, prompt: "a dinosaur walks", referenceAssets: [{ slot: "reference", assetId: "upload:2" }] }, info);
  const graph = familyGraph({ ...body, startImageComfy: "dino.png" });
  const encode = Object.values(graph).find((node) => node.class_type === "CLIPVisionEncode");
  assert.equal(encode.inputs.crop, "center");
  const i2v = Object.values(graph).find((node) => node.class_type === "HunyuanVideo15ImageToVideo");
  assert.ok(i2v.inputs.clip_vision_output);
  assert.equal(Object.values(graph).find((node) => node.class_type === "CLIPVisionLoader").inputs.clip_name, "sigclip_vision_patch14_384.safetensors");
});

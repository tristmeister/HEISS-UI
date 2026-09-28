import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Point ComfyUI and the data folder at a scratch tree before the modules read them.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-model-quant-"));
process.env.HEISS_COMFY_ROOT = path.join(scratch, "ComfyUI");
process.env.HEISS_DATA_DIR = path.join(scratch, "data");
const dirs = Object.fromEntries(["diffusion_models", "checkpoints", "text_encoders", "vae"].map((name) => {
  const dir = path.join(scratch, "ComfyUI", "models", name);
  fs.mkdirSync(dir, { recursive: true });
  return [name, dir];
}));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { classifyModel } = await import("./model-families.js");
const { quantFromHeader } = await import("./family-catalog.js");
const { inferModels } = await import("./models.js");
const { familyGraph } = await import("./family-graph.js");
const { sanitizeGenerateBody } = await import("./validation.js");

const t = (shape) => ({ dtype: "F16", shape, data_offsets: [0, 0] });
const filler = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`filler.${index}.weight`, t([1])]));
const prefixed = (prefix, header) => Object.fromEntries(Object.entries({ ...header, ...filler }).map(([key, value]) => [`${prefix}${key}`, value]));
const flux = { "double_blocks.0.img_attn.norm.key_norm.scale": t([128]), "img_in.weight": t([3072, 64]), "guidance_in.in_layer.weight": t([3072, 256]) };

function put(folder, name, header) {
  const json = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(json.length));
  fs.writeFileSync(path.join(dirs[folder], name), Buffer.concat([length, json]));
  return name;
}

const list = (values) => ({ input: { required: values } });
const nodes = ["CLIPTextEncode", "VAEDecode", "SaveImage", "EmptyLatentImage", "EmptySD3LatentImage", "FluxGuidance", "ConditioningZeroOut", "KSamplerAdvanced"];
function objectInfo({ unets = [], checkpoints = [], extra = {} } = {}) {
  return {
    ...Object.fromEntries(nodes.map((name) => [name, list({})])),
    UNETLoader: list({ unet_name: [unets], weight_dtype: [["default"]] }),
    CheckpointLoaderSimple: list({ ckpt_name: [checkpoints] }),
    CLIPLoader: list({ clip_name: [[]], type: [["stable_diffusion"]] }),
    DualCLIPLoader: list({ clip_name1: [[]], clip_name2: [[]], type: [["sdxl", "flux"]] }),
    VAELoader: list({ vae_name: [[]] }),
    KSampler: list({ sampler_name: [["euler"]], scheduler: [["simple"]] }),
    ...extra
  };
}

test("quantized formats are told from their tensor keys, metadata, and only then the name", () => {
  assert.equal(quantFromHeader({ "transformer_blocks.0.attn.to_qkv.qweight": t([1]), "transformer_blocks.0.attn.to_qkv.wscales": t([1]) }), "svdq");
  assert.equal(quantFromHeader({ "double_blocks.0.img_attn.qkv.weight.absmax": t([1]), "double_blocks.0.img_attn.qkv.weight.quant_state.bitsandbytes__nf4": t([1]) }), "nf4");
  assert.equal(quantFromHeader({ __metadata__: { quantization_config: "{\"method\": \"svdquant\"}" }, "a.weight": t([1]) }), "svdq");
  assert.equal(quantFromHeader({ "a.weight": t([1]), "a.weight_scale": t([1]), "a.comfy_quant": t([1]) }), "", "ComfyUI's own int8/fp8 layouts load natively");
  assert.equal(quantFromHeader(null, "svdq-int4_r32-flux.1-dev.safetensors"), "svdq");
  assert.equal(quantFromHeader(null, "flux1-dev-bnb-nf4-v2.safetensors"), "nf4");
  assert.equal(quantFromHeader({ "a.weight": t([1]) }, "svdq-named-but-plain.safetensors"), "", "readable weights outrank the name");
});

test("a Nunchaku file is never offered as ready, and says why", () => {
  put("diffusion_models", "svdq-int4_r32-flux.1-dev.safetensors", { "transformer_blocks.0.mlp_fc1.qweight": t([1]), "transformer_blocks.0.mlp_fc1.wscales": t([1]), "single_transformer_blocks.0.qkv_proj.qweight": t([1]) });
  assert.equal(classifyModel("unet", "svdq-int4_r32-flux.1-dev.safetensors").quant, "svdq");
  const models = inferModels(objectInfo({ unets: ["svdq-int4_r32-flux.1-dev.safetensors"] }));
  assert.equal(models.profiles.length, 0);
  const file = models.modelFiles.find((item) => item.name === "svdq-int4_r32-flux.1-dev.safetensors");
  assert.equal(file.supported, false);
  assert.match(file.reason, /Nunchaku/);
});

test("an NF4 checkpoint waits for its loader pack, then loads through it", () => {
  const name = put("checkpoints", "flux1-dev-bnb-nf4-v2.safetensors", {
    ...prefixed("model.diffusion_model.", { ...flux, "double_blocks.0.img_attn.qkv.weight.absmax": t([1]), "double_blocks.0.img_attn.qkv.weight.quant_map": t([16]) }),
    "text_encoders.clip_l.transformer.text_model.x": t([1]),
    "vae.decoder.conv_in.weight": t([512, 16, 3, 3])
  });
  const without = inferModels(objectInfo({ checkpoints: [name] })).profiles.find((item) => item.model === name);
  assert.equal(without.family, "flux1");
  assert.equal(without.ready, false);
  assert.equal(without.missing[0].nodePack?.id, "bnb_nf4");

  const info = objectInfo({ checkpoints: [name], extra: { CheckpointLoaderNF4: list({ ckpt_name: [[name]] }) } });
  const ready = inferModels(info).profiles.find((item) => item.model === name);
  assert.equal(ready.ready, true);
  const body = sanitizeGenerateBody({ kind: "image", workflow: ready.workflow, profileId: ready.id, model: name, prompt: "a fox" }, info);
  const graph = familyGraph(body);
  assert.ok(Object.values(graph).some((node) => node.class_type === "CheckpointLoaderNF4"));
  assert.ok(!Object.values(graph).some((node) => node.class_type === "CheckpointLoaderSimple"));
});

test("an NF4 file in diffusion_models is not runnable and says where it would work", () => {
  put("diffusion_models", "flux-nf4-unet.safetensors", { ...flux, "double_blocks.0.img_attn.qkv.weight.absmax": t([1]) });
  const models = inferModels(objectInfo({ unets: ["flux-nf4-unet.safetensors"] }));
  assert.equal(models.profiles.length, 0);
  assert.match(models.modelFiles[0].reason, /checkpoints/);
});

test("a checkpoint whose weights match nothing known asks for its type instead of running as SDXL", () => {
  const name = put("checkpoints", "someNewArch_v1.safetensors", prefixed("model.diffusion_model.", { "brand_new_block.0.weight": t([1, 1]), "brand_new_block.1.weight": t([1, 1]) }));
  const classified = classifyModel("checkpoint", name);
  assert.deepEqual([classified.family, classified.via], ["other", "file"]);
  const models = inferModels(objectInfo({ checkpoints: [name] }));
  assert.equal(models.profiles.length, 0);
  assert.match(models.modelFiles[0].reason, /Unknown type/);
  // Out of reach (a remote ComfyUI), a checkpoint still defaults to the SD family.
  assert.equal(classifyModel("checkpoint", "remote/someNewArch_v1.safetensors").family, "sdxl");
});

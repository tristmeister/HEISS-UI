import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Point ComfyUI and the data folder at a scratch tree before the modules read them.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-gguf-"));
process.env.HEISS_COMFY_ROOT = path.join(scratch, "ComfyUI");
process.env.HEISS_DATA_DIR = path.join(scratch, "data");
const dirs = Object.fromEntries(["diffusion_models", "checkpoints", "text_encoders", "vae"].map((name) => {
  const dir = path.join(scratch, "ComfyUI", "models", name);
  fs.mkdirSync(dir, { recursive: true });
  return [name, dir];
}));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { ggufModelNames, readGgufHeader, withGgufLoaders } = await import("./gguf.js");
const { classifyModel } = await import("./model-families.js");
const { familyFromHeader } = await import("./family-catalog.js");
const { classifyEncoder, encoderKindFromHeader } = await import("./model-components.js");
const { inferModels } = await import("./models.js");
const { familyGraph } = await import("./family-graph.js");
const { sanitizeGenerateBody } = await import("./validation.js");

/* ------------------------------------------------------------ A tiny GGUF writer */

const u32 = (value) => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
const u64 = (value) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; };
const str = (text) => { const bytes = Buffer.from(text, "utf8"); return Buffer.concat([u64(bytes.length), bytes]); };
const value = {
  string: (text) => Buffer.concat([u32(8), str(text)]),
  u32: (number) => Buffer.concat([u32(4), u32(number)]),
  int32s: (list) => Buffer.concat([u32(9), u32(5), u64(list.length), ...list.map((item) => { const b = Buffer.alloc(4); b.writeInt32LE(item); return b; })]),
  f32s: (count) => Buffer.concat([u32(9), u32(6), u64(count), Buffer.alloc(count * 4)]),
  strings: (list) => Buffer.concat([u32(9), u32(8), u64(list.length), ...list.map(str)])
};

/**
 * A GGUF v3 header: metadata as [key, encoded value], tensors as
 * [name, torch shape, ggml type] (written innermost dimension first, as GGUF does).
 */
function gguf(metadata, tensors) {
  return Buffer.concat([
    Buffer.from("GGUF"), u32(3), u64(tensors.length), u64(metadata.length),
    ...metadata.map(([key, encoded]) => Buffer.concat([str(key), encoded])),
    ...tensors.map(([name, shape, type = 12]) => Buffer.concat([str(name), u32(shape.length), ...[...shape].reverse().map(u64), u32(type), u64(0)]))
  ]);
}

function put(folder, name, bytes) {
  fs.mkdirSync(path.dirname(path.join(dirs[folder], name)), { recursive: true });
  fs.writeFileSync(path.join(dirs[folder], name), bytes);
  return name;
}

// What ComfyUI-GGUF's convert.py writes: original key names, arch in general.architecture.
const fluxModel = gguf([["general.architecture", value.string("flux")], ["general.file_type", value.u32(14)]], [
  ["double_blocks.0.img_attn.norm.key_norm.scale", [128], 0],
  ["img_in.weight", [3072, 64], 0],
  ["guidance_in.in_layer.weight", [3072, 256], 8],
  ["double_blocks.0.img_attn.qkv.weight", [9216, 3072], 12]
]);
// llama.cpp's names, which ComfyUI-GGUF renames before ComfyUI sees them; a vocabulary to skip.
const t5Encoder = gguf([
  ["general.architecture", value.string("t5encoder")],
  ["tokenizer.ggml.tokens", value.strings(Array.from({ length: 300 }, (_, index) => `tok${index}`))],
  ["tokenizer.ggml.scores", value.f32s(300)]
], [
  ["token_embd.weight", [32128, 4096], 8],
  ["enc.blk.23.ffn_up.weight", [10240, 4096], 12],
  ["enc.blk.0.attn_rel_b.weight", [32, 64], 1]
]);
const qwen3Encoder = gguf([["general.architecture", value.string("qwen3")]], [
  ["blk.0.ffn_norm.weight", [2560], 0],
  ["blk.0.attn_q_norm.weight", [128], 0],
  ["blk.0.attn_q.weight", [4096, 2560], 12]
]);

const list = (values) => ({ input: { required: values } });
const node = () => list({});

function objectInfo({ unets = [], ggufUnets, clips = [], ggufClips, vaeFiles = [] } = {}) {
  const nodes = ["KSampler", "CLIPTextEncode", "VAEDecode", "SaveImage", "EmptySD3LatentImage", "FluxGuidance", "ConditioningZeroOut", "VAEEncode", "LoadImage", "EmptyLatentImage"];
  const clipTypes = [["stable_diffusion", "flux", "lumina2"]];
  return {
    ...Object.fromEntries(nodes.map((name) => [name, node()])),
    UNETLoader: list({ unet_name: [unets], weight_dtype: [["default", "fp8_e4m3fn"]] }),
    CheckpointLoaderSimple: list({ ckpt_name: [[]] }),
    CLIPLoader: list({ clip_name: [clips], type: clipTypes }),
    DualCLIPLoader: list({ clip_name1: [clips], clip_name2: [clips], type: clipTypes }),
    VAELoader: list({ vae_name: [vaeFiles] }),
    KSampler: list({ sampler_name: [["euler", "res_multistep"]], scheduler: [["simple"]] }),
    // ComfyUI-GGUF: its unet list holds only .gguf; its CLIP loaders list safetensors and GGUF alike.
    ...(ggufUnets ? {
      UnetLoaderGGUF: list({ unet_name: [ggufUnets] }),
      CLIPLoaderGGUF: list({ clip_name: [[...clips, ...ggufClips].sort()], type: clipTypes }),
      DualCLIPLoaderGGUF: list({ clip_name1: [[...clips, ...ggufClips].sort()], clip_name2: [[...clips, ...ggufClips].sort()], type: clipTypes }),
      TripleCLIPLoaderGGUF: node(),
      QuadrupleCLIPLoaderGGUF: node()
    } : {})
  };
}

function safetensors(header) {
  const json = Buffer.from(JSON.stringify(header));
  return Buffer.concat([u64(json.length), json]);
}

/* ------------------------------------------------------------ Headers */

test("a GGUF header reads like a safetensors one: PyTorch shapes, quant types, scalar metadata", () => {
  const header = readGgufHeader(path.join(dirs.diffusion_models, put("diffusion_models", "flux-header.gguf", fluxModel)));
  assert.deepEqual(header["img_in.weight"], { dtype: "F32", shape: [3072, 64] });
  assert.deepEqual(header["double_blocks.0.img_attn.qkv.weight"], { dtype: "Q4_K", shape: [9216, 3072] });
  assert.equal(header.__metadata__["general.architecture"], "flux");
  assert.equal(header.__metadata__["general.file_type"], 14);
  assert.equal(familyFromHeader(header).family, "flux1");
});

test("a flattened tensor keeps its original shape, and vocabularies are skipped", () => {
  const file = put("diffusion_models", "sdxl-unet.gguf", gguf([
    ["general.architecture", value.string("sdxl")],
    ["tokenizer.ggml.tokens", value.strings(["a", "b"].concat(Array.from({ length: 100 }, () => "x")))],
    ["comfy.gguf.orig_shape.input_blocks.4.1.transformer_blocks.0.attn2.to_k.weight", value.int32s([640, 2048])]
  ], [
    ["input_blocks.0.0.weight", [320, 4, 3, 3], 1],
    ["input_blocks.4.1.transformer_blocks.0.attn2.to_k.weight", [5120, 256], 12]
  ]));
  const header = readGgufHeader(path.join(dirs.diffusion_models, file));
  assert.deepEqual(header["input_blocks.4.1.transformer_blocks.0.attn2.to_k.weight"].shape, [640, 2048]);
  assert.equal(header.__metadata__["tokenizer.ggml.tokens"], undefined);
  assert.equal(familyFromHeader(header).family, "sdxl");
});

test("GGUF text encoders are recognised under the names ComfyUI-GGUF gives them", () => {
  assert.equal(encoderKindFromHeader(readGgufHeader(path.join(dirs.text_encoders, put("text_encoders", "t5-v1_1-xxl-encoder-Q4_K_M.gguf", t5Encoder)))), "t5xxl");
  assert.equal(encoderKindFromHeader(readGgufHeader(path.join(dirs.text_encoders, put("text_encoders", "mystery-encoder.gguf", qwen3Encoder)))), "qwen3_4b");
  assert.deepEqual(classifyEncoder("mystery-encoder.gguf"), { name: "mystery-encoder.gguf", kind: "qwen3_4b", via: "file" });
});

test("anything that is not a GGUF file is refused, and a model then falls back to its name", () => {
  const bad = put("diffusion_models", "flux1-dev-broken.gguf", Buffer.from("GGUF\x01\x00\x00\x00"));
  assert.throws(() => readGgufHeader(path.join(dirs.diffusion_models, bad)), /version/);
  const truncated = put("diffusion_models", "cut.gguf", fluxModel.subarray(0, 60));
  assert.throws(() => readGgufHeader(path.join(dirs.diffusion_models, truncated)), /truncated|too large/);
  assert.equal(classifyModel("unet", bad).via, "name");
  assert.equal(classifyModel("unet", put("diffusion_models", "renamed-finetune.gguf", fluxModel)).via, "file");
});

/* ------------------------------------------------------------ Profiles and graphs */

test("with ComfyUI-GGUF, GGUF models and encoders run through its loaders", () => {
  const model = put("diffusion_models", "my-finetune-Q4_K_S.gguf", fluxModel);
  const clipL = put("text_encoders", "clip_l.safetensors", safetensors({ "text_model.encoder.layers.0.mlp.fc1.weight": { dtype: "F16", shape: [3072, 768], data_offsets: [0, 0] } }));
  const t5 = "t5-v1_1-xxl-encoder-Q4_K_M.gguf";
  const vae = put("vae", "ae.safetensors", safetensors({ "decoder.conv_in.weight": { dtype: "F16", shape: [512, 16, 3, 3], data_offsets: [0, 0] } }));
  const info = objectInfo({ unets: [], ggufUnets: [model], clips: [clipL], ggufClips: [t5], vaeFiles: [vae] });
  const flux = inferModels(info).profiles.find((profile) => profile.model === model);
  assert.equal(flux.family, "flux1");
  assert.equal(flux.detectedBy, "file");
  assert.equal(flux.ready, true);
  assert.deepEqual(flux.encoderSlots.map((slot) => slot.default), [clipL, t5]);
  assert.equal(flux.capabilities.weightDtype, false, "UnetLoaderGGUF has no weight dtype");

  const body = sanitizeGenerateBody({ kind: "image", workflow: flux.workflow, profileId: flux.id, model, prompt: "a fox", textEncoders: [clipL, t5], vae }, info);
  const graph = withGgufLoaders(familyGraph(body));
  const nodes = Object.values(graph);
  const unet = nodes.find((item) => item.class_type === "UnetLoaderGGUF");
  assert.deepEqual(unet.inputs, { unet_name: model });
  const clip = nodes.find((item) => item.class_type === "DualCLIPLoaderGGUF");
  assert.deepEqual(clip.inputs, { clip_name1: clipL, clip_name2: t5, type: "flux" });
  assert.equal(nodes.some((item) => ["UNETLoader", "DualCLIPLoader"].includes(item.class_type)), false);
});

test("safetensors-only graphs keep the core loaders", () => {
  const graph = withGgufLoaders({
    1: { class_type: "UNETLoader", inputs: { unet_name: "flux.safetensors", weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: "t5.safetensors", type: "flux", device: "default" } },
    3: { class_type: "CLIPLoader", inputs: { clip_name: "qwen3-4b-Q8_0.gguf", type: "lumina2", device: "default" } }
  });
  assert.equal(graph[1].class_type, "UNETLoader");
  assert.equal(graph[2].class_type, "CLIPLoader");
  assert.deepEqual(graph[3], { class_type: "CLIPLoaderGGUF", inputs: { clip_name: "qwen3-4b-Q8_0.gguf", type: "lumina2" } });
});

test("without ComfyUI-GGUF, GGUF files on disk show up needing it, with an install", () => {
  put("diffusion_models", path.join("HighNoise", "Wan2.2-T2V-A14B-HighNoise-Q4_K_M.gguf"), gguf([["general.architecture", value.string("wan")]], [["head.modulation", [1, 2, 5120], 0]]));
  const names = ggufModelNames(objectInfo());
  assert.ok(names.includes("my-finetune-Q4_K_S.gguf"));
  assert.ok(names.includes(path.join("HighNoise", "Wan2.2-T2V-A14B-HighNoise-Q4_K_M.gguf")), "subfolders are listed the way ComfyUI names them");
  const flux = inferModels(objectInfo()).profiles.find((profile) => profile.model === "my-finetune-Q4_K_S.gguf");
  assert.equal(flux.ready, false);
  const [first] = flux.missing;
  assert.equal(first.label, "ComfyUI-GGUF nodes");
  assert.equal(first.nodePack.repository, "https://github.com/city96/ComfyUI-GGUF.git");
  assert.ok(first.missingNodes.includes("UnetLoaderGGUF"));
});

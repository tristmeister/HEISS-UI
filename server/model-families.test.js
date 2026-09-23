import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Point ComfyUI and the data folder at a scratch tree before the modules read them.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-model-types-"));
process.env.HEISS_COMFY_ROOT = path.join(scratch, "ComfyUI");
process.env.HEISS_DATA_DIR = path.join(scratch, "data");
const unetDir = path.join(scratch, "ComfyUI", "models", "diffusion_models");
const checkpointDir = path.join(scratch, "ComfyUI", "models", "checkpoints");
fs.mkdirSync(unetDir, { recursive: true });
fs.mkdirSync(checkpointDir, { recursive: true });
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { classifyModel, readSafetensorsHeader, setModelChoice, typeFromArchitecture, typeFromHeader } = await import("./model-families.js");
const { inferModels } = await import("./models.js");
const { krea2ImageGraph } = await import("./graphs.js");

const tensor = (shape) => ({ dtype: "F16", shape, data_offsets: [0, 0] });
const krea2Header = { "txtfusion.projector.weight": tensor([3072, 12]), "first.weight": tensor([3072, 64]) };
const fluxHeader = { "double_blocks.0.img_attn.qkv.weight": tensor([9216, 3072]) };

function writeSafetensors(file, header) {
  const json = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(json.length));
  fs.writeFileSync(file, Buffer.concat([length, json]));
}

function choices(values) {
  return { input: { required: values } };
}

function fakeObjectInfo({ unets = [], checkpoints = [], clipTypes = ["krea2", "qwen_image", "wan"], extra = {} } = {}) {
  return {
    UNETLoader: choices({ unet_name: [unets], weight_dtype: [["default", "fp8_e4m3fn"]] }),
    CheckpointLoaderSimple: choices({ ckpt_name: [checkpoints] }),
    CLIPLoader: choices({ clip_name: [["qwen3VL4B.safetensors", "umt5.safetensors"]], type: [clipTypes] }),
    VAELoader: choices({ vae_name: [["ae.safetensors", "qwen_image_vae.safetensors"]] }),
    LoraLoader: choices({ lora_name: [["style.safetensors"]] }),
    KSampler: choices({ sampler_name: [["euler", "dpmpp_2m"]], scheduler: [["simple", "karras"]] }),
    CLIPTextEncode: choices({}),
    EmptyLatentImage: choices({}),
    EmptySD3LatentImage: choices({}),
    VAEDecode: choices({}),
    SaveImage: choices({}),
    ...extra
  };
}

test("safetensors headers are read from disk", () => {
  const file = path.join(scratch, "roundtrip.safetensors");
  writeSafetensors(file, { __metadata__: { format: "pt" }, ...krea2Header });
  assert.deepEqual(readSafetensorsHeader(file)["txtfusion.projector.weight"].shape, [3072, 12]);
});

test("tensor keys identify the architecture, prefix or not", () => {
  assert.equal(typeFromHeader(krea2Header), "krea2");
  assert.equal(typeFromHeader({ "model.diffusion_model.txtfusion.projector.weight": tensor([1, 1]) }), "krea2");
  const lumina = (width) => ({ "cap_embedder.1.weight": tensor([width, 2560]), "noise_refiner.0.attention.k_norm.weight": tensor([128]) });
  assert.equal(typeFromHeader(lumina(3840)), "z-image");
  assert.equal(typeFromHeader(lumina(2304)), "other");
  assert.equal(typeFromHeader(lumina(1234)), "", "an unseen Lumina width defers to the filename");
  assert.equal(typeFromHeader({ "head.modulation": tensor([1, 2, 5120]) }), "wan");
  assert.equal(typeFromHeader({ "model.diffusion_model.input_blocks.0.0.weight": tensor([320, 4, 3, 3]) }), "checkpoint");
  assert.equal(typeFromHeader(fluxHeader), "other");
  assert.equal(typeFromHeader({}), "");
});

test("modelspec architecture strings map to types", () => {
  assert.equal(typeFromArchitecture("krea2"), "krea2");
  assert.equal(typeFromArchitecture("stable-diffusion-xl-v1-base"), "checkpoint");
  assert.equal(typeFromArchitecture("Flux.1-dev"), "other");
  assert.equal(typeFromArchitecture(""), "");
});

test("the weights win over the filename in both directions", () => {
  writeSafetensors(path.join(unetDir, "myRealismMix_v2.safetensors"), krea2Header);
  writeSafetensors(path.join(unetDir, "krea2_but_actually_flux.safetensors"), fluxHeader);
  assert.deepEqual(classifyModel("unet", "myRealismMix_v2.safetensors"), { type: "krea2", via: "file" });
  assert.deepEqual(classifyModel("unet", "krea2_but_actually_flux.safetensors"), { type: "", via: "file" });
});

test("filenames decide when the file is out of reach", () => {
  assert.deepEqual(classifyModel("unet", "remote/krea2TurboFP8.safetensors"), { type: "krea2", via: "name" });
  assert.equal(classifyModel("unet", "flux1-krea-dev.safetensors").type, "", "FLUX.1 Krea is a Flux model");
  assert.equal(classifyModel("unet", "z_image_turbo_bf16.safetensors").type, "z-image");
  assert.deepEqual(classifyModel("checkpoint", "juggernautXL.safetensors"), { type: "checkpoint", via: "default" });
  assert.deepEqual(classifyModel("checkpoint", "krea2_aio.safetensors"), { type: "krea2", via: "name" });
});

test("a chosen type overrides detection and can be undone", () => {
  setModelChoice("unet", "mystery.safetensors", "krea2");
  assert.deepEqual(classifyModel("unet", "mystery.safetensors"), { type: "krea2", via: "choice" });
  setModelChoice("unet", "mystery.safetensors", "");
  assert.equal(classifyModel("unet", "mystery.safetensors").type, "");
  assert.throws(() => setModelChoice("checkpoint", "x.safetensors", "wan"), /cannot load from this folder/);
  assert.throws(() => setModelChoice("loras", "x.safetensors", "krea2"), /Unknown model folder/);
});

test("Krea 2 models become profiles, unrecognised ones are listed", () => {
  const info = fakeObjectInfo({
    unets: ["myRealismMix_v2.safetensors", "krea2TurboFP8.safetensors", "mystery.safetensors"],
    checkpoints: ["krea2_aio.safetensors", "juggernautXL.safetensors"]
  });
  const models = inferModels(info);
  const krea = models.profiles.filter((profile) => profile.family === "krea2");
  assert.deepEqual(krea.map((profile) => profile.id).sort(), [
    "image:krea2-checkpoint:krea2_aio.safetensors",
    "image:krea2:krea2TurboFP8.safetensors",
    "image:krea2:myRealismMix_v2.safetensors"
  ]);
  const unet = krea.find((profile) => profile.workflow === "krea2-image");
  assert.equal(unet.defaults.textEncoder, "qwen3VL4B.safetensors");
  assert.equal(unet.defaults.vae, "qwen_image_vae.safetensors");
  assert.equal(unet.defaults.clipType, "krea2");
  assert.equal(unet.capabilities.lora, true);
  assert.equal(models.profiles.find((profile) => profile.model === "juggernautXL.safetensors")?.workflow, "checkpoint-image");
  assert.deepEqual(models.unsupportedModels, ["mystery.safetensors"]);
  const mystery = models.modelFiles.find((file) => file.name === "mystery.safetensors");
  assert.equal(mystery.supported, false);
  assert.ok(models.modelTypeChoices.unet.some((choice) => choice.value === "krea2"));
});

test("a ComfyUI without Krea 2 support explains why the model is unused", () => {
  const models = inferModels(fakeObjectInfo({ unets: ["krea2TurboFP8.safetensors"], clipTypes: ["wan"] }));
  assert.equal(models.profiles.some((profile) => profile.family === "krea2"), false);
  assert.match(models.modelFiles[0].reason, /too old for Krea 2/);
});

test("Krea 2 graph chains core LoRA loaders behind the optional enhancer", () => {
  const body = { workflow: "krea2-image", model: "k2.safetensors", textEncoder: "te.safetensors", vae: "vae.safetensors", prompt: "a cat", seed: 7, loras: [{ name: "a.safetensors", strength: 0.5 }, { name: "b.safetensors", strength: 0.8 }] };
  const plain = krea2ImageGraph(body);
  assert.equal(plain["2"].inputs.type, "krea2");
  assert.equal(plain["4"], undefined);
  assert.deepEqual(plain["11"].inputs.model, ["1", 0]);
  assert.equal(plain["11"].inputs.strength_clip, 0.5);
  assert.deepEqual(plain["12"].inputs.model, ["11", 0]);
  assert.deepEqual(plain["8"].inputs.model, ["12", 0]);
  assert.deepEqual(plain["5"].inputs.clip, ["12", 1]);

  const enhanced = krea2ImageGraph({ ...body, krea2Enhancer: true });
  assert.equal(enhanced["4"].class_type, "ComfyUI-Krea2T-Enhancer");
  assert.deepEqual(enhanced["11"].inputs.model, ["4", 0]);

  const checkpoint = krea2ImageGraph({ ...body, workflow: "krea2-checkpoint", loras: [] });
  assert.equal(checkpoint["1"].class_type, "CheckpointLoaderSimple");
  assert.equal(checkpoint["2"], undefined);
  assert.deepEqual(checkpoint["9"].inputs.vae, ["1", 2]);
  assert.deepEqual(checkpoint["8"].inputs.model, ["1", 0]);
});

test("the enhancer follows ComfyUI's node list, not the request", async () => {
  const { sanitizeGenerateBody } = await import("./validation.js");
  const request = { kind: "image", workflow: "krea2-image", model: "krea2TurboFP8.safetensors", prompt: "a cat", textEncoder: "qwen3VL4B.safetensors", vae: "qwen_image_vae.safetensors", clipType: "wan", krea2Enhancer: true };
  const without = sanitizeGenerateBody(request, fakeObjectInfo({ unets: ["krea2TurboFP8.safetensors"] }));
  assert.equal(without.krea2Enhancer, false);
  assert.equal(without.clipType, "krea2");
  const withNode = sanitizeGenerateBody(request, fakeObjectInfo({ unets: ["krea2TurboFP8.safetensors"], extra: { "ComfyUI-Krea2T-Enhancer": choices({}) } }));
  assert.equal(withNode.krea2Enhancer, true);
});

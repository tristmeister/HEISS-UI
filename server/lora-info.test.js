import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-lora-info-"));
process.env.HEISS_COMFY_ROOT = path.join(scratch, "ComfyUI");
process.env.HEISS_DATA_DIR = path.join(scratch, "data");
const loraDir = path.join(scratch, "ComfyUI", "models", "loras");
fs.mkdirSync(path.join(loraDir, "sdxl"), { recursive: true });
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { cachedLoraAbout, familiesFromKeys, familiesFromMetadata, loraInfo, triggersFromMetadata } = await import("./lora-info.js");

const t = (shape) => ({ dtype: "F16", shape, data_offsets: [0, 0] });
function put(name, header) {
  const json = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(json.length));
  fs.writeFileSync(path.join(loraDir, name), Buffer.concat([length, json]));
  return name;
}

test("SD LoRAs are told apart by their cross-attention width", () => {
  const sd = (width) => ({ "lora_unet_down_blocks_0_attentions_0_transformer_blocks_0_attn2_to_k.lora_down.weight": t([16, width]), "lora_unet_down_blocks_0_attentions_0_transformer_blocks_0_attn2_to_k.lora_up.weight": t([320, 16]) });
  assert.deepEqual(familiesFromKeys(sd(768)), ["sd15"]);
  assert.deepEqual(familiesFromKeys(sd(2048)), ["sdxl"]);
  assert.deepEqual(familiesFromKeys({ "lora_unet_input_blocks_4_1_proj_in.lora_down.weight": t([8, 640]), "lora_te2_text_model_encoder_layers_0_mlp_fc1.lora_down.weight": t([8, 1280]) }), ["sdxl"]);
});

test("Flux.1 and the Flux.2 sizes are told apart by how wide their blocks are", () => {
  const flux = (linear1) => ({
    "diffusion_model.double_blocks.0.img_attn.qkv.lora_A.weight": t([16, 3072]),
    "diffusion_model.single_blocks.0.linear1.lora_B.weight": t([linear1, 16])
  });
  assert.deepEqual(familiesFromKeys(flux(21504)), ["flux1", "chroma"]);
  assert.deepEqual(familiesFromKeys(flux(27648)), ["flux2_klein_4b"]);
  assert.deepEqual(familiesFromKeys({ "lora_unet_double_blocks_0_img_mod_lin.lora_down.weight": t([16, 3072]) }), ["flux1", "chroma"]);
  assert.deepEqual(familiesFromKeys({ "transformer.single_transformer_blocks.0.attn.to_q.lora_A.weight": t([16, 3072]) }), ["flux1", "chroma", "flux2_klein_4b"]);
});

test("video and newer image LoRAs are placed by their own layers", () => {
  assert.deepEqual(familiesFromKeys({ "diffusion_model.blocks.0.self_attn.q.lora_A.weight": t([32, 5120]) }), ["wan21", "wan22_14b"]);
  assert.deepEqual(familiesFromKeys({ "diffusion_model.blocks.0.self_attn.q.lora_A.weight": t([32, 3072]) }), ["wan22_5b"]);
  assert.deepEqual(familiesFromKeys({ "transformer_blocks.0.img_mlp.net.0.proj.lora_A.weight": t([16, 3072]), "transformer_blocks.0.txt_mlp.net.0.proj.lora_A.weight": t([16, 3072]) }), ["qwen_image"]);
  assert.deepEqual(familiesFromKeys({ "diffusion_model.layers.0.attention.qkv.lora_A.weight": t([16, 3840]) }), ["zimage"]);
  assert.deepEqual(familiesFromKeys({ "something.else.weight": t([1]) }), []);
});

test("metadata names the base model where the keys cannot", () => {
  assert.deepEqual(familiesFromMetadata({ ss_base_model_version: "sdxl_base_v1-0" }), ["sdxl"]);
  assert.deepEqual(familiesFromMetadata({ "modelspec.architecture": "flux-1-dev/lora" }), ["flux1"]);
  assert.deepEqual(familiesFromMetadata({ ss_base_model_version: "sd_v1" }), ["sd15"]);
  assert.deepEqual(familiesFromMetadata({}), []);
});

test("trigger words come from the trainer's note, else the tags on every image", () => {
  assert.deepEqual(triggersFromMetadata({ "modelspec.trigger_phrase": "ohwx person, portrait" }), ["ohwx person", "portrait"]);
  const frequency = JSON.stringify({ "10_ohwx": { ohwx: 20, "1girl": 20, smile: 4 } });
  assert.deepEqual(triggersFromMetadata({ ss_tag_frequency: frequency, ss_dataset_dirs: JSON.stringify({ "10_ohwx": { n_repeats: 10, img_count: 20 } }) }), ["1girl", "ohwx"]);
  assert.deepEqual(triggersFromMetadata({ ss_tag_frequency: "not json" }), []);
});

test("a LoRA file is read once, with the keys winning and metadata narrowing", () => {
  const name = put("sdxl/detail_slider.safetensors", {
    __metadata__: { ss_base_model_version: "sdxl_base_v1-0", ss_output_name: "detail slider", ss_tag_frequency: JSON.stringify({ a: { detailed: 5 } }) },
    "lora_unet_input_blocks_4_1_transformer_blocks_0_attn2_to_k.lora_down.weight": t([8, 2048])
  });
  const info = loraInfo(name);
  assert.deepEqual(info.families, ["sdxl"]);
  assert.equal(info.base, "SDXL");
  assert.deepEqual(info.triggers, ["detailed"]);
  assert.equal(cachedLoraAbout(name), "detail slider");
  assert.equal(loraInfo("../escape.safetensors"), null);
  assert.equal(loraInfo("missing.safetensors"), null);
});

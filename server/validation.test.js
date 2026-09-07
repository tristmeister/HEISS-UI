import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeGenerateBody } from "./validation.js";

const exact = {
  UNETLoader: { input: { required: { unet_name: [["real-dream-klein9b-1-fp8.safetensors"]], weight_dtype: [["default"]] } } },
  CLIPLoader: { input: { required: { clip_name: [["qwen_3_8b_fp8mixed.safetensors"]], type: [["flux2"]] } } },
  VAELoader: { input: { required: { vae_name: [["flux2-vae.safetensors"]] } } },
  UpscaleModelLoader: { input: { required: { model_name: ["COMBO", { options: ["4x-ClearRealityV1.pth"] }] } } },
  KSampler: { input: { required: {
    seed: ["INT", { min: 0, max: 999999 }], steps: ["INT", { min: 1, max: 100 }], cfg: ["FLOAT", { min: 0, max: 100, step: 0.1 }],
    sampler_name: [["euler"]], scheduler: [["simple"]], denoise: ["FLOAT", { min: 0, max: 1, step: 0.01 }]
  } } },
  "Image Resize (rgthree)": { input: { required: { width: ["INT", { min: 16, max: 4096 }], height: ["INT", { min: 16, max: 4096 }] } } },
  LoraLoader: { input: { required: { lora_name: [[]], strength_model: ["FLOAT", { min: -10, max: 10, step: 0.01 }] } } },
  LoadImage: {}, ImageUpscaleWithModel: {}, TextEncodeQwenImageEditPlus: {}, VAEEncode: {}, VAEDecode: {}, ConditioningZeroOut: {}, FluxGuidance: {},
  "Lora Loader Stack (rgthree)": {}, SaveImage: {}, CLIPTextEncode: {}, EmptyLatentImage: { input: { required: { width: ["INT"], height: ["INT"], batch_size: ["INT", { min: 1, max: 8 }] } } }
};

const request = {
  kind: "image",
  workflow: "custom:flux2-real-dream-image-edit",
  profileId: "custom:flux2-real-dream-image-edit",
  model: "custom:flux2-real-dream-image-edit",
  prompt: "Remove the hat",
  width: 1216,
  height: 1536,
  steps: 2,
  cfg: 1,
  denoise: 1,
  sampler: "euler",
  scheduler: "simple",
  count: 1,
  textEncoder: "qwen_3_8b_fp8mixed.safetensors",
  vae: "flux2-vae.safetensors",
  clipType: "flux2",
  weightDtype: "default"
};

test("required reference slots are enforced for image-edit workflows", () => {
  assert.throws(() => sanitizeGenerateBody(request, exact, {}), /Reference image is required/);
  const body = sanitizeGenerateBody({ ...request, count: 4, referenceAssets: [{ slot: "reference", assetId: "upload-id" }] }, exact, {});
  assert.equal(body.referenceAssets[0].assetId, "upload-id");
  assert.equal(body.count, 1);
  assert.deepEqual(body.promptPolicy, { policy: "preserve-source-v1", version: 1 });
});

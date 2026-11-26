import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-kandinsky-"));
process.env.HEISS_SEEDVR2_MODEL_DIR = dir;
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { downloadPlan, embedUpscale, normalizeQuality, upscaleGraph, upscalePlan, upscaleQualities, upscaleStatus } = await import("./upscale.js");
const { planRunUpscale } = await import("./run-upscale.js");

const combo = (values) => ["COMBO", { options: values }];
const infoWith = ({ dits = [], vaes = [], nodes = true } = {}) => ({
  ...(nodes ? {
    KandinskyImageSR2Loader: { input: { required: { model_name: combo(dits), compute_dtype: combo(["bfloat16", "float16"]) } } },
    KandinskyImageSR2Upscale: { input: { required: { upscale_factor: combo(["4", "2"]) } } }
  } : {}),
  VAELoader: { input: { required: { vae_name: combo(vaes) } } },
  SaveImage: { input: { required: {} } }
});
const ready = infoWith({
  dits: ["anima.safetensors", "kandinsky-imagesr-2.0-w4a8.safetensors", "kandinsky-imagesr-2.0-int8-convrot.safetensors"],
  vaes: ["flux2-vae.safetensors", "qwen_image_vae.safetensors", "ae-bf16.safetensors"]
});

test("×2 and ×4 are efforts of their own", () => {
  assert.ok(upscaleQualities.includes("x2"));
  assert.ok(upscaleQualities.includes("x4"));
  assert.equal(normalizeQuality("x4"), "x4");
  assert.equal(normalizeQuality("x3"), "balanced");
});

test("status prefers the int8 ConvRot checkpoint and the FLUX.1 VAE, never the FLUX.2 one", () => {
  const status = upscaleStatus(ready, "x4");
  assert.equal(status.engine, "kandinsky");
  assert.equal(status.ready, true);
  assert.equal(status.quality, "x4");
  assert.deepEqual(status.models.map((model) => model.file), ["kandinsky-imagesr-2.0-int8-convrot.safetensors", "ae-bf16.safetensors"]);
  assert.equal(status.needsDownload, false);
  assert.equal(status.canDownload, false);
  const flux2Only = upscaleStatus(infoWith({ dits: ["kandinsky-imagesr-2.0-bf16.safetensors"], vaes: ["flux2-vae.safetensors"] }), "x2");
  assert.equal(flux2Only.ready, false);
  assert.deepEqual(flux2Only.missingModels, ["vae"]);
  assert.equal(flux2Only.manualModels, true);
});

test("missing nodes are reported by their class names", () => {
  const status = upscaleStatus(infoWith({ nodes: false }), "x2");
  assert.equal(status.nodesInstalled, false);
  assert.deepEqual(status.missingNodes, ["KandinskyImageSR2Loader", "KandinskyImageSR2Upscale"]);
});

test("nothing is downloaded for Kandinsky", () => {
  const plan = downloadPlan("x2", ready);
  assert.deepEqual(plan.files, []);
  assert.equal(plan.totalBytes, 0);
});

test("the output is exactly the factor times the source", () => {
  const two = upscalePlan({ width: 896, height: 1152, quality: "x2" });
  assert.equal(two.preScale, 1);
  assert.deepEqual([two.estimatedWidth, two.estimatedHeight], [1792, 2304]);
  assert.equal(two.scale, 2);
  const four = upscalePlan({ width: 896, height: 1152, quality: "x4" });
  assert.deepEqual([four.estimatedWidth, four.estimatedHeight], [3584, 4608]);
  assert.equal(four.scale, 4);
});

test("a very large source is scaled down first so ×4 stays within 8192", () => {
  const plan = upscalePlan({ width: 3000, height: 4000, quality: "x4" });
  assert.ok(plan.preScale < 1);
  assert.ok(Math.max(plan.estimatedWidth, plan.estimatedHeight) <= 8192);
  const { graph } = upscaleGraph({ imageName: "big.png", quality: "x4", width: 3000, height: 4000 }, ready);
  assert.equal(graph["2"].class_type, "ImageScaleBy");
  assert.deepEqual(graph["5"].inputs.image, ["2", 0]);
});

test("the graph loads the model and VAE and saves through node 9", () => {
  const { graph, plan } = upscaleGraph({ imageName: "pic.png", quality: "x2", width: 896, height: 1152 }, ready);
  assert.equal(graph["1"].inputs.image, "pic.png");
  assert.equal(graph["2"], undefined);
  assert.equal(graph["3"].inputs.model_name, "kandinsky-imagesr-2.0-int8-convrot.safetensors");
  assert.equal(graph["4"].inputs.vae_name, "ae-bf16.safetensors");
  assert.equal(graph["5"].class_type, "KandinskyImageSR2Upscale");
  assert.equal(graph["5"].inputs.upscale_factor, "2");
  assert.deepEqual(graph["5"].inputs.image, ["1", 0]);
  assert.deepEqual(graph["9"].inputs.images, ["5", 0]);
  assert.equal(plan.model, "kandinsky-imagesr-2.0-int8-convrot.safetensors");
});

test("without its files the graph refuses to build", () => {
  assert.throws(() => upscaleGraph({ imageName: "pic.png", quality: "x2", width: 512, height: 512 }, infoWith({ dits: [], vaes: [] })), /Kandinsky/);
});

test("a run embeds Kandinsky after each save, like SeedVR2", () => {
  const run = { "8": { class_type: "VAEDecode", inputs: {} }, "20": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "x" } } };
  const embedded = embedUpscale(run, { quality: "x4", width: 896, height: 1152 }, ready);
  assert.deepEqual(embedded.pairs, [{ base: "20", upscale: "heiss_up0_9" }]);
  assert.deepEqual(embedded.graph.heiss_up0_5.inputs.image, ["8", 0]);
  assert.equal(embedded.graph.heiss_up0_5.inputs.upscale_factor, "4");
  const planned = planRunUpscale(run, { autoUpscale: { quality: "x2" }, width: 896, height: 1152 }, ready);
  assert.equal(planned.label, "×2");
  assert.equal(planned.plan.estimatedWidth, 1792);
  const skipped = planRunUpscale(run, { autoUpscale: { quality: "x2" }, width: 896, height: 1152 }, infoWith({ nodes: false }));
  assert.match(skipped.skipped, /Kandinsky ImageSR nodes/);
});

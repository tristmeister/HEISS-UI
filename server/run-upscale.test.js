import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-run-upscale-"));
process.env.HEISS_SEEDVR2_MODEL_DIR = dir;
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { keepModels, modelFiles, noteSystemRam } = await import("./upscale.js");
const { dropsAutoUpscale, pairRunOutputs, planRunUpscale } = await import("./run-upscale.js");
const { nextProgress } = await import("./progress-phase.js");
const { RunTimer } = await import("./generation-timing.js");

const combo = (values) => ["COMBO", { options: values }];
const info = {
  SeedVR2LoadDiTModel: { input: { required: { model: combo(["seedvr2_ema_7b_fp16.safetensors"]), device: combo(["cuda:0"]) }, optional: { offload_device: combo(["none", "cpu"]) } } },
  SeedVR2LoadVAEModel: { input: { required: { model: combo(["ema_vae_fp16.safetensors"]), device: combo(["cuda:0"]) }, optional: { offload_device: combo(["none", "cpu"]) } } },
  SeedVR2VideoUpscaler: { input: { required: {}, optional: { offload_device: combo(["none", "cpu"]) } } }
};
for (const file of ["seedvr2_ema_7b_fp16.safetensors", "ema_vae_fp16.safetensors"]) {
  const handle = fs.openSync(path.join(dir, file), "w");
  fs.ftruncateSync(handle, modelFiles[file].bytes);
  fs.closeSync(handle);
}

const runGraph = () => ({
  "1": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 768, batch_size: 2 } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 0] } },
  "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "heiss-ui/image" } }
});
const body = { prompt: "a lighthouse", seed: "42", width: 1024, height: 768, model: "flux.safetensors", autoUpscale: { quality: "high", faceDetail: false } };

test("Smart upscale goes into the run's own graph, fed by the picture the run saves", () => {
  const planned = planRunUpscale(runGraph(), body, info);
  assert.equal(planned.skipped, undefined);
  assert.deepEqual(planned.pairs, [{ base: "9", upscale: "heiss_up0_9" }]);
  const { graph } = planned;
  // The run's own save stays, so a stopped upscale still leaves the picture.
  assert.equal(graph["9"].class_type, "SaveImage");
  assert.deepEqual(graph.heiss_up0_2.inputs.image, ["8", 0]);
  assert.deepEqual(graph.heiss_up0_5.inputs.image, ["heiss_up0_2", 0]);
  assert.deepEqual(graph.heiss_up0_9.inputs.images, ["heiss_up0_5", 0]);
  assert.equal(graph.heiss_up0_1, undefined, "no LoadImage: nothing is staged");
  assert.equal(graph.heiss_up0_5._meta.heissPhase, "Upscaling to 4K");
  // The loaders keep fixed ids, so SeedVR2's cache (keyed by them) finds a kept model again.
  assert.deepEqual(graph.heiss_up0_5.inputs.dit, ["heiss_seedvr2_dit", 0]);
  assert.deepEqual(graph.heiss_up0_5.inputs.vae, ["heiss_seedvr2_vae", 0]);
  assert.equal(graph.heiss_up0_3, undefined);
});

test("SeedVR2 stays in system memory only where upscales come often and there is room", () => {
  const GiB = 1024 ** 3;
  const small = modelFiles["seedvr2_ema_3b_fp8_e4m3fn.safetensors"].bytes;
  const large = modelFiles["seedvr2_ema_7b_fp8_e4m3fn.safetensors"].bytes;
  const now = Date.now();
  assert.equal(keepModels({ ditBytes: small, ramBytes: 32 * GiB, embedded: true }), true, "every picture upscales: keep it");
  assert.equal(keepModels({ ditBytes: small, ramBytes: 16 * GiB, embedded: true }), false, "too little memory");
  assert.equal(keepModels({ ditBytes: large, ramBytes: 32 * GiB, embedded: true }), false, "the 7B needs more room");
  assert.equal(keepModels({ ditBytes: large, ramBytes: 64 * GiB, embedded: true }), true);
  assert.equal(keepModels({ ditBytes: small, ramBytes: 64 * GiB, now, lastAt: now - 60_000 }), true, "a second upscale within minutes");
  assert.equal(keepModels({ ditBytes: small, ramBytes: 64 * GiB, now, lastAt: now - 3_600_000 }), false, "an occasional one lets it go");
  assert.equal(keepModels({ ditBytes: small, ramBytes: 64 * GiB, now, lastAt: 0 }), false);

  const loader = (graph) => graph.heiss_seedvr2_dit.inputs.cache_model;
  // This run's "high" upscale is the 16 GB 7B fp16: it takes eight times that.
  noteSystemRam({ system: { ram_total: 160 * GiB } });
  assert.equal(loader(planRunUpscale(runGraph(), body, info).graph), true);
  noteSystemRam({ system: { ram_total: 16 * GiB } });
  assert.equal(loader(planRunUpscale(runGraph(), body, info).graph), false, "a run without it releases a kept model");
});

test("a run whose upscale can't be set up goes ahead and says why", () => {
  const planned = planRunUpscale(runGraph(), body, {});
  assert.match(planned.skipped, /SeedVR2 nodes/);
  const noSave = planRunUpscale({ "1": { class_type: "PreviewImage", inputs: { images: ["8", 0] } } }, body, info);
  assert.match(noSave.skipped, /saves no image/);
});

test("each saved picture carries its own upscale; upscales are not pictures of their own", () => {
  const image = (filename) => ({ images: [{ filename, subfolder: "heiss-ui", type: "output" }] });
  const pairs = [{ base: "9", upscale: "heiss_up0_9" }];
  const done = pairRunOutputs({ "9": { images: [image("a.png").images[0], image("b.png").images[0]] }, heiss_up0_9: { images: [image("a-up.png").images[0], image("b-up.png").images[0]] } }, pairs);
  assert.deepEqual(done.map((result) => [result.output.filename, result.upscale?.filename]), [["a.png", "a-up.png"], ["b.png", "b-up.png"]]);
  // Stopped mid-upscale: the picture is there, its upscale is not.
  const stopped = pairRunOutputs({ "9": image("a.png") }, pairs);
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0].paired, true);
  assert.equal(stopped[0].upscale, null);
});

test("the upscale reads as part of the run, and its time is not the model's", () => {
  const { graph } = planRunUpscale(runGraph(), body, info);
  const progress = nextProgress(graph, { type: "progress", data: { node: "heiss_up0_5", value: 3, max: 10 } });
  assert.equal(progress.phase, "Upscaling to 4K");
  assert.equal(progress.steps, false);
  const timer = new RunTimer(graph, { endNodes: ["9"] });
  timer.note({ type: "execution_start", data: {} }, 1000);
  timer.note({ type: "executed", data: { node: "9", output: {} } }, 5000);
  timer.note({ type: "execution_success", data: {} }, 60_000);
  assert.equal(timer.result().runMs, 4000);
});

test("a 2K/4K pick drops once a reference or a painted mask decides the size", () => {
  // Plain image mode: a 2K/4K pick on a model with no reference goes through.
  assert.equal(dropsAutoUpscale({ inpaint: null, referencesFamily: 0, hasReference: false }), false);
  // A reference-image model (Flux.2, Klein, Qwen-Image 2.1): once a reference
  // is actually staged, the pick that was fine moments ago has to drop.
  assert.equal(dropsAutoUpscale({ inpaint: null, referencesFamily: 1, hasReference: true }), true);
  // Same model, no reference staged yet: nothing to drop it for.
  assert.equal(dropsAutoUpscale({ inpaint: null, referencesFamily: 1, hasReference: false }), false);
  // A painted mask, on any family: the result is the original picture's size.
  assert.equal(dropsAutoUpscale({ inpaint: { box: {} }, referencesFamily: 0, hasReference: false }), true);
  // A plain img2img start image (no references slot): still the model's own pick to make.
  assert.equal(dropsAutoUpscale({ inpaint: null, referencesFamily: 0, hasReference: true }), false);
});

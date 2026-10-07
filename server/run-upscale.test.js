import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-run-upscale-"));
process.env.HEISS_SEEDVR2_MODEL_DIR = dir;
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { modelFiles } = await import("./upscale.js");
const { pairRunOutputs, planRunUpscale } = await import("./run-upscale.js");
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

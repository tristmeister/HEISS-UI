import assert from "node:assert/strict";
import test from "node:test";
import { addRun, estimateRun } from "./generation-timing.js";

const result = (runMs, stepMs, steps = 20) => ({ runMs, stepMs, steps, setupMs: 20_000, tailMs: 30_000 });
const video = (model, extra = {}) => ({ kind: "video", model, family: "wan22_14b", width: 832, height: 480, frames: 81, steps: 20, ...extra });

test("two video runs of a model are enough for an estimate", () => {
  let history = [];
  assert.equal(estimateRun(history, video("wan_high_fp8.safetensors")), null);
  history = addRun(history, { body: video("wan_high_fp8.safetensors"), result: result(360_000, 15_500) });
  assert.equal(estimateRun(history, video("wan_high_fp8.safetensors")), null, "one run says too little");
  history = addRun(history, { body: video("wan_high_fp8.safetensors"), result: result(350_000, 15_000) });
  const estimate = estimateRun(history, video("wan_high_fp8.safetensors"));
  assert.ok(estimate.trusted);
  assert.ok(estimate.totalMs > 300_000 && estimate.totalMs < 400_000);
});

test("another file of the same family stands in until this one has runs of its own", () => {
  let history = [];
  for (const ms of [360_000, 350_000]) history = addRun(history, { body: video("wan_high_fp8.safetensors"), result: result(ms, 15_000) });
  assert.equal(history[0].fam, "wan22_14b");
  assert.ok(estimateRun(history, video("wan_high_fp16.safetensors")), "the fp16 build borrows the fp8's timings");
  assert.equal(estimateRun(history, video("hunyuan.safetensors", { family: "hunyuan15" })), null, "another family does not");
  assert.equal(estimateRun(history, { ...video("wan_high_fp16.safetensors"), kind: "image" }), null, "nor does an image of it");
});

test("images still wait for three runs", () => {
  const image = { kind: "image", model: "sdxl.safetensors", family: "sdxl", width: 1024, height: 1024, steps: 25 };
  let history = [];
  for (const ms of [8000, 8200]) history = addRun(history, { body: image, result: result(ms, 250, 25) });
  assert.equal(estimateRun(history, image), null);
});

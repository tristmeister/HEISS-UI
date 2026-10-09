import assert from "node:assert/strict";
import test from "node:test";
import { addUpscale, estimateUpscale, upscaleLeftMs, upscaleWork } from "./upscale-timing.js";

const sample = (history, work, ms, extra = {}) => addUpscale(history, { quality: "balanced", model: "seedvr2_7b.safetensors", work, ms, ...extra });

test("quiet until two upscales of the weight or effort", () => {
  const one = sample([], 4, 30_000);
  assert.equal(estimateUpscale(one, { quality: "balanced", model: "seedvr2_7b.safetensors", work: 4 }), null);
  const two = sample(one, 4, 34_000);
  assert.equal(estimateUpscale(two, { quality: "balanced", model: "seedvr2_7b.safetensors", work: 4 }).totalMs, 32_000);
  // The composer only knows the effort; the same history speaks for it.
  assert.equal(estimateUpscale(two, { quality: "balanced", work: 4 }).totalMs, 32_000);
  // A face pass is a different job.
  assert.equal(estimateUpscale(two, { quality: "balanced", work: 4, faceDetail: true }), null);
});

test("sizes far enough apart split the fixed loading time from the per-megapixel part", () => {
  let history = [];
  // 10 s of loading, then 5 s per output megapixel.
  for (const work of [2, 4, 8, 4]) history = sample(history, work, 10_000 + 5_000 * work);
  assert.equal(estimateUpscale(history, { quality: "balanced", work: 16 }).totalMs, 90_000);
  // Far outside what it has seen, it says nothing rather than guess.
  assert.equal(estimateUpscale(history, { quality: "balanced", work: 40 }), null);
});

test("predictions that keep missing are not trusted", () => {
  let history = sample(sample([], 4, 30_000), 4, 30_000);
  for (const ms of [60_000, 70_000, 80_000]) history = sample(history, 4, ms, { predicted: { totalMs: 30_000 } });
  assert.equal(estimateUpscale(history, { quality: "balanced", work: 4 }).trusted, false);
});

test("output megapixels across the batch, and a clock that never quite runs out", () => {
  assert.equal(upscaleWork({ width: 2000, height: 1000, count: 2 }), 4);
  const estimate = { totalMs: 20_000, trusted: true };
  assert.equal(upscaleLeftMs(estimate, 1000, 6000), 15_000);
  assert.equal(upscaleLeftMs(estimate, 1000, 60_000), 0);
  assert.equal(upscaleLeftMs({ ...estimate, trusted: false }, 1000, 6000), null);
});

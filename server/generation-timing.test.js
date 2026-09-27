import test from "node:test";
import assert from "node:assert/strict";
import { addRun, estimateRun, isWarm, remainingMs, RunTimer, slowSteps, timingKey, workExponent, workUnits } from "./generation-timing.js";

const graph = { 3: { class_type: "KSampler" }, 4: { class_type: "UNETLoader" }, 8: { class_type: "VAEDecode" } };

/** A run as ComfyUI reports it: start, some setup, `steps` steps of `stepMs`, then a tail. */
function play(timer, { at = 0, setupMs = 3000, steps = 20, stepMs = 500, tailMs = 1200, node = "3" } = {}) {
  let t = at;
  timer.note({ type: "execution_start", data: {} }, t);
  timer.note({ type: "executing", data: { node: "4" } }, t);
  t += setupMs;
  for (let step = 1; step <= steps; step += 1) {
    t += stepMs;
    timer.note({ type: "progress", data: { node, value: step, max: steps } }, t);
  }
  timer.note({ type: "executing", data: { node: "8" } }, t);
  t += tailMs;
  timer.note({ type: "execution_success", data: {} }, t);
  return t;
}

const body = (extra = {}) => ({ kind: "image", model: "flux-dev.safetensors", width: 1024, height: 1024, count: 1, steps: 20, ...extra });
const resultFor = (options) => { const timer = new RunTimer(graph); play(timer, options); return timer.result(); };

test("a run splits into setup, steps and tail", () => {
  const result = resultFor({ setupMs: 3000, steps: 20, stepMs: 500, tailMs: 1200 });
  assert.equal(result.runMs, 3000 + 20 * 500 + 1200);
  assert.equal(result.stepMs, 500);
  assert.equal(result.steps, 20);
  assert.equal(result.setupMs, 3000);
  assert.equal(result.tailMs, 1200);
});

test("a second pass counts its steps too, and other nodes' progress is not sampling", () => {
  const timer = new RunTimer({ ...graph, 5: { class_type: "KSamplerAdvanced" }, 9: { class_type: "UpscaleModelLoader" } });
  let t = play(timer, { steps: 10, stepMs: 400, tailMs: 0 });
  timer.endAt = null;
  for (let tile = 1; tile <= 50; tile += 1) timer.note({ type: "progress", data: { node: "9", value: tile, max: 50 } }, (t += 10));
  for (let step = 1; step <= 10; step += 1) timer.note({ type: "progress", data: { node: "5", value: step, max: 10 } }, (t += 400));
  timer.note({ type: "execution_success", data: {} }, (t += 800));
  const result = timer.result();
  assert.equal(result.steps, 20);
  assert.equal(result.stepMs, 400);
});

test("a run that never started has no timing", () => {
  assert.equal(new RunTimer(graph).result(), null);
});

test("work is megapixels × batch × frames", () => {
  assert.equal(workUnits({ width: 1000, height: 1000 }), 1);
  assert.equal(workUnits({ width: 1000, height: 1000, count: 4 }), 4);
  assert.equal(workUnits({ kind: "video", width: 1000, height: 500, frames: 81 }), 40.5);
  assert.equal(workUnits({ width: 0, height: 512 }), 0);
  assert.equal(timingKey(body()), "image:flux-dev.safetensors");
  assert.equal(timingKey({ kind: "video", profileId: "wan" }), "video:wan");
});

function historyOf(runs, { start = Date.parse("2026-09-27T10:00:00Z"), gapMs = 60_000 } = {}) {
  let history = [];
  runs.forEach((run, index) => {
    const result = resultFor(run.timing);
    history = addRun(history, { body: body(run.body), result, warm: index > 0, at: new Date(start + index * gapMs).toISOString() });
  });
  return history;
}

test("no estimate until a model has run three times", () => {
  const two = historyOf([{ timing: {} }, { timing: {} }]);
  assert.equal(estimateRun(two, body()), null);
  const three = historyOf([{ timing: {} }, { timing: {} }, { timing: {} }]);
  const estimate = estimateRun(three, body(), { now: Date.parse("2026-09-27T10:03:00Z") });
  assert.equal(estimate.steps, 20);
  assert.equal(estimate.stepMs, 500);
  assert.equal(estimate.totalMs, 3000 + 10_000 + 1200);
  assert.equal(estimate.trusted, true);
  assert.equal(estimate.warm, true);
});

test("an estimate scales with size and steps", () => {
  const history = historyOf([{ timing: {} }, { timing: {} }, { timing: {} }]);
  const now = Date.parse("2026-09-27T10:03:00Z");
  const double = estimateRun(history, body({ width: 1448, height: 1448 }), { now });
  assert.ok(double.stepMs > 1000 && double.stepMs < 1150, `about 2^1.15 × 500, got ${double.stepMs}`);
  assert.ok(Math.abs(double.tailMs - 2400) < 50, "the tail scales with pixels");
  assert.equal(estimateRun(history, body({ steps: 40 }), { now }).steps, 40);
  assert.equal(estimateRun(history, body({ width: 4096, height: 4096 }), { now }), null, "far past anything seen");
  assert.equal(estimateRun(history, body({ model: "other.safetensors" }), { now }), null);
});

test("the growth with size is learned from the sizes used", () => {
  const runs = [0.5, 1, 2, 4].map((w) => ({ w, stepMs: 400 * w ** 1.4 }));
  assert.ok(Math.abs(workExponent(runs) - 1.4) < 0.01);
  assert.equal(workExponent(runs.slice(0, 2)), 1.15, "too few runs");
  assert.equal(workExponent([{ w: 1, stepMs: 400 }, { w: 1.1, stepMs: 460 }, { w: 1.2, stepMs: 500 }]), 1.15, "too little spread");
});

test("a cold start is estimated from cold starts", () => {
  let history = [];
  const start = Date.parse("2026-09-27T10:00:00Z");
  [true, false, true, false, true].forEach((warm, index) => {
    history = addRun(history, { body: body(), result: resultFor({ setupMs: warm ? 1000 : 20_000 }), warm, at: new Date(start + index * 60_000).toISOString() });
  });
  assert.equal(isWarm(history, "image:flux-dev.safetensors", start + 5 * 60_000), true);
  assert.equal(estimateRun(history, body(), { now: start + 5 * 60_000 }).setupMs, 1000);
  assert.equal(isWarm(history, "image:flux-dev.safetensors", start + 90 * 60_000), false, "a while later it is likely unloaded");
  assert.equal(estimateRun(history, body(), { now: start + 90 * 60_000 }).setupMs, 20_000);
});

test("estimates that keep missing stop being trusted", () => {
  let history = historyOf([{ timing: {} }, { timing: {} }, { timing: {} }]);
  const predicted = { totalMs: 5000 };
  for (let index = 0; index < 3; index += 1) history = addRun(history, { body: body(), result: resultFor({}), predicted, warm: true });
  assert.equal(history.at(-1).error, 0.65);
  assert.equal(estimateRun(history, body()).trusted, false);
});

test("the history keeps each model's latest runs", () => {
  let history = [];
  for (let index = 0; index < 45; index += 1) history = addRun(history, { body: body(), result: { runMs: 1000 + index }, at: String(index) });
  history = addRun(history, { body: body({ model: "b" }), result: { runMs: 5 }, at: "x" });
  assert.equal(history.length, 41);
  assert.equal(history[0].runMs, 1005);
  assert.equal(addRun(history, { body: body(), result: null }), history);
});

test("time left follows live steps, and the learned tail after them", () => {
  const history = historyOf([{ timing: {} }, { timing: {} }, { timing: {} }]);
  const estimate = estimateRun(history, body(), { now: Date.parse("2026-09-27T10:03:00Z") });
  const timer = new RunTimer(graph);
  assert.equal(remainingMs(timer, estimate, 0), estimate.totalMs, "queued: the whole estimate");
  timer.note({ type: "execution_start", data: {} }, 0);
  assert.equal(remainingMs(timer, estimate, 1000), estimate.totalMs - 1000);
  assert.equal(remainingMs(timer, estimate, 20_000), 20 * 500 + 1200, "a slow load still leaves the sampling");
  // Running at half the learned speed: live steps win.
  let t = 3000;
  for (let step = 1; step <= 10; step += 1) timer.note({ type: "progress", data: { node: "3", value: step, max: 20 } }, (t += 1000));
  assert.equal(remainingMs(timer, estimate, t), 10 * 1000 + 1200);
  for (let step = 11; step <= 20; step += 1) timer.note({ type: "progress", data: { node: "3", value: step, max: 20 } }, (t += 1000));
  assert.equal(remainingMs(timer, estimate, t + 200), 1000);
  assert.equal(remainingMs(timer, estimate, t + 5000), 0);
});

test("without history, only live steps give a time left", () => {
  const timer = new RunTimer(graph);
  timer.note({ type: "execution_start", data: {} }, 0);
  assert.equal(remainingMs(timer, null, 1000), null);
  timer.note({ type: "progress", data: { node: "3", value: 1, max: 20 } }, 2000);
  assert.equal(remainingMs(timer, null, 2000), null, "one step says nothing about speed");
  timer.note({ type: "progress", data: { node: "3", value: 2, max: 20 } }, 2500);
  assert.equal(remainingMs(timer, null, 2500), 18 * 500);
  assert.equal(remainingMs(timer, { ...estimateRun([], body()), trusted: false }, 2500), 18 * 500);
});

test("slow steps are flagged only against a trusted estimate", () => {
  assert.equal(slowSteps({ stepMs: 1500 }, { stepMs: 500, trusted: true }), true);
  assert.equal(slowSteps({ stepMs: 900 }, { stepMs: 500, trusted: true }), false);
  assert.equal(slowSteps({ stepMs: 1500 }, { stepMs: 500, trusted: false }), false);
  assert.equal(slowSteps({ stepMs: 1500 }, null), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { isSampler, nextProgress, phaseOf } from "./progress-phase.js";

const graph = {
  "1": { class_type: "LoadImage" },
  "2": { class_type: "UpscaleModelLoader" },
  "3": { class_type: "ImageUpscaleWithModel" },
  "4": { class_type: "VAEEncode" },
  "5": { class_type: "KSampler" },
  "6": { class_type: "VAEDecode" },
  "7": { class_type: "KSamplerSelect" },
  "8": { class_type: "SamplerCustomAdvanced" }
};

test("only samplers count steps", () => {
  assert.equal(isSampler("KSampler"), true);
  assert.equal(isSampler("SamplerCustomAdvanced"), true);
  assert.equal(isSampler("WanVideoSampler"), true);
  assert.equal(isSampler("KSamplerSelect"), false);
  assert.equal(isSampler("BasicScheduler"), false);
});

test("a tiled VAE encode reports its tiles as a phase, not steps", () => {
  const progress = nextProgress(graph, { type: "progress", data: { node: "4", value: 241, max: 357 } });
  assert.deepEqual(progress, { value: 241, max: 357, node: "4", phase: "Encoding image", steps: false });
});

test("sampler progress is steps", () => {
  const progress = nextProgress(graph, { type: "progress", data: { node: "5", value: 1, max: 2 } });
  assert.equal(progress.steps, true);
  assert.equal(progress.max, 2);
});

test("a sampler that has started but not stepped says it is loading the model", () => {
  const before = nextProgress(graph, { type: "progress", data: { node: "4", value: 357, max: 357 } });
  const progress = nextProgress(graph, { type: "executing", data: { node: "5" } }, before);
  assert.deepEqual(progress, { value: 0, max: 0, node: "5", phase: "Loading model", steps: false });
});

test("re-entering a sampler that already counts keeps its count", () => {
  const counting = { value: 1, max: 2, node: "5", phase: "Step", steps: true };
  assert.equal(nextProgress(graph, { type: "executing", data: { node: "5" } }, counting), null);
});

test("each node gets a plain phase name", () => {
  assert.equal(phaseOf("LoadImage"), "Reading image");
  assert.equal(phaseOf("UpscaleModelLoader"), "Loading model");
  assert.equal(phaseOf("ImageUpscaleWithModel"), "Upscaling");
  assert.equal(phaseOf("CLIPTextEncode"), "Reading prompt");
  assert.equal(phaseOf("VAEDecodeTiled"), "Decoding");
  assert.equal(phaseOf("ImageScaleBy"), "Resizing");
  assert.equal(phaseOf("SaveImage"), "Saving");
  assert.equal(phaseOf("SomethingElse"), "Working");
});

test("unknown nodes keep the old step reading, and expanded ids find their parent", () => {
  assert.equal(nextProgress(graph, { type: "progress", data: { node: "99", value: 3, max: 20 } }).steps, true);
  assert.equal(nextProgress(graph, { type: "progress", data: { node: "4:12", value: 3, max: 20 } }).phase, "Encoding image");
});

test("the end of a run and unrelated messages change nothing", () => {
  assert.equal(nextProgress(graph, { type: "executing", data: { node: null } }), null);
  assert.equal(nextProgress(graph, { type: "status", data: {} }), null);
  assert.equal(nextProgress(graph, { type: "execution_start", data: {} }).phase, "Starting");
});

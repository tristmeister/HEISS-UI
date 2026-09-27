import test from "node:test";
import assert from "node:assert/strict";
import { describeFailure } from "./failures.js";

test("a damaged safetensors file gets a plain title and hint, with the raw text kept", () => {
  const failure = describeFailure({ message: "Error while deserializing header: header is too large. File path: D:\\ComfyUI\\models\\vae\\x.safetensors", nodeType: "VAELoader", nodeId: "8" });
  assert.equal(failure.title, "The VAE file is damaged");
  assert.equal(failure.file, "x.safetensors");
  assert.match(failure.summary, /^x\.safetensors could not be read/);
  assert.match(failure.hint, /download it again/);
  assert.equal(failure.nodeType, "VAELoader");
  assert.match(failure.detail, /x\.safetensors/);
});

test("the traceback keeps its last lines and unknown errors stay generic", () => {
  const failure = describeFailure({ message: "RuntimeError: something odd\nmore", traceback: Array.from({ length: 60 }, (_, i) => `line ${i}\n`) });
  assert.equal(failure.title, "Generation failed");
  assert.equal(failure.summary, "something odd");
  assert.equal(failure.traceback.split("\n").length, 40);
  assert.match(failure.traceback, /line 59$/);
});

test("a run with no saved image becomes a visible failure", () => {
  const failure = describeFailure({ message: "ComfyUI finished the run but saved no image.", noOutput: true });
  assert.equal(failure.title, "No image was saved");
  assert.match(failure.hint, /Save Image/);
});

test("a damaged file from a node that is not a loader keeps the general title", () => {
  const failure = describeFailure({ message: "safetensors_rust.SafetensorError: Error while deserializing header: header is too large", nodeType: "KSampler" });
  assert.equal(failure.title, "A model file is damaged or incomplete");
  assert.match(failure.summary, /^A model file could not be read/);
});

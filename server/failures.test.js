import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { describeFailure, failureTitles, troubleshootingAnchor } from "./failures.js";

test("every failure headline has its own section in TROUBLESHOOTING.md, which the card links to", () => {
  const doc = fs.readFileSync(new URL("../TROUBLESHOOTING.md", import.meta.url), "utf8");
  const headings = doc.split("\n").filter((line) => line.startsWith("#")).map((line) => line.replace(/^#+\s*/, ""));
  for (const title of failureTitles) assert.ok(headings.includes(title), `TROUBLESHOOTING.md has no "### ${title}"`);
  assert.equal(describeFailure({ message: "CUDA error: out of memory" }).help, "the-gpu-ran-out-of-memory");
  assert.equal(describeFailure({ message: "Error while deserializing header: header is too large", nodeType: "VAELoader" }).help, "a-model-file-is-damaged-or-incomplete");
  assert.equal(describeFailure({ message: "saved nothing", noOutput: true }).help, "no-image-was-saved");
  assert.equal(describeFailure({ message: "RuntimeError: odd" }).help, "generation-failed");
  // Links inside the document point at headings that exist.
  const anchors = new Set(headings.map(troubleshootingAnchor));
  for (const [, anchor] of doc.matchAll(/\]\(#([^)]+)\)/g)) assert.ok(anchors.has(anchor), `#${anchor} has no heading`);
});

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

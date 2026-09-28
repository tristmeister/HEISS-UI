import test from "node:test";
import assert from "node:assert/strict";
import { canDecodeTiled, packForNode, withFixes } from "./failure-fixes.js";
import { describeFailure } from "./failures.js";

test("a missing node from a known pack gets that pack's install", () => {
  const failure = withFixes(describeFailure({ message: "Node 'FaceDetailer' not found. The custom node may not be installed. missing_node_type" }));
  assert.equal(failure.nodePack?.id, "impactpack");
  assert.ok(failure.install?.commands?.length);
  assert.equal(typeof failure.autoInstall?.manager, "boolean");
});

test("a node no known pack brings keeps the hint only", () => {
  const failure = withFixes(describeFailure({ message: "Node 'SomethingExotic' not found. missing_node_type" }));
  assert.equal(failure.nodePack, undefined);
  assert.equal(packForNode("SomethingExotic"), null);
});

test("out of memory while decoding offers a tiled retry only where the graph can do it", () => {
  const oom = describeFailure({ message: "torch.OutOfMemoryError: Allocation on device", nodeType: "VAEDecode" });
  const family = withFixes(oom, { workflow: "family:wan21", family: "wan21" });
  assert.deepEqual(family.retry, { smaller: true, tiledDecode: true });
  const imported = withFixes(oom, { workflow: "custom:abc", family: "" });
  assert.deepEqual(imported.retry, { smaller: true });
  assert.equal(canDecodeTiled({ workflow: "family:sana", family: "sana" }), false);
});

test("a damaged catalog file can be downloaded again; any other file cannot", () => {
  const catalog = withFixes(describeFailure({ message: "Error while deserializing header: invalid header in ae.safetensors", nodeType: "VAELoader" }));
  assert.equal(catalog.redownload?.file, "ae.safetensors");
  assert.equal(catalog.redownload?.folder, "vae");
  const unknown = withFixes(describeFailure({ message: "Error while deserializing header: invalid header in myvae.safetensors", nodeType: "VAELoader" }));
  assert.equal(unknown.redownload, undefined);
});

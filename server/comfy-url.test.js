import test from "node:test";
import assert from "node:assert/strict";
import { normalizeComfyUrl } from "./comfy.js";

test("ComfyUI addresses are normalised from what people type", () => {
  assert.equal(normalizeComfyUrl("8000"), "http://127.0.0.1:8000");
  assert.equal(normalizeComfyUrl("localhost:8188/"), "http://localhost:8188");
  assert.equal(normalizeComfyUrl("http://pc.local:8188"), "http://pc.local:8188");
  assert.equal(normalizeComfyUrl("https://example.test/comfy/"), "https://example.test/comfy");
  assert.equal(normalizeComfyUrl(""), "");
  assert.equal(normalizeComfyUrl("not a url"), "");
});

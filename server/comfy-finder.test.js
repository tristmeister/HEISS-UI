import assert from "node:assert/strict";
import test from "node:test";
import { findComfy, findComfyNow, looksLikeComfy, nearbyAddresses } from "./comfy-finder.js";

test("the other usual port is tried when the address on this computer is quiet", () => {
  assert.deepEqual(nearbyAddresses("http://127.0.0.1:8188"), ["http://127.0.0.1:8000"]);
  assert.deepEqual(nearbyAddresses("http://localhost:8000"), ["http://127.0.0.1:8188"]);
  assert.deepEqual(nearbyAddresses("http://127.0.0.1:9000"), ["http://127.0.0.1:8188", "http://127.0.0.1:8000"]);
});

test("another computer's address is never swapped for this one's", () => {
  assert.deepEqual(nearbyAddresses("http://192.168.1.20:8188"), []);
});

test("the first address that answers as ComfyUI wins", async () => {
  const asked = [];
  const found = await findComfy({ current: "http://127.0.0.1:9000", probe: async (url) => { asked.push(url); return url.endsWith(":8000"); } });
  assert.equal(found, "http://127.0.0.1:8000");
  assert.deepEqual(asked, ["http://127.0.0.1:8188", "http://127.0.0.1:8000"]);
  assert.equal(await findComfy({ current: "http://127.0.0.1:8188", probe: async () => false }), "");
});

test("only a ComfyUI answer counts, not any server on that port", () => {
  assert.equal(looksLikeComfy({ system: { comfyui_version: "0.9" }, devices: [] }), true);
  assert.equal(looksLikeComfy({ status: "ok" }), false);
  assert.equal(looksLikeComfy(null), false);
});

test("the status poll searches at most every few seconds", async () => {
  let probes = 0;
  const probe = async () => { probes += 1; return false; };
  await findComfyNow("http://127.0.0.1:8188", { now: 1_000_000, probe });
  await findComfyNow("http://127.0.0.1:8188", { now: 1_002_000, probe });
  assert.equal(probes, 1);
  await findComfyNow("http://127.0.0.1:8188", { now: 1_010_000, probe });
  assert.equal(probes, 2);
});

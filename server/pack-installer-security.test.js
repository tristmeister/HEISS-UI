import assert from "node:assert/strict";
import test from "node:test";

// A ComfyUI whose Manager 4 refuses installs on security grounds.
process.env.COMFY_URL = "http://127.0.0.1:9";
globalThis.fetch = async (url, options = {}) => {
  const { pathname } = new URL(url);
  if (pathname === "/v2/manager/version") return new Response("V4.0", { headers: { "content-type": "text/plain" } });
  if (pathname === "/v2/manager/queue/task" && options.method === "POST") return new Response("security_level is too strict", { status: 403 });
  return new Response("", { status: 404 });
};

const { constraintsFrom, packInstallState, startPackInstall } = await import("./pack-installer.js");
const { nodePacks } = await import("./node-packs.js");

test("a Manager security refusal stops and asks instead of installing some other way", async () => {
  await startPackInstall("seedvr2");
  let state = packInstallState("seedvr2");
  for (let i = 0; i < 50 && state.status === "running"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    state = packInstallState("seedvr2");
  }
  assert.equal(state.status, "blocked");
  assert.match(state.error, /security/i);
  // No ComfyUI on this machine in the test, so there is no other way to offer.
  assert.equal(state.canOverride, false);
  await assert.rejects(() => startPackInstall("seedvr2", { overrideManager: true }), /isn't on this computer/);
});

test("pip holds PyTorch and NumPy at what ComfyUI has, whatever a pack asks for", () => {
  const freeze = ["aiohttp==3.9.5", "numpy==1.26.4", "torch==2.5.1+cu124", "torchvision==0.20.1+cu124", "torchaudio==2.5.1+cu124", "torchsde==0.2.6", "Pillow==10.4.0", "xformers==0.0.28"].join("\n");
  assert.equal(constraintsFrom(freeze), "numpy==1.26.4\ntorch==2.5.1+cu124\ntorchvision==0.20.1+cu124\ntorchaudio==2.5.1+cu124");
  assert.equal(constraintsFrom(""), "");
});

test("every pack is pinned to a reviewed commit", () => {
  for (const [id, pack] of Object.entries(nodePacks)) {
    assert.match(pack.commit || "", /^[0-9a-f]{40}$/, id);
    assert.ok(pack.ref, id);
  }
});

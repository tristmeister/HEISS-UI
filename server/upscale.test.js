import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-seedvr2-"));
process.env.HEISS_SEEDVR2_MODEL_DIR = dir;
const { installState, modelFiles, startModelInstall, upscaleGraph, upscaleStatus } = await import("./upscale.js");

const combo = (values) => [values];
const infoWith = ({ dit = [], vae = [], devices = ["cuda:0"], offloads = ["none", "cpu", "cuda:0"] } = {}) => ({
  SeedVR2LoadDiTModel: { input: { required: { model: combo(dit), device: combo(devices), offload_device: combo(offloads) } } },
  SeedVR2LoadVAEModel: { input: { required: { model: combo(vae), device: combo(devices), offload_device: combo(offloads) } } },
  SeedVR2VideoUpscaler: { input: { required: { offload_device: combo(offloads) } } }
});
// SeedVR2 2.5+ lists every registry model whether or not it is downloaded.
const registryListing = { dit: ["seedvr2_ema_3b_fp8_e4m3fn.safetensors", "seedvr2_ema_7b_fp16.safetensors"], vae: ["ema_vae_fp16.safetensors"] };

/** A sparse file of the exact published size stands in for a real download. */
function placeModel(file) {
  const handle = fs.openSync(path.join(dir, file), "w");
  fs.ftruncateSync(handle, modelFiles[file].bytes);
  fs.closeSync(handle);
}

function clearDir() {
  for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { force: true });
}

test("registry names in the dropdown do not count as installed", () => {
  clearDir();
  const status = upscaleStatus(infoWith(registryListing), "fast");
  assert.equal(status.nodesInstalled, true);
  assert.equal(status.ready, false);
  assert.equal(status.needsDownload, true);
  assert.deepEqual(status.missingModels, ["dit", "vae"]);
  assert.equal(status.downloadBytes, modelFiles["seedvr2_ema_3b_fp8_e4m3fn.safetensors"].bytes + modelFiles["ema_vae_fp16.safetensors"].bytes);
});

test("complete files on disk make a tier ready; a short copy does not", () => {
  clearDir();
  placeModel("seedvr2_ema_3b_fp8_e4m3fn.safetensors");
  fs.writeFileSync(path.join(dir, "ema_vae_fp16.safetensors"), "truncated");
  assert.equal(upscaleStatus(infoWith(registryListing), "fast").ready, false);
  placeModel("ema_vae_fp16.safetensors");
  assert.equal(upscaleStatus(infoWith(registryListing), "fast").ready, true);
  // Another tier runs on the weight that is here rather than demanding a download.
  const high = upscaleStatus(infoWith(registryListing), "high");
  assert.equal(high.ready, true);
  assert.equal(high.substituting, true);
});

test("a file the node discovered elsewhere counts, and a partial download is reported", () => {
  clearDir();
  fs.writeFileSync(path.join(dir, "seedvr2_ema_7b_fp16.safetensors.part"), Buffer.alloc(1024));
  const status = upscaleStatus(infoWith({ dit: [...registryListing.dit, "my_seedvr2_finetune.safetensors"], vae: registryListing.vae }), "high");
  assert.equal(status.models.find((model) => model.key === "dit").partialBytes, 1024);
  assert.equal(status.substituting, false);
  assert.equal(status.ready, false, "the VAE is still missing");
});

test("the graph uses the machine's own device and skips block swap without an offload device", () => {
  clearDir();
  placeModel("seedvr2_ema_3b_fp8_e4m3fn.safetensors");
  placeModel("ema_vae_fp16.safetensors");
  const mac = upscaleGraph({ width: 1024, height: 1024, quality: "fast" }, infoWith({ ...registryListing, devices: ["mps"], offloads: ["none"] })).graph;
  assert.equal(mac["3"].inputs.device, "mps");
  assert.equal(mac["3"].inputs.offload_device, "none");
  assert.equal(mac["3"].inputs.blocks_to_swap, 0);
  assert.equal(mac["3"].inputs.swap_io_components, false);
  const cuda = upscaleGraph({ width: 1024, height: 1024, quality: "fast" }, infoWith(registryListing)).graph;
  assert.equal(cuda["3"].inputs.device, "cuda:0");
  assert.equal(cuda["3"].inputs.offload_device, "cpu");
  assert.equal(cuda["3"].inputs.blocks_to_swap, 16);
});

async function waitForInstall() {
  for (let i = 0; i < 200; i += 1) {
    const state = installState();
    if (state && state.status !== "running") return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("install never finished");
}

test("a download resumes from its .part file and is verified by checksum", async (t) => {
  clearDir();
  placeModel("seedvr2_ema_3b_fp8_e4m3fn.safetensors");
  const payload = crypto.randomBytes(64 * 1024);
  const original = { ...modelFiles["ema_vae_fp16.safetensors"] };
  Object.assign(modelFiles["ema_vae_fp16.safetensors"], { bytes: payload.length, sha256: crypto.createHash("sha256").update(payload).digest("hex") });
  fs.writeFileSync(path.join(dir, "ema_vae_fp16.safetensors.part"), payload.subarray(0, 20_000));
  const ranges = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    const range = init.headers?.range || "";
    ranges.push(range);
    const from = Number(range.match(/bytes=(\d+)-/)?.[1] || 0);
    return new Response(payload.subarray(from), { status: from ? 206 : 200 });
  };
  t.after(() => {
    globalThis.fetch = realFetch;
    Object.assign(modelFiles["ema_vae_fp16.safetensors"], original);
  });

  startModelInstall("fast", infoWith(registryListing));
  const done = await waitForInstall();
  assert.equal(done.status, "done");
  assert.deepEqual(ranges, ["bytes=20000-"]);
  assert.deepEqual(fs.readFileSync(path.join(dir, "ema_vae_fp16.safetensors")), payload);
  assert.equal(fs.existsSync(path.join(dir, "ema_vae_fp16.safetensors.part")), false);
  const cache = JSON.parse(fs.readFileSync(path.join(dir, ".validation_cache.json"), "utf8"));
  assert.equal(cache["ema_vae_fp16.safetensors"].size, payload.length);
});

test("a download that fails its checksum is thrown away, not installed", async (t) => {
  clearDir();
  placeModel("seedvr2_ema_3b_fp8_e4m3fn.safetensors");
  const original = { ...modelFiles["ema_vae_fp16.safetensors"] };
  Object.assign(modelFiles["ema_vae_fp16.safetensors"], { bytes: 4, sha256: "0".repeat(64) });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from("evil"), { status: 200 });
  t.after(() => {
    globalThis.fetch = realFetch;
    Object.assign(modelFiles["ema_vae_fp16.safetensors"], original);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  startModelInstall("fast", infoWith(registryListing));
  const done = await waitForInstall();
  assert.equal(done.status, "error");
  assert.match(done.error, /checksum/);
  assert.equal(fs.existsSync(path.join(dir, "ema_vae_fp16.safetensors")), false);
});

test("the terminal install uses ComfyUI's own folder and Python when it can see them", async () => {
  const { nodeInstallPlan } = await import("./upscale.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-comfy-"));
  fs.mkdirSync(path.join(root, "custom_nodes"));
  fs.mkdirSync(path.join(root, ".venv", "bin"), { recursive: true });
  fs.writeFileSync(path.join(root, ".venv", "bin", "python"), "");
  const fresh = nodeInstallPlan(root, "darwin");
  assert.equal(fresh.exact, true);
  assert.match(fresh.command, /^cd ".*custom_nodes" && git clone https:\/\/github\.com\/numz\/ComfyUI-SeedVR2_VideoUpscaler\.git && ".*\.venv\/bin\/python" -m pip install -r ComfyUI-SeedVR2_VideoUpscaler\/requirements\.txt$/);
  // Cloned but not loading: only the requirements are missing.
  fs.mkdirSync(path.join(root, "custom_nodes", "ComfyUI-SeedVR2_VideoUpscaler"));
  const cloned = nodeInstallPlan(root, "darwin");
  assert.equal(cloned.cloned, true);
  assert.doesNotMatch(cloned.command, /git clone/);
  // Nothing known: a generic command that still works from the ComfyUI folder.
  assert.equal(nodeInstallPlan("", "darwin").command.startsWith("cd ComfyUI/custom_nodes && git clone"), true);
  fs.rmSync(root, { recursive: true, force: true });
});

import assert from "node:assert/strict";
import test from "node:test";
import { families, starterModels } from "./family-catalog.js";
import { catalogDownload } from "./family-profiles.js";
import { hardwareFromStats } from "./hardware.js";
import { starterPlan } from "./starter-models.js";

const GiB = 1024 ** 3;
const nothingOnDisk = () => "";
const card = (vram, ram = 32) => hardwareFromStats({ system: { ram_total: ram * GiB }, devices: [{ name: "cuda:0 NVIDIA GeForce RTX : cudaMallocAsync", type: "cuda", vram_total: vram * GiB }] });
const mac = (ram) => hardwareFromStats({ system: { ram_total: ram * GiB }, devices: [{ name: "mps", type: "mps", vram_total: ram * GiB }] });
const info = ({ clips = [], vaes = [], unets = [], checkpoints = [] } = {}) => ({
  CLIPLoader: { input: { required: { clip_name: [clips] } } },
  VAELoader: { input: { required: { vae_name: [vaes] } } },
  UNETLoader: { input: { required: { unet_name: [unets] } } },
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [checkpoints] } } }
});
const plan = (hardware, extra) => starterPlan({ hardware, info: info(extra), onDisk: nothingOnDisk });
const byFamily = (result, family) => result.find((item) => item.family === family);
const version = (result, family, id) => byFamily(result, family).versions.find((item) => item.id === id);

test("three families, three versions each, small to large, every file an ungated Hugging Face download", () => {
  assert.deepEqual(starterModels.map((item) => item.family), ["krea2", "flux2_klein_4b", "sdxl"]);
  for (const item of starterModels) {
    assert.equal(item.versions.length, 3, item.family);
    const sizes = item.versions.map((entry) => entry.memory);
    assert.deepEqual([...sizes].sort((a, b) => a - b), sizes, `${item.family} goes small to large`);
    for (const entry of item.versions) {
      const spec = catalogDownload(entry.model);
      assert.ok(spec, `${item.family}/${entry.id} names a catalog file`);
      assert.match(spec.url, /^https:\/\/huggingface\.co\//);
      assert.ok(spec.bytes > 1e9);
      assert.ok(families[entry.family || item.family], `${entry.id} belongs to a family HEISS runs`);
    }
  }
});

test("a split model brings its encoder and VAE, model last; a checkpoint brings only itself", () => {
  const result = plan(card(24));
  const krea = version(result, "krea2", "turbo-fp8");
  assert.deepEqual(krea.downloads.map((item) => item.part), ["encoder", "vae", "model"]);
  assert.deepEqual(krea.downloads.map((item) => item.id), ["encoder:qwen3vl_4b:0", "vae:qwen_image:0", "model:krea2_turbo_fp8:0"]);
  assert.equal(krea.totalBytes, 4_831_492_476 + 253_806_246 + 13_141_730_784);
  const realvis = version(result, "sdxl", "realvis");
  assert.deepEqual(realvis.downloads.map((item) => item.id), ["checkpoint:realvisxl5:0"]);
  assert.equal(realvis.downloads[0].folder, "checkpoints");
  const dev = version(result, "flux2_klein_4b", "dev");
  assert.equal(dev.family, "flux2_dev");
  assert.equal(dev.downloads[0].id, "encoder:mistral3_24b:1", "Dev takes the fp8 text encoder, not the 35 GB one");
  assert.equal(dev.downloads[0].file, "mistral_3_small_flux2_fp8.safetensors");
});

test("parts ComfyUI already has are left out, and a model it lists counts as installed", () => {
  const result = plan(card(24), { clips: ["qwen3-vl-4b-heretic_fp8_e4m3fn.safetensors"], vaes: ["qwen_image_vae.safetensors"], unets: ["krea2_turbo_bf16.safetensors"] });
  assert.deepEqual(version(result, "krea2", "turbo").downloads.map((item) => item.part), ["model"]);
  assert.equal(version(result, "krea2", "turbo").installed, true);
  assert.equal(version(result, "krea2", "raw").installed, false);
});

test("files already on disk count as fetched", () => {
  const result = starterPlan({ hardware: card(12), info: info(), onDisk: (spec) => spec.folder === "vae" ? "/models/vae/x" : "" });
  const klein = version(result, "flux2_klein_4b", "klein");
  assert.equal(klein.downloads.find((item) => item.part === "vae").onDisk, true);
  assert.equal(klein.remainingBytes, klein.totalBytes - 336_213_556);
});

test("a 12 GB card: Flux.2 Klein 4B at full precision is best, Krea 2 fits no version, nothing is hidden", () => {
  const result = plan(card(12));
  assert.equal(byFamily(result, "flux2_klein_4b").best, "klein");
  assert.equal(byFamily(result, "krea2").best, null);
  assert.equal(byFamily(result, "krea2").versions.length, 3);
  assert.equal(byFamily(result, "sdxl").best, "realvis");
});

test("a 32 GB card with 64 GB of RAM: the full versions", () => {
  const result = plan(card(32, 64));
  assert.equal(byFamily(result, "krea2").best, "turbo");
  assert.equal(byFamily(result, "flux2_klein_4b").best, "dev");
  assert.equal(plan(card(32, 32)).find((item) => item.family === "flux2_klein_4b").best, "klein", "Dev wants 64 GB of RAM besides");
});

test("a Mac counts fp8 at full size, and prefers the full-precision file on a tie", () => {
  const small = plan(mac(24));
  assert.equal(version(small, "krea2", "turbo-fp8").memoryGB, 32);
  assert.equal(byFamily(small, "krea2").best, null);
  assert.equal(byFamily(small, "flux2_klein_4b").best, "klein");
  const large = plan(mac(64));
  assert.equal(byFamily(large, "krea2").best, "turbo");
  assert.equal(byFamily(large, "flux2_klein_4b").best, "klein", "Dev needs far more on a Mac");
});

test("unknown hardware: sizes, and no verdicts", () => {
  const result = starterPlan({ hardware: hardwareFromStats({}), info: null, onDisk: nothingOnDisk });
  for (const item of result) {
    assert.equal(item.best, null);
    assert.ok(item.versions.every((entry) => entry.fits === null && entry.totalBytes > 0));
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { appleBudget, cleanDeviceName, fitsHardware, gpuKind, hardwareFromStats, isThisComputer, localHardware } from "./hardware.js";

const GiB = 1024 ** 3;
const stats = (device, ram = 64 * GiB) => ({ system: { os: "linux", ram_total: ram, ram_free: ram / 2 }, devices: device ? [device] : [] });

test("an NVIDIA card: its name without ComfyUI's decorations, and its memory as the budget", () => {
  const hardware = hardwareFromStats(stats({ name: "cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync", type: "cuda", vram_total: 25_757_220_864, vram_free: 24 * GiB }));
  assert.equal(hardware.kind, "nvidia");
  assert.equal(hardware.name, "NVIDIA GeForce RTX 4090");
  assert.equal(hardware.budgetGB, 24);
  assert.equal(hardware.budgetSource, "vram");
  assert.equal(hardware.vramGB, 24);
  assert.equal(hardware.ramGB, 64);
});

test("ROCm presents AMD cards as cuda devices; the name tells them apart", () => {
  const hardware = hardwareFromStats(stats({ name: "cuda:0 AMD Radeon RX 7900 XTX : native", type: "cuda", vram_total: 24 * GiB }));
  assert.equal(hardware.kind, "amd");
  assert.equal(hardware.name, "AMD Radeon RX 7900 XTX");
  assert.equal(hardware.budgetGB, 24);
});

test("Intel Arc through XPU", () => {
  const hardware = hardwareFromStats(stats({ name: "xpu:0 Intel(R) Arc(TM) A770 Graphics", type: "xpu", vram_total: 16 * GiB }));
  assert.equal(hardware.kind, "intel");
  assert.equal(hardware.name, "Intel(R) Arc(TM) A770 Graphics");
  assert.equal(hardware.budgetGB, 16);
});

test("Apple Silicon: ComfyUI reports all of the unified memory; the budget is a share of it", () => {
  const ram = 24 * GiB;
  const hardware = hardwareFromStats({ system: { os: "darwin", ram_total: ram }, devices: [{ name: "mps", type: "mps", vram_total: ram, vram_free: ram / 2 }] });
  assert.equal(hardware.kind, "apple");
  assert.equal(hardware.unified, true);
  assert.equal(hardware.name, "Apple Silicon");
  assert.equal(hardware.budgetGB, 16.8);
  assert.equal(hardware.budgetSource, "unified-share");
  assert.equal(hardware.vramGB, 0);
  assert.equal(hardware.ramGB, 24);
});

test("a raised GPU wired limit on the Mac is the budget, never more than the memory itself", () => {
  assert.deepEqual(appleBudget(64 * GiB, 57344), { budgetGB: 56, budgetSource: "wired-limit" });
  assert.deepEqual(appleBudget(16 * GiB, 999999), { budgetGB: 16, budgetSource: "wired-limit" });
  assert.deepEqual(appleBudget(16 * GiB, 0), { budgetGB: 11.2, budgetSource: "unified-share" });
  assert.deepEqual(appleBudget(0, 0), { budgetGB: null, budgetSource: "" });
});

test("no budget where ComfyUI cannot tell: DirectML's placeholder, the CPU, no device", () => {
  assert.equal(hardwareFromStats(stats({ name: "privateuseone", type: "privateuseone", vram_total: GiB })).budgetGB, null);
  const cpu = hardwareFromStats(stats({ name: "cpu", type: "cpu", vram_total: 64 * GiB }));
  assert.equal(cpu.kind, "cpu");
  assert.equal(cpu.budgetGB, null);
  const none = hardwareFromStats(stats(null));
  assert.equal(none.known, false);
  assert.equal(none.ramGB, 64);
  assert.equal(hardwareFromStats().known, false);
});

test("device names and kinds", () => {
  assert.equal(cleanDeviceName("CUDA 0: Tesla T4"), "Tesla T4");
  assert.equal(gpuKind({ type: "cuda", name: "cuda:0 Tesla T4 : native" }), "nvidia");
  assert.equal(gpuKind({ type: "cuda", name: "cuda:0 AMD Instinct MI300X : native" }), "amd");
  assert.equal(gpuKind({ type: "mps", name: "mps" }), "apple");
});

test("fit: within the budget (with a little slack for a card's label), and within RAM where asked", () => {
  const card = { budgetGB: 11.9, ramTotal: 32 * GiB };
  assert.equal(fitsHardware(card, { memoryGB: 12 }), true);
  assert.equal(fitsHardware(card, { memoryGB: 16 }), false);
  assert.equal(fitsHardware(card, { memoryGB: 8, ramGB: 64 }), false);
  assert.equal(fitsHardware(card, { memoryGB: 8, ramGB: 32 }), true);
  assert.equal(fitsHardware({ budgetGB: null }, { memoryGB: 1 }), null);
});

test("this computer, when ComfyUI is meant to run here but does not answer", async () => {
  const mac = await localHardware({ platform: "darwin", arch: "arm64", run: async () => "0\n" });
  assert.equal(mac.kind, "apple");
  assert.equal(mac.source, "this-computer");
  assert.ok(mac.budgetGB > 0);
  const nvidia = await localHardware({ platform: "linux", arch: "x64", run: async (command) => command === "nvidia-smi" ? "NVIDIA GeForce RTX 3060, 12288, 11000\n" : "" });
  assert.equal(nvidia.kind, "nvidia");
  assert.equal(nvidia.name, "NVIDIA GeForce RTX 3060");
  assert.equal(nvidia.budgetGB, 12);
  const plain = await localHardware({ platform: "win32", arch: "x64", run: async () => "" });
  assert.equal(plain.known, false);
  assert.equal(plain.budgetGB, null);
  assert.ok(plain.ramGB > 0);
});

test("addresses on this computer", () => {
  assert.equal(isThisComputer("http://127.0.0.1:8188"), true);
  assert.equal(isThisComputer("http://localhost:8000"), true);
  assert.equal(isThisComputer("http://[::1]:8188"), true);
  assert.equal(isThisComputer("http://192.168.1.20:8188"), false);
  assert.equal(isThisComputer("not a url"), false);
});

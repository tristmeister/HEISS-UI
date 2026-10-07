import assert from "node:assert/strict";
import test from "node:test";
import { cuda13Capable, setupTips, torchCudaVersion } from "./setup-tips.js";

const stats = (pytorch, name = "cuda:0 NVIDIA GeForce RTX 3070 : cudaMallocAsync") => ({ system: { pytorch_version: pytorch }, devices: [{ type: "cuda", name }] });

test("PyTorch's CUDA build is read from its version", () => {
  assert.equal(torchCudaVersion("2.8.0+cu128"), 12.8);
  assert.equal(torchCudaVersion("2.14.0+cu130"), 13);
  assert.equal(torchCudaVersion("2.7.1+cu118"), 11.8);
  assert.equal(torchCudaVersion("2.9.0"), null);
  assert.equal(torchCudaVersion("2.9.0+rocm6.4"), null);
});

test("a CUDA 12 build on a card CUDA 13 supports gets the tip, with ComfyUI's own Python", () => {
  const [tip] = setupTips(stats("2.8.0+cu128"), { python: "C:\\ComfyUI_windows_portable\\python_embeded\\python.exe", platform: "win32" });
  assert.equal(tip.id, "cuda13");
  assert.match(tip.detail, /CUDA 12\.8/);
  assert.equal(tip.command, `& "C:\\ComfyUI_windows_portable\\python_embeded\\python.exe" -s -m pip install --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130`);
  assert.match(setupTips(stats("2.8.0+cu128"), { platform: "linux" })[0].command, /^python3 -m pip install/);
});

test("no tip on CUDA 13, without a CUDA tag, off NVIDIA, or on cards CUDA 13 dropped", () => {
  assert.deepEqual(setupTips(stats("2.14.0+cu130")), []);
  assert.deepEqual(setupTips(stats("2.9.0")), []);
  assert.deepEqual(setupTips({ system: { pytorch_version: "2.9.0" }, devices: [{ type: "mps", name: "mps" }] }), []);
  assert.deepEqual(setupTips(stats("2.8.0+cu128", "cuda:0 NVIDIA GeForce GTX 1080 Ti : cudaMallocAsync")), []);
  assert.deepEqual(setupTips({}), []);
  assert.equal(cuda13Capable("NVIDIA GeForce RTX 5090"), true);
  assert.equal(cuda13Capable("NVIDIA GeForce GTX 1660 SUPER"), true);
  assert.equal(cuda13Capable("NVIDIA RTX A4000"), true);
  assert.equal(cuda13Capable("NVIDIA A10G"), true);
  assert.equal(cuda13Capable("NVIDIA GeForce MX450"), true);
  assert.equal(cuda13Capable("NVIDIA GH200 480GB"), true);
  assert.equal(cuda13Capable("NVIDIA TITAN V"), false);
  assert.equal(cuda13Capable("Tesla V100-SXM2-16GB"), false);
});

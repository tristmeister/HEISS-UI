import assert from "node:assert/strict";
import test from "node:test";
import { diagnostics, diagnosticsText, systemName } from "./diagnostics.js";

const stats = {
  system: { os: "nt", ram_total: 68e9, comfyui_version: "0.34.1", python_version: "3.12.10 (tags/v3.12.10) [MSC v.1943 64 bit (AMD64)]", pytorch_version: "2.8.0+cu128", embedded_python: true, argv: ["main.py", "--output-directory", "D:\\secret\\folder"] },
  devices: [{ name: "cuda:0 NVIDIA GeForce RTX 4070 : cudaMallocAsync", type: "cuda", vram_total: 12 * 1024 ** 3, vram_free: 10.5 * 1024 ** 3 }]
};

test("the report names versions, system and GPU in plain lines", () => {
  const text = diagnosticsText(diagnostics({ version: "0.11.0", install: "release", stats, comfyLocal: true, platform: "win32", arch: "x64" }));
  const lines = text.split("\n");
  assert.equal(lines[0], "HEISS UI 0.11.0 (release)");
  assert.equal(lines[1], `Node.js ${process.versions.node}`);
  assert.match(lines[2], /^System: .*x64, [\d.]+ GB RAM$/);
  assert.equal(lines[3], "ComfyUI 0.34.1, on this computer; Python 3.12.10, PyTorch 2.8.0+cu128, portable");
  assert.equal(lines[4], "GPU: cuda:0 NVIDIA GeForce RTX 4070 : cudaMallocAsync [cuda], 12.0 GB VRAM (10.5 GB free)");
});

test("nothing personal goes into it: no folders from ComfyUI's command line", () => {
  const report = diagnostics({ version: "0.11.0", stats });
  assert.equal(JSON.stringify(report).includes("secret"), false);
  assert.equal(diagnosticsText(report).includes("secret"), false);
});

test("a ComfyUI that does not answer is said so", () => {
  const text = diagnosticsText(diagnostics({ version: "0.11.0", install: "checkout", stats: null, comfyLocal: false }));
  assert.match(text, /ComfyUI: not answering \(on another computer\)$/);
});

test("each system gets a readable name", () => {
  assert.equal(systemName({ platform: "win32", release: "10.0.26100", version: "Windows 11 Pro" }), "Windows 11 Pro (10.0.26100)");
  assert.equal(systemName({ platform: "darwin", release: "25.2.0" }), "macOS (Darwin 25.2.0)");
  assert.equal(systemName({ platform: "linux", release: "6.8.0", readFile: () => 'NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n' }), "Ubuntu 24.04.1 LTS (Linux 6.8.0)");
  assert.equal(systemName({ platform: "linux", release: "6.8.0", readFile: () => { throw new Error("ENOENT"); } }), "Linux 6.8.0");
});

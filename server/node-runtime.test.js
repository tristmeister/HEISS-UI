import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { activateRuntime, currentRuntime, needsRuntime, pruneRuntimes, runtimeArchive, runtimeBinary, runtimeFolder, runtimeParts } from "./node-runtime.js";

const install = (platform = "win32", arch = "x64") => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-runtime-"));
  const runtime = (version) => {
    const folder = runtimeFolder(version, arch, platform);
    const binary = path.join(root, "runtime", folder, runtimeBinary(folder));
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.writeFileSync(binary, "");
    return folder;
  };
  return { root, runtime };
};

test("runtime folders are named like Node's own archives, for each system", () => {
  assert.equal(runtimeFolder("v24.2.0", "x64", "win32"), "node-v24.2.0-win-x64");
  assert.equal(runtimeFolder("24.2.0", "arm64", "darwin"), "node-v24.2.0-darwin-arm64");
  assert.equal(runtimeFolder("24.2.0", "x64", "linux"), "node-v24.2.0-linux-x64");
  assert.equal(runtimeArchive("node-v24.2.0-win-x64"), "node-v24.2.0-win-x64.zip");
  assert.equal(runtimeArchive("node-v24.2.0-darwin-arm64"), "node-v24.2.0-darwin-arm64.tar.gz");
  assert.equal(runtimeBinary("node-v24.2.0-win-x64"), "node.exe");
  assert.equal(runtimeBinary("node-v24.2.0-linux-x64"), path.join("bin", "node"));
  assert.deepEqual(runtimeParts("node-v24.2.0-darwin-arm64"), { version: "24.2.0", system: "darwin", arch: "arm64" });
  assert.equal(runtimeParts("node-v24.2.0-darwin-arm64/../x"), null);
});

test("a Windows download's Node is switched only to a folder that has node.exe, and old ones go", () => {
  const { root, runtime } = install();
  const old = runtime("24.1.0");
  fs.writeFileSync(path.join(root, "runtime", "current.txt"), old);
  assert.equal(currentRuntime(root), old);
  assert.equal(needsRuntime(root, "24.1.0", "win32"), false, "already the one it runs");
  assert.equal(needsRuntime(root, "24.2.0", "win32"), true);
  assert.equal(needsRuntime(root, "24.2.0", "darwin"), false, "a Windows runtime is never replaced by another system's");

  assert.equal(activateRuntime(root, "node-v24.2.0-win-x64"), false, "not fetched yet");
  assert.equal(currentRuntime(root), old);
  const next = runtime("24.2.0");
  assert.equal(activateRuntime(root, next), true);
  assert.equal(currentRuntime(root), next);

  pruneRuntimes(root);
  assert.deepEqual(fs.readdirSync(path.join(root, "runtime")).sort(), ["current.txt", next]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a macOS or Linux download's Node lives in bin/node and updates the same way", () => {
  for (const [platform, arch] of [["darwin", "arm64"], ["linux", "x64"]]) {
    const { root, runtime } = install(platform, arch);
    const old = runtime("22.11.0");
    fs.writeFileSync(path.join(root, "runtime", "current.txt"), old);
    assert.equal(needsRuntime(root, "22.11.0", platform), false);
    assert.equal(needsRuntime(root, "22.12.0", platform), true);
    const next = runtime("22.12.0");
    assert.equal(activateRuntime(root, next), true);
    // A folder with node.exe but no bin/node is not a runtime for this system.
    fs.mkdirSync(path.join(root, "runtime", `node-v22.13.0-${platform === "darwin" ? "darwin" : "linux"}-${arch}`), { recursive: true });
    fs.writeFileSync(path.join(root, "runtime", `node-v22.13.0-${platform === "darwin" ? "darwin" : "linux"}-${arch}`, "node.exe"), "");
    assert.equal(activateRuntime(root, `node-v22.13.0-${platform === "darwin" ? "darwin" : "linux"}-${arch}`), false);
    pruneRuntimes(root);
    assert.deepEqual(fs.readdirSync(path.join(root, "runtime")).sort(), ["current.txt", next]);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a copy without a bundled Node never fetches one", () => {
  const { root } = install();
  assert.equal(currentRuntime(root), "");
  fs.mkdirSync(path.join(root, "runtime"));
  assert.equal(needsRuntime(root, "24.2.0", "win32"), false);
  assert.equal(needsRuntime(root, "24.2.0", "darwin"), false);
  fs.writeFileSync(path.join(root, "runtime", "current.txt"), "..\\..\\evil");
  assert.equal(currentRuntime(root), "", "current.txt only ever names a runtime folder");
  fs.rmSync(root, { recursive: true, force: true });
});

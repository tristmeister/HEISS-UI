import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { activateRuntime, currentRuntime, needsRuntime, pruneRuntimes, runtimeFolder } from "./node-runtime.js";

const install = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-runtime-"));
  const runtime = (version) => {
    const dir = path.join(root, "runtime", runtimeFolder(version, "x64"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "node.exe"), "");
    return path.basename(dir);
  };
  return { root, runtime };
};

test("a Windows download's Node is switched only to a folder that has node.exe, and old ones go", () => {
  const { root, runtime } = install();
  const old = runtime("24.1.0");
  fs.writeFileSync(path.join(root, "runtime", "current.txt"), old);
  assert.equal(currentRuntime(root), old);
  assert.equal(needsRuntime(root, "24.1.0", "win32"), false, "already the one it runs");
  assert.equal(needsRuntime(root, "24.2.0", "darwin"), false, "only Windows downloads bring Node");

  assert.equal(activateRuntime(root, "node-v24.2.0-win-x64"), false, "not fetched yet");
  assert.equal(currentRuntime(root), old);
  const next = runtime("24.2.0");
  assert.equal(activateRuntime(root, next), true);
  assert.equal(currentRuntime(root), next);

  pruneRuntimes(root);
  assert.deepEqual(fs.readdirSync(path.join(root, "runtime")).sort(), ["current.txt", next]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a copy without a bundled Node never fetches one", () => {
  const { root } = install();
  assert.equal(currentRuntime(root), "");
  fs.mkdirSync(path.join(root, "runtime"));
  assert.equal(needsRuntime(root, "24.2.0", "win32"), false);
  fs.writeFileSync(path.join(root, "runtime", "current.txt"), "..\\..\\evil");
  assert.equal(currentRuntime(root), "", "current.txt only ever names a runtime folder");
  fs.rmSync(root, { recursive: true, force: true });
});

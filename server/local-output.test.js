import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Each test file runs in its own process, so this output folder stays here.
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-output-"));
fs.mkdirSync(path.join(outputDir, "run"), { recursive: true });
fs.writeFileSync(path.join(outputDir, "run", "a.png"), "png");
fs.writeFileSync(path.join(path.dirname(outputDir), "outside.png"), "secret");
process.env.COMFY_OUTPUT_DIR = outputDir;
const { localOutputFile } = await import("./comfy.js");

test("outputs open from the output folder while ComfyUI is down", () => {
  assert.equal(localOutputFile("a.png", "run", "output"), path.join(outputDir, "run", "a.png"));
  assert.equal(localOutputFile("missing.png", "run", "output"), null);
});

test("nothing outside the output folder, and only outputs", () => {
  assert.equal(localOutputFile("outside.png", "..", "output"), null);
  assert.equal(localOutputFile("../outside.png", "", "output"), null);
  assert.equal(localOutputFile(path.join(path.dirname(outputDir), "outside.png"), "", "output"), null);
  assert.equal(localOutputFile("a.png", "run", "input"), null);
  assert.equal(localOutputFile("run", "", "output"), null, "a folder is not a file");
});

test("only media, never through a symlink out of the folder or from the trash", () => {
  fs.writeFileSync(path.join(outputDir, "run", "notes.txt"), "not an output");
  fs.writeFileSync(path.join(outputDir, "id_rsa"), "key");
  assert.equal(localOutputFile("notes.txt", "run", "output"), null);
  assert.equal(localOutputFile("id_rsa", "", "output"), null);
  fs.mkdirSync(path.join(outputDir, ".heiss-trash", "b1"), { recursive: true });
  fs.writeFileSync(path.join(outputDir, ".heiss-trash", "b1", "gone.png"), "png");
  assert.equal(localOutputFile("gone.png", ".heiss-trash/b1", "output"), null);
  const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-secret-"));
  fs.writeFileSync(path.join(secretDir, "private.png"), "not yours");
  try {
    fs.symlinkSync(secretDir, path.join(outputDir, "linked"), "dir");
    fs.symlinkSync(path.join(secretDir, "private.png"), path.join(outputDir, "run", "link.png"));
  } catch {
    return; // No symlinks here (Windows without the right): nothing to escape through.
  }
  assert.equal(localOutputFile("private.png", "linked", "output"), null);
  assert.equal(localOutputFile("link.png", "run", "output"), null);
});

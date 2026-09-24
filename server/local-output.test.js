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

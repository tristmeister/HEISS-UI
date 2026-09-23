import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeFolderInput } from "./comfy.js";
import { inspectOutputDir } from "./output-folder.js";

const item = (filename, subfolder = "") => ({
  id: filename,
  url: `/comfy/view?${new URLSearchParams({ filename, subfolder, type: "output" })}`,
  status: "done",
  createdAt: new Date().toISOString()
});

test("folder input tolerates quotes, file URLs and ~", () => {
  const dir = path.join(os.tmpdir(), "heiss out");
  assert.equal(normalizeFolderInput(`"${dir}"`), dir);
  assert.equal(normalizeFolderInput(pathToFileURL(dir).href), dir);
  assert.equal(normalizeFolderInput(`${dir}${path.sep}`), dir);
  assert.equal(normalizeFolderInput("~"), os.homedir());
  assert.equal(normalizeFolderInput("   "), "");
});

test("inspection tells the right output folder from a merely existing one", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-output-"));
  const right = path.join(base, "ComfyUI", "output");
  const wrong = path.join(base, "elsewhere");
  fs.mkdirSync(path.join(right, "video"), { recursive: true });
  fs.mkdirSync(path.join(base, "ComfyUI", "models"));
  fs.mkdirSync(wrong);
  fs.writeFileSync(path.join(right, "ComfyUI_00001_.png"), "");
  fs.writeFileSync(path.join(right, "video", "clip.mp4"), "");
  fs.writeFileSync(path.join(wrong, "other.png"), "");
  const samples = [item("ComfyUI_00001_.png"), item("clip.mp4", "video")];
  try {
    const match = await inspectOutputDir(right, samples);
    assert.equal(match.state, "match");
    assert.equal(match.found, 2);
    assert.equal(match.media, 2);
    assert.equal(match.looksLikeComfy, true);
    assert.equal((await inspectOutputDir(wrong, samples)).state, "mismatch");
    assert.equal((await inspectOutputDir(wrong, [])).state, "ok");
    assert.equal((await inspectOutputDir(path.join(base, "nope"), samples)).state, "missing");
    assert.equal((await inspectOutputDir(path.join(right, "ComfyUI_00001_.png"), samples)).state, "not-folder");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

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

test("only a folder ComfyUI writes to can become the output folder", async () => {
  const { outputDirChoice } = await import("./output-folder.js");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-choice-"));
  const comfyOutput = path.join(base, "ComfyUI", "output");
  const empty = path.join(base, "ComfyUI", "output-empty-sibling");
  const random = path.join(base, "Documents");
  const renders = path.join(base, "renders");
  fs.mkdirSync(comfyOutput, { recursive: true });
  fs.mkdirSync(path.join(base, "ComfyUI", "models"));
  fs.mkdirSync(empty);
  fs.mkdirSync(random);
  fs.mkdirSync(path.join(renders, "heiss-ui"), { recursive: true });
  fs.writeFileSync(path.join(random, "taxes.pdf"), "");
  const options = { current: "", comfyDirs: [], samples: [] };
  try {
    assert.equal((await outputDirChoice(comfyOutput, options)).ok, true, "next to ComfyUI’s models");
    assert.equal((await outputDirChoice(empty, options)).ok, true, "a fresh, empty one next to models too");
    assert.equal((await outputDirChoice(renders, options)).ok, true, "one HEISS UI already saved into");
    const refused = await outputDirChoice(random, options);
    assert.equal(refused.ok, false);
    assert.match(refused.error, /doesn’t look like a ComfyUI output folder/);
    assert.equal((await outputDirChoice(random, { ...options, comfyDirs: [random] })).ok, true, "ComfyUI says it saves there");
    assert.equal((await outputDirChoice(random, { ...options, current: random })).ok, true, "the folder already set keeps working");
    assert.equal((await outputDirChoice(os.homedir(), options)).ok, false);
    assert.equal((await outputDirChoice(path.parse(base).root, options)).ok, false);
    assert.equal((await outputDirChoice(path.join(base, "nope"), options)).ok, false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

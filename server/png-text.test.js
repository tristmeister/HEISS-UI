import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { parseA1111Parameters, readPngInfo, withPngText } from "./png-text.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-png-"));
const png = await sharp({ create: { width: 6, height: 4, channels: 3, background: "#c33" } }).png().toBuffer();

test("text chunks are written before IEND and read back, Latin-1 and not", async () => {
  let buffer = withPngText(png, "prompt", JSON.stringify({ 1: { class_type: "CLIPTextEncode", inputs: { text: "a fox" } } }));
  buffer = withPngText(buffer, "parameters", "ein Fuchs im Schnee, 狐\nSteps: 4");
  const file = path.join(dir, "a.png");
  fs.writeFileSync(file, buffer);
  const info = readPngInfo(file);
  assert.equal(info.width, 6);
  assert.equal(info.height, 4);
  assert.equal(info.text.parameters, "ein Fuchs im Schnee, 狐\nSteps: 4");
  assert.match(info.text.prompt, /a fox/);
  // Still a PNG any decoder opens.
  const meta = await sharp(buffer).metadata();
  assert.equal(meta.width, 6);
});

test("writing a keyword again replaces it instead of adding a second", () => {
  const once = withPngText(png, "parameters", "first");
  const twice = withPngText(once, "parameters", "second");
  const file = path.join(dir, "b.png");
  fs.writeFileSync(file, twice);
  assert.equal(readPngInfo(file).text.parameters, "second");
  assert.equal(twice.toString("latin1").split("parameters").length - 1, 1);
});

test("not a PNG: nothing is read or written", () => {
  const file = path.join(dir, "c.png");
  fs.writeFileSync(file, "not an image");
  assert.equal(readPngInfo(file), null);
  assert.equal(withPngText(Buffer.from("nope"), "parameters", "x"), null);
});

test("AUTOMATIC1111 parameters come apart into prompt, negative and settings", () => {
  const parsed = parseA1111Parameters([
    "a castle on a hill, <lora:detail:0.6>",
    "golden hour",
    "Negative prompt: blurry, low quality",
    'Steps: 28, Sampler: DPM++ 2M, Schedule type: Karras, CFG scale: 6.5, Seed: 12345, Size: 832x1216, Model hash: 0123456789, Model: juggernautXL, Lora hashes: "detail: abcdef1234", Version: v1.10.1'
  ].join("\n"));
  assert.equal(parsed.prompt, "a castle on a hill, <lora:detail:0.6>\ngolden hour");
  assert.equal(parsed.negative, "blurry, low quality");
  assert.equal(parsed.steps, 28);
  assert.equal(parsed.sampler, "DPM++ 2M");
  assert.equal(parsed.cfg, 6.5);
  assert.equal(parsed.seed, "12345");
  assert.equal(parsed.width, 832);
  assert.equal(parsed.height, 1216);
  assert.equal(parsed.model, "juggernautXL");
  assert.equal(parseA1111Parameters("just a prompt").prompt, "just a prompt");
});

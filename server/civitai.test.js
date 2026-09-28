import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

// Each test file runs in its own process, so these folders stay here.
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-output-"));
process.env.COMFY_OUTPUT_DIR = outputDir;
process.env.HEISS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-data-"));
const { civitaiPrefs, parametersText, saveCivitaiPrefs, writeCivitaiParameters } = await import("./civitai.js");
const { parseA1111Parameters, readPngInfo } = await import("./png-text.js");

const body = {
  prompt: "a lighthouse at dusk",
  negative: "blurry",
  model: "sdxl/juggernautXL_v9.safetensors",
  source: "checkpoint",
  steps: 30,
  cfg: 5.5,
  sampler: "dpmpp_2m",
  scheduler: "karras",
  seed: "424242",
  width: 1024,
  height: 1024,
  loras: [{ name: "styles/film-grain.safetensors", strength: 0.65, enabled: true }]
};

test("the text reads the way AUTOMATIC1111 writes it", () => {
  const text = parametersText(body, { width: 832, height: 1216, hashes: { [body.model]: "0123456789" } });
  const [prompt, negative, settings] = text.split("\n");
  assert.equal(prompt, "a lighthouse at dusk <lora:film-grain:0.65>");
  assert.equal(negative, "Negative prompt: blurry");
  assert.match(settings, /^Steps: 30, Sampler: DPM\+\+ 2M, Schedule type: Karras, CFG scale: 5\.5, Seed: 424242, Size: 832x1216, Model hash: 0123456789, Model: juggernautXL_v9/);
  const parsed = parseA1111Parameters(text);
  assert.equal(parsed.prompt, prompt);
  assert.equal(parsed.negative, "blurry");
  assert.equal(parsed.seed, "424242");
  assert.equal(parsed.model, "juggernautXL_v9");
});

test("off by default; on, a finished PNG in the output folder carries it", async () => {
  fs.mkdirSync(path.join(outputDir, "heiss-ui"), { recursive: true });
  const file = path.join(outputDir, "heiss-ui", "image_00001_.png");
  fs.writeFileSync(file, await sharp({ create: { width: 8, height: 6, channels: 3, background: "#123" } }).png().toBuffer());
  const outputs = [{ url: `/comfy/view?${new URLSearchParams({ filename: "image_00001_.png", subfolder: "heiss-ui", type: "output" })}`, filename: "image_00001_.png", type: "image" }];

  assert.equal(civitaiPrefs().enabled, false);
  assert.equal(writeCivitaiParameters(outputs, body), 0);
  assert.equal(readPngInfo(file).text.parameters, undefined);

  saveCivitaiPrefs({ enabled: true });
  assert.equal(writeCivitaiParameters(outputs, body), 1);
  const info = readPngInfo(file);
  assert.match(info.text.parameters, /Size: 8x6/, "the file's own size, not the one asked for");
  assert.equal((await sharp(file).metadata()).width, 8);
});

test("never for Hidden", async () => {
  const file = path.join(outputDir, "hidden.png");
  fs.writeFileSync(file, await sharp({ create: { width: 2, height: 2, channels: 3, background: "#000" } }).png().toBuffer());
  const outputs = [{ url: `/comfy/view?${new URLSearchParams({ filename: "hidden.png", subfolder: "", type: "output" })}`, filename: "hidden.png", type: "image" }];
  assert.equal(writeCivitaiParameters(outputs, { ...body, privateVault: true }), 0);
  assert.equal(readPngInfo(file).text.parameters, undefined);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

// Each test file runs in its own process, so these folders stay here. Nothing
// answers on this ComfyUI address, so the outputs are read from the folder.
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-output-"));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-data-"));
process.env.COMFY_OUTPUT_DIR = outputDir;
process.env.HEISS_DATA_DIR = dataDir;
process.env.COMFY_URL = "http://127.0.0.1:9";
const { getThumbnail, warmThumbnails } = await import("./thumbnails.js");
test.after(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const thumbnails = () => {
  try { return fs.readdirSync(path.join(dataDir, ".thumbnails")).filter((name) => name.endsWith(".webp")); } catch { return []; }
};

async function picture(name) {
  await sharp({ create: { width: 32, height: 24, channels: 3, background: "#369" } }).png().toFile(path.join(outputDir, name));
  const params = new URLSearchParams({ filename: name, subfolder: "", type: "output" });
  return { url: `/comfy/view?${params}`, thumbnailUrl: `/comfy/thumb?${params}`, type: "image", status: "done" };
}

async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) return false;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return true;
}

test("a finished picture's thumbnail is made before anyone asks, and the ask finds it", async () => {
  const item = await picture("warm.png");
  warmThumbnails([item]);
  assert.ok(await until(() => thumbnails().length === 1), "made in the background");
  const served = await getThumbnail("warm.png", "", "output");
  assert.ok(served.file);
  assert.equal(thumbnails().length, 1, "the ask reuses it instead of making another");
});

test("never for Hidden, a video or a run still going", async () => {
  const before = thumbnails().length;
  warmThumbnails([
    { ...(await picture("hidden.png")), privateVault: true },
    { ...(await picture("pending.png")), status: "pending" },
    { url: "/comfy/view?filename=clip.mp4&subfolder=&type=output", type: "video", status: "done" },
    null
  ]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(thumbnails().length, before);
});

test("an upscaled picture warms the thumbnail its tile shows", async () => {
  const base = await picture("base.png");
  const big = await picture("base-2k.png");
  const before = thumbnails().length;
  warmThumbnails([{ ...base, upscaleActive: true, upscale: { status: "done", url: big.url, thumbnailUrl: big.thumbnailUrl } }]);
  assert.ok(await until(() => thumbnails().length === before + 1));
  const served = await getThumbnail("base-2k.png", "", "output");
  assert.ok(served.file && fs.existsSync(served.file));
});

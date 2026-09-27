import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Each test file runs in its own process, so these folders stay here.
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-output-"));
process.env.COMFY_OUTPUT_DIR = outputDir;
process.env.HEISS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-data-"));
const { galleryDelta, galleryRevisionValue, hideGalleryItems, makePendingItems, pageGallery, replaceGalleryJob, setGallery } = await import("./gallery-store.js");

const url = (filename) => `/comfy/view?${new URLSearchParams({ filename, subfolder: "", type: "output" })}`;

test("a run that reuses a deleted image's file name still shows when it finishes", () => {
  // The newest image, HEISS_00042_.png, exists; a run starts; then that image is deleted.
  fs.writeFileSync(path.join(outputDir, "HEISS_00042_.png"), "old");
  const old = { id: url("HEISS_00042_.png"), url: url("HEISS_00042_.png"), status: "done", type: "image", createdAt: new Date(Date.now() - 60_000).toISOString() };
  const body = { kind: "image", prompt: "a fox", count: 1, createdAt: new Date(Date.now() - 5_000).toISOString() };
  const pending = makePendingItems("job-1", body);
  setGallery([...pending, old]);
  fs.unlinkSync(path.join(outputDir, "HEISS_00042_.png"));
  hideGalleryItems([old]);
  setGallery(pending);
  const since = galleryRevisionValue();

  // ComfyUI saves the run under the freed name.
  fs.writeFileSync(path.join(outputDir, "HEISS_00042_.png"), "new");
  replaceGalleryJob("job-1", [{ url: url("HEISS_00042_.png"), filename: "HEISS_00042_.png", type: "image" }], body, new Map());

  const delta = galleryDelta({ since });
  assert.deepEqual(delta.upserts.map((item) => item.url), [url("HEISS_00042_.png")]);
  assert.deepEqual(pageGallery({}).items.map((item) => item.url), [url("HEISS_00042_.png")]);
});

test("a finished image is listed at once, before the folder listing catches up", async () => {
  const { listReferenceAssets } = await import("./reference-assets.js");
  fs.writeFileSync(path.join(outputDir, "older.png"), "x");
  setGallery([{ id: url("older.png"), url: url("older.png"), status: "done", type: "image", createdAt: new Date(Date.now() - 100_000).toISOString() }]);
  // Let the cached listing settle, then read it, as a page load does.
  await new Promise((resolve) => setTimeout(resolve, 2100));
  const body = { kind: "image", prompt: "a heron", count: 1, createdAt: new Date().toISOString() };
  setGallery([...makePendingItems("job-2", body), ...pageGallery({}).items]);
  assert.equal(listReferenceAssets({ headers: {} }, { source: "generation" }).items.length, 1);
  fs.writeFileSync(path.join(outputDir, "fresh.png"), "y");
  replaceGalleryJob("job-2", [{ url: url("fresh.png"), filename: "fresh.png", type: "image" }], body, new Map());
  assert.equal(listReferenceAssets({ headers: {} }, { source: "generation" }).items.length, 2);
  assert.ok(pageGallery({}).items.some((item) => item.url === url("fresh.png")));
});

test("an image shown upscaled is used upscaled, at the original's size", async () => {
  const { loadSharp } = await import("./sharp-loader.js");
  const sharp = await loadSharp();
  if (!sharp) return;
  const { bytesForReference } = await import("./reference-assets.js");
  const png = (width, height, r) => sharp({ create: { width, height, channels: 3, background: { r, g: 0, b: 0 } } }).png().toBuffer();
  fs.writeFileSync(path.join(outputDir, "ref.png"), await png(64, 48, 10));
  fs.writeFileSync(path.join(outputDir, "ref-up.png"), await png(256, 192, 250));
  const item = {
    id: url("ref.png"), url: url("ref.png"), outputName: "ref.png", status: "done", type: "image", createdAt: new Date().toISOString(),
    upscaleActive: true, upscale: { status: "done", url: url("ref-up.png"), outputName: "ref-up.png" }
  };
  setGallery([item]);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const id = `gallery:${Buffer.from(item.url).toString("base64url")}`;
  const used = await bytesForReference({ headers: {} }, id);
  const meta = await sharp(used.buffer).metadata();
  const { data } = await sharp(used.buffer).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([meta.width, meta.height, data[0] > 200], [64, 48, true]);

  setGallery([{ ...item, upscaleActive: false }]);
  const original = await bytesForReference({ headers: {} }, id);
  const { data: originalData } = await sharp(original.buffer).raw().toBuffer({ resolveWithObject: true });
  assert.ok(originalData[0] < 50);
});

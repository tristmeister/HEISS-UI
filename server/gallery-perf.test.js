import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Each test file runs in its own process, so these folders stay here.
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-output-"));
process.env.COMFY_OUTPUT_DIR = outputDir;
process.env.HEISS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-data-"));
const { filterVisibleGallery, galleryDelta, galleryRevisionValue, markGalleryReset, setGallery, updateGalleryJob } = await import("./gallery-store.js");
const { getThumbnail } = await import("./thumbnails.js");
const { loadSharp } = await import("./sharp-loader.js");

const output = (name, subfolder = "") => ({
  id: name,
  status: "done",
  type: "image",
  createdAt: new Date().toISOString(),
  url: `/comfy/view?${new URLSearchParams({ filename: name, subfolder, type: "output" })}`
});

test("an output deleted outside the app drops out of the gallery", async () => {
  fs.mkdirSync(path.join(outputDir, "run"), { recursive: true });
  fs.writeFileSync(path.join(outputDir, "run", "keep.png"), "png");
  fs.writeFileSync(path.join(outputDir, "run", "gone.png"), "png");
  const items = [output("keep.png", "run"), output("gone.png", "run")];
  assert.deepEqual(filterVisibleGallery(items).map((item) => item.id), ["keep.png", "gone.png"]);
  fs.unlinkSync(path.join(outputDir, "run", "gone.png"));
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.deepEqual(filterVisibleGallery(items).map((item) => item.id), ["keep.png"]);
});

test("a grouping change resets browsers once, then the delta is quiet", () => {
  const before = galleryRevisionValue();
  assert.equal(galleryDelta({ since: before }).reset, false);
  markGalleryReset();
  assert.equal(galleryDelta({ since: before }).reset, true);
  assert.equal(galleryDelta({ since: galleryRevisionValue() }).reset, false);
});

test("a local output's cached thumbnail is served without fetching the original", async (t) => {
  const sharp = await loadSharp();
  if (!sharp) return t.skip("sharp is not installed");
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#f00" } }).png().toBuffer();
  fs.writeFileSync(path.join(outputDir, "thumb.png"), png);
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches += 1; throw new Error("offline"); };
  try {
    const first = await getThumbnail("thumb.png", "", "output");
    const second = await getThumbnail("thumb.png", "", "output");
    assert.ok(fs.existsSync(first.file));
    assert.equal(second.etag, first.etag);
    assert.equal(fetches, 0);
    // Overwriting the output under the same name gives a new thumbnail.
    await new Promise((resolve) => setTimeout(resolve, 20));
    fs.writeFileSync(path.join(outputDir, "thumb.png"), await sharp({ create: { width: 32, height: 32, channels: 3, background: "#00f" } }).png().toBuffer());
    const third = await getThumbnail("thumb.png", "", "output");
    assert.notEqual(third.etag, first.etag);
    assert.equal(fs.existsSync(first.file), false, "the stale thumbnail is removed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a live preview reaches other browsers while rendering, and is not kept once done", () => {
  setGallery([{ id: "job-1:0", jobId: "job-1", status: "pending", type: "image", createdAt: new Date().toISOString() }], { persist: false });
  const since = galleryRevisionValue();
  updateGalleryJob("job-1", { preview: "data:image/jpeg;base64,AAAA" }, { persist: false });
  assert.equal(galleryDelta({ since }).upserts[0].preview, "data:image/jpeg;base64,AAAA");
  const before = galleryRevisionValue();
  updateGalleryJob("job-1", { preview: "data:image/jpeg;base64,AAAA" }, { persist: false });
  assert.equal(galleryRevisionValue(), before, "an unchanged patch does not bump the revision");
  updateGalleryJob("job-1", { status: "done", preview: undefined }, { persist: false });
  assert.deepEqual(galleryDelta({ since }).upserts.map((item) => [item.status, item.preview]), [["done", undefined]]);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Each test file runs in its own process, so these folders stay here.
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-output-"));
process.env.COMFY_OUTPUT_DIR = outputDir;
process.env.HEISS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-data-"));
const store = await import("./gallery-store.js");
const { filterVisibleGallery, flushGallery, galleryDelta, galleryPath, galleryRevisionValue, markGalleryReset, pageGallery, saveGallery, setGallery, updateGalleryJob } = await import("./gallery-store.js");
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
  let downloads = 0;
  let sizeChecks = 0;
  // ComfyUI answers a one-byte range with the file's full size, the way aiohttp does.
  globalThis.fetch = async (_url, options = {}) => {
    if (options.headers?.Range !== "bytes=0-0") { downloads += 1; throw new Error("offline"); }
    sizeChecks += 1;
    const size = fs.statSync(path.join(outputDir, "thumb.png")).size;
    return new Response(new Uint8Array(1), { status: 206, headers: { "content-range": `bytes 0-0/${size}` } });
  };
  try {
    const first = await getThumbnail("thumb.png", "", "output");
    const second = await getThumbnail("thumb.png", "", "output");
    assert.ok(fs.existsSync(first.file));
    assert.equal(second.etag, first.etag);
    assert.equal(downloads, 0);
    assert.equal(sizeChecks, 1, "one size check per version of the file");
    // Overwriting the output under the same name gives a new thumbnail.
    await new Promise((resolve) => setTimeout(resolve, 20));
    fs.writeFileSync(path.join(outputDir, "thumb.png"), await sharp({ create: { width: 32, height: 32, channels: 3, background: "#00f" } }).png().toBuffer());
    const third = await getThumbnail("thumb.png", "", "output");
    assert.notEqual(third.etag, first.etag);
    assert.equal(fs.existsSync(first.file), false, "the stale thumbnail is removed");
    assert.equal(downloads, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a same-named file that isn't ComfyUI's output is never made into its thumbnail", async (t) => {
  const sharp = await loadSharp();
  if (!sharp) return t.skip("sharp is not installed");
  // The folder HEISS UI reads holds a red picture; ComfyUI's own file of that name is blue and bigger.
  fs.writeFileSync(path.join(outputDir, "other.png"), await sharp({ create: { width: 16, height: 16, channels: 3, background: "#f00" } }).png().toBuffer());
  const blue = await sharp({ create: { width: 48, height: 48, channels: 3, background: "#00f" } }).png().toBuffer();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => options.headers?.Range === "bytes=0-0"
    ? new Response(new Uint8Array(1), { status: 206, headers: { "content-range": `bytes 0-0/${blue.length}` } })
    : new Response(blue, { status: 200 });
  try {
    const thumbnail = await getThumbnail("other.png", "", "output");
    const { data } = await sharp(thumbnail.file).raw().toBuffer({ resolveWithObject: true });
    assert.ok(data[2] > 200 && data[0] < 50, "the thumbnail is of ComfyUI's blue file, not the local red one");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Not Comfy outputs (no /comfy/view URL), so no file checks: this measures the list work alone.
const bigGallery = (count) => {
  const start = Date.parse("2026-01-01T00:00:00Z");
  return Array.from({ length: count }, (_, index) => ({
    id: `local-${index}`,
    jobId: `job-${Math.floor(index / 4)}`,
    index: index % 4,
    status: index % 97 === 0 ? "error" : "done",
    type: index % 11 === 0 ? "video" : "image",
    prompt: `a quiet harbour at dawn, number ${index}`,
    // Four images per job share a time, like a batch.
    createdAt: new Date(start + Math.floor(index / 4) * 1000).toISOString(),
    settings: { steps: 20, cfg: 4, sampler: "euler", scheduler: "simple", seed: index }
  }));
};

test("paging through 50,000 items reads each page from one sorted list, without repeats", () => {
  const items = bigGallery(50_000);
  setGallery(items, { persist: false });
  // The first page builds the sorted list; every later page only cuts from it.
  const buildsBefore = store.visibleListBuildCount();
  const first = pageGallery({ limit: 220 });
  const seen = first.items.map((item) => item.id);
  let cursor = first.nextCursor;
  let pages = 1;
  do {
    const page = pageGallery({ limit: 220, cursor });
    seen.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor && pages < 1000);
  assert.equal(new Set(seen).size, seen.length, "no item is served twice");
  assert.equal(seen.length, 50_000);
  assert.deepEqual(seen.slice(0, 4), ["local-49996", "local-49997", "local-49998", "local-49999"], "newest first, a batch in its own order");
  // Re-filtering and re-sorting per page made every page cost as much as the whole
  // gallery; all of them are now cut from the one list the first page built.
  // A folder re-check on a busy machine (at most once a second) may rebuild it once or twice more; per page it'd be hundreds.
  assert.ok(store.visibleListBuildCount() - buildsBefore <= 3, `the list was rebuilt ${store.visibleListBuildCount() - buildsBefore} times while paging through ${pages} pages`);

  const videos = pageGallery({ type: "video", limit: 500, includeFailed: false });
  assert.ok(videos.items.every((item) => item.type === "video" && item.status !== "error"));
  assert.equal(videos.totalApprox, items.filter((item) => item.type === "video" && item.status !== "error").length);
});

test("a change to the gallery shows on the next page request", () => {
  setGallery(bigGallery(1000), { persist: false });
  assert.equal(pageGallery({ limit: 5 }).totalApprox, 1000);
  updateGalleryJob("job-249", { status: "canceled" }, { persist: false });
  assert.equal(pageGallery({ limit: 5 }).totalApprox, 996, "canceled items leave the list");
  // A cursor whose item is gone continues after its time instead of starting over.
  const first = pageGallery({ limit: 3 });
  setGallery(store.gallery.filter((item) => item.id !== first.items.at(-1).id), { persist: false });
  const next = pageGallery({ limit: 3, cursor: first.nextCursor });
  assert.equal(next.items.some((item) => first.items.some((earlier) => earlier.id === item.id)), false);
});

test("saving a large gallery is compact, runs in the background and reads back", async () => {
  const items = bigGallery(50_000);
  setGallery(items, { persist: false });
  saveGallery();
  let longestPause = 0;
  const started = performance.now();
  let last = started;
  const timer = setInterval(() => {
    const now = performance.now();
    longestPause = Math.max(longestPause, now - last);
    last = now;
  }, 2);
  try {
    await flushGallery();
  } finally {
    clearInterval(timer);
  }
  const total = performance.now() - started;
  const text = fs.readFileSync(galleryPath, "utf8");
  assert.equal(text.includes("\n"), false, "no pretty-printing");
  const saved = JSON.parse(text);
  assert.equal(saved.length, 50_000);
  assert.deepEqual(saved[0], store.gallery[0]);
  // The old synchronous write held the server for the whole file; now no single
  // pause comes near the whole save (on a busy machine both stretch alike).
  assert.ok(longestPause < Math.max(400, total * 0.5), `the server paused ${Math.round(longestPause)} ms of a ${Math.round(total)} ms save`);

  // An older pretty-printed file (how earlier versions saved) still loads.
  fs.writeFileSync(galleryPath, JSON.stringify(saved.slice(0, 3), null, 2));
  assert.deepEqual(JSON.parse(fs.readFileSync(galleryPath, "utf8")).map((item) => item.id), saved.slice(0, 3).map((item) => item.id));
});

test("a save still waiting when the server stops is written before it exits", async () => {
  const child = await import("node:child_process");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-exit-"));
  const script = [
    `const store = await import(${JSON.stringify(new URL("./gallery-store.js", import.meta.url).href)});`,
    "store.setGallery([{ id: 'kept', status: 'done', type: 'image', createdAt: new Date().toISOString() }]);",
    "process.exit(0);"
  ].join("\n");
  child.execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, HEISS_DATA_DIR: dataDir, HEISS_GALLERY_SAVE_MS: "60000" } });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, "gallery.json"), "utf8")).map((item) => item.id), ["kept"]);
  fs.rmSync(dataDir, { recursive: true, force: true });
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

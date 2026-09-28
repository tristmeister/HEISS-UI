import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-leaks-"));
const dataDir = path.join(temporary, "data");
fs.mkdirSync(path.join(dataDir, ".thumbnails"), { recursive: true });
process.env.HEISS_DATA_DIR = dataDir;
process.env.COMFY_URL = "http://127.0.0.1:9";

const view = (filename) => `/comfy/view?${new URLSearchParams({ filename, subfolder: "heiss-ui", type: "output" })}`;
// A marker list as older versions wrote it: output names in the clear.
fs.writeFileSync(path.join(dataDir, "gallery-hidden.json"), JSON.stringify({ [view("image_00007_.png")]: Date.now() }));

const store = await import("./gallery-store.js");
const thumbnails = await import("./thumbnails.js");

test("the list of hidden and deleted outputs no longer says what they were", () => {
  const onDisk = fs.readFileSync(path.join(dataDir, "gallery-hidden.json"), "utf8");
  assert.ok(!onDisk.includes("image_00007_"), "the old readable list was turned into digests");
  assert.ok(!fs.readFileSync(path.join(dataDir, "gallery-hidden.json.bak"), "utf8").includes("image_00007_"), "its backup too");
  const old = { url: view("image_00007_.png"), createdAt: new Date(0).toISOString() };
  assert.equal(store.isGalleryHidden(old), true, "and it still works");

  store.hideGalleryItems([{ url: view("image_00008_.png") }]);
  const after = fs.readFileSync(path.join(dataDir, "gallery-hidden.json"), "utf8");
  assert.ok(!after.includes("image_00008_"));
  assert.equal(store.isGalleryHidden({ url: view("image_00008_.png"), createdAt: new Date(0).toISOString() }), true);
  assert.equal(store.isGalleryHidden({ url: view("image_00009_.png") }), false);
  // Unhiding (or ComfyUI reusing the name) clears it again.
  store.addGalleryItems([{ id: view("image_00008_.png"), url: view("image_00008_.png"), status: "done", createdAt: new Date(0).toISOString() }]);
  assert.equal(store.isGalleryHidden({ url: view("image_00008_.png"), createdAt: new Date(0).toISOString() }), false);
});

test("hiding an image deletes its cached thumbnails, and its upscale's", async () => {
  const cacheName = (filename) => crypto.createHash("sha1").update(`output:heiss-ui:${filename}:768:72`).digest("hex");
  const dir = path.join(dataDir, ".thumbnails");
  for (const name of ["image_00010_.png", "upscale_00010_.png", "image_00011_.png"]) fs.writeFileSync(path.join(dir, `${cacheName(name)}-${"a".repeat(64)}.webp`), "thumb");
  const removed = await thumbnails.forgetItemThumbnails({ url: view("image_00010_.png"), upscale: { url: view("upscale_00010_.png") } });
  assert.equal(removed, 2);
  const left = fs.readdirSync(dir);
  assert.ok(left.some((name) => name.startsWith(cacheName("image_00011_.png"))), "other images keep theirs");
  assert.ok(!left.some((name) => name.startsWith(cacheName("image_00010_.png"))));

  // Images hidden before this cleanup existed: found by name once, on the first unlock.
  fs.writeFileSync(path.join(dir, `${cacheName("image_00012_.png")}-${"b".repeat(64)}.webp`), "thumb");
  assert.equal(thumbnails.forgetLegacyHiddenThumbnails(["image_00012_.png"]), 1);
  fs.writeFileSync(path.join(dir, `${cacheName("image_00013_.png")}-${"c".repeat(64)}.webp`), "thumb");
  assert.equal(thumbnails.forgetLegacyHiddenThumbnails(["image_00013_.png"]), 0, "only once");
});

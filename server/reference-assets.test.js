import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "jai-reference-assets-"));
process.env.JAI_DATA_DIR = temporary;
const referenceAssets = await import(`./reference-assets.js?test=${Date.now()}`);

test("uploaded references are validated, indexed, thumbnailed, and deletable", async () => {
  const buffer = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#223344" } }).png().toBuffer();
  const asset = await referenceAssets.saveUploadedReference({ buffer, name: "sample.png", mime: "image/png" });
  assert.equal(asset.source, "upload");
  assert.equal(asset.width, 32);
  assert.equal(asset.height, 24);
  assert.equal(referenceAssets.listReferenceAssets({}, { source: "upload" }).items.length, 1);
  assert.ok(fs.existsSync(referenceAssets.readUploadedReference(asset.id, "media").file));
  assert.ok(fs.existsSync(referenceAssets.readUploadedReference(asset.id, "thumbnail").file));
  referenceAssets.deleteUploadedReference(asset.id);
  assert.equal(referenceAssets.listReferenceAssets({}, { source: "upload" }).items.length, 0);
});

test("non-image uploads are rejected", async () => {
  await assert.rejects(() => referenceAssets.saveUploadedReference({ buffer: Buffer.from("not an image"), name: "fake.png", mime: "image/png" }));
});

test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

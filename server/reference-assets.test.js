import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-reference-assets-"));
process.env.HEISS_DATA_DIR = temporary;
process.env.COMFY_INPUT_DIR = temporary;
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

test("staging resizes every slot before upload, keeps originals, and names resized copies stably", async (t) => {
  const source = await sharp({ create: { width: 3000, height: 4000, channels: 4, background: { r: 30, g: 60, b: 90, alpha: 0.4 } } }).png().toBuffer();
  const asset = await referenceAssets.saveUploadedReference({ buffer: source, name: "portrait.png", mime: "image/png" });
  const uploads = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const file = init.body.get("image");
    uploads.push({ name: file.name, buffer: Buffer.from(await file.arrayBuffer()) });
    return new Response(JSON.stringify({ name: file.name }), { headers: { "content-type": "application/json" } });
  });
  const refs = [{ slot: "start", assetId: asset.id }, { slot: "reference", assetId: asset.id }];
  const generation = { family: "sdxl", width: 1024, height: 1024 };
  const staged = await referenceAssets.stageReferenceAssets({}, refs, { generation });
  assert.equal(staged.length, 2);
  // Named by the original and the size, so the next run hits ComfyUI's cache; nothing deletes it under another run.
  assert.equal(staged[0].comfyName, staged[1].comfyName);
  assert.match(staged[0].comfyName, /^heiss-ui-reference-[0-9a-f]{32}-\d+x\d+\.png$/);
  for (const item of staged) {
    assert.equal(item.temporary, undefined);
    assert.ok(item.width * item.height <= 1024 ** 2);
    assert.equal(item.width % 8, 0);
    assert.equal(item.height % 8, 0);
  }
  assert.ok((await sharp(uploads[0].buffer).metadata()).hasAlpha);
  assert.deepEqual((await referenceAssets.bytesForReference({}, asset.id)).buffer, source);

  const off = await referenceAssets.stageReferenceAssets({}, refs.slice(0, 1), { generation: { ...generation, autoResizeInputs: false } });
  assert.equal(off[0].temporary, undefined);
  assert.deepEqual(uploads.at(-1).buffer, source);
  await referenceAssets.stageReferenceAssets({}, refs.slice(0, 1));
  assert.deepEqual(uploads.at(-1).buffer, source, "upscale operations keep full resolution");

  const painted = await referenceAssets.stageReferenceAssets({}, refs, { generation: { ...generation, inpaint: { mask: "painted" } } });
  assert.equal(painted[0].temporary, undefined);
  assert.deepEqual(uploads.at(-2).buffer, source, "inpaint source and mask retain their coordinate system");
  assert.ok(painted[1].width * painted[1].height <= 1024 ** 2, "additional references still resize");
  delete process.env.COMFY_INPUT_DIR;
  const remote = await referenceAssets.stageReferenceAssets({}, refs, { generation });
  assert.equal(remote[0].comfyName, staged[0].comfyName, "remote runs use the same stable names");
  assert.equal(remote[0].temporary, undefined);
  const hidden = await referenceAssets.stageReferenceAssets({}, refs, { generation, unique: true });
  assert.notEqual(hidden[0].comfyName, hidden[1].comfyName, "a Hidden run gets its own copies, removed after it");
  assert.equal(hidden[0].temporary, true);
  process.env.COMFY_INPUT_DIR = temporary;
  referenceAssets.deleteUploadedReference(asset.id);
});

test("failed staging removes a Hidden run's already-uploaded copies", async (t) => {
  const buffer = await sharp({ create: { width: 2000, height: 2000, channels: 3, background: "#334455" } }).png().toBuffer();
  const asset = await referenceAssets.saveUploadedReference({ buffer, name: "rollback.png", mime: "image/png" });
  let uploadedFile;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const file = init.body.get("image");
    uploadedFile = path.join(temporary, file.name);
    fs.writeFileSync(uploadedFile, Buffer.from(await file.arrayBuffer()));
    return new Response(JSON.stringify({ name: file.name }), { headers: { "content-type": "application/json" } });
  });
  await assert.rejects(() => referenceAssets.stageReferenceAssets({}, [
    { slot: "start", assetId: asset.id }, { slot: "reference", assetId: "gone" }
  ], { generation: { width: 512, height: 512 }, unique: true }));
  assert.ok(uploadedFile);
  assert.equal(fs.existsSync(uploadedFile), false);
  referenceAssets.deleteUploadedReference(asset.id);
});

test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

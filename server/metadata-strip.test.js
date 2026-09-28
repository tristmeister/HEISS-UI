import assert from "node:assert/strict";
import test from "node:test";
import { stripMetadata } from "./metadata-strip.js";
import { loadSharp } from "./sharp-loader.js";

// CRC-32 as PNG uses it (zlib.crc32 is Node 22+ only).
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const onePixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const prompt = JSON.stringify({ 3: { class_type: "CLIPTextEncode", inputs: { text: "a secret prompt" } } });

test("a ComfyUI PNG loses its prompt and workflow and keeps every pixel", async () => {
  const iend = onePixel.length - 12;
  const withText = Buffer.concat([onePixel.subarray(0, iend), pngChunk("tEXt", Buffer.from(`prompt\0${prompt}`, "latin1")), pngChunk("iTXt", Buffer.from("workflow\0\0\0\0\0{}", "latin1")), onePixel.subarray(iend)]);
  const { buffer, stripped } = stripMetadata(withText);
  assert.equal(stripped, true);
  assert.deepEqual(buffer, onePixel);
  assert.ok(!buffer.includes("a secret prompt"));
  // Nothing there to take out: the same bytes come back.
  assert.equal(stripMetadata(onePixel).stripped, false);
});

test("WebP and JPEG lose EXIF and XMP and still open", async (t) => {
  const sharp = await loadSharp();
  if (!sharp) return t.skip("sharp isn't installed here");
  const exif = { IFD0: { Model: `prompt:${prompt}`, ImageDescription: "a secret prompt" } };
  for (const format of ["webp", "jpeg"]) {
    const input = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#f40" } })[format]().withExif(exif).toBuffer();
    assert.ok(input.includes("a secret prompt"), `${format} fixture carries the prompt`);
    const { buffer, stripped } = stripMetadata(input);
    assert.equal(stripped, true, format);
    assert.ok(!buffer.includes("a secret prompt"), format);
    const meta = await sharp(buffer).metadata();
    assert.equal(meta.width, 8);
    assert.equal(meta.exif, undefined);
  }
});

function box(type, ...children) {
  const body = Buffer.concat(children);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, body]);
}

test("an MP4 keeps its size and layout, with its metadata boxes emptied", () => {
  const video = Buffer.concat([
    box("ftyp", Buffer.from("isom\0\0\x02\0isomiso2mp41", "latin1")),
    box("moov", box("mvhd", Buffer.alloc(20)), box("trak", box("tkhd", Buffer.alloc(12)), box("udta", Buffer.from("track note"))), box("udta", box("meta", Buffer.alloc(4), box("ilst", Buffer.from(`\xa9cmt${prompt}`, "latin1"))))),
    box("mdat", Buffer.from("frames"))
  ]);
  const { buffer, stripped } = stripMetadata(video);
  assert.equal(stripped, true);
  assert.equal(buffer.length, video.length);
  assert.ok(!buffer.includes("a secret prompt"));
  assert.ok(!buffer.includes("track note"));
  assert.equal(buffer.indexOf("mdat"), video.indexOf("mdat"), "the frames stay where the index says");
  assert.ok(buffer.includes("frames"));
});

test("formats it can't clean, and broken files, come back unchanged", () => {
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
  assert.deepEqual(stripMetadata(webm), { buffer: webm, stripped: false, supported: false });
  const truncated = onePixel.subarray(0, 20);
  assert.equal(stripMetadata(truncated).stripped, false);
});

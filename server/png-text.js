import fs from "node:fs";
import zlib from "node:zlib";

/**
 * PNG text chunks, read and written without decoding the image.
 *
 * Reading walks the chunk headers and only loads the text ones (tEXt, zTXt,
 * iTXt) and IHDR, so a 20 MB image costs a few small reads. Writing appends a
 * text chunk before IEND, replacing any earlier chunk with the same keyword.
 */

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// A text chunk bigger than this is not a prompt; skip it rather than load it.
const maxTextChunk = 4 * 1024 * 1024;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(...buffers) {
  let crc = 0xffffffff;
  for (const buffer of buffers) {
    for (let index = 0; index < buffer.length; index += 1) crc = crcTable[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function isPng(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 8 && buffer.subarray(0, 8).equals(signature);
}

/** A text chunk's keyword and value, or null when it is not one this can read. */
function decodeText(type, data) {
  const zero = data.indexOf(0);
  if (zero < 1) return null;
  const keyword = data.subarray(0, zero).toString("latin1");
  try {
    if (type === "tEXt") return { keyword, value: data.subarray(zero + 1).toString("latin1") };
    if (type === "zTXt") return { keyword, value: zlib.inflateSync(data.subarray(zero + 2)).toString("latin1") };
    if (type === "iTXt") {
      const compressed = data[zero + 1] === 1;
      // Language tag and translated keyword, each ended by a zero byte.
      const languageEnd = data.indexOf(0, zero + 3);
      const translatedEnd = languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1);
      if (translatedEnd < 0) return null;
      const body = data.subarray(translatedEnd + 1);
      return { keyword, value: (compressed ? zlib.inflateSync(body) : body).toString("utf8") };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Size and text chunks of a PNG file. Null when the file is not a PNG.
 * `text` maps each keyword to its value (the first one wins).
 */
export function readPngInfo(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const head = Buffer.alloc(8);
    if (fs.readSync(fd, head, 0, 8, 0) !== 8 || !head.equals(signature)) return null;
    const size = fs.fstatSync(fd).size;
    const info = { width: 0, height: 0, text: {} };
    let offset = 8;
    const header = Buffer.alloc(8);
    while (offset + 12 <= size) {
      if (fs.readSync(fd, header, 0, 8, offset) !== 8) break;
      const length = header.readUInt32BE(0);
      const type = header.toString("latin1", 4, 8);
      if (type === "IEND") break;
      if (type === "IHDR" && length >= 8) {
        const dims = Buffer.alloc(8);
        fs.readSync(fd, dims, 0, 8, offset + 8);
        info.width = dims.readUInt32BE(0);
        info.height = dims.readUInt32BE(4);
      } else if ((type === "tEXt" || type === "zTXt" || type === "iTXt") && length <= maxTextChunk) {
        const data = Buffer.alloc(length);
        fs.readSync(fd, data, 0, length, offset + 8);
        const text = decodeText(type, data);
        if (text && !(text.keyword in info.text)) info.text[text.keyword] = text.value;
      }
      offset += 12 + length;
    }
    return info;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(head.subarray(4, 8), data), 0);
  return Buffer.concat([head, data, crc]);
}

/** Plain tEXt when the value is Latin-1, otherwise uncompressed UTF-8 iTXt (as Pillow does). */
function textChunk(keyword, value) {
  const latin = /^[\u0000-ÿ]*$/.test(value);
  if (latin) return chunk("tEXt", Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(value, "latin1")]));
  return chunk("iTXt", Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0, 0, 0, 0, 0]), Buffer.from(value, "utf8")]));
}

/**
 * The same PNG with `keyword` set to `value`: any earlier text chunk with that
 * keyword goes, and the new one sits just before IEND. Null for a non-PNG or a
 * PNG this cannot walk safely.
 */
export function withPngText(buffer, keyword, value) {
  if (!isPng(buffer)) return null;
  const parts = [buffer.subarray(0, 8)];
  let offset = 8;
  let ended = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > buffer.length) return null;
    if (type === "IEND") {
      parts.push(textChunk(keyword, value), buffer.subarray(offset, end));
      ended = true;
      break;
    }
    const replaced = (type === "tEXt" || type === "zTXt" || type === "iTXt") && decodeText(type, buffer.subarray(offset + 8, offset + 8 + length))?.keyword === keyword;
    if (!replaced) parts.push(buffer.subarray(offset, end));
    offset = end;
  }
  return ended ? Buffer.concat(parts) : null;
}

/* ------------------------------------------------------ A1111 parameters */

/**
 * Reads the "parameters" text AUTOMATIC1111, Forge and Civitai use:
 * the prompt, an optional "Negative prompt:" line, then "Key: value, …".
 */
export function parseA1111Parameters(text = "") {
  const source = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!source) return null;
  const lines = source.split("\n");
  let settingsLine = "";
  // The settings line is the last one that starts with "Steps:".
  const last = lines.length - 1;
  if (/^Steps:\s*\d+/.test(lines[last] || "")) settingsLine = lines.pop();
  const body = lines.join("\n");
  const negativeAt = body.search(/(^|\n)Negative prompt:/);
  const prompt = (negativeAt >= 0 ? body.slice(0, negativeAt) : body).trim();
  const negative = negativeAt >= 0 ? body.slice(negativeAt).replace(/^\n?Negative prompt:\s*/, "").trim() : "";
  const settings = {};
  // Values can be quoted (and contain commas) in newer versions.
  for (const match of settingsLine.matchAll(/\s*([\w ][\w ()/.-]*?):\s*("(?:\\.|[^"])*"|[^,]*)(?:,|$)/g)) {
    const key = match[1].trim();
    if (!key) continue;
    settings[key] = match[2].trim().replace(/^"(.*)"$/s, "$1");
  }
  const [width, height] = String(settings.Size || "").split("x").map(Number);
  return {
    prompt,
    negative,
    model: settings.Model || "",
    steps: Number(settings.Steps) || 0,
    sampler: settings.Sampler || "",
    cfg: Number(settings["CFG scale"]) || 0,
    seed: settings.Seed || "",
    width: width || 0,
    height: height || 0
  };
}

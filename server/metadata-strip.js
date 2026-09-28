/**
 * "Share without settings": the same picture or video, minus what ComfyUI
 * wrote inside the file (the prompt, the seed, the whole workflow graph).
 * Nothing is re-encoded; only the metadata blocks are taken out, so the image
 * is bit for bit the same.
 *
 *   PNG   tEXt, zTXt, iTXt and eXIf chunks (ComfyUI's "prompt" and "workflow")
 *   WebP  EXIF and XMP chunks (ComfyUI's animated WebP keeps its graph in EXIF)
 *   JPEG  APP1 (EXIF, XMP), APP13 (IPTC) and comment segments
 *   MP4   udta and meta boxes (and XMP uuid boxes) become empty `free` boxes of
 *         the same size, so every offset in the file stays right
 *
 * Anything else (WebM, GIF, audio) comes back unchanged with stripped: false.
 * A file that does not parse as its type also comes back unchanged.
 */

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngDropped = new Set(["tEXt", "zTXt", "iTXt", "eXIf"]);

function stripPng(input) {
  if (input.length < 8 || !input.subarray(0, 8).equals(pngSignature)) return null;
  const kept = [input.subarray(0, 8)];
  let offset = 8;
  let removed = false;
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > input.length) return null;
    const type = input.toString("latin1", offset + 4, offset + 8);
    if (pngDropped.has(type)) removed = true;
    else kept.push(input.subarray(offset, end));
    offset = end;
    if (type === "IEND") break;
  }
  return removed ? Buffer.concat(kept) : input;
}

function stripWebp(input) {
  if (input.length < 12 || input.toString("latin1", 0, 4) !== "RIFF" || input.toString("latin1", 8, 12) !== "WEBP") return null;
  const kept = [];
  let offset = 12;
  let removed = false;
  while (offset + 8 <= input.length) {
    const type = input.toString("latin1", offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (offset + 8 + size > input.length) return null;
    if (type === "EXIF" || type === "XMP ") {
      removed = true;
    } else {
      const chunk = Buffer.from(input.subarray(offset, Math.min(end, input.length)));
      // VP8X announces which extra chunks follow; say there are none now.
      if (type === "VP8X" && size >= 1) chunk[8] &= ~(0x08 | 0x04);
      kept.push(chunk);
    }
    offset = end;
  }
  if (!removed) return input;
  const body = Buffer.concat(kept);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "latin1");
  return Buffer.concat([header, body]);
}

function stripJpeg(input) {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null;
  const kept = [input.subarray(0, 2)];
  let offset = 2;
  let removed = false;
  while (offset + 4 <= input.length) {
    if (input[offset] !== 0xff) return null;
    const marker = input[offset + 1];
    // Start of scan: the image data follows, and no more metadata segments.
    if (marker === 0xda) {
      kept.push(input.subarray(offset));
      return removed ? Buffer.concat(kept) : input;
    }
    const length = input.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > input.length) return null;
    if (marker === 0xe1 || marker === 0xed || marker === 0xfe) removed = true;
    else kept.push(input.subarray(offset, end));
    offset = end;
  }
  return null;
}

// Boxes that only ever hold other boxes, walked to find udta and meta inside.
const mp4Containers = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "mvex", "moof", "traf"]);
const xmpUuid = "be7acfcb97a942e89c71999491e3afac";

function stripMp4(input) {
  if (input.length < 12 || input.toString("latin1", 4, 8) !== "ftyp") return null;
  const output = Buffer.from(input);
  let removed = false;
  const walk = (start, end, depth) => {
    let offset = start;
    while (offset + 8 <= end) {
      let size = output.readUInt32BE(offset);
      const type = output.toString("latin1", offset + 4, offset + 8);
      let header = 8;
      if (size === 1) {
        if (offset + 16 > end) return false;
        size = Number(output.readBigUInt64BE(offset + 8));
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < header || offset + size > end) return false;
      const isXmp = type === "uuid" && size >= header + 16 && output.toString("hex", offset + header, offset + header + 16) === xmpUuid;
      if (type === "udta" || type === "meta" || isXmp) {
        // Same size, new name, nothing inside: offsets elsewhere in the file stay valid.
        output.write("free", offset + 4, "latin1");
        output.fill(0, offset + header, offset + size);
        removed = true;
      } else if (mp4Containers.has(type) && depth < 8) {
        if (!walk(offset + header, offset + size, depth + 1)) return false;
      }
      offset += size;
    }
    return true;
  };
  if (!walk(0, output.length, 0)) return null;
  return removed ? output : input;
}

/** The kind of file from its first bytes, whatever its name says. */
function sniff(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(pngSignature)) return "png";
  if (buffer.length >= 12 && buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 12 && buffer.toString("latin1", 4, 8) === "ftyp") return "mp4";
  return "";
}

/** { buffer, stripped }: the file without its embedded settings, where the format allows. */
export function stripMetadata(buffer) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const kind = sniff(input);
  const strip = { png: stripPng, webp: stripWebp, jpeg: stripJpeg, mp4: stripMp4 }[kind];
  if (!strip) return { buffer: input, stripped: false, supported: false };
  const result = strip(input);
  return result ? { buffer: result, stripped: result !== input, supported: true } : { buffer: input, stripped: false, supported: false };
}

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { comfyOutputDir } from "./comfy.js";
import { isInside } from "./paths.js";
import { filterVisibleGallery, gallery, outputFileCandidates } from "./gallery-store.js";

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});

/** CRC-32 of `buffer`, continuing from `previous`: zlib's native one where Node has it (20.15+, 22.2+). */
function crc32(buffer, previous = 0) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buffer, previous);
  let value = (previous ^ 0xffffffff) >>> 0;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function dosTime(value) {
  const date = value instanceof Date ? value : new Date();
  const year = Math.max(1980, date.getFullYear());
  return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2), date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() };
}

function safeName(name, fallback) {
  return path.basename(String(name || "")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || fallback;
}

const MAX32 = 0xffffffff;

function zipHeaders(name, size, checksum, offset, time) {
  const encoded = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30 + encoded.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(time.time, 10); local.writeUInt16LE(time.date, 12); local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(size, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(encoded.length, 26); encoded.copy(local, 30);
  // Past 4 GB into the archive, the entry's offset goes in a ZIP64 field instead.
  const far = offset >= MAX32;
  const extra = far ? Buffer.alloc(12) : Buffer.alloc(0);
  if (far) { extra.writeUInt16LE(0x0001, 0); extra.writeUInt16LE(8, 2); extra.writeBigUInt64LE(BigInt(offset), 4); }
  const central = Buffer.alloc(46 + encoded.length + extra.length);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(far ? 45 : 20, 4); central.writeUInt16LE(far ? 45 : 20, 6); central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(time.time, 12); central.writeUInt16LE(time.date, 14); central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(size, 20); central.writeUInt32LE(size, 24); central.writeUInt16LE(encoded.length, 28); central.writeUInt16LE(extra.length, 30);
  central.writeUInt32LE(far ? MAX32 : offset, 42); encoded.copy(central, 46); extra.copy(central, 46 + encoded.length);
  return { local, central };
}

/** The end of the archive, with the ZIP64 records in front when it has more than a plain ZIP can count. */
function zipEnd(count, centralSize, centralOffset) {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Math.min(count, 0xffff), 8); end.writeUInt16LE(Math.min(count, 0xffff), 10);
  end.writeUInt32LE(Math.min(centralSize, MAX32), 12); end.writeUInt32LE(Math.min(centralOffset, MAX32), 16);
  if (count < 0xffff && centralSize < MAX32 && centralOffset < MAX32) return end;
  const zip64 = Buffer.alloc(56);
  zip64.writeUInt32LE(0x06064b50, 0); zip64.writeBigUInt64LE(44n, 4); zip64.writeUInt16LE(45, 12); zip64.writeUInt16LE(45, 14);
  zip64.writeBigUInt64LE(BigInt(count), 24); zip64.writeBigUInt64LE(BigInt(count), 32);
  zip64.writeBigUInt64LE(BigInt(centralSize), 40); zip64.writeBigUInt64LE(BigInt(centralOffset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0); locator.writeBigUInt64LE(BigInt(centralOffset + centralSize), 8); locator.writeUInt32LE(1, 16);
  return Buffer.concat([zip64, locator, end]);
}

/**
 * What goes in the archive, in order, without reading any of it yet: a
 * gallery file is read only when its turn comes, so exporting a gallery of
 * tens of thousands never holds more than one file in memory.
 */
function archiveEntries(privateAssets, includeGallery = true) {
  const entries = [];
  const names = new Set();
  const add = (folder, item, source) => {
    const original = safeName(item.outputName || item.filename, `${item.id || "output"}.png`);
    let name = `${folder}/${original}`;
    let suffix = 2;
    while (names.has(name.toLowerCase())) {
      const ext = path.extname(original);
      name = `${folder}/${path.basename(original, ext)}-${suffix}${ext}`;
      suffix += 1;
    }
    names.add(name.toLowerCase());
    entries.push({ name, ...source, createdAt: item.createdAt });
  };
  const base = comfyOutputDir ? path.resolve(comfyOutputDir) : "";
  for (const item of includeGallery ? filterVisibleGallery(gallery) : []) {
    if (item.status !== "done" || !base) continue;
    const file = outputFileCandidates(item).map((candidate) => path.resolve(candidate)).find((resolved) => {
      if (!isInside(base, resolved, { orSame: true })) return false;
      try { return fs.statSync(resolved).isFile(); } catch { return false; }
    });
    if (file) add("gallery", item, { file });
  }
  for (const asset of privateAssets) add(includeGallery ? "private" : "hidden", asset.item, { buffer: asset.buffer });
  return entries;
}

/** A file's size and CRC, read through once in chunks; null if it can't be read. */
async function measure(file) {
  let size = 0;
  let checksum = 0;
  try {
    for await (const chunk of fs.createReadStream(file)) { size += chunk.length; checksum = crc32(chunk, checksum); }
  } catch {
    return null;
  }
  return { size, checksum };
}

/**
 * Streams a stored (uncompressed: images and videos don't shrink) ZIP of the
 * gallery to `res`, one file at a time, never written faster than the
 * browser takes it. The header comes first and needs the CRC, so a file too
 * big to hold is read twice, the second time usually from the system's cache.
 */
export async function sendGalleryExport(res, privateAssets = [], { gallery: includeGallery = true } = {}) {
  let closed = false;
  res.on("close", () => { closed = true; });
  const write = (chunk) => new Promise((resolve) => {
    if (res.write(chunk) || closed) { resolve(); return; }
    const done = () => { res.off("drain", done); res.off("close", done); resolve(); };
    res.on("drain", done);
    res.on("close", done);
  });
  try {
    const central = [];
    let offset = 0;
    for (const entry of archiveEntries(privateAssets, includeGallery)) {
      if (closed) return;
      // Most files are read once, into memory, and checked from that copy; a
      // big one (a video) is read through for its CRC and then streamed. A file
      // that disappears or changes size during the export is left out.
      let body = entry.buffer;
      let measured = null;
      if (!body) {
        try {
          const { size } = await fs.promises.stat(entry.file);
          if (size <= 16 * 1024 * 1024) body = await fs.promises.readFile(entry.file);
          else measured = await measure(entry.file);
        } catch { continue; }
      }
      if (body) measured = { size: body.length, checksum: crc32(body) };
      if (!measured || measured.size >= MAX32) continue;
      const headers = zipHeaders(entry.name, measured.size, measured.checksum, offset, dosTime(new Date(entry.createdAt || Date.now())));
      await write(headers.local);
      if (body) await write(body);
      else {
        let sent = 0;
        for await (const chunk of fs.createReadStream(entry.file, { end: Math.max(0, measured.size - 1) })) {
          if (closed) return;
          sent += chunk.length;
          await write(chunk);
        }
        // Shrunk after measuring: the archive can't be repaired from here.
        if (sent !== measured.size) { res.destroy(); return; }
      }
      central.push(headers.central);
      offset += headers.local.length + measured.size;
    }
    const centralSize = central.reduce((size, record) => size + record.length, 0);
    for (const record of central) await write(record);
    res.end(zipEnd(central.length, centralSize, offset));
  } catch {
    res.destroy();
  }
}

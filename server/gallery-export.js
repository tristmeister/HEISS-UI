import fs from "node:fs";
import path from "node:path";
import { comfyOutputDir } from "./comfy.js";
import { filterVisibleGallery, gallery, outputFileCandidates } from "./gallery-store.js";

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
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

function zipHeaders(name, size, checksum, offset, time) {
  const encoded = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30 + encoded.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(time.time, 10); local.writeUInt16LE(time.date, 12); local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(size, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(encoded.length, 26); encoded.copy(local, 30);
  const central = Buffer.alloc(46 + encoded.length);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(time.time, 12); central.writeUInt16LE(time.date, 14); central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(size, 20); central.writeUInt32LE(size, 24); central.writeUInt16LE(encoded.length, 28); central.writeUInt32LE(offset, 42); encoded.copy(central, 46);
  return { local, central };
}

function archiveEntries(privateAssets) {
  const entries = [];
  const names = new Set();
  const add = (folder, item, buffer) => {
    const original = safeName(item.outputName || item.filename, `${item.id || "output"}.png`);
    let name = `${folder}/${original}`;
    let suffix = 2;
    while (names.has(name.toLowerCase())) {
      const ext = path.extname(original);
      name = `${folder}/${path.basename(original, ext)}-${suffix}${ext}`;
      suffix += 1;
    }
    names.add(name.toLowerCase());
    entries.push({ name, buffer, createdAt: item.createdAt });
  };
  for (const item of filterVisibleGallery(gallery)) {
    if (item.status !== "done") continue;
    const base = comfyOutputDir ? path.resolve(comfyOutputDir) : "";
    const file = outputFileCandidates(item).find((candidate) => {
      const resolved = path.resolve(candidate);
      if (!base || (resolved !== base && !resolved.startsWith(`${base}${path.sep}`))) return false;
      try { return fs.statSync(resolved).isFile(); } catch { return false; }
    });
    if (!file) continue;
    try { add("gallery", item, fs.readFileSync(file)); } catch { /* Skip files that disappear during export. */ }
  }
  for (const asset of privateAssets) add("private", asset.item, asset.buffer);
  return entries;
}

export function sendGalleryExport(res, privateAssets = []) {
  const entries = archiveEntries(privateAssets);
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const headers = zipHeaders(entry.name, entry.buffer.length, crc32(entry.buffer), offset, dosTime(new Date(entry.createdAt || Date.now())));
    res.write(headers.local); res.write(entry.buffer); central.push(headers.central); offset += headers.local.length + entry.buffer.length;
  }
  const centralSize = central.reduce((size, record) => size + record.length, 0);
  for (const record of central) res.write(record);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  res.end(end);
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { comfyUrl } from "./comfy.js";
import { dataDir } from "./gallery-store.js";

// Small on-demand cache of downscaled previews for the gallery grid, so a LAN client
// only has to pull a full-resolution image when it actually opens the viewer.
const thumbnailDir = path.join(dataDir, ".thumbnails");
const longestEdge = 768;
const quality = 72;
const pending = new Map();

// Folding the resize settings into the key means changing longestEdge/quality
// naturally starts a fresh cache generation instead of serving stale-sized files.
function cacheKey(filename, subfolder, type) {
  return crypto.createHash("sha1").update(`${type}:${subfolder}:${filename}:${longestEdge}:${quality}`).digest("hex");
}

function cachePath(key, sourceHash) {
  return path.join(thumbnailDir, `${key}-${sourceHash}.webp`);
}

async function build(filename, subfolder, type) {
  const params = new URLSearchParams({ filename, subfolder, type });
  // ComfyUI installations do not consistently provide a useful ETag, and a
  // reused filename can therefore otherwise receive an unrelated old preview.
  const response = await fetch(`${comfyUrl}/view?${params}`);
  if (!response.ok) return null;
  const source = Buffer.from(await response.arrayBuffer());
  const sourceHash = crypto.createHash("sha256").update(source).digest("hex");
  const key = cacheKey(filename, subfolder, type);
  const file = cachePath(key, sourceHash);
  if (fs.existsSync(file)) return { file, etag: `\"${sourceHash}\"` };
  const resized = await sharp(source)
    .resize({ width: longestEdge, height: longestEdge, fit: "inside", withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();

  fs.mkdirSync(thumbnailDir, { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, resized);
  fs.renameSync(temp, file);
  // Best-effort: drop any earlier cached thumbnail for this resource under a stale ETag.
  for (const entry of fs.readdirSync(thumbnailDir)) {
    if (entry.startsWith(`${key}-`) && path.join(thumbnailDir, entry) !== file) {
      fs.unlink(path.join(thumbnailDir, entry), () => {});
    }
  }
  return { file, etag: `\"${sourceHash}\"` };
}

// Concurrent requests for the same not-yet-cached image share one build instead of
// each downloading and resizing the source independently.
export async function getThumbnail(filename, subfolder, type) {
  const dedupeKey = `${type}:${subfolder}:${filename}`;
  if (pending.has(dedupeKey)) return pending.get(dedupeKey);
  const promise = build(filename, subfolder, type).finally(() => pending.delete(dedupeKey));
  pending.set(dedupeKey, promise);
  return promise;
}

// Vault assets are decrypted per request and must never leave a plaintext
// derivative on disk, so this resizes in memory only — nothing is cached.
export async function resizeInMemory(buffer, mime) {
  if (!mime?.startsWith("image/") || mime === "image/svg+xml") return null;
  try {
    return await sharp(buffer)
      .resize({ width: longestEdge, height: longestEdge, fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();
  } catch {
    return null;
  }
}

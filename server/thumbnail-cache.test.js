import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.HEISS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-thumbs-"));
const { sweepThumbnails } = await import("./thumbnails.js");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-thumb-cache-"));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const hour = 60 * 60 * 1000;
function thumbnail(name, bytes, usedHoursAgo, now) {
  const file = path.join(dir, `${name}.webp`);
  fs.writeFileSync(file, Buffer.alloc(bytes));
  const when = new Date(now - usedHoursAgo * hour);
  fs.utimesSync(file, when, when);
  return file;
}

test("an oversized cache loses the thumbnails used longest ago, down to 80%", async () => {
  const now = Date.now();
  for (let index = 0; index < 10; index += 1) thumbnail(`old-${index}`, 1000, 100 - index, now);
  const result = await sweepThumbnails({ dir, limitBytes: 6000, now });
  assert.equal(result.removed, 6, "10 kB down to 4.8 kB takes six of the ten");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["old-6.webp", "old-7.webp", "old-8.webp", "old-9.webp"]);
  assert.equal(result.totalBytes, 4000);
});

test("thumbnails served recently stay, even when the cache is still over", async () => {
  for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name));
  const now = Date.now();
  thumbnail("stale", 1000, 48, now);
  thumbnail("on-screen-1", 1000, 0.05, now);
  thumbnail("on-screen-2", 1000, 0.1, now);
  const result = await sweepThumbnails({ dir, limitBytes: 1000, now });
  assert.equal(result.removed, 1);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["on-screen-1.webp", "on-screen-2.webp"]);
});

test("a cache under its cap, or none at all, is left alone", async () => {
  assert.equal((await sweepThumbnails({ dir, limitBytes: 1e9 })).removed, 0);
  assert.equal((await sweepThumbnails({ dir: path.join(dir, "missing"), limitBytes: 1 })).removed, 0);
  fs.writeFileSync(path.join(dir, "notes.txt"), Buffer.alloc(5000));
  assert.equal((await sweepThumbnails({ dir, limitBytes: 2000, now: Date.now() })).removed, 0, "only thumbnails count, and these are in use");
  assert.equal(fs.existsSync(path.join(dir, "notes.txt")), true);
});

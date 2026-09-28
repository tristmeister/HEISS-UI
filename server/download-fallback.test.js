import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-download-fallback-"));
process.env.HEISS_COMFY_ROOT = path.join(scratch, "ComfyUI");
fs.mkdirSync(path.join(scratch, "ComfyUI", "models", "text_encoders"), { recursive: true });
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { downloadState, setDownloadTransport, startDownload } = await import("./model-downloads.js");
const { catalogDownload, downloadSource } = await import("./family-profiles.js");

const spec = (file, extra = {}) => ({ id: `encoder:test:${file}`, file, folder: "text_encoders", label: "Test encoder", url: `https://huggingface.co/x/y/resolve/main/${file}`, bytes: 10, ...extra });

async function settle(file) {
  for (let i = 0; i < 200; i += 1) {
    const done = downloadState().recent.find((item) => item.file === file && item.status !== "queued");
    if (done) return done;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("download never finished");
}

test("a catalog entry carries the other builds of its part, and who publishes each", () => {
  const first = catalogDownload("encoder:qwen3_4b:0");
  assert.equal(first.alternatives.length, 1);
  assert.equal(first.alternatives[0].id, "encoder:qwen3_4b:1");
  assert.equal(catalogDownload("encoder:qwen3_4b:1").alternatives.length, 0);
  assert.equal(catalogDownload("encoder:qwen3_4b:x"), null);
  assert.deepEqual(downloadSource(first.alternatives[0].url), { source: "Comfy-Org", repo: "Comfy-Org/z_image_turbo" });
});

test("a build gone from its address falls back to the next one by itself", async () => {
  setDownloadTransport(async (entry, _signal, { targetFor, finishDownload, finalError }) => {
    if (entry.file === "gone.safetensors") throw finalError(`${entry.file} is no longer at its download address (HTTP 404).`);
    const { partial, target, note } = targetFor(entry);
    fs.writeFileSync(partial, "0123456789");
    finishDownload(entry, partial, target, note);
  });
  startDownload(spec("gone.safetensors", { alternatives: [spec("next.safetensors")] }));
  const done = await settle("next.safetensors");
  assert.equal(done.status, "done");
  const gone = downloadState().recent.find((item) => item.file === "gone.safetensors");
  assert.equal(gone.fellBackTo, "next.safetensors");
  assert.equal(gone.alternatives, undefined, "the list stays on the server");
});

test("a gated build falls back too, but a full disk does not", async () => {
  setDownloadTransport(async (entry, _signal, { targetFor, finishDownload, finalError }) => {
    if (entry.file === "gated.safetensors") throw finalError("needs a login", { browser: true });
    if (entry.file === "full.safetensors") throw finalError("Not enough space");
    const { partial, target, note } = targetFor(entry);
    fs.writeFileSync(partial, "0123456789");
    finishDownload(entry, partial, target, note);
  });
  startDownload(spec("gated.safetensors", { alternatives: [spec("open.safetensors")] }));
  assert.equal((await settle("open.safetensors")).status, "done");
  startDownload(spec("full.safetensors", { alternatives: [spec("other.safetensors")] }));
  const full = await settle("full.safetensors");
  assert.equal(full.status, "error");
  assert.equal(full.fellBackTo, undefined);
  setDownloadTransport(null);
});

test("the download state says how much space each folder's disk has", () => {
  const space = downloadState().space;
  assert.ok(space.text_encoders.free > 0);
  assert.ok(space.text_encoders.disk);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-downloads-"));
process.env.HEISS_COMFY_ROOT = path.join(scratch, "ComfyUI");
fs.mkdirSync(path.join(scratch, "ComfyUI", "models", "vae"), { recursive: true });

const { downloadState, isNetworkError, repositoryPage, setDownloadTransport, startDownload } = await import("./model-downloads.js");

const spec = (file) => ({ id: `vae:test:${file}`, file, folder: "vae", label: "Test VAE", url: "https://huggingface.co/x/resolve/main/a.safetensors", bytes: 10 });

async function settle(file) {
  for (let i = 0; i < 200; i += 1) {
    const done = downloadState().recent.find((item) => item.file === file);
    if (done) return done;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("download never finished");
}

test("network drops are told apart from answers", () => {
  assert.equal(isNetworkError(new TypeError("terminated")), true);
  assert.equal(isNetworkError(Object.assign(new Error("read"), { code: "ECONNRESET" })), true);
  assert.equal(isNetworkError(new Error("Hugging Face answered 500 for a.safetensors.")), false);
});

test("a dropped connection is retried by itself and finishes", async () => {
  let tries = 0;
  setDownloadTransport(async (entry, _signal, { targetFor, finishDownload }) => {
    tries += 1;
    if (tries === 1) throw new TypeError("terminated");
    const { partial, target, note } = targetFor(entry);
    fs.writeFileSync(partial, "0123456789");
    finishDownload(entry, partial, target, note);
  });
  startDownload(spec("drop.safetensors"));
  const done = await settle("drop.safetensors");
  assert.equal(done.status, "done");
  assert.equal(tries, 2);
});

test("a gated file stops at once and points to the browser", async () => {
  setDownloadTransport(async (entry, _signal, { finalError }) => {
    throw finalError(`${entry.file} needs a Hugging Face login`, { browser: true });
  });
  startDownload(spec("gated.safetensors"));
  const failed = await settle("gated.safetensors");
  assert.deepEqual([failed.status, failed.retryable, failed.needsBrowser], ["error", false, true]);
  setDownloadTransport(null);
});

test("a file gone from its address says to update, and where to look by hand", async () => {
  setDownloadTransport(null);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Entry not found", { status: 404 });
  try {
    startDownload({ ...spec("moved.safetensors"), url: "https://huggingface.co/Comfy-Org/some_repo/resolve/main/split_files/vae/moved.safetensors" });
    const failed = await settle("moved.safetensors");
    assert.equal(failed.status, "error");
    assert.equal(failed.retryable, false);
    const message = JSON.stringify(failed);
    assert.match(message, /Update HEISS UI under Settings › About/);
    assert.match(message, /https:\/\/huggingface\.co\/Comfy-Org\/some_repo and put it in ComfyUI’s vae folder/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(repositoryPage("https://huggingface.co/x/resolve/main/a.safetensors"), "", "not a repository address");
});

test("a file fetched before a restart reads as on disk, not as a new download", async () => {
  const { catalogDownloadsForFile } = await import("./family-profiles.js");
  const file = "sdxl_vae.safetensors";
  assert.equal(catalogDownloadsForFile(file, "vae")[0].onDisk, undefined);
  fs.writeFileSync(path.join(scratch, "ComfyUI", "models", "vae", file), "x");
  assert.equal(catalogDownloadsForFile(file, "vae")[0].onDisk, true);
});

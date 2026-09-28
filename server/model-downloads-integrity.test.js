import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-integrity-"));
process.env.HEISS_COMFY_ROOT = path.join(scratch, "ComfyUI");
const vaeDir = path.join(scratch, "ComfyUI", "models", "vae");
fs.mkdirSync(vaeDir, { recursive: true });

// A stand-in for Hugging Face: one file whose content (and ETag) can change,
// honouring Range and If-Range, or ignoring If-Range when told to.
const remote = { body: Buffer.from("0123456789"), etag: '"v1"', ignoreIfRange: false, requests: [] };
globalThis.fetch = async (_url, options = {}) => {
  const headers = options.headers || {};
  remote.requests.push({ range: headers.range || "", ifRange: headers["if-range"] || "" });
  const range = /bytes=(\d+)-/.exec(headers.range || "");
  const stillSame = !headers["if-range"] || headers["if-range"] === remote.etag || remote.ignoreIfRange;
  if (range && stillSame) {
    const start = Number(range[1]);
    const rest = remote.body.subarray(start);
    return new Response(rest, { status: 206, headers: { etag: remote.etag, "content-length": String(rest.length), "content-range": `bytes ${start}-${remote.body.length - 1}/${remote.body.length}` } });
  }
  return new Response(remote.body, { status: 200, headers: { etag: remote.etag, "content-length": String(remote.body.length) } });
};

const { downloadState, resumeValidator, startDownload } = await import("./model-downloads.js");
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const spec = (file, sha256) => ({ id: `vae:test:${file}`, file, folder: "vae", label: "Test VAE", url: "https://huggingface.co/x/resolve/main/a.safetensors", bytes: 10, sha256 });

async function settle(file) {
  for (let i = 0; i < 200; i += 1) {
    const done = downloadState().recent.find((item) => item.file === file);
    if (done) return done;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("download never finished");
}

function halfDone(file, content, note) {
  fs.writeFileSync(path.join(vaeDir, `${file}.part`), content);
  fs.writeFileSync(path.join(vaeDir, `${file}.part.json`), JSON.stringify({ id: `vae:test:${file}`, label: "Test VAE", totalBytes: 10, exact: true, ...note }));
}

test("a file that matches its published SHA-256 lands where ComfyUI reads it", async () => {
  startDownload(spec("good.safetensors", sha("0123456789")));
  const done = await settle("good.safetensors");
  assert.equal(done.status, "done", done.error);
  assert.equal(fs.readFileSync(path.join(vaeDir, "good.safetensors"), "utf8"), "0123456789");
});

test("a file that doesn't match is thrown away, never put in place", async () => {
  startDownload(spec("bad.safetensors", sha("something else")));
  const failed = await settle("bad.safetensors");
  assert.equal(failed.status, "error");
  assert.match(failed.error, /didn’t match its published checksum/);
  assert.equal(failed.retryable, true);
  assert.equal(fs.existsSync(path.join(vaeDir, "bad.safetensors")), false);
  assert.equal(fs.existsSync(path.join(vaeDir, "bad.safetensors.part")), false);
});

test("resuming the same file asks for the rest only if it is still that file", async () => {
  remote.requests = [];
  halfDone("same.safetensors", "01234", { etag: '"v1"' });
  startDownload(spec("same.safetensors", sha("0123456789")));
  assert.equal((await settle("same.safetensors")).status, "done");
  assert.deepEqual(remote.requests[0], { range: "bytes=5-", ifRange: '"v1"' });
  assert.equal(fs.readFileSync(path.join(vaeDir, "same.safetensors"), "utf8"), "0123456789");
});

test("a file changed on the server in between starts over instead of being glued together", async () => {
  remote.body = Buffer.from("ABCDEFGHIJ");
  remote.etag = '"v2"';
  halfDone("changed.safetensors", "01234", { etag: '"v1"' });
  startDownload(spec("changed.safetensors", sha("ABCDEFGHIJ")));
  assert.equal((await settle("changed.safetensors")).status, "done");
  assert.equal(fs.readFileSync(path.join(vaeDir, "changed.safetensors"), "utf8"), "ABCDEFGHIJ");

  // A server that ignores If-Range still gives itself away by its ETag.
  remote.ignoreIfRange = true;
  remote.body = Buffer.from("KLMNOPQRST");
  remote.etag = '"v3"';
  halfDone("ignored.safetensors", "ABCDE", { etag: '"v2"' });
  startDownload(spec("ignored.safetensors", sha("KLMNOPQRST")));
  assert.equal((await settle("ignored.safetensors")).status, "done");
  assert.equal(fs.readFileSync(path.join(vaeDir, "ignored.safetensors"), "utf8"), "KLMNOPQRST");
});

test("If-Range uses a strong ETag, else the date, and nothing for notes from before", () => {
  assert.equal(resumeValidator({ etag: '"abc"', lastModified: "Mon, 01 Jan 2024 00:00:00 GMT" }), '"abc"');
  assert.equal(resumeValidator({ etag: 'W/"abc"', lastModified: "Mon, 01 Jan 2024 00:00:00 GMT" }), "Mon, 01 Jan 2024 00:00:00 GMT");
  assert.equal(resumeValidator({}), "");
});

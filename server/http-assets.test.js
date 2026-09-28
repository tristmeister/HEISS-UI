import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { compressJson, pickEncoding, serveApp } from "./http-assets.js";
import { precompressDir } from "../scripts/precompress.mjs";

const dist = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-dist-"));
const script = `console.log(${JSON.stringify("heiss ".repeat(2000))});`;
fs.mkdirSync(path.join(dist, "assets"));
fs.writeFileSync(path.join(dist, "index.html"), `<!doctype html><title>HEISS</title>${"<!-- page -->".repeat(200)}`);
fs.writeFileSync(path.join(dist, "assets", "index-abc123.js"), script);
fs.writeFileSync(path.join(dist, "assets", "tiny-abc.css"), "a{}");
fs.writeFileSync(path.join(dist, "favicon.svg"), "<svg/>");

let server;
let base;
test.before(async () => {
  assert.equal(precompressDir(dist), 2, "the page and the script; tiny files are left alone");
  const app = express();
  app.use(compressJson({ skip: (req) => req.headers["x-local"] === "1" }));
  app.get("/api/big", (_req, res) => res.json({ items: Array.from({ length: 400 }, (_, index) => ({ id: index, prompt: "a lighthouse in fog" })) }));
  app.get("/api/small", (_req, res) => res.json({ ok: true }));
  serveApp(app, dist);
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server?.close();
  fs.rmSync(dist, { recursive: true, force: true });
});

// fetch decodes by itself; these read the raw bytes to see what went over the wire.
async function raw(pathname, headers = {}) {
  const http = await import("node:http");
  return new Promise((resolve, reject) => {
    http.get(`${base}${pathname}`, { headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
}

test("the browser's accepted encodings pick brotli first, and q=0 means no", () => {
  assert.equal(pickEncoding("gzip, deflate, br"), "br");
  assert.equal(pickEncoding("gzip"), "gzip");
  assert.equal(pickEncoding("br;q=0, gzip;q=0.5"), "gzip");
  assert.equal(pickEncoding("*"), "br");
  assert.equal(pickEncoding("identity"), "");
  assert.equal(pickEncoding(""), "");
  assert.equal(pickEncoding("br", ["gzip"]), "", "only what is on offer");
});

test("a hashed script goes out precompressed and cached for good", async () => {
  const br = await raw("/assets/index-abc123.js", { "accept-encoding": "br, gzip" });
  assert.equal(br.status, 200);
  assert.equal(br.headers["content-encoding"], "br");
  assert.match(br.headers["content-type"], /javascript/);
  assert.match(br.headers["cache-control"], /immutable/);
  assert.match(br.headers.vary, /Accept-Encoding/);
  assert.equal(zlib.brotliDecompressSync(br.body).toString(), script);
  assert.ok(br.body.length < script.length / 4);

  const gz = await raw("/assets/index-abc123.js", { "accept-encoding": "gzip" });
  assert.equal(gz.headers["content-encoding"], "gzip");
  assert.equal(zlib.gunzipSync(gz.body).toString(), script);

  const plain = await raw("/assets/index-abc123.js");
  assert.equal(plain.headers["content-encoding"], undefined);
  assert.equal(plain.body.toString(), script);
  assert.match(plain.headers["cache-control"], /immutable/);
});

test("the page itself is always checked again, and unknown paths get the page", async () => {
  const page = await raw("/", { "accept-encoding": "br" });
  assert.equal(page.status, 200);
  assert.equal(page.headers["cache-control"], "no-cache");
  const deep = await raw("/some/client/route");
  assert.equal(deep.status, 200);
  assert.equal(deep.headers["cache-control"], "no-cache");
  assert.match(deep.body.toString(), /<title>HEISS<\/title>/);
  const small = await raw("/assets/tiny-abc.css", { "accept-encoding": "br" });
  assert.equal(small.headers["content-encoding"], undefined, "no copy was made for a tiny file");
  assert.equal(small.body.toString(), "a{}");
});

test("paths outside the app folder are not served", async () => {
  const outside = await raw("/..%2f..%2fetc%2fpasswd.js", { "accept-encoding": "br" });
  assert.notEqual(outside.headers["content-encoding"], "br");
});

test("large JSON answers are compressed for other devices, small ones and this computer's are not", async () => {
  const big = await raw("/api/big", { "accept-encoding": "gzip, br" });
  assert.equal(big.headers["content-encoding"], "br");
  assert.match(big.headers["content-type"], /application\/json/);
  assert.equal(JSON.parse(zlib.brotliDecompressSync(big.body).toString()).items.length, 400);

  const local = await raw("/api/big", { "accept-encoding": "br", "x-local": "1" });
  assert.equal(local.headers["content-encoding"], undefined);
  assert.equal(JSON.parse(local.body.toString()).items.length, 400);

  const small = await raw("/api/small", { "accept-encoding": "br" });
  assert.equal(small.headers["content-encoding"], undefined);
  assert.deepEqual(JSON.parse(small.body.toString()), { ok: true });
});

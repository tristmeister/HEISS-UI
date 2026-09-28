import express from "express";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { isInside } from "./paths.js";

/**
 * Serving the built app, and keeping what goes over the network small.
 *
 * - Scripts and styles: the build writes brotli and gzip copies next to them
 *   (scripts/precompress.mjs). A browser that accepts one gets it, with no
 *   compression work per request. A dist/ built without them is sent as is.
 * - Vite names everything in dist/assets after its content, so those files
 *   never change under the same name and are cached for a year. The page
 *   itself (index.html) is always checked again, so an update shows at once.
 * - JSON answers (gallery pages, model lists) are compressed as they are sent,
 *   for other devices only: on this computer it would only cost time.
 */

const compressible = /\.(?:js|mjs|css|html|svg|json|webmanifest|txt|map|wasm)$/i;
const immutable = "public, max-age=31536000, immutable";
const revalidate = "no-cache";

/**
 * The best encoding the browser accepts out of `available` ("br" before
 * "gzip"), or "" for none. Honours `q=0` ("not this one") and `*`.
 */
export function pickEncoding(acceptEncoding = "", available = ["br", "gzip"]) {
  const accepted = new Map();
  for (const part of String(acceptEncoding || "").split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (!name) continue;
    const q = params.map((param) => param.trim().match(/^q=([\d.]+)$/)).find(Boolean);
    accepted.set(name, q ? Number(q[1]) : 1);
  }
  const quality = (encoding) => (accepted.has(encoding) ? accepted.get(encoding) : accepted.get("*") ?? 0);
  return available.find((encoding) => quality(encoding) > 0) || "";
}

const cacheControlFor = (dist, file) => (isInside(path.join(dist, "assets"), file) ? immutable : revalidate);

/** The built app from `dist`, precompressed copies first, then the page for every other path. */
export function serveApp(app, dist) {
  const root = path.resolve(dist);
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let relative;
    try { relative = decodeURIComponent(req.path); } catch { return next(); }
    if (!compressible.test(relative)) return next();
    const file = path.resolve(root, `.${relative}`);
    if (!isInside(root, file)) return next();
    const encoding = pickEncoding(req.headers["accept-encoding"], ["br", "gzip"].filter((name) => fs.existsSync(`${file}${name === "br" ? ".br" : ".gz"}`)));
    // Whatever this answer is, a cache must keep the encodings apart.
    res.append("Vary", "Accept-Encoding");
    if (!encoding || !fs.existsSync(file)) return next();
    res.setHeader("Content-Encoding", encoding);
    res.setHeader("Cache-Control", cacheControlFor(root, file));
    res.type(path.extname(file));
    res.sendFile(`${file}${encoding === "br" ? ".br" : ".gz"}`, { cacheControl: false, dotfiles: "allow" }, (error) => {
      if (!error) return;
      // Gone between the check and the send (a rebuild): fall back to the file itself.
      if (!res.headersSent) {
        res.removeHeader("Content-Encoding");
        next();
      }
    });
  });
  app.use(express.static(root, {
    cacheControl: false,
    setHeaders: (res, file) => res.setHeader("Cache-Control", cacheControlFor(root, file))
  }));
  // A built file that is not there (a page from before an update asking for an
  // old hash) is missing, not the app page: HTML in place of a script fails obscurely.
  app.get("/assets/*splat", (_req, res) => res.status(404).setHeader("Cache-Control", revalidate).end());
  app.get("*splat", (_req, res) => res.sendFile(path.join(root, "index.html"), { cacheControl: false, dotfiles: "allow", headers: { "Cache-Control": revalidate } }));
}

/**
 * Compresses `res.json` answers of at least `minBytes` for browsers that
 * accept it. `skip(req)` leaves a request alone (this computer's own browser).
 */
export function compressJson({ minBytes = 1024, skip = () => false } = {}) {
  return (req, res, next) => {
    const encoding = pickEncoding(req.headers["accept-encoding"]);
    if (!encoding || skip(req)) return next();
    const send = res.json.bind(res);
    res.json = (body) => {
      const text = JSON.stringify(body);
      if (text === undefined || text.length < minBytes || res.getHeader("Content-Encoding")) return send(body);
      const compressed = encoding === "br"
        // A low quality level: fast enough to run per request, most of the size win.
        ? zlib.brotliCompressSync(text, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: text.length } })
        : zlib.gzipSync(text, { level: 6 });
      res.setHeader("Content-Encoding", encoding);
      res.append("Vary", "Accept-Encoding");
      if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.send(compressed);
    };
    next();
  };
}

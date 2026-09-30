#!/usr/bin/env node
/**
 * The website on this computer, with the feedback board's API: `npm run site`.
 * Posts live in memory until you stop it. `--demo` starts with a few example
 * posts; the admin password is BOARD_ADMIN_PASSWORD, or "admin" here.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handle } from "../docs/api/_board/core.js";
import { memoryStore } from "../docs/api/_board/store.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs");
const port = Number(process.env.PORT) || 4321;
const env = { ...process.env, BOARD_ADMIN_PASSWORD: process.env.BOARD_ADMIN_PASSWORD || "admin" };
const store = memoryStore();

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".otf": "font/otf", ".mp4": "video/mp4", ".gif": "image/gif", ".xml": "application/xml", ".txt": "text/plain" };

async function seed() {
  const day = 86_400_000;
  const now = Date.now();
  const posts = [
    { type: "bug", title: "Upscale compare slider jumps back on touch devices", body: "On an iPad, dragging the compare slider snaps back to the middle as soon as I let go.", name: "Mara", status: "progress", age: 2, votes: 6, comments: ["Same on Android, Chrome 131.", "Found it, a pointer capture that ends too early. Fix is on its way."] },
    { type: "bug", title: "Model folders dialog forgets a second path after a restart", body: "I add D:\\Models as a second folder, it scans fine, and after restarting HEISS UI only the first one is left.", name: "tobi_k", status: "open", age: 1, votes: 3, setup: "HEISS UI 0.14.0 (release)\nNode.js 22.12.0\nSystem: Windows 11 Pro, x64, 32.0 GB RAM\nComfyUI 0.3.40, on this computer; Python 3.12.7, PyTorch 2.5.1+cu124, portable\nGPU: NVIDIA GeForce RTX 4070 [cuda], 12.0 GB VRAM", source: "app", appVersion: "0.14.0" },
    { type: "bug", title: "Generation failed: Allocation on device", body: "Flux.2 at 1536 × 1536 runs out of memory on 12 GB, even with Free memory and try again.", name: "", status: "planned", age: 4, votes: 4, source: "app", appVersion: "0.14.0" },
    { type: "bug", title: "Prompt history skips starred prompts with ↑", body: "", name: "Jun", status: "done", release: "v0.14.0", age: 12, votes: 5 },
    { type: "idea", title: "Queue prompts from a text file, one per line", body: "Drop a .txt on the composer and it runs every line with the current settings.", name: "Ahmed", status: "progress", age: 30, votes: 22, comments: ["Would love this for testing LoRAs across a prompt set."] },
    { type: "idea", title: "Side-by-side compare for two models with the same seed", body: "Pick two models, one prompt and one seed, and see the pair next to each other.", name: "lena.r", status: "planned", age: 9, votes: 14 },
    { type: "idea", title: "Keyboard shortcut to toggle Hidden", body: "Something like ⌘⇧H to lock Hidden and jump back to the studio.", name: "", status: "open", age: 3, votes: 7 },
    { type: "idea", title: "Remember the aspect ratio per model", body: "SDXL at portrait, Flux at square: switching models should bring back the last one.", name: "petr", status: "open", age: 0.3, votes: 2 },
    { type: "idea", title: "Dark and light themes for the gallery", body: "", name: "Sam", status: "closed", age: 40, votes: 1, comments: ["The studio stays dark on purpose, so images read true. Closing for now."] },
    { type: "question", title: "Can HEISS UI use a ComfyUI that runs on another PC in my network?", body: "My GPU box is in the basement and I'd like to prompt from the laptop.", name: "Borealis", status: "open", age: 1, votes: 3, comments: ["Yes: Settings › Connection, set its address, e.g. http://192.168.1.20:8188."] },
    { type: "question", title: "Where do upscaled images end up?", body: "", name: "petherson", status: "done", age: 6, votes: 1 },
  ];
  let voter = 0;
  for (const post of posts) {
    const createdAt = now - post.age * day;
    const card = {
      id: Math.random().toString(36).slice(2, 10),
      type: post.type,
      status: post.status,
      title: post.title,
      body: post.body,
      name: post.name,
      setup: post.setup || "",
      source: post.source || "web",
      appVersion: post.appVersion || "",
      release: post.release || "",
      pos: null,
      createdAt,
      updatedAt: createdAt,
      statusAt: createdAt + day,
    };
    await store.create(card);
    for (let i = 0; i < post.votes; i++) await store.vote(card.id, `seed-${voter++}`, true);
    for (const [i, body] of (post.comments || []).entries()) {
      const team = /Found it|Closing|Yes:/.test(body);
      await store.addComment(card.id, { id: `c${i}${card.id}`, body, name: team ? "Maintainer" : ["Kai", "Ines", "Rob"][i % 3], admin: team, createdAt: createdAt + (i + 1) * 3_600_000 });
    }
  }
}

if (process.argv.includes("--demo")) await seed();

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/board" || url.pathname === "/api/board/") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
      const response = await handle(request, { store, env });
      const headers = {};
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie") headers[key] = value;
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) headers["set-cookie"] = cookies;
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) return res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, "127.0.0.1", () => console.log(`Website on http://127.0.0.1:${port}/  ·  board: /board/  ·  admin password: ${env.BOARD_ADMIN_PASSWORD === "admin" ? "admin" : "(BOARD_ADMIN_PASSWORD)"}`));

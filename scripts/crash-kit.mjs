#!/usr/bin/env node
// Crash kit: puts a running HEISS UI (and the ComfyUI behind it) under the
// kind of load the gallery makes, harder, and says whether either stopped
// answering, how slow they got, and what HEISS wrote in its log meanwhile.
//
//   node scripts/crash-kit.mjs
//   node scripts/crash-kit.mjs --heiss http://127.0.0.1:8787 --comfy http://127.0.0.1:8188 --rounds 3 --burst 60
//
// Run it on the computer HEISS UI runs on (the API answers this computer
// without a sign-in). Nothing is changed: it only reads pages, thumbnails,
// images and video previews, the way scrolling and reloading the gallery does,
// including requests dropped halfway, as the browser does when tiles scroll away.

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1] && !all[index + 1].startsWith("--") ? all[index + 1] : "1"]);
  return pairs;
}, []));
let heiss = String(args.heiss || "http://127.0.0.1:8787").replace(/\/$/, "");
let comfy = args.comfy ? String(args.comfy).replace(/\/$/, "") : "";
const rounds = Number(args.rounds || 3);
const burst = Number(args.burst || 60);

const results = { requests: 0, failed: 0, aborted: 0, slowest: 0, heissDown: [], comfyDown: [] };
const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
const log = (...parts) => console.log(`[${since()}]`, ...parts);

async function timed(url, { abortAfter = 0, timeout = 30_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), abortAfter || timeout);
  const begin = Date.now();
  results.requests += 1;
  try {
    const response = await fetch(url, { signal: controller.signal });
    await response.arrayBuffer();
    const took = Date.now() - begin;
    results.slowest = Math.max(results.slowest, took);
    if (!response.ok && response.status !== 304) { results.failed += 1; return { ok: false, answered: true, status: response.status, took }; }
    return { ok: true, answered: true, status: response.status, took };
  } catch (error) {
    if (abortAfter && error.name === "AbortError") { results.aborted += 1; return { ok: true, aborted: true }; }
    results.failed += 1;
    return { ok: false, error: error.cause?.code || error.name, took: Date.now() - begin };
  } finally {
    clearTimeout(timer);
  }
}

// Both servers are asked every second whether they still answer.
let watching = true;
// HEISS answers /api/health with 503 while ComfyUI is away, so for HEISS any
// answer at all means it's up; ComfyUI has to answer its own stats properly.
async function watch(name, url, list, { anyAnswer = false } = {}) {
  let downSince = 0;
  while (watching) {
    const answer = await timed(url, { timeout: 4000 });
    results.requests -= 1;
    if (!answer.ok) results.failed -= 1;
    const result = { ...answer, ok: anyAnswer ? Boolean(answer.answered) : answer.ok };
    if (!result.ok && !downSince) { downSince = Date.now(); log(`!! ${name} not answering (${result.status || result.error})`); }
    if (result.ok && downSince) { list.push(Math.round((Date.now() - downSince) / 1000)); log(`${name} answering again after ${list.at(-1)}s`); downSince = 0; }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (downSince) list.push(`still down after ${Math.round((Date.now() - downSince) / 1000)}s`);
}

async function inParallel(urls, limit, options) {
  const queue = urls.slice();
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await timed(queue.shift(), options(queue.length));
  }));
}

async function main() {
  let health = await timed(`${heiss}/api/health`, { timeout: 5000 });
  // HEISS UI may listen on "localhost" only (IPv6 on some systems): try that too.
  if (!health.answered && !args.heiss) {
    heiss = "http://localhost:8787";
    health = await timed(`${heiss}/api/health`, { timeout: 5000 });
  }
  results.requests = 0;
  results.failed = 0;
  if (!health.answered) { console.error(`HEISS UI isn't answering at ${heiss}. Start it, or pass --heiss.`); process.exit(2); }
  if (!comfy) {
    try { comfy = String((await (await fetch(`${heiss}/api/health`)).json()).comfyUrl || "").replace(/\/$/, ""); } catch { comfy = ""; }
  }
  log(`HEISS ${heiss}${comfy ? ` · ComfyUI ${comfy}` : ""} · ${rounds} rounds of ${burst} at once`);
  const watchers = [watch("HEISS UI", `${heiss}/api/health`, results.heissDown, { anyAnswer: true })];
  if (comfy) watchers.push(watch("ComfyUI", `${comfy}/system_stats`, results.comfyDown));

  // Every page of the gallery, as the app loads it.
  const items = [];
  for (const type of ["image", "video"]) {
    let cursor = "";
    do {
      const response = await fetch(`${heiss}/api/gallery?type=${type}&limit=220&includeFailed=1&bundles=0${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!response.ok) break;
      const page = await response.json();
      items.push(...(page.items || []));
      cursor = page.hasMore ? page.nextCursor : "";
    } while (cursor);
  }
  const thumbs = items.map((item) => item.thumbnailUrl || "").filter(Boolean);
  const views = items.filter((item) => item.type === "image").map((item) => item.url).filter((url) => url?.startsWith("/comfy/view"));
  // The same addresses the gallery's video tiles ask for (videoPreviewUrl in videoPreviewScheduler.ts).
  const previewOf = (url) => url.startsWith("/comfy/view") ? url.replace("/comfy/view", "/comfy/video-preview")
    : url.startsWith("/api/library/file") ? url.replace("/api/library/file", "/api/library/video-preview") : "";
  const videos = items.filter((item) => item.type === "video" && item.url).map((item) => previewOf(item.url)).filter(Boolean);
  log(`${items.length} items · ${thumbs.length} thumbnails · ${views.length} images · ${videos.length} videos`);

  for (let round = 1; round <= rounds; round += 1) {
    log(`round ${round}: a reload's worth of thumbnails, ${burst} at once`);
    await inParallel(thumbs.map((url) => `${heiss}${url}${url.includes("?") ? "&" : "?"}r=${round}`), burst, () => ({}));
    log(`round ${round}: fast scrolling, every other request dropped after 80 ms`);
    await inParallel(views.slice(0, 200).map((url) => `${heiss}${url}`), burst, (left) => ({ abortAfter: left % 2 ? 80 : 0 }));
    if (videos.length) {
      log(`round ${round}: video previews and posters`);
      await inParallel(videos.slice(0, 40).flatMap((url) => [`${heiss}${url}${url.includes("?") ? "&" : "?"}poster=1`, `${heiss}${url}`]), 12, (left) => ({ abortAfter: left % 3 ? 0 : 150 }));
    }
  }
  log("settling for 10 s");
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  watching = false;
  await Promise.all(watchers);

  let tail = "";
  try {
    const response = await fetch(`${heiss}/api/logs?lines=30`);
    if (response.ok) tail = await response.text();
  } catch { /* older HEISS UI */ }

  console.log("\n— Crash kit report —");
  console.log(`requests ${results.requests} · failed ${results.failed} · dropped on purpose ${results.aborted} · slowest ${results.slowest} ms`);
  console.log(`HEISS UI went down: ${results.heissDown.length ? results.heissDown.map((s) => `${s}${typeof s === "number" ? "s" : ""}`).join(", ") : "no"}`);
  if (comfy) console.log(`ComfyUI went down: ${results.comfyDown.length ? results.comfyDown.map((s) => `${s}${typeof s === "number" ? "s" : ""}`).join(", ") : "no"}`);
  if (tail) console.log(`\nHEISS UI log, last lines:\n${tail}`);
  process.exit(results.heissDown.length || results.comfyDown.length ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(2); });

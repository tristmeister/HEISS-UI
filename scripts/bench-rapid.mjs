// Times HEISS's own built-in graphs on a real ComfyUI, for Rapid (the
// half-size start, ComfyUI-HEISS-UI-Nodes) on and off. Every run goes through
// the same code a studio run does: inferModels → sanitizeGenerateBody →
// imageGraph, so a number here is a number the app would see.
//
//   node scripts/bench-rapid.mjs --list
//   node scripts/bench-rapid.mjs --families krea2,flux1,qwen_image --rapid off
//   node scripts/bench-rapid.mjs --profiles <id>,<id> --rapid both --sizes 1024x1024,1536x1536
//
// Options:
//   --comfy URL        ComfyUI to use (default COMFY_URL or http://127.0.0.1:8188)
//   --list             print the ready image models and stop
//   --families a,b     only these families (family-catalog.js ids)
//   --profiles a,b     only these model profiles (ids from --list)
//   --rapid MODES      off, on (with the smoothing step), fast (without), comma-separated;
//                      both = off,on · all = off,on,fast (default off)
//   --rapid-at a,b     switch points to sweep for on/fast (default: each family's own)
//   --sizes WxH,...    (default 1024x1024,1536x1536; snapped to each model's grid)
//   --seeds n,...      (default 1234567,42)
//   --prompts a,b      prompt ids from PROMPTS below (default all)
//   --steps n          override every model's default step count
//   --out DIR          (default bench-results/<timestamp>)
//   --no-images        don't download the pictures
//   --dry              print the first graph for each model (Rapid as asked) and queue nothing
//
// Writes DIR/runs.jsonl (one line per run), DIR/summary.md and, unless
// --no-images, DIR/images/<profile>/<size>/<prompt>-<seed>-<rapid>.png.
// Sampling time comes from ComfyUI's progress socket (time spent in the
// sampler node itself); total is queue-to-finished. Peak VRAM is polled with
// nvidia-smi while the run is going, where there is one.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Probes for what a half-size start could cost: skin, hands, small text, framing. */
const PROMPTS = {
  portrait: "Close-up photo portrait of a woman with freckles by a rainy window, soft daylight, visible skin pores, fine flyaway hair, 85mm lens",
  hands: "Photo of a man's hands playing a G major chord on an acoustic guitar, close-up on the fretboard, all fingers clearly visible, natural light",
  text: "Photo of a small corner bakery storefront at dusk, a hand-painted sign above the door reads \"ROSA'S BAKERY - EST. 1987\", a chalkboard menu in the window lists \"Croissant 2.50  Coffee 1.80  Pretzel 1.20\"",
  street: "Wide photo of a busy city street crossing in the rain at night, neon shop signs, people with umbrellas, reflections on the wet asphalt, a red tram in the background"
};

function args(argv) {
  const out = { rapid: "off", sizes: "1024x1024,1536x1536", seeds: "1234567,42", images: true };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const next = () => argv[++i];
    if (key === "--list") out.list = true;
    else if (key === "--dry") out.dry = true;
    else if (key === "--no-images") out.images = false;
    else if (key.startsWith("--")) out[key.slice(2)] = next();
  }
  return out;
}

const opts = args(process.argv);
const comfyUrl = String(opts.comfy || process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");
process.env.COMFY_URL = comfyUrl;
// The server modules read COMFY_URL when they load, so they come in after it is set.
const { inferModels } = await import("../server/models.js");
const { sanitizeGenerateBody } = await import("../server/validation.js");
const { imageGraph } = await import("../server/graphs.js");

const get = async (pathname) => {
  const response = await fetch(`${comfyUrl}${pathname}`);
  if (!response.ok) throw new Error(`${pathname}: ComfyUI answered ${response.status}`);
  return response.json();
};

const info = await get("/object_info");
const stats = await get("/system_stats");
const profiles = (inferModels(info, stats).profiles || []).filter((item) => item.kind === "image" && item.ready && String(item.workflow).startsWith("family:"));

if (opts.list) {
  for (const p of profiles) console.log(`${p.id}\n    ${p.displayName} · family ${p.family} · variant ${p.variant} · ${p.defaults.steps} steps · ${p.defaults.sampler}/${p.defaults.scheduler} · cfg ${p.defaults.cfg}`);
  if (!profiles.length) console.log("No ready image models. Is ComfyUI running with models installed?");
  process.exit(0);
}

const list = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
const families = list(opts.families);
const ids = list(opts.profiles);
const chosen = profiles.filter((p) => (!families.length || families.includes(p.family)) && (!ids.length || ids.includes(p.id)));
if (!chosen.length) {
  console.error("No ready image model matches. Run with --list to see them.");
  process.exit(1);
}
const sizes = list(opts.sizes).map((item) => item.split("x").map(Number));
const seeds = list(opts.seeds);
const promptIds = list(opts.prompts).length ? list(opts.prompts) : Object.keys(PROMPTS);
const modeNames = { both: ["off", "on"], all: ["off", "on", "fast"] }[opts.rapid] || list(opts.rapid || "off").filter((mode) => ["off", "on", "fast"].includes(mode));
const switchPoints = list(opts["rapid-at"]).map(Number).filter((value) => value >= 0.3 && value <= 0.99);
// Each run mode: its label, and what the request asks for.
const modes = modeNames.flatMap((mode) => {
  if (mode === "off") return [{ label: "off", rapid: false }];
  const smooth = mode === "on";
  return switchPoints.length
    ? switchPoints.map((at) => ({ label: `${mode}@${at}`, rapid: true, rapidAt: at, rapidSmooth: smooth }))
    : [{ label: mode, rapid: true, rapidSmooth: smooth }];
});
if (!modes.length) {
  console.error("--rapid takes off, on, fast, both or all.");
  process.exit(1);
}
const outDir = path.resolve(opts.out || path.join(root, "bench-results", new Date().toISOString().replace(/[:.]/g, "-")));
fs.mkdirSync(outDir, { recursive: true });
const runsFile = path.join(outDir, "runs.jsonl");

const gitCommit = (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).toString().trim(); } catch { return ""; } })();
const device = stats.devices?.[0] || {};
const header = {
  date: new Date().toISOString(), heiss: gitCommit, comfyui: stats.system?.comfyui_version || "", pytorch: stats.system?.pytorch_version || "",
  os: stats.system?.os || process.platform, gpu: device.name || "", vramTotalGiB: device.vram_total ? +(device.vram_total / 2 ** 30).toFixed(1) : null,
  rapidNode: Boolean(info.HeissRapid)
};
fs.writeFileSync(path.join(outDir, "machine.json"), JSON.stringify(header, null, 2));
console.log(`ComfyUI ${header.comfyui} · ${header.gpu} · HEISS ${header.heiss} · Rapid node ${header.rapidNode ? "installed" : "not installed"}`);
if (modes.some((mode) => mode.rapid) && !header.rapidNode) console.warn("Rapid is asked for but the HeissRapid node isn't loaded; \"on\" runs will be the same graph as \"off\".");

/** nvidia-smi polling for peak memory, where there is a GPU tool to ask. */
function vramWatch() {
  let peak = 0;
  let child = null;
  try {
    child = spawn("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits", "-lms", "100"], { stdio: ["ignore", "pipe", "ignore"] });
    child.on("error", () => { child = null; });
    child.stdout.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const mib = Number(line.split(",")[0]);
        if (Number.isFinite(mib) && mib > peak) peak = mib;
      }
    });
  } catch { child = null; }
  return { stop: () => { child?.kill(); return peak ? +(peak / 1024).toFixed(2) : null; } };
}

const samplerTypes = new Set(["KSampler", "KSamplerAdvanced", "SamplerCustomAdvanced", "SamplerCustom"]);
const decodeTypes = new Set(["VAEDecode", "VAEDecodeTiled"]);

/** Queues one graph and times it from ComfyUI's progress socket. */
async function run(graph) {
  const clientId = crypto.randomUUID();
  const nodeTime = {};
  let current = null;
  let since = 0;
  let done;
  const finished = new Promise((resolve, reject) => { done = { resolve, reject }; });
  let promptId = "";
  const socket = typeof WebSocket === "function" ? new WebSocket(`${comfyUrl.replace(/^http/, "ws")}/ws?clientId=${clientId}`) : null;
  const mark = (node) => {
    const now = performance.now();
    if (current) nodeTime[current] = (nodeTime[current] || 0) + (now - since);
    current = node;
    since = now;
  };
  if (socket) {
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error("Couldn't open ComfyUI's progress socket.")); });
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      const data = message.data || {};
      if (data.prompt_id && promptId && data.prompt_id !== promptId) return;
      if (message.type === "executing") {
        mark(data.node ?? null);
        if (data.node === null) done.resolve();
      } else if (message.type === "execution_success") {
        mark(null);
        done.resolve();
      } else if (message.type === "execution_error") {
        done.reject(new Error(`${data.node_type || "ComfyUI"}: ${data.exception_message || "failed"}`));
      }
    };
  }
  const vram = vramWatch();
  const started = performance.now();
  const response = await fetch(`${comfyUrl}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: graph, client_id: clientId }) });
  const queued = await response.json();
  if (!response.ok || !queued.prompt_id) throw new Error(`ComfyUI refused the graph: ${JSON.stringify(queued.node_errors || queued.error || queued).slice(0, 600)}`);
  promptId = queued.prompt_id;
  if (socket) {
    await finished;
    socket.close();
  }
  // Without a socket (Node < 22), wait on history; only the total is known then.
  let history = null;
  for (let tries = 0; tries < 3600; tries++) {
    history = (await get(`/history/${promptId}`))[promptId];
    if (history?.status?.completed || history?.status?.status_str === "error") break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const total = (performance.now() - started) / 1000;
  const peak = vram.stop();
  if (history?.status?.status_str === "error") throw new Error("ComfyUI reported an error for this run (see its console).");
  const sum = (types) => Object.entries(nodeTime).filter(([id]) => types.has(graph[id]?.class_type)).reduce((all, [, ms]) => all + ms, 0) / 1000;
  const images = Object.values(history?.outputs || {}).flatMap((output) => output.images || []);
  return { total: +total.toFixed(2), sampling: socket ? +sum(samplerTypes).toFixed(2) : null, decode: socket ? +sum(decodeTypes).toFixed(2) : null, peakVramGiB: peak, images };
}

async function saveImage(image, file) {
  const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || "", type: image.type || "output" });
  const response = await fetch(`${comfyUrl}/view?${query}`);
  if (!response.ok) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

function graphFor(profile, { prompt, seed, width, height, mode = { rapid: false } }) {
  const input = {
    workflow: profile.workflow, profileId: profile.id, model: profile.model, kind: "image",
    prompt, seed, width, height, count: 1, rapid: mode.rapid, rapidAt: mode.rapidAt, rapidSmooth: mode.rapidSmooth,
    ...(opts.steps ? { steps: Number(opts.steps) } : {})
  };
  const body = sanitizeGenerateBody(input, info, stats);
  return imageGraph(body).then((graph) => ({ graph, body }));
}

if (opts.dry) {
  for (const profile of chosen) {
    const { graph } = await graphFor(profile, { prompt: PROMPTS.portrait, seed: seeds[0], width: sizes[0][0], height: sizes[0][1], mode: modes.at(-1) });
    console.log(`${profile.id}\n${JSON.stringify(graph, null, 1)}`);
  }
  process.exit(0);
}

const rows = [];
const safe = (value) => String(value).replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80);
for (const profile of chosen) {
  console.log(`\n${profile.displayName} (${profile.id})`);
  // A warm-up so model loading isn't counted against the first measured run.
  try {
    const warm = await graphFor(profile, { prompt: PROMPTS.portrait, seed: "7", width: sizes[0][0], height: sizes[0][1] });
    const result = await run(warm.graph);
    console.log(`  warm-up ${result.total}s (includes loading)`);
  } catch (error) {
    console.log(`  skipped: ${error.message}`);
    continue;
  }
  for (const [width, height] of sizes) {
    for (const promptId of promptIds) {
      for (const seed of seeds) {
        for (const mode of modes) {
          const { graph, body } = await graphFor(profile, { prompt: PROMPTS[promptId], seed, width, height, mode });
          let result;
          try {
            result = await run(graph);
          } catch (error) {
            console.log(`  ${body.width}x${body.height} ${promptId} seed ${seed} rapid ${mode.label}: FAILED ${error.message}`);
            const row = { profile: profile.id, model: profile.displayName, family: profile.family, variant: profile.variant, width: body.width, height: body.height, prompt: promptId, seed, rapid: mode.label, error: error.message };
            fs.appendFileSync(runsFile, `${JSON.stringify(row)}\n`);
            continue;
          }
          const rapidNode = Object.values(graph).find((node) => node.class_type === "HeissRapid");
          const row = {
            profile: profile.id, model: profile.displayName, family: profile.family, variant: profile.variant,
            width: body.width, height: body.height, steps: body.steps, sampler: body.sampler, scheduler: body.scheduler, cfg: body.cfg,
            prompt: promptId, seed, rapid: mode.label, rapidInGraph: Boolean(rapidNode), switchAt: rapidNode?.inputs.switch_at ?? null, ...result, images: undefined
          };
          rows.push(row);
          fs.appendFileSync(runsFile, `${JSON.stringify(row)}\n`);
          console.log(`  ${body.width}x${body.height} ${promptId.padEnd(8)} seed ${String(seed).padEnd(8)} rapid ${mode.label.padEnd(8)} sampling ${row.sampling ?? "?"}s  total ${row.total}s  peak ${row.peakVramGiB ?? "?"} GiB${mode.rapid && !rapidNode ? "  (Rapid not in graph)" : ""}`);
          if (opts.images && result.images[0]) {
            await saveImage(result.images[0], path.join(outDir, "images", safe(profile.id), `${body.width}x${body.height}`, `${promptId}-${seed}-${safe(mode.label)}.png`));
          }
        }
      }
    }
  }
}

// ---- summary: medians per model, size and mode, and the speed-up where both ran
const median = (values) => {
  const sorted = values.filter((value) => typeof value === "number").sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return +(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2).toFixed(2);
};
const groups = new Map();
for (const row of rows) {
  const key = `${row.profile}|${row.width}x${row.height}`;
  if (!groups.has(key)) groups.set(key, { row, byMode: new Map() });
  const byMode = groups.get(key).byMode;
  if (!byMode.has(row.rapid)) byMode.set(row.rapid, []);
  byMode.get(row.rapid).push(row);
}
const lines = [
  `# Rapid benchmark`, "",
  `${header.date} · HEISS ${header.heiss} · ComfyUI ${header.comfyui} · PyTorch ${header.pytorch} · ${header.gpu} (${header.vramTotalGiB} GiB)`, "",
  "Medians. Speed-up is against `off` for the same model and size.", "",
  "| Model | Size | Steps | Sampler | Rapid | Sampling | Total | Peak VRAM | Speed-up (sampling / total) |",
  "|---|---|---|---|---|---|---|---|---|"
];
for (const { row, byMode } of groups.values()) {
  const off = byMode.get("off") || [];
  const offSampling = median(off.map((r) => r.sampling));
  const offTotal = median(off.map((r) => r.total));
  for (const [label, items] of byMode) {
    const sampling = median(items.map((r) => r.sampling));
    const total = median(items.map((r) => r.total));
    const ratio = (a, b) => (a && b ? `${(a / b).toFixed(2)}x` : "–");
    lines.push(`| ${row.model} | ${row.width}x${row.height} | ${row.steps} | ${row.sampler}/${row.scheduler} | ${label} | ${sampling ?? "?"}s | ${total}s | ${median(items.map((r) => r.peakVramGiB)) ?? "?"} GiB | ${label === "off" ? "–" : `${ratio(offSampling, sampling)} / ${ratio(offTotal, total)}`} |`);
  }
}
fs.writeFileSync(path.join(outDir, "summary.md"), `${lines.join("\n")}\n`);
console.log(`\n${lines.join("\n")}\n\nWrote ${outDir}`);
process.exit(0);

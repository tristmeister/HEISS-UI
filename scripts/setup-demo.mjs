/**
 * The setup demo: HEISS UI against a pretend ComfyUI whose models folder is
 * missing text encoders, VAEs, a partner model and a node pack, so every
 * "this model needs files" flow can be tried on a machine without them.
 *
 *   npm run dev:setup-demo            fresh state every start
 *   npm run dev:setup-demo -- --keep  keep what was downloaded last time
 *
 * Everything real runs unchanged (family detection, the setup panels, the
 * download queue, restarts, pack installs); only the edges are pretend:
 *   - ComfyUI: an HTTP server on DEMO_COMFY_PORT (8199) listing the files in
 *     data/setup-demo/ComfyUI/models, with ComfyUI-Manager 4 answering.
 *     diffusion_models is read once per start, like a ComfyUI that needs a
 *     restart to notice a new file; the other folders are read live.
 *   - Hugging Face: downloads tick up at DEMO_MBPS (400) into sparse files,
 *     so gigabytes cost no disk. Scripted trouble, per file:
 *       umt5_xxl…              drops the connection at 40% once (retry resumes)
 *       ideogram4_unconditional… gated (HTTP 401), retrying cannot help
 *       qwen3-vl-8b-heretic…   the disk is too full for it
 *   - Node packs: "installs" in a few seconds; ComfyUI loads them on restart.
 *   - Generating: the pretend ComfyUI refuses graphs; this demo stops at "ready".
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.join(root, "data", "setup-demo");
const comfyRoot = path.join(base, "ComfyUI");
const models = path.join(comfyRoot, "models");
const customNodes = path.join(comfyRoot, "custom_nodes");
const comfyPort = Number(process.env.DEMO_COMFY_PORT || 8199);
const bytesPerSecond = Number(process.env.DEMO_MBPS || 400) * 1e6;

if (!process.argv.includes("--keep")) fs.rmSync(base, { recursive: true, force: true });

// Before any server module loads: they read these once.
Object.assign(process.env, {
  COMFY_URL: `http://127.0.0.1:${comfyPort}`,
  HEISS_COMFY_ROOT: comfyRoot,
  COMFY_OUTPUT_DIR: path.join(comfyRoot, "output"),
  HEISS_DATA_DIR: path.join(base, "heiss-data")
});

const { nodePacks } = await import("../server/node-packs.js");
const { families } = await import("../server/family-catalog.js");

/* ------------------------------------------------------------ Files */

const t = (shape) => ({ dtype: "F16", shape, data_offsets: [0, 0] });
const filler = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`filler.${i}.weight`, t([1])]));
const prefixed = (prefix, header) => Object.fromEntries(Object.entries({ ...header, ...filler }).map(([key, value]) => [`${prefix}${key}`, value]));
const headers = {
  fluxDev: { "double_blocks.0.img_attn.norm.key_norm.scale": t([128]), "img_in.weight": t([3072, 64]), "guidance_in.in_layer.weight": t([3072, 256]) },
  zimage: { "cap_embedder.1.weight": t([3840, 2560]), "noise_refiner.0.attention.k_norm.weight": t([128]) },
  wan14b: { "head.modulation": t([1, 2, 5120]), "head.head.weight": t([64, 5120]), "patch_embedding.weight": t([5120, 16, 1, 2, 2]) },
  sdxlUnet: { "input_blocks.0.0.weight": t([320, 4, 3, 3]), "input_blocks.4.1.transformer_blocks.0.attn2.to_k.weight": t([640, 2048]) },
  clipL: { "text_model.encoder.layers.0.mlp.fc1.weight": t([3072, 768]) },
  kl4: { "decoder.conv_in.weight": t([512, 4, 3, 3]) }
};

function writeSafetensors(file, header) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!header) return fs.writeFileSync(file, Buffer.alloc(16));
  const json = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(json.length));
  fs.writeFileSync(file, Buffer.concat([length, json]));
}

function seed() {
  if (fs.existsSync(models)) return;
  for (const dir of ["diffusion_models", "checkpoints", "text_encoders", "vae", "loras"]) fs.mkdirSync(path.join(models, dir), { recursive: true });
  fs.mkdirSync(customNodes, { recursive: true });
  fs.mkdirSync(path.join(comfyRoot, "output"), { recursive: true });
  // ComfyUI's own Python, so the local pack-install route is offered.
  writeSafetensors(path.join(comfyRoot, ".venv", "bin", "python"), null);
  const put = (folder, name, header) => writeSafetensors(path.join(models, folder, name), header);
  put("diffusion_models", "flux1-dev-fp8.safetensors", headers.fluxDev); // CLIP-L + T5-XXL + Flux VAE
  put("diffusion_models", "z_image_turbo_bf16.safetensors", headers.zimage); // Qwen3 4B + the same Flux VAE
  put("diffusion_models", "wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors", headers.wan14b); // + low-noise partner (manual), UMT5 (flaky), Wan VAE
  put("diffusion_models", "ideogram4_fp8_scaled.safetensors", null); // partner (gated), Qwen3-VL 8B (disk full), Flux.2 VAE, newer ComfyUI
  put("diffusion_models", "mystery_model_v3.safetensors", { "foo.weight": t([1]) }); // not recognised
  put("checkpoints", "sd_xl_base_1.0.safetensors", { ...prefixed("model.diffusion_model.", headers.sdxlUnet), ...prefixed("conditioner.embedders.0.transformer.", headers.clipL), ...prefixed("first_stage_model.", headers.kl4) }); // ready
  put("checkpoints", "ponyRealism_v22_noVAE_noCLIP.safetensors", prefixed("model.diffusion_model.", headers.sdxlUnet)); // CLIP-L + CLIP-G + SDXL VAE
  put("checkpoints", "Sana_1600M_1024px_MultiLing.safetensors", null); // ExtraModels pack
  put("loras", "film_grain_35mm.safetensors", null);
}
seed();

/* ------------------------------------------------------------ ComfyUI */

const list = (values) => ({ input: { required: values } });
const listDir = (folder) => {
  try {
    return fs.readdirSync(path.join(models, folder)).filter((name) => /\.(safetensors|gguf|ckpt|pt)$/i.test(name)).sort();
  } catch {
    return [];
  }
};
const loadedPacks = () => Object.values(nodePacks).filter((pack) => fs.existsSync(path.join(customNodes, pack.folder)));

// What this ComfyUI "started" with: re-read on every restart.
let boot = { unets: [], packs: [] };
const bootUp = () => { boot = { unets: listDir("diffusion_models"), packs: loadedPacks() }; };
bootUp();

// Ideogram4Scheduler is left out on purpose: Ideogram 4 then asks for a newer ComfyUI.
const coreNodes = ["CLIPTextEncode", "VAEDecode", "VAEEncode", "SaveImage", "LoadImage", "EmptyLatentImage", "EmptySD3LatentImage", "EmptyFlux2LatentImage",
  "Flux2Scheduler", "SamplerCustomAdvanced", "CFGGuider", "BasicGuider", "BasicScheduler", "KSamplerSelect", "RandomNoise", "FluxGuidance",
  "ConditioningZeroOut", "ModelSamplingFlux", "ModelSamplingAuraFlow", "ModelSamplingSD3", "ModelSamplingDiscrete", "CLIPSetLastLayer",
  "KSamplerAdvanced", "EmptyHunyuanLatentVideo", "Wan22ImageToVideoLatent", "CreateVideo", "SaveVideo", "DualCLIPLoader", "TripleCLIPLoader",
  "QuadrupleCLIPLoader", "T5TokenizerOptions", "DualModelGuider", "CFGOverride", "TextEncodeQwenImage21", "EmptyHunyuanImageLatent"];
const clipTypes = [...new Set(Object.values(families).map((family) => family.clipType).filter(Boolean))];

function objectInfo() {
  const clips = listDir("text_encoders");
  return {
    ...Object.fromEntries(coreNodes.map((name) => [name, list({})])),
    ...Object.fromEntries(boot.packs.flatMap((pack) => pack.nodes).map((name) => [name, list({})])),
    ScmModelSampling: boot.packs.some((pack) => pack.folder === nodePacks.extramodels.folder) ? list({}) : undefined,
    KSampler: list({
      steps: ["INT", { default: 20, min: 1, max: 10000 }], cfg: ["FLOAT", { default: 8, min: 0, max: 100, step: 0.1 }],
      sampler_name: [["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_sde", "uni_pc", "lcm", "ddim", "res_multistep", "scm"]],
      scheduler: [["simple", "normal", "karras", "sgm_uniform", "beta", "exponential"]]
    }),
    UNETLoader: list({ unet_name: [boot.unets], weight_dtype: [["default", "fp8_e4m3fn", "fp8_e5m2"]] }),
    CheckpointLoaderSimple: list({ ckpt_name: [listDir("checkpoints")] }),
    CLIPLoader: list({ clip_name: [clips], type: [clipTypes] }),
    DualCLIPLoader: list({ clip_name1: [clips], clip_name2: [clips], type: [clipTypes] }),
    VAELoader: list({ vae_name: [listDir("vae")] }),
    LoraLoader: list({ lora_name: [listDir("loras")] })
  };
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

let restarting = false;
const sockets = new Set();
const comfy = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const route = url.pathname;
  if (route === "/system_stats") return json(res, 200, { system: { comfyui_version: "0.3.62 (setup demo)", pytorch_version: "2.8.0", os: "darwin" }, devices: [{ name: "Setup demo", type: "mps" }] });
  if (route === "/object_info") return json(res, 200, objectInfo());
  if (route === "/internal/folder_paths") {
    return json(res, 200, Object.fromEntries(["diffusion_models", "checkpoints", "text_encoders", "vae", "loras"].map((kind) => [kind, [[path.join(models, kind)], [".safetensors"]]])));
  }
  if (route === "/v2/manager/version") return json(res, 200, "4.0.3");
  if (route === "/v2/manager/reboot" && req.method === "POST") {
    json(res, 200, {});
    restartComfy();
    return;
  }
  if (route.startsWith("/view_metadata/")) return json(res, 200, {});
  if (route.startsWith("/history")) return json(res, 200, {});
  if (route === "/queue") return json(res, 200, { queue_running: [], queue_pending: [] });
  if (route === "/prompt") return json(res, 400, { error: { message: "The setup demo’s pretend ComfyUI doesn’t run graphs." }, node_errors: {} });
  json(res, 404, { error: "not in the setup demo" });
});
comfy.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });

function restartComfy() {
  if (restarting) return;
  restarting = true;
  setTimeout(() => {
    comfy.close();
    sockets.forEach((socket) => socket.destroy());
    console.log("[setup demo] ComfyUI restarting…");
    setTimeout(() => {
      bootUp();
      comfy.listen(comfyPort, "127.0.0.1", () => { restarting = false; console.log(`[setup demo] ComfyUI back with ${boot.packs.map((pack) => pack.name).join(", ") || "no packs"}`); });
    }, 6000);
  }, 400);
}

await new Promise((resolve) => comfy.listen(comfyPort, "127.0.0.1", resolve));

/* ------------------------------------------------------------ Hugging Face */

const sizes = [
  [/^t5xxl_fp8/, 4.89e9], [/^t5xxl_fp16/, 9.79e9], [/^clip_g/, 1.39e9], [/^ae\./, 335e6], [/^umt5/, 6.74e9],
  [/^wan_2\.1_vae/, 254e6], [/^flux2-vae/, 336e6], [/^sdxl_vae/, 335e6], [/^ideogram4_unconditional/, 11.9e9]
];
const failedOnce = new Set();
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(timer); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true });
});

const { setDownloadTransport } = await import("../server/model-downloads.js");
setDownloadTransport(async (entry, signal, { targetFor, finishDownload, finalError, fileSize }) => {
  const { dir, target, partial, note } = targetFor(entry);
  fs.mkdirSync(dir, { recursive: true });
  await sleep(500, signal); // connecting
  if (/^ideogram4_unconditional/.test(entry.file)) {
    throw finalError(`${entry.file} needs a Hugging Face login or licence acceptance (HTTP 401). Download it in your browser and put it in ComfyUI’s ${entry.folder} folder.`);
  }
  const total = sizes.find(([pattern]) => pattern.test(entry.file))?.[1] || entry.totalBytes || 1.2e9;
  if (/^qwen3-vl-8b-heretic/.test(entry.file)) {
    throw finalError(`Not enough space: ${entry.file} needs ${(total / 1024 ** 3).toFixed(0)} GB, and the disk has 6.1 GB free.`);
  }
  let received = fileSize(partial);
  entry.totalBytes = total;
  entry.receivedBytes = received;
  fs.writeFileSync(note, JSON.stringify({ id: entry.id, label: entry.label, totalBytes: total, exact: true }));
  if (!received) fs.writeFileSync(partial, "");
  const tick = 250;
  while (received < total) {
    await sleep(tick, signal);
    const jitter = 0.75 + Math.random() * 0.5;
    received = Math.min(total, received + Math.round(bytesPerSecond * jitter * tick / 1000));
    fs.truncateSync(partial, received); // sparse: no real bytes written
    entry.receivedBytes = received;
    entry.bytesPerSecond = bytesPerSecond * jitter;
    if (/^umt5/.test(entry.file) && !failedOnce.has(entry.file) && received > total * 0.4) {
      failedOnce.add(entry.file);
      throw new TypeError("terminated"); // what undici says when the connection drops
    }
  }
  finishDownload(entry, partial, target, note);
});

/* ------------------------------------------------------------ Node packs */

const { setPackInstallTransport } = await import("../server/pack-installer.js");
setPackInstallTransport(async (state, pack) => {
  state.route = "local";
  state.step = "Downloading the nodes";
  await new Promise((resolve) => setTimeout(resolve, 2500));
  state.step = "Installing what they need";
  await new Promise((resolve) => setTimeout(resolve, 3500));
  fs.mkdirSync(path.join(customNodes, pack.folder), { recursive: true });
});

console.log(`[setup demo] Pretend ComfyUI on ${process.env.COMFY_URL}, files in ${path.relative(root, comfyRoot)}`);
await import("../server/index.js");

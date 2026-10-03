import assert from "node:assert/strict";
import { fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startFakeComfy } from "./fixtures/fake-comfy.js";

// The import flow end to end through the real server: pick a run from
// ComfyUI's history, import it, then generate with a "More settings" value.
const here = path.dirname(fileURLToPath(import.meta.url));
const objectInfo = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "object_info-comfyui-0.34.1.json"), "utf8"));
objectInfo.CheckpointLoaderSimple.input.required.ckpt_name[0] = ["juggernautXL_ragnarok.safetensors"];

const fake = await startFakeComfy({ objectInfo });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-import-routes-"));
let server;
let base = "";

const runPrompt = (text) => ({
  1: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "juggernautXL_ragnarok.safetensors" } },
  2: { class_type: "EmptyLatentImage", inputs: { width: 832, height: 1216, batch_size: 1 } },
  3: { class_type: "KSampler", inputs: { seed: 7, steps: 30, cfg: 5, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1, model: ["6", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["2", 0] } },
  4: { class_type: "CLIPTextEncode", inputs: { text, clip: ["1", 1] }, _meta: { title: "Positive" } },
  5: { class_type: "CLIPTextEncode", inputs: { text: "lowres, watermark", clip: ["1", 1] }, _meta: { title: "Negative" } },
  6: { class_type: "FreeU_V2", inputs: { model: ["1", 0], b1: 1.3, b2: 1.4, s1: 0.9, s2: 0.2 } },
  7: { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["1", 2] } },
  8: { class_type: "SaveImage", inputs: { images: ["7", 0], filename_prefix: "desk" } }
});

test.before(async () => {
  for (const [id, text, at] of [["run-1", "a lighthouse in fog", 1000], ["run-2", "a fox in the snow", 2000]]) {
    fake.addHistory(id, {
      prompt: [Number(at), id, runPrompt(text), { client_id: "comfy-page", extra_pnginfo: { workflow: { nodes: [], links: [] } } }, ["8"]],
      outputs: { 8: { images: [{ filename: `${id}.png`, subfolder: "", type: "output" }] } },
      status: { status_str: "success", completed: true, messages: [["execution_start", { timestamp: at }]] }
    });
  }
  fake.savedWorkflows["portraits/studio.json"] = { prompt: runPrompt("a portrait") };
  server = fork(path.join(here, "index.js"), [], {
    cwd: path.join(here, ".."),
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", COMFY_URL: fake.url, HEISS_DATA_DIR: dataDir, COMFY_OUTPUT_DIR: "", HEISS_NO_BROWSER: "1", HEISS_LAN: "0", HEISS_COMFY_PAGE: "0", npm_lifecycle_event: "" },
    stdio: ["ignore", "ignore", "pipe", "ipc"]
  });
  let errors = "";
  server.stderr.on("data", (chunk) => { errors += chunk; });
  const message = await new Promise((resolve, reject) => {
    server.on("message", resolve);
    server.on("exit", (code) => reject(new Error(`The server exited (${code}): ${errors}`)));
  });
  base = message.url.replace("localhost", "127.0.0.1");
});

test.after(async () => {
  const exited = server && server.exitCode === null ? new Promise((resolve) => server.once("exit", resolve)) : null;
  server?.kill("SIGTERM");
  await exited;
  await fake.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const api = async (pathname, options = {}) => {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

test("the picker lists the desktop runs as one workflow and the saved ones", async () => {
  const sources = await api("/api/workflows/sources");
  assert.equal(sources.status, 200, JSON.stringify(sources.body));
  assert.equal(sources.body.recent.length, 1);
  assert.equal(sources.body.recent[0].id, "run-2");
  assert.equal(sources.body.recent[0].runs, 2);
  assert.deepEqual(sources.body.saved.map((item) => item.path), ["portraits/studio.json"]);
  const saved = await api("/api/workflows/import/preview", { method: "POST", body: { source: "saved", path: "portraits/studio.json" } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.preview.detected.name, "studio");
  const escape = await api("/api/workflows/import/preview", { method: "POST", body: { source: "saved", path: "../../secrets.json" } });
  assert.equal(escape.status, 400);
});

test("a history run imports without questions and generates with your prompt and settings", async () => {
  const preview = await api("/api/workflows/import/preview", { method: "POST", body: { source: "history", promptId: "run-2" } });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const { detected, graph, conversion } = preview.body.preview;
  assert.equal(conversion, "stored");
  assert.deepEqual(detected.controls.prompt, { node: "4", input: "text" });
  assert.equal(detected.confidence.prompt, "high");
  assert.equal(detected.question, null);
  assert.ok(detected.settings.some((item) => item.key === "6.b1"));

  const { nodes: _nodes, guessed: _guessed, question: _question, confidence: _confidence, ...metadata } = detected;
  const saved = await api("/api/workflows/import", { method: "POST", body: { graph, metadata: { ...metadata, name: "Desk portraits" } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const models = await api("/api/models");
  const profile = models.body.profiles.find((item) => item.id === saved.body.workflow.profileId);
  assert.ok(profile, "the import is offered as a model");
  assert.ok(profile.settings.some((item) => item.key === "6.b1"));
  assert.equal(profile.capabilities.negativePrompt, true);

  const queued = fake.nextPrompt();
  const generate = await api("/api/generate", {
    method: "POST",
    body: { ...profile.defaults, kind: "image", profileId: profile.id, model: profile.model, workflow: profile.workflow, prompt: "a red bicycle", negative: "blurry", count: 1, seed: "11", workflowSettings: { "6.b1": 1.05 } }
  });
  assert.equal(generate.status, 200, JSON.stringify(generate.body));
  const sent = (await queued).prompt;
  assert.equal(sent["4"].inputs.text, "a red bicycle");
  assert.equal(sent["5"].inputs.text, "blurry");
  assert.equal(sent["6"].inputs.b1, 1.05);
  assert.equal(sent["3"].inputs.seed, 11);
});

test("setup and install history answer even with nothing to do", async () => {
  const state = await api("/api/workflows/setup");
  assert.equal(state.status, 200);
  const refused = await api("/api/workflows/setup", { method: "POST", body: { packs: [{ key: "repo:x", name: "X", registry: false }] } });
  assert.equal(refused.status, 400, "a pack outside the registry is never installed without a yes");
  const history = await api("/api/installs");
  assert.deepEqual(history.body.installs, []);
});

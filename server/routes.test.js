import assert from "node:assert/strict";
import { fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startFakeComfy } from "./fixtures/fake-comfy.js";

// The real server, started the way the launcher starts it, against a stand-in
// ComfyUI that answers with a recorded /object_info (fixtures/) plus one model.
const here = path.dirname(fileURLToPath(import.meta.url));
const snapshot = fs.readdirSync(path.join(here, "fixtures")).filter((name) => name.startsWith("object_info-comfyui-")).sort().at(-1);
const objectInfo = JSON.parse(fs.readFileSync(path.join(here, "fixtures", snapshot), "utf8"));
objectInfo.CheckpointLoaderSimple.input.required.ckpt_name[0] = ["sd_xl_base_1.0.safetensors"];

const fake = await startFakeComfy({ objectInfo });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-routes-"));
let server;
let base = "";

test.before(async () => {
  server = fork(path.join(here, "index.js"), [], {
    cwd: path.join(here, ".."),
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", COMFY_URL: fake.url, HEISS_DATA_DIR: dataDir, COMFY_OUTPUT_DIR: "", HEISS_NO_BROWSER: "1", HEISS_LAN: "0", npm_lifecycle_event: "" },
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
  server?.kill("SIGTERM");
  await fake.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const api = async (pathname, options = {}) => {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
};

test("the server says who it is, and an unknown API route fails as JSON", async () => {
  const ping = await api("/api/ping");
  assert.equal(ping.body.app, "heiss-ui");
  const unknown = await api("/api/no-such-thing");
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error, /Unknown API route/);
});

test("diagnostics name this setup for a bug report", async () => {
  const { body } = await api("/api/diagnostics");
  assert.match(body.text, /^HEISS UI \d+\.\d+\.\d+/);
  assert.match(body.text, /\nComfyUI 0\.34\.1, on this computer; Python 3\.12, PyTorch 2\.8\.0\n/);
  assert.match(body.text, /\nGPU: Fake GPU \[cuda\], 22\.4 GB VRAM/);
  assert.equal(body.text.includes(dataDir), false);
});

test("the page is served and always checked again", { skip: !fs.existsSync(path.join(here, "..", "dist", "index.html")) && "dist/ is not built" }, async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("cache-control"), "no-cache");
});

test("a model ComfyUI lists becomes a ready profile, and a generate request runs it to the gallery", async () => {
  const models = await api("/api/models");
  const profile = models.body.profiles.find((item) => item.model === "sd_xl_base_1.0.safetensors");
  assert.ok(profile, "the checkpoint is offered");
  assert.equal(profile.family, "sdxl");

  const queued = fake.nextPrompt();
  const generate = await api("/api/generate", {
    method: "POST",
    body: {
      ...profile.defaults,
      kind: profile.kind, profileId: profile.id, model: profile.model, workflow: profile.workflow,
      prompt: "a lighthouse in fog", negative: "", count: 1, seed: "42"
    }
  });
  assert.equal(generate.status, 200, JSON.stringify(generate.body));
  const jobId = generate.body.jobId;
  const prompt = await queued;
  assert.equal(prompt.client_id, jobId);
  const save = Object.entries(prompt.prompt).find(([, node]) => node.class_type === "SaveImage")[0];
  fake.finish(prompt.id, { outputs: { [save]: { images: [{ filename: "route_00001_.png", subfolder: "", type: "output" }] } } });

  let job;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    job = (await api(`/api/jobs/${jobId}`)).body;
    if (job.status === "done" || job.status === "error") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(job.status, "done", JSON.stringify(job.failure || job));
  const gallery = await api("/api/gallery?limit=20");
  const item = gallery.body.items.find((entry) => entry.jobId === jobId);
  assert.equal(item.status, "done");
  assert.equal(item.url, "/comfy/view?filename=route_00001_.png&subfolder=&type=output");
});

test("a generate request with no prompt is refused plainly", async () => {
  const models = await api("/api/models");
  const profile = models.body.profiles.find((item) => item.model === "sd_xl_base_1.0.safetensors");
  const refused = await api("/api/generate", { method: "POST", body: { ...profile.defaults, kind: "image", profileId: profile.id, model: profile.model, workflow: profile.workflow, prompt: "   " } });
  assert.equal(refused.status, 400);
  assert.ok(refused.body.error);
});

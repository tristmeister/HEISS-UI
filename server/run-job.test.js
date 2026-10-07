import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startFakeComfy } from "./fixtures/fake-comfy.js";

// A whole run against a stand-in ComfyUI: the graph is queued, progress
// arrives over the socket (Node 22+, where WebSocket is built in; Node 20
// relies on polling alone), history reports the images, and the gallery
// placeholder becomes the finished item.
const fake = await startFakeComfy();
process.env.COMFY_URL = fake.url;
process.env.HEISS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-run-"));
process.env.COMFY_OUTPUT_DIR = "";
const { jobs, runJob } = await import("./jobs.js");
const store = await import("./gallery-store.js");
test.after(() => fake.close());

const socketsBuiltIn = typeof WebSocket === "function";

function sdxlRequest(overrides = {}) {
  return {
    kind: "image", family: "sdxl", variant: "standard", source: "checkpoint", workflow: "family:sdxl",
    profileId: "image:checkpoint:sd_xl_base_1.0.safetensors", model: "sd_xl_base_1.0.safetensors",
    bundled: { encoder: true, vae: true }, encoders: [], vae: "",
    prompt: "a lighthouse in fog", negative: "", width: 1024, height: 1024, count: 1,
    steps: 4, cfg: 7, sampler: "euler", scheduler: "normal", seed: "1234", weightDtype: "default",
    ...overrides
  };
}

function queue(id, body) {
  const items = store.makePendingItems(id, body);
  store.setGallery([...items, ...store.gallery], { persist: false });
  jobs.set(id, { status: "queued", kind: body.kind, prompt: body.prompt, outputs: [], items, startedAt: Date.now() });
}

const waitFor = async (check, what, ms = 5000) => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

test("a run goes from queued through progress to a finished gallery image", async () => {
  const id = "job-success";
  const body = sdxlRequest();
  queue(id, body);
  const queued = fake.nextPrompt();
  const running = runJob(id, body);
  const prompt = await queued;
  assert.equal(prompt.client_id, id, "progress for this run reaches this run's socket");
  const sampler = Object.entries(prompt.prompt).find(([, node]) => node.class_type === "KSampler");
  assert.ok(sampler, "the graph was built and sent");
  assert.equal(sampler[1].inputs.steps, 4);
  assert.equal(sampler[1].inputs.seed, 1234);

  if (socketsBuiltIn) {
    await fake.socketFor(id);
    fake.send(id, { type: "execution_start", data: { prompt_id: prompt.id } });
    fake.send(id, { type: "progress", data: { value: 2, max: 4, prompt_id: prompt.id, node: sampler[0] } });
    await waitFor(() => jobs.get(id)?.progress?.value === 2, "progress from the socket");
    assert.equal(jobs.get(id).status, "running");
    assert.equal(store.gallery.find((item) => item.jobId === id).progress.max, 4);
    assert.equal(jobs.get(id).progress.phase, "Step");
  }

  const save = Object.entries(prompt.prompt).find(([, node]) => node.class_type === "SaveImage")[0];
  fake.finish(prompt.id, { outputs: { [save]: { images: [{ filename: "image_00001_.png", subfolder: "heiss-ui", type: "output" }] } } });
  if (socketsBuiltIn) fake.send(id, { type: "executing", data: { node: null, prompt_id: prompt.id } });
  await running;

  const job = jobs.get(id);
  assert.equal(job.status, "done");
  assert.equal(job.outputs.length, 1);
  const item = store.gallery.find((entry) => entry.jobId === id);
  assert.equal(item.status, "done");
  assert.equal(item.url, "/comfy/view?filename=image_00001_.png&subfolder=heiss-ui&type=output");
  assert.equal(item.thumbnailUrl, "/comfy/thumb?filename=image_00001_.png&subfolder=heiss-ui&type=output");
  assert.equal(item.settings.steps, 4);
});

test("ComfyUI's second 'finished' arriving mid-look still delivers at once, not a poll later", { skip: !socketsBuiltIn }, async () => {
  const id = "job-finished-mid-look";
  const body = sdxlRequest();
  queue(id, body);
  const queued = fake.nextPrompt();
  const running = runJob(id, body);
  const prompt = await queued;
  await fake.socketFor(id);
  const save = Object.entries(prompt.prompt).find(([, node]) => node.class_type === "SaveImage")[0];
  // As ComfyUI does it: "success" before the history is written, "executing null" after,
  // the second landing while HEISS is still asking about the first.
  let finishedAt = 0;
  fake.onHistory(async () => {
    if (finishedAt) return;
    fake.onHistory(null);
    fake.finish(prompt.id, { outputs: { [save]: { images: [{ filename: "image_00002_.png", subfolder: "heiss-ui", type: "output" }] } } });
    finishedAt = Date.now();
    fake.send(id, { type: "executing", data: { node: null, prompt_id: prompt.id } });
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  fake.send(id, { type: "execution_success", data: { prompt_id: prompt.id } });
  await running;
  assert.equal(jobs.get(id).status, "done");
  assert.ok(Date.now() - finishedAt < 800, `delivered ${Date.now() - finishedAt} ms after ComfyUI finished`);
});

test("a run ComfyUI fails is kept as a failure that says why", async () => {
  const id = "job-oom";
  const body = sdxlRequest({ width: 2048, height: 2048 });
  queue(id, body);
  const queued = fake.nextPrompt();
  const running = runJob(id, body);
  const prompt = await queued;
  fake.finish(prompt.id, { error: { exception_message: "Allocation on device 0 would exceed allowed memory. (out of memory)", exception_type: "torch.OutOfMemoryError", node_type: "KSampler", node_id: "5", traceback: ["line 1\n"] } });
  await running;
  const job = jobs.get(id);
  assert.equal(job.status, "error");
  assert.equal(job.failure.title, "The GPU ran out of memory");
  assert.equal(job.failure.nodeType, "KSampler");
  const item = store.gallery.find((entry) => entry.jobId === id);
  assert.equal(item.status, "error");
  assert.equal(item.filename, "The GPU ran out of memory");
});

test("a run that ends without an image is a failure, not a vanished tile", async () => {
  const id = "job-empty";
  const body = sdxlRequest();
  queue(id, body);
  const queued = fake.nextPrompt();
  const running = runJob(id, body);
  const prompt = await queued;
  fake.finish(prompt.id, { outputs: {} });
  await running;
  assert.equal(jobs.get(id).status, "error");
  assert.equal(jobs.get(id).failure.title, "No image was saved");
  assert.equal(store.gallery.filter((entry) => entry.jobId === id).length, 1);
});

test("a cancel while queued takes the prompt back out of ComfyUI's queue", async () => {
  const id = "job-cancel";
  const body = sdxlRequest();
  queue(id, body);
  jobs.set(id, { ...jobs.get(id), status: "canceling" });
  const queued = fake.nextPrompt();
  await runJob(id, body);
  await queued;
  assert.equal(jobs.get(id).status, "canceled");
  assert.equal(store.gallery.find((entry) => entry.jobId === id).status, "canceled");
});

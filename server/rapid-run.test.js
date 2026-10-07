import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startFakeComfy } from "./fixtures/fake-comfy.js";

// A Rapid run end to end against a stand-in ComfyUI: the graph carries HEISS
// Rapid and Rapid Guidance, the node's own report arrives on the progress
// socket, and the finished picture records whether Rapid really ran.
const fake = await startFakeComfy();
process.env.COMFY_URL = fake.url;
process.env.HEISS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-rapid-run-"));
process.env.COMFY_OUTPUT_DIR = "";
const { jobs, runJob } = await import("./jobs.js");
const store = await import("./gallery-store.js");
test.after(() => fake.close());

const request = (overrides = {}) => ({
  kind: "image", family: "sdxl", variant: "standard", source: "checkpoint", workflow: "family:sdxl",
  profileId: "image:checkpoint:sd_xl_base_1.0.safetensors", model: "sd_xl_base_1.0.safetensors",
  bundled: { encoder: true, vae: true }, encoders: [], vae: "",
  prompt: "a lighthouse in fog", negative: "blurry", width: 1024, height: 1024, count: 1,
  steps: 25, cfg: 7, sampler: "dpmpp_2m", scheduler: "karras", seed: "1234", weightDtype: "default",
  rapid: { at: 0.6, smooth: true }, rapidGuidance: { until: 0.3 },
  ...overrides
});

async function run(id, body, report) {
  const items = store.makePendingItems(id, body);
  store.setGallery([...items, ...store.gallery], { persist: false });
  jobs.set(id, { status: "queued", kind: body.kind, prompt: body.prompt, outputs: [], items, startedAt: Date.now() });
  const queued = fake.nextPrompt();
  const running = runJob(id, body);
  const prompt = await queued;
  if (typeof WebSocket === "function") {
    await fake.socketFor(id);
    fake.send(id, { type: "execution_start", data: { prompt_id: prompt.id } });
    if (report) fake.send(id, { type: "heiss.rapid", data: { ...report, prompt_id: prompt.id } });
  }
  const save = Object.entries(prompt.prompt).find(([, node]) => node.class_type === "SaveImage")[0];
  fake.finish(prompt.id, { outputs: { [save]: { images: [{ filename: `${id}.png`, subfolder: "heiss-ui", type: "output" }] } } });
  if (typeof WebSocket === "function") fake.send(id, { type: "executing", data: { node: null, prompt_id: prompt.id } });
  await running;
  return { prompt, item: store.gallery.find((entry) => entry.jobId === id) };
}

const types = (graph) => Object.values(graph).map((node) => node.class_type);

test("a Rapid run sends both nodes and records that Rapid made the picture", async () => {
  const { prompt, item } = await run("rapid-on", request(), { active: true, small_steps: 11, full_steps: 14 });
  assert.ok(types(prompt.prompt).includes("HeissRapid"));
  assert.ok(types(prompt.prompt).includes("HeissRapidGuidance"));
  assert.ok(!types(prompt.prompt).includes("KSampler"));
  assert.equal(item.status, "done");
  assert.equal(item.settings.rapid, true);
  assert.equal(item.settings.rapidGuidance, true);
});

test("when Rapid steps aside, the picture says so and why", { skip: typeof WebSocket !== "function" }, async () => {
  const { item } = await run("rapid-aside", request(), { active: false, reason: "too few steps (1)" });
  assert.equal(item.settings.rapid, undefined);
  assert.equal(item.settings.rapidSkipped, "too few steps (1)");
});

test("without Rapid the graph is the plain KSampler one", async () => {
  const { prompt, item } = await run("rapid-off", request({ rapid: null, rapidGuidance: null }));
  assert.ok(types(prompt.prompt).includes("KSampler"));
  assert.ok(!types(prompt.prompt).some((type) => type.startsWith("HeissRapid")));
  assert.equal(item.settings.rapid, undefined);
});

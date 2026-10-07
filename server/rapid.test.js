import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Each test file runs in its own process, so these folders stay here.
process.env.COMFY_OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-output-"));
process.env.HEISS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-data-"));
const { familyGraph } = await import("./family-graph.js");
const { families, rapidFor } = await import("./family-catalog.js");
const { rapidCapability } = await import("./family-profiles.js");
const { sanitizeRapid } = await import("./validation.js");
const { generationSettings } = await import("./gallery-store.js");
const { addRun, estimateRun } = await import("./generation-timing.js");
const { parametersText } = await import("./civitai.js");
const { nodePack } = await import("./node-packs.js");

const byType = (graph, type) => Object.entries(graph).filter(([, node]) => node.class_type === type);
const one = (graph, type) => {
  const found = byType(graph, type);
  assert.equal(found.length, 1, `one ${type}`);
  return found[0];
};
const rapid = { at: 0.7, smooth: true };
const withRapid = { HeissRapid: { input: { required: {} } } };

/* ------------------------------------------------------------ graphs */

test("a KSampler family samples through its own pieces with Rapid on, and is untouched with it off", () => {
  const body = { family: "zimage", variant: "turbo", source: "unet", model: "z.safetensors", encoders: ["qwen_3_4b.safetensors"], vae: "ae.safetensors", prompt: "a cat", negative: "blurry", width: 1024, height: 1024, steps: 8, cfg: 1, sampler: "res_multistep", scheduler: "simple", seed: 42 };
  const plain = familyGraph(body);
  assert.equal(byType(plain, "KSampler").length, 1);
  assert.equal(byType(plain, "HeissRapid").length, 0);

  const graph = familyGraph({ ...body, rapid });
  assert.equal(byType(graph, "KSampler").length, 0);
  const [selectId, select] = one(graph, "KSamplerSelect");
  const [rapidId, node] = one(graph, "HeissRapid");
  const [, sampler] = one(graph, "SamplerCustomAdvanced");
  assert.equal(select.inputs.sampler_name, "res_multistep");
  assert.deepEqual(node.inputs, { sampler: [selectId, 0], switch_at: 0.7, scale: 0.5, min_full_steps: 2, smooth_switch: true });
  assert.deepEqual(sampler.inputs.sampler, [rapidId, 0]);
  // KSampler's own noise, guidance and schedule.
  assert.equal(one(graph, "RandomNoise")[1].inputs.noise_seed, 42);
  const [, guider] = one(graph, "CFGGuider");
  assert.equal(guider.inputs.cfg, 1);
  const [, schedule] = one(graph, "BasicScheduler");
  assert.deepEqual([schedule.inputs.scheduler, schedule.inputs.steps, schedule.inputs.denoise], ["simple", 8, 1]);
  const [modelId] = byType(graph, "UNETLoader")[0];
  assert.deepEqual(schedule.inputs.model, [modelId, 0]);
});

test("a custom-sampler family gets Rapid between its sampler choice and the sampler", () => {
  const body = { family: "flux2_klein_4b", variant: "distilled", source: "unet", model: "k.safetensors", encoders: ["qwen_3_4b.safetensors"], vae: "flux2-vae.safetensors", prompt: "a cat", width: 1024, height: 1024, steps: 4, cfg: 1, seed: 1, rapid: { at: 0.75, smooth: false } };
  const graph = familyGraph(body);
  const [rapidId, node] = one(graph, "HeissRapid");
  assert.deepEqual([node.inputs.switch_at, node.inputs.smooth_switch], [0.75, false]);
  assert.deepEqual(one(graph, "SamplerCustomAdvanced")[1].inputs.sampler, [rapidId, 0]);
  assert.equal(byType(graph, "Flux2Scheduler").length, 1, "its own scheduler stays");
});

test("SDXL with Rapid keeps its sampler, scheduler and CFG", () => {
  const graph = familyGraph({ family: "sdxl", variant: "standard", source: "checkpoint", bundled: { encoder: true, vae: true }, model: "juggernautXL.safetensors", prompt: "a cat", negative: "ugly", width: 1024, height: 1024, steps: 25, cfg: 7, sampler: "dpmpp_2m", scheduler: "karras", seed: 9, rapid: { at: 0.6, smooth: true } });
  assert.equal(one(graph, "KSamplerSelect")[1].inputs.sampler_name, "dpmpp_2m");
  assert.equal(one(graph, "BasicScheduler")[1].inputs.scheduler, "karras");
  assert.equal(one(graph, "CFGGuider")[1].inputs.cfg, 7);
  assert.equal(one(graph, "HeissRapid")[1].inputs.switch_at, 0.6);
});

/* ------------------------------------------------------------ which models */

test("Rapid is for the families measured for it, never few-step distills, video or own graphs", () => {
  const variant = (familyId, id) => families[familyId].variants.find((item) => item.id === id);
  assert.equal(rapidCapability(families.krea2, variant("krea2", "turbo"), withRapid), "ready");
  assert.equal(rapidCapability(families.krea2, variant("krea2", "turbo"), {}), "install");
  assert.equal(rapidCapability(families.sdxl, variant("sdxl", "pony"), withRapid), "ready");
  for (const id of ["turbo", "hyper", "dmd2", "lcm", "lightning"]) assert.equal(rapidCapability(families.sdxl, variant("sdxl", id), withRapid), false, `SDXL ${id}`);
  assert.equal(rapidCapability(families.sd15, families.sd15.variants[0], withRapid), false, "SD 1.5 is too small to halve");
  assert.equal(rapidCapability(families.wan22_14b, families.wan22_14b.variants[0], withRapid), false, "video waits");
  assert.equal(rapidCapability(families.minimax_h3, families.minimax_h3.variants[0], withRapid), false);
  for (const [id, family] of Object.entries(families)) {
    for (const item of family.variants) {
      const spec = rapidFor(family, item);
      if (spec) assert.ok(spec.at >= 0.3 && spec.at <= 0.99, `${id}/${item.id} switch point ${spec.at}`);
      if (spec) assert.equal(family.kind, "image", `${id} is not an image family`);
    }
  }
});

test("validation keeps Rapid only for a text-to-image run of a ready model", () => {
  const profile = { kind: "image", family: "krea2", variant: "turbo", capabilities: { rapid: "ready" } };
  const plain = { referenceAssets: [], inpaint: null };
  assert.deepEqual(sanitizeRapid({ rapid: true }, profile, plain), { at: 0.7, smooth: true });
  assert.equal(sanitizeRapid({}, profile, plain), null, "only when asked for");
  assert.equal(sanitizeRapid({ rapid: "yes" }, profile, plain), null);
  assert.equal(sanitizeRapid({ rapid: true }, { ...profile, capabilities: { rapid: "install" } }, plain), null);
  assert.equal(sanitizeRapid({ rapid: true }, profile, { referenceAssets: [{ slot: "reference" }], inpaint: null }), null, "a start picture sets the layout");
  assert.equal(sanitizeRapid({ rapid: true }, profile, { referenceAssets: [], inpaint: { crop: "c.png" } }), null);
  assert.equal(sanitizeRapid({ rapid: true, startImageId: "x" }, profile, plain), null);
  // The benchmark's knobs.
  assert.deepEqual(sanitizeRapid({ rapid: true, rapidAt: 0.85, rapidSmooth: false }, profile, plain), { at: 0.85, smooth: false });
  assert.deepEqual(sanitizeRapid({ rapid: true, rapidAt: 5 }, profile, plain), { at: 0.7, smooth: true }, "out of range falls back");
});

/* ------------------------------------------------------------ records */

test("a picture records that Rapid made it, or why it stepped aside", () => {
  const body = { kind: "image", workflow: "family:krea2", seed: "123", rapid };
  assert.equal(generationSettings(body).rapid, true);
  assert.equal(generationSettings({ ...body, rapidReport: { active: true } }).rapid, true);
  const skipped = generationSettings({ ...body, rapidReport: { active: false, reason: "too few steps (1)" } });
  assert.equal(skipped.rapid, undefined);
  assert.equal(skipped.rapidSkipped, "too few steps (1)");
  assert.equal(generationSettings({ kind: "image", seed: "123" }).rapid, undefined);
});

test("time estimates keep Rapid runs apart while there are enough of each", () => {
  const body = { kind: "image", model: "krea2.safetensors", width: 1024, height: 1024, steps: 8 };
  let history = [];
  const run = (ms, rapidOn) => {
    history = addRun(history, { body: { ...body, ...(rapidOn ? { rapid } : {}) }, result: { runMs: ms, stepMs: ms / 8, steps: 8, setupMs: 0, tailMs: 0 } });
  };
  for (let i = 0; i < 3; i++) run(8000, false);
  assert.ok(Math.abs(estimateRun(history, { ...body, rapid }).totalMs - 8000) < 50, "too few Rapid runs: the others stand in");
  for (let i = 0; i < 3; i++) run(4000, true);
  assert.ok(Math.abs(estimateRun(history, { ...body, rapid }).totalMs - 4000) < 50);
  assert.ok(Math.abs(estimateRun(history, body).totalMs - 8000) < 50);
  assert.equal(history.at(-1).rapid, true);
  const skipped = addRun([], { body: { ...body, rapid, rapidReport: { active: false } }, result: { runMs: 8000 } });
  assert.equal(skipped[0].rapid, undefined, "a run Rapid stepped aside from counts as a plain one");
});

test("the A1111 parameters say Rapid made it", () => {
  assert.match(parametersText({ prompt: "a cat", seed: "5", steps: 8, rapid }), /HEISS Rapid: switch 0\.7/);
  assert.doesNotMatch(parametersText({ prompt: "a cat", seed: "5", steps: 8, rapid, rapidReport: { active: false } }), /Rapid/);
});

test("HEISS UI Nodes is a pinned pack like every other", () => {
  const pack = nodePack("heiss");
  assert.match(pack.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(pack.nodes, ["HeissRapid"]);
  assert.equal(pack.repository, "https://github.com/tristmeister/ComfyUI-HEISS-UI-Nodes.git");
});

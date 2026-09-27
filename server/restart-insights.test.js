import test from "node:test";
import assert from "node:assert/strict";
import { addRestartSample, failedPacks, loadedPacks, logTextFromRaw, packLabel, restartChanges, restartEstimate, RESTART_SAMPLES } from "./restart-insights.js";

const samples = (...values) => values.map((ms, index) => ({ at: String(index), ms }));

test("no estimate until three restarts agree", () => {
  assert.equal(restartEstimate([]), null);
  assert.equal(restartEstimate(samples(18_000, 19_000)), null);
  assert.deepEqual(restartEstimate(samples(18_000, 19_000, 21_000)), { typicalMs: 19_000, samples: 3 });
});

test("a slow one-off changes nothing, restarts all over the place give no estimate", () => {
  assert.equal(restartEstimate(samples(18_000, 19_000, 20_000, 95_000)).typicalMs, 19_000);
  assert.equal(restartEstimate(samples(5_000, 20_000, 60_000)), null);
  assert.equal(restartEstimate(samples(10_000, 11_000, 12_000, 40_000, 45_000, 50_000)), null);
});

test("the history keeps the latest restarts and ignores nonsense", () => {
  let history = [];
  for (let index = 0; index < RESTART_SAMPLES + 3; index += 1) history = addRestartSample(history, { at: String(index), ms: 1000 + index });
  assert.equal(history.length, RESTART_SAMPLES);
  assert.equal(history[0].ms, 1003);
  assert.equal(addRestartSample(history, { ms: 0 }), history);
  assert.equal(addRestartSample(history, { ms: "soon" }), history);
});

test("loaded packs come from each custom node's module", () => {
  const info = {
    KSampler: { python_module: "nodes" },
    SaveWEBM: { python_module: "comfy_extras.nodes_video" },
    FaceDetailer: { python_module: "custom_nodes.ComfyUI-Impact-Pack" },
    SAMLoader: { python_module: "custom_nodes.ComfyUI-Impact-Pack.modules" },
    "Power Lora Loader (rgthree)": { python_module: "custom_nodes.rgthree-comfy" },
    Broken: {}
  };
  assert.deepEqual(loadedPacks(info), ["ComfyUI-Impact-Pack", "rgthree-comfy"]);
  assert.deepEqual(loadedPacks(null), []);
});

test("failed packs are read from ComfyUI's startup tables", () => {
  const log = logTextFromRaw({ entries: [
    { t: "1", m: "\nImport times for custom nodes:\n" },
    { t: "2", m: "   0.0 seconds: /Users/me/ComfyUI/custom_nodes/websocket_image_save.py\n" },
    { t: "3", m: "   0.4 seconds (IMPORT FAILED): /Users/me/ComfyUI/custom_nodes/ComfyUI-Impact-Pack\n" },
    { t: "4", m: "   0.1 seconds (PRESTARTUP FAILED): C:\\ComfyUI\\custom_nodes\\comfyui-easy-use\\\n" },
    { t: "5", m: "   1.2 seconds: /Users/me/ComfyUI/custom_nodes/rgthree-comfy\n" }
  ] });
  assert.deepEqual(failedPacks(log), ["ComfyUI-Impact-Pack", "comfyui-easy-use"]);
  assert.deepEqual(failedPacks(""), []);
  assert.equal(logTextFromRaw(null), "");
});

test("packs read as names", () => {
  assert.equal(packLabel("ComfyUI-Impact-Pack"), "ComfyUI Impact Pack");
  assert.equal(packLabel("comfyui-easy-use"), "Easy Use");
  assert.equal(packLabel("rgthree-comfy"), "rgthree");
  assert.equal(packLabel("ComfyUI_ExtraModels"), "ComfyUI_ExtraModels");
});

test("only a restart that changed nothing is plain", () => {
  const before = ["a", "b"];
  assert.deepEqual(restartChanges(before, ["a", "b"], []), { newPacks: [], failedPacks: [], plain: true });
  assert.deepEqual(restartChanges(before, ["a", "b", "c"], []), { newPacks: ["c"], failedPacks: [], plain: false });
  assert.equal(restartChanges(before, ["a"], []).plain, false, "a pack went away");
  assert.deepEqual(restartChanges(before, ["a", "b"], ["d"]), { newPacks: [], failedPacks: ["d"], plain: false });
  assert.equal(restartChanges(null, ["a"], []).plain, false, "nothing to compare with");
});

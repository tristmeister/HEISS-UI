import assert from "node:assert/strict";
import test from "node:test";
import { graphFromJson, metadataFromJson } from "./custom-workflows.js";

test("visual workflow conversion prefers named widgets and ignores UI-only widget values", () => {
  const raw = {
    nodes: [{
      id: 373,
      type: "KSampler",
      inputs: [],
      widgets_values: [123, "randomize", 2, 1, "euler", "simple", 1],
      widgets_values_named: {
        seed: 123,
        control_after_generate: "randomize",
        steps: 2,
        cfg: 1,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1
      }
    }],
    links: []
  };
  const info = {
    KSampler: { input: { required: {
      seed: ["INT"], steps: ["INT"], cfg: ["FLOAT"], sampler_name: [["euler"]], scheduler: [["simple"]], denoise: ["FLOAT"]
    } } }
  };
  assert.deepEqual(graphFromJson(raw, info)["373"].inputs, {
    seed: 123, steps: 2, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1
  });
});

test("legacy start image metadata is normalized into a media input", () => {
  const workflow = metadataFromJson({
    jAiStudio: {
      id: "legacy-edit",
      controls: { prompt: { node: "2", input: "prompt" }, startImage: { node: "1", input: "image" } },
      capabilities: { startImageRequired: true }
    },
    "1": { class_type: "LoadImage", inputs: { image: "example.png" } },
    "2": { class_type: "TextEncodeQwenImageEditPlus", inputs: { prompt: "", image1: ["1", 0] } },
    "3": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "test" } }
  });
  assert.equal(workflow.capabilities.imageToImage, true);
  assert.equal(workflow.capabilities.startImageRequired, true);
  assert.deepEqual(workflow.mediaInputs[0].control, { node: "1", input: "image" });
});

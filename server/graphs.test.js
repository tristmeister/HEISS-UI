import assert from "node:assert/strict";
import test from "node:test";
import { composeWorkflowPrompt, customWorkflowGraph } from "./graphs.js";

test("workflow prompt policy remains separate from the user edit", () => {
  const composed = composeWorkflowPrompt({ promptComposition: {
    prefix: "Edit: ", suffix: "Keep everything else the same.", policy: "preserve-v1", version: 1
  } }, "Remove the hat");
  assert.equal(composed, "Edit: Remove the hat\n\nKeep everything else the same.");
});

test("bundled Flux edit graph binds its reference, prompt policy, and rgthree LoRAs", async () => {
  const graph = await customWorkflowGraph({
    workflow: "custom:flux2-real-dream-image-edit",
    prompt: "Remove the hat",
    width: 1216,
    height: 1536,
    steps: 2,
    cfg: 1,
    denoise: 1,
    sampler: "euler",
    scheduler: "simple",
    seed: 42,
    referenceAssets: [{ slot: "reference", assetId: "asset-1", comfyName: "staged-reference.png" }],
    loras: [{ name: "style.safetensors", enabled: true, strength: 0.7 }]
  });
  assert.equal(graph["369"].inputs.image, "staged-reference.png");
  assert.match(graph["372"].inputs.prompt, /^Edit: Remove the hat\n\nKeep the rest of the image exactly the same:/);
  assert.equal(graph["374"].inputs.lora_01, "style.safetensors");
  assert.equal(graph["374"].inputs.strength_01, 0.7);
  assert.equal(graph["374"].inputs.lora_02, "None");
});

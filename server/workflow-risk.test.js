import assert from "node:assert/strict";
import test from "node:test";
import { workflowRisks } from "./workflow-risk.js";
import { previewWorkflowImport } from "./workflow-catalog.js";

const plain = {
  1: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sdxl.safetensors" } },
  2: { class_type: "CLIPTextEncode", inputs: { text: "a cat", clip: ["1", 1] } },
  3: { class_type: "SaveImage", inputs: { images: ["4", 0], filename_prefix: "heiss-ui/image" } },
  4: { class_type: "LoadImage", inputs: { image: "photo.png" } }
};

test("an ordinary workflow raises nothing", () => {
  assert.deepEqual(workflowRisks(plain), []);
});

test("nodes that run code, touch files elsewhere or go online are named, worst first", () => {
  const risky = {
    ...plain,
    10: { class_type: "Image Save", inputs: { output_path: "/Users/me/.ssh", images: ["4", 0] } },
    11: { class_type: "Evaluate Integers", inputs: { python_expression: "__import__('os').system('x')" }, _meta: { title: "Math" } },
    12: { class_type: "LoadImageFromUrl", inputs: { url: "https://example.test/a.png" } },
    13: { class_type: "SomePackRunPython", inputs: { code: "print(1)" } },
    14: { class_type: "Something Custom", inputs: { directory: "..\\..\\Windows" } },
    15: { class_type: "VHS_LoadVideoPath", inputs: { video: "C:\\Users\\me\\clip.mp4" } }
  };
  const risks = workflowRisks(risky);
  assert.deepEqual(risks.map((risk) => [risk.node, risk.kind]), [["11", "code"], ["13", "code"], ["10", "files"], ["14", "files"], ["15", "files"], ["12", "network"]]);
  assert.equal(risks[0].title, "Math");
  assert.match(risks.find((risk) => risk.node === "10").detail, /\/Users\/me\/\.ssh/);
  assert.equal(risks.find((risk) => risk.node === "13").detail, "its code is in the workflow");
});

test("the import review carries them", () => {
  const preview = previewWorkflowImport({ ...plain, 9: { class_type: "Shell", inputs: { command: "rm -rf ~" } } }, "risky.json", {});
  assert.deepEqual(preview.risks.map((risk) => risk.classType), ["Shell"]);
});

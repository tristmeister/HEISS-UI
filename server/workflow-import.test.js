import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

process.env.HEISS_DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "heiss-import-"));

const { convertVisualWorkflow, flattenVisual } = await import("./workflow-convert.js");
const { understandWorkflow } = await import("./workflow-understand.js");
const { recentFromHistory, importFromHistory, unwrapWorkflow, workflowFromMedia, workflowShape, savedWorkflowList } = await import("./workflow-sources.js");
const { packStamps, reduceNodeMap, resolveMissingNodes } = await import("./workflow-packs.js");
const { prepareImport } = await import("./workflow-import.js");
const { applyWorkflowSettings, bypassLoraNode } = await import("./graphs.js");
const { installHealth, packageRestorePlan, parseFreeze } = await import("./install-safety.js");

// fileURLToPath decodes the URL, so a folder name with a space (HEISS AI) still resolves.
const here = path.dirname(fileURLToPath(import.meta.url));
const info = JSON.parse(fs.readFileSync(path.join(here, "fixtures/object_info-comfyui-0.34.1.json"), "utf8"));
const corpusDir = path.join(here, "fixtures/workflows");
const expected = JSON.parse(fs.readFileSync(path.join(corpusDir, "expected.json"), "utf8"));
const keys = (mapping) => (mapping ? [].concat(mapping).map((item) => `${item.node}.${item.input}`) : []);

test("every workflow in the corpus converts and is read the way expected.json says", () => {
  for (const [file, want] of Object.entries(expected)) {
    const { graph } = convertVisualWorkflow(JSON.parse(fs.readFileSync(path.join(corpusDir, file), "utf8")), info);
    const found = understandWorkflow(graph, { info });
    assert.equal(found.kind, want.kind, `${file}: kind`);
    assert.deepEqual(keys(found.controls.prompt), want.prompt, `${file}: prompt`);
    assert.deepEqual(keys(found.controls.negative), want.negative, `${file}: negative`);
    assert.deepEqual(keys(found.controls.seed), want.seed, `${file}: seed`);
    assert.deepEqual(found.controls.width ? [keys(found.controls.width)[0], keys(found.controls.height)[0]] : null, want.size, `${file}: size`);
    assert.equal(found.aspectPolicy, want.aspect, `${file}: aspect`);
    assert.deepEqual(found.mediaInputs.map((item) => item.control.node), want.images, `${file}: images`);
  }
});

// A small canvas workflow, built by hand for the cases the corpus doesn't pin down.
function canvas(nodes, links, extra = {}) {
  return { nodes, links, ...extra };
}
const input = (name, type, link = null, widget = false) => ({ name, type, link, ...(widget ? { widget: { name } } : {}) });
const output = (name, type, links = []) => ({ name, type, links });

test("seed widgets skip the 'control after generate' value; image pickers skip the upload value", () => {
  const { graph } = convertVisualWorkflow(canvas([
    { id: 1, type: "KSampler", inputs: [], outputs: [], widgets_values: [42, "randomize", 20, 7, "euler", "normal", 1] },
    { id: 2, type: "LoadImage", inputs: [], outputs: [], widgets_values: ["cat.png", "image"] }
  ], []), info);
  assert.deepEqual(graph["1"].inputs, { seed: 42, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1 });
  assert.deepEqual(graph["2"].inputs, { image: "cat.png" });
});

test("bypassed nodes pass their input through, muted nodes and notes drop out, Reroute and Set/Get resolve", () => {
  const { graph } = convertVisualWorkflow(canvas([
    { id: 1, type: "CheckpointLoaderSimple", inputs: [], outputs: [output("MODEL", "MODEL", [1]), output("CLIP", "CLIP", []), output("VAE", "VAE", [])], widgets_values: ["a.safetensors"] },
    { id: 2, type: "LoraLoaderModelOnly", mode: 4, inputs: [input("model", "MODEL", 1)], outputs: [output("MODEL", "MODEL", [2])], widgets_values: ["l.safetensors", 1] },
    { id: 3, type: "Reroute", inputs: [input("", "*", 2)], outputs: [output("", "MODEL", [3])] },
    { id: 4, type: "SetNode", inputs: [input("MODEL", "MODEL", 3)], outputs: [], widgets_values: ["base"] },
    { id: 5, type: "GetNode", inputs: [], outputs: [output("MODEL", "MODEL", [4])], widgets_values: ["base"] },
    { id: 6, type: "ModelSamplingFlux", inputs: [input("model", "MODEL", 4)], outputs: [], widgets_values: [1.15, 0.5, 1024, 1024] },
    { id: 7, type: "Note", inputs: [], outputs: [], widgets_values: ["hello"] },
    { id: 8, type: "SaveImage", mode: 2, inputs: [], outputs: [], widgets_values: ["x"] }
  ], [[1, 1, 0, 2, 0, "MODEL"], [2, 2, 0, 3, 0, "MODEL"], [3, 3, 0, 4, 0, "MODEL"], [4, 5, 0, 6, 0, "MODEL"]]), info);
  assert.deepEqual(Object.keys(graph).sort(), ["1", "6"]);
  assert.deepEqual(graph["6"].inputs.model, ["1", 0]);
});

test("a Primitive node's value is written into the widget it feeds", () => {
  const { graph } = convertVisualWorkflow(canvas([
    { id: 1, type: "PrimitiveNode", inputs: [], outputs: [output("INT", "INT", [1])], widgets_values: [768, "fixed"] },
    { id: 2, type: "EmptyLatentImage", inputs: [input("width", "INT", 1, true)], outputs: [], widgets_values: [512, 512, 1] }
  ], [[1, 1, 0, 2, 0, "INT"]]), info);
  assert.equal(graph["2"].inputs.width, 768);
  assert.equal(graph["2"].inputs.height, 512);
});

test("subgraphs expand into prefixed nodes wired to the outside, nested ones too", () => {
  const inner = {
    id: "sub-a",
    nodes: [{ id: 5, type: "CLIPTextEncode", inputs: [input("clip", "CLIP", 11)], outputs: [output("CONDITIONING", "CONDITIONING", [12])], widgets_values: ["a red fox"] }],
    links: [{ id: 11, origin_id: -10, origin_slot: 0, target_id: 5, target_slot: 0, type: "CLIP" }, { id: 12, origin_id: 5, origin_slot: 0, target_id: -20, target_slot: 0, type: "CONDITIONING" }]
  };
  const raw = canvas([
    { id: 1, type: "CLIPLoader", inputs: [], outputs: [output("CLIP", "CLIP", [1])], widgets_values: ["t5.safetensors", "flux", "default"] },
    { id: 2, type: "sub-a", inputs: [input("clip", "CLIP", 1)], outputs: [output("CONDITIONING", "CONDITIONING", [2])] },
    { id: 3, type: "FluxGuidance", inputs: [input("conditioning", "CONDITIONING", 2)], outputs: [], widgets_values: [3.5] }
  ], [[1, 1, 0, 2, 0, "CLIP"], [2, 2, 0, 3, 0, "CONDITIONING"]], { definitions: { subgraphs: [inner] } });
  const flat = flattenVisual(raw);
  assert.ok(flat.nodes.some((node) => node.id === "2:5"));
  const { graph } = convertVisualWorkflow(raw, info);
  assert.deepEqual(graph["2:5"].inputs.clip, ["1", 0]);
  assert.deepEqual(graph["3"].inputs.conditioning, ["2:5", 0]);
});

// API graphs for detection cases.
const base = () => ({
  1: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sdxl.safetensors" } },
  2: { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
  3: { class_type: "KSampler", inputs: { seed: 5, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["1", 0], positive: ["10", 0], negative: ["11", 0], latent_image: ["2", 0] } },
  4: { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["1", 2] } },
  5: { class_type: "SaveImage", inputs: { images: ["4", 0], filename_prefix: "x" } },
  11: { class_type: "CLIPTextEncode", inputs: { text: "blurry, lowres", clip: ["1", 1] } }
});

test("a prompt enhancer is walked through to the text the person typed, not its system prompt", () => {
  const graph = {
    ...base(),
    20: { class_type: "PrimitiveStringMultiline", inputs: { value: "a fox in the snow at golden hour" }, _meta: { title: "Your idea" } },
    21: { class_type: "OllamaGenerate", inputs: { system: "You are a prompt writer. Rewrite the user's idea into a detailed prompt. Output only the prompt.", prompt: ["20", 0], model: "llama3" } },
    10: { class_type: "CLIPTextEncode", inputs: { text: ["21", 0], clip: ["1", 1] } }
  };
  const found = understandWorkflow(graph, {});
  assert.deepEqual(keys(found.controls.prompt), ["20.value"]);
  assert.equal(found.confidence.prompt, "high");
  assert.deepEqual(keys(found.controls.negative), ["11.text"]);
});

test("two equally likely texts ask the person, showing the texts themselves", () => {
  const graph = {
    ...base(),
    20: { class_type: "StringConstant", inputs: { string: "masterpiece, best quality" } },
    21: { class_type: "StringConstant", inputs: { string: "a lighthouse on a cliff" } },
    22: { class_type: "StringConcatenate", inputs: { string_a: ["20", 0], string_b: ["21", 0], delimiter: ", " } },
    10: { class_type: "CLIPTextEncode", inputs: { text: ["22", 0], clip: ["1", 1] } }
  };
  const found = understandWorkflow(graph, {});
  assert.equal(found.confidence.prompt, "asked");
  assert.deepEqual(found.question.candidates.map((item) => item.text).sort(), ["a lighthouse on a cliff", "masterpiece, best quality"]);
});

test("earlier runs settle it: the text that changed between runs is the prompt", () => {
  const graph = {
    ...base(),
    20: { class_type: "StringConstant", inputs: { string: "masterpiece, best quality" } },
    21: { class_type: "StringConstant", inputs: { string: "a lighthouse on a cliff" } },
    22: { class_type: "StringConcatenate", inputs: { string_a: ["20", 0], string_b: ["21", 0], delimiter: ", " } },
    10: { class_type: "CLIPTextEncode", inputs: { text: ["22", 0], clip: ["1", 1] } }
  };
  const variant = JSON.parse(JSON.stringify(graph));
  variant[21].inputs.string = "a castle at night";
  const found = understandWorkflow(graph, { variants: [variant, JSON.parse(JSON.stringify(variant))] });
  assert.equal(found.confidence.prompt, "high");
  assert.deepEqual(keys(found.controls.prompt), ["21.string"]);
});

test("ControlNet apply nodes don't leak the negative text into the prompt", () => {
  const graph = {
    ...base(),
    10: { class_type: "CLIPTextEncode", inputs: { text: "a red car", clip: ["1", 1] } },
    12: { class_type: "ControlNetApplyAdvanced", inputs: { positive: ["10", 0], negative: ["11", 0], control_net: ["13", 0], image: ["14", 0], strength: 1, start_percent: 0, end_percent: 1 } },
    13: { class_type: "ControlNetLoader", inputs: { control_net_name: "cn.safetensors" } },
    14: { class_type: "LoadImage", inputs: { image: "pose.png" } }
  };
  graph[3].inputs.positive = ["12", 0];
  graph[3].inputs.negative = ["12", 1];
  const found = understandWorkflow(graph, { info });
  assert.deepEqual(keys(found.controls.prompt), ["10.text"]);
  assert.deepEqual(keys(found.controls.negative), ["11.text"]);
  assert.equal(found.mediaInputs[0].role, "reference");
});

test("More settings lists the other knobs and applying them keeps their types", () => {
  const graph = { ...base(), 10: { class_type: "CLIPTextEncode", inputs: { text: "x", clip: ["1", 1] } }, 6: { class_type: "FreeU_V2", inputs: { model: ["1", 0], b1: 1.3, b2: 1.4, s1: 0.9, s2: 0.2 } } };
  graph[3].inputs.model = ["6", 0];
  const found = understandWorkflow(graph, { info });
  const b1 = found.settings.find((item) => item.key === "6.b1");
  assert.equal(b1.type, "FLOAT");
  const workflow = { settings: found.settings };
  const out = applyWorkflowSettings(JSON.parse(JSON.stringify(graph)), workflow, { "6.b1": "1.1", "6.unknown": 3 });
  assert.equal(out[6].inputs.b1, 1.1);
});

test("a skipped LoRA is wired around", () => {
  const graph = { ...base(), 7: { class_type: "LoraLoader", inputs: { lora_name: "gone.safetensors", strength_model: 1, strength_clip: 1, model: ["1", 0], clip: ["1", 1] } } };
  graph[3].inputs.model = ["7", 0];
  graph[11].inputs.clip = ["7", 1];
  bypassLoraNode(graph, "7");
  assert.equal(graph[7], undefined);
  assert.deepEqual(graph[3].inputs.model, ["1", 0]);
  assert.deepEqual(graph[11].inputs.clip, ["1", 1]);
});

function pngWithText(chunks) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };
  const parts = [signature, chunk("IHDR", Buffer.alloc(13))];
  for (const [keyword, value, compressed] of chunks) {
    parts.push(compressed
      ? chunk("zTXt", Buffer.concat([Buffer.from(`${keyword}\0\0`, "latin1"), zlib.deflateSync(Buffer.from(value))]))
      : chunk("tEXt", Buffer.from(`${keyword}\0${value}`, "latin1")));
  }
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

test("the workflow and prompt come out of a ComfyUI PNG and a WebP's EXIF text", () => {
  const prompt = JSON.stringify(base());
  const workflow = JSON.stringify({ nodes: [{ id: 1, type: "SaveImage" }], links: [] });
  const png = workflowFromMedia(pngWithText([["prompt", prompt], ["workflow", workflow, true]]));
  assert.ok(png.api?.["3"]);
  assert.equal(png.visual?.nodes.length, 1);
  const webp = workflowFromMedia(Buffer.concat([Buffer.from("RIFF....WEBPVP8 ...EXIF..."), Buffer.from(`prompt:${prompt}\0workflow:${workflow}\0`)]));
  assert.ok(webp.api?.["5"]);
  assert.ok(webp.visual);
  assert.deepEqual(workflowFromMedia(Buffer.from("just a jpeg, nothing here at all")), { visual: null, api: null });
});

test("unwrapWorkflow reads every shape ComfyUI hands out", () => {
  const api = base();
  assert.ok(unwrapWorkflow(api).api);
  assert.ok(unwrapWorkflow({ prompt: api }).api);
  assert.ok(unwrapWorkflow({ output: api }).api);
  assert.ok(unwrapWorkflow(JSON.stringify({ nodes: [], links: [] })).visual);
  assert.ok(unwrapWorkflow({ workflow: { nodes: [], links: [] } }).visual);
});

function historyEntry(id, number, text, at) {
  const api = { ...base(), 10: { class_type: "CLIPTextEncode", inputs: { text, clip: ["1", 1] } } };
  return [id, {
    prompt: [number, id, api, { extra_pnginfo: { workflow: { nodes: [], links: [] } } }, ["5"]],
    outputs: { 5: { images: [{ filename: `${id}.png`, subfolder: "", type: "output" }] } },
    status: { status_str: "success", messages: [["execution_start", { timestamp: at }]] }
  }];
}

test("recent runs fold runs of one workflow into one entry, skip HEISS's own runs, newest first", () => {
  const history = Object.fromEntries([
    historyEntry("a", 1, "a fox", 1000),
    historyEntry("b", 2, "a cat", 2000),
    ["heiss", { prompt: [3, "heiss", base(), { client_id: "job" }, []], outputs: {} }]
  ]);
  const recent = recentFromHistory(history);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].id, "b");
  assert.equal(recent[0].runs, 2);
  assert.equal(recent[0].name, "sdxl");
  assert.match(recent[0].thumbnail, /\/comfy\/thumb\?filename=b\.png/);
  const picked = importFromHistory(history, "b");
  assert.equal(picked.variants.length, 1);
  assert.equal(workflowShape(picked.api), workflowShape(picked.variants[0]));
});

test("saved workflows: newest first, hidden folders left out, both listing shapes", () => {
  assert.deepEqual(savedWorkflowList(["b.json", ".trash/x.json", "notes.txt"]).map((item) => item.name), ["b"]);
  const list = savedWorkflowList([{ path: "old.json", modified: 100 }, { path: "sub/new.json", modified: 200 }]);
  assert.deepEqual(list.map((item) => item.path), ["sub/new.json", "old.json"]);
});

test("pack resolution: the workflow's stamps first, then the node map's best cover, originals over forks", () => {
  const map = reduceNodeMap({
    "https://github.com/kijai/ComfyUI-KJNodes": [["ImageResizeKJ", "GetImageSizeAndCount"], { title_aux: "KJNodes" }],
    "https://github.com/someone/kj-fork": [["ImageResizeKJ"], { title_aux: "Fork" }],
    "https://github.com/kijai/ComfyUI-WanVideoWrapper": [["WanVideoSampler"], { title_aux: "WanVideoWrapper" }],
    "https://github.com/copycat/WanAnimatePlus": [["WanVideoSampler"], { title_aux: "WanAnimatePlus" }]
  }, { custom_nodes: [
    { reference: "https://github.com/kijai/ComfyUI-KJNodes", id: "kjnodes" },
    { reference: "https://github.com/someone/kj-fork", id: "kj-fork" },
    { reference: "https://github.com/copycat/WanAnimatePlus", id: "wanplus" }
  ] }, {
    "https://github.com/kijai/ComfyUI-WanVideoWrapper": { stars: 6700 },
    "https://github.com/copycat/WanAnimatePlus": { stars: 3 },
    "https://github.com/kijai/ComfyUI-KJNodes": { stars: 3300 }
  });
  const stamps = packStamps({ nodes: [{ id: 1, type: "VHS_VideoCombine", properties: { cnr_id: "comfyui-videohelpersuite", ver: "1.7.2" } }, { id: 2, type: "KSampler", properties: { cnr_id: "comfy-core" } }], links: [] });
  const { packs, unresolved } = resolveMissingNodes(["VHS_VideoCombine", "ImageResizeKJ", "GetImageSizeAndCount", "WanVideoSampler", "NoSuchNode"], { stamps, map });
  const byKey = Object.fromEntries(packs.map((pack) => [pack.key, pack]));
  assert.deepEqual(byKey["cnr:comfyui-videohelpersuite"].version, "1.7.2");
  assert.equal(byKey["cnr:comfyui-videohelpersuite"].registry, true);
  assert.deepEqual(byKey["cnr:kjnodes"].nodes.sort(), ["GetImageSizeAndCount", "ImageResizeKJ"]);
  const wan = packs.find((pack) => pack.nodes.includes("WanVideoSampler"));
  assert.equal(wan.repository, "https://github.com/kijai/ComfyUI-WanVideoWrapper");
  assert.equal(wan.registry, false);
  assert.deepEqual(unresolved, ["NoSuchNode"]);
});

test("prepareImport takes a history run's stored prompt as is and finds what it lacks", async () => {
  const history = Object.fromEntries([historyEntry("a", 1, "a fox", 1000)]);
  history.a.prompt[2][9] = { class_type: "ImageResizeKJ", inputs: { image: ["4", 0], width: 512, height: 512 } };
  const map = reduceNodeMap({ "https://github.com/kijai/ComfyUI-KJNodes": [["ImageResizeKJ"], { title_aux: "KJNodes" }] }, { custom_nodes: [{ reference: "https://github.com/kijai/ComfyUI-KJNodes", id: "kjnodes" }] });
  const preview = await prepareImport({ source: "history", promptId: "a" }, { info, fetchers: { history: async () => history }, map });
  assert.equal(preview.conversion, "stored");
  assert.equal(preview.source, "history");
  assert.deepEqual(keys(preview.detected.controls.prompt), ["10.text"]);
  assert.deepEqual(preview.validation.missingNodes, ["ImageResizeKJ"]);
  assert.equal(preview.packs.packs[0].key, "cnr:kjnodes");
});

test("prepareImport turns a canvas file into a graph with HEISS's converter when ComfyUI's page isn't there", async () => {
  const raw = JSON.parse(fs.readFileSync(path.join(corpusDir, "image_sdxl_simple.json"), "utf8"));
  const preview = await prepareImport({ source: "file", workflow: raw, filename: "sdxl.json" }, { info, map: { packs: {} } });
  assert.equal(preview.conversion, "heiss");
  assert.equal(preview.detected.name, "sdxl");
  // Every node is a core node; the only thing missing is the model file itself.
  assert.deepEqual(preview.validation.missingNodes, []);
  assert.deepEqual(preview.validation.missingParts.map((part) => part.label), ["sd_xl_base_1.0.safetensors"]);
});

test("install safety: freeze parsing, the restore plan, and the health check", () => {
  const before = parseFreeze("torch==2.4.0\nnumpy==1.26.4\nopencv-python==4.10.0.84\n");
  const after = parseFreeze("torch==2.5.0\nnumpy==1.26.4\nopencv_python_headless==4.11.0\n");
  assert.deepEqual(packageRestorePlan(before, after), { uninstall: ["opencv-python-headless"], reinstall: ["opencv-python==4.10.0.84", "torch==2.4.0"] });
  const snapshot = { loaded: ["ComfyUI-KJNodes", "rgthree-comfy"], nodeTypes: ["KSampler", "ImageResizeKJ"], added: ["ComfyUI-Foo"] };
  assert.equal(installHealth(snapshot, { loaded: ["ComfyUI-KJNodes", "rgthree-comfy", "ComfyUI-Foo"], nodeTypes: ["KSampler", "ImageResizeKJ", "Foo"], failed: [] }).ok, true);
  const broke = installHealth(snapshot, { loaded: ["rgthree-comfy"], nodeTypes: ["KSampler"], failed: ["ComfyUI-KJNodes"] });
  assert.deepEqual(broke.broke, ["ComfyUI-KJNodes"]);
  assert.deepEqual(broke.lostNodes, ["ImageResizeKJ"]);
  const newOnly = installHealth(snapshot, { loaded: ["ComfyUI-KJNodes", "rgthree-comfy"], nodeTypes: ["KSampler", "ImageResizeKJ"], failed: ["ComfyUI-Foo"] });
  assert.equal(newOnly.ok, true);
  assert.deepEqual(newOnly.newFailed, ["ComfyUI-Foo"]);
  assert.equal(installHealth(snapshot, { comfyBack: false }).comfyDown, true);
});

const { planModels, reduceModelList, nameSimilarity } = await import("./workflow-models.js");
const { effectiveGraph } = await import("./workflow-fallbacks.js");

test("model plan: same file elsewhere is used, known names download, LoRAs are skipped, main models stand in by family only", () => {
  const modelInfo = JSON.parse(JSON.stringify(info));
  modelInfo.CheckpointLoaderSimple.input.required.ckpt_name[0] = ["SDXL/juggernautXL_ragnarok.safetensors", "chroma-unlocked-v40-Q5.gguf", "flux1-dev-fp8.safetensors"];
  modelInfo.UNETLoader.input.required.unet_name[0] = ["chroma1-hd-fp8.safetensors", "flux1-dev.safetensors"];
  modelInfo.LoraLoader.input.required.lora_name[0] = ["detail.safetensors"];
  const graph = {
    1: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "juggernautXL_ragnarok.safetensors" } },
    2: { class_type: "UNETLoader", inputs: { unet_name: "chroma-unlocked-v50.safetensors", weight_dtype: "default" } },
    3: { class_type: "LoraLoader", inputs: { lora_name: "film_grain_v3.safetensors", strength_model: 1, strength_clip: 1, model: ["1", 0], clip: ["1", 1] } },
    4: { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
    5: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "flux1-dev-fp8-e4m3fn.safetensors" } },
    6: { class_type: "UNETLoader", inputs: { unet_name: "sd3.5_large.safetensors", weight_dtype: "default" } },
    7: { class_type: "Power Lora Loader (rgthree)", inputs: { lora_1: { on: true, lora: "gone.safetensors", strength: 1 }, lora_2: { on: true, lora: "detail.safetensors", strength: 0.5 }, model: ["1", 0] } }
  };
  modelInfo["Power Lora Loader (rgthree)"] = { input: { required: {} } };
  const list = reduceModelList({ models: [{ name: "FLUX VAE", type: "VAE", save_path: "default", filename: "ae.safetensors", url: "https://huggingface.co/x/ae.safetensors", size: "335MB" }] });
  const plan = planModels(graph, modelInfo, { list });
  assert.deepEqual(plan.swaps.map((item) => [item.node, item.file]), [["1", "SDXL/juggernautXL_ragnarok.safetensors"]]);
  assert.deepEqual(plan.downloads.map((item) => item.file), ["ae.safetensors"]);
  assert.deepEqual(plan.suggestions.map((item) => [item.node, item.file]), [["5", "flux1-dev-fp8.safetensors"]]);
  assert.deepEqual(plan.skippedLoras.map((item) => item.node), ["3"]);
  assert.deepEqual(plan.loraEntriesOff.map((item) => item.key), ["lora_1"]);
  assert.deepEqual(plan.substitutes.map((item) => [item.node, item.file]), [["2", "chroma1-hd-fp8.safetensors"]]);
  assert.deepEqual(plan.unresolved.map((item) => item.file), ["sd3.5_large.safetensors"], "no SD3 here: no stand-in from another family");
  const running = effectiveGraph({ graph, fileSwaps: plan.swaps, skippedLoras: plan.skippedLoras.map((item) => item.node), loraEntriesOff: plan.loraEntriesOff });
  assert.equal(running[1].inputs.ckpt_name, "SDXL/juggernautXL_ragnarok.safetensors");
  assert.equal(running[3], undefined);
  assert.equal(running[7].inputs.lora_1.on, false);
  assert.ok(nameSimilarity("flux1-dev-fp8.safetensors", "flux1-dev-fp8-e4m3fn.safetensors") >= 0.6);
});

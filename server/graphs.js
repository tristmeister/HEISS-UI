import crypto from "node:crypto";
import { comfy } from './comfy.js';
import { getCustomWorkflow } from './custom-workflows.js';
import { startImageDataUrl } from './start-images.js';
import { prepareInputImage } from './input-image-sizing.js';
import { families } from './family-catalog.js';
import { familyGraph } from './family-graph.js';
import { withGgufLoaders } from './gguf.js';

export async function uploadReferenceImage(dataUrl, body = {}) {
  if (!dataUrl || !dataUrl.includes(",")) return "";
  const [header, data] = dataUrl.split(",", 2);
  const match = header.match(/data:(.*?);base64/);
  let type = match?.[1] || "image/png";
  const family = families[body.family];
  const directImg2img = family?.img2img && !family.references;
  const prepared = await prepareInputImage({ buffer: Buffer.from(data, "base64"), mime: type, name: "start-image" }, {
    pixels: body.autoResizeInputs !== false ? Number(body.width) * Number(body.height) : 0,
    step: directImg2img ? family.sizeStep || 8 : 1
  });
  if (directImg2img && prepared.width) {
    body.requestedSize ||= { width: body.width, height: body.height };
    body.width = prepared.width;
    body.height = prepared.height;
  }
  type = prepared.mime;
  const ext = type.includes("jpeg") ? "jpg" : type.includes("webp") ? "webp" : "png";
  const filename = `heiss-ui-reference-${crypto.randomUUID()}.${ext}`;
  const bytes = prepared.buffer;
  const form = new FormData();
  form.append("image", new Blob([bytes], { type }), filename);
  form.append("type", "input");
  const uploaded = await comfy("/upload/image", { method: "POST", body: form });
  const comfyName = uploaded.name || filename;
  body.stagedInputNames = [...(body.stagedInputNames || []), comfyName];
  // Legacy uploads are unique too; release their temporary copy when the run ends.
  body.hiddenInputNames = [...(body.hiddenInputNames || []), comfyName];
  return comfyName;
}

async function uploadBodyStartImage(body) {
  const dataUrl = body.startImage || startImageDataUrl(body.startImageId);
  return dataUrl ? uploadReferenceImage(dataUrl, body) : "";
}

export function composeWorkflowPrompt(workflow, userPrompt = "") {
  const composition = workflow?.promptComposition;
  const prompt = String(userPrompt || "").trim();
  if (!composition) return prompt;
  const prefix = String(composition.prefix || "");
  const suffix = String(composition.suffix || "").trim();
  return `${prefix}${prompt}${suffix ? `\n\n${suffix}` : ""}`.trim();
}

export async function imageGraph(body) {
  if (body.workflow?.startsWith("custom:")) return customWorkflowGraph(body);
  return builtInGraph(body);
}

export async function videoGraph(body) {
  if (body.workflow?.startsWith("custom:")) return customWorkflowGraph(body);
  return builtInGraph(body);
}

/**
 * Every built-in family. The start image is the reference the composer staged in
 * ComfyUI (already uploaded, by name), or a legacy start image uploaded now.
 */
async function builtInGraph(body) {
  const referenceImages = (body.referenceAssets || []).map((item) => item?.comfyName).filter(Boolean);
  const staged = referenceImages[0] || "";
  const startImageComfy = staged || ((body.startImage || body.startImageId) ? await uploadBodyStartImage(body) : "");
  // Inpainting samples the crop around the painted part, at its own working size (inpaint.js).
  const inpaint = body.inpaint?.crop ? body.inpaint : null;
  if (inpaint) {
    return withGgufLoaders(familyGraph({
      ...body,
      width: inpaint.work.width,
      height: inpaint.work.height,
      startImageComfy: inpaint.crop,
      // Edit models edit the crop itself; only the painted part is stitched back.
      referenceImages: [inpaint.crop, ...referenceImages.slice(1)],
      inpaint
    }));
  }
  return withGgufLoaders(familyGraph({ ...body, startImageComfy, referenceImages, inpaint: null }));
}

function cloneGraph(graph) {
  return JSON.parse(JSON.stringify(graph || {}));
}

function setMappedInput(graph, mapping, value) {
  if (!mapping?.node || !mapping?.input || !graph[mapping.node]) return;
  graph[mapping.node].inputs ||= {};
  graph[mapping.node].inputs[mapping.input] = value;
}

async function applyMappedInputs(graph, workflow, body) {
  const controls = workflow.controls || {};
  const defaults = workflow.defaults || {};
  const values = {
    prompt: composeWorkflowPrompt(workflow, body.prompt),
    negative: body.negative || "",
    model: body.modelName || defaults.model || "",
    textEncoder: body.textEncoder || defaults.textEncoder || "",
    vae: body.vae || defaults.vae || "",
    clipType: body.clipType || defaults.clipType || "",
    weightDtype: body.weightDtype || defaults.weightDtype || "default",
    width: Number(body.width || 0),
    height: Number(body.height || 0),
    steps: Number(body.steps || 0),
    cfg: Number(body.cfg || 0),
    denoise: Number(body.denoise ?? 1),
    sampler: body.sampler || "",
    scheduler: body.scheduler || "",
    seed: Number(body.seed || crypto.randomInt(1, 2 ** 31)),
    count: Number(body.count || 1),
    frames: Number(body.frames || 0),
    fps: Number(body.fps || 0)
  };
  for (const [key, value] of Object.entries(values)) {
    if (value !== "" && value !== undefined && value !== null) setMappedInput(graph, controls[key], value);
  }
  let mappedReference = false;
  for (const mediaInput of workflow.mediaInputs || []) {
    const reference = (body.referenceAssets || []).find((item) => item?.slot === mediaInput.id);
    if (reference?.comfyName && mediaInput.control) {
      setMappedInput(graph, mediaInput.control, reference.comfyName);
      mappedReference = true;
    }
  }
  if (!mappedReference && (body.startImage || body.startImageId) && controls.startImage) {
    const imageName = await uploadBodyStartImage(body);
    if (imageName) setMappedInput(graph, controls.startImage, imageName);
  }
}

const maxLoras = 8;

function enabledLoras(body, limit = maxLoras) {
  return Array.isArray(body.loras)
    ? body.loras.filter((item) => item?.enabled !== false && item?.name).slice(0, limit)
    : [];
}

function applyPowerLoraStack(graph, body, config) {
  if (!config) return;
  const node = graph[config.node];
  if (node?.class_type !== "Power Lora Loader (rgthree)") {
    throw new Error("The configured Power LoRA Loader is missing from this workflow.");
  }
  const inputs = node.inputs ||= {};
  for (const key of Object.keys(inputs)) {
    if (/^lora_\d+$/i.test(key)) delete inputs[key];
  }
  for (const [index, lora] of enabledLoras(body, config.max).entries()) {
    inputs[`lora_${index + 1}`] = {
      on: true,
      lora: lora.name,
      strength: Number(lora.strength ?? 0.7)
    };
  }
}

function applyRgthreeLoraStack(graph, body, config) {
  if (!config || config.adapter !== "rgthree-stack-v1") return;
  const node = graph[config.node];
  if (node?.class_type !== "Lora Loader Stack (rgthree)") {
    throw new Error("The configured rgthree LoRA Stack is missing from this workflow.");
  }
  const inputs = node.inputs ||= {};
  for (let index = 1; index <= config.max; index += 1) {
    const suffix = String(index).padStart(2, "0");
    inputs[`lora_${suffix}`] = "None";
    inputs[`strength_${suffix}`] = 1;
  }
  for (const [index, lora] of enabledLoras(body, config.max).entries()) {
    const suffix = String(index + 1).padStart(2, "0");
    inputs[`lora_${suffix}`] = lora.name;
    inputs[`strength_${suffix}`] = Number(lora.strength ?? 0.7);
  }
}

/**
 * Points every save node (SaveImage, SaveVideo, VHS_VideoCombine and anything
 * else with a filename_prefix) at the heiss-ui folder. A Hidden run from an
 * imported workflow must save where HEISS UI's own runs do: a copy Hidden
 * cannot remove then stays out of "Everything in the output folder" too.
 */
export function saveIntoHeissFolder(graph) {
  for (const node of Object.values(graph || {})) {
    const inputs = node?.inputs;
    if (!inputs || !Object.hasOwn(inputs, "filename_prefix")) continue;
    // Only the name part is kept; a linked or empty prefix becomes a plain one.
    const name = typeof inputs.filename_prefix === "string" ? inputs.filename_prefix.split(/[\\/]/).filter((part) => part && part !== "." && part !== "..").pop() : "";
    inputs.filename_prefix = `heiss-ui/${name || "hidden"}`;
  }
  return graph;
}

export async function customWorkflowGraph(body) {
  const workflow = getCustomWorkflow(body.workflow);
  if (!workflow) throw new Error("This workflow isn’t installed.");
  const graph = cloneGraph(workflow.graph);
  await applyMappedInputs(graph, workflow, body);
  if (workflow.loraStack?.adapter === "rgthree-stack-v1") applyRgthreeLoraStack(graph, body, workflow.loraStack);
  else applyPowerLoraStack(graph, body, workflow.loraStack);
  return body.privateVault ? saveIntoHeissFolder(graph) : graph;
}

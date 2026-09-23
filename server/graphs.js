import crypto from "node:crypto";
import { comfy } from './comfy.js';
import { getCustomWorkflow } from './custom-workflows.js';
import { startImageDataUrl } from './start-images.js';
import { familyGraph } from './family-graph.js';

export async function uploadReferenceImage(dataUrl) {
  if (!dataUrl || !dataUrl.includes(",")) return "";
  const [header, data] = dataUrl.split(",", 2);
  const match = header.match(/data:(.*?);base64/);
  const type = match?.[1] || "image/png";
  const ext = type.includes("jpeg") ? "jpg" : "png";
  const filename = `heiss-ui-reference-${crypto.randomUUID()}.${ext}`;
  const bytes = Buffer.from(data, "base64");
  const form = new FormData();
  form.append("image", new Blob([bytes], { type }), filename);
  form.append("type", "input");
  const uploaded = await comfy("/upload/image", { method: "POST", body: form });
  return uploaded.name || filename;
}

async function uploadBodyStartImage(body) {
  const dataUrl = body.startImage || startImageDataUrl(body.startImageId);
  return dataUrl ? uploadReferenceImage(dataUrl) : "";
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

/** Every built-in family; a start image is uploaded to ComfyUI first so the graph can load it by name. */
async function builtInGraph(body) {
  const startImageComfy = (body.startImage || body.startImageId) ? await uploadBodyStartImage(body) : "";
  return familyGraph({ ...body, startImageComfy });
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

export async function customWorkflowGraph(body) {
  const workflow = getCustomWorkflow(body.workflow);
  if (!workflow) throw new Error("Custom workflow is not installed.");
  const graph = cloneGraph(workflow.graph);
  await applyMappedInputs(graph, workflow, body);
  if (workflow.loraStack?.adapter === "rgthree-stack-v1") applyRgthreeLoraStack(graph, body, workflow.loraStack);
  else applyPowerLoraStack(graph, body, workflow.loraStack);
  return graph;
}

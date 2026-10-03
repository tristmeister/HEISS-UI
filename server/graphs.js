import crypto from "node:crypto";
import { comfy } from './comfy.js';
import { getCustomWorkflow } from './custom-workflows.js';
import { startImageDataUrl } from './start-images.js';
import { familyGraph } from './family-graph.js';
import { withGgufLoaders } from './gguf.js';
import { applyFileFallbacks } from './workflow-fallbacks.js';
export { bypassLoraNode } from './workflow-fallbacks.js';

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

/**
 * Every built-in family. The start image is the reference the composer staged in
 * ComfyUI (already uploaded, by name), or a legacy start image uploaded now.
 */
async function builtInGraph(body) {
  const referenceImages = (body.referenceAssets || []).map((item) => item?.comfyName).filter(Boolean);
  const staged = referenceImages[0] || "";
  const startImageComfy = staged || ((body.startImage || body.startImageId) ? await uploadBodyStartImage(body) : "");
  return withGgufLoaders(familyGraph({ ...body, startImageComfy, referenceImages }));
}

function cloneGraph(graph) {
  return JSON.parse(JSON.stringify(graph || {}));
}

/** Writes a value to a control's input, or to each of them: one prompt can feed several boxes (base and refiner). */
function setMappedInput(graph, mapping, value) {
  for (const item of [].concat(mapping || [])) {
    if (!item?.node || !item?.input || !graph[item.node]) continue;
    graph[item.node].inputs ||= {};
    graph[item.node].inputs[item.input] = value;
  }
}

/** A "More settings" value, kept to the type its input takes. */
function settingValue(setting, value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (setting.type === "INT") return Number.isFinite(Number(value)) ? Math.round(Number(value)) : undefined;
  if (setting.type === "FLOAT") return Number.isFinite(Number(value)) ? Number(value) : undefined;
  if (setting.type === "BOOLEAN") return value === true || value === "true" || value === 1;
  if (setting.type === "COMBO") return Array.isArray(setting.options) && setting.options.length && !setting.options.includes(String(value)) ? undefined : String(value);
  return String(value).slice(0, 20000);
}

/** The person's "More settings" values, by setting key; anything not set keeps the workflow's saved value. */
export function applyWorkflowSettings(graph, workflow, values = {}) {
  for (const setting of workflow.settings || []) {
    if (!Object.hasOwn(values || {}, setting.key)) continue;
    const value = settingValue(setting, values[setting.key]);
    if (value !== undefined) setMappedInput(graph, setting, value);
  }
  return graph;
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
  applyWorkflowSettings(graph, workflow, body.workflowSettings);
  await applyMappedInputs(graph, workflow, body);
  applyFileFallbacks(graph, workflow);
  if (workflow.loraStack?.adapter === "rgthree-stack-v1") applyRgthreeLoraStack(graph, body, workflow.loraStack);
  else applyPowerLoraStack(graph, body, workflow.loraStack);
  return body.privateVault ? saveIntoHeissFolder(graph) : graph;
}

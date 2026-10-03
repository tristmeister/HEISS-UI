import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dataDir } from './gallery-store.js';
import { root } from './comfy.js';
import { workflowIds } from './workflow-registry.js';
import { writeJsonFile } from './json-store.js';
import { convertVisualWorkflow } from './workflow-convert.js';
import { understandWorkflow } from './workflow-understand.js';

export const bundledWorkflowsDir = path.join(root, "workflows");
export const userWorkflowsDir = path.join(dataDir, "workflows");

// Windows keeps these names for devices, with any extension: `con.json` can never be a file.
const windowsReserved = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/;

function safeId(value = "") {
  const id = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `workflow-${crypto.randomUUID()}`;
  return windowsReserved.test(id) ? id.replace(/^[^.]+/, "$&-1") : id;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function workflowMeta(raw = {}) {
  return raw?.heissUi || raw?.heiss_ui || raw?.jAiStudio || raw?.j_ai_studio || {};
}

function loraStackConfig(meta = {}) {
  const stack = meta.loraStack;
  if (!stack || !["rgthree-power-v1", "rgthree-stack-v1"].includes(stack.adapter) || !stack.node) return null;
  return {
    adapter: stack.adapter,
    node: String(stack.node),
    max: Math.max(1, Math.min(8, Number(stack.max) || (stack.adapter === "rgthree-stack-v1" ? 4 : 8)))
  };
}

function mediaInputsConfig(meta = {}, controls = {}) {
  const raw = Array.isArray(meta.mediaInputs) ? meta.mediaInputs : [];
  const normalized = raw.map((item, index) => ({
    id: safeId(item?.id || `reference-${index + 1}`),
    kind: item?.kind === "image" ? "image" : "image",
    label: String(item?.label || (index ? `Reference ${index + 1}` : "Reference image")),
    required: Boolean(item?.required),
    min: Math.max(0, Number(item?.min ?? (item?.required ? 1 : 0)) || 0),
    max: Math.max(1, Math.min(8, Number(item?.max || 1))),
    control: item?.control?.node && item?.control?.input
      ? { node: String(item.control.node), input: String(item.control.input) }
      : null
  })).filter((item) => item.control);
  if (!normalized.length && controls.startImage?.node && controls.startImage?.input) {
    normalized.push({
      id: "reference",
      kind: "image",
      label: "Reference image",
      required: Boolean(meta.capabilities?.startImageRequired),
      min: meta.capabilities?.startImageRequired ? 1 : 0,
      max: 1,
      control: { node: String(controls.startImage.node), input: String(controls.startImage.input) }
    });
  }
  return normalized;
}

function promptCompositionConfig(meta = {}) {
  const value = meta.promptComposition;
  if (!value || typeof value !== "object") return null;
  return {
    prefix: String(value.prefix || "").slice(0, 1000),
    suffix: String(value.suffix || "").slice(0, 8000),
    policy: String(value.policy || "custom").slice(0, 120),
    version: Math.max(1, Number(value.version || 1))
  };
}

export function graphFromJson(raw, info = {}) {
  if (raw?.graph && typeof raw.graph === "object") return raw.graph;
  if (Array.isArray(raw?.nodes) && Array.isArray(raw?.links)) return visualWorkflowToApi(raw, info);
  const copy = { ...raw };
  delete copy.heissUi;
  delete copy.heiss_ui;
  delete copy.jAiStudio;
  delete copy.j_ai_studio;
  delete copy.metadata;
  return copy;
}

function visualWorkflowToApi(raw, info = {}) {
  return convertVisualWorkflow(raw, info).graph;
}

/** A control's mappings as a list: one prompt can be written to several boxes (base and refiner). */
export function mappingList(mapping) {
  return [].concat(mapping || []).filter((item) => item?.node && item?.input);
}

/** The editable settings an import exposes ("More settings"), checked and trimmed. */
function settingsConfig(meta = {}) {
  const raw = Array.isArray(meta.settings) ? meta.settings : [];
  return raw.filter((item) => item?.node && item?.input).slice(0, 64).map((item) => ({
    key: String(item.key || `${item.node}.${item.input}`),
    node: String(item.node),
    input: String(item.input),
    label: String(item.label || item.input).slice(0, 80),
    group: String(item.group || "").slice(0, 80),
    type: ["INT", "FLOAT", "BOOLEAN", "COMBO", "STRING"].includes(item.type) ? item.type : "STRING",
    ...(item.multiline ? { multiline: true } : {}),
    default: item.default ?? null,
    ...(Array.isArray(item.options) ? { options: item.options.slice(0, 200).map(String) } : {}),
    ...(Number.isFinite(item.min) ? { min: item.min } : {}),
    ...(Number.isFinite(item.max) ? { max: item.max } : {}),
    ...(Number.isFinite(item.step) ? { step: item.step } : {})
  }));
}

export function detectWorkflowFormat(raw) {
  if (Array.isArray(raw?.nodes) && Array.isArray(raw?.links)) return "comfyui-visual";
  if (raw?.prompt && typeof raw.prompt === "object") return "comfyui-api-wrapper";
  if (raw && typeof raw === "object" && Object.values(raw).some((node) => node?.class_type)) return "comfyui-api";
  return "unsupported";
}

export function metadataFromJson(raw, file) {
  const meta = workflowMeta(raw);
  const id = safeId(meta.id || path.basename(file || "", path.extname(file || "")));
  const graph = graphFromJson(raw);
  const controls = meta.controls || {};
  const loraStack = loraStackConfig(meta);
  const mediaInputs = mediaInputsConfig(meta, controls);
  const promptComposition = promptCompositionConfig(meta);
  const graphDefault = (key) => {
    const [mapping] = mappingList(controls[key]);
    return mapping ? graph?.[mapping.node]?.inputs?.[mapping.input] : undefined;
  };
  const classes = [...new Set(Object.values(graph || {}).map((node) => node?.class_type).filter(Boolean))];
  return {
    id,
    profileId: `custom:${id}`,
    name: meta.name || id,
    description: meta.description || "Custom ComfyUI workflow",
    kind: meta.kind === "video" ? "video" : "image",
    family: meta.family || "custom",
    graph,
    controls,
    loraStack,
    mediaInputs,
    promptComposition,
    settings: settingsConfig(meta),
    source: meta.source || null,
    // Decided at setup: local files standing in for missing ones, and LoRAs run without.
    fileSwaps: (Array.isArray(meta.fileSwaps) ? meta.fileSwaps : []).filter((item) => item?.node && item?.input && typeof item.file === "string").map((item) => ({ node: String(item.node), input: String(item.input), file: item.file, wanted: String(item.wanted || ""), reason: String(item.reason || "") })),
    skippedLoras: (Array.isArray(meta.skippedLoras) ? meta.skippedLoras : []).map(String),
    requiredNodes: Array.isArray(meta.requiredNodes) && meta.requiredNodes.length ? meta.requiredNodes : classes,
    defaults: {
      model: graphDefault("model") || "",
      textEncoder: graphDefault("textEncoder") || "",
      vae: graphDefault("vae") || "",
      clipType: graphDefault("clipType") || "",
      weightDtype: graphDefault("weightDtype") || "",
      sampler: graphDefault("sampler") || "",
      scheduler: graphDefault("scheduler") || "",
      width: graphDefault("width") || undefined,
      height: graphDefault("height") || undefined,
      steps: graphDefault("steps") || undefined,
      cfg: graphDefault("cfg") || undefined,
      denoise: graphDefault("denoise") || undefined,
      count: graphDefault("count") || undefined,
      frames: graphDefault("frames") || undefined,
      fps: graphDefault("fps") || undefined,
      ...(meta.defaults || {})
    },
    aspectRatios: meta.aspectRatios || meta.aspects || [],
    aspectPolicy: meta.aspectPolicy === "reference" ? "reference" : "manual",
    capabilities: {
      negativePrompt: Boolean(controls.negative),
      // No sampler or scheduler wired to the studio: hide those pickers rather than show ones that do nothing.
      ...(controls.sampler || controls.scheduler ? {} : { sampler: false }),
      variations: Boolean(controls.count),
      frames: Boolean(controls.frames),
      fps: Boolean(controls.fps),
      startImage: mediaInputs.length > 0 || Boolean(controls.startImage),
      startImageRequired: mediaInputs.some((item) => item.required || item.min > 0),
      imageToImage: meta.capabilities?.imageToImage === true || mediaInputs.length > 0,
      denoise: Boolean(controls.denoise),
      textEncoder: Boolean(controls.textEncoder),
      vae: Boolean(controls.vae),
      clipType: Boolean(controls.clipType),
      weightDtype: Boolean(controls.weightDtype),
      ...(meta.capabilities || {})
    },
    path: file || ""
  };
}

export function validateGraph(graph) {
  if (!graph || typeof graph !== "object" || !Object.keys(graph).length) throw new Error("This file has no ComfyUI workflow in it.");
  for (const [id, node] of Object.entries(graph)) {
    if (!node?.class_type) throw new Error(`Workflow node ${id} is missing class_type.`);
    for (const value of Object.values(node.inputs || {})) {
      if (Array.isArray(value) && typeof value[0] === "string" && !graph[value[0]]) {
        throw new Error(`Workflow node ${id} references missing node ${value[0]}.`);
      }
    }
  }
}

const loaderOptionKeys = {
  UNETLoader: ["unet_name"],
  CheckpointLoaderSimple: ["ckpt_name"],
  CLIPLoader: ["clip_name"],
  VAELoader: ["vae_name"],
  UpscaleModelLoader: ["model_name"]
};

/** What each loader reads, in words, and the models subfolder ComfyUI reads it from. */
const loaderKinds = {
  UNETLoader: ["diffusion model", "diffusion_models"],
  CheckpointLoaderSimple: ["checkpoint", "checkpoints"],
  CLIPLoader: ["text encoder", "text_encoders"],
  VAELoader: ["VAE", "vae"],
  UpscaleModelLoader: ["upscale model", "upscale_models"]
};

function schemaOptions(info, classType, input) {
  const definition = info?.[classType]?.input?.required?.[input];
  if (!Array.isArray(definition)) return [];
  if (Array.isArray(definition[0])) return definition[0];
  if (Array.isArray(definition[1]?.options)) return definition[1].options;
  return [];
}

/** Every model file the graph's loaders name that ComfyUI does not list: { file, kind, folder, classType }, once each. */
export function workflowMissingFiles(workflow, info = {}) {
  const found = new Map();
  for (const node of Object.values(workflow?.graph || {})) {
    const keys = loaderOptionKeys[node?.class_type] || [];
    if (!keys.length || !info?.[node.class_type]) continue;
    for (const key of keys) {
      const selected = node.inputs?.[key];
      if (!selected || typeof selected !== "string") continue;
      if (schemaOptions(info, node.class_type, key).includes(selected)) continue;
      const [kind, folder] = loaderKinds[node.class_type] || ["file", "models"];
      found.set(`${folder}/${selected}`, { file: selected, kind, folder, classType: node.class_type });
    }
  }
  return [...found.values()];
}

export function workflowOptionIssues(workflow, info = {}) {
  // Said as the file and where it goes; node ids mean nothing outside the graph editor.
  return workflowMissingFiles(workflow, info).map(({ file, kind, folder }) => `Missing ${kind}: ${file}. Put it in ComfyUI’s models/${folder} folder.`);
}

export function allCustomWorkflowRecords({ dedupe = true } = {}) {
  const dirs = [
    { dir: bundledWorkflowsDir, source: "bundled" },
    { dir: userWorkflowsDir, source: "custom" }
  ];
  const items = [];
  for (const { dir, source } of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json"))) {
      const fullPath = path.join(dir, file);
      const raw = readJson(fullPath);
      if (!raw) {
        items.push({
          id: safeId(path.basename(file, ".json")),
          profileId: `custom:${safeId(path.basename(file, ".json"))}`,
          name: path.basename(file, ".json"),
          description: "This file isn’t valid JSON.",
          kind: "image",
          family: "custom",
          graph: {},
          controls: {},
          requiredNodes: [],
          defaults: {},
          capabilities: {},
          path: fullPath,
          source,
          parseError: "Invalid JSON"
        });
        continue;
      }
      try {
        items.push({ ...metadataFromJson(raw, fullPath), source, raw });
      } catch (error) {
        items.push({
          id: safeId(path.basename(file, ".json")),
          profileId: `custom:${safeId(path.basename(file, ".json"))}`,
          name: path.basename(file, ".json"),
          description: error.message || "Couldn’t read this workflow.",
          kind: "image",
          family: "custom",
          graph: {},
          controls: {},
          requiredNodes: [],
          defaults: {},
          capabilities: {},
          path: fullPath,
          source,
          parseError: error.message
        });
      }
    }
  }
  if (!dedupe) return items;
  // The bundled folder is scanned first, so a hand-authored template wins over
  // an imported copy of the same id.
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function withinWorkflowRoot(file) {
  const resolved = path.resolve(file);
  return [bundledWorkflowsDir, userWorkflowsDir].some((dir) => {
    const base = path.resolve(dir);
    return resolved === base || resolved.startsWith(`${base}${path.sep}`);
  });
}

export function loadCustomWorkflows() {
  return allCustomWorkflowRecords().filter((workflow) => {
    try {
      validateGraph(workflow.graph);
      return workflow.graph && Object.keys(workflow.graph).length;
    } catch {
      return false;
    }
  });
}

export function getCustomWorkflow(profileId) {
  return loadCustomWorkflows().find((workflow) => workflow.profileId === profileId || workflow.id === profileId || `custom:${workflow.id}` === profileId) || null;
}

export function saveCustomWorkflow(raw) {
  const workflow = metadataFromJson(raw);
  validateGraph(workflow.graph);
  fs.mkdirSync(userWorkflowsDir, { recursive: true });
  const file = path.join(userWorkflowsDir, `${workflow.id}.json`);
  writeJsonFile(file, raw);
  return { ...workflow, path: file };
}

/**
 * An import that collides with a bundled template would be written but never
 * shown, because the bundled copy wins the scan. Give it its own id instead.
 * Re-importing over an existing user copy still overwrites, so updates work.
 */
function unshadowedId(id) {
  const records = allCustomWorkflowRecords({ dedupe: false });
  // Built-in registry workflows do not have a JSON file, so checking only the
  // bundled directory is not enough to keep imported workflows out of the
  // built-in namespace.
  const reserved = new Set(workflowIds());
  const shadowed = (candidate) => reserved.has(candidate) || records.some((record) => record.id === candidate && record.source === "bundled");
  if (!shadowed(id)) return id;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = safeId(`${id}-${suffix}`);
    if (!shadowed(candidate) && !records.some((record) => record.id === candidate)) return candidate;
  }
  return safeId(`${id}-${crypto.randomUUID().slice(0, 8)}`);
}

export function saveImportedWorkflow(raw, meta = {}) {
  const mergedMeta = {
    ...workflowMeta(raw),
    ...meta
  };
  const workflow = metadataFromJson({ ...raw, heissUi: mergedMeta });
  workflow.id = unshadowedId(workflow.id);
  mergedMeta.id = workflow.id;
  workflow.profileId = `custom:${workflow.id}`;
  fs.mkdirSync(userWorkflowsDir, { recursive: true });
  const file = path.join(userWorkflowsDir, `${workflow.id}.json`);
  writeJsonFile(file, { ...raw, heissUi: mergedMeta });
  return { ...workflow, path: file };
}

/**
 * Removes every file backing an id, across both workflow folders. Deleting only
 * the user copy left a same-id template in the bundled folder to re-supply the
 * workflow on the next scan, which read as "delete did nothing".
 * A record's filename can differ from its id, so resolve real paths rather than
 * guessing `<id>.json`.
 */
export function deleteImportedWorkflow(id) {
  const safe = safeId(id);
  const records = allCustomWorkflowRecords({ dedupe: false })
    .filter((record) => record.id === safe && record.path && withinWorkflowRoot(record.path));
  // Bundled templates live in the repo: never delete them. Removing a user copy
  // that shadows a template simply brings the built-in version back.
  const targets = records.filter((record) => record.source !== "bundled");
  if (!targets.length) throw new Error(records.length ? "Built-in workflows can't be deleted." : "Workflow file was not found.");
  const removed = [];
  for (const record of targets) {
    if (!fs.existsSync(record.path)) continue;
    fs.unlinkSync(record.path);
    removed.push(record.path);
  }
  if (!removed.length) throw new Error("Workflow file was not found.");
  return { ok: true, id: safe, removed };
}

function nodeInputsForClass(classType = "") {
  if (/KSampler/i.test(classType)) return ["seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"];
  if (/TextEncode/i.test(classType)) return ["text"];
  if (/Latent|Image/i.test(classType)) return ["width", "height", "batch_size"];
  if (/Video/i.test(classType)) return ["length", "fps", "width", "height"];
  return [];
}

/**
 * The import's settings, found in the graph (workflow-understand.js). What the
 * file declares in its heissUi block wins over what was found. `extras`:
 * { titles, variants } from the canvas copy and earlier runs.
 */
export function detectWorkflowMetadata(raw, fallbackName = "", info = {}, extras = {}) {
  const existing = workflowMeta(raw);
  const graph = graphFromJson(raw, info);
  const found = understandWorkflow(graph, { info, titles: extras.titles || {}, variants: extras.variants || [] });
  const controls = { ...found.controls, ...(existing.controls || {}) };
  const declared = new Set(Object.keys(existing.controls || {}));
  const nodes = Object.entries(graph || {}).map(([id, node]) => ({ id, classType: node?.class_type || "", title: String(node?._meta?.title || extras.titles?.[id] || ""), inputs: node?.inputs || {} }));
  const id = safeId(existing.id || fallbackName || "imported-workflow");
  const mediaInputs = Array.isArray(existing.mediaInputs) ? existing.mediaInputs : found.mediaInputs.map(({ role: _role, ...item }) => item);
  return {
    id,
    name: existing.name || fallbackName || id,
    description: existing.description || "Imported ComfyUI workflow",
    kind: existing.kind || found.kind,
    family: existing.family || "custom",
    controls,
    // Found in the graph rather than declared in the file.
    guessed: Object.keys(found.controls).filter((key) => !declared.has(key)),
    confidence: found.confidence,
    question: declared.has("prompt") ? null : found.question,
    loraStack: existing.loraStack || found.loraStack || null,
    settings: Array.isArray(existing.settings) ? existing.settings : found.settings,
    defaults: existing.defaults || {},
    capabilities: {
      ...found.capabilities,
      ...(existing.capabilities || {})
    },
    mediaInputs,
    promptComposition: existing.promptComposition || null,
    aspectRatios: existing.aspectRatios || existing.aspects || [],
    aspectPolicy: existing.aspectPolicy || found.aspectPolicy,
    nodes: nodes.map((node) => ({
      id: node.id,
      classType: node.classType,
      title: node.title,
      inputs: Object.keys(node.inputs || {}),
      suggestedInputs: nodeInputsForClass(node.classType).filter((input) => input in node.inputs)
    }))
  };
}

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dataDir } from './gallery-store.js';
import { root } from './comfy.js';
import { workflowIds } from './workflow-registry.js';

export const bundledWorkflowsDir = path.join(root, "workflows");
export const userWorkflowsDir = path.join(dataDir, "workflows");

function safeId(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `workflow-${crypto.randomUUID()}`;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function graphFromJson(raw, info = {}) {
  if (raw?.graph && typeof raw.graph === "object") return raw.graph;
  if (Array.isArray(raw?.nodes) && Array.isArray(raw?.links)) return visualWorkflowToApi(raw, info);
  const copy = { ...raw };
  delete copy.jAiStudio;
  delete copy.j_ai_studio;
  delete copy.metadata;
  return copy;
}

function schemaInputNames(info, classType) {
  const schema = info?.[classType]?.input || {};
  return [...Object.keys(schema.required || {}), ...Object.keys(schema.optional || {})]
    .filter((name) => !["unique_id", "control_after_generate"].includes(name));
}

function visualWorkflowToApi(raw, info = {}) {
  const links = new Map((raw.links || []).map((link) => [String(link[0]), [String(link[1]), Number(link[2] || 0)]]));
  const graph = {};
  // These nodes exist only for canvas organization and are not part of the API prompt.
  const uiOnly = new Set(["Note", "Reroute", "PrimitiveNode", "NoteNode"]);
  for (const node of raw.nodes) {
    const id = String(node.id);
    const classType = node.type || node.class_type;
    if (!classType) throw new Error(`Visual workflow node ${id} is missing a type.`);
    if (uiOnly.has(classType)) continue;
    const inputs = {};
    for (const input of node.inputs || []) {
      if (input?.link != null && links.has(String(input.link))) inputs[input.name] = links.get(String(input.link));
    }
    const names = schemaInputNames(info, classType);
    const linked = new Set(Object.keys(inputs));
    const widgetNames = names.filter((name) => !linked.has(name));
    const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : [];
    if (widgets.length > widgetNames.length) throw new Error(`Node ${id} (${classType}) has more widget values than its ComfyUI schema. Reconnect ComfyUI before importing.`);
    widgets.forEach((value, index) => { inputs[widgetNames[index]] = value; });
    graph[id] = { class_type: classType, inputs, ...(node._meta ? { _meta: node._meta } : {}) };
  }
  return graph;
}

export function detectWorkflowFormat(raw) {
  if (Array.isArray(raw?.nodes) && Array.isArray(raw?.links)) return "comfyui-visual";
  if (raw?.prompt && typeof raw.prompt === "object") return "comfyui-api-wrapper";
  if (raw && typeof raw === "object" && Object.values(raw).some((node) => node?.class_type)) return "comfyui-api";
  return "unsupported";
}

export function metadataFromJson(raw, file) {
  const meta = raw?.jAiStudio || raw?.j_ai_studio || {};
  const id = safeId(meta.id || path.basename(file || "", path.extname(file || "")));
  const graph = graphFromJson(raw);
  const controls = meta.controls || {};
  const graphDefault = (key) => {
    const mapping = controls[key];
    return mapping?.node && mapping?.input ? graph?.[mapping.node]?.inputs?.[mapping.input] : undefined;
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
    capabilities: {
      negativePrompt: Boolean(controls.negative),
      variations: Boolean(controls.count),
      frames: Boolean(controls.frames),
      fps: Boolean(controls.fps),
      startImage: Boolean(controls.startImage),
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
  if (!graph || typeof graph !== "object" || !Object.keys(graph).length) throw new Error("Workflow JSON does not contain a ComfyUI API graph.");
  for (const [id, node] of Object.entries(graph)) {
    if (!node?.class_type) throw new Error(`Workflow node ${id} is missing class_type.`);
    for (const value of Object.values(node.inputs || {})) {
      if (Array.isArray(value) && typeof value[0] === "string" && !graph[value[0]]) {
        throw new Error(`Workflow node ${id} references missing node ${value[0]}.`);
      }
    }
  }
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
          description: "Workflow JSON could not be parsed.",
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
          description: error.message || "Workflow could not be read.",
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
  fs.writeFileSync(file, JSON.stringify(raw, null, 2));
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
    ...(raw?.jAiStudio || raw?.j_ai_studio || {}),
    ...meta
  };
  const workflow = metadataFromJson({ ...raw, jAiStudio: mergedMeta });
  workflow.id = unshadowedId(workflow.id);
  mergedMeta.id = workflow.id;
  workflow.profileId = `custom:${workflow.id}`;
  fs.mkdirSync(userWorkflowsDir, { recursive: true });
  const file = path.join(userWorkflowsDir, `${workflow.id}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...raw, jAiStudio: mergedMeta }, null, 2));
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
  const targets = allCustomWorkflowRecords({ dedupe: false })
    .filter((record) => record.id === safe && record.path && withinWorkflowRoot(record.path));
  if (!targets.length) throw new Error("Workflow file was not found.");
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

export function detectWorkflowMetadata(raw, fallbackName = "", _info = {}) {
  const existing = raw?.jAiStudio || raw?.j_ai_studio || {};
  const graph = graphFromJson(raw);
  const nodes = Object.entries(graph || {}).map(([id, node]) => ({ id, classType: node?.class_type || "", inputs: node?.inputs || {} }));
  const textNodes = nodes.filter((node) => /TextEncode/i.test(node.classType) && "text" in node.inputs);
  const latentNode = nodes.find((node) => /Latent/i.test(node.classType) && ("width" in node.inputs || "height" in node.inputs));
  const samplerNode = nodes.find((node) => /Sampler/i.test(node.classType));
  const videoNode = nodes.find((node) => /Video/i.test(node.classType) && ("length" in node.inputs || "fps" in node.inputs));
  const controls = {
    ...(existing.controls || {})
  };
  const set = (key, node, input) => {
    if (!controls[key] && node && input && input in node.inputs) controls[key] = { node: node.id, input };
  };
  set("prompt", textNodes[0], "text");
  set("negative", textNodes[1], "text");
  set("width", latentNode || videoNode, "width");
  set("height", latentNode || videoNode, "height");
  set("count", latentNode, "batch_size");
  set("seed", samplerNode, "seed");
  set("steps", samplerNode, "steps");
  set("cfg", samplerNode, "cfg");
  set("sampler", samplerNode, "sampler_name");
  set("scheduler", samplerNode, "scheduler");
  set("denoise", samplerNode, "denoise");
  set("frames", videoNode, "length");
  set("fps", videoNode, "fps");
  const hasVideo = nodes.some((node) => /Video|VHS|Wan/i.test(node.classType));
  const id = safeId(existing.id || fallbackName || "imported-workflow");
  return {
    id,
    name: existing.name || fallbackName || id,
    description: existing.description || "Imported ComfyUI workflow",
    kind: existing.kind === "video" || hasVideo ? "video" : "image",
    family: existing.family || "custom",
    controls,
    defaults: existing.defaults || {},
    capabilities: existing.capabilities || {},
    aspectRatios: existing.aspectRatios || existing.aspects || [],
    nodes: nodes.map((node) => ({
      id: node.id,
      classType: node.classType,
      inputs: Object.keys(node.inputs || {}),
      suggestedInputs: nodeInputsForClass(node.classType).filter((input) => input in node.inputs)
    }))
  };
}

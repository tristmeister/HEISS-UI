import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { families, guidanceFor, rapidFor, sanaRunners } from "./family-catalog.js";
import { familyGraph } from "./family-graph.js";
import { nodesFor } from "./family-profiles.js";
import { nodePacks } from "./node-packs.js";

/**
 * Contract tests: every built-in family graph, for every variant and source,
 * checked against what a real ComfyUI accepts. The snapshots in fixtures/ are
 * that ComfyUI's /object_info (scripts/record-object-info.mjs records one;
 * file lists are empty, so any file name passes). For each graph:
 *
 * - a node this ComfyUI has gets every required input, only inputs it knows,
 *   values in its lists and ranges, and links from outputs of the right type;
 * - a node it lacks must be one HEISS checks for before running (the family's
 *   node list, which shows "Newer ComfyUI") or one from a known node pack.
 */

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const snapshots = fs.readdirSync(fixtures).filter((name) => /^object_info-comfyui-.+\.json$/.test(name)).sort();
const packNodes = new Set(Object.values(nodePacks).flatMap((pack) => pack.nodes));
for (const runner of Object.values(sanaRunners)) for (const list of Object.values(runner.variantNodes || {})) list.forEach((node) => packNodes.add(node));

// Samplers a node pack adds to ComfyUI's own lists when it is installed
// (ExtraModels registers Sana Sprint's "scm"); only graphs on that pack use them.
const packSamplers = new Set(["scm"]);

const specsOf = (info, classType) => ({ ...(info[classType]?.input?.required || {}), ...(info[classType]?.input?.optional || {}) });
const isLink = (value) => Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && Number.isInteger(value[1]);
const optionKey = (option) => (option && typeof option === "object" ? option.key : option);

// Inputs that name a file on the user's disk. A fresh ComfyUI lists none (or
// only built-ins such as VAELoader's "pixel_space"), so any file name passes.
const fileInputs = /^(ckpt_name|unet_name|clip_name\d?|vae_name|lora_name|image|model_name|audio_vae_name)$/;

/** What went wrong with one value against its input spec, or "". */
function valueProblem(spec, value, graph, info, name = "") {
  const [type, options = {}] = spec;
  if (fileInputs.test(name) && typeof value === "string" && /\.(safetensors|sft|ckpt|pt|pth|bin|gguf|png|jpe?g|webp)$/i.test(value)) return "";
  if (isLink(value)) {
    const source = graph[value[0]];
    if (!source) return `links to missing node ${value[0]}`;
    const outputs = info[source.class_type]?.output;
    if (!outputs) return "";
    const produced = outputs[value[1]];
    if (produced === undefined) return `links to output ${value[1]} of ${source.class_type}, which has ${outputs.length}`;
    if (Array.isArray(type)) return "";
    const accepted = String(type).split(",");
    if (type === "*" || produced === "*" || accepted.includes(produced) || String(produced).split(",").some((kind) => accepted.includes(kind))) return "";
    if (type === "COMBO" || type === "COMFY_DYNAMICCOMBO_V3" || type === "COMFY_MATCHTYPE_V3") return "";
    return `gets ${produced} from ${source.class_type}, needs ${type}`;
  }
  const list = Array.isArray(type) ? type : type === "COMBO" ? options.options : null;
  if (list) {
    if (!list.length) return typeof value === "string" && value ? "" : "needs a file name";
    return list.map(optionKey).includes(value) ? "" : `${JSON.stringify(value)} is not one of ${JSON.stringify(list.map(optionKey).slice(0, 12))}`;
  }
  if (type === "COMFY_DYNAMICCOMBO_V3") return options.options.some((option) => option.key === value) ? "" : `${JSON.stringify(value)} is not one of ${options.options.map((option) => option.key)}`;
  if (type === "INT" || type === "FLOAT") {
    if (typeof value !== "number" || !Number.isFinite(value)) return `${JSON.stringify(value)} is not a number`;
    if (type === "INT" && !Number.isInteger(value)) return `${value} is not a whole number`;
    if (options.min !== undefined && value < options.min) return `${value} is below ${options.min}`;
    if (options.max !== undefined && value > options.max) return `${value} is above ${options.max}`;
    return "";
  }
  if (type === "STRING") return typeof value === "string" ? "" : `${JSON.stringify(value)} is not text`;
  if (type === "BOOLEAN") return typeof value === "boolean" ? "" : `${JSON.stringify(value)} is not true or false`;
  return `a ${type} input needs a link, got ${JSON.stringify(value)}`;
}

/** The spec for a nested input ("images.image_1", "format.codec"), or null. */
function nestedSpec(specs, key, inputs) {
  const [parent, ...rest] = key.split(".");
  const parentSpec = specs[parent];
  if (!parentSpec || !rest.length) return null;
  const [type, options = {}] = parentSpec;
  if (type === "COMFY_AUTOGROW_V3") {
    const template = options.template || {};
    const names = template.names || [];
    const child = rest.join(".");
    const known = names.includes(child) || (template.prefix && child.startsWith(template.prefix));
    const inner = Object.values({ ...(template.input?.required || {}), ...(template.input?.optional || {}) })[0];
    return known ? inner || ["*"] : null;
  }
  if (type === "COMFY_DYNAMICCOMBO_V3") {
    const selected = options.options.find((option) => option.key === inputs[parent]);
    const childSpecs = { ...(selected?.inputs?.required || {}), ...(selected?.inputs?.optional || {}) };
    return rest.length === 1 ? childSpecs[rest[0]] || null : nestedSpec(childSpecs, rest.join("."), Object.fromEntries(Object.entries(inputs).filter(([name]) => name.startsWith(`${parent}.`)).map(([name, value]) => [name.slice(parent.length + 1), value])));
  }
  return null;
}

/** Every problem with `graph` against `info`, each naming the node. */
function graphProblems(graph, info, declared) {
  const problems = [];
  const onPack = Object.values(graph).some((node) => packNodes.has(node.class_type));
  for (const [id, node] of Object.entries(graph)) {
    const label = `${node.class_type} (#${id})`;
    if (!info[node.class_type]) {
      if (!declared.has(node.class_type) && !packNodes.has(node.class_type)) problems.push(`${label} is not in this ComfyUI, and nothing checks for it before a run`);
      continue;
    }
    const specs = specsOf(info, node.class_type);
    const required = info[node.class_type].input?.required || {};
    for (const [name, spec] of Object.entries(required)) {
      // Growable and choice inputs are filled through their nested keys.
      if (["COMFY_AUTOGROW_V3"].includes(spec[0])) continue;
      if (!(name in node.inputs)) problems.push(`${label} misses its required input ${name}`);
    }
    for (const [name, value] of Object.entries(node.inputs)) {
      const spec = specs[name] || nestedSpec(specs, name, node.inputs);
      if (!spec) {
        problems.push(`${label} has no input ${name}`);
        continue;
      }
      if (onPack && name === "sampler_name" && packSamplers.has(value)) continue;
      const problem = valueProblem(spec, value, graph, info, name.split(".").pop());
      if (problem) problems.push(`${label}.${name}: ${problem}`);
    }
  }
  return problems;
}

/** A request as validation.js hands it to the graph builder, for one family, variant and source. */
function requestFor(familyId, family, variant, source, info, extra = {}) {
  const [width, height] = variant.size || family.size;
  const bundledEncoder = source === "checkpoint" && !family.neverBundledEncoder;
  return {
    family: familyId,
    variant: variant.id,
    source,
    model: source === "checkpoint" ? "checkpoints/model.safetensors" : "model.safetensors",
    bundled: source === "checkpoint" ? { encoder: true, vae: true } : undefined,
    encoders: bundledEncoder ? [] : family.slots.map((_, index) => `encoder-${index + 1}.safetensors`),
    vae: source === "checkpoint" ? "" : "vae.safetensors",
    audioVae: family.audioVae ? "audio-vae.safetensors" : "",
    pairModel: family.pair ? "partner.safetensors" : "",
    clipVision: family.clipVision ? "vision.safetensors" : "",
    prompt: "a lighthouse in fog",
    negative: "blurry",
    width,
    height,
    count: 2,
    steps: variant.defaults.steps,
    cfg: variant.defaults.cfg,
    sampler: variant.defaults.sampler,
    scheduler: variant.defaults.scheduler,
    seed: 1234,
    weightDtype: "default",
    frames: family.frames,
    fps: family.fps,
    vpredPatch: Boolean(variant.vpred),
    // validation.js turns the enhancer on only when that node is installed.
    krea2Enhancer: Boolean(family.enhancer && info["ComfyUI-Krea2T-Enhancer"]),
    ...extra
  };
}

function* cases(info) {
  for (const [familyId, family] of Object.entries(families)) {
    for (const variant of family.variants) {
      for (const source of family.sources) {
        const name = `${familyId}/${variant.id} from ${source}`;
        // A video made from a picture has no run without one; it is checked below with its start image.
        if (family.startImage !== "required") yield { name, family, variant, source, body: requestFor(familyId, family, variant, source, info) };
        if (family.references) yield { name: `${name}, with references`, family, variant, source, body: requestFor(familyId, family, variant, source, info, { referenceImages: ["ref-1.png", "ref-2.png"] }) };
        if (family.img2img || family.startImage) yield { name: `${name}, from a start image`, family, variant, source, body: requestFor(familyId, family, variant, source, info, { startImageComfy: "start.png", denoise: 0.6 }) };
        const rapid = rapidFor(family, variant);
        if (rapid) yield { name: `${name}, with Rapid`, family, variant, source, body: requestFor(familyId, family, variant, source, info, { rapid: { ...rapid, smooth: true } }) };
        if (guidanceFor(family, variant) && !["h3", "ideogram4", "mage", "sana", "pair"].includes(family.sampling)) yield { name: `${name}, with Rapid Guidance`, family, variant, source, body: requestFor(familyId, family, variant, source, info, { cfg: 4, rapidGuidance: { until: 0.3 } }) };
      }
    }
  }
}

for (const snapshot of snapshots) {
  const version = snapshot.replace(/^object_info-comfyui-|\.json$/g, "");
  const info = JSON.parse(fs.readFileSync(path.join(fixtures, snapshot), "utf8"));
  // HEISS Rapid as ComfyUI-HEISS-UI-Nodes declares it, so its inputs are checked like a core node's.
  info.HeissRapid ||= { input: { required: {
    sampler: ["SAMPLER"],
    switch_at: ["FLOAT", { default: 0.7, min: 0.3, max: 0.99, step: 0.01 }],
    scale: ["FLOAT", { default: 0.5, min: 0.25, max: 0.9, step: 0.05 }],
    min_full_steps: ["INT", { default: 2, min: 1, max: 50 }],
    smooth_switch: ["BOOLEAN", { default: true }]
  } }, output: ["SAMPLER"] };
  info.HeissRapidGuidance ||= { input: { required: {
    model: ["MODEL"], positive: ["CONDITIONING"], negative: ["CONDITIONING"],
    cfg: ["FLOAT", { default: 4, min: 0, max: 100, step: 0.1 }],
    cfg_until: ["FLOAT", { default: 0.3, min: 0, max: 1, step: 0.01 }]
  } }, output: ["GUIDER"] };

  test(`every built-in graph fits ComfyUI ${version}`, () => {
    const failures = [];
    let checked = 0;
    for (const { name, family, variant, source, body } of cases(info)) {
      const declared = new Set(nodesFor(family, variant, body.encoders.length > 0, !body.bundled?.vae));
      let graph;
      try {
        graph = familyGraph(body);
      } catch (error) {
        failures.push(`${name}: ${error.message}`);
        continue;
      }
      checked += 1;
      for (const problem of graphProblems(graph, info, declared)) failures.push(`${name}: ${problem}`);
    }
    assert.ok(checked > 100, `only ${checked} graphs were built`);
    assert.deepEqual(failures, []);
  });

  test(`every family's default sampler and scheduler exist in ComfyUI ${version}`, () => {
    const samplers = info.KSampler.input.required.sampler_name[0];
    const schedulers = info.KSampler.input.required.scheduler[0];
    const missing = [];
    for (const [familyId, family] of Object.entries(families)) {
      for (const variant of family.variants) {
        const packSampler = family.sampling === "sana" && packSamplers.has(variant.defaults.sampler);
        if (!samplers.includes(variant.defaults.sampler) && !packSampler) missing.push(`${familyId}/${variant.id} sampler ${variant.defaults.sampler}`);
        if (!schedulers.includes(variant.defaults.scheduler)) missing.push(`${familyId}/${variant.id} scheduler ${variant.defaults.scheduler}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  test(`the checker itself catches a wrong graph (ComfyUI ${version})`, () => {
    const graph = {
      1: { class_type: "KSampler", inputs: { model: ["2", 0], seed: 1, steps: 0, cfg: 7, sampler_name: "not-a-sampler", scheduler: "karras", positive: ["2", 1], negative: ["3", 0], latent_image: ["3", 0], denoise: 1, surprise: 1 } },
      2: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "model.safetensors" } },
      3: { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
      4: { class_type: "NotARealNode", inputs: {} }
    };
    const problems = graphProblems(graph, info, new Set());
    assert.ok(problems.some((problem) => /steps: 0 is below 1/.test(problem)), problems.join("\n"));
    assert.ok(problems.some((problem) => /sampler_name: "not-a-sampler"/.test(problem)));
    assert.ok(problems.some((problem) => /positive: gets CLIP from CheckpointLoaderSimple, needs CONDITIONING/.test(problem)));
    assert.ok(problems.some((problem) => /negative: gets LATENT from EmptyLatentImage, needs CONDITIONING/.test(problem)));
    assert.ok(problems.some((problem) => /has no input surprise/.test(problem)));
    assert.ok(problems.some((problem) => /NotARealNode .* nothing checks for it/.test(problem)));
  });
}

test("there is at least one ComfyUI snapshot to check against", () => {
  assert.ok(snapshots.length >= 1);
});

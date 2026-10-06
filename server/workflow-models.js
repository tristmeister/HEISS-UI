/**
 * The model files an imported workflow names that ComfyUI doesn't list, and
 * what to do about each, cheapest and safest first:
 *
 *   1. The same file is already here, filed differently (another subfolder,
 *      other slashes, other case): point the workflow at it. No question.
 *   2. A file with a near name is here ("flux1-dev-fp8" for
 *      "flux1-dev-fp8-e4m3fn"): offered, not taken.
 *   3. An exact name in HEISS's catalog or ComfyUI-Manager's model list:
 *      downloaded from Hugging Face with the import.
 *   4. A LoRA nobody has: the workflow runs without it, and says so.
 *   5. A main model nobody has: a model of the same family and format the
 *      person has stands in, and says so. Never another family.
 *   6. Anything else: named, with where it goes.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./gallery-store.js";
import { familyFromName } from "./family-catalog.js";
import { catalogDownloadsForFile } from "./family-profiles.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";

const modelFile = /\.(safetensors|gguf|ckpt|pt|pth|bin|sft)$/i;
const listUrl = "https://raw.githubusercontent.com/Comfy-Org/ComfyUI-Manager/main/model-list.json";
const cachePath = () => path.join(dataDir, "model-name-list.json");
const refreshMs = 24 * 60 * 60 * 1000;

// Where Manager's model types go, for entries saved to "default".
const typeFolders = {
  checkpoint: "checkpoints", checkpoints: "checkpoints", lora: "loras", vae: "vae", taesd: "vae_approx",
  upscale: "upscale_models", controlnet: "controlnet", "t2i-adapter": "controlnet", clip: "text_encoders",
  text_encoders: "text_encoders", unet: "diffusion_models", diffusion_model: "diffusion_models",
  clip_vision: "clip_vision", ipadapter: "ipadapter", gligen: "gligen", embeddings: "embeddings"
};

/** Which models folder a loader input reads from, by node and input name. */
export function folderFor(classType = "", input = "") {
  const name = `${classType} ${input}`;
  if (/lora/i.test(name)) return "loras";
  if (/controlnet|control_net/i.test(name)) return "controlnet";
  if (/upscale/i.test(name)) return "upscale_models";
  if (/clip_?vision/i.test(name)) return "clip_vision";
  if (/ipadapter/i.test(name)) return "ipadapter";
  if (/vae/i.test(name)) return "vae";
  if (/clip|text_?encoder|t5|llm/i.test(name)) return "text_encoders";
  if (/ckpt|checkpoint/i.test(name)) return "checkpoints";
  if (/unet|diffusion|gguf|model_name/i.test(name)) return "diffusion_models";
  return "models";
}

function comboOptions(info, classType, input) {
  const spec = info?.[classType]?.input?.required?.[input] || info?.[classType]?.input?.optional?.[input];
  if (!Array.isArray(spec)) return null;
  if (Array.isArray(spec[0])) return spec[0].map(String);
  if (Array.isArray(spec[1]?.options)) return spec[1].options.map(String);
  return null;
}

/** Every model file the graph names that ComfyUI doesn't list: { node, input, file, folder, classType, lora }. */
export function missingModelRefs(graph = {}, info = {}) {
  const refs = [];
  for (const [id, node] of Object.entries(graph || {})) {
    if (!info?.[node?.class_type]) continue;
    for (const [input, value] of Object.entries(node.inputs || {})) {
      if (typeof value === "string" && modelFile.test(value)) {
        const options = comboOptions(info, node.class_type, input);
        if (!options || options.includes(value)) continue;
        refs.push({ node: id, input, file: value, folder: folderFor(node.class_type, input), classType: node.class_type, lora: /lora/i.test(`${node.class_type} ${input}`) });
      } else if (value && typeof value === "object" && typeof value.lora === "string" && modelFile.test(value.lora) && node.class_type === "Power Lora Loader (rgthree)") {
        // rgthree keeps each LoRA as { on, lora, strength } under lora_N.
        const options = comboOptions(info, "LoraLoader", "lora_name") || [];
        if (value.on !== false && !options.includes(value.lora)) refs.push({ node: id, input, file: value.lora, folder: "loras", classType: node.class_type, lora: true, entry: true });
      }
    }
  }
  return refs;
}

const baseName = (file = "") => String(file).split(/[\\/]/).pop() || "";
const stem = (file = "") => baseName(file).replace(modelFile, "").toLowerCase();
const tokens = (file = "") => new Set(stem(file).split(/[^a-z0-9]+/).filter((token) => token.length > 1));
const extension = (file = "") => (baseName(file).match(modelFile)?.[1] || "").toLowerCase();

/** How alike two file names are, 0..1, by their name parts. */
export function nameSimilarity(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

/** Manager's model list, reduced to name → downloads: { at, files: { name: [{ file, url, folder, size }] } }. */
export function reduceModelList(list = {}) {
  const files = {};
  for (const entry of list?.models || []) {
    const file = baseName(entry?.filename || "");
    const url = String(entry?.url || "");
    if (!file || !/^https:\/\//.test(url)) continue;
    const save = String(entry.save_path || "default");
    const folder = save === "default" ? typeFolders[String(entry.type || "").toLowerCase()] || "" : save.split("/")[0];
    if (!folder) continue;
    (files[file.toLowerCase()] ||= []).push({ file, url, folder, size: String(entry.size || ""), name: String(entry.name || file) });
  }
  return { at: Date.now(), files };
}

let memory = null;
let loading = null;

export async function modelNameList() {
  if (!memory) {
    try {
      const saved = readJsonFile(cachePath());
      if (saved?.files) memory = saved;
    } catch {
      // No copy yet.
    }
  }
  if (!memory || Date.now() - Number(memory.at || 0) > refreshMs) {
    loading ||= fetch(listUrl, { signal: AbortSignal.timeout(30_000) })
      .then((response) => { if (!response.ok) throw new Error(`model list ${response.status}`); return response.json(); })
      .then((list) => {
        const reduced = reduceModelList(list);
        fs.mkdirSync(dataDir, { recursive: true });
        writeJsonFile(cachePath(), reduced);
        memory = reduced;
        return reduced;
      })
      .finally(() => { loading = null; });
    if (!memory) {
      try { await loading; } catch { return { at: 0, files: {} }; }
    } else loading.catch(() => {});
  }
  return memory || { at: 0, files: {} };
}

export function setModelNameListForTests(value) {
  memory = value;
}

/** A download for a file from Manager's list, as model-downloads.js takes it; the id is resolved again server-side. */
export async function listDownload(id = "") {
  const match = String(id).match(/^list:(.+)$/);
  if (!match) return null;
  const list = await modelNameList();
  const entry = (list.files?.[match[1].toLowerCase()] || []).find((item) => /^https:\/\/huggingface\.co\//.test(item.url));
  if (!entry) return null;
  return { id: `list:${entry.file.toLowerCase()}`, file: entry.file, folder: entry.folder, url: entry.url, label: entry.name || entry.file };
}

function sizeLabel(bytes = 0) {
  if (!bytes) return "";
  return bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/**
 * The plan for one import's missing files. `info`: /object_info (its combo
 * options are what ComfyUI has). `list`: modelNameList().
 */
export function planModels(graph = {}, info = {}, { list = { files: {} } } = {}) {
  const plan = { swaps: [], suggestions: [], downloads: [], skippedLoras: [], loraEntriesOff: [], substitutes: [], unresolved: [] };
  const seenDownloads = new Set();
  for (const ref of missingModelRefs(graph, info)) {
    const options = ref.entry ? comboOptions(info, "LoraLoader", "lora_name") || [] : comboOptions(info, graph[ref.node].class_type, ref.input) || [];
    const wanted = baseName(ref.file).toLowerCase();
    // 1. The same file, filed differently.
    const same = options.find((option) => baseName(option).toLowerCase() === wanted);
    if (same) {
      if (ref.entry) continue;
      plan.swaps.push({ node: ref.node, input: ref.input, file: same, wanted: ref.file, reason: "same file" });
      continue;
    }
    // 3. A known download, by exact name.
    const catalog = catalogDownloadsForFile(baseName(ref.file), ref.folder);
    const listed = (list.files?.[wanted] || []).find((item) => /^https:\/\/huggingface\.co\//.test(item.url) && /\.(safetensors|gguf)$/i.test(item.file));
    if (catalog?.length || listed) {
      const id = catalog?.[0]?.id || `list:${wanted}`;
      if (!seenDownloads.has(id)) {
        seenDownloads.add(id);
        plan.downloads.push({ id, file: catalog?.[0]?.file || listed.file, folder: catalog?.[0]?.folder || listed.folder, label: catalog?.[0]?.label || listed.name, size: catalog?.[0]?.bytes ? sizeLabel(catalog[0].bytes) : listed?.size || "", node: ref.node, input: ref.input });
      }
      continue;
    }
    // 2. A near name, offered.
    const near = options
      .filter((option) => extension(option) === extension(ref.file))
      .map((option) => ({ option, score: nameSimilarity(option, ref.file) }))
      .filter((item) => item.score >= 0.6)
      .sort((a, b) => b.score - a.score)[0];
    if (near && !ref.lora) {
      plan.suggestions.push({ node: ref.node, input: ref.input, file: near.option, wanted: ref.file, reason: "similar name" });
      continue;
    }
    // 4. A LoRA nobody has: run without it.
    if (ref.lora) {
      if (ref.entry) plan.loraEntriesOff.push({ node: ref.node, key: ref.input, lora: ref.file });
      else plan.skippedLoras.push({ node: ref.node, file: ref.file });
      continue;
    }
    // 5. A main model: the same family, in the same format.
    if (["checkpoints", "diffusion_models"].includes(ref.folder)) {
      const source = ref.folder === "checkpoints" ? "checkpoint" : "unet";
      const family = familyFromName(ref.file, source);
      const candidates = family && family !== "sdxl_or_sd15"
        ? options.filter((option) => extension(option) === extension(ref.file) && familyFromName(option, source) === family)
        : [];
      if (candidates.length) {
        const pick = candidates.map((option) => ({ option, score: nameSimilarity(option, ref.file) })).sort((a, b) => b.score - a.score)[0].option;
        plan.substitutes.push({ node: ref.node, input: ref.input, file: pick, wanted: ref.file, reason: "same family" });
        continue;
      }
    }
    plan.unresolved.push({ file: ref.file, folder: ref.folder });
  }
  return plan;
}

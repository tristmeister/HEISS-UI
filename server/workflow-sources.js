/**
 * Where an imported workflow comes from, besides a JSON file: ComfyUI's own
 * history (what you ran on the desktop), the workflows saved in ComfyUI, and
 * the images ComfyUI made (it writes the workflow into each one).
 *
 * History and images carry two things: the canvas workflow and the API prompt
 * ComfyUI's own page produced and ran. The prompt needs no conversion and is
 * known to run here, so it is preferred; the canvas copy is kept for titles.
 */
import crypto from "node:crypto";
import zlib from "node:zlib";

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parseJson(text) {
  if (typeof text !== "string") return text && typeof text === "object" ? text : null;
  try {
    return JSON.parse(text);
  } catch {
    // ComfyUI writes NaN for some float widgets; JSON can't read it.
    try { return JSON.parse(text.replace(/\bNaN\b/g, "null")); } catch { return null; }
  }
}

function isApiPrompt(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.values(value).some((node) => node && typeof node === "object" && node.class_type));
}

function isVisual(value) {
  return Boolean(value && typeof value === "object" && Array.isArray(value.nodes));
}

/**
 * Any shape ComfyUI hands out, as { visual, api }: a canvas workflow, an API
 * prompt, { prompt }, { workflow }, { prompt, workflow } (image metadata) or
 * { output } (ComfyUI's graphToPrompt result).
 */
export function unwrapWorkflow(raw) {
  const value = parseJson(raw);
  if (!value || typeof value !== "object") return { visual: null, api: null };
  if (isVisual(value)) return { visual: value, api: null };
  const workflow = parseJson(value.workflow);
  const prompt = parseJson(value.prompt);
  const output = parseJson(value.output);
  return {
    visual: isVisual(workflow) ? workflow : null,
    api: isApiPrompt(prompt) ? prompt : isApiPrompt(output) ? output : isApiPrompt(value) ? value : null
  };
}

/** A balanced JSON object starting at `start` in `text`, or null. */
function balancedJson(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length && index - start < 16 * 1024 * 1024; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return parseJson(text.slice(start, index + 1));
    }
  }
  return null;
}

function pngText(buffer) {
  const text = {};
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IEND") break;
    if (!["tEXt", "iTXt", "zTXt"].includes(type)) continue;
    const zero = data.indexOf(0);
    if (zero < 1) continue;
    const keyword = data.subarray(0, zero).toString("latin1");
    try {
      if (type === "tEXt") text[keyword] ??= data.subarray(zero + 1).toString("utf8");
      else if (type === "zTXt") text[keyword] ??= zlib.inflateSync(data.subarray(zero + 2)).toString("utf8");
      else {
        const compressed = data[zero + 1] === 1;
        const languageEnd = data.indexOf(0, zero + 3);
        const translatedEnd = languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1);
        if (translatedEnd < 0) continue;
        const body = data.subarray(translatedEnd + 1);
        text[keyword] ??= (compressed ? zlib.inflateSync(body) : body).toString("utf8");
      }
    } catch {
      // A damaged chunk is skipped; the others may still hold the workflow.
    }
  }
  return text;
}

/**
 * The workflow inside a file ComfyUI made: PNG text chunks, or the
 * "workflow:" / "prompt:" EXIF strings in WebP, or the JSON comment
 * VideoHelperSuite writes into videos. { visual, api } (either may be null).
 */
export function workflowFromMedia(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return { visual: null, api: null };
  if (buffer.subarray(0, 8).equals(pngSignature)) {
    const text = pngText(buffer);
    const found = unwrapWorkflow({ workflow: text.workflow, prompt: text.prompt });
    if (found.visual || found.api) return found;
  }
  // Everything else: look for the markers ComfyUI and VideoHelperSuite write, and read the JSON after them.
  const text = buffer.toString("latin1");
  const result = { visual: null, api: null };
  for (const marker of ["workflow:", "\"workflow\":", "workflow\u0000"]) {
    let index = text.indexOf(marker);
    while (index >= 0 && !result.visual) {
      const start = text.indexOf("{", index + marker.length);
      if (start >= 0 && start - index < 64) {
        const value = balancedJson(Buffer.from(text.slice(start, start + 16 * 1024 * 1024), "latin1").toString("utf8"), 0);
        if (isVisual(value)) result.visual = value;
      }
      index = text.indexOf(marker, index + marker.length);
    }
  }
  for (const marker of ["prompt:", "\"prompt\":", "prompt\u0000"]) {
    let index = text.indexOf(marker);
    while (index >= 0 && !result.api) {
      const start = text.indexOf("{", index + marker.length);
      if (start >= 0 && start - index < 64) {
        const value = balancedJson(Buffer.from(text.slice(start, start + 16 * 1024 * 1024), "latin1").toString("utf8"), 0);
        if (isApiPrompt(value)) result.api = value;
      }
      index = text.indexOf(marker, index + marker.length);
    }
  }
  return result;
}

/** The shape of a workflow, values left out: two runs with the same shape are the same workflow. */
export function workflowShape(api = {}) {
  const shape = Object.keys(api).sort().map((id) => {
    const node = api[id] || {};
    const links = Object.entries(node.inputs || {}).filter(([, value]) => Array.isArray(value) && value.length === 2).map(([name, value]) => `${name}<${value[0]}:${value[1]}`).sort();
    return `${id}=${node.class_type}(${links.join(",")})`;
  }).join(";");
  return crypto.createHash("sha1").update(shape).digest("hex").slice(0, 16);
}

const modelInputs = ["ckpt_name", "unet_name", "model_name", "gguf_name"];

/** A short name for a run nobody named: its main model, without the file extension. */
export function nameFromPrompt(api = {}) {
  for (const node of Object.values(api)) {
    if (/Lora/i.test(node?.class_type || "")) continue;
    const key = modelInputs.find((name) => typeof node?.inputs?.[name] === "string");
    if (key) {
      const stem = node.inputs[key].split(/[\\/]/).pop().replace(/\.(safetensors|ckpt|gguf|pt|pth|sft|bin)$/i, "");
      return stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    }
  }
  return "ComfyUI workflow";
}

function startedAt(entry) {
  const messages = entry?.status?.messages || [];
  const start = messages.find((message) => Array.isArray(message) && message[0] === "execution_start");
  const timestamp = Number(start?.[1]?.timestamp || 0);
  return timestamp ? new Date(timestamp).toISOString() : "";
}

function firstOutput(entry) {
  for (const output of Object.values(entry?.outputs || {})) {
    for (const [list, kind] of [[output?.images, "image"], [output?.gifs, "video"], [output?.videos, "video"], [output?.animated, "image"]]) {
      const item = Array.isArray(list) ? list.find((value) => value?.filename) : null;
      if (!item) continue;
      const params = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder || "", type: item.type || "output" });
      const video = kind === "video" || /\.(mp4|webm|mov|mkv)$/i.test(item.filename);
      return { url: `/comfy/view?${params}`, thumbnail: video ? "" : `/comfy/thumb?${params}`, video };
    }
  }
  return null;
}

/**
 * Recent distinct workflows from ComfyUI's history, newest first. Only runs
 * from ComfyUI's own page count (they carry the canvas workflow); HEISS UI's
 * and other scripts' runs don't. Runs of the same workflow fold into one.
 */
export function recentFromHistory(history = {}, limit = 12) {
  const runs = Object.entries(history || {}).map(([id, entry]) => {
    const [number, promptId, api, extra] = Array.isArray(entry?.prompt) ? entry.prompt : [];
    const visual = extra?.extra_pnginfo?.workflow;
    if (!isVisual(visual) || !isApiPrompt(api) || extra?.heiss_hidden) return null;
    return { id: String(promptId || id), number: Number(number || 0), at: startedAt(entry), api, visual, output: firstOutput(entry), ok: entry?.status?.status_str !== "error" };
  }).filter(Boolean).sort((a, b) => (b.at || "").localeCompare(a.at || "") || b.number - a.number);
  const groups = new Map();
  for (const run of runs) {
    const shape = workflowShape(run.api);
    const group = groups.get(shape);
    if (group) group.runs += 1;
    else groups.set(shape, { ...run, shape, runs: 1 });
  }
  return [...groups.values()].slice(0, limit).map((run) => ({
    id: run.id,
    name: nameFromPrompt(run.api),
    at: run.at,
    runs: run.runs,
    ok: run.ok,
    thumbnail: run.output?.thumbnail || run.output?.url || "",
    video: Boolean(run.output?.video),
    nodes: Object.keys(run.api).length
  }));
}

/** One history run as an import: its canvas workflow, its prompt, and other runs of the same workflow. */
export function importFromHistory(history = {}, promptId = "") {
  const entries = Object.entries(history || {});
  const match = entries.find(([id, entry]) => id === promptId || entry?.prompt?.[1] === promptId);
  if (!match) throw new Error("That run is no longer in ComfyUI’s history.");
  const [, entry] = match;
  const [, , api, extra] = entry.prompt || [];
  const visual = extra?.extra_pnginfo?.workflow || null;
  if (!isApiPrompt(api)) throw new Error("That run has no workflow to import.");
  const shape = workflowShape(api);
  const variants = entries
    .filter(([, other]) => other !== entry && isApiPrompt(other?.prompt?.[2]) && workflowShape(other.prompt[2]) === shape)
    .map(([, other]) => other.prompt[2])
    .slice(0, 12);
  const output = firstOutput(entry);
  return { visual: isVisual(visual) ? visual : null, api, variants, name: nameFromPrompt(api), thumbnail: output?.thumbnail || output?.url || "" };
}

/** Saved workflow names from ComfyUI's user folder, newest first. Accepts either listing shape ComfyUI returns. */
export function savedWorkflowList(listing) {
  const items = (Array.isArray(listing) ? listing : []).map((item) => typeof item === "string"
    ? { path: item, modified: 0, size: 0 }
    : { path: String(item?.path || ""), modified: Number(item?.modified || 0), size: Number(item?.size || 0) });
  return items
    .filter((item) => /\.json$/i.test(item.path) && !item.path.split(/[\\/]/).some((part) => part.startsWith(".")))
    .sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path))
    .map((item) => ({
      path: item.path.replace(/\\/g, "/"),
      name: item.path.split(/[\\/]/).pop().replace(/\.json$/i, ""),
      modified: item.modified ? new Date(item.modified * (item.modified < 1e12 ? 1000 : 1)).toISOString() : "",
      size: item.size
    }));
}

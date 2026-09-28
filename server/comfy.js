import { envFileKeys, writeLocalEnvValue } from "./env.js";
import { listensBeyondThisComputer, resolveLan } from "./lan.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { isInside } from "./paths.js";

export const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(__dirname, "..");
// A live binding: importers see the new address as soon as setComfyUrl changes it.
export let comfyUrl = normalizeComfyUrl(process.env.COMFY_URL || "") || "http://127.0.0.1:8188";

/** "localhost:8000", "http://pc.local:8188/" or a bare port all become a clean http(s) origin. */
export function normalizeComfyUrl(value = "") {
  let text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{2,5}$/.test(text)) text = `127.0.0.1:${text}`;
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  try {
    const url = new URL(text);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

export function setComfyUrl(value = "") {
  const next = normalizeComfyUrl(value);
  if (!next) throw new Error("That doesn’t look like an address. Try something like 127.0.0.1:8188.");
  writeLocalEnvValue("COMFY_URL", next);
  comfyUrl = next;
  return comfyUrl;
}
export const lan = resolveLan({ argv: process.argv, env: process.env, fileKeys: envFileKeys });
export const host = lan.host;
export const lanListening = listensBeyondThisComputer(host);

/**
 * The Settings switch: remembered in .env, used from the next start. A HOST
 * line in .env that would contradict it is rewritten to match.
 */
export function saveLanSetting(enabled) {
  writeLocalEnvValue("HEISS_LAN", enabled ? "1" : "0");
  if (envFileKeys.has("HOST")) writeLocalEnvValue("HOST", enabled ? "0.0.0.0" : "127.0.0.1");
  return enabled;
}
/** The port asked for (PORT, else 8787). */
export const requestedPort = Number(process.env.PORT || 8787);
// A live binding: the server may move to the next free port when this one is taken (see launch.js).
export let port = requestedPort;
export function setListeningPort(value) {
  port = Number(value) || requestedPort;
  return port;
}
/** What an output can be: images, videos and sound. Anything else in the folder is never served. */
export const outputMediaPattern = /\.(png|jpe?g|webp|gif|avif|bmp|tiff?|mp4|webm|mov|mkv|m4v|flac|mp3|wav|ogg|opus|m4a|aac)$/i;

/**
 * An output file on this computer, for when ComfyUI itself cannot serve it
 * (stopped, restarting). Only images, videos and sound inside the output
 * folder, checked on the real path so a symlink cannot point outside it, and
 * never from a hidden folder (the trash); null otherwise.
 */
export function localOutputFile(filename, subfolder = "", type = "output") {
  if (type !== "output" || !comfyOutputDir || !filename) return null;
  if (!outputMediaPattern.test(String(filename))) return null;
  if (String(subfolder || "").split(/[\\/]/).some((part) => part.startsWith("."))) return null;
  const base = path.resolve(comfyOutputDir);
  const file = path.resolve(base, String(subfolder || ""), String(filename));
  if (!isInside(base, file)) return null;
  try {
    if (!isInside(fs.realpathSync(base), fs.realpathSync(file))) return null;
    return fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

// Resolved, so a hand-written `D:/x` becomes `D:\x` on Windows (Explorer opens its default view otherwise).
export let comfyOutputDir = process.env.COMFY_OUTPUT_DIR ? path.resolve(process.env.COMFY_OUTPUT_DIR) : "";

/**
 * Turn whatever got pasted into a folder path: Explorer's "Copy as path" wraps it
 * in quotes, Finder drags arrive as file:// URLs, and shells write ~ for home.
 */
export function normalizeFolderInput(value = "") {
  let text = String(value || "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  if (/^file:\/\//i.test(text)) {
    try { text = fileURLToPath(text); } catch { /* keep the raw text */ }
  }
  if (text === "~" || /^~[\\/]/.test(text)) text = path.join(os.homedir(), text.slice(1));
  return text ? path.resolve(text) : "";
}

export function setComfyOutputDir(value = "") {
  const next = normalizeFolderInput(value);
  if (!next) throw new Error("Choose an existing ComfyUI output folder.");
  if (!fs.existsSync(next) || !fs.statSync(next).isDirectory()) throw new Error("That folder does not exist on this computer.");
  writeLocalEnvValue("COMFY_OUTPUT_DIR", next);
  comfyOutputDir = next;
  return comfyOutputDir;
}
/**
 * ComfyUI's models folder on this machine, or "" when ComfyUI runs elsewhere.
 * HEISS_COMFY_ROOT wins; otherwise walk up from the output folder, which is not
 * always a direct child of the ComfyUI root, until a real models/ turns up.
 */
export function comfyModelsDir() {
  const comfyRoot = String(process.env.HEISS_COMFY_ROOT || process.env.JAI_COMFY_ROOT || "").trim();
  if (comfyRoot) return path.join(path.resolve(comfyRoot), "models");
  if (!comfyOutputDir) return "";
  let current = path.resolve(comfyOutputDir);
  for (let depth = 0; depth < 4; depth += 1) {
    const parent = path.dirname(current);
    if (!parent || parent === current) break;
    try {
      const models = path.join(parent, "models");
      if (fs.existsSync(models) && fs.statSync(models).isDirectory()) return models;
    } catch {
      // Keep walking; an unreadable level is not fatal.
    }
    current = parent;
  }
  return "";
}

// ComfyUI's model folders by kind, from its /internal/folder_paths: its own
// models/ folder plus every extra_model_paths.yaml location (shared model
// drives, an A1111 install). Empty until the first scan, or when ComfyUI is remote.
let comfyFolderPaths = {};

export function setComfyFolderPaths(map = {}) {
  const next = {};
  for (const [kind, value] of Object.entries(map || {})) {
    // Older ComfyUI answers [paths, extensions]; newer ones just the paths.
    const list = Array.isArray(value?.[0]) ? value[0] : value;
    if (Array.isArray(list)) next[kind] = list.filter((item) => typeof item === "string");
  }
  comfyFolderPaths = next;
}

/**
 * Folders on this machine that hold one kind of model, ComfyUI's list first,
 * then ComfyUI/models/<subfolder> as found from the output folder.
 */
export function modelFolders(kind, subfolders = [kind]) {
  const models = comfyModelsDir();
  const dirs = [...(comfyFolderPaths[kind] || []), ...(models ? subfolders.map((sub) => path.join(models, sub)) : [])];
  return [...new Set(dirs)].filter((dir) => {
    try { return fs.statSync(dir).isDirectory(); } catch { return false; }
  });
}

// Whether other devices may use the studio at all. Who a request comes from
// (this computer, a device, a proxy) is decided in client-trust.js, never
// from the socket address alone.
export const allowLanActions = process.env.HEISS_ALLOW_LAN === "1" || process.env.JAI_ALLOW_LAN === "1" || lanListening;
/** Fake models and placeholder generations when ComfyUI is unreachable. A dev opt-in for agent and UI testing without a GPU. */
export const demoMode = process.env.HEISS_DEMO === "1";

/*
 * Whether ComfyUI just failed to answer. On Windows a refused localhost
 * connection takes about 2 s, so while this is set the image routes read the
 * output folder first instead of making every image wait. Cleared by any
 * answer from ComfyUI, and expires on its own after a few seconds.
 */
let comfyUnreachableUntil = 0;
export const comfyRecentlyUnreachable = () => Date.now() < comfyUnreachableUntil;
export function noteComfyReachable() {
  comfyUnreachableUntil = 0;
}
/** Call with what a fetch to ComfyUI threw; a canceled request says nothing about ComfyUI. */
export function noteComfyFetchError(error) {
  if (error?.name !== "AbortError") comfyUnreachableUntil = Date.now() + 5000;
}

/**
 * How long one request to ComfyUI may take before it counts as unanswered.
 * Uploads and file reads move whole images or videos; everything else is a
 * small JSON answer, and a ComfyUI that takes a minute for one is hung.
 */
export function comfyTimeoutFor(pathname = "") {
  if (/^\/(upload\/|view\b)/.test(pathname)) return 5 * 60_000;
  if (/^\/object_info\b/.test(pathname)) return 2 * 60_000;
  return 60_000;
}

/**
 * One request to ComfyUI. `timeout` (ms) overrides the default for the path;
 * a caller's own `signal` still cancels it early. A failed answer throws with
 * `status` and the untouched `raw` text next to the friendly message.
 */
export async function comfy(pathname, options = {}) {
  const { timeout, ...init } = options;
  const limit = AbortSignal.timeout(Number(timeout) > 0 ? Number(timeout) : comfyTimeoutFor(pathname));
  init.signal = init.signal ? AbortSignal.any([init.signal, limit]) : limit;
  let response;
  try {
    response = await fetch(`${comfyUrl}${pathname}`, init);
  } catch (error) {
    noteComfyFetchError(error);
    throw error;
  }
  noteComfyReachable();
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const raw = `Comfy ${response.status}: ${text || response.statusText}`;
    throw Object.assign(new Error(normalizeComfyError(raw)), { status: response.status, raw });
  }
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response.arrayBuffer();
}

export function normalizeComfyError(message = "") {
  let text = String(message || "").trim();
  const jsonMatch = text.match(/\{[\s\S]*\}$/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const nodeErrors = parsed?.node_errors || {};
      const details = Object.entries(nodeErrors).flatMap(([nodeId, node]) =>
        (node?.errors || []).map((error) => {
          const name = error?.name || node?.class_type || `node ${nodeId}`;
          const detail = error?.message || error?.type || "invalid value";
          return `${name}: ${detail}`;
        })
      );
      text = details.length
        ? `${parsed?.error?.message || "Prompt validation failed"}: ${details.slice(0, 3).join("; ")}`
        : parsed?.error?.message || text;
    } catch {
      // Keep the original ComfyUI error text.
    }
  }
  if (/float4_e2m1fn_x2/i.test(text)) {
    return "This NVFP4 model needs a newer PyTorch build. Use a non-NVFP4 model or update ComfyUI's PyTorch.";
  }
  // Only ComfyUI's own out-of-memory wording: "illegal memory access" or an
  // "allocation" in some other message is a different failure.
  if (/out of memory|OutOfMemoryError|Allocation on device/i.test(text)) {
    return "ComfyUI ran out of GPU memory. Try a smaller size, fewer steps, or a lighter model.";
  }
  if (/cannot import|no module named|module .* has no attribute|attributeerror/i.test(text)) {
    return "ComfyUI failed inside Python. Check that the selected model, custom nodes, and PyTorch version are compatible.";
  }
  return text || "ComfyUI request failed.";
}

export function optionsFor(info, node, key) {
  const input = info?.[node]?.input?.required?.[key];
  if (!Array.isArray(input)) return [];
  if (Array.isArray(input[0])) return input[0];
  if (Array.isArray(input[1]?.options)) return input[1].options;
  return [];
}

export function hasNode(info, node) {
  return Boolean(info?.[node]);
}

export function missingNodes(info, nodes = []) {
  return nodes.filter((node) => !hasNode(info, node));
}
export function nodeRange(info, node, key, fallback = {}) {
  const meta = info?.[node]?.input?.required?.[key]?.[1];
  return typeof meta === "object" && !Array.isArray(meta) ? { ...fallback, ...meta } : fallback;
}

export function textRange(info, node, key) {
  const meta = info?.[node]?.input?.required?.[key]?.[1];
  if (typeof meta !== "object" || Array.isArray(meta)) return {};
  const tooltip = String(meta.tooltip || "");
  const match = tooltip.match(/maximum(?: length)? (?:is |of )?([0-9,]+)\s*(?:characters|chars)?/i);
  const parsedMax = match ? Number(match[1].replace(/,/g, "")) : undefined;
  return {
    ...meta,
    max: Number(meta.max || meta.maxLength || meta.max_length || parsedMax || 0) || undefined
  };
}

/** ComfyUI's input folder on this machine, next to its output folder, or "" when unknown. */
export function comfyInputDir() {
  const explicit = String(process.env.COMFY_INPUT_DIR || "").trim();
  if (explicit) return path.resolve(explicit);
  const comfyRoot = String(process.env.HEISS_COMFY_ROOT || process.env.JAI_COMFY_ROOT || "").trim();
  const candidates = [
    comfyRoot ? path.join(path.resolve(comfyRoot), "input") : "",
    comfyOutputDir ? path.join(path.dirname(path.resolve(comfyOutputDir)), "input") : ""
  ].filter(Boolean);
  return candidates.find((dir) => {
    try { return fs.statSync(dir).isDirectory(); } catch { return false; }
  }) || "";
}

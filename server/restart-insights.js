/**
 * What a ComfyUI restart can teach, read only from what ComfyUI itself says:
 * how long restarts usually take on this machine, which node packs a restart
 * brought in, and which of them failed to load.
 *
 * Every reading here fails quiet. A missing endpoint, an unfamiliar log or too
 * few restarts means no estimate and no note, never a wrong one.
 */
import { nodePacks } from "./node-packs.js";

// Enough restarts to see a pattern, few enough that a new machine or a new
// ComfyUI shows within a couple of restarts.
export const RESTART_SAMPLES = 10;
const MIN_SAMPLES = 3;

/** The history with one more plain restart, oldest dropped. */
export function addRestartSample(history = [], sample) {
  const ms = Math.round(Number(sample?.ms));
  if (!Number.isFinite(ms) || ms <= 0) return history;
  return [...history, { at: sample.at, ms }].slice(-RESTART_SAMPLES);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * How long a restart usually takes, once the restarts agree: at least three,
 * and most of them near the middle one. A slow one-off (something installing)
 * falls outside and changes nothing; restarts all over the place give no
 * estimate at all rather than a misleading one.
 */
export function restartEstimate(history = []) {
  const values = history.map((sample) => Number(sample?.ms)).filter((ms) => Number.isFinite(ms) && ms > 0);
  if (values.length < MIN_SAMPLES) return null;
  const typical = median(values);
  const near = values.filter((ms) => ms >= typical * 0.6 && ms <= typical * 1.6);
  if (near.length < MIN_SAMPLES || near.length < values.length * 0.6) return null;
  return { typicalMs: Math.round(median(near)), samples: values.length };
}

/**
 * The custom node packs ComfyUI has loaded, by folder name, from /object_info:
 * every custom node's python_module reads "custom_nodes.<folder>".
 */
export function loadedPacks(objectInfo) {
  const packs = new Set();
  for (const node of Object.values(objectInfo || {})) {
    const match = String(node?.python_module || "").match(/^custom_nodes\.([^.]+)/);
    if (match) packs.add(match[1]);
  }
  return [...packs].sort();
}

/** The folders of node packs ComfyUI reported failing to load, from its startup log. */
export function failedPacks(logText) {
  const failed = new Set();
  // ComfyUI's startup tables: "   0.4 seconds (IMPORT FAILED): /path/to/custom_nodes/Pack"
  for (const match of String(logText || "").matchAll(/\((?:IMPORT|PRESTARTUP) FAILED\):\s*(.+?)\s*$/gm)) {
    const folder = match[1].replace(/[\\/]+$/, "").split(/[\\/]/).pop();
    if (folder && folder !== "custom_nodes") failed.add(folder.replace(/\.py$/i, ""));
  }
  return [...failed].sort();
}

/** The text of /internal/logs/raw, whose entries each hold a chunk of the terminal. */
export function logTextFromRaw(raw) {
  const entries = Array.isArray(raw?.entries) ? raw.entries : [];
  return entries.map((entry) => String(entry?.m ?? "")).join("");
}

const knownNames = new Map(Object.values(nodePacks).map((pack) => [String(pack.folder).toLowerCase(), pack.name]));

/**
 * A pack's name for people: HEISS's own name when it knows the pack, else the
 * folder without its ComfyUI prefix or suffix ("comfyui-easy-use" → "Easy Use").
 */
export function packLabel(folder) {
  const known = knownNames.get(String(folder).toLowerCase());
  if (known) return known;
  const trimmed = String(folder).replace(/^comfy(?:ui)?[-_ ]+/i, "").replace(/[-_ ]+comfy(?:ui)?$/i, "");
  const words = (trimmed || String(folder)).split(/[-_]+/).filter(Boolean);
  // A single word is kept as its author wrote it ("rgthree"); several read as a title.
  if (words.length < 2) return words[0] || String(folder);
  return words.map((word) => (word === word.toLowerCase() && word.length > 2 ? word[0].toUpperCase() + word.slice(1) : word)).join(" ");
}

/**
 * What changed across one restart. A restart that brought in, lost or failed
 * a pack is not a plain one, so it does not count toward the usual time.
 */
export function restartChanges(before, after, failed = []) {
  if (!before || !after) return { newPacks: [], failedPacks: failed, plain: failed.length === 0 && Boolean(before && after) };
  const had = new Set(before);
  const has = new Set(after);
  const newPacks = after.filter((pack) => !had.has(pack) && !failed.includes(pack));
  const gone = before.filter((pack) => !has.has(pack));
  return { newPacks, failedPacks: failed, plain: newPacks.length === 0 && gone.length === 0 && failed.length === 0 };
}

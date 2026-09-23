import path from "node:path";
import { dataDir } from "./gallery-store.js";
import { readJsonFile, writeJsonFile } from './json-store.js';

const stacksPath = path.join(dataDir, "lora-stacks.json");

// Generous caps: enough for anyone, small enough that a bad client cannot bloat the file.
const maxLorasPerStack = 8;
const maxStacksPerFamily = 200;
const maxOpsPerRequest = 500;

function readState() {
  try {
    const value = readJsonFile(stacksPath);
    if (value?.stacks && typeof value.stacks === "object") return { stacks: value.stacks, library: value.library || null };
    return { stacks: value && typeof value === "object" ? value : {}, library: null };
  } catch {
    return { stacks: {}, library: null };
  }
}

function writeState(state) {
  writeJsonFile(stacksPath, state);
}

function cleanStack(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((item) => {
    const name = String(item?.name || "").trim();
    if (!name || seen.has(name)) return [];
    seen.add(name);
    return [{ name, enabled: item?.enabled !== false, strength: Number.isFinite(Number(item?.strength)) ? Number(item.strength) : 0.7 }];
  }).slice(0, maxLorasPerStack);
}

function cleanNames(value, limit = 500) {
  return Array.isArray(value) ? [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, limit) : [];
}

function cleanSnapshot(value) {
  const id = String(value?.id || "").trim().slice(0, 100);
  if (!id) return null;
  return { id, name: String(value?.name || "").trim().slice(0, 120) || "Untitled stack", loras: cleanStack(value?.loras) };
}

function cleanSnapshots(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(Object.entries(source).map(([key, list]) => {
    const seen = new Set();
    const stacks = (Array.isArray(list) ? list : []).map(cleanSnapshot).filter((stack) => stack && !seen.has(stack.id) && seen.add(stack.id));
    return [String(key).slice(0, 200), stacks.slice(0, maxStacksPerFamily)];
  }));
}

function cleanStrengths(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(Object.entries(source).map(([workflow, entries]) => [
    workflow,
    Object.fromEntries(Object.entries(entries && typeof entries === "object" ? entries : {}).filter(([, strength]) => Number.isFinite(Number(strength))).map(([name, strength]) => [name, Number(strength)]))
  ]));
}

function cleanLibrary(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    strengths: cleanStrengths(source.strengths),
    // Stacks are keyed by model family ("family:z-image"); older builds keyed them by workflow id.
    snapshots: cleanSnapshots(source.snapshots),
    favorites: cleanNames(source.favorites),
    recents: cleanNames(source.recents, 12)
  };
}

export function loadLoraStack(workflowId) {
  const value = readState().stacks[String(workflowId || "")];
  return Array.isArray(value) ? cleanStack(value) : null;
}

export function saveLoraStack(workflowId, stack) {
  const id = String(workflowId || "").trim();
  if (!id) throw new Error("A workflow is required to save a LoRA stack.");
  const state = readState();
  state.stacks[id] = cleanStack(stack);
  writeState(state);
  return state.stacks[id];
}

export function loadLoraLibrary() {
  const library = readState().library;
  return library ? cleanLibrary(library) : null;
}

/**
 * Folds another copy of the library into this one without losing anything:
 * stacks are matched by id, new ones added; favorites and recents are joined;
 * strengths fill in only what is not set yet. Used for the whole-library PUT
 * that older builds (and a device's first sync) send, so it can never wipe
 * stacks saved from another device.
 */
function mergeLibrary(into, incoming) {
  const other = cleanLibrary(incoming);
  for (const [key, stacks] of Object.entries(other.snapshots)) {
    const list = into.snapshots[key] || (into.snapshots[key] = []);
    for (const stack of stacks) if (!list.some((item) => item.id === stack.id)) list.push(stack);
  }
  into.favorites = [...new Set([...into.favorites, ...other.favorites])];
  into.recents = [...new Set([...into.recents, ...other.recents])].slice(0, 12);
  for (const [workflow, entries] of Object.entries(other.strengths)) {
    into.strengths[workflow] = { ...entries, ...(into.strengths[workflow] || {}) };
  }
}

/**
 * One edit, applied to whatever the server holds right now. Each is safe to
 * replay: a retried "add" does not duplicate, a retried "delete" is a no-op,
 * and favorites are set rather than toggled.
 */
function applyOp(state, library, op) {
  const key = String(op?.key || "");
  const list = () => library.snapshots[key] || (library.snapshots[key] = []);
  switch (op?.op) {
    case "stack.add": {
      const stack = cleanSnapshot(op.stack);
      if (stack && key && !list().some((item) => item.id === stack.id)) list().push(stack);
      break;
    }
    case "stack.update":
      if (key) library.snapshots[key] = list().map((item) => item.id === op.id ? { ...item, loras: cleanStack(op.loras) } : item);
      break;
    case "stack.rename": {
      const name = String(op.name || "").trim().slice(0, 120);
      if (key && name) library.snapshots[key] = list().map((item) => item.id === op.id ? { ...item, name } : item);
      break;
    }
    case "stack.delete":
      if (key) library.snapshots[key] = list().filter((item) => item.id !== op.id);
      break;
    case "stack.move": {
      // Stacks older builds saved per workflow move to the model family.
      const from = String(op.from || "");
      if (!key || !from || from === key || !library.snapshots[from]) break;
      for (const stack of library.snapshots[from]) if (!list().some((item) => item.id === stack.id)) list().push(stack);
      delete library.snapshots[from];
      break;
    }
    case "strengths": {
      const workflow = String(op.workflowId || "");
      if (workflow) library.strengths[workflow] = { ...(library.strengths[workflow] || {}), ...cleanStrengths({ x: op.values }).x };
      break;
    }
    case "favorite": {
      const name = String(op.name || "").trim();
      if (!name) break;
      library.favorites = op.on ? [...new Set([...library.favorites, name])] : library.favorites.filter((item) => item !== name);
      break;
    }
    case "recents": {
      const added = cleanNames(op.names, 12);
      library.recents = [...added, ...library.recents.filter((item) => !added.includes(item))].slice(0, 12);
      break;
    }
    case "active": {
      const workflow = String(op.workflowId || "").trim();
      if (workflow) state.stacks[workflow] = cleanStack(op.loras);
      break;
    }
    case "merge":
      mergeLibrary(library, op.library);
      break;
    default:
      break;
  }
}

/** Applies a batch of edits in order and returns the library as it now stands. */
export function applyLoraOps(ops) {
  if (!Array.isArray(ops)) throw new Error("Expected a list of LoRA library changes.");
  const state = readState();
  const library = cleanLibrary(state.library);
  for (const op of ops.slice(0, maxOpsPerRequest)) applyOp(state, library, op);
  state.library = cleanLibrary(library);
  writeState(state);
  return state.library;
}

/** Whole-library saves merge rather than replace, so a stale device cannot erase another's stacks. */
export function saveLoraLibrary(library) {
  return applyLoraOps([{ op: "merge", library }]);
}

/** Forgets every saved stack and the strength/snapshot library (used by "Reset all settings"). */
export function clearLoraState() {
  writeState({ stacks: {}, library: null });
}

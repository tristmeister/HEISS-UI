import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./gallery-store.js";

const stacksPath = path.join(dataDir, "lora-stacks.json");

function readState() {
  try {
    const value = JSON.parse(fs.readFileSync(stacksPath, "utf8"));
    if (value?.stacks && typeof value.stacks === "object") return { stacks: value.stacks, library: value.library || null };
    return { stacks: value && typeof value === "object" ? value : {}, library: null };
  } catch {
    return { stacks: {}, library: null };
  }
}

function writeState(state) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(stacksPath, JSON.stringify(state, null, 2));
}

function cleanStack(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((item) => {
    const name = String(item?.name || "").trim();
    if (!name) return [];
    return [{ name, enabled: item?.enabled !== false, strength: Number.isFinite(Number(item?.strength)) ? Number(item.strength) : 0.7 }];
  });
}

function cleanNames(value, limit = 500) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, limit) : [];
}

function cleanLibrary(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    strengths: source.strengths && typeof source.strengths === "object" ? source.strengths : {},
    // Stacks are keyed by model family ("family:z-image"); older builds keyed them by workflow id.
    snapshots: source.snapshots && typeof source.snapshots === "object" ? source.snapshots : {},
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

export function saveLoraLibrary(library) {
  const state = readState();
  state.library = cleanLibrary(library);
  writeState(state);
  return state.library;
}

/** Forgets every saved stack and the strength/snapshot library (used by "Reset all settings"). */
export function clearLoraState() {
  writeState({ stacks: {}, library: null });
}

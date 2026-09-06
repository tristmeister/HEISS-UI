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

function cleanLibrary(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    strengths: source.strengths && typeof source.strengths === "object" ? source.strengths : {},
    snapshots: source.snapshots && typeof source.snapshots === "object" ? source.snapshots : {}
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

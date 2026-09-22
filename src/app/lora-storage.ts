import { normalizeLoras } from './loras';
import type { LoraSelection } from './types';

const storageKey = 'heiss-ui-lora-library';
const legacyStorageKey = 'j-ai-studio-lora-library';
const maxRecents = 12;

export type LoraSnapshot = {
  id: string;
  name: string;
  loras: LoraSelection[];
};

/**
 * Everything HEISS UI remembers about LoRAs, kept in localStorage and mirrored
 * to the server (debounced) so it survives a cleared browser:
 * - strengths: last strength per workflow and LoRA
 * - snapshots: saved stacks, keyed by model family ("family:z-image"); older
 *   builds keyed them by workflow id, which loraStacks() migrates on read
 * - favorites / recents: LoRA file names, across all workflows
 */
type LoraLibrary = {
  strengths: Record<string, Record<string, number>>;
  snapshots: Record<string, LoraSnapshot[]>;
  favorites: string[];
  recents: string[];
};

const names = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];

function clean(source: any): LoraLibrary {
  return {
    strengths: source?.strengths && typeof source.strengths === 'object' ? source.strengths : {},
    snapshots: source?.snapshots && typeof source.snapshots === 'object' ? source.snapshots : {},
    favorites: names(source?.favorites),
    recents: names(source?.recents).slice(0, maxRecents)
  };
}

function library(): LoraLibrary {
  try {
    let saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (!saved) {
      const legacy = localStorage.getItem(legacyStorageKey);
      if (legacy) {
        saved = JSON.parse(legacy);
        localStorage.setItem(storageKey, legacy);
      }
    }
    return clean(saved);
  } catch {
    return clean(null);
  }
}

let syncTimer: number | null = null;

function save(value: LoraLibrary) {
  localStorage.setItem(storageKey, JSON.stringify(value));
  // Strength changes arrive on every slider tick; only the settled library goes to the server.
  if (syncTimer !== null) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    fetch('/api/loras/library', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ library: library() })
    }).catch(() => null);
  }, 600);
}

export function replaceLoraLibrary(value: unknown) {
  localStorage.setItem(storageKey, JSON.stringify(clean(value)));
}

export function currentLoraLibrary() {
  return library();
}

/* ------------------------------------------------------------ Strengths */

export function rememberedLoraStrength(workflowId: string, name: string, fallback: number) {
  const strength = library().strengths[workflowId]?.[name];
  return Number.isFinite(strength) ? strength : fallback;
}

export function rememberLoraStrengths(workflowId: string, loras: LoraSelection[]) {
  if (!workflowId) return;
  const value = library();
  const strengths = value.strengths[workflowId] || {};
  for (const item of normalizeLoras(loras)) strengths[item.name] = item.strength;
  value.strengths[workflowId] = strengths;
  save(value);
}

/* --------------------------------------------------------------- Stacks */

export function loraFamilyKey(family = '') {
  return `family:${family || 'other'}`;
}

/** Stacks for a model family. Stacks saved per workflow by older builds move over the first time they're read. */
export function loraStacks(familyKey: string, legacyWorkflowId = ''): LoraSnapshot[] {
  const value = library();
  const legacy = legacyWorkflowId && legacyWorkflowId !== familyKey ? value.snapshots[legacyWorkflowId] : null;
  if (legacy?.length) {
    value.snapshots[familyKey] = [...(value.snapshots[familyKey] || []), ...legacy];
    delete value.snapshots[legacyWorkflowId];
    save(value);
  }
  return (value.snapshots[familyKey] || []).map((snapshot) => ({ ...snapshot, loras: normalizeLoras(snapshot.loras) }));
}

export function saveLoraStack(familyKey: string, name: string, loras: LoraSelection[]) {
  const value = library();
  const snapshot: LoraSnapshot = { id: crypto.randomUUID(), name: name.trim() || 'Untitled stack', loras: normalizeLoras(loras) };
  value.snapshots[familyKey] = [...(value.snapshots[familyKey] || []), snapshot];
  save(value);
  return snapshot;
}

function editStacks(familyKey: string, edit: (stacks: LoraSnapshot[]) => LoraSnapshot[]) {
  const value = library();
  value.snapshots[familyKey] = edit(value.snapshots[familyKey] || []);
  save(value);
}

export function updateLoraStack(familyKey: string, id: string, loras: LoraSelection[]) {
  editStacks(familyKey, (stacks) => stacks.map((stack) => stack.id === id ? { ...stack, loras: normalizeLoras(loras) } : stack));
}

export function renameLoraStack(familyKey: string, id: string, name: string) {
  editStacks(familyKey, (stacks) => stacks.map((stack) => stack.id === id ? { ...stack, name: name.trim() || stack.name } : stack));
}

export function deleteLoraStack(familyKey: string, id: string) {
  editStacks(familyKey, (stacks) => stacks.filter((stack) => stack.id !== id));
}

/* --------------------------------------------------- Favorites, recents */

export function loraFavorites() {
  return library().favorites;
}

export function toggleLoraFavorite(name: string) {
  const value = library();
  value.favorites = value.favorites.includes(name) ? value.favorites.filter((item) => item !== name) : [...value.favorites, name];
  save(value);
  return value.favorites;
}

export function loraRecents() {
  return library().recents;
}

export function recordLoraRecents(added: string[]) {
  if (!added.length) return;
  const value = library();
  value.recents = [...added, ...value.recents.filter((item) => !added.includes(item))].slice(0, maxRecents);
  save(value);
}

export function clearLoraLibrary() {
  if (syncTimer !== null) window.clearTimeout(syncTimer);
  syncTimer = null;
  localStorage.removeItem(storageKey);
  localStorage.removeItem(legacyStorageKey);
}

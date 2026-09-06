import { normalizeLoras } from './loras';
import type { LoraSelection } from './types';

const storageKey = 'j-ai-studio-lora-library';

export type LoraSnapshot = {
  id: string;
  name: string;
  loras: LoraSelection[];
};

type LoraLibrary = {
  strengths: Record<string, Record<string, number>>;
  snapshots: Record<string, LoraSnapshot[]>;
};

function library(): LoraLibrary {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return {
      strengths: saved?.strengths && typeof saved.strengths === 'object' ? saved.strengths : {},
      snapshots: saved?.snapshots && typeof saved.snapshots === 'object' ? saved.snapshots : {}
    };
  } catch {
    return { strengths: {}, snapshots: {} };
  }
}

function save(value: LoraLibrary) {
  localStorage.setItem(storageKey, JSON.stringify(value));
  fetch('/api/loras/library', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ library: value })
  }).catch(() => null);
}

export function replaceLoraLibrary(value: unknown) {
  const source = value && typeof value === 'object' ? value as LoraLibrary : { strengths: {}, snapshots: {} };
  localStorage.setItem(storageKey, JSON.stringify({
    strengths: source.strengths && typeof source.strengths === 'object' ? source.strengths : {},
    snapshots: source.snapshots && typeof source.snapshots === 'object' ? source.snapshots : {}
  }));
}

export function currentLoraLibrary() {
  return library();
}

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

export function loraSnapshots(workflowId: string) {
  return (library().snapshots[workflowId] || []).map((snapshot) => ({
    ...snapshot,
    loras: normalizeLoras(snapshot.loras)
  }));
}

export function saveLoraSnapshot(workflowId: string, name: string, loras: LoraSelection[]) {
  const value = library();
  const snapshot: LoraSnapshot = {
    id: crypto.randomUUID(),
    name: name.trim() || 'Untitled snapshot',
    loras: normalizeLoras(loras)
  };
  value.snapshots[workflowId] = [...(value.snapshots[workflowId] || []), snapshot];
  save(value);
  return snapshot;
}

export function renameLoraSnapshot(workflowId: string, id: string, name: string) {
  const value = library();
  value.snapshots[workflowId] = (value.snapshots[workflowId] || []).map((snapshot) => snapshot.id === id
    ? { ...snapshot, name: name.trim() || snapshot.name }
    : snapshot);
  save(value);
}

export function deleteLoraSnapshot(workflowId: string, id: string) {
  const value = library();
  value.snapshots[workflowId] = (value.snapshots[workflowId] || []).filter((snapshot) => snapshot.id !== id);
  save(value);
}

export function clearLoraLibrary() {
  localStorage.removeItem(storageKey);
}

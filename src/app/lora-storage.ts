import { normalizeLoras } from './loras';
import { clientJobUuid } from './format';
import type { LoraSelection } from './types';

const storageKey = 'heiss-ui-lora-library';
const legacyStorageKey = 'j-ai-studio-lora-library';
const pendingKey = 'heiss-ui-lora-pending';
const mergedKey = 'heiss-ui-lora-merged-v2';
const maxRecents = 12;

export type LoraSnapshot = {
  id: string;
  name: string;
  loras: LoraSelection[];
};

/**
 * Everything HEISS UI remembers about LoRAs:
 * - strengths: last strength per workflow and LoRA
 * - snapshots: saved stacks, keyed by model family ("family:z-image"); older
 *   builds keyed them by workflow id, which loraStacks() migrates on read
 * - favorites / recents: LoRA file names, across all workflows
 *
 * The server holds the real copy so every device on the LAN shares it. Each
 * change applies here at once (memory first, so a browser that blocks
 * storage still works), then goes to the server as a small edit, not a whole
 * copy, so two devices never overwrite each other. Edits that cannot be sent
 * wait in a persisted queue and retry until the server takes them.
 */
type LoraLibrary = {
  strengths: Record<string, Record<string, number>>;
  snapshots: Record<string, LoraSnapshot[]>;
  favorites: string[];
  recents: string[];
};

type LoraOp =
  | { op: 'stack.add'; key: string; stack: LoraSnapshot }
  | { op: 'stack.update'; key: string; id: string; loras: LoraSelection[] }
  | { op: 'stack.rename'; key: string; id: string; name: string }
  | { op: 'stack.delete'; key: string; id: string }
  | { op: 'stack.move'; key: string; from: string }
  | { op: 'strengths'; workflowId: string; values: Record<string, number> }
  | { op: 'favorite'; name: string; on: boolean }
  | { op: 'recents'; names: string[] }
  | { op: 'active'; workflowId: string; loras: LoraSelection[] }
  | { op: 'merge'; library: LoraLibrary };

export type LoraSyncStatus = { pending: number; failing: boolean; locked: boolean; error: string };

/* --------------------------------------------------------------- Storage */

function readStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode or a full quota: memory and the server still hold it.
  }
}

const names = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];

function clean(source: any): LoraLibrary {
  return {
    strengths: source?.strengths && typeof source.strengths === 'object' ? source.strengths : {},
    snapshots: source?.snapshots && typeof source.snapshots === 'object' ? source.snapshots : {},
    favorites: names(source?.favorites),
    recents: names(source?.recents).slice(0, maxRecents)
  };
}

function loadLocal(): LoraLibrary {
  try {
    return clean(JSON.parse(readStorage(storageKey) || readStorage(legacyStorageKey) || 'null'));
  } catch {
    return clean(null);
  }
}

let memory: LoraLibrary | null = null;
let pending: LoraOp[] = (() => {
  try {
    const saved = JSON.parse(readStorage(pendingKey) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
})();

function library(): LoraLibrary {
  if (!memory) memory = loadLocal();
  return memory;
}

function persist() {
  writeStorage(storageKey, JSON.stringify(library()));
  writeStorage(pendingKey, pending.length ? JSON.stringify(pending) : null);
}

/* -------------------------------------------------------------- Reducer */

/** The same edits the server applies (server/lora-stacks.js), so what you see matches what lands. */
function reduce(value: LoraLibrary, op: LoraOp) {
  const list = (key: string) => value.snapshots[key] || (value.snapshots[key] = []);
  switch (op.op) {
    case 'stack.add':
      if (!list(op.key).some((item) => item.id === op.stack.id)) list(op.key).push(op.stack);
      break;
    case 'stack.update':
      value.snapshots[op.key] = list(op.key).map((item) => item.id === op.id ? { ...item, loras: normalizeLoras(op.loras) } : item);
      break;
    case 'stack.rename':
      value.snapshots[op.key] = list(op.key).map((item) => item.id === op.id ? { ...item, name: op.name.trim() || item.name } : item);
      break;
    case 'stack.delete':
      value.snapshots[op.key] = list(op.key).filter((item) => item.id !== op.id);
      break;
    case 'stack.move':
      if (op.from !== op.key && value.snapshots[op.from]) {
        for (const stack of value.snapshots[op.from]) if (!list(op.key).some((item) => item.id === stack.id)) list(op.key).push(stack);
        delete value.snapshots[op.from];
      }
      break;
    case 'strengths':
      value.strengths[op.workflowId] = { ...(value.strengths[op.workflowId] || {}), ...op.values };
      break;
    case 'favorite':
      value.favorites = op.on ? [...new Set([...value.favorites, op.name])] : value.favorites.filter((item) => item !== op.name);
      break;
    case 'recents':
      value.recents = [...op.names, ...value.recents.filter((item) => !op.names.includes(item))].slice(0, maxRecents);
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------------------ Sync */

const listeners = new Set<() => void>();
const statusListeners = new Set<(status: LoraSyncStatus) => void>();
let status: LoraSyncStatus = { pending: pending.length, failing: false, locked: false, error: '' };
let inFlight = 0;
let flushTimer: number | null = null;
let failures = 0;

// Some reads run during a React render (loraStacks migrates old stacks as it
// reads), so listeners hear about changes just after, never in the middle.
let notifyQueued = false;
function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    for (const listener of listeners) listener();
  });
}

function setStatus(next: Partial<LoraSyncStatus>) {
  status = { ...status, ...next, pending: pending.length };
  const snapshot = status;
  queueMicrotask(() => { for (const listener of statusListeners) listener(snapshot); });
}

/** Re-renders when the library changes, here or on another device. */
export function subscribeLoraLibrary(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function subscribeLoraSync(listener: (status: LoraSyncStatus) => void) {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}

function scheduleFlush(delay: number) {
  if (flushTimer !== null) window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => { flushTimer = null; void flush(); }, delay);
}

/** Take the server's copy, then lay any edits it has not seen yet back on top. */
function adopt(serverLibrary: unknown) {
  memory = clean(serverLibrary);
  for (const op of pending) reduce(memory, op);
  persist();
  notify();
}

async function flush() {
  if (inFlight || !pending.length) return;
  const batch = pending.slice();
  inFlight = batch.length;
  try {
    const response = await fetch('/api/loras/library/ops', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops: batch })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error || `HTTP ${response.status}`) as Error & { locked?: boolean };
      error.locked = response.status === 401 || Boolean(data?.locked);
      throw error;
    }
    pending = pending.slice(batch.length);
    inFlight = 0;
    failures = 0;
    adopt(data.library);
    setStatus({ failing: false, locked: false, error: '' });
    if (pending.length) scheduleFlush(0);
  } catch (error) {
    inFlight = 0;
    failures += 1;
    const locked = Boolean((error as { locked?: boolean }).locked);
    setStatus({ failing: true, locked, error: error instanceof Error ? error.message : 'Could not reach HEISS UI' });
    // Back off, but never give up: the edits are safe on this device meanwhile.
    scheduleFlush(Math.min(30000, 1500 * 2 ** Math.min(failures - 1, 5)));
  }
}

/** Strength drags send one edit per tick; fold them into the last queued one that is not already on its way. */
function enqueue(op: LoraOp, delay = 300) {
  const last = pending.length > inFlight ? pending[pending.length - 1] : null;
  if (last && op.op === 'strengths' && last.op === 'strengths' && last.workflowId === op.workflowId) {
    last.values = { ...last.values, ...op.values };
  } else if (last && op.op === 'active' && last.op === 'active' && last.workflowId === op.workflowId) {
    last.loras = op.loras;
  } else {
    pending.push(op);
  }
  persist();
  setStatus({});
  scheduleFlush(delay);
}

function apply(op: LoraOp, delay?: number) {
  reduce(library(), op);
  enqueue(op, delay);
  notify();
}

/**
 * Loads the server's copy and keeps it fresh. The first time a device runs
 * this build, its local library is merged in once, which rescues stacks an
 * older build saved only in this browser when its silent sync failed.
 */
export function startLoraSync() {
  let lastPull = 0;
  const pull = async () => {
    lastPull = Date.now();
    if (pending.length) return flush();
    try {
      const response = await fetch('/api/loras/library');
      if (!response.ok) return;
      const data = await response.json();
      if (pending.length) return flush();
      adopt(data.found ? data.library : null);
    } catch {
      // Offline: keep what this device has.
    }
  };
  if (!readStorage(mergedKey)) {
    const local = loadLocal();
    const hasAnything = Object.values(local.snapshots).some((list) => list?.length) || local.favorites.length || Object.keys(local.strengths).length;
    if (hasAnything) enqueue({ op: 'merge', library: local }, 0);
    writeStorage(mergedKey, '1');
  }
  void pull();
  // Another device may have saved something; look again when this tab comes back.
  const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - lastPull > 4000) void pull(); };
  const onOnline = () => { failures = 0; void flush(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  window.addEventListener('online', onOnline);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
    window.removeEventListener('online', onOnline);
  };
}

/** Try the queue now, e.g. right after unlocking on another device. */
export function retryLoraSync() {
  failures = 0;
  void flush();
}

/* ------------------------------------------------------------ Strengths */

export function rememberedLoraStrength(workflowId: string, name: string, fallback: number) {
  const strength = library().strengths[workflowId]?.[name];
  return Number.isFinite(strength) ? strength : fallback;
}

export function rememberLoraStrengths(workflowId: string, loras: LoraSelection[]) {
  if (!workflowId) return;
  const values = Object.fromEntries(normalizeLoras(loras).map((item) => [item.name, item.strength]));
  if (!Object.keys(values).length) return;
  // Slider ticks land here; only the settled value needs to reach the server.
  apply({ op: 'strengths', workflowId, values }, 600);
}

/** The LoRAs a workflow had last, so switching back restores them. */
export function rememberActiveLoras(workflowId: string, loras: LoraSelection[]) {
  if (!workflowId) return;
  enqueue({ op: 'active', workflowId, loras: normalizeLoras(loras) }, 300);
}

/* --------------------------------------------------------------- Stacks */

export function loraFamilyKey(family = '') {
  return `family:${family || 'other'}`;
}

/** Stacks for a model family. Stacks saved per workflow by older builds move over the first time they're read. */
export function loraStacks(familyKey: string, legacyWorkflowId = ''): LoraSnapshot[] {
  const value = library();
  if (legacyWorkflowId && legacyWorkflowId !== familyKey && value.snapshots[legacyWorkflowId]?.length) {
    apply({ op: 'stack.move', key: familyKey, from: legacyWorkflowId });
  }
  return (value.snapshots[familyKey] || []).map((snapshot) => ({ ...snapshot, loras: normalizeLoras(snapshot.loras) }));
}

export function saveLoraStack(familyKey: string, name: string, loras: LoraSelection[]) {
  // clientJobUuid, not crypto.randomUUID: the latter is missing over plain-HTTP LAN.
  const snapshot: LoraSnapshot = { id: clientJobUuid(), name: name.trim() || 'Untitled stack', loras: normalizeLoras(loras) };
  apply({ op: 'stack.add', key: familyKey, stack: snapshot }, 0);
  return snapshot;
}

export function updateLoraStack(familyKey: string, id: string, loras: LoraSelection[]) {
  apply({ op: 'stack.update', key: familyKey, id, loras: normalizeLoras(loras) }, 0);
}

export function renameLoraStack(familyKey: string, id: string, name: string) {
  if (name.trim()) apply({ op: 'stack.rename', key: familyKey, id, name: name.trim() }, 0);
}

export function deleteLoraStack(familyKey: string, id: string) {
  apply({ op: 'stack.delete', key: familyKey, id }, 0);
}

/* --------------------------------------------------- Favorites, recents */

export function loraFavorites() {
  return library().favorites;
}

export function toggleLoraFavorite(name: string) {
  apply({ op: 'favorite', name, on: !library().favorites.includes(name) }, 0);
  return library().favorites;
}

export function loraRecents() {
  return library().recents;
}

export function recordLoraRecents(added: string[]) {
  if (added.length) apply({ op: 'recents', names: added });
}

export function clearLoraLibrary() {
  if (flushTimer !== null) window.clearTimeout(flushTimer);
  flushTimer = null;
  pending = [];
  memory = clean(null);
  for (const key of [storageKey, legacyStorageKey, pendingKey]) writeStorage(key, null);
  setStatus({ failing: false, locked: false, error: '' });
  notify();
}

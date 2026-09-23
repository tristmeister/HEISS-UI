import React from 'react';
import { apiJson } from './api';
import type { DownloadState, ModelDownload } from './types';

/**
 * One view of the text encoder and VAE downloads, shared by the sidebar, the
 * workflow gallery and the top pill. Polls once a second while something
 * moves, otherwise only when asked.
 */

type Store = { state: DownloadState | null; landed: Set<string>; error: string };
const store: Store = { state: null, landed: new Set(), error: '' };
const listeners = new Set<() => void>();
const doneListeners = new Set<(item: ModelDownload) => void>();
const errorListeners = new Set<(item: ModelDownload) => void>();
const seen = new Set<string>();
let primed = false;
let timer = 0;

function emit() { listeners.forEach((listener) => listener()); }

function isBusy(state: DownloadState | null) {
  return Boolean(state?.active || state?.queued.length);
}

function accept(next: DownloadState) {
  // The first answer only records history; events are for what happens while the app is open.
  for (const item of next.recent || []) {
    const key = `${item.id}:${item.status}:${item.finishedAt || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!primed) continue;
    if (item.status === 'done') {
      store.landed = new Set(store.landed).add(item.file);
      doneListeners.forEach((listener) => listener(item));
    }
    if (item.status === 'error') errorListeners.forEach((listener) => listener(item));
  }
  primed = true;
  store.state = next;
  emit();
  schedule();
}

function schedule() {
  window.clearTimeout(timer);
  if (isBusy(store.state)) timer = window.setTimeout(refresh, 1000);
}

export async function refresh() {
  try {
    accept(await apiJson<DownloadState & { ok: boolean }>('/api/models/downloads'));
  } catch {
    // Without the route the panels still work as lists of links.
  }
}

async function post(url: string, body: Record<string, unknown>) {
  const data = await apiJson<DownloadState & { ok: boolean; download?: ModelDownload }>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  // A file that was already on disk lands right away.
  if (data.download?.already) {
    store.landed = new Set(store.landed).add(data.download.file);
    doneListeners.forEach((listener) => listener(data.download!));
  }
  accept(data);
  return data;
}

export const downloadActions = {
  start: (id: string) => post('/api/models/downloads', { id }),
  pause: (id: string) => post('/api/models/downloads/cancel', { id }),
  discard: (id: string) => post('/api/models/downloads/cancel', { id, discard: true })
};

/** Where one catalog file stands right now. */
export function downloadFor(state: DownloadState | null, file: string): ModelDownload | undefined {
  if (!state) return undefined;
  if (state.active?.file === file) return state.active;
  return state.queued.find((item) => item.file === file)
    || state.paused?.find((item) => item.file === file)
    || state.recent.find((item) => item.file === file && item.status === 'error');
}

export function useModelDownloads(events?: { onDone?: (item: ModelDownload) => void; onError?: (item: ModelDownload) => void }) {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  const onDone = React.useRef(events?.onDone);
  const onError = React.useRef(events?.onError);
  onDone.current = events?.onDone;
  onError.current = events?.onError;
  React.useEffect(() => {
    listeners.add(force);
    const done = (item: ModelDownload) => onDone.current?.(item);
    const error = (item: ModelDownload) => onError.current?.(item);
    doneListeners.add(done);
    errorListeners.add(error);
    if (!store.state) refresh();
    return () => { listeners.delete(force); doneListeners.delete(done); errorListeners.delete(error); };
  }, []);
  return { state: store.state, landed: store.landed, busy: isBusy(store.state), refresh, ...downloadActions };
}

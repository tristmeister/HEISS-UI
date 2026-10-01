import React from 'react';
import { apiJson } from './api';
import type { DownloadState, ModelDownload } from './types';

/**
 * One view of the text encoder and VAE downloads, shared by the sidebar, the
 * workflow gallery and the top pill. Polls once a second while something
 * moves, otherwise only when asked. It also carries what the pill does by
 * itself: a pause or cancel of the whole line, and "show me this download"
 * for the panel the pill opens.
 */

/** Where a download was started: the place its island opens again. */
export type DownloadOrigin = { kind: 'starter' } | { kind: 'setup'; subject: string };
/** "Show me this download": the panel that lists it selects it, scrolls to it and lights it up. */
export type DownloadReveal = { file: string; where: DownloadOrigin['kind']; subject?: string; at: number };

type Store = {
  state: DownloadState | null; landed: Set<string>; error: string;
  /** Paused together from the island, in their order, to resume together. */
  held: ModelDownload[];
  /** Canceled from the island: stopped, partial file kept until the undo runs out. */
  canceled: ModelDownload[];
  reveal: DownloadReveal | null;
};
const store: Store = { state: null, landed: new Set(), error: '', held: [], canceled: [], reveal: null };
const listeners = new Set<() => void>();
const doneListeners = new Set<(item: ModelDownload) => void>();
const errorListeners = new Set<(item: ModelDownload) => void>();
const seen = new Set<string>();
// By catalog id. Only this session's: after a reload the island guesses from the catalog instead.
const origins = new Map<string, DownloadOrigin>();
let primed = false;
let timer = 0;
let cancelTimer = 0;
// While the island stops downloads itself, the answers in between still show them running.
let stopping = false;
const UNDO_MS = 6000;
const REVEAL_MS = 2600;

function emit() { listeners.forEach((listener) => listener()); }

function isBusy(state: DownloadState | null) {
  return Boolean(state?.active || state?.queued.length);
}

function isRunning(item: ModelDownload, state = store.state) {
  return Boolean(state && (state.active?.file === item.file || state.queued.some((entry) => entry.file === item.file)));
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
  // Started again from a panel, or landed: no longer on hold, and no longer on its way out.
  const settled = (item: ModelDownload) => !stopping && (isRunning(item, next) || store.landed.has(item.file));
  if (store.held.some(settled)) store.held = store.held.filter((item) => !settled(item));
  if (store.canceled.some(settled)) {
    store.canceled = store.canceled.filter((item) => !settled(item));
    if (!store.canceled.length) window.clearTimeout(cancelTimer);
  }
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
  /** `origin` says where it was started, so the island can take people back there. */
  start: (id: string, origin?: DownloadOrigin) => {
    if (origin) origins.set(id, origin);
    return post('/api/models/downloads', { id });
  },
  pause: (id: string) => post('/api/models/downloads/cancel', { id }),
  discard: (id: string) => post('/api/models/downloads/cancel', { id, discard: true }),
  /** A damaged catalog file: the broken copy is removed and a fresh one fetched. */
  replace: (id: string) => post('/api/models/downloads/replace', { id })
};

export function downloadOrigin(id: string) {
  return origins.get(id);
}

/**
 * The island's own controls. They work on the whole line of downloads, not
 * one file: pausing only the running one would just let the next one start.
 * The server keeps the partial file on a pause and resumes it with a range
 * request, so a pause loses nothing.
 */
export const islandActions = {
  async pauseAll() {
    const batch = [store.state?.active, ...(store.state?.queued || [])].filter(Boolean) as ModelDownload[];
    if (!batch.length) return;
    // Held before the first answer, so the island goes from downloading straight to paused.
    store.held = [...batch, ...store.held.filter((item) => !batch.some((entry) => entry.file === item.file))];
    stopping = true;
    try {
      // The waiting ones first: with the running one stopped first, the next would start in between.
      for (const item of batch.slice(1).reverse()) await downloadActions.pause(item.id);
      await downloadActions.pause(batch[0].id);
    } finally {
      stopping = false;
      store.held = store.held.filter((item) => !isRunning(item));
      emit();
    }
  },
  async resumeAll() {
    // Each one leaves `held` as the server picks it up (see accept).
    for (const item of [...store.held]) await downloadActions.start(item.id);
  },
  /** Leave the paused ones paused, just without the island. Their panels still offer Resume. */
  forgetHeld() {
    store.held = [];
    emit();
  },
  /**
   * No confirmation: the files stop now and only go after a few seconds, and
   * Undo in that time resumes them where they were.
   */
  async cancel(items: ModelDownload[]) {
    islandActions.commitCancel();
    // Shown at once; the server catches up behind it.
    store.held = store.held.filter((item) => !items.some((entry) => entry.file === item.file));
    store.canceled = items;
    emit();
    stopping = true;
    try {
      for (const item of [...items].reverse()) if (isRunning(item)) await downloadActions.pause(item.id);
    } finally {
      stopping = false;
      cancelTimer = window.setTimeout(islandActions.commitCancel, UNDO_MS);
    }
  },
  async undoCancel() {
    window.clearTimeout(cancelTimer);
    const items = store.canceled;
    store.canceled = [];
    emit();
    for (const item of items) await downloadActions.start(item.id);
  },
  /** The undo ran out (or was waved away): the partial files go. */
  commitCancel() {
    window.clearTimeout(cancelTimer);
    const items = store.canceled;
    if (!items.length) return;
    store.canceled = [];
    emit();
    // Started again from a panel in the meantime: that wins.
    for (const item of items) if (!isRunning(item)) downloadActions.discard(item.id).catch(() => null);
  }
};

/** Ask the panel that lists this download to show it. Stale after a few seconds, so a later visit is not hijacked. */
export function revealDownload(item: Pick<ModelDownload, 'file'>, where: DownloadOrigin['kind'], subject?: string) {
  store.reveal = { file: item.file, where, subject, at: Date.now() };
  emit();
}

/** The reveal waiting for one place, read once, as that place mounts. */
export function peekDownloadReveal(where: DownloadOrigin['kind']) {
  const reveal = store.reveal;
  return reveal && reveal.where === where && Date.now() - reveal.at < REVEAL_MS ? reveal : null;
}

/** The reveal for one place while it lasts; the highlight ends with it. */
export function useDownloadReveal(where: DownloadOrigin['kind']) {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    listeners.add(force);
    return () => { listeners.delete(force); };
  }, []);
  const reveal = peekDownloadReveal(where);
  React.useEffect(() => {
    if (!reveal) return;
    const timer = window.setTimeout(() => {
      if (store.reveal === reveal) store.reveal = null;
      emit();
    }, Math.max(0, reveal.at + REVEAL_MS - Date.now()));
    return () => window.clearTimeout(timer);
  }, [reveal]);
  return reveal;
}

/** Scrolls a revealed row into view once, as it mounts. */
export function scrollRevealed(node: HTMLElement | null) {
  if (!node) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.requestAnimationFrame(() => node.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' }));
}

/** Where one catalog file stands right now. */
export function downloadFor(state: DownloadState | null, file: string): ModelDownload | undefined {
  if (!state) return undefined;
  if (state.active?.file === file) return state.active;
  const queued = state.queued.find((item) => item.file === file);
  if (queued) return queued;
  // A failure leaves a partial file too; it reads as the failure, not as a pause nobody asked for.
  const paused = state.paused?.find((item) => item.file === file);
  const last = state.recent.find((item) => item.file === file);
  if (last?.status === 'error') return { ...paused, ...last, receivedBytes: paused?.receivedBytes || last.receivedBytes };
  return paused;
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
  return { state: store.state, landed: store.landed, held: store.held, canceled: store.canceled, busy: isBusy(store.state), refresh, ...downloadActions };
}

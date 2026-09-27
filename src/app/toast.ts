import type { ReactNode } from 'react';

/**
 * Toasts: short notes that float in under the top pills, in the same glass.
 *
 * Five tones, one shape. Repeats never pile up: a toast with the same `group`
 * (or, without one, the same tone and words) that is still on screen takes the
 * new one in. Its count goes up, the number rolls, the glass gives a small
 * bump, and its timer starts over. An Undo on a grouped toast undoes all of
 * them (newest first), and `onClose` runs for each one once the toast leaves
 * without it.
 */

export type ToastTone = 'neutral' | 'success' | 'warning' | 'error' | 'removed';
export type ToastGlyph = 'info' | 'check' | 'bang' | 'cross' | 'trash' | 'lock';
export type ToastAction = { label: string; onClick: () => void };

export type ToastOptions = {
  /** Replaces the live toast with this id instead of adding one. */
  id?: string;
  /** Toasts in one group merge while they are on screen. */
  group?: string;
  /** How many things this one is about; merged toasts add theirs up. Default 1. */
  count?: number;
  /** The title once the count is over one, e.g. `(n) => `${n} images deleted``. The number in it rolls. */
  plural?: (count: number) => string;
  description?: ReactNode;
  /** Milliseconds on screen. Hovering pauses it. `Infinity` waits for a dismiss. */
  duration?: number;
  action?: ToastAction;
  /** One of the cell glyphs, or any node (drawn without the round well). Defaults to the tone's glyph. */
  glyph?: ToastGlyph | ReactNode;
  /** Runs when the toast leaves any way other than its action: time, swipe, close. */
  onClose?: () => void;
};

export type ToastRecord = {
  id: string;
  group: string;
  tone: ToastTone;
  title: string;
  count: number;
  plural?: (count: number) => string;
  description?: ReactNode;
  duration: number;
  glyph?: ToastGlyph | ReactNode;
  actionLabel?: string;
  /** Bumped on every merge: restarts the timer and plays the bump. */
  version: number;
  createdAt: number;
};

type Callbacks = { actions: Array<() => void>; closers: Array<() => void> };

const MAX_TOASTS = 5;
const BASE_DURATION: Record<ToastTone, number> = { neutral: 4000, success: 3200, removed: 5000, warning: 6500, error: 6500 };

let toasts: ToastRecord[] = [];
const callbacks = new Map<string, Callbacks>();
const listeners = new Set<() => void>();
let nextId = 0;

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function toastSnapshot() {
  return toasts;
}

/** Long messages stay long enough to read; anything with an action gets at least six seconds. */
function durationFor(tone: ToastTone, title: string, options: ToastOptions) {
  if (options.duration !== undefined) return options.duration;
  const reading = BASE_DURATION[tone] + Math.max(0, title.length - 48) * 45;
  return Math.min(12000, options.action ? Math.max(6000, reading) : reading);
}

function close(id: string, ran: 'action' | 'close') {
  const record = toasts.find((toast) => toast.id === id);
  if (!record) return;
  const hooks = callbacks.get(id);
  callbacks.delete(id);
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
  // A merged Undo rewinds newest first, so the last thing undone is the oldest.
  (ran === 'action' ? [...(hooks?.actions || [])].reverse() : hooks?.closers)?.forEach((run) => {
    try { run(); } catch (error) { console.error(error); }
  });
}

function show(tone: ToastTone, title: string, options: ToastOptions = {}) {
  const count = Math.max(1, options.count ?? 1);
  const group = options.group ?? (options.id ? `id:${options.id}` : `${tone}:${title}`);
  const duration = durationFor(tone, title, options);
  const live = toasts.find((toast) => (options.id ? toast.id === options.id : toast.group === group));

  if (live) {
    const hooks = callbacks.get(live.id) || { actions: [], closers: [] };
    // An id replaces what was there; a group keeps adding up.
    const merging = !options.id;
    const next: ToastRecord = {
      ...live,
      group,
      tone,
      title,
      count: merging ? live.count + count : count,
      plural: options.plural ?? (merging ? live.plural : undefined),
      description: options.description ?? (merging ? live.description : undefined),
      duration,
      glyph: options.glyph ?? (merging ? live.glyph : undefined),
      actionLabel: options.action?.label ?? (merging ? live.actionLabel : undefined),
      version: live.version + 1
    };
    callbacks.set(live.id, {
      actions: [...(merging ? hooks.actions : []), ...(options.action ? [options.action.onClick] : [])],
      closers: [...(merging ? hooks.closers : []), ...(options.onClose ? [options.onClose] : [])]
    });
    // Whatever just happened comes to the front.
    toasts = [next, ...toasts.filter((toast) => toast.id !== live.id)];
    emit();
    return live.id;
  }

  const id = options.id || `toast-${++nextId}`;
  const record: ToastRecord = {
    id,
    group,
    tone,
    title,
    count,
    plural: options.plural,
    description: options.description,
    duration,
    glyph: options.glyph,
    actionLabel: options.action?.label,
    version: 0,
    createdAt: Date.now()
  };
  callbacks.set(id, { actions: options.action ? [options.action.onClick] : [], closers: options.onClose ? [options.onClose] : [] });
  toasts = [record, ...toasts];
  emit();
  // The oldest leave once too many are waiting; they close as if their time ran out.
  toasts.slice(MAX_TOASTS).forEach((old) => close(old.id, 'close'));
  return id;
}

export function dismissToast(id: string) {
  close(id, 'close');
}

export function runToastAction(id: string) {
  close(id, 'action');
}

type ToastFn = (title: string, options?: ToastOptions) => string;

export const toast = Object.assign(
  ((title, options) => show('neutral', title, options)) as ToastFn,
  {
    info: ((title, options) => show('neutral', title, options)) as ToastFn,
    success: ((title, options) => show('success', title, options)) as ToastFn,
    warning: ((title, options) => show('warning', title, options)) as ToastFn,
    error: ((title, options) => show('error', title, options)) as ToastFn,
    removed: ((title, options) => show('removed', title, options)) as ToastFn,
    dismiss: dismissToast
  }
);

/** The app-wide `showToast(message, tone)`; "default" is the neutral tone. */
export type ShowToastTone = 'default' | 'success' | 'warning' | 'error' | 'removed';
export function showToastTone(message: string, tone: ShowToastTone = 'default') {
  return show(tone === 'default' ? 'neutral' : tone, message);
}

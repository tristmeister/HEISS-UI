import React from 'react';
import { apiJson } from './api';

/**
 * What ComfyUI runs on, from /api/hardware (server/hardware.js): the GPU, its
 * memory, and the budget the studio uses to say what fits. Asked once and
 * shared; asked again when ComfyUI comes back, since it may be another one.
 * Only ever used to point at what fits, never to warn or hold anything back.
 */
export type Hardware = {
  known: boolean;
  kind: '' | 'nvidia' | 'amd' | 'intel' | 'apple' | 'cpu' | 'other';
  name: string;
  /** Apple Silicon: one memory for CPU and GPU, so it is "memory", never VRAM. */
  unified: boolean;
  vramGB: number;
  ramGB: number;
  budgetGB: number | null;
  budgetSource: '' | 'vram' | 'wired-limit' | 'unified-share';
  /** The operating system ComfyUI (or, without it, this computer) runs: darwin, win32, linux. */
  os?: string;
};

let current: Hardware | null = null;
let request: Promise<unknown> | null = null;
const listeners = new Set<() => void>();

export function refreshHardware() {
  if (request) return request;
  request = apiJson<{ hardware: Hardware }>('/api/hardware')
    .then((data) => { current = data.hardware || null; listeners.forEach((listener) => listener()); })
    .catch(() => null)
    .finally(() => { request = null; });
  return request;
}

export function useHardware() {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    listeners.add(force);
    if (!current) refreshHardware();
    return () => { listeners.delete(force); };
  }, []);
  return current;
}

/** Where the studio's own words need it: a Mac's memory is just memory. */
export function memoryWord(hardware: Hardware | null) {
  return hardware?.unified ? 'memory' : 'graphics memory';
}

/** One calm sentence about the machine, or "" when there is nothing sure to say. */
export function hardwareSentence(hardware: Hardware | null) {
  if (!hardware?.known || !hardware.budgetGB) return '';
  if (hardware.unified) return `ComfyUI runs on a Mac with ${formatGB(hardware.ramGB)} of memory.`;
  const name = hardware.name ? `${/^([aeiou]|nvidia)/i.test(hardware.name) ? 'an' : 'a'} ${hardware.name}` : 'a graphics card';
  return `ComfyUI runs on ${name} with ${formatGB(hardware.vramGB)} of graphics memory.`;
}

export function formatGB(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(value < 10 ? 1 : 0)} GB`;
}

/** Decimal, like the setup panel and the file browser: 12.5 GB, 250 MB. */
export function formatDownload(bytes = 0) {
  if (!bytes) return '';
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/**
 * A rough memory figure for a model file already in ComfyUI: its weights, and
 * on a Mac an fp8 file at the size it loads to (docs/hardware-notes.md).
 */
export function modelFits(hardware: Hardware | null, bytes = 0, fileName = '') {
  if (!hardware?.budgetGB || !bytes) return null;
  const gb = (bytes / 1024 ** 3) * (hardware.unified && /fp8|e4m3|e5m2/i.test(fileName) ? 2 : 1);
  return gb + 1 <= hardware.budgetGB + 0.25;
}

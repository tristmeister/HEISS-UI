import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { apiJson } from './api';

/**
 * Recent prompts, kept by the server (server/prompt-history.js) so every
 * device sees the same list. The browser holds one copy for the session and
 * asks again whenever the list opens, so it is never far behind.
 */

export type PromptEntry = { text: string; at: string; uses: number; pinned?: boolean };

let entries: PromptEntry[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: PromptEntry[]) {
  entries = next;
  loaded = true;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Asks the server for the list; concurrent callers share one request. */
export function refreshPrompts() {
  loading ||= apiJson<{ prompts: PromptEntry[] }>("/api/prompts")
    .then((data) => publish(Array.isArray(data.prompts) ? data.prompts : []))
    .catch(() => { loaded = true; })
    .finally(() => { loading = null; });
  return loading;
}

export function promptKey(text = "") {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Stars a prompt (or takes the star off), here at once and then on the server. */
export async function pinPrompt(text: string, pinned: boolean) {
  const key = promptKey(text);
  const found = entries.some((entry) => promptKey(entry.text) === key);
  publish(found
    ? entries.map((entry) => (promptKey(entry.text) === key ? { ...entry, pinned: pinned || undefined } : entry))
    : pinned ? [{ text: text.trim(), at: new Date().toISOString(), uses: 0, pinned: true }, ...entries] : entries);
  const data = await apiJson<{ prompts: PromptEntry[] }>("/api/prompts/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, pinned }) });
  publish(data.prompts || []);
}

export async function forgetPrompt(text: string) {
  const key = promptKey(text);
  publish(entries.filter((entry) => promptKey(entry.text) !== key));
  const data = await apiJson<{ prompts: PromptEntry[] }>("/api/prompts/forget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  publish(data.prompts || []);
}

export async function clearPrompts() {
  const data = await apiJson<{ prompts: PromptEntry[] }>("/api/prompts/clear", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keepPinned: true }) });
  publish(data.prompts || []);
}

/** The list, kept current; `refresh` asks the server again. */
export function usePromptHistory(active = true) {
  const list = useSyncExternalStore(subscribe, () => entries, () => entries);
  const [ready, setReady] = useState(loaded);
  useEffect(() => {
    if (!active) return;
    let live = true;
    refreshPrompts().then(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, [active]);
  const refresh = useCallback(() => refreshPrompts(), []);
  return { prompts: list, ready: ready || loaded, refresh };
}

/* ------------------------------------------------------------ Search */

/**
 * A light fuzzy match: every word typed must appear in the prompt, whole or
 * as letters in order ("lghthse" finds "lighthouse"). Whole words and word
 * starts rank first, then how recently the prompt was used. Returns the
 * matched ranges of the first plain hit per word, for highlighting.
 */
export function matchPrompt(text: string, query: string): { score: number; ranges: Array<[number, number]> } | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { score: 0, ranges: [] };
  const haystack = text.toLowerCase();
  let score = 0;
  const ranges: Array<[number, number]> = [];
  for (const word of words) {
    const at = haystack.indexOf(word);
    if (at >= 0) {
      const wordStart = at === 0 || /[\s,.;:()[\]{}"'/-]/.test(haystack[at - 1]);
      score += wordStart ? 3 : 2;
      ranges.push([at, at + word.length]);
      continue;
    }
    // Letters in order, allowing gaps; only for words long enough to mean something.
    if (word.length < 3) return null;
    let from = 0;
    let gaps = 0;
    for (const char of word) {
      const next = haystack.indexOf(char, from);
      if (next < 0) return null;
      gaps += next - from;
      from = next + 1;
    }
    if (gaps > word.length * 4) return null;
    score += 1;
  }
  return { score, ranges: mergeRanges(ranges) };
}

function mergeRanges(ranges: Array<[number, number]>) {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

/** How long ago, briefly: "now", "5 min", "3 h", "Tue", "12 Mar". */
export function whenUsed(at: string) {
  const time = Date.parse(at);
  if (!Number.isFinite(time) || time <= 0) return "";
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const date = new Date(time);
  if (hours < 24 * 6) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

import path from "node:path";
import { dataDir, gallery } from "./gallery-store.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { hasLegacyPrompt } from "./privacy.js";

/**
 * Prompts you generated with, newest first, kept on this computer so every
 * device on it sees the same list. A prompt used again moves to the top
 * instead of appearing twice; pinned ones stay no matter how many follow.
 *
 * It can be turned off (Settings › Generation): then nothing new is kept and
 * the recent ones are forgotten; starred prompts stay until unstarred.
 *
 * Nothing from Hidden is ever written here: the generate route records only
 * runs that land in the gallery, and hiding an image takes its prompt out
 * unless the gallery still shows it elsewhere.
 */

export const promptHistoryPath = path.join(dataDir, "prompt-history.json");
export const historyLimit = 500;
export const pinnedLimit = 200;
const maxPromptLength = 8000;

/** Two prompts are the same when they only differ in spacing or case. */
export function promptKey(text = "") {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function cleanText(text = "") {
  return String(text || "").trim().slice(0, maxPromptLength);
}

function cleanEntries(value) {
  const list = Array.isArray(value?.entries) ? value.entries : Array.isArray(value) ? value : [];
  const seen = new Set();
  const entries = [];
  for (const raw of list) {
    const text = cleanText(raw?.text);
    const key = promptKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    entries.push({
      text,
      at: Number.isFinite(Date.parse(raw?.at || "")) ? new Date(raw.at).toISOString() : new Date(0).toISOString(),
      uses: Math.max(0, Math.floor(Number(raw?.uses) || 0)),
      ...(raw?.pinned ? { pinned: true } : {})
    });
  }
  return capEntries(entries);
}

/** Newest first; at most `historyLimit` unpinned and `pinnedLimit` pinned. */
export function capEntries(entries) {
  const sorted = [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  let pinned = 0;
  let recent = 0;
  return sorted.filter((entry) => (entry.pinned ? (pinned += 1) <= pinnedLimit : (recent += 1) <= historyLimit));
}

/** The list with `text` used once more at `at`. */
export function addPrompt(entries, text, at = new Date()) {
  const clean = cleanText(text);
  const key = promptKey(clean);
  if (!key) return entries;
  const previous = entries.find((entry) => promptKey(entry.text) === key);
  const next = {
    text: clean,
    at: new Date(at).toISOString(),
    uses: (previous?.uses || 0) + 1,
    ...(previous?.pinned ? { pinned: true } : {})
  };
  return capEntries([next, ...entries.filter((entry) => entry !== previous)]);
}

let cache = null;
let enabled = true;

/**
 * The saved list. The very first time there is none, it starts from the
 * prompts already in the gallery, so the list is useful from day one.
 */
export function loadPromptHistory(seedItems = gallery) {
  if (cache) return cache;
  try {
    const saved = readJsonFile(promptHistoryPath);
    enabled = saved?.enabled !== false;
    cache = cleanEntries(saved);
  } catch {
    let entries = [];
    const seeds = seedItems
      // Prompts still sealed by the old privacy scheme are not readable text, so they stay out.
      .filter((item) => item?.prompt && !item.privateVault && !item.promptProtected && !hasLegacyPrompt(item) && item.status === "done")
      .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
    for (const item of seeds) entries = addPrompt(entries, item.prompt, Date.parse(item.createdAt || "") || Date.now());
    cache = entries;
    if (entries.length) save();
  }
  return cache;
}

/**
 * `forget`: the store keeps the previous copy as .bak, and a prompt taken out
 * (forgotten, cleared, or hidden along with its image) must not stay in it.
 */
function save({ forget = false } = {}) {
  writeJsonFile(promptHistoryPath, { version: 1, enabled, entries: cache || [] });
  if (forget) writeJsonFile(promptHistoryPath, { version: 1, enabled, entries: cache || [] });
}

export function promptHistoryEnabled() {
  loadPromptHistory();
  return enabled;
}

/** Turning it off forgets the recent prompts (starred ones stay) and keeps no new ones. */
export function setPromptHistoryEnabled(on) {
  loadPromptHistory();
  enabled = Boolean(on);
  if (!enabled) cache = cache.filter((entry) => entry.pinned);
  save({ forget: !enabled });
  return cache;
}

export function listPrompts() {
  return loadPromptHistory();
}

export function recordPrompt(text) {
  if (!promptHistoryEnabled()) return cache;
  const entries = addPrompt(loadPromptHistory(), text);
  if (entries === cache) return cache;
  cache = entries;
  save();
  return cache;
}

export function setPromptPinned(text, pinned) {
  const key = promptKey(text);
  const entries = loadPromptHistory();
  const found = entries.find((entry) => promptKey(entry.text) === key);
  // Pinning something not in the list yet (a prompt typed but never run) keeps it too.
  if (!found && !pinned) return entries;
  const clean = cleanText(text);
  if (!found && !promptKey(clean)) return entries;
  cache = capEntries(found
    ? entries.map((entry) => {
      if (entry !== found) return entry;
      const { pinned: _pinned, ...rest } = entry;
      return pinned ? { ...rest, pinned: true } : rest;
    })
    : [{ text: clean, at: new Date().toISOString(), uses: 0, pinned: true }, ...entries]);
  save();
  return cache;
}

/** Forgets these prompts. `keep` (keys) spares any that should stay, pinned or not. */
export function forgetPrompts(texts, keep = new Set()) {
  const keys = new Set(texts.map(promptKey).filter((key) => key && !keep.has(key)));
  if (!keys.size) return loadPromptHistory();
  const entries = loadPromptHistory();
  const next = entries.filter((entry) => !keys.has(promptKey(entry.text)));
  if (next.length === entries.length) return entries;
  cache = next;
  save({ forget: true });
  return cache;
}

export function clearPromptHistory({ keepPinned = true } = {}) {
  cache = keepPinned ? loadPromptHistory().filter((entry) => entry.pinned) : [];
  save({ forget: true });
  return cache;
}

/** For tests: forget what was read, so the next call reads the file again. */
export function resetPromptHistoryCache() {
  cache = null;
}

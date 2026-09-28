import type { LoraSelection, Profile } from './types';

export const maxLoras = 8;
export const defaultLoraStrength = 0.7;

export type LoraGroup = {
  id: string;
  label: string;
  loras: string[];
};

/** Clean, capped and de-duplicated: the same LoRA twice in one stack is never intended. */
export function normalizeLoras(value: unknown): LoraSelection[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.map((item) => ({
    name: String(item?.name || ""),
    enabled: item?.enabled !== false,
    strength: Number.isFinite(Number(item?.strength)) ? Number(item.strength) : defaultLoraStrength
  })).filter((item) => item.name && !seen.has(item.name) && seen.add(item.name)).slice(0, maxLoras);
}

/** Whether two workflows run the same weights file, so a LoRA stack still fits after switching. */
export function sameBaseModel(a: Profile | null | undefined, b: Profile | null | undefined) {
  const file = (profile: Profile | null | undefined) => String(profile?.baseModel || "").split(/[\\/]/).pop()!.toLowerCase();
  return Boolean(a && b && a.kind === b.kind && file(a) && file(a) === file(b));
}

function tokensForProfile(profile: Profile | null) {
  const text = [
    profile?.family,
    profile?.model,
    profile?.label,
    profile?.displayName,
    profile?.description
  ].join(" ").toLowerCase();
  const tokens = new Set<string>();
  if (/z[-_ ]?image|z[-_ ]?anime|z\b|qwen/i.test(text)) {
    ["z", "zimage", "z-image", "qwen", "turbo"].forEach((token) => tokens.add(token));
  }
  if (/checkpoint|sdxl|pony|xl\b/i.test(text)) {
    ["checkpoint", "sdxl", "xl", "pony"].forEach((token) => tokens.add(token));
  }
  if (/flux/i.test(text)) tokens.add("flux");
  if (/wan/i.test(text)) tokens.add("wan");
  if (/hunyuan/i.test(text)) tokens.add("hunyuan");
  if (/ltx/i.test(text)) tokens.add("ltx");
  return [...tokens];
}

export function loraScore(name: string, profile: Profile | null) {
  const lower = name.toLowerCase();
  const tokens = tokensForProfile(profile);
  let score = 0;
  for (const token of tokens) {
    if (lower.includes(token)) score += token.length <= 2 ? 1 : 3;
  }
  if (profile?.family === "z-image" && /(^|[\\/])z[\\/]/i.test(name)) score += 5;
  if (profile?.family === "z-image" && /(^|[\\/])qwen[\\/]/i.test(name)) score += 4;
  if (profile?.family === "checkpoint" && /(^|[\\/])(sdxl|xl|pony|checkpoint)[\\/]/i.test(name)) score += 4;
  return score;
}

/** LoRAs whose files say they fit come first, then the ones that say nothing, then those made for another model. */
export type FitOf = (name: string) => 'fits' | 'other' | 'unknown';
const fitRank = { fits: 0, unknown: 1, other: 2 } as const;

export function rankedLoras(options: string[] = [], profile: Profile | null, query = "", fitOf?: FitOf) {
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((name) => name.toLowerCase().includes(q)) : options;
  return [...filtered].sort((a, b) => {
    const fit = fitOf ? fitRank[fitOf(a)] - fitRank[fitOf(b)] : 0;
    const delta = loraScore(b, profile) - loraScore(a, profile);
    return fit || delta || a.localeCompare(b);
  });
}

/** Max folder depth kept when grouping (e.g. krea2/characters/woman). Deeper paths collapse into this. */
export const maxLoraFolderDepth = 3;

/** Returns the nested folder path (up to maxLoraFolderDepth segments), or null for root-level files. */
function folderPath(name: string) {
  const parts = name.split(/[\\/]/).filter(Boolean);
  const folders = parts.slice(0, -1);
  if (!folders.length) return null;
  return folders.slice(0, maxLoraFolderDepth).join("/");
}

function segmentLabel(segment: string) {
  return segment.replace(/[-_]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function folderLabel(path: string) {
  return path.split("/").map(segmentLabel).join(" / ");
}

/**
 * Groups LoRAs by their ComfyUI subfolder path, up to maxLoraFolderDepth levels deep
 * (e.g. krea2/characters/woman). Deeper folders collapse into their level-3 ancestor so
 * they still list under the folder above. Root-level files stay in "All".
 */
export function loraGroups(options: string[] = [], profile: Profile | null, query = "", fitOf?: FitOf): LoraGroup[] {
  const groups = new Map<string, string[]>();
  for (const name of rankedLoras(options, profile, query, fitOf)) {
    const folder = folderPath(name);
    const id = folder ? `folder:${folder}` : "root";
    const existing = groups.get(id) || [];
    existing.push(name);
    groups.set(id, existing);
  }

  return [...groups.entries()]
    .map(([id, loras]) => ({
      id,
      label: id === "root" ? "All" : folderLabel(id.slice("folder:".length)),
      loras
    }))
    .sort((a, b) => (a.id === "root" ? 1 : b.id === "root" ? -1 : a.label.localeCompare(b.label)));
}

/** Suggestions: what the files say fits this model, else what the names suggest; never one made for another model. */
export function recommendedLoras(options: string[] = [], profile: Profile | null, query = "", fitOf?: FitOf) {
  return rankedLoras(options, profile, query, fitOf).filter((name) => {
    const fit = fitOf?.(name) || 'unknown';
    return fit === 'fits' || (fit === 'unknown' && loraScore(name, profile) > 0);
  });
}

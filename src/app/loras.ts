import type { LoraSelection, Profile } from './types';

export const maxLoras = 8;
export const defaultLoraStrength = 0.7;

export type LoraGroup = {
  id: string;
  label: string;
  loras: string[];
};

export function normalizeLoras(value: unknown): LoraSelection[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxLoras).map((item) => ({
    name: String(item?.name || ""),
    enabled: item?.enabled !== false,
    strength: Number.isFinite(Number(item?.strength)) ? Number(item.strength) : defaultLoraStrength
  })).filter((item) => item.name);
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

export function rankedLoras(options: string[] = [], profile: Profile | null, query = "") {
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((name) => name.toLowerCase().includes(q)) : options;
  return [...filtered].sort((a, b) => {
    const delta = loraScore(b, profile) - loraScore(a, profile);
    return delta || a.localeCompare(b);
  });
}

function folderName(name: string) {
  const parts = name.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : null;
}

function folderLabel(folder: string) {
  return folder.replace(/[-_]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

/** Groups LoRAs by their immediate ComfyUI subfolder; root-level files stay in All. */
export function loraGroups(options: string[] = [], profile: Profile | null, query = ""): LoraGroup[] {
  const groups = new Map<string, string[]>();
  for (const name of rankedLoras(options, profile, query)) {
    const folder = folderName(name);
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

export function recommendedLoras(options: string[] = [], profile: Profile | null, query = "") {
  return rankedLoras(options, profile, query).filter((name) => loraScore(name, profile) > 0);
}

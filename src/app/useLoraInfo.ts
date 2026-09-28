import React from 'react';
import { apiJson } from './api';
import type { Profile } from './types';

/** What a LoRA was trained for and its trigger words, as the server read them from the file. */
export type LoraInfo = { families: string[]; base: string; triggers: string[]; about?: string };
export type LoraFit = 'fits' | 'other' | 'unknown';

// One answer shared by every panel, asked again only when ComfyUI's LoRA list changes.
let cached: { key: string; loras: Record<string, LoraInfo> } | null = null;
let pending: { key: string; promise: Promise<Record<string, LoraInfo>> } | null = null;

function load(key: string) {
  if (pending?.key === key) return pending.promise;
  const promise = apiJson<{ loras?: Record<string, LoraInfo> }>('/api/loras/info')
    .then((data) => {
      cached = { key, loras: data.loras || {} };
      return cached.loras;
    })
    .finally(() => { if (pending?.promise === promise) pending = null; });
  pending = { key, promise };
  return promise;
}

export function useLoraInfo(options: string[]) {
  const key = options.join('\n');
  const [loras, setLoras] = React.useState<Record<string, LoraInfo>>(() => (cached?.key === key ? cached.loras : {}));
  React.useEffect(() => {
    if (!options.length) return;
    if (cached?.key === key) { setLoras(cached.loras); return; }
    let live = true;
    // Without the answer the panel simply shows no hints.
    load(key).then((next) => { if (live) setLoras(next); }).catch(() => null);
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return loras;
}

/**
 * Whether a LoRA fits the model: "fits" when it was trained on this family,
 * "other" only when its file clearly says another one, "unknown" otherwise
 * (an imported workflow, a LoRA that says nothing).
 */
export function loraFit(info: LoraInfo | undefined, profile: Profile | null): LoraFit {
  if (!info?.families?.length || !profile?.family || !profile.workflow?.startsWith('family:')) return 'unknown';
  return info.families.includes(profile.family) ? 'fits' : 'other';
}

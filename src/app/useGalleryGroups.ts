import { useMemo } from 'react';
import { groupGallery, type GalleryGroups, type Run } from './runs';
import type { GalleryItem } from './types';

/**
 * The gallery's moments and runs. Grouping looks at which outputs there are,
 * their prompts and whether they're finished, not at progress, so a running
 * generation ticking along doesn't regroup the whole gallery each time: the
 * groups are worked out when that shape changes and then just filled with the
 * current items.
 */
export function useGalleryGroups(items: GalleryItem[], { runs }: { runs: boolean }): GalleryGroups {
  const shape = items.map((item) => `${item.id}${item.status[0]}${item.prompt ? item.prompt.length : 0}`).join(",");
  // Names like "This evening" move on with the clock.
  const hour = Math.floor(Date.now() / 3_600_000);
  const structure = useMemo(() => groupGallery(items, { runs }), [shape, runs, hour]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const fresh = (item: GalleryItem) => byId.get(item.id) || item;
    const runOf = new Map<string, Run>();
    const runList = structure.runs.map((run) => {
      const next = { ...run, items: run.items.map(fresh), cover: fresh(run.cover) };
      for (const item of next.items) runOf.set(item.id, next);
      return next;
    });
    return {
      moments: structure.moments.map((moment) => ({ ...moment, items: moment.items.map(fresh) })),
      runs: runList,
      runOf
    };
  }, [items, structure]);
}

/** A run standing in for its outputs in a flat list (zen's strip): its cover, marked as the run. */
export type RunItem = GalleryItem & { run: Run };

/** The list with each stacked run in its newest output's place and its other outputs left out. */
export function collapseRuns(items: GalleryItem[], groups: GalleryGroups, open: Set<string>): GalleryItem[] {
  const out: GalleryItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const run = groups.runOf.get(item.id);
    if (!run || run.live || open.has(run.id) || item.status === "pending") { out.push(item); continue; }
    if (seen.has(run.id)) continue;
    seen.add(run.id);
    out.push({ ...run.cover, id: run.id, run } as RunItem);
  }
  return out;
}

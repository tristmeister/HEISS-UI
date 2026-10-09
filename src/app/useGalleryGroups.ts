import { useMemo, useRef } from 'react';
import { groupGallery, type GalleryGroups, type Moment, type Run } from './runs';
import type { GalleryItem } from './types';

const sameItems = (a: GalleryItem[], b: GalleryItem[]) => a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * The gallery's moments and runs. Grouping looks at which outputs there are,
 * their prompts and whether they're finished, not at progress, so a running
 * generation ticking along doesn't regroup the whole gallery each time: the
 * groups are worked out when that shape changes and then just filled with the
 * current items. A run or moment whose items didn't change keeps its object,
 * so only what a tick touched renders again; with nothing touched, the same
 * groups come back.
 */
export function useGalleryGroups(items: GalleryItem[], { runs }: { runs: boolean }): GalleryGroups {
  const shape = useMemo(() => items.map((item) => `${item.id}${item.status[0]}${item.prompt ? item.prompt.length : 0}`).join(","), [items]);
  // Names like "This evening" move on with the clock.
  const hour = Math.floor(Date.now() / 3_600_000);
  const structure = useMemo(() => groupGallery(items, { runs }), [shape, runs, hour]); // eslint-disable-line react-hooks/exhaustive-deps
  const previous = useRef<{ structure: GalleryGroups; value: GalleryGroups; runs: Map<string, Run>; moments: Map<string, Moment> } | null>(null);
  return useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const fresh = (item: GalleryItem) => byId.get(item.id) || item;
    const last = previous.current?.structure === structure ? previous.current : null;
    let changed = !last;
    const runOf = new Map<string, Run>();
    const runById = new Map<string, Run>();
    const runList = structure.runs.map((run) => {
      const items = run.items.map(fresh);
      const cover = fresh(run.cover);
      const kept = last?.runs.get(run.id);
      const next = kept && kept.cover === cover && sameItems(kept.items, items) ? kept : { ...run, items, cover };
      if (next !== kept) changed = true;
      runById.set(run.id, next);
      for (const item of next.items) runOf.set(item.id, next);
      return next;
    });
    const momentById = new Map<string, Moment>();
    const moments = structure.moments.map((moment) => {
      const items = moment.items.map(fresh);
      const kept = last?.moments.get(moment.id);
      const next = kept && sameItems(kept.items, items) ? kept : { ...moment, items };
      if (next !== kept) changed = true;
      momentById.set(moment.id, next);
      return next;
    });
    if (!changed && last) return last.value;
    const value = { moments, runs: runList, runOf };
    previous.current = { structure, value, runs: runById, moments: momentById };
    return value;
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

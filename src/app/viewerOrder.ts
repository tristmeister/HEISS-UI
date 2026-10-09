import type { GalleryGroups } from './runs';
import type { GalleryItem } from './types';

const viewable = (item: GalleryItem) => item.status === "pending" || item.status === "done" || item.status === "error";

/**
 * The outputs in the order the gallery lays them out (galleryLayout.ts): a
 * stacked run, open or shut, stands where its newest take falls, its takes
 * together; one still generating beside a shut stack stays in its own place.
 * Without stacking, the gallery's own order.
 */
export function viewerOrder(items: GalleryItem[], groups: GalleryGroups | null, open: Set<string>): GalleryItem[] {
  if (!groups) return items.filter(viewable);
  const out: GalleryItem[] = [];
  const placed = new Set<string>();
  for (const item of items) {
    const run = groups.runOf.get(item.id);
    if (!run || (item.status === "pending" && !open.has(run.id))) {
      if (viewable(item)) out.push(item);
      continue;
    }
    if (placed.has(run.id)) continue;
    placed.add(run.id);
    for (const take of run.items) if (viewable(take) && (open.has(run.id) || take.status !== "pending")) out.push(take);
  }
  return out;
}

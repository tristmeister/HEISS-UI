import { useEffect, useRef } from 'react';
import { mediaUrl } from './mediaUrl';
import type { GalleryItem } from './types';
import { upscaleDisplayUrl } from './useUpscale';

/** How far either side of the open picture is fetched ahead. */
const REACH = 2;

/**
 * Fetches and decodes the full pictures either side of the open one, nearest
 * first, the same URL the viewer will ask for (GenerationMedia), so a swipe
 * lands on a picture that is already there instead of a blank that fills in.
 */
export function useNeighborPrefetch(active: GalleryItem | null, items: GalleryItem[]) {
  const held = useRef(new Map<string, HTMLImageElement>());
  const index = active ? items.findIndex((item) => item.id === active.id) : -1;
  const urls: string[] = [];
  if (index >= 0 && items.length > 1) {
    for (let step = 1; step <= REACH; step += 1) {
      for (const offset of [step, -step]) {
        const item = items[(index + offset + items.length) % items.length];
        if (!item || item.id === active?.id || item.status !== "done" || item.type !== "image" || item.vaultLocked) continue;
        const url = mediaUrl(upscaleDisplayUrl(item), item);
        if (url && !urls.includes(url)) urls.push(url);
      }
    }
  }
  const key = urls.join("\n");
  useEffect(() => {
    const keep = new Map<string, HTMLImageElement>();
    for (const url of urls) {
      let image = held.current.get(url);
      if (!image) {
        image = new Image();
        image.decoding = "async";
        image.src = url;
        image.decode?.().catch(() => {});
      }
      keep.set(url, image);
    }
    // Ones no longer next door are let go; a load still running is dropped.
    for (const [url, image] of held.current) if (!keep.has(url)) image.src = "";
    held.current = keep;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { for (const image of held.current.values()) image.src = ""; held.current.clear(); }, []);
}

import type { GalleryItem, Preferences } from './types';

/**
 * "Share without settings": downloads and shares leave out the prompt, seed
 * and workflow ComfyUI saved inside the file (the server strips them, see
 * server/metadata-strip.js). Separate for the gallery (off unless chosen)
 * and Hidden (on unless turned off), set from the preferences in main.tsx.
 */
let current = { gallery: false, hidden: true };

export function setShareSettings(prefs: Pick<Preferences, 'shareWithoutSettings' | 'hiddenShareWithoutSettings'>) {
  current = { gallery: prefs.shareWithoutSettings === true, hidden: prefs.hiddenShareWithoutSettings !== false };
}

/** Whether this item's downloads and shares go out without its settings. */
export function sharesWithoutSettings(item: Pick<GalleryItem, 'privateVault'>) {
  return item.privateVault ? current.hidden : current.gallery;
}

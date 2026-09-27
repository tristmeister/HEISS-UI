import React from 'react';
import type { GalleryItem } from './types';

/** Hide and unhide, reachable from any tile without threading props through the masonry. */
export type HiddenActions = {
  space: "gallery" | "hidden";
  /** Hidden is set up, and whether it is open right now. */
  enabled: boolean;
  unlocked: boolean;
  hide: (items: GalleryItem[]) => void;
  unhide: (items: GalleryItem[]) => void;
  /** Opens Hidden where the person is, without taking them there. */
  unlock: () => void;
};

export const HiddenActionsContext = React.createContext<HiddenActions | null>(null);

export function useHiddenActions() {
  return React.useContext(HiddenActionsContext);
}

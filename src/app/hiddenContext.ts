import React from 'react';
import type { GalleryItem } from './types';

/** Hide and unhide, reachable from any tile without threading props through the masonry. */
export type HiddenActions = {
  space: "gallery" | "hidden";
  hide: (items: GalleryItem[]) => void;
  unhide: (items: GalleryItem[]) => void;
};

export const HiddenActionsContext = React.createContext<HiddenActions | null>(null);

export function useHiddenActions() {
  return React.useContext(HiddenActionsContext);
}

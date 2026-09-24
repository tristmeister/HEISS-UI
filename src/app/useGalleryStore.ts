import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { apiJson } from './api';
import { sortGalleryItems } from './gallery';
import type { GalleryItem, Mode } from './types';

type GalleryPage = {
  items?: GalleryItem[];
  outputs?: GalleryItem[];
  nextCursor?: string;
  hasMore?: boolean;
  revision?: number;
  totalApprox?: number;
};

type GalleryDelta = {
  revision: number;
  reset?: boolean;
  upserts?: GalleryItem[];
  removes?: string[];
};

type GalleryState = {
  itemsById: Record<string, GalleryItem>;
  sortedIds: string[];
  revision: number;
  nextCursor: string;
  hasMore: boolean;
  loaded: boolean;
  totalApprox: number;
};

type GalleryAction =
  | { type: "reset"; page: GalleryPage }
  | { type: "append"; page: GalleryPage }
  | { type: "upsert"; items: GalleryItem[]; revision?: number }
  | { type: "remove"; keys: string[]; revision?: number }
  | { type: "removeWhere"; predicate: (item: GalleryItem) => boolean; revision?: number }
  | { type: "patch"; update: (item: GalleryItem) => GalleryItem; revision?: number }
  | { type: "replace"; items: GalleryItem[]; revision?: number }
  | { type: "loaded" }
  | { type: "clear" };

const initialState: GalleryState = {
  itemsById: {},
  sortedIds: [],
  revision: 0,
  nextCursor: "",
  hasMore: false,
  loaded: false,
  totalApprox: 0,
};

function itemKey(item: GalleryItem) {
  return item.id || item.url || item.outputName || item.filename;
}

function sameItem(a?: GalleryItem, b?: GalleryItem) {
  if (!a || !b) return false;
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

function orderedIds(itemsById: Record<string, GalleryItem>) {
  return sortGalleryItems(Object.values(itemsById)).map(itemKey).filter(Boolean);
}

function mergeItems(current: Record<string, GalleryItem>, items: GalleryItem[]) {
  let changed = false;
  const next = { ...current };
  for (const item of items) {
    const key = itemKey(item);
    if (!key) continue;
    if (sameItem(next[key], item)) continue;
    next[key] = item;
    changed = true;
  }
  return changed ? next : current;
}

function galleryReducer(state: GalleryState, action: GalleryAction): GalleryState {
  if (action.type === "loaded") return { ...state, loaded: true };
  if (action.type === "clear") return initialState;
  if (action.type === "reset") {
    const pageItems = action.page.items || action.page.outputs || [];
    const pageItemsById = mergeItems({}, pageItems);
    const optimisticItems = Object.values(state.itemsById).filter((item) => {
      const key = itemKey(item);
      return item.optimistic && item.status === "pending" && key && !pageItemsById[key];
    });
    const itemsById = mergeItems(pageItemsById, optimisticItems);
    return {
      itemsById,
      sortedIds: orderedIds(itemsById),
      revision: Number(action.page.revision || state.revision),
      nextCursor: action.page.nextCursor || "",
      hasMore: Boolean(action.page.hasMore),
      loaded: true,
      totalApprox: Math.max(Number(action.page.totalApprox || pageItems.length || 0), Object.keys(itemsById).length),
    };
  }
  if (action.type === "append") {
    const pageItems = action.page.items || action.page.outputs || [];
    const itemsById = mergeItems(state.itemsById, pageItems);
    return {
      ...state,
      itemsById,
      sortedIds: itemsById === state.itemsById ? state.sortedIds : orderedIds(itemsById),
      revision: Number(action.page.revision || state.revision),
      nextCursor: action.page.nextCursor || "",
      hasMore: Boolean(action.page.hasMore),
      loaded: true,
      totalApprox: Number(action.page.totalApprox || state.totalApprox),
    };
  }
  if (action.type === "replace") {
    const itemsById = mergeItems({}, action.items);
    return { ...state, itemsById, sortedIds: orderedIds(itemsById), revision: Number(action.revision || state.revision), loaded: true, totalApprox: action.items.length };
  }
  if (action.type === "upsert") {
    const itemsById = mergeItems(state.itemsById, action.items);
    return {
      ...state,
      itemsById,
      sortedIds: itemsById === state.itemsById ? state.sortedIds : orderedIds(itemsById),
      revision: Number(action.revision || state.revision),
      totalApprox: Math.max(state.totalApprox, Object.keys(itemsById).length),
    };
  }
  if (action.type === "remove") {
    const removeSet = new Set(action.keys);
    let changed = false;
    let removed = 0;
    const itemsById = { ...state.itemsById };
    for (const [key, item] of Object.entries(state.itemsById)) {
      if (removeSet.has(key) || removeSet.has(item.id) || removeSet.has(item.url) || (item.jobId && removeSet.has(item.jobId))) {
        delete itemsById[key];
        changed = true;
        removed += 1;
      }
    }
    return changed
      ? { ...state, itemsById, sortedIds: orderedIds(itemsById), revision: Number(action.revision || state.revision), totalApprox: Math.max(0, state.totalApprox - removed) }
      : { ...state, revision: Number(action.revision || state.revision) };
  }
  if (action.type === "removeWhere") {
    let changed = false;
    let removed = 0;
    const itemsById = { ...state.itemsById };
    for (const [key, item] of Object.entries(state.itemsById)) {
      if (!action.predicate(item)) continue;
      delete itemsById[key];
      changed = true;
      removed += 1;
    }
    return changed
      ? { ...state, itemsById, sortedIds: orderedIds(itemsById), revision: Number(action.revision || state.revision), totalApprox: Math.max(0, state.totalApprox - removed) }
      : { ...state, revision: Number(action.revision || state.revision) };
  }
  if (action.type === "patch") {
    let changed = false;
    const itemsById = { ...state.itemsById };
    for (const [key, item] of Object.entries(state.itemsById)) {
      const updated = action.update(item);
      if (sameItem(item, updated)) continue;
      const updatedKey = itemKey(updated) || key;
      if (updatedKey !== key) delete itemsById[key];
      itemsById[updatedKey] = updated;
      changed = true;
    }
    return changed
      ? { ...state, itemsById, sortedIds: orderedIds(itemsById), revision: Number(action.revision || state.revision) }
      : { ...state, revision: Number(action.revision || state.revision) };
  }
  return state;
}

export type GallerySpace = "gallery" | "hidden";

export function useGalleryStore({ mode, showFailedItems, space = "gallery", onLocked }: { mode: Mode; showFailedItems: boolean; space?: GallerySpace; onLocked?: () => void }) {
  const [state, dispatch] = useReducer(galleryReducer, initialState);
  const includeFailed = showFailedItems ? "1" : "0";
  const hidden = space === "hidden";
  // Moving between the gallery and Hidden starts from nothing, and a page still
  // on its way from the space just left is dropped when it lands.
  const spaceRef = useRef(space);
  useEffect(() => {
    if (spaceRef.current === space) return;
    spaceRef.current = space;
    dispatch({ type: "clear" });
  }, [space]);

  const gallery = useMemo(() => state.sortedIds.map((id) => state.itemsById[id]).filter(Boolean), [state.itemsById, state.sortedIds]);
  const visibleGallery = gallery;

  const loadGallery = useCallback(async () => {
    // Hidden is its own list; a locked session gets nothing back and shows the lock instead.
    const page = hidden
      ? await apiJson<GalleryPage>(`/api/hidden/gallery?type=${encodeURIComponent(mode)}&includeFailed=${includeFailed}`).catch(() => { onLocked?.(); return { items: [], revision: 0 }; })
      : await apiJson<GalleryPage>(`/api/gallery?type=${encodeURIComponent(mode)}&limit=220&includeFailed=${includeFailed}`);
    if (spaceRef.current !== space) return page;
    dispatch({ type: "reset", page });
    return page;
  }, [hidden, includeFailed, mode, onLocked, space]);

  const loadMoreGalleryItems = useCallback(async () => {
    if (!state.hasMore || !state.nextCursor) return;
    const page = await apiJson<GalleryPage>(`/api/gallery?type=${encodeURIComponent(mode)}&limit=220&cursor=${encodeURIComponent(state.nextCursor)}&includeFailed=${includeFailed}`);
    dispatch({ type: "append", page });
  }, [includeFailed, mode, state.hasMore, state.nextCursor]);

  const loadGalleryDelta = useCallback(async () => {
    if (!state.revision) return loadGallery();
    if (hidden) {
      // Locked from another tab or device: say so here too instead of showing a stale grid.
      const page = await apiJson<GalleryPage & { unchanged?: boolean }>(`/api/hidden/gallery?type=${encodeURIComponent(mode)}&includeFailed=${includeFailed}&since=${state.revision}`).catch(() => { onLocked?.(); return null; });
      if (page && !page.unchanged && spaceRef.current === space) dispatch({ type: "reset", page });
      return page;
    }
    const delta = await apiJson<GalleryDelta>(`/api/gallery/delta?since=${state.revision}&type=${encodeURIComponent(mode)}&includeFailed=${includeFailed}`);
    if (spaceRef.current !== space) return delta;
    if (delta.reset) return loadGallery();
    if (delta.removes?.length) dispatch({ type: "remove", keys: delta.removes, revision: delta.revision });
    if (delta.upserts?.length) dispatch({ type: "upsert", items: delta.upserts, revision: delta.revision });
    if (!delta.removes?.length && !delta.upserts?.length) dispatch({ type: "upsert", items: [], revision: delta.revision });
    return delta;
  }, [hidden, includeFailed, loadGallery, mode, space, state.revision]);

  const setGallery = useCallback((next: GalleryItem[] | ((current: GalleryItem[]) => GalleryItem[])) => {
    const items = typeof next === "function" ? next(gallery) : next;
    dispatch({ type: "replace", items });
  }, [gallery]);

  const upsertGalleryItems = useCallback((items: GalleryItem[], revision?: number) => dispatch({ type: "upsert", items, revision }), []);
  const removeGalleryItems = useCallback((keys: string[], revision?: number) => dispatch({ type: "remove", keys, revision }), []);
  const removeGalleryItemsWhere = useCallback((predicate: (item: GalleryItem) => boolean, revision?: number) => dispatch({ type: "removeWhere", predicate, revision }), []);
  const patchGalleryItems = useCallback((update: (item: GalleryItem) => GalleryItem, revision?: number) => dispatch({ type: "patch", update, revision }), []);

  return {
    gallery,
    visibleGallery,
    renderedGallery: visibleGallery,
    galleryLoaded: state.loaded,
    hasMoreGallery: state.hasMore,
    galleryTotalApprox: state.totalApprox,
    galleryRevision: state.revision,
    loadGallery,
    loadGalleryDelta,
    loadMoreGalleryItems,
    setGallery,
    upsertGalleryItems,
    removeGalleryItems,
    removeGalleryItemsWhere,
    patchGalleryItems,
  };
}

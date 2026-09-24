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
  /** Emptied by a crossing between the gallery and Hidden, not by a first load. */
  crossing?: boolean;
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
  | { type: "clear" }
  | { type: "cross"; restore: GalleryState | null };

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

/** Field by field, so a big preview string is compared in place rather than serialised with the whole item. */
function sameItem(a?: GalleryItem, b?: GalleryItem) {
  if (!a || !b) return false;
  if (a === b) return true;
  const aKeys = Object.keys(a) as (keyof GalleryItem)[];
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => {
    const left = a[key];
    const right = b[key];
    if (left === right) return true;
    return typeof left === "object" && typeof right === "object" && JSON.stringify(left) === JSON.stringify(right);
  });
}

/** Whether an update can move an item in the sorted order (see sortGalleryItems). */
function sortFieldsChanged(a: GalleryItem, b: GalleryItem) {
  return a.createdAt !== b.createdAt || a.index !== b.index || a.jobId !== b.jobId || a.id !== b.id;
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

/** The same state object when the revision did not move, so React skips the re-render. */
function withRevision(state: GalleryState, revision?: number) {
  const next = Number(revision || state.revision);
  return next === state.revision ? state : { ...state, revision: next };
}

function galleryReducer(state: GalleryState, action: GalleryAction): GalleryState {
  if (action.type === "loaded") return { ...state, loaded: true };
  if (action.type === "clear") return initialState;
  if (action.type === "cross") return action.restore || { ...initialState, crossing: true };
  if (action.type === "reset") {
    const pageItems = action.page.items || action.page.outputs || [];
    // Keep the existing object for an unchanged item, so memoised tiles skip re-rendering.
    const pageItemsById: Record<string, GalleryItem> = {};
    for (const item of pageItems) {
      const key = itemKey(item);
      if (key) pageItemsById[key] = sameItem(state.itemsById[key], item) ? state.itemsById[key] : item;
    }
    const optimisticItems = Object.values(state.itemsById).filter((item) => {
      const key = itemKey(item);
      return item.optimistic && item.status === "pending" && key && !pageItemsById[key];
    });
    const merged = mergeItems(pageItemsById, optimisticItems);
    const keys = Object.keys(merged);
    const unchanged = keys.length === Object.keys(state.itemsById).length && keys.every((key) => merged[key] === state.itemsById[key]);
    const itemsById = unchanged ? state.itemsById : merged;
    const next: GalleryState = {
      itemsById,
      sortedIds: unchanged ? state.sortedIds : orderedIds(itemsById),
      revision: Number(action.page.revision || state.revision),
      nextCursor: action.page.nextCursor || "",
      hasMore: Boolean(action.page.hasMore),
      loaded: true,
      totalApprox: Math.max(Number(action.page.totalApprox || pageItems.length || 0), Object.keys(itemsById).length),
    };
    const same = (Object.keys(next) as (keyof GalleryState)[]).every((key) => next[key] === state[key]);
    return same ? state : next;
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
    // An empty delta must not hand React a new state object: that re-renders the whole app every poll.
    if (itemsById === state.itemsById) return withRevision(state, action.revision);
    const reorder = action.items.some((item) => {
      const previous = state.itemsById[itemKey(item)];
      return !previous || sortFieldsChanged(previous, item);
    });
    return {
      ...state,
      itemsById,
      sortedIds: reorder ? orderedIds(itemsById) : state.sortedIds,
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
      : withRevision(state, action.revision);
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
      : withRevision(state, action.revision);
  }
  if (action.type === "patch") {
    let changed = false;
    let reorder = false;
    const itemsById = { ...state.itemsById };
    for (const [key, item] of Object.entries(state.itemsById)) {
      const updated = action.update(item);
      if (sameItem(item, updated)) continue;
      const updatedKey = itemKey(updated) || key;
      if (updatedKey !== key) delete itemsById[key];
      itemsById[updatedKey] = updated;
      changed = true;
      // Progress and previews change every tick during a run; they never move an item.
      reorder ||= updatedKey !== key || sortFieldsChanged(item, updated);
    }
    return changed
      ? { ...state, itemsById, sortedIds: reorder ? orderedIds(itemsById) : state.sortedIds, revision: Number(action.revision || state.revision) }
      : withRevision(state, action.revision);
  }
  return state;
}

export type GallerySpace = "gallery" | "hidden";

export function useGalleryStore({ mode, showFailedItems, space = "gallery", onLocked }: { mode: Mode; showFailedItems: boolean; space?: GallerySpace; onLocked?: () => void }) {
  const [state, dispatch] = useReducer(galleryReducer, initialState);
  const includeFailed = showFailedItems ? "1" : "0";
  const hidden = space === "hidden";
  // Moving between the gallery and Hidden swaps the list, and a page still on
  // its way from the space just left is dropped when it lands. The gallery is
  // kept aside while in Hidden so coming back shows it at once and only syncs;
  // Hidden itself is never kept once left.
  const spaceRef = useRef(space);
  const stateRef = useRef(state);
  stateRef.current = state;
  const gallerySnapshot = useRef<GalleryState | null>(null);
  useEffect(() => {
    if (spaceRef.current === space) return;
    if (spaceRef.current === "gallery" && stateRef.current.loaded) gallerySnapshot.current = stateRef.current;
    spaceRef.current = space;
    dispatch({ type: "cross", restore: space === "gallery" ? gallerySnapshot.current : null });
    if (space === "gallery") gallerySnapshot.current = null;
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
    galleryCrossing: !state.loaded && Boolean(state.crossing),
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

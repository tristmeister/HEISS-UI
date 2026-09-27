import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { GalleryTile } from './GalleryTile';
import { generationIdentity } from './GenerationPreview';
import { BundleTile, bundleSheetHeight } from './BundleTile';
import type { UpscaleNotice } from './useUpscale';
import type { GalleryItem } from './types';

type VirtualMasonryGalleryProps = {
  items: GalleryItem[];
  columns: number;
  scrollRef: React.RefObject<HTMLElement | null>;
  formatElapsed: (value: number) => string;
  titleFromPrompt: (value?: string) => string;
  openItem: (item: GalleryItem) => void;
  cancelJob: (jobId?: string) => void;
  copyPromptAndToast: (item: GalleryItem) => void;
  deleteItem: (item: GalleryItem) => void;
  expandedBundles: Set<string>;
  gatheringIds: Set<string>;
  settlingBundles: Set<string>;
  toggleBundle: (bundleId: string) => void;
  setBundleCover: (domain: "gallery" | "vault", bundleId: string, itemId: string) => void;
  ungroupBundle: (domain: "gallery" | "vault", bundleId: string) => void;
  smartUpscale?: boolean;
  upscaleBusyIds?: Set<string>;
  onUpscale?: (item: GalleryItem) => void;
  onCancelUpscale?: (item: GalleryItem) => void;
  upscaleNotices?: Map<string, UpscaleNotice>;
  onDismissUpscaleNotice?: (id: string) => void;
};

function estimatedHeight(item: GalleryItem, width: number, expandedBundles?: Set<string>) {
  if (item.bundle && expandedBundles?.has(item.bundle.id)) return bundleSheetHeight(item.bundle.count, width);
  const ratio = Number(item.width || 1) / Math.max(1, Number(item.height || 1));
  return Math.max(120, Math.round(width / Math.max(0.2, ratio)));
}

/** Which column a tile sits in, kept by run and position so a finished image keeps its pending tile's place. */
const placementKey = (item: GalleryItem) => item.jobId && Number.isInteger(item.index) ? `${item.jobId}:${item.index}` : item.id;

function itemKey(item: GalleryItem) {
  return generationIdentity(item) || item.url || item.outputName || item.filename;
}

/** The nearest ancestor that scrolls vertically: the gallery's stage in every layout. */
function scrollParent(node: HTMLElement | null) {
  for (let current = node?.parentElement || null; current; current = current.parentElement) {
    const overflow = getComputedStyle(current).overflowY;
    if (overflow === "auto" || overflow === "scroll") return current;
  }
  return null;
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    setWidth(ref.current.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function VirtualMasonryGallery({
  cancelJob,
  columns,
  copyPromptAndToast,
  deleteItem,
  expandedBundles,
  gatheringIds,
  formatElapsed,
  items,
  openItem,
  scrollRef,
  setBundleCover,
  settlingBundles,
  smartUpscale = false,
  titleFromPrompt,
  toggleBundle,
  ungroupBundle,
  upscaleBusyIds,
  onUpscale,
  onCancelUpscale,
  upscaleNotices,
  onDismissUpscaleNotice,
}: VirtualMasonryGalleryProps) {
  const [containerRef, containerWidth] = useElementWidth<HTMLElement>();
  // The element that scrolls, found from where the gallery actually sits. The
  // scrollRef passed in is attached by an ancestor after this gallery's own
  // layout effects run, so right after a layout switch (phone ↔ full studio) it
  // still named the previous shell's detached <main>: the virtualizer measured
  // that as 0px tall and drew no tiles until something re-rendered it.
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    const next = scrollParent(containerRef.current) || scrollRef.current;
    setScrollElement((current) => (current === next ? current : next));
  });
  const safeColumns = Math.max(1, columns);
  const spacing = containerWidth < 620 ? 4 : 7;
  const columnWidth = containerWidth ? Math.floor((containerWidth - spacing * (safeColumns - 1)) / safeColumns) : 240;
  // The grid is newest first, each tile in the shortest column: the newest top
  // left, the same layout a reload gives. That places every tile by the ones
  // before it, so a tile that goes (deleted, hidden, stopped) only moves the
  // tiles after it, but a result landing at the top moves them all. While the
  // pointer is over the grid, landing tiles take the top of whichever column's
  // top tile is oldest instead and nothing else moves, so no tile slides out
  // from under the cursor; the grid settles once the pointer leaves.
  const [holding, setHolding] = useState(false);
  const releaseTimer = useRef(0);
  const hold = () => { window.clearTimeout(releaseTimer.current); setHolding(true); };
  const release = () => { window.clearTimeout(releaseTimer.current); releaseTimer.current = window.setTimeout(() => setHolding(false), 500); };
  useEffect(() => () => window.clearTimeout(releaseTimer.current), []);
  const placement = useRef<{ signature: string; columns: Map<string, number> }>({ signature: "", columns: new Map() });
  const columnItems = useMemo(() => {
    const signature = `${safeColumns}:${columnWidth}`;
    const previous = placement.current.signature === signature ? placement.current.columns : null;
    const assigned = new Map<string, number>();
    const heights = Array.from({ length: safeColumns }, () => 0);
    const height = (item: GalleryItem) => estimatedHeight(item, columnWidth, expandedBundles) + spacing;
    const place = (item: GalleryItem, column: number) => {
      assigned.set(placementKey(item), column);
      heights[column] += height(item);
    };
    const shortest = () => {
      let target = 0;
      for (let column = 1; column < safeColumns; column += 1) if (heights[column] < heights[target]) target = column;
      return target;
    };
    const present = new Set(items.map(placementKey));
    const removed = previous ? Array.from(previous.keys()).some((key) => !present.has(key)) : false;
    const known = (item: GalleryItem) => {
      const column = previous?.get(placementKey(item));
      return column !== undefined && column < safeColumns;
    };
    // Hold only for results landing on top of tiles that are all where they were.
    const firstKnown = items.findIndex(known);
    const holdable = holding && previous && !removed && firstKnown > 0 && items.slice(firstKnown).every(known);
    if (!holdable) {
      for (const item of items) place(item, shortest());
    } else {
      for (const item of items.slice(firstKnown)) place(item, previous!.get(placementKey(item))!);
      const top = Array.from({ length: safeColumns }, () => Infinity);
      items.forEach((item, index) => {
        const column = assigned.get(placementKey(item));
        if (column !== undefined && top[column] === Infinity) top[column] = index;
      });
      // Oldest of the new ones first, each onto the column whose top tile is oldest.
      for (let index = firstKnown - 1; index >= 0; index -= 1) {
        let target = 0;
        for (let column = 1; column < safeColumns; column += 1) {
          if (top[column] > top[target] || (top[column] === top[target] && heights[column] < heights[target])) target = column;
        }
        place(items[index], target);
        top[target] = index;
      }
    }
    placement.current = { signature, columns: assigned };
    const next = Array.from({ length: safeColumns }, () => [] as GalleryItem[]);
    for (const item of items) next[assigned.get(placementKey(item)) ?? 0].push(item);
    return next;
  }, [columnWidth, expandedBundles, holding, items, safeColumns, spacing]);

  return (
    <section
      ref={containerRef}
      className="gallery virtual-gallery"
      aria-label="Gallery"
      onPointerEnter={hold}
      onPointerLeave={release}
      onKeyDown={(event) => {
        // Tab walks the masonry column by column; arrows follow time instead:
        // right or down for older, left or up for newer.
        if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
        const tile = (event.target as HTMLElement).closest<HTMLElement>("[data-tile-id]");
        if (!tile || (event.target as HTMLElement).closest(".tile-overlay")) return;
        const index = items.findIndex((item) => item.id === tile.dataset.tileId);
        const next = items[index + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1)];
        const target = next ? document.querySelector<HTMLElement>(`[data-tile-id="${CSS.escape(next.id)}"] .tile`) : null;
        if (!target) return;
        event.preventDefault();
        target.focus();
        target.scrollIntoView({ block: "nearest" });
      }}
      style={{ "--gallery-columns": safeColumns, "--gallery-gap": `${spacing}px` } as React.CSSProperties}
    >
      {columnItems.map((column, index) => (
        <VirtualMasonryColumn
          key={`virtual-column-${index}`}
          cancelJob={cancelJob}
          column={column}
          copyPromptAndToast={copyPromptAndToast}
          deleteItem={deleteItem}
          expandedBundles={expandedBundles}
          gatheringIds={gatheringIds}
          formatElapsed={formatElapsed}
          openItem={openItem}
          scrollRef={scrollRef}
          scrollElement={scrollElement}
          setBundleCover={setBundleCover}
          settlingBundles={settlingBundles}
          smartUpscale={smartUpscale}
          upscaleBusyIds={upscaleBusyIds}
          onUpscale={onUpscale}
          onCancelUpscale={onCancelUpscale}
          upscaleNotices={upscaleNotices}
          onDismissUpscaleNotice={onDismissUpscaleNotice}
          spacing={spacing}
          titleFromPrompt={titleFromPrompt}
          toggleBundle={toggleBundle}
          ungroupBundle={ungroupBundle}
          width={columnWidth}
        />
      ))}
    </section>
  );
}

function VirtualMasonryColumn({
  cancelJob,
  column,
  copyPromptAndToast,
  deleteItem,
  expandedBundles,
  gatheringIds,
  formatElapsed,
  openItem,
  scrollRef,
  setBundleCover,
  settlingBundles,
  smartUpscale = false,
  spacing,
  titleFromPrompt,
  toggleBundle,
  ungroupBundle,
  upscaleBusyIds,
  onUpscale,
  onCancelUpscale,
  upscaleNotices,
  onDismissUpscaleNotice,
  width,
  scrollElement,
}: Omit<VirtualMasonryGalleryProps, "columns" | "items"> & { column: GalleryItem[]; spacing: number; width: number; scrollElement: HTMLElement | null }) {
  const virtualizer = useVirtualizer({
    count: column.length,
    getScrollElement: () => (scrollElement?.isConnected ? scrollElement : scrollRef.current),
    estimateSize: (index: number) => estimatedHeight(column[index], width, expandedBundles) + spacing,
    overscan: 8,
    getItemKey: (index: number) => itemKey(column[index]) || index,
  });
  return (
    <div className="gallery-column virtual-gallery-column" style={{ width }}>
      <div className="virtual-gallery-spacer" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualItem: any) => {
          const item = column[virtualItem.index];
          if (!item) return null;
          const height = estimatedHeight(item, width, expandedBundles);
          const cellHeight = height + spacing;
          return (
            <div
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              className="virtual-gallery-cell"
              data-index={virtualItem.index}
              style={{ height: cellHeight, transform: `translateY(${virtualItem.start}px)` }}
            >
              {item.bundle ? (
                <BundleTile
                  expanded={expandedBundles.has(item.bundle.id)}
                  height={height}
                  item={item}
                  onSetCover={setBundleCover}
                  onToggle={toggleBundle}
                  onUngroup={ungroupBundle}
                  settling={settlingBundles.has(item.bundle.id)}
                  openItem={openItem}
                  titleFromPrompt={titleFromPrompt}
                  width={width}
                />
              ) : (
              <GalleryTile
                cancelJob={cancelJob}
                gathering={gatheringIds.has(item.id)}
                gatherIndex={virtualItem.index}
                copyPromptAndToast={copyPromptAndToast}
                deleteItem={deleteItem}
                formatElapsed={formatElapsed}
                height={height}
                item={item}
                openItem={openItem}
                smartUpscale={smartUpscale}
                upscaleBusy={Boolean(upscaleBusyIds?.has(item.id))}
                onUpscale={onUpscale}
                onCancelUpscale={onCancelUpscale}
                upscaleNotice={upscaleNotices?.get(item.id)}
                onDismissUpscaleNotice={onDismissUpscaleNotice}
                titleFromPrompt={titleFromPrompt}
                width={width}
              />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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

function itemKey(item: GalleryItem) {
  return generationIdentity(item) || item.url || item.outputName || item.filename;
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
  const safeColumns = Math.max(1, columns);
  const spacing = containerWidth < 620 ? 4 : 7;
  const columnWidth = containerWidth ? Math.floor((containerWidth - spacing * (safeColumns - 1)) / safeColumns) : 240;
  // Tiles keep the column they were first placed in. A greedy pass over the
  // whole list reassigned nearly every tile whenever one landed at the top, so
  // the grid reshuffled under a finger reaching for a tile. Only a new column
  // count or width lays everything out afresh.
  const placement = useRef<{ signature: string; columns: Map<string, number> }>({ signature: "", columns: new Map() });
  const columnItems = useMemo(() => {
    const signature = `${safeColumns}:${columnWidth}`;
    if (placement.current.signature !== signature) placement.current = { signature, columns: new Map() };
    const assigned = placement.current.columns;
    const heights = Array.from({ length: safeColumns }, () => 0);
    const keyOf = (item: GalleryItem) => item.jobId && Number.isInteger(item.index) ? `${item.jobId}:${item.index}` : item.id;
    const height = (item: GalleryItem) => estimatedHeight(item, columnWidth, expandedBundles) + spacing;
    const present = new Set<string>();
    for (const item of items) {
      const key = keyOf(item);
      present.add(key);
      const column = assigned.get(key);
      if (column !== undefined && column < safeColumns) heights[column] += height(item);
    }
    for (const key of Array.from(assigned.keys())) if (!present.has(key)) assigned.delete(key);
    const shortest = () => {
      let target = 0;
      for (let column = 1; column < safeColumns; column += 1) if (heights[column] < heights[target]) target = column;
      return target;
    };
    const place = (item: GalleryItem, column: number) => {
      assigned.set(keyOf(item), column);
      heights[column] += height(item);
    };
    const placed = (item: GalleryItem) => {
      const column = assigned.get(keyOf(item));
      return column !== undefined && column < safeColumns;
    };
    if (!assigned.size) {
      // A fresh layout: newest first, so the top row holds the latest outputs.
      for (const item of items) place(item, shortest());
    } else {
      // Where each column's newest tile sits in the list (smaller is newer).
      const top = Array.from({ length: safeColumns }, () => Infinity);
      items.forEach((item, index) => {
        const column = assigned.get(keyOf(item));
        if (column !== undefined && column < safeColumns && top[column] === Infinity) top[column] = index;
      });
      const newestPlaced = Math.min(...top);
      // Tiles that land above everything (fresh results), oldest of them first,
      // go to the column whose top tile is the oldest: the latest stay spread
      // across the top row and every other tile only slides down its column.
      for (let index = Math.min(newestPlaced, items.length) - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (placed(item)) continue;
        let target = 0;
        for (let column = 1; column < safeColumns; column += 1) {
          if (top[column] > top[target] || (top[column] === top[target] && heights[column] < heights[target])) target = column;
        }
        place(item, target);
        top[target] = index;
      }
      // Anything else new (an older page loading in below): shortest column.
      for (const item of items) if (!placed(item)) place(item, shortest());
    }
    const next = Array.from({ length: safeColumns }, () => [] as GalleryItem[]);
    for (const item of items) next[assigned.get(keyOf(item)) ?? 0].push(item);
    return next;
  }, [columnWidth, expandedBundles, items, safeColumns, spacing]);

  return (
    <section
      ref={containerRef}
      className="gallery virtual-gallery"
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
}: Omit<VirtualMasonryGalleryProps, "columns" | "items"> & { column: GalleryItem[]; spacing: number; width: number }) {
  const virtualizer = useVirtualizer({
    count: column.length,
    getScrollElement: () => scrollRef.current,
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

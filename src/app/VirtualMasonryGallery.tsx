import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GalleryTile } from './GalleryTile';
import { generationIdentity } from './GenerationPreview';
import { BundleTile, bundleSheetHeight } from './BundleTile';
import { WIDE_RATIO, firstReaching, packMasonry, type MasonrySlot } from './masonry';
import type { UpscaleNotice } from './useUpscale';
import type { GalleryItem } from './types';

type VirtualMasonryGalleryProps = {
  items: GalleryItem[];
  columns: number;
  /** Wide images take two columns, from three columns up. */
  spanWide?: boolean;
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

/** Bundles stay one column wide: an opened one lays its sheet out to that width. */
const isWide = (item: GalleryItem) => !item.bundle && Number(item.width || 1) / Math.max(1, Number(item.height || 1)) >= WIDE_RATIO;

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
  spanWide = false,
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
  // still named the previous shell's detached <main>: the grid measured that
  // as 0px tall and drew no tiles until something re-rendered it.
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  // The grid's own column gap, which the stylesheets set and which isn't the
  // spacing between rows (8px against 7px on a computer): tiles line up on the
  // grid's tracks, where the per-column lists used to sit.
  const [columnGap, setColumnGap] = useState<number | null>(null);
  React.useLayoutEffect(() => {
    const next = scrollParent(containerRef.current) || scrollRef.current;
    setScrollElement((current) => (current === next ? current : next));
    const gap = containerRef.current ? parseFloat(getComputedStyle(containerRef.current).columnGap) : NaN;
    if (Number.isFinite(gap)) setColumnGap((current) => (current === gap ? current : gap));
  });
  const safeColumns = Math.max(1, columns);
  const spacing = containerWidth < 620 ? 4 : 7;
  const columnWidth = containerWidth ? Math.floor((containerWidth - spacing * (safeColumns - 1)) / safeColumns) : 240;
  // Columns sit where the grid's tracks start (browsers lay tracks out in
  // 1/64 px steps), each tile as wide as it always was; a wide tile reaches
  // the right edge of the tile beside it.
  const gutter = columnGap ?? spacing;
  const track = containerWidth ? (containerWidth - gutter * (safeColumns - 1)) / safeColumns : columnWidth;
  const columnLeft = (column: number) => Math.floor(column * track * 64) / 64 + column * gutter;
  const wideWidth = Math.floor(track + gutter + columnWidth);
  // The grid is newest first, each tile in the shortest column: the newest top
  // left, the same layout a reload gives. That places every tile by the ones
  // before it, so a tile that goes (deleted, hidden, stopped) only moves the
  // tiles after it, but a result landing at the top moves them all. While the
  // pointer is over the grid, results from elsewhere take the top of whichever
  // column's top tile is oldest instead and nothing else moves, so no tile
  // slides out from under the cursor; the grid settles once the pointer
  // leaves. A generation started here always lands top left. With
  // spanWide, wide images take two level columns (masonry.js has the rules).
  const [holding, setHolding] = useState(false);
  const releaseTimer = useRef(0);
  const hold = () => { window.clearTimeout(releaseTimer.current); setHolding(true); };
  const release = () => { window.clearTimeout(releaseTimer.current); releaseTimer.current = window.setTimeout(() => setHolding(false), 500); };
  useEffect(() => () => window.clearTimeout(releaseTimer.current), []);
  const placement = useRef<{ signature: string; slots: Map<string, MasonrySlot> | null }>({ signature: "", slots: null });
  const layout = useMemo(() => {
    const signature = `${safeColumns}:${columnWidth}:${spanWide}`;
    const previous = placement.current.signature === signature ? placement.current.slots : null;
    // What you just started here lands top left at once, hold or not: you
    // pressed Generate, so the grid moving now is expected. Results from
    // another device or tab still wait for the pointer to leave.
    const ownLanding = Boolean(previous) && items.some((item) => item.optimistic && !previous!.has(placementKey(item)));
    const next = packMasonry({
      count: items.length,
      columns: safeColumns,
      columnWidth,
      gap: spacing,
      keyOf: (index) => placementKey(items[index]),
      heightOf: (index, span) => estimatedHeight(items[index], span === 2 ? wideWidth : columnWidth, expandedBundles),
      wideOf: (index) => spanWide && isWide(items[index]),
      previous,
      holding: holding && !ownLanding,
    });
    placement.current = { signature, slots: next.placement };
    return next;
  }, [columnWidth, expandedBundles, holding, items, safeColumns, spacing, spanWide, wideWidth]);

  // The stretch of the grid to draw, in the grid's own coordinates: the screen
  // and one more above and below. It moves in steps of half a screen, so
  // scrolling re-renders the grid only when tiles need to come or go.
  const [range, setRange] = useState({ start: 0, end: 2400 });
  React.useLayoutEffect(() => {
    const element = scrollElement?.isConnected ? scrollElement : scrollRef.current;
    const container = containerRef.current;
    if (!element || !container) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const offset = container.getBoundingClientRect().top - element.getBoundingClientRect().top;
      const view = element.clientHeight || window.innerHeight;
      const step = Math.max(200, Math.round(view / 2));
      const overscan = Math.max(600, view);
      const band = Math.floor(Math.max(0, -offset) / step);
      const start = band * step - overscan;
      const end = (band + 1) * step + view + overscan;
      setRange((current) => (current.start === start && current.end === end ? current : { start, end }));
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };
    measure();
    element.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", schedule);
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [containerRef, layout.total, scrollElement, scrollRef]);

  // The tiles in that stretch, column by column and top to bottom, so Tab walks
  // the masonry as it always has; a spanning tile belongs to its left column.
  const visible = useMemo(() => {
    const out: Array<{ index: number; row: number }> = [];
    layout.lists.forEach((list, column) => {
      for (let row = firstReaching(list, layout.top, layout.height, range.start); row < list.length; row += 1) {
        const index = list[row];
        if (layout.top[index] > range.end) break;
        if (layout.column[index] === column) out.push({ index, row });
      }
    });
    return out;
  }, [layout, range]);

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
      <div className="virtual-gallery-spacer" style={{ height: layout.total }}>
        {visible.map(({ index, row }) => {
          const item = items[index];
          const wide = layout.span[index] === 2;
          const width = wide ? wideWidth : columnWidth;
          const height = layout.height[index];
          return (
            <div
              key={itemKey(item) || `tile-${index}`}
              className={wide ? "virtual-gallery-cell is-wide" : "virtual-gallery-cell"}
              style={{ left: columnLeft(layout.column[index]), width, height: height + spacing, transform: `translateY(${layout.top[index]}px)` }}
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
                gatherIndex={row}
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
    </section>
  );
}

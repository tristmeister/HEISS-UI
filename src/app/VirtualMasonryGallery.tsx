import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { GalleryTile } from './GalleryTile';
import { RunShelf, RunStack, MomentHeading } from './RunStack';
import { layoutGallery, placementKey, type LayoutEntry, type RunStackStyle } from './galleryLayout';
import { cn } from './format';
import type { MasonrySlot } from './masonry';
import type { UpscaleNotice } from './useUpscale';
import type { GalleryGroups, Run } from './runs';
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
  /** Moments and runs; null while grouping is off. */
  groups?: GalleryGroups | null;
  /** Headings for each stretch of time. */
  moments?: boolean;
  /** Runs fold into stacks. */
  stackRuns?: boolean;
  openRuns?: Set<string>;
  /** A folded run as a photo with edges under it, or a cover flow in one card. */
  stackStyle?: RunStackStyle;
  setRunOpen?: (runId: string, open: boolean) => void;
  /** Takes an open run apart for good: its tiles go back to being separate. */
  onUnstack?: (run: Run) => void;
  /** On a phone a stack opens as a sheet instead of in place. */
  onStackPress?: (run: Run) => void;
  /** Scroll this run into view once it is laid out (opened from zen or the sheet). */
  focusRun?: string;
  onFocused?: () => void;
  smartUpscale?: boolean;
  upscaleBusyIds?: Set<string>;
  onUpscale?: (item: GalleryItem) => void;
  onCancelUpscale?: (item: GalleryItem) => void;
  upscaleNotices?: Map<string, UpscaleNotice>;
  onDismissUpscaleNotice?: (id: string) => void;
};

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

const emptySet = new Set<string>();
/** Tiles glide to new places (a run opening above them, a column change) on one soft spring. */
const glide = { type: "spring" as const, stiffness: 420, damping: 42, mass: 0.9 };
/** How long a run takes to fold back into its stack before the grid closes over it. */
const FOLD_MS = 300;

type Flight = { runId: string; x: number; y: number; w: number; h: number; at: number };

export function VirtualMasonryGallery({
  cancelJob,
  columns,
  copyPromptAndToast,
  deleteItem,
  focusRun,
  formatElapsed,
  groups = null,
  items,
  moments = false,
  onFocused,
  onStackPress,
  openItem,
  openRuns = emptySet,
  onUnstack,
  stackStyle = "burst",
  scrollRef,
  setRunOpen,
  smartUpscale = false,
  spanWide = false,
  stackRuns = false,
  titleFromPrompt,
  upscaleBusyIds,
  onUpscale,
  onCancelUpscale,
  upscaleNotices,
  onDismissUpscaleNotice,
}: VirtualMasonryGalleryProps) {
  const reducedMotion = useReducedMotion();
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
  const gutter = columnGap ?? spacing;
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

  // A run folding shut stays open in the layout until its tiles have flown home.
  const [folding, setFolding] = useState<string | null>(null);
  const placement = useRef<{ signature: string; slots: Map<string, Map<string, MasonrySlot>> }>({ signature: "", slots: new Map() });
  const grouped = Boolean(groups) && (moments || stackRuns);
  const layoutFor = (open: Set<string>, previous: Map<string, Map<string, MasonrySlot>>, hold: boolean) => layoutGallery({
    items,
    groups: grouped ? groups : null,
    moments: grouped && moments,
    stackRuns: grouped && stackRuns,
    stackStyle,
    open,
    width: containerWidth,
    columns: safeColumns,
    spacing,
    gutter,
    spanWide,
    previous,
    holding: hold,
  });
  const layout = useMemo(() => {
    const signature = `${safeColumns}:${containerWidth}:${spanWide}:${moments}:${stackRuns}:${stackStyle}`;
    const previous = placement.current.signature === signature ? placement.current.slots : new Map();
    // What you just started here lands top left at once, hold or not: you
    // pressed Generate, so the grid moving now is expected. Results from
    // another device or tab still wait for the pointer to leave.
    const placed = (key: string) => [...previous.values()].some((slots) => slots.has(key));
    const ownLanding = previous.size > 0 && items.some((item) => item.optimistic && !placed(placementKey(item)));
    const next = layoutFor(openRuns, previous, holding && !ownLanding);
    placement.current = { signature, slots: next.placements };
    return next;
  }, [containerWidth, gutter, groups, holding, items, moments, openRuns, safeColumns, stackStyle, spacing, spanWide, stackRuns]); // eslint-disable-line react-hooks/exhaustive-deps

  // A run opening deals its tiles out where they land, one after another in
  // the order they were made, while everything below glides down to make room.
  // (Flying them from the stack looked lost whenever the shelf landed far from
  // it: tiles streaked across the screen.) If the shelf lands out of sight,
  // the gallery scrolls it into view.
  const flight = useRef<Flight | null>(null);
  const reveal = useRef<string | null>(null);
  const openStack = (entry: Extract<LayoutEntry, { kind: "stack" }>) => {
    if (onStackPress) { onStackPress(entry.run); return; }
    flight.current = { runId: entry.run.id, x: entry.x, y: entry.y, w: entry.w, h: entry.h, at: performance.now() };
    reveal.current = entry.run.id;
    setRunOpen?.(entry.run.id, true);
  };
  const foldTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(foldTimer.current), []);
  const closeRun = (run: Run) => {
    if (folding) return;
    flight.current = null;
    if (reducedMotion) { setRunOpen?.(run.id, false); return; }
    setFolding(run.id);
    window.clearTimeout(foldTimer.current);
    foldTimer.current = window.setTimeout(() => {
      setRunOpen?.(run.id, false);
      setFolding(null);
      landed.current = { runId: run.id, at: performance.now() };
    }, FOLD_MS);
  };
  // The stack a run just folded into settles in, and comes into view if the fold scrolled it away.
  const landed = useRef<{ runId: string; at: number } | null>(null);
  useEffect(() => {
    const element = scrollElement;
    const container = containerRef.current;
    const just = landed.current;
    if (!just || !element || !container || performance.now() - just.at > 400) return;
    const stack = layout.entries.find((entry) => entry.kind === "stack" && entry.run.id === just.runId);
    if (!stack) return;
    const offset = container.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
    const top = offset + stack.y;
    if (top < element.scrollTop + 60) element.scrollTo({ top: Math.max(0, top - 96), behavior: reducedMotion ? "auto" : "smooth" });
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const runId = reveal.current;
    const container = containerRef.current;
    if (!runId || !scrollElement || !container) return;
    const shelf = layout.entries.find((entry) => entry.kind === "shelf" && entry.run.id === runId);
    if (!shelf) return;
    reveal.current = null;
    const offset = container.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop;
    const top = offset + shelf.y;
    const view = scrollElement.clientHeight;
    const visible = top > scrollElement.scrollTop + 40 && top < scrollElement.scrollTop + view * 0.55;
    if (!visible) scrollElement.scrollTo({ top: Math.max(0, top - Math.min(140, view * 0.18)), behavior: reducedMotion ? "auto" : "smooth" });
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened from somewhere else (zen, a phone sheet): bring the run's shelf into view.
  useEffect(() => {
    if (!focusRun || !scrollElement || !containerRef.current) return;
    const tray = layout.entries.find((entry) => (entry.kind === "shelf" || entry.kind === "stack") && entry.run.id === focusRun);
    if (!tray) return;
    const offset = containerRef.current.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop;
    scrollElement.scrollTo({ top: Math.max(0, offset + tray.y - 96), behavior: reducedMotion ? "auto" : "smooth" });
    onFocused?.();
  }, [focusRun, layout, scrollElement]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const visible = useMemo(
    () => layout.entries.filter((entry) => entry.y + entry.h >= range.start && entry.y <= range.end),
    [layout, range]
  );
  // Arrows follow time across whatever is shown: tiles and stacks, newest first.
  const order = useMemo(() => {
    const ids: string[] = [];
    for (const entry of layout.entries) if (entry.kind === "tile" || entry.kind === "stack") ids.push(entry.kind === "tile" ? entry.item.id : entry.run.id);
    const rank = new Map(items.map((item, index) => [item.id, index]));
    const at = (id: string) => rank.get(id) ?? rank.get(groups?.runs.find((run) => run.id === id)?.cover.id || "") ?? 0;
    return ids.sort((a, b) => at(a) - at(b));
  }, [groups, items, layout]);

  const now = performance.now();
  const flying = flight.current && now - flight.current.at < 700 ? flight.current : null;

  return (
    <section
      ref={containerRef}
      className={grouped ? "gallery virtual-gallery is-grouped" : "gallery virtual-gallery"}
      aria-label="Gallery"
      onPointerEnter={hold}
      onPointerLeave={release}
      onKeyDown={(event) => {
        // Tab walks the masonry column by column; arrows follow time instead:
        // right or down for older, left or up for newer.
        if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
        const tile = (event.target as HTMLElement).closest<HTMLElement>("[data-tile-id]");
        if (!tile || (event.target as HTMLElement).closest(".tile-overlay")) return;
        const index = order.indexOf(tile.dataset.tileId || "");
        const next = order[index + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1)];
        const target = next ? document.querySelector<HTMLElement>(`[data-tile-id="${CSS.escape(next)}"] .tile, [data-tile-id="${CSS.escape(next)}"] .run-stack`) : null;
        if (!target) return;
        event.preventDefault();
        target.focus();
        target.scrollIntoView({ block: "nearest" });
      }}
      style={{ "--gallery-columns": safeColumns, "--gallery-gap": `${spacing}px` } as React.CSSProperties}
    >
      <div className="virtual-gallery-spacer" style={{ height: layout.total }}>
        {visible.map((entry) => {
          if (entry.kind === "moment") {
            return (
              <div key={entry.key} className={entry.first ? "virtual-gallery-moment is-first" : "virtual-gallery-moment"} style={{ width: entry.w, height: entry.h, transform: `translateY(${entry.y}px)` }}>
                <MomentHeading moment={entry.moment} />
              </div>
            );
          }
          if (entry.kind === "shelf") {
            return (
              <RunShelf
                key={entry.key}
                run={entry.run}
                y={entry.y}
                width={entry.w}
                height={entry.h}
                folding={folding === entry.run.id}
                arriving={Boolean(flying && flying.runId === entry.run.id)}
                onClose={() => closeRun(entry.run)}
                onUnstack={onUnstack ? () => onUnstack(entry.run) : undefined}
              />
            );
          }
          const ofRun = entry.kind === "stack" ? undefined : entry.run;
          const inFold = Boolean(ofRun && folding && ofRun.id === folding);
          const dealing = Boolean(ofRun && flying && ofRun.id === flying.runId);
          // Tiles deal out in the order they were made, and fold back the other way.
          const order = ofRun && entry.kind === "tile" ? ofRun.items.indexOf(entry.item) : 0;
          const step = Math.min(order, 12) * 0.028;
          return (
            <motion.div
              key={entry.key}
              className={cn(
                "virtual-gallery-cell",
                entry.kind === "stack" && "is-stack",
                entry.kind === "tile" && !ofRun && entry.w > (containerWidth / safeColumns) * 1.5 && "is-wide",
                ofRun && "in-run"
              )}
              style={{ left: 0, top: 0, width: entry.w, height: entry.h + spacing, transformOrigin: "50% 60%" }}
              initial={dealing && !reducedMotion
                ? { x: entry.x, y: entry.y + 22, scale: 0.94, opacity: 0 }
                : false}
              animate={inFold
                ? { x: entry.x, y: entry.y + 14, scale: 0.95, opacity: 0 }
                : { x: entry.x, y: entry.y, scale: 1, opacity: 1 }}
              transition={inFold
                ? { duration: 0.22, ease: [0.4, 0, 1, 1], delay: Math.max(0, 0.08 - step / 3) }
                : dealing
                  ? { type: "spring", stiffness: 300, damping: 30, mass: 0.9, delay: 0.06 + step, opacity: { duration: 0.32, ease: [0.16, 1, 0.3, 1], delay: 0.06 + step } }
                  : glide}
            >
              {entry.kind === "stack" ? (
                <RunStack
                  variant={stackStyle}
                  run={entry.run}
                  width={entry.w}
                  height={entry.h}
                  arriving={Boolean(landed.current && landed.current.runId === entry.run.id && now - landed.current.at < 400)}
                  onOpen={() => openStack(entry)}
                  titleFromPrompt={titleFromPrompt}
                />
              ) : (
                <GalleryTile
                  cancelJob={cancelJob}
                  copyPromptAndToast={copyPromptAndToast}
                  deleteItem={deleteItem}
                  formatElapsed={formatElapsed}
                  height={entry.h}
                  item={entry.item}
                  openItem={openItem}
                  smartUpscale={smartUpscale}
                  upscaleBusy={Boolean(upscaleBusyIds?.has(entry.item.id))}
                  onUpscale={onUpscale}
                  onCancelUpscale={onCancelUpscale}
                  upscaleNotice={upscaleNotices?.get(entry.item.id)}
                  onDismissUpscaleNotice={onDismissUpscaleNotice}
                  titleFromPrompt={titleFromPrompt}
                  width={entry.w}
                />
              )}
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

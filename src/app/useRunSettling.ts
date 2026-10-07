import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runTitle, type GalleryGroups, type Run } from './runs';
import type { ShowToast } from './toast';

/** A run folds into a stack once it has had nothing new for this long. */
export const SETTLE_MS = 5 * 60 * 1000;
/** How often runs are looked at again, besides scrolling and new results. */
const CHECK_MS = 20_000;

/** Something is generating into it, or its newest output is too recent. */
export function runIsActive(run: Run, now = Date.now()) {
  return run.live || now - run.end < SETTLE_MS;
}

/** Whether any of the run's tiles is on screen right now. */
function onScreen(run: Run) {
  const height = window.innerHeight;
  return run.items.some((item) => {
    // A gallery tile, or the same output in zen's strip.
    const tile = document.querySelector(`[data-tile-id="${CSS.escape(item.id)}"], [data-zen-id="${CSS.escape(item.id)}"]`);
    if (!tile) return false;
    const box = tile.getBoundingClientRect();
    return box.bottom > 0 && box.top < height && box.width > 0;
  });
}

/**
 * Runs settle; they don't snap. While a run is being worked on (something is
 * generating into it, or its newest output is under SETTLE_MS old) its
 * outputs are ordinary tiles, exactly as with stacking off, and a new take
 * joining a run starts its clock again. Once quiet, it folds into a stack,
 * but only while none of it is on screen, so nobody watches a fold they
 * didn't ask for, and a toast says so with Undo. Runs that were already quiet
 * when first seen (opening the app, Hidden, a page further down) are simply
 * stacked.
 *
 * Returns the groups with only the settled runs in them: everything else is
 * laid out as plain tiles.
 */
export function useRunSettling(groups: GalleryGroups, { enabled, showToast }: { enabled: boolean; showToast: ShowToast }) {
  const [settled, setSettled] = useState<Set<string>>(() => new Set());
  // Undone folds stay loose for this session.
  const held = useRef<Set<string>>(new Set());
  const seen = useRef<Set<string>>(new Set());
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  // The decision is made here, once, and only the result goes into state:
  // React may run a state updater twice, and this one has things to remember.
  const settledRef = useRef(settled);
  settledRef.current = settled;
  const check = useCallback(() => {
    if (!enabled) return;
    const now = Date.now();
    const previous = settledRef.current;
    let next = previous;
    const change = () => { if (next === previous) next = new Set(previous); return next; };
    const folded: Run[] = [];
    for (const run of groupsRef.current.runs) {
      const firstSight = !seen.current.has(run.id);
      seen.current.add(run.id);
      if (runIsActive(run, now)) {
        // A new take joined: the run is loose again until it goes quiet.
        if (next.has(run.id)) change().delete(run.id);
        continue;
      }
      if (next.has(run.id) || held.current.has(run.id)) continue;
      if (firstSight) { change().add(run.id); continue; }
      if (onScreen(run)) continue;
      change().add(run.id);
      folded.push(run);
    }
    if (next === previous) return;
    settledRef.current = next;
    setSettled(next);
    if (!folded.length) return;
    showToast(folded.length === 1 ? "Folded a run" : `Folded ${folded.length} runs`, "default", {
      description: folded.length === 1 ? runTitle(folded[0]) : folded.map(runTitle).slice(0, 3).join(" · "),
      action: {
        label: "Undo",
        onClick: () => {
          for (const run of folded) held.current.add(run.id);
          const restored = new Set(settledRef.current);
          for (const run of folded) restored.delete(run.id);
          settledRef.current = restored;
          setSettled(restored);
        }
      }
    });
  }, [enabled, showToast]);

  // On every regroup (a result landing, a take joining), on a timer, and as
  // the gallery scrolls, since scrolling is what takes a quiet run off screen.
  // The timer and scrolling call check() directly: it only sets state when a
  // run actually folds, so scrolling doesn't re-render (and re-lay out) the
  // gallery twice a second.
  useEffect(() => { check(); }, [groups, check]);
  const checkRef = useRef(check);
  checkRef.current = check;
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => checkRef.current(), CHECK_MS);
    let last = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - last < 600) return;
      last = now;
      checkRef.current();
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [enabled]);

  const lastVisible = useRef<{ groups: GalleryGroups; runs: Run[]; value: GalleryGroups } | null>(null);
  const visible = useMemo(() => {
    if (!enabled) return groups;
    const now = Date.now();
    // A quiet run seen for the first time (opening the app, Hidden, the next
    // page) is stacked in this very render, as check() is about to decide, so
    // it never shows loose for a frame and then jumps into its stack.
    const runs = groups.runs.filter((run) => !runIsActive(run, now) && (settled.has(run.id) || (!seen.current.has(run.id) && !held.current.has(run.id))));
    if (runs.length === groups.runs.length) return groups;
    // The same runs kept from the same groups as last time: the same answer.
    const last = lastVisible.current;
    if (last && last.groups === groups && last.runs.length === runs.length && last.runs.every((run, index) => run === runs[index])) return last.value;
    const keep = new Set(runs);
    const runOf = new Map(groups.runOf);
    for (const run of groups.runs) {
      if (keep.has(run)) continue;
      for (const item of run.items) runOf.delete(item.id);
    }
    const value = { ...groups, runs, runOf };
    lastVisible.current = { groups, runs, value };
    return value;
  }, [enabled, groups, settled]);

  return { groups: visible, settleVersion: settled };
}

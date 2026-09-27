import { useEffect, useRef, useSyncExternalStore } from "react";

/** Whether the tab is in the background, as a value that re-renders when it changes. */
export function usePageHidden() {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener("visibilitychange", onChange);
      return () => document.removeEventListener("visibilitychange", onChange);
    },
    () => document.hidden,
    () => false
  );
}

/**
 * Calls `onDone` once `ms` of unpaused time has passed. Pausing keeps what is
 * left rather than starting over; a new `resetKey` starts the full time again.
 * `ms` of null (or Infinity) never fires.
 */
export function usePausableTimeout(ms: number | null, onDone: () => void, paused: boolean, resetKey: unknown) {
  const latest = useRef(onDone);
  latest.current = onDone;
  const remaining = useRef(ms ?? Infinity);

  // Declared first, so on a reset it runs after the timer below has banked its time.
  useEffect(() => { remaining.current = ms ?? Infinity; }, [ms, resetKey]);
  useEffect(() => {
    if (paused || ms === null || !Number.isFinite(ms)) return;
    const started = Date.now();
    const timer = window.setTimeout(() => latest.current(), Math.max(0, remaining.current));
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, ms, resetKey]);
}

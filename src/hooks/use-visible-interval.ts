import { useEffect, useRef } from "react";

/**
 * Runs `callback` every `ms` while the tab is visible. A background tab stops
 * polling, and runs it once as soon as it is shown again, so it catches up at once.
 */
export function useVisibleInterval(callback: () => unknown, ms: number, enabled = true) {
  const latest = useRef(callback);
  latest.current = callback;

  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    const start = () => {
      window.clearInterval(timer);
      if (!document.hidden) timer = window.setInterval(() => latest.current(), ms);
    };
    const onVisibility = () => {
      if (!document.hidden) latest.current();
      start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms, enabled]);
}

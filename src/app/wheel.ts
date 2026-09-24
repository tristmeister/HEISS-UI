import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * Wheel deltas in CSS pixels. Firefox and some Windows drivers report lines
 * (deltaMode 1) or pages (deltaMode 2) instead, which would otherwise read as
 * a 3 px nudge.
 */
export function wheelPixels(event: WheelEvent, pageSize = window.innerHeight) {
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageSize : 1;
  return { x: event.deltaX * scale, y: event.deltaY * scale };
}

/**
 * Lets a plain vertical wheel scroll a sideways strip (Windows mice have no
 * horizontal wheel). Only takes over while the strip can actually move that
 * way, so at either end the page scrolls as usual. Needs a non-passive
 * listener: use it through useHorizontalWheel or useWheelRef.
 */
export function scrollSideways(event: WheelEvent, element: HTMLElement) {
  if (event.ctrlKey) return;
  const { x, y } = wheelPixels(event, element.clientWidth);
  if (y === 0 || Math.abs(x) >= Math.abs(y)) return;
  const maxScroll = element.scrollWidth - element.clientWidth;
  if (maxScroll <= 1) return;
  if ((y < 0 && element.scrollLeft <= 0) || (y > 0 && element.scrollLeft >= maxScroll - 1)) return;
  event.preventDefault();
  element.scrollLeft += y;
}

/** scrollSideways on an element held in an object ref; `enabled` re-attaches when it mounts. */
export function useHorizontalWheel(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    const onWheel = (event: WheelEvent) => scrollSideways(event, element);
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [ref, enabled]);
}

/**
 * A callback ref that attaches a non-passive wheel listener, so the handler
 * can preventDefault (React's onWheel can't, and Ctrl+wheel would zoom the
 * page). The latest handler always runs; the listener is attached once.
 */
export function useWheelRef<T extends HTMLElement>(handler: (event: WheelEvent, element: T) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  return useCallback((element: T | null) => {
    if (!element) return;
    const listener = (event: WheelEvent) => handlerRef.current(event, element);
    element.addEventListener('wheel', listener, { passive: false });
    return () => element.removeEventListener('wheel', listener);
  }, []);
}

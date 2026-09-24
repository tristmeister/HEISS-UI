import { useEffect, useRef } from 'react';

/**
 * Lets the browser's Back button (and Android's back gesture) close an overlay
 * instead of leaving the app. Each open overlay pushes one history entry; Back
 * pops the topmost overlay only. Closing an overlay any other way takes its
 * entry back out, so history never fills up with stale steps.
 */

type Entry = { id: number; close: () => void };

const stack: Entry[] = [];
let nextId = 1;
let ignoreNextPop = 0;
let listening = false;

function onPopState() {
  if (ignoreNextPop > 0) {
    ignoreNextPop -= 1;
    return;
  }
  const top = stack.pop();
  top?.close();
}

export function useHistoryDismiss(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    if (!listening) {
      window.addEventListener('popstate', onPopState);
      listening = true;
    }
    const entry: Entry = { id: nextId++, close: () => closeRef.current() };
    stack.push(entry);
    window.history.pushState({ ...(window.history.state || {}), heissOverlay: entry.id }, '');
    return () => {
      const index = stack.indexOf(entry);
      if (index < 0) return; // Already popped by Back.
      const wasTop = index === stack.length - 1;
      stack.splice(index, 1);
      // Only the topmost entry can be rewound cleanly; one buried under another
      // overlay stays behind as a harmless no-op step.
      if (wasTop && window.history.state?.heissOverlay === entry.id) {
        ignoreNextPop += 1;
        window.history.back();
      }
    };
  }, [open]);
}

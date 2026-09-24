import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary';

/**
 * For overlays that are not rendered through the shared Modal (the viewer):
 * focus moves in when it opens, Tab stays inside, and focus returns to
 * whatever opened it when it closes.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    if (!root) return;
    if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((node) => node.offsetParent !== null || node === document.activeElement);
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !root) return;
      // A dialog opened on top (a delete confirmation) manages its own focus.
      if (document.querySelector('[role="alertdialog"], [role="dialog"]:not([data-focus-trap])')) return;
      const items = focusables();
      if (!items.length) { event.preventDefault(); root.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || current === root || !root.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !root.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, ref]);
}

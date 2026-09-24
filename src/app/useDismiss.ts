import { useEffect, type RefObject } from 'react';

type Refs = RefObject<HTMLElement | null> | Array<RefObject<HTMLElement | null>>;

/**
 * Shared dismiss behaviour for inline menus and popovers: a pointer down outside
 * `ref` (or any of several refs, for a surface portaled elsewhere) or Escape
 * closes it. Escape is swallowed so it never also exits zen, closes the viewer
 * or leaves a modal the menu lives in.
 */
export function useDismiss(refs: Refs, open: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!open) return;
    const list = Array.isArray(refs) ? refs : [refs];
    const inside = (node: Node | null) => Boolean(node && list.some((ref) => ref.current?.contains(node)));
    const owns = (dialog: Element) => list.some((ref) => ref.current && (ref.current.contains(dialog) || dialog.contains(ref.current)));
    // A dialog opened from inside the surface (say, a delete confirmation) is
    // part of it: clicks and Escape there belong to the dialog.
    const inForeignDialog = (target: EventTarget | null) => {
      const dialog = target instanceof Element ? target.closest('[role="dialog"], [role="alertdialog"]') : null;
      return Boolean(dialog && !owns(dialog));
    };
    const dialogOpen = () => Array.from(document.querySelectorAll('[role="dialog"]:not([data-focus-trap]), [role="alertdialog"]')).some((dialog) => !owns(dialog));
    function onPointerDown(event: PointerEvent) {
      if (inForeignDialog(event.target)) return;
      if (!inside(event.target as Node)) onDismiss();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || dialogOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    }
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onDismiss, ...(Array.isArray(refs) ? refs : [refs])]);
}

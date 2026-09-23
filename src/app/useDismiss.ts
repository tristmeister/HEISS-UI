import { useEffect, type RefObject } from 'react';

/**
 * Shared dismiss behaviour for inline menus and popovers: a pointer down outside
 * `ref` or Escape closes it. Escape is swallowed so it never also exits zen,
 * closes the viewer or leaves a modal the menu lives in.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!open) return;
    // A dialog opened from inside the surface (say, a delete confirmation) is
    // part of it: clicks and Escape there belong to the dialog.
    const inForeignDialog = (target: EventTarget | null) => {
      const dialog = target instanceof Element ? target.closest('[role="dialog"], [role="alertdialog"]') : null;
      return Boolean(dialog && !dialog.contains(ref.current) && !ref.current?.contains(dialog));
    };
    const dialogOpen = () => Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).some((dialog) => !ref.current?.contains(dialog) && !dialog.contains(ref.current));
    function onPointerDown(event: PointerEvent) {
      if (inForeignDialog(event.target)) return;
      if (!ref.current?.contains(event.target as Node)) onDismiss();
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
  }, [open, onDismiss, ref]);
}

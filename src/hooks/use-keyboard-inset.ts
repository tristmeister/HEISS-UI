import { useEffect } from 'react';

/**
 * Publishes how much of the layout viewport the on-screen keyboard covers as
 * --kb-inset on <html>, and toggles .kb-open while it is up.
 *
 * Android Chrome resizes the layout viewport itself (interactive-widget=
 * resizes-content in index.html), so the inset stays 0 there. iOS Safari only
 * shrinks the visual viewport and leaves position: fixed elements under the
 * keyboard; the composer lifts by this inset to stay in view.
 */
export function useKeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const inset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
        // Browser chrome sliding in and out moves this by a few dozen pixels;
        // only a keyboard-sized gap counts.
        const open = inset > 120;
        root.style.setProperty('--kb-inset', `${open ? inset : 0}px`);
        root.classList.toggle('kb-open', open);
      });
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      root.style.removeProperty('--kb-inset');
      root.classList.remove('kb-open');
    };
  }, []);
}

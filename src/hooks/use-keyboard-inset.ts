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
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    // iOS reports the screen in portrait whichever way it is held.
    const screenHeight = () => window.innerWidth > window.innerHeight
      ? Math.min(window.screen.width, window.screen.height)
      : Math.max(window.screen.width, window.screen.height);
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
        // A Home Screen app drawn under the status bar (black-translucent) gets a
        // window one status bar shorter than the screen, so whatever is pinned to
        // the bottom ends that far up over a black strip. --pwa-gap is that strip,
        // for the phone layout to reach down over; --pwa-drop is the same but 0
        // while the keyboard is up, which is what sheets sit on then.
        const gap = standalone ? Math.max(0, Math.min(80, Math.round(screenHeight() - window.innerHeight))) : 0;
        root.style.setProperty('--pwa-gap', `${gap}px`);
        root.style.setProperty('--pwa-drop', `${open ? 0 : gap}px`);
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
      root.style.removeProperty('--pwa-gap');
      root.style.removeProperty('--pwa-drop');
      root.classList.remove('kb-open');
    };
  }, []);
}

import { useEffect, useState } from 'react';

const query = '(min-resolution: 2dppx)';
const dense = () => typeof window !== 'undefined' && (window.matchMedia?.(query).matches ?? window.devicePixelRatio >= 2);

/**
 * The gap between cells in the pixel glyphs (toasts, the update and upscale
 * arrows, the plug). On a 2x screen a gap of a tenth of a cell is a clean
 * line of dark; on a 1x or 1.25x one (most Windows screens) it is thinner than
 * a pixel and blurs into a faint grid across the glyph. There the cells touch.
 * Follows the window between screens.
 */
export function useCellGap(gap: number) {
  const [sharp, setSharp] = useState(dense);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setSharp(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return sharp ? gap : 0;
}

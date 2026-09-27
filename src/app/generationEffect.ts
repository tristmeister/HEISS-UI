export const GENERATION_PIXEL_SCALE = 1.4;

/** img-fx pixels-organic grid: cellSize .22, 320 CSS-pixel reference edge. */
export function generationGridCount(cssSize: number) {
  return Math.max(2, Math.floor(((6 + 0.22 * 74) / GENERATION_PIXEL_SCALE) * cssSize / 320));
}

/** Invert img-fx 0.5.x's internal 0.6%-per-edge cover overscan.
 * The native reveal crops this padding away, leaving exactly the same view as
 * the final <img object-fit="cover">. No permanent zoom or dependency patch.
 */
export function createRevealBitmap(image: HTMLImageElement, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Reveal bitmap context unavailable');
  const frameRatio = canvas.width / canvas.height;
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const sw = imageRatio > frameRatio ? image.naturalHeight * frameRatio : image.naturalWidth;
  const sh = imageRatio > frameRatio ? image.naturalHeight : image.naturalWidth / frameRatio;
  const sx = (image.naturalWidth - sw) / 2;
  const sy = (image.naturalHeight - sh) / 2;
  const inset = Math.min(canvas.width, canvas.height) * 0.006;
  context.imageSmoothingQuality = 'high';
  // Fill the sacrificial border as well, avoiding transparent edge sampling.
  context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  context.drawImage(image, sx, sy, sw, sh, inset, inset, canvas.width - inset * 2, canvas.height - inset * 2);
  return canvas;
}

/**
 * Whether the finished image resolves through img-fx (WebGL) or the 2D reveal.
 *
 * On Windows, starting img-fx the moment an image finished took down the
 * whole browser: its shared three.js renderer asks for the high-performance
 * GPU, compiles one large shader for every effect and copies the GL canvas
 * into 2D canvases each frame, and the GPU process died doing it (not
 * reproducible on macOS). Windows never starts it now.
 *
 * Elsewhere a breadcrumb is set while img-fx runs and cleared on pagehide. A
 * page load that still finds it means the browser went down mid-mosaic, so
 * this browser keeps to the 2D reveal (delete MOSAIC_CRASH_KEY to retry).
 */
export const MOSAIC_CRASH_KEY = 'heiss.generationMosaic.crashed';
const MOSAIC_RUNNING_KEY = 'heiss.generationMosaic.running';

export function webglMosaicAllowed() {
  if (typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)) return false;
  try {
    if (localStorage.getItem(MOSAIC_RUNNING_KEY)) {
      localStorage.removeItem(MOSAIC_RUNNING_KEY);
      localStorage.setItem(MOSAIC_CRASH_KEY, new Date().toISOString());
      console.warn('The browser went down while the WebGL generation mosaic ran; using the 2D reveal from now on.');
    }
    return !localStorage.getItem(MOSAIC_CRASH_KEY);
  } catch {
    return true;
  }
}

let mosaicsRunning = 0;
const clearRunning = () => {
  try { localStorage.removeItem(MOSAIC_RUNNING_KEY); } catch { /* storage off */ }
};
const markRunning = () => {
  try { localStorage.setItem(MOSAIC_RUNNING_KEY, '1'); } catch { /* storage off */ }
};

/** An effect: marks img-fx as running until every mosaic unmounts. */
export function markMosaicRunning() {
  if (!mosaicsRunning++) {
    markRunning();
    window.addEventListener('pagehide', clearRunning);
    // A page restored from the back/forward cache runs its mosaics again.
    window.addEventListener('pageshow', markRunning);
  }
  return () => {
    if (--mosaicsRunning) return;
    clearRunning();
    window.removeEventListener('pagehide', clearRunning);
    window.removeEventListener('pageshow', markRunning);
  };
}

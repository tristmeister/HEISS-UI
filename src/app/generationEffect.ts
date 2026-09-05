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

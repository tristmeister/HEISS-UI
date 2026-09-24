/**
 * Tracks a canvas's backing size in whole device pixels. clientWidth and
 * clientHeight are rounded to CSS pixels, so at 125% / 150% display scaling a
 * canvas sized from them ends up a pixel off its box and gets resampled soft.
 * ResizeObserver reports the exact device-pixel box where the browser supports
 * it (Chromium), otherwise the fractional CSS box, which we round here.
 */
export function trackCanvasSize(canvas: HTMLCanvasElement, maxDpr: number, onResize?: () => void) {
  const nativeDpr = window.devicePixelRatio || 1;
  const dpr = Math.min(nativeDpr, maxDpr);
  const size = {
    width: Math.round(canvas.clientWidth * dpr),
    height: Math.round(canvas.clientHeight * dpr),
  };
  const observer = new ResizeObserver(([entry]) => {
    // The device-pixel box is only right when the DPR isn't capped.
    const box = dpr === nativeDpr ? entry.devicePixelContentBoxSize?.[0] : undefined;
    size.width = box ? box.inlineSize : Math.round(entry.contentRect.width * dpr);
    size.height = box ? box.blockSize : Math.round(entry.contentRect.height * dpr);
    onResize?.();
  });
  try {
    observer.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(canvas);
  }
  return { dpr, size, disconnect: () => observer.disconnect() };
}

/**
 * Touch zoom, pan and swipe for the viewer, worked on the page directly: a
 * gesture writes --zoom and --pan-x/y onto the canvas every frame without a
 * React render, and hands the resting place to state when the fingers lift.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

export type Pan = { x: number; y: number };

/** Where the zoomed element sits at rest, how big its picture is, and the room it has. */
export type ViewerGeometry = {
  /** Centre of the transformed element at zoom 1, pan 0, in client pixels. */
  cx: number;
  cy: number;
  /** The picture's drawn size at zoom 1 (object-fit: contain, so not the element's box). */
  w: number;
  h: number;
  /** The canvas: what the picture may cover. */
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** The element the CSS transform lands on: the generation surface, or the bare media. */
function transformed(canvas: HTMLElement) {
  return canvas.querySelector<HTMLElement>(".generation-surface") || canvas.querySelector<HTMLElement>("img, video");
}

function matrixOf(element: HTMLElement) {
  const value = getComputedStyle(element).transform;
  return value && value !== "none" ? new DOMMatrixReadOnly(value) : new DOMMatrixReadOnly();
}

/** The zoom and pan actually on screen, mid-animation included. */
export function liveTransform(canvas: HTMLElement, fallback: { zoom: number; pan: Pan }) {
  const element = transformed(canvas);
  if (!element) return fallback;
  const matrix = matrixOf(element);
  return { zoom: matrix.a || fallback.zoom, pan: { x: matrix.e, y: matrix.f } };
}

/**
 * Measured from what is drawn. The canvas pads more below (the dock) than
 * above, so the picture's centre is not the canvas's: zooming about the
 * canvas's centre is what made a pinch drift. Scaling about its own centre
 * leaves that centre where it was, so taking the translation off the drawn box
 * gives the resting centre whatever the current zoom.
 */
export function measureViewer(canvas: HTMLElement): ViewerGeometry | null {
  const element = transformed(canvas);
  if (!element) return null;
  const box = element.getBoundingClientRect();
  const matrix = matrixOf(element);
  const cx = box.left + box.width / 2 - matrix.e;
  const cy = box.top + box.height / 2 - matrix.f;
  const boxW = element.offsetWidth || box.width;
  const boxH = element.offsetHeight || box.height;
  const media = (element.matches("img, video") ? element : element.querySelector("img, video")) as HTMLImageElement | HTMLVideoElement | null;
  const naturalW = media instanceof HTMLImageElement ? media.naturalWidth : media instanceof HTMLVideoElement ? media.videoWidth : 0;
  const naturalH = media instanceof HTMLImageElement ? media.naturalHeight : media instanceof HTMLVideoElement ? media.videoHeight : 0;
  const fit = naturalW && naturalH ? Math.min(boxW / naturalW, boxH / naturalH) : 0;
  const frame = canvas.getBoundingClientRect();
  return {
    cx, cy,
    w: fit ? naturalW * fit : boxW,
    h: fit ? naturalH * fit : boxH,
    left: frame.left, top: frame.top, right: frame.right, bottom: frame.bottom
  };
}

/**
 * The pans that keep the picture in view: larger than the canvas, it can't
 * leave a gap at an edge; smaller, it can't leave the canvas. The two meet
 * when the picture just fits, so the limit never jumps as the zoom changes.
 */
export function panBounds(geometry: ViewerGeometry, zoom: number) {
  const axis = (low: number, high: number, size: number, centre: number) => {
    const a = low + size / 2 - centre;
    const b = high - size / 2 - centre;
    return [Math.min(a, b), Math.max(a, b)] as const;
  };
  const [minX, maxX] = axis(geometry.left, geometry.right, geometry.w * zoom, geometry.cx);
  const [minY, maxY] = axis(geometry.top, geometry.bottom, geometry.h * zoom, geometry.cy);
  return { minX, maxX, minY, maxY };
}

export function clampPan(geometry: ViewerGeometry | null, zoom: number, pan: Pan): Pan {
  if (zoom <= MIN_ZOOM) return { x: 0, y: 0 };
  if (!geometry) return pan;
  const { minX, maxX, minY, maxY } = panBounds(geometry, zoom);
  return { x: Math.min(maxX, Math.max(minX, pan.x)), y: Math.min(maxY, Math.max(minY, pan.y)) };
}

/** Past a limit the value still moves, ever less, as a sheet of rubber would. */
export function rubber(value: number, min: number, max: number, reach = 140) {
  if (value < min) return min - reach * (1 - 1 / ((min - value) / reach * 0.55 + 1));
  if (value > max) return max + reach * (1 - 1 / ((value - max) / reach * 0.55 + 1));
  return value;
}

export function rubberPan(geometry: ViewerGeometry | null, zoom: number, pan: Pan): Pan {
  if (!geometry || zoom < MIN_ZOOM) return pan;
  const { minX, maxX, minY, maxY } = panBounds(geometry, zoom);
  return { x: rubber(pan.x, minX, maxX), y: rubber(pan.y, minY, maxY) };
}

/** Pinching past 100% or 600% gives way less and less, in proportion. */
export function rubberZoom(raw: number) {
  if (raw < MIN_ZOOM) return MIN_ZOOM * Math.pow(raw / MIN_ZOOM, 0.4);
  if (raw > MAX_ZOOM) return MAX_ZOOM * Math.pow(raw / MAX_ZOOM, 0.3);
  return raw;
}

/**
 * The pan that keeps the picture point that was under `from` (at startZoom,
 * startPan) under `to` at `zoom`. With `to` following the fingers' midpoint,
 * a pinch pans as well as zooms, as in Photos.
 */
export function anchoredPan(geometry: ViewerGeometry, zoom: number, startZoom: number, startPan: Pan, from: Pan, to: Pan): Pan {
  const ratio = zoom / Math.max(startZoom, 0.01);
  return {
    x: to.x - geometry.cx - (from.x - geometry.cx - startPan.x) * ratio,
    y: to.y - geometry.cy - (from.y - geometry.cy - startPan.y) * ratio
  };
}

const settleTimers = new WeakMap<HTMLElement, number>();

/**
 * Writes the transform straight onto the canvas. React leaves attributes it
 * doesn't own alone, so data-gesture (no transition) and data-settle (the
 * spring back) survive any render in between.
 */
export function paint(canvas: HTMLElement, zoom: number, pan: Pan, motion: "none" | "settle" | "slide" = "none") {
  window.clearTimeout(settleTimers.get(canvas));
  if (motion === "none") {
    delete canvas.dataset.settle;
    canvas.dataset.gesture = "";
  } else {
    delete canvas.dataset.gesture;
    canvas.dataset.settle = motion;
    settleTimers.set(canvas, window.setTimeout(() => { delete canvas.dataset.settle; }, motion === "slide" ? 200 : 420));
  }
  canvas.style.setProperty("--zoom", String(zoom));
  canvas.style.setProperty("--pan-x", `${pan.x}px`);
  canvas.style.setProperty("--pan-y", `${pan.y}px`);
}

/** A finger's recent path, for how fast it was going when it let go. */
export class Velocity {
  private samples: Array<{ x: number; y: number; t: number }> = [];
  add(x: number, y: number) {
    const t = performance.now();
    this.samples.push({ x, y, t });
    while (this.samples.length > 2 && t - this.samples[0].t > 90) this.samples.shift();
  }
  /** Pixels per millisecond over the last ~90 ms; nothing if the finger had stopped. */
  read() {
    const last = this.samples.at(-1);
    const first = this.samples[0];
    if (!last || !first || last === first || performance.now() - last.t > 60) return { x: 0, y: 0 };
    const dt = Math.max(1, last.t - first.t);
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
  }
}

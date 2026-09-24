import React from 'react';
import { SCENE_CELL, ease, fillRects, useCellScene, type CellRect } from './cellScene';
import { OFFLINE_GRID } from './OfflineMark';

/**
 * The empty gallery: a blank pixel canvas in the same cell mosaic as the
 * offline plug. Every few seconds a picture develops in it the way a
 * generation does (a warm mosaic sweep that resolves into a sun over two
 * hills), holds for a moment, and fades back to blank: this is where your
 * first image appears.
 *
 * Same grid as the offline scene, so one can dissolve straight into the other.
 */

const CYCLE = 6.4;
const FRAME: CellRect = [20, 5, 20, 14];
const INNER = { x0: 21, y0: 6, x1: 38, y1: 17 };

function drawMask(ctx: CanvasRenderingContext2D) {
  const [x, y, w, h] = FRAME;
  // R: the canvas edge, rounded at the corners. G: its inside.
  fillRects(ctx, [[x + 1, y, w - 2, 1], [x + 1, y + h - 1, w - 2, 1], [x, y + 1, 1, h - 2], [x + w - 1, y + 1, 1, h - 2]], '#f00');
  fillRects(ctx, [[INNER.x0, INNER.y0, INNER.x1 - INNER.x0 + 1, INNER.y1 - INNER.y0 + 1]], '#0f0');
  // B: the picture. Full blue for the hills, half blue for the sun.
  const hill = (peakX: number, peakY: number) => {
    for (let row = peakY; row <= INNER.y1; row++) {
      const half = row - peakY;
      const from = Math.max(INNER.x0, peakX - half);
      const to = Math.min(INNER.x1, peakX + half);
      ctx.fillStyle = '#00f';
      ctx.fillRect(from, row, to - from + 1, 1);
    }
  };
  hill(26, 11);
  hill(34, 13);
  fillRects(ctx, [[33, 8, 3, 3]], '#000080');
  ctx.globalCompositeOperation = 'source-over';
  // Round the sun: its corners are sky.
  ctx.fillStyle = '#0f0';
  for (const [cx, cy] of [[33, 8], [35, 8], [33, 10], [35, 10]]) ctx.fillRect(cx, cy, 1, 1);
}

const FRAGMENT = `
  uniform float uSweep;   // 0..1: the developing front crossing the canvas
  uniform float uShown;   // 0..1: how much of the finished picture remains
  uniform float uGlow;    // the sun's pulse and the edge's warmth while it holds
  uniform float uTwinkle; // the corner sparkle

  void main() {
${SCENE_CELL}
    vec2 q = (cell + 0.5) / uGrid - 0.5;
    float vig = 1.0 - smoothstep(0.2, 0.6, length(q * vec2(1.0, 1.9)));
    vec3 m = sampleMask(cell);
    float edge = m.r;
    float inside = m.g;
    float hill = step(0.75, m.b);
    float sun = step(0.25, m.b) * (1.0 - hill);

    // Quiet mosaic behind everything, as in the offline scene.
    float n = fbm(cell * 0.11 + vec2(t * 0.04, -t * 0.02));
    vec3 col = vec3(0.5);
    float a = vig * step(0.45, h) * (0.03 + 0.14 * smoothstep(0.4, 0.8, n)) * (1.0 - inside);
    float v = chrome(cell / 18.0, t);

    if (edge > 0.5) {
      // The canvas edge: the same gray as the plug, warming a little while a picture holds.
      float shade = mix(0.5, 0.32, (cell.y - 5.0) / 13.0) + 0.08 * v;
      col = mix(vec3(shade), mix(vec3(1.0, 0.45, 0.18), vec3(1.0, 0.86, 0.66), v), uGlow * 0.35 * (0.5 + 0.5 * v));
      a = 1.0;
    } else if (inside > 0.5) {
      // Blank: a faint, slow breathing of cells, like an empty frame waiting.
      float idle = step(0.62, fbm(cell * 0.35 + vec2(0.0, t * 0.25))) * 0.12;
      col = vec3(0.42);
      a = idle;

      // The developing front sweeps left to right with a slight slant.
      float d = (cell.x - 21.0) / 18.0 + (cell.y - 6.0) / 12.0 * 0.25 - 0.1;
      float front = uSweep * 1.35 - 0.12;
      float behind = step(d, front - 0.1);
      float band = (1.0 - smoothstep(0.0, 0.13, abs(d - front))) * step(0.001, uSweep) * step(uSweep, 0.999);
      // At the front: a flickering warm mosaic, like a preview mid-generation.
      float flicker = step(0.35, hash(id + floor(t * 18.0)));
      vec3 noiseC = fire(0.25 + 0.5 * hash(id + floor(t * 9.0)));
      col = mix(col, noiseC, band * flicker);
      a = max(a, band * flicker * 0.9);

      // Behind it: the finished picture, fading out again cell by cell.
      float keep = step(hash(id * 1.3 + 7.0), uShown);
      float pic = behind * keep;
      vec3 sky = mix(vec3(0.16), vec3(0.24), (17.0 - cell.y) / 11.0);
      vec3 hillC = mix(vec3(0.46), vec3(0.72), v) * mix(1.0, 0.8, (cell.y - 11.0) / 6.0);
      vec3 sunC = fire(0.6 + 0.25 * uGlow + 0.1 * sin(t * 3.0 + h * 6.0));
      vec3 picC = hill > 0.5 ? hillC : sun > 0.5 ? sunC : sky;
      float picA = hill > 0.5 ? 1.0 : sun > 0.5 ? 1.0 : 0.55;
      col = mix(col, picC, pic);
      a = mix(a, picA, pic);
    }

    // A small four-point sparkle off the top-right corner.
    vec2 s = cell - vec2(41.0, 3.0);
    float star = (step(abs(s.x), 0.1) * step(abs(s.y), 1.1) + step(abs(s.y), 0.1) * step(abs(s.x), 1.1));
    float core = step(abs(s.x), 0.1) * step(abs(s.y), 0.1);
    float sparkle = clamp(star, 0.0, 1.0) * uTwinkle * mix(0.55, 1.0, core);
    col = mix(col, fire(0.55 + 0.4 * core), sparkle);
    a = max(a, sparkle);

    a *= develop(cell, h);
    gl_FragColor = vec4(col * a * sq, a * sq);
  }
`;

/** Where the loop is at time t (seconds since the first picture may start). */
function picture(t: number) {
  const ph = t < 0 ? 0 : (t / CYCLE) % 1;
  const sweep = ease(0.18, 0.46, ph);
  return {
    uSweep: t < 0 ? 0 : sweep,
    uShown: 1 - ease(0.8, 0.97, ph),
    uGlow: ease(0.4, 0.5, ph) * (1 - ease(0.78, 0.92, ph)) * (0.8 + 0.2 * Math.sin(t * 3)),
    uTwinkle: Math.max(0, Math.sin(Math.min(1, Math.max(0, (ph - 0.46) / 0.12)) * Math.PI)),
  };
}

export function EmptyMark({ className }: { className?: string }) {
  const { canvasRef, failed } = useCellScene({
    ...OFFLINE_GRID,
    drawMask,
    fragment: FRAGMENT,
    frame: (t, reduce) => {
      // Reduced motion: the finished picture, still.
      if (reduce) return { uSweep: 1, uShown: 1, uGlow: 0.6, uTwinkle: 0, uReveal: 1 };
      const intro = 1 - Math.pow(1 - Math.min(1, Math.max(0, t / 0.9)), 3);
      return { ...picture(t - 0.9), uReveal: intro };
    },
  });

  if (failed) return <img className="offline-mark-fallback" src="/heiss-mark-black.svg" alt="" aria-hidden="true" />;
  return (
    <div className={className} style={{ aspectRatio: `${OFFLINE_GRID.width} / ${OFFLINE_GRID.height}` }} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}

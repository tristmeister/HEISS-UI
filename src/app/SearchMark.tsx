import React from 'react';
import { SCENE_CELL, ease, useCellScene } from './cellScene';
import { OFFLINE_GRID } from './OfflineMark';

/**
 * The empty search state: a pixel magnifier in the same cell mosaic and grid
 * as the offline plug and the empty canvas. The lens is empty and a faint warm
 * line sweeps across it now and then, looking and finding nothing. With
 * `star` (no favourites yet) a star sits in the lens instead, warming slowly.
 */

const CYCLE = 5.2;
const CENTER: [number, number] = [28, 10];
const STAR = [[2, 0, 1], [1, 1, 3], [0, 2, 5], [1, 3, 3], [1, 4, 1], [3, 4, 1]];

function drawMask(star: boolean) {
  return (ctx: CanvasRenderingContext2D) => {
    const [cx, cy] = CENTER;
    for (let y = 2; y < 19; y++) {
      for (let x = 20; x < 37; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        // R: the rim. G (half): the lens.
        if (d <= 7 && d > 5.3) { ctx.fillStyle = '#f00'; ctx.fillRect(x, y, 1, 1); }
        else if (d <= 5.3) { ctx.fillStyle = '#008000'; ctx.fillRect(x, y, 1, 1); }
      }
    }
    // B: the handle, a diagonal two cells thick.
    ctx.fillStyle = '#00f';
    for (let k = 0; k < 6; k++) ctx.fillRect(32 + k, 14 + k, 2, 2);
    // The star, when asked, lifts the lens cells it covers to full green.
    if (star) {
      ctx.fillStyle = '#008000';
      for (const [dx, dy, w] of STAR) ctx.fillRect(cx - 2 + dx, cy - 2 + dy, w, 1);
    }
  };
}

const FRAGMENT = `
  uniform float uScan;  // the sweep's column, or far off the grid
  uniform float uGlow;  // 0..1: the star's warmth

  void main() {
${SCENE_CELL}
    vec2 q = (cell + 0.5) / uGrid - 0.5;
    float vig = 1.0 - smoothstep(0.2, 0.6, length(q * vec2(1.0, 1.9)));
    vec3 m = sampleMask(cell);
    float rim = m.r;
    float lens = step(0.25, m.g);
    float star = step(0.75, m.g);
    float handle = m.b * (1.0 - rim);

    // Quiet mosaic behind everything, as in the offline and empty scenes.
    float n = fbm(cell * 0.11 + vec2(t * 0.04, -t * 0.02));
    vec3 col = vec3(0.5);
    float a = vig * step(0.45, h) * (0.03 + 0.14 * smoothstep(0.4, 0.8, n)) * (1.0 - lens);
    float v = chrome(cell / 18.0, t);

    if (rim > 0.5 || handle > 0.5) {
      // The same brushed gray as the plug, lit from the top left.
      float shade = mix(0.56, 0.32, (cell.y - 3.0) / 17.0) + 0.08 * v;
      shade += 0.07 * (1.0 - smoothstep(0.0, 4.0, cell.x - 21.0 + (cell.y - 3.0) * 0.5)) * rim;
      col = vec3(shade);
      a = 1.0;
    } else if (lens > 0.5) {
      // Empty glass: a faint breathing of cells, a warm line looking across it.
      float idle = step(0.62, fbm(cell * 0.35 + vec2(0.0, t * 0.25))) * 0.12;
      col = vec3(0.42);
      a = idle;
      float k = exp(-pow((cell.x - uScan) / 0.9, 2.0));
      float flicker = step(0.3, hash(id + floor(t * 14.0)));
      col = mix(col, fire(0.3 + 0.45 * hash(id + floor(t * 9.0))), k * flicker);
      a = max(a, k * flicker * 0.8);
      if (star > 0.5) {
        col = mix(vec3(0.5 + 0.1 * v), fire(0.5 + 0.25 * uGlow + 0.1 * sin(t * 3.0 + h * 6.0)), uGlow);
        a = 1.0;
      }
    }

    a *= develop(cell, h);
    gl_FragColor = vec4(col * a * sq, a * sq);
  }
`;

export function SearchMark({ star = false, className }: { star?: boolean; className?: string }) {
  const { canvasRef, failed } = useCellScene({
    ...OFFLINE_GRID,
    drawMask: drawMask(star),
    fragment: FRAGMENT,
    frame: (t, reduce) => {
      const intro = reduce ? 1 : 1 - Math.pow(1 - Math.min(1, t / 0.9), 3);
      if (reduce) return { uReveal: 1, uScan: -99, uGlow: star ? 0.6 : 0 };
      const ph = (t % CYCLE) / CYCLE;
      return {
        uReveal: intro,
        uScan: ph > 0.25 && ph < 0.65 ? 22 + ease(0.25, 0.65, ph) * 13 : -99,
        uGlow: star ? 0.45 + 0.25 * Math.sin(t * 1.6) : 0,
      };
    },
  });

  if (failed) return <img className="offline-mark-fallback" src="/heiss-mark-black.svg" alt="" aria-hidden="true" />;
  return (
    <div className={className} style={{ aspectRatio: `${OFFLINE_GRID.width} / ${OFFLINE_GRID.height}` }} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}

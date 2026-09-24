import React from 'react';
import { SCENE_CELL, ease, fillRects, useCellScene, type CellRect } from './cellScene';

/**
 * The offline empty state: a pixel plug (HEISS) and socket (ComfyUI) in the
 * same gray cell mosaic as the About wordmark. A warm pulse runs down the
 * HEISS cable, the plug reaches for the socket, a spark tries to jump the gap
 * and dies into a few embers. Then it tries again.
 *
 * Given `connectedAt`, it plays the other ending instead: the plug snaps in,
 * the contact flashes, the cold socket warms up and a pulse runs down the
 * ComfyUI cable, then the whole scene dissolves back into the mosaic
 * (CONNECT_MS). The caller drives what comes next on its own timer, so a
 * canvas that never draws cannot hold the app up.
 */

export const OFFLINE_GRID = { width: 60, height: 24 };
const TIP = 26;   // first cell past the prongs
const FACE = 38;  // socket face
const CYCLE = 5.2;
/** How long the connect ending runs; the scene is gone after this. */
export const CONNECT_MS = 760;

// Cells, top-down. R = plug side, G = socket side, B = cable.
const PLUG: CellRect[] = [[12, 12, 2, 3], [14, 9, 8, 9], [22, 11, 4, 1], [22, 15, 4, 1]];
const PLUG_CUT: CellRect[] = [[14, 9, 1, 1], [21, 9, 1, 1], [14, 17, 1, 1], [21, 17, 1, 1]];
const SOCKET: CellRect[] = [[38, 9, 8, 9], [46, 12, 2, 3]];
const SOCKET_CUT: CellRect[] = [[38, 9, 1, 1], [45, 9, 1, 1], [38, 17, 1, 1], [45, 17, 1, 1], [38, 11, 2, 1], [38, 15, 2, 1]];
const CABLES: CellRect[] = [[0, 13, 12, 1], [48, 13, 12, 1]];
// Plug and socket travel this far together to mate: the prongs fill the socket holes.
const MATE = FACE + 2 - TIP;

const FRAGMENT = `
  uniform float uPulse;
  uniform float uPulseA;
  uniform float uPulseR;
  uniform float uOL;
  uniform float uOR;
  uniform float uWarm;
  uniform float uSpark;
  uniform float uAfter;
  uniform float uLink;
  uniform float uFlash;

  void main() {
${SCENE_CELL}
    vec2 q = (cell + 0.5) / uGrid - 0.5;
    float vig = 1.0 - smoothstep(0.2, 0.6, length(q * vec2(1.0, 1.9)));

    // The two halves slide on whole cells, so they stay on the grid.
    vec3 L = sampleMask(cell - vec2(uOL, 0.0));
    vec3 R = sampleMask(cell + vec2(uOR, 0.0));
    float plug = L.r;
    float socket = R.g * (1.0 - plug);
    float solid = max(plug, socket);

    // Quiet mosaic behind everything, fading out toward the edges.
    float n = fbm(cell * 0.11 + vec2(t * 0.04, -t * 0.02));
    vec3 col = vec3(0.5);
    float a = vig * step(0.45, h) * (0.03 + 0.14 * smoothstep(0.4, 0.8, n));
    vec3 hotC = vec3(1.0, 0.45, 0.18);

    if (solid > 0.5) {
      float v = chrome(cell / 18.0, t);
      float rowShade = mix(0.52, 0.3, (cell.y - 9.0) / 9.0);
      float warmC = 0.55 + 0.45 * v;
      vec3 hot = mix(hotC, vec3(1.0, 0.86, 0.66), v);
      if (plug > 0.5) {
        // The plug smoulders from the bottom and warms from the prongs when the pulse lands.
        float fromTip = max(0.0, TIP_X + uOL - cell.x);
        float warm = max(uWarm * exp(-fromTip / 5.0), uLink * 0.7) * warmC;
        float smoulder = smoothstep(12.0, 17.0, cell.y) * step(0.62, fract(h * 7.0 + t * 0.35)) * 0.35;
        float cable = L.b;
        float d = cell.x - uPulse;
        float pulse = cable * uPulseA * (d < 0.0 ? exp(d / 4.0) : exp(-d * d / 1.5));
        float px = cell.x - uOL;
        float rib = (step(abs(px - 16.0), 0.1) + step(abs(px - 18.0), 0.1)) * step(11.0, cell.y) * step(cell.y, 15.0);
        float base = (rowShade + 0.08 * v) * (1.0 - 0.4 * rib);
        float glow = clamp(max(warm, smoulder * (1.0 - cable)), 0.0, 1.0);
        col = mix(vec3(base), hot, glow);
        col = mix(col, fire(pulse), clamp(pulse * 1.4, 0.0, 1.0));
        a = 1.0;
      } else {
        // The ComfyUI side stays cold (dead static on its cable) until it is linked.
        float stat = R.b * step(0.82, hash(id + floor(t * 3.0))) * 0.12 * (1.0 - uLink);
        float chill = uSpark * exp(-max(0.0, cell.x - (FACE_X - uOR)) / 2.5) * 0.35;
        float dr = cell.x - uPulseR;
        float pulse = R.b * step(0.001, uLink) * (dr < 0.0 ? exp(dr / 4.0) : exp(-dr * dr / 1.5));
        col = vec3(rowShade * 0.72 + 0.05 * v - stat) + vec3(0.75, 0.82, 1.0) * chill;
        col = mix(col, hot, uLink * 0.7 * warmC);
        col = mix(col, fire(pulse), clamp(pulse * 1.4, 0.0, 1.0));
        a = mix(0.9, 1.0, uLink);
      }
    }

    // The spark: a broken, jittering arc along each prong row, plus stray cells in the gap.
    float lo = TIP_X + uOL;
    float hi = FACE_X - 1.0 - uOR;
    float inGap = step(lo, cell.x) * step(cell.x, hi);
    float strike = floor(t * 28.0);
    float arc = 0.0;
    float halo = 0.0;
    for (int i = 0; i < 2; i++) {
      float pr = i == 0 ? 11.0 : 15.0;
      float j = floor((hash(vec2(cell.x, strike + pr)) - 0.5) * 2.99);
      float dy = abs(cell.y - pr - j);
      float broken = step(0.18, hash(vec2(cell.x * 1.7 + pr, strike)));
      arc = max(arc, (1.0 - step(0.5, dy)) * broken);
      halo = max(halo, (1.0 - step(1.5, dy)) * step(0.5, dy) * step(0.45, hash(id + strike * 1.3)));
    }
    float stray = step(1.0 - 0.14 * uSpark, hash(id + strike)) * step(7.0, cell.y) * step(cell.y, 19.0);
    float spark = inGap * uSpark * max(arc, max(halo * 0.45, stray * 0.6));
    float gx = (cell.x - (lo + hi) * 0.5) / 9.0;
    float gy = (cell.y - 13.0) / 6.0;
    float ambient = uSpark * exp(-(gx * gx + gy * gy)) * (1.0 - solid) * step(0.45, h);

    // The contact flash when they mate: a hot core at the joint, light spilling into the mosaic.
    float jx = (cell.x - (FACE_X - uOR)) / 4.0;
    float flash = uFlash * exp(-(jx * jx + gy * gy * 2.5));
    ambient = max(ambient, uFlash * exp(-(jx * jx * 0.25 + gy * gy * 0.6)) * (1.0 - solid) * step(0.4, h));

    // Embers lift off where the spark died.
    float mid = (lo + hi) * 0.5;
    float drift = step(0.9, hash(vec2(id.x, id.y - floor(t * 7.0))));
    float column = exp(-pow((cell.x - mid) / 3.5, 2.0));
    float band = exp(-pow((cell.y - (15.0 - 14.0 * uAfter)) / 3.0, 2.0));
    float embers = step(0.25, drift * column * band) * step(0.001, uAfter) * (1.0 - uAfter);

    if (ambient > 0.0) {
      col = mix(col, vec3(1.0, 0.5, 0.2), clamp(ambient * 1.5, 0.0, 1.0));
      a = max(a, ambient * 0.45);
    }
    float heat = clamp(max(max(spark, embers * 0.85), flash), 0.0, 1.0);
    if (heat > 0.0) {
      float temp = flash > max(spark, embers) ? 0.7 + 0.3 * flash : spark > 0.0 ? (arc > 0.5 ? 0.8 + 0.2 * hash(id + strike * 0.3) : 0.35) : 0.45 * (1.0 - uAfter) + 0.12;
      col = mix(col, fire(temp), clamp(heat * 2.0, 0.0, 1.0));
      a = max(a, heat);
    }

    a *= develop(cell, h);
    gl_FragColor = vec4(col * a * sq, a * sq);
  }
`.replace(/TIP_X/g, TIP.toFixed(1)).replace(/FACE_X/g, FACE.toFixed(1));

function drawMask(ctx: CanvasRenderingContext2D) {
  fillRects(ctx, CABLES.slice(0, 1), '#f00');
  fillRects(ctx, CABLES.slice(1), '#0f0');
  fillRects(ctx, CABLES, '#00f');
  fillRects(ctx, PLUG, '#f00');
  fillRects(ctx, SOCKET, '#0f0');
  // Cuts clear their channel only; nothing else overlaps them.
  ctx.globalCompositeOperation = 'source-over';
  fillRects(ctx, [...PLUG_CUT, ...SOCKET_CUT], '#000');
}

/** Where the trying loop is at time t: pulse, reach, spark and embers. */
function trying(t: number) {
  const ph = t < 0 ? 0 : (t / CYCLE) % 1;
  const reach = ease(0.28, 0.46, ph) * (1 - ease(0.62, 0.92, ph));
  const oL = Math.round(3 * reach);
  const burst = (a: number, b: number) => (ph > a && ph < b ? Math.sin(((ph - a) / (b - a)) * Math.PI) : 0);
  return {
    pulse: -6 + (TIP + oL + 6) * ease(0, 0.44, ph),
    pulseA: t < 0 ? 0 : 1 - ease(0.42, 0.5, ph),
    oL,
    oR: Math.round(reach),
    warm: ease(0.36, 0.47, ph) * (1 - ease(0.55, 0.95, ph)),
    spark: Math.max(burst(0.47, 0.52), burst(0.535, 0.585)) * (0.65 + 0.35 * Math.random()),
    after: ph > 0.5 ? Math.min(1, (ph - 0.5) / 0.42) : 0,
  };
}

export function OfflineMark({ className, connectedAt = null }: { className?: string; connectedAt?: number | null }) {
  const { canvasRef, failed } = useCellScene({
    ...OFFLINE_GRID,
    drawMask,
    fragment: FRAGMENT,
    frame: (t, reduce) => {
      const loop = reduce ? trying(CYCLE * 0.4) : trying(t - 1.4);
      const intro = reduce ? 1 : 1 - Math.pow(1 - Math.min(1, Math.max(0, (t - 0.1) / 1.6)), 3);
      const base = { uPulse: loop.pulse, uPulseA: loop.pulseA, uPulseR: -10, uOL: loop.oL, uOR: loop.oR, uWarm: loop.warm, uSpark: reduce ? 0 : loop.spark, uAfter: reduce ? 0 : loop.after, uLink: 0, uFlash: 0, uReveal: intro };
      if (connectedAt === null) return base;
      // The connect ending, in seconds since ComfyUI answered.
      const f = (performance.now() - connectedAt) / 1000;
      const close = ease(0, 0.2, f);
      const link = ease(0.16, 0.28, f);
      return {
        ...base,
        uOL: Math.max(loop.oL, Math.round((MATE - 4) * close)),
        uOR: Math.max(loop.oR, Math.round(4 * close)),
        uPulseA: loop.pulseA * (1 - close),
        uSpark: 0,
        uAfter: 0,
        uWarm: Math.max(loop.warm, link),
        uLink: link,
        uFlash: link * (1 - ease(0.3, 0.52, f)),
        uPulseR: 44 + 20 * ease(0.2, 0.46, f),
        uReveal: Math.min(intro, 1 - ease(0.44, CONNECT_MS / 1000, f)),
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

import React, { useRef } from 'react';
import { SCENE_CELL, ease, fillRects, useCellScene } from './cellScene';
import { OFFLINE_GRID } from './OfflineMark';

/**
 * Hidden's mark: a pixel padlock in the same cell mosaic and grid as the
 * offline plug and the empty canvas, so Hidden's lock screen and empty state
 * sit in the gallery the way those do. One glyph, a quiet field, heat only
 * where something happens:
 *
 * - locked: gray and closed, the keyhole breathing ember.
 * - asking: a warm scan line passes over the lock while the system asks.
 * - opening: the shackle springs up, the body flashes warm and cools to white.
 * - failed: a short shiver and a dull red keyhole.
 * - open: Hidden with nothing in it yet, the shackle up and at rest.
 */

export type LockMarkStage = 'locked' | 'asking' | 'opening' | 'failed' | 'open';

const LIFT = 3;

function drawMask(ctx: CanvasRenderingContext2D) {
  // R: the shackle, an arch whose legs meet the body.
  fillRects(ctx, [[27, 4, 6, 1], [26, 5, 8, 1], [25, 6, 2, 6], [33, 6, 2, 6]], '#f00');
  // G: the body, rounded at the corners.
  fillRects(ctx, [[24, 12, 12, 1], [23, 13, 14, 8], [24, 21, 12, 1]], '#0f0');
  // B: the keyhole, a round head over a slot.
  fillRects(ctx, [[29, 14, 2, 1], [28, 15, 4, 2], [29, 17, 2, 2]], '#00f');
}

const FRAGMENT = `
  uniform float uLift;  // cells the shackle has risen
  uniform float uShake; // cells of sideways shiver
  uniform float uHeat;  // 0..1: the warm flash through the body on opening
  uniform float uCool;  // 0..1: the body cooling to white after it
  uniform float uScan;  // the scan line's row, or far off the grid
  uniform float uKey;   // the keyhole's ember
  uniform float uErr;   // 0..1: gone wrong

  void main() {
${SCENE_CELL}
    vec2 q = (cell + 0.5) / uGrid - 0.5;
    float vig = 1.0 - smoothstep(0.2, 0.6, length(q * vec2(1.0, 1.9)));
    vec2 c = cell - vec2(uShake, 0.0);
    float lift = floor(uLift + 0.5);
    vec3 m = sampleMask(c);
    float body = step(0.5, m.g);
    float key = step(0.5, m.b);
    float shackle = step(0.5, sampleMask(c + vec2(0.0, lift)).r) * (1.0 - body);
    // Open, the left leg stays seated in the body while the right one clears it.
    float leg = step(24.5, c.x) * step(c.x, 26.5) * step(11.5 - lift, c.y) * step(c.y, 11.5) * step(0.5, lift);
    shackle = max(shackle, leg);

    // Quiet mosaic behind everything, as in the offline and empty scenes.
    float n = fbm(cell * 0.11 + vec2(t * 0.04, -t * 0.02));
    vec3 col = vec3(0.5);
    float a = vig * step(0.45, h) * (0.03 + 0.14 * smoothstep(0.4, 0.8, n));
    float v = chrome(cell / 18.0, t);

    if (body > 0.5 || shackle > 0.5) {
      // The same brushed gray as the plug, lighter at the top.
      float shade = body > 0.5 ? mix(0.52, 0.34, (c.y - 12.0) / 9.0) : mix(0.62, 0.48, (c.y + lift - 4.0) / 7.0);
      col = vec3(shade + 0.08 * v);
      a = 1.0;
      if (body > 0.5) {
        // Opening: heat runs up the body and cools to white.
        vec3 warm = fire(0.45 + 0.35 * v + 0.2 * hash(id + floor(t * 12.0)));
        col = mix(col, warm, uHeat * (1.0 - uCool));
        col = mix(col, vec3(0.94 + 0.04 * v), uCool);
      }
      // The system is asking: a warm line passes over the lock.
      float dy = (c.y - uScan) / 1.1;
      float k = exp(-dy * dy);
      col = mix(col, fire(0.55 + 0.35 * k), k * 0.85);
      col = mix(col, vec3(0.62, 0.34, 0.3), uErr * 0.3);
      if (key > 0.5) {
        // The keyhole: a dark hole that breathes ember, dull red when wrong.
        vec3 ember = mix(fire(0.25 + 0.45 * uKey), vec3(0.62, 0.16, 0.12), uErr);
        col = mix(vec3(0.1), ember, clamp(uKey + uErr, 0.0, 1.0));
        a = mix(0.25, 1.0, clamp(uKey + uErr, 0.0, 1.0)) * (1.0 - uCool);
      }
    }

    a *= develop(cell, h);
    gl_FragColor = vec4(col * a * sq, a * sq);
  }
`;

export function LockMark({ stage, className }: { stage: LockMarkStage; className?: string }) {
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const motion = useRef({ stage, at: 0, last: 0, lift: stage === 'open' || stage === 'opening' ? LIFT : 0, velocity: 0 });

  const { canvasRef, failed } = useCellScene({
    ...OFFLINE_GRID,
    drawMask,
    fragment: FRAGMENT,
    frame: (t, reduce) => {
      const s = motion.current;
      const st = stageRef.current;
      if (st !== s.stage) { s.stage = st; s.at = t; }
      const since = t - s.at;
      const dt = Math.max(0, Math.min(0.05, t - s.last));
      s.last = t;
      const open = st === 'open' || st === 'opening';
      const liftTarget = open ? LIFT : 0;
      // The shackle springs: a little overshoot, then it settles.
      if (reduce) s.lift = liftTarget;
      else {
        s.velocity += ((liftTarget - s.lift) * 170 - s.velocity * 15) * dt;
        s.lift += s.velocity * dt;
      }
      const breathe = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.6);
      const intro = reduce ? 1 : 1 - Math.pow(1 - Math.min(1, t / 0.7), 3);
      return {
        uReveal: intro,
        uLift: s.lift,
        uShake: st === 'failed' && !reduce && since < 0.4 ? Math.round(Math.sin(since * 55) * (1 - since / 0.4) * 1.4) : 0,
        uHeat: st === 'opening' ? (reduce ? 1 : ease(0, 0.12, since)) : 0,
        uCool: st === 'opening' ? (reduce ? 1 : ease(0.18, 0.5, since)) : 0,
        uScan: st === 'asking' && !reduce ? 21 - (Math.sin(since * 2.6 - Math.PI / 2) * 0.5 + 0.5) * 17 : -99,
        uKey: st === 'locked' || st === 'asking' ? 0.25 + 0.55 * breathe : st === 'open' ? 0.12 : 0,
        uErr: st === 'failed' ? (reduce ? 1 : 1 - ease(1.2, 2.2, since) * 0.4) : 0,
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

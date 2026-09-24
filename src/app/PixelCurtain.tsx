import React, { useEffect, useRef } from 'react';
import { hash, heatColor } from './UpscaleHero';

/**
 * The passage between the gallery and Hidden: a wave of cells burns out from
 * where the move started (the dock's lock, or the lock screen's centre),
 * covers the stage while the other side loads, then clears outward to show it.
 * The leading edge of the wave glows ember; behind it the cells are the same
 * near-black as the stage, so nothing of either side shows mid-way.
 */
export function PixelCurtain({ trigger, origin }: { trigger: string; origin?: { x: number; y: number } | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const first = useRef(true);
  const originRef = useRef(origin);
  originRef.current = origin;

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.width = Math.round(canvas.clientWidth * dpr);
    const h = canvas.height = Math.round(canvas.clientHeight * dpr);
    const pitch = Math.round(16 * dpr);
    const gap = Math.max(1, Math.round(pitch * 0.14));
    const cols = Math.ceil(w / pitch), rows = Math.ceil(h / pitch);
    const rect = canvas.getBoundingClientRect();
    const o = originRef.current;
    const ox = o ? (o.x - rect.left) * dpr / pitch : cols / 2;
    const oy = o ? (o.y - rect.top) * dpr / pitch : rows / 2;
    const far = Math.max(Math.hypot(ox, oy), Math.hypot(cols - ox, oy), Math.hypot(ox, rows - oy), Math.hypot(cols - ox, rows - oy));
    const duration = 820;
    const start = performance.now();
    let raf = 0;
    const draw = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      ctx.clearRect(0, 0, w, h);
      // In: the front reaches the far corner at 45%. Out: a second front clears behind it.
      const inFront = Math.min(1, p / 0.45) * (far + 6);
      const outFront = p < 0.5 ? -1 : ((p - 0.5) / 0.5) * (far + 8);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const d = Math.hypot(x - ox, y - oy) + hash(x, y) * 3;
          if (d > inFront || d < outFront) continue;
          const edge = Math.min(inFront - d, outFront >= 0 ? d - outFront : 99);
          let r = 11, g = 11, b = 11, a = 1;
          if (edge < 2.4) {
            const heat = 1 - edge / 2.4;
            [r, g, b] = heatColor(0.2 + heat * 0.8 * (0.6 + 0.4 * hash(x + 7, y)));
            a = 0.55 + 0.45 * heat;
          }
          ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a.toFixed(3)})`;
          ctx.fillRect(x * pitch, y * pitch, pitch - gap, pitch - gap);
        }
      }
      if (p < 1) raf = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ctx.clearRect(0, 0, w, h); };
  }, [trigger]);

  return <canvas ref={canvasRef} className="pixel-curtain" aria-hidden="true" />;
}

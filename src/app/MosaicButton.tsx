import React, { useEffect, useRef } from 'react';
import { cn } from './format';

/**
 * A button whose face is a field of square cells, like the generation mosaic.
 * At rest it is a quiet grid of dots. While `busy`, heat burns across it from
 * the left: cells behind the front glow ember and twinkle, the front itself
 * runs white-hot, and the field ahead waits in gray. When the work finishes
 * the front races to the end and the field cools back down.
 */
export function MosaicButton({ busy, disabled, onClick, children, className, tone = 'default' }: {
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  tone?: 'default' | 'primary';
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const hoverRef = useRef(0);
  const wakeRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const CELL = 5;          // CSS px per cell
    const GAP = 1;
    let w = 0, h = 0, cols = 0, rows = 0;
    let seeds = new Float32Array(0);
    const resize = () => {
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (Math.round(cw * dpr) === w && Math.round(ch * dpr) === h) return;
      w = canvas.width = Math.round(cw * dpr);
      h = canvas.height = Math.round(ch * dpr);
      cols = Math.ceil(cw / CELL);
      rows = Math.ceil(ch / CELL);
      seeds = new Float32Array(cols * rows).map(() => Math.random());
    };

    // Progress: creeps toward 90% while busy, then finishes and cools.
    let progress = 0, heat = 0, wasBusy = busyRef.current, finishing = 0, last = performance.now(), raf = 0;
    const draw = (now: number) => {
      raf = 0;
      resize();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const isBusy = busyRef.current;
      if (isBusy && !wasBusy) { progress = 0; finishing = 0; }
      if (!isBusy && wasBusy) finishing = 1;
      wasBusy = isBusy;
      if (isBusy) {
        progress += (0.9 - progress) * dt * 0.7;
        heat += (1 - heat) * dt * 6;
      } else if (finishing) {
        progress += (1.08 - progress) * dt * 5;
        if (progress >= 1.02) { finishing = 0; }
      } else {
        heat += (0 - heat) * dt * 1.6;
        if (heat < 0.01) { heat = 0; progress = 0; }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const hover = hoverRef.current;
      const front = progress * cols;
      for (let x = 0; x < cols; x++) {
        for (let y = 0; y < rows; y++) {
          const seed = seeds[x * rows + y];
          const behind = front - x;
          let r = 255, g = 255, b = 255, a = 0.05 + 0.05 * hover;
          let size = 1.4;
          if (heat > 0 && behind > 0) {
            // Colour runs deep red far behind the front, ember in the body, white at the edge.
            const k = Math.min(1, behind / Math.max(6, cols * 0.5));
            const edge = Math.max(0, 1 - behind / 3);
            r = 255;
            g = Math.round(90 + 64 * (1 - k) + 100 * edge);
            b = Math.round(40 + 42 * (1 - k) + 170 * edge);
            const twinkle = reduce ? 0.7 : 0.45 + 0.55 * Math.max(0, Math.sin(t * (2.2 + seed * 3) + seed * 40));
            a = heat * Math.min(1, 0.18 + twinkle * (0.55 - k * 0.3) + edge * 0.6) * (seed > 0.12 ? 1 : 0.25);
            size = CELL - GAP;
          } else if (heat > 0 && behind > -4) {
            // Sparks just ahead of the front.
            const lead = 1 + behind / 4;
            a = heat * lead * (seed > 0.7 ? 0.5 : 0.08);
            size = seed > 0.7 ? CELL - GAP : 1.6;
          }
          if (a <= 0.01) continue;
          ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
          const cx = x * CELL + CELL / 2, cy = y * CELL + CELL / 2;
          ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
        }
      }
      // At rest the field is static: draw once and sleep until something changes.
      if (isBusy || finishing || heat > 0) raf = requestAnimationFrame(draw);
    };
    const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(draw); } };
    wakeRef.current = wake;
    wake();
    const ro = new ResizeObserver(wake);
    ro.observe(canvas);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);
  useEffect(() => { wakeRef.current(); }, [busy]);

  return (
    <button
      type="button"
      className={cn('mosaic-button', tone === 'primary' && 'is-primary', busy && 'is-busy', className)}
      disabled={disabled}
      aria-busy={busy || undefined}
      onClick={onClick}
      onPointerEnter={() => { hoverRef.current = 1; wakeRef.current(); }}
      onPointerLeave={() => { hoverRef.current = 0; wakeRef.current(); }}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="mosaic-button-label">{children}</span>
    </button>
  );
}

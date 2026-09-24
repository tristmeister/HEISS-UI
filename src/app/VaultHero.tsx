import React, { useEffect, useRef } from 'react';
import { field, hash, heatColor } from './UpscaleHero';
import { trackCanvasSize } from './canvasSize';

/**
 * Hidden's setup and unlock hero, in the same material as the model folders
 * one: a quiet gray field of cells around a pixel glyph, heat where something
 * happens.
 *
 * The glyph is a padlock, or a fingerprint while Touch ID or Windows Hello is
 * the question. Each stage has its own motion:
 * - intro: the lock stands in outline, its keyhole smouldering.
 * - password: the body fills with heat as the password gets stronger.
 * - biometric: the fingerprint waits, a spark tracing its ridges.
 * - scanning: a scan line sweeps the fingerprint while the system asks.
 * - sealed: setup is done; heat ripples out and the lock cools to white.
 * - locked: closed and cool, the keyhole breathing.
 * - unlocking: the shackle springs up and the lock cools to white.
 * - error: the heat dies back to a dull red and the glyph shivers.
 */

export type VaultHeroStage = 'intro' | 'password' | 'biometric' | 'scanning' | 'sealed' | 'locked' | 'unlocking' | 'error';

const SHACKLE = [
  '....XXXXXXX....',
  '...XXXXXXXXX...',
  '..XXX.....XXX..',
  '..XX.......XX..',
  '..XX.......XX..',
  '..XX.......XX..',
  '..XX.......XX..'
];
const BODY = [
  'XXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXX',
  'XXXXXX...XXXXXX',
  'XXXXXX...XXXXXX',
  'XXXXXXX.XXXXXXX',
  'XXXXXXX.XXXXXXX',
  'XXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXX'
];
const FINGERPRINT = [
  '.....XXXXX.....',
  '...XX.....XX...',
  '..X..XXXXX..X..',
  '.X..X.....X..X.',
  '.X.X..XXX..X.X.',
  'X..X.X...X.X..X',
  'X.X..X.X.X..X.X',
  'X.X.X..X..X.X.X',
  'X.X.X.X.X.X.X.X',
  'X.X.X.X.X.X.X.X',
  '..X.X.X.X.X.X..',
  '.X..X.X.X.X..X.',
  '...X..X.X..X...',
  '..X..X..X...X..',
  '....X..X..X....',
  '...X..X...X....',
  '.....X..X......'
];
const GW = 15;
const LIFT = 3;
// Room above the shackle for it to spring into.
const GH = SHACKLE.length + BODY.length + LIFT;

type Cell = { x: number; y: number; part: 'shackle' | 'body' | 'print'; edge: boolean; keyhole?: boolean };

function cellsOf(rows: string[], part: Cell['part'], offsetY: number): Cell[] {
  const cells: Cell[] = [];
  const at = (x: number, y: number) => rows[y]?.[x] === 'X';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!at(x, y)) continue;
      const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
      cells.push({ x, y: y + offsetY, part, edge });
    }
  });
  return cells;
}

const SHACKLE_CELLS = cellsOf(SHACKLE, 'shackle', LIFT);
const BODY_CELLS = cellsOf(BODY, 'body', LIFT + SHACKLE.length).map((cell) => {
  const by = cell.y - LIFT - SHACKLE.length;
  // Cells round the keyhole glow first.
  const keyhole = by >= 2 && by <= 7 && cell.x >= 5 && cell.x <= 9;
  return { ...cell, keyhole };
});
const PRINT_CELLS = cellsOf(FINGERPRINT, 'print', GH - FINGERPRINT.length);
const PRINT_ORDER = [...PRINT_CELLS].sort((a, b) => Math.atan2(a.y - GH / 2, a.x - GW / 2) - Math.atan2(b.y - GH / 2, b.x - GW / 2));

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

type Spark = { x: number; y: number; vx: number; vy: number; life: number; decay: number };

export function VaultHero({ stage, progress = 0, className }: { stage: VaultHeroStage; progress?: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef(stage);
  const progressRef = useRef(progress);
  const wakeRef = useRef<() => void>(() => {});
  stageRef.current = stage;
  progressRef.current = progress;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tracked = trackCanvasSize(canvas, 2, () => wakeRef.current());
    const { dpr } = tracked;

    let w = 0, h = 0, pitch = 1, gap = 1, cols = 0, rows = 0, ox = 0, oy = 0, gx = 0, gy = 0;
    const resize = () => {
      const { width: nw, height: nh } = tracked.size;
      if (!nw || !nh) return false;
      if (nw === w && nh === h) return true;
      w = canvas.width = nw;
      h = canvas.height = nh;
      pitch = Math.max(4, Math.round(Math.max(5, Math.min(8, nw / dpr / 70)) * dpr));
      gap = Math.max(1, Math.round(pitch * 0.2));
      cols = Math.ceil(w / pitch);
      rows = Math.ceil(h / pitch);
      ox = Math.floor((w - Math.floor(w / pitch) * pitch) / 2);
      oy = Math.floor((h - Math.floor(h / pitch) * pitch) / 2);
      gx = Math.floor(cols / 2 - GW / 2);
      gy = Math.floor(rows / 2 - GH / 2);
      return true;
    };

    const sparks: Spark[] = [];
    let lastStage = stageRef.current;
    let changedAt = 0;
    let lift = stageRef.current === 'unlocking' ? LIFT : 0;
    let liftVelocity = 0;
    let fill = 0;
    let print = stageRef.current === 'biometric' || stageRef.current === 'scanning' ? 1 : 0;
    let raf = 0;
    let last = performance.now();
    const t0 = last;
    let visible = true;

    const square = (x: number, y: number, size: number, r: number, g: number, b: number, a: number) => {
      if (a <= 0.01) return;
      ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${Math.min(1, a).toFixed(3)})`;
      ctx.fillRect(ox + x * pitch, oy + y * pitch, size, size);
    };

    const draw = (now: number) => {
      raf = 0;
      if (!resize()) return;
      // A frame's timestamp can predate the wake that asked for it; time never runs backwards here.
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      const t = reduce ? 6 : (now - t0) / 1000;
      const st = stageRef.current;
      if (st !== lastStage) { lastStage = st; changedAt = t; }
      const since = t - changedAt;

      // The shackle springs: a little overshoot up, a settle, and back down when locked again.
      const liftTarget = st === 'unlocking' ? LIFT : 0;
      if (reduce) lift = liftTarget;
      else {
        liftVelocity += ((liftTarget - lift) * 90 - liftVelocity * 11) * dt;
        lift += liftVelocity * dt;
      }
      const printTarget = st === 'biometric' || st === 'scanning' ? 1 : 0;
      print += reduce ? printTarget - print : (printTarget - print) * Math.min(1, dt * 7);
      const fillTarget = st === 'password' ? clamp01(progressRef.current) : st === 'sealed' || st === 'unlocking' ? 1 : st === 'error' ? fill : 0;
      fill += reduce ? fillTarget - fill : (fillTarget - fill) * Math.min(1, dt * 5);
      const shiver = st === 'error' && since < 0.5 && !reduce ? Math.round(Math.sin(since * 60) * (1 - since * 2) * 1.2) : 0;

      ctx.clearRect(0, 0, w, h);
      const cx = gx + GW / 2, cy = gy + GH / 2;
      const rippleR = since * 26;
      const rippleA = st === 'sealed' || st === 'unlocking' ? Math.max(0, 0.8 - since / 1.4) : 0;

      // The field: a quiet gray flow, a ripple of heat when setup finishes.
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          // A moat round the glyph keeps it legible.
          if (x > gx - 2 && x < gx + GW + 1 && y > gy - 2 && y < gy + GH + 1) continue;
          const v = field(x + 0.5, y + 0.5, t * (st === 'locked' ? 0.5 : 1));
          const near = Math.hypot((x - cx) * 0.8, y - cy);
          const hush = 0.3 + 0.7 * clamp01((near - GH * 0.6) / (GH * 1.1));
          let a = (0.02 + 0.18 * v * v * 1.3) * hush;
          let r = 255, g = 255, b = 255;
          let heat = 0;
          if (rippleA > 0) heat = Math.exp(-Math.pow((near - rippleR) / 2.4, 2)) * rippleA * (0.6 + 0.4 * hash(x + 3, y));
          if (st === 'error') { g = 200; b = 190; a *= 0.7; }
          if (heat > 0.02) {
            const [hr, hg, hb] = heatColor(heat);
            const k = Math.min(1, heat * 1.4);
            r += (hr - r) * k; g += (hg - g) * k; b += (hb - b) * k;
            a = Math.max(a, heat * 0.85);
          }
          square(x, y, pitch - gap, r, g, b, a);
        }
      }

      // Scan line for the system prompt, bottom to top and back.
      const scanRow = st === 'scanning' ? GH - 1 - ((Math.sin(since * 2.6 - Math.PI / 2) * 0.5 + 0.5) * (GH - 1)) : -99;
      const runner = st === 'biometric' ? (t * 11) % PRINT_ORDER.length : -99;
      const cool = st === 'sealed' ? clamp01((since - 0.4) / 0.9) : st === 'unlocking' ? clamp01((since - 0.25) / 0.8) : 0;
      const breathe = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.6);
      const fillRow = LIFT + SHACKLE.length + BODY.length - fill * BODY.length;

      const lockAlpha = 1 - print;
      if (lockAlpha > 0.01) {
        const liftCells = Math.round(lift);
        for (const cell of SHACKLE_CELLS) {
          // Opening lifts the whole shackle; its right leg clears the body, the left stays in.
          const y = cell.y - liftCells;
          const s = hash(cell.x * 5, cell.y * 3);
          let r = 255, g = 255, b = 255;
          let a = st === 'intro' ? (cell.edge ? 0.5 : 0.2) : st === 'locked' ? 0.62 : 0.72;
          if (st === 'unlocking' && since < 0.9) {
            [r, g, b] = heatColor(clamp01(1 - since / 0.9) * 0.9 + 0.1 * s);
            a = 0.95;
          }
          if (st === 'error') { [r, g, b] = [255, 120, 100]; a = 0.5; }
          square(cell.x + gx + shiver, y + gy, pitch - gap, r, g, b, a * lockAlpha);
        }
        // The left leg grows down to meet the body as the shackle rises.
        for (let extra = 0; extra < liftCells; extra++) {
          for (const x of [2, 3]) {
            const y = LIFT + SHACKLE.length - 1 - extra;
            square(x + gx + shiver, y + gy, pitch - gap, 255, 255, 255, (st === 'error' ? 0.4 : 0.6) * lockAlpha);
          }
        }
        for (const cell of BODY_CELLS) {
          const s = hash(cell.x * 3, cell.y * 7);
          let r = 255, g = 255, b = 255, a: number;
          const filled = cell.y + 0.5 >= fillRow;
          if (filled && (st === 'password' || st === 'sealed' || st === 'unlocking' || st === 'error')) {
            const edgeHeat = Math.max(0, 1 - (cell.y - fillRow) / 1.6);
            const twinkle = reduce ? 0.8 : 0.7 + 0.3 * Math.sin(t * (2.5 + s * 3) + s * 40);
            const heat = Math.min(1, 0.35 + 0.3 * twinkle + edgeHeat * 0.6);
            [r, g, b] = heatColor(st === 'error' ? heat * 0.35 : heat);
            a = st === 'error' ? 0.55 : 0.78 + 0.22 * twinkle;
            if (cool > 0) {
              r += (244 - r) * cool; g += (244 - g) * cool; b += (244 - b) * cool;
              a += (1 - a) * cool;
            }
          } else if (st === 'locked') {
            a = cell.edge ? 0.55 : 0.2;
            if (cell.keyhole) {
              [r, g, b] = heatColor(0.35 + 0.35 * breathe);
              a = 0.35 + 0.35 * breathe * (0.6 + 0.4 * s);
            }
          } else if (st === 'error') {
            [r, g, b] = [255, 120, 100];
            a = cell.edge ? 0.45 : 0.08;
          } else {
            a = cell.edge ? 0.42 + 0.18 * breathe : 0.07 + 0.04 * breathe;
            if (cell.keyhole && (st === 'intro' || st === 'password') && s > 0.3) {
              [r, g, b] = heatColor(0.3 + 0.4 * breathe);
              a = Math.max(a, 0.3 + 0.4 * breathe * s);
            }
          }
          square(cell.x + gx + shiver, cell.y + gy, pitch - gap, r, g, b, a * lockAlpha);
        }
      }

      if (print > 0.01) {
        for (const [index, cell] of PRINT_ORDER.entries()) {
          let r = 255, g = 255, b = 255;
          let a = 0.34;
          const behind = runner >= 0 ? (runner - index + PRINT_ORDER.length) % PRINT_ORDER.length : 99;
          const trail = behind < 9 ? 1 - behind / 9 : 0;
          if (trail > 0.02) { [r, g, b] = heatColor(0.55 + trail * 0.45); a = 0.34 + trail * 0.6; }
          if (scanRow > -50) {
            const k = Math.exp(-Math.pow((cell.y - scanRow) / 1.3, 2));
            if (k > 0.05) { [r, g, b] = heatColor(0.5 + k * 0.5); a = 0.3 + k * 0.7; }
          }
          square(cell.x + gx, cell.y + gy, pitch - gap, r, g, b, a * print);
        }
      }

      if (!reduce) {
        const spawn = st === 'sealed' && since < 0.5 ? 30 : st === 'unlocking' && since < 0.3 ? 24 : 0;
        let count = Math.floor(spawn * dt) + (Math.random() < (spawn * dt) % 1 ? 1 : 0);
        while (count-- > 0) {
          const fromShackle = st === 'unlocking';
          const from = fromShackle
            ? SHACKLE_CELLS[Math.floor(Math.random() * SHACKLE_CELLS.length)]
            : BODY_CELLS[Math.floor(Math.random() * BODY_CELLS.length)];
          sparks.push({
            x: gx + from.x + 0.5, y: gy + from.y - (fromShackle ? Math.round(lift) : 0),
            vx: (Math.random() - 0.5) * (fromShackle ? 14 : 4),
            vy: -(fromShackle ? 8 + Math.random() * 16 : 3 + Math.random() * 5),
            life: 1, decay: 0.7 + Math.random() * 0.9
          });
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
          const p = sparks[i];
          p.x += p.vx * dt + Math.sin(t * 6 + i) * dt * 1.2;
          p.y += p.vy * dt;
          p.vy *= 0.985;
          p.life -= p.decay * dt;
          if (p.life <= 0 || p.y < -2) { sparks.splice(i, 1); continue; }
          const [r, g, b] = heatColor(0.25 + p.life * 0.75);
          square(Math.floor(p.x), Math.floor(p.y), pitch - gap, r, g, b, p.life);
        }
      }

      if (!reduce && visible) raf = requestAnimationFrame(draw);
    };

    const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(draw); } };
    wakeRef.current = wake;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && document.visibilityState !== 'hidden';
      if (visible) wake();
    });
    io.observe(canvas);
    wake();
    return () => { cancelAnimationFrame(raf); io.disconnect(); tracked.disconnect(); };
  }, []);

  useEffect(() => { wakeRef.current(); }, [stage, progress]);

  return (
    <div className={className} data-stage={stage} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}

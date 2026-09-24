import React, { useEffect, useRef } from 'react';
import { field, hash, heatColor } from './UpscaleHero';
import type { ModelFolderStage } from './useModelFolders';
import { trackCanvasSize } from './canvasSize';

/**
 * The model folders hero: a pixel folder in the same cell field as smart
 * upscale, with model files as single cells of heat.
 *
 * - scanning: a beam sweeps the field; cells it passes over flash, a spark
 *   runs round the folder, the way the upscale arrow watches for ComfyUI.
 * - found: the models it found hover over the folder, one ember cell each.
 * - none: an empty folder, breathing.
 * - adding / restarting / waiting: the cells stream into the folder, which
 *   fills with heat from the bottom as they land.
 * - done: a ripple, and the folder cools to solid white, full.
 * - error: the heat dies back to a dull red.
 */

const FOLDER = [
  'XXXXXX...........',
  'XXXXXXX..........',
  'XXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXX'
];
const FW = FOLDER[0].length;
const FH = FOLDER.length;
const inFolder = (x: number, y: number) => x >= 0 && y >= 0 && x < FW && y < FH && FOLDER[y][x] === 'X';
const CELLS: Array<{ x: number; y: number; edge: boolean }> = [];
for (let y = 0; y < FH; y++) {
  for (let x = 0; x < FW; x++) {
    if (!inFolder(x, y)) continue;
    const edge = !inFolder(x - 1, y) || !inFolder(x + 1, y) || !inFolder(x, y - 1) || !inFolder(x, y + 1);
    CELLS.push({ x, y, edge });
  }
}
// The outline in walking order, for the spark that runs round it while searching.
const OUTLINE = (() => {
  const edges = CELLS.filter((cell) => cell.edge);
  const cx = (FW - 1) / 2, cy = FH / 2;
  return edges.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
})();
// The folder's front: a lip two rows under the top edge, so it reads as a folder, not a box.
const LIP = 3;

type Mote = { x: number; y: number; sx: number; sy: number; home: number; seed: number; phase: 'hover' | 'fly' | 'in'; t: number; delay: number };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; decay: number };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (k: number) => 1 - Math.pow(1 - clamp01(k), 3);

export function ModelFoldersHero({ stage, files = 0, className }: { stage: ModelFolderStage; files?: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef(stage);
  const filesRef = useRef(files);
  const wakeRef = useRef<() => void>(() => {});
  stageRef.current = stage;
  filesRef.current = files;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tracked = trackCanvasSize(canvas, 2, () => wakeRef.current());
    const { dpr } = tracked;

    let w = 0, h = 0, pitch = 1, gap = 1, cols = 0, rows = 0, ox = 0, oy = 0, fx = 0, fy = 0;
    const resize = () => {
      const { width: nw, height: nh } = tracked.size;
      if (!nw || !nh) return false;
      const cw = nw / dpr;
      if (nw === w && nh === h) return true;
      w = canvas.width = nw;
      h = canvas.height = nh;
      pitch = Math.max(4, Math.round(Math.max(5, Math.min(8, cw / 70)) * dpr));
      gap = Math.max(1, Math.round(pitch * 0.2));
      cols = Math.ceil(w / pitch);
      rows = Math.ceil(h / pitch);
      ox = Math.floor((w - Math.floor(w / pitch) * pitch) / 2);
      oy = Math.floor((h - Math.floor(h / pitch) * pitch) / 2);
      fx = Math.floor(cols / 2 - FW / 2);
      // Sit a little low, so the models can hover above it.
      fy = Math.floor(rows / 2 - FH / 2 + 2);
      return true;
    };

    const motes: Mote[] = [];
    const sparks: Spark[] = [];
    let lastStage = stageRef.current;
    let changedAt = 0;
    let fill = 0;
    let landed = 0;
    let raf = 0;
    let last = performance.now();
    const t0 = last;
    let visible = true;

    const square = (x: number, y: number, r: number, g: number, b: number, a: number, size = pitch - gap) => {
      if (a <= 0.01) return;
      ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${Math.min(1, a).toFixed(3)})`;
      ctx.fillRect(ox + x * pitch, oy + y * pitch, size, size);
    };

    // Where the n-th found model hovers: a loose arc over the folder mouth.
    const homeOf = (i: number, n: number, t: number) => {
      const k = n <= 1 ? 0.5 : i / (n - 1);
      const x = fx + 1 + k * (FW - 3) + Math.sin(t * 0.9 + i * 1.7) * 0.6;
      const y = fy - 3 - Math.sin(k * Math.PI) * 3.2 + Math.sin(t * 1.3 + i * 2.3) * 0.7;
      return { x, y };
    };

    const draw = (now: number) => {
      raf = 0;
      if (!resize()) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = reduce ? 6 : (now - t0) / 1000;
      const st = stageRef.current;
      if (st !== lastStage) {
        // Leaving "found" for the move: every hovering model takes off toward the folder.
        if (st === 'adding' || st === 'restarting' || st === 'waiting') motes.forEach((m, i) => { if (m.phase === 'hover') { m.phase = 'fly'; m.t = 0; m.sx = m.x; m.sy = m.y; m.delay = i * 0.07; } });
        if (st === 'scanning' || st === 'none') { motes.length = 0; landed = 0; }
        lastStage = st;
        changedAt = t;
      }
      const since = t - changedAt;
      const searching = st === 'scanning' || st === 'offline' || st === 'remote';
      const moving = st === 'adding' || st === 'restarting' || st === 'waiting';
      const count = Math.max(1, Math.min(22, filesRef.current || 8));

      // How full the folder is: the landed models, then a slow creep while ComfyUI restarts.
      const target = st === 'done' ? 1 : moving ? Math.min(0.92, landed / count * 0.7 + (st === 'restarting' ? 0.22 * clamp01(since / 20) : 0)) : st === 'error' ? fill : 0;
      fill += reduce ? target - fill : (target - fill) * Math.min(1, dt * 3);

      ctx.clearRect(0, 0, w, h);
      const fcx = fx + FW / 2, fcy = fy + FH / 2;

      const beamX = searching ? ((t * (st === 'scanning' ? 0.3 : 0.16)) % 1.3 - 0.15) * cols : -99;
      const rippleR = since * (st === 'done' ? 32 : 24);
      const rippleA = st === 'done' ? Math.max(0, 1 - since / 1.6) : st === 'found' ? Math.max(0, 0.5 - since / 1.1) : 0;

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const lx = x - fx, ly = y - fy;
          if (inFolder(lx, ly) || inFolder(lx - 1, ly) || inFolder(lx + 1, ly) || inFolder(lx, ly - 1) || inFolder(lx, ly + 1)) continue;
          const v = field(x + 0.5, y + 0.5, t);
          const near = Math.hypot((x - fcx) * 0.8, y - fcy);
          const hush = 0.3 + 0.7 * clamp01((near - FH * 0.6) / (FH * 1.1));
          let a = (0.02 + 0.18 * v * v * 1.3) * hush * (st === 'offline' || st === 'remote' ? 0.55 : 1);
          let r = 255, g = 255, b = 255;
          let heat = 0;
          if (beamX > -50) {
            const k = Math.exp(-Math.pow((x - beamX) / 3, 2));
            a += k * 0.14;
            // Now and then a model file under the beam: a cell that flashes and fades.
            if (st === 'scanning' && hash(x, y) > 0.985) heat = Math.max(heat, k * 0.9);
          }
          if (rippleA > 0) {
            heat = Math.max(heat, Math.exp(-Math.pow((near - rippleR) / 2.4, 2)) * rippleA * (0.6 + 0.4 * hash(x + 3, y)));
          }
          if (st === 'error') { g = 200; b = 190; a *= 0.7; }
          if (heat > 0.02) {
            const [hr, hg, hb] = heatColor(heat);
            const k = Math.min(1, heat * 1.4);
            r += (hr - r) * k; g += (hg - g) * k; b += (hb - b) * k;
            a = Math.max(a, heat * 0.85);
          }
          square(x, y, r, g, b, a);
        }
      }

      // The folder: ghost outline while searching, heat rising from the base as models land, white when done.
      const fillRow = FH - fill * (FH - LIP);
      const cool = st === 'done' ? clamp01((since - 0.3) / 0.9) : 0;
      const runner = searching ? (t * 10) % OUTLINE.length : -99;
      for (const cell of CELLS) {
        const x = cell.x + fx, y = cell.y + fy;
        const s = hash(x * 3, y * 5);
        let r = 255, g = 255, b = 255, a: number;
        const filled = cell.y + 0.5 >= fillRow && cell.y >= LIP && fill > 0.01;
        if (filled) {
          const depth = (cell.y - fillRow) / FH;
          const edgeHeat = Math.max(0, 1 - (cell.y - fillRow) / 1.6);
          const twinkle = reduce ? 0.8 : 0.7 + 0.3 * Math.sin(t * (2.5 + s * 3) + s * 40);
          const heat = Math.min(1, 0.35 + 0.35 * (1 - depth) * twinkle + edgeHeat * 0.6);
          [r, g, b] = heatColor(st === 'error' ? heat * 0.35 : heat);
          a = st === 'error' ? 0.55 : 0.72 + 0.25 * twinkle;
          if (cool > 0) { r += (244 - r) * cool; g += (244 - g) * cool; b += (244 - b) * cool; a += (1 - a) * cool; }
        } else if (searching) {
          const i = cell.edge ? OUTLINE.indexOf(cell) : -1;
          const behind = i >= 0 ? (runner - i + OUTLINE.length) % OUTLINE.length : 99;
          const trail = behind < 8 ? 1 - behind / 8 : 0;
          a = (cell.edge || cell.y === LIP ? 0.2 : 0.04) * (st === 'scanning' ? 1 : 0.7) + trail * 0.75;
          if (trail > 0.02) [r, g, b] = heatColor(0.55 + trail * 0.45);
        } else if (st === 'error') {
          [r, g, b] = [255, 120, 100];
          a = cell.edge ? 0.45 : 0.06;
        } else {
          const pulse = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(t * (st === 'none' ? 1.1 : 2) - cell.y * 0.3);
          // The back panel stays faint, the front below the lip reads as the folder's face.
          a = cell.edge ? 0.4 + 0.2 * pulse : cell.y < LIP ? 0.05 : 0.1 + 0.04 * pulse;
          // The lip catches the light: the folder's front edge, a full-width line.
          if (cell.y === LIP) a = Math.max(a, 0.46 + 0.18 * pulse);
          if (st === 'none') a *= 0.7;
          if ((st === 'found' || moving) && cell.y <= 1 && s > 0.25) {
            [r, g, b] = heatColor(0.3 + 0.35 * pulse);
            a = Math.max(a, 0.35 + 0.35 * pulse * s);
          }
        }
        if (rippleA > 0 && !filled) a = Math.max(a, rippleA * 0.5);
        square(x, y, r, g, b, a);
      }

      // The found models: hovering over the folder, then streaming in.
      if (st === 'found' || moving || st === 'done') {
        if (st === 'found') {
          while (motes.length < count) {
            const i = motes.length;
            const home = homeOf(i, count, t);
            // They rise out of the field toward their spot, staggered.
            motes.push({ x: home.x + (hash(i, 9) - 0.5) * 18, y: home.y + 10 + hash(i, 4) * 6, sx: 0, sy: 0, home: i, seed: hash(i, 11), phase: 'hover', t: -i * 0.06, delay: 0 });
          }
        }
        const mouthX = fx + FW / 2, mouthY = fy + LIP;
        for (let i = motes.length - 1; i >= 0; i--) {
          const m = motes[i];
          m.t += dt;
          if (m.phase === 'hover') {
            const home = homeOf(m.home, count, t);
            const k = reduce ? 1 : Math.min(1, dt * 4.5);
            m.x += (home.x - m.x) * k;
            m.y += (home.y - m.y) * k;
            // Hovering models glint now and then, like files catching the light.
            const glint = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(t * (1.8 + m.seed * 2) + m.seed * 30);
            const [r, g, b] = heatColor(0.45 + 0.5 * glint);
            square(Math.round(m.x), Math.round(m.y), r, g, b, clamp01(m.t * 3) * (0.65 + 0.35 * glint));
          } else if (m.phase === 'fly') {
            const k = ease((m.t - m.delay) / 0.75);
            if (m.t < m.delay) {
              const [r, g, b] = heatColor(0.8);
              square(Math.round(m.x), Math.round(m.y), r, g, b, 0.9);
              continue;
            }
            // A short arc up, then down into the folder mouth.
            m.x = m.sx + (mouthX + (m.seed - 0.5) * 6 - m.sx) * k;
            m.y = m.sy + (mouthY - m.sy) * k - Math.sin(k * Math.PI) * 3;
            const [r, g, b] = heatColor(0.75 + 0.25 * k);
            square(Math.round(m.x), Math.round(m.y), r, g, b, 1);
            if (k >= 1) {
              m.phase = 'in';
              landed += 1;
              for (let n = 0; n < 3 && !reduce; n++) sparks.push({ x: m.x, y: mouthY, vx: (Math.random() - 0.5) * 6, vy: -(3 + Math.random() * 5), life: 1, decay: 1.2 + Math.random() });
            }
          }
        }
        // Waiting on ComfyUI with nothing left to fly: a model now and then keeps the move alive.
        if (moving && !reduce && motes.every((m) => m.phase === 'in') && Math.random() < dt * (st === 'waiting' ? 0.8 : 2)) {
          const edge = Math.random() < 0.5 ? -2 : cols + 2;
          motes.push({ x: edge, y: fy - 4 - Math.random() * 6, sx: edge, sy: fy - 4 - Math.random() * 6, home: 0, seed: Math.random(), phase: 'fly', t: 0, delay: 0 });
        }
      }

      if (!reduce) {
        if (st === 'done' && since < 0.7) {
          let n = Math.floor(50 * dt) + (Math.random() < (50 * dt) % 1 ? 1 : 0);
          while (n-- > 0) sparks.push({ x: fx + 1 + Math.random() * (FW - 2), y: fy, vx: (Math.random() - 0.5) * 9, vy: -(9 + Math.random() * 13), life: 1, decay: 0.6 + Math.random() * 0.9 });
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
          const p = sparks[i];
          p.x += p.vx * dt + Math.sin(t * 6 + i) * dt * 1.2;
          p.y += p.vy * dt;
          p.vy *= 0.985;
          p.life -= p.decay * dt;
          if (p.life <= 0 || p.y < -2) { sparks.splice(i, 1); continue; }
          const [r, g, b] = heatColor(0.25 + p.life * 0.75);
          square(Math.floor(p.x), Math.floor(p.y), r, g, b, p.life);
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

  useEffect(() => { wakeRef.current(); }, [stage, files]);

  return (
    <div className={className} data-stage={stage} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}

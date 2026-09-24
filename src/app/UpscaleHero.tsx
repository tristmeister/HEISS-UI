import React, { useEffect, useRef } from 'react';
import type { UpscaleSetupStage } from './useUpscale';

/**
 * The smart upscale setup hero: upscaling, drawn literally. A flowing gray
 * field sits in coarse 4×4 blocks around a pixel arrow (the same arrow as the
 * tile button). As the weights arrive the arrow fills with heat from the base,
 * and resolution burns outward from it: each block splits into 2×2, then into
 * single cells, flashing ember as it goes, the way the mosaic button burns.
 *
 * Every stage of setup has its own quiet motion:
 * - checking / offline / nodes: a search beam sweeps the field and a spark
 *   runs round the arrow's outline, watching for ComfyUI.
 * - models: the outline stands ready, embers smoulder at its base.
 * - downloading: the arrow fills with the download, the field sharpens outward.
 * - verifying: everything is resolved; a scan line checks it bottom to top.
 * - ready: a ripple of heat, then the arrow cools to solid white.
 * - error: the heat dies back to a dull red.
 */

export const ARROW = [
  '.......X.......',
  '......XXX......',
  '.....XXXXX.....',
  '....XXXXXXX....',
  '...XXXXXXXXX...',
  '..XXXXXXXXXXX..',
  '.XXXXXXXXXXXXX.',
  'XXXXXXXXXXXXXXX',
  '....XXXXXXX....',
  '....XXXXXXX....',
  '....XXXXXXX....',
  '....XXXXXXX....',
  '....XXXXXXX....',
  '....XXXXXXX....',
  '....XXXXXXX....'
];
const AW = ARROW[0].length;
const AH = ARROW.length;
const inArrow = (x: number, y: number) => x >= 0 && y >= 0 && x < AW && y < AH && ARROW[y][x] === 'X';
const ARROW_CELLS: Array<{ x: number; y: number; edge: boolean }> = [];
for (let y = 0; y < AH; y++) {
  for (let x = 0; x < AW; x++) {
    if (!inArrow(x, y)) continue;
    const edge = !inArrow(x - 1, y) || !inArrow(x + 1, y) || !inArrow(x, y - 1) || !inArrow(x, y + 1);
    ARROW_CELLS.push({ x, y, edge });
  }
}
// The outline in walking order, for the spark that runs round it while searching.
const OUTLINE = (() => {
  const edges = ARROW_CELLS.filter((cell) => cell.edge);
  const cx = (AW - 1) / 2, cy = AH * 0.55;
  return edges.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
})();

const BLOCK = 4;

export function hash(x: number, y: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** The site's chrome flow, cheapened for the CPU: warped noise folded into soft bands. */
export function field(x: number, y: number, t: number) {
  const q = noise(x * 0.06 + t * 0.05, y * 0.08 - t * 0.02);
  const n = noise(x * 0.045 + q * 2.4 - t * 0.03, y * 0.07 + t * 0.02) * 0.7 + noise(x * 0.19, y * 0.19 + t * 0.06) * 0.3;
  const band = 0.5 + 0.5 * Math.sin(n * 9 + q * 3.2 - t * 0.45);
  return Math.min(1, band * band * (0.3 + 0.9 * n));
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Heat to colour, as the mosaic button does it: deep red, ember, then white-hot. */
export function heatColor(h: number): [number, number, number] {
  if (h < 0.5) {
    const k = h / 0.5;
    return [170 + 85 * k, 40 + 114 * k, 20 + 62 * k];
  }
  const k = (h - 0.5) / 0.5;
  return [255, 154 + 88 * k, 82 + 128 * k];
}

type Spark = { x: number; y: number; vx: number; vy: number; life: number; decay: number };

export function UpscaleHero({ stage, progress = 0, className }: { stage: UpscaleSetupStage; progress?: number; className?: string }) {
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let w = 0, h = 0, pitch = 1, gap = 1, cols = 0, rows = 0, ox = 0, oy = 0, ax = 0, ay = 0;
    let bcols = 0, brows = 0;
    let blocks: Array<{ seed: number; level: number; heat: number; dist: number }> = [];
    const resize = () => {
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch) return false;
      const nw = Math.round(cw * dpr), nh = Math.round(ch * dpr);
      if (nw === w && nh === h) return true;
      w = canvas.width = nw;
      h = canvas.height = nh;
      // Whole device pixels per cell keep every square crisp.
      pitch = Math.max(4, Math.round(Math.max(5, Math.min(8, cw / 70)) * dpr));
      gap = Math.max(1, Math.round(pitch * 0.2));
      cols = Math.ceil(w / pitch) + BLOCK;
      rows = Math.ceil(h / pitch) + BLOCK;
      // Align blocks to the arrow so the field splits symmetrically around it.
      ax = Math.floor(w / pitch / 2) - Math.floor(AW / 2);
      ay = Math.floor(h / pitch / 2) - Math.floor(AH / 2);
      const shiftX = ((ax % BLOCK) + BLOCK) % BLOCK, shiftY = ((ay % BLOCK) + BLOCK) % BLOCK;
      ox = (shiftX - BLOCK) * pitch + Math.floor((w - Math.floor(w / pitch) * pitch) / 2);
      oy = (shiftY - BLOCK) * pitch + Math.floor((h - Math.floor(h / pitch) * pitch) / 2);
      ax += BLOCK - shiftX;
      ay += BLOCK - shiftY;
      bcols = Math.ceil(cols / BLOCK);
      brows = Math.ceil(rows / BLOCK);
      const acx = ax + AW / 2, acy = ay + AH / 2;
      const maxDist = Math.hypot(Math.max(acx, cols - acx), Math.max(acy, rows - acy));
      blocks = Array.from({ length: bcols * brows }, (_, i) => {
        const bx = (i % bcols) * BLOCK + BLOCK / 2, by = Math.floor(i / bcols) * BLOCK + BLOCK / 2;
        return { seed: hash(i, 7), level: 0, heat: 0, dist: Math.hypot((bx - acx) * 0.8, by - acy) / maxDist };
      });
      return true;
    };

    const sparks: Spark[] = [];
    let lastStage = stageRef.current;
    let changedAt = 0;
    let fill = 0;
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
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = reduce ? 6 : (now - t0) / 1000;
      const st = stageRef.current;
      if (st !== lastStage) { lastStage = st; changedAt = t; }
      const since = t - changedAt;
      const searching = st === 'checking' || st === 'offline' || st === 'nodes';
      const resolved = st === 'verifying' || st === 'ready';
      const target = st === 'downloading' ? clamp01(progressRef.current) : resolved ? 1 : st === 'error' ? fill : 0;
      fill += reduce ? target - fill : (target - fill) * Math.min(1, dt * 4);

      ctx.clearRect(0, 0, w, h);
      const acx = ax + AW / 2, acy = ay + AH / 2;

      // Search beam: a soft column sweeping the field while setup waits on ComfyUI.
      const beamX = searching ? ((t * (st === 'offline' ? 0.22 : 0.34)) % 1.3 - 0.15) * cols : -99;
      // A ripple of heat on every step forward, a big one when setup completes.
      const rippleR = since * (st === 'ready' ? 34 : 26);
      const rippleA = st === 'ready' ? Math.max(0, 1 - since / 1.6) : Math.max(0, 0.55 - since / 1.2);
      // Verification scans the resolved field from the bottom up.
      const scanY = st === 'verifying' ? rows - ((since * 0.9) % 1.2) * rows : -99;

      for (let by = 0; by < brows; by++) {
        for (let bx = 0; bx < bcols; bx++) {
          const block = blocks[by * bcols + bx];
          // The resolution front: blocks near the arrow resolve first.
          let goal = 0;
          if (st === 'downloading' || resolved) {
            const d = fill * 1.3 - (block.dist + block.seed * 0.18);
            goal = d > 0.1 ? 2 : d > 0 ? 1 : 0;
          } else if (st === 'models') {
            goal = block.dist < 0.16 + 0.03 * Math.sin(t * 1.4) ? 1 : 0;
          } else if (st === 'error') {
            goal = Math.min(block.level, 1);
          } else if (!reduce && block.seed > 0.96) {
            // At rest a few blocks breathe to 2×2 and back, so the field never looks frozen.
            goal = Math.sin(t * 0.8 + block.seed * 60) > 0.6 ? 1 : 0;
          }
          if (goal > block.level) block.heat = st === 'downloading' || resolved ? 1 : 0.4;
          block.level = goal;
          block.heat = reduce ? 0 : Math.max(0, block.heat - dt * 1.4);

          const sub = block.level === 2 ? 1 : block.level === 1 ? 2 : BLOCK;
          const size = sub * pitch - gap;
          for (let sy = 0; sy < BLOCK; sy += sub) {
            for (let sx = 0; sx < BLOCK; sx += sub) {
              const x = bx * BLOCK + sx, y = by * BLOCK + sy;
              const cx = x + sub / 2, cy = y + sub / 2;
              const lx = Math.floor(cx) - ax, ly = Math.floor(cy) - ay;
              // Nothing under the arrow, and a one-cell moat round it where the field is fine.
              if (inArrow(lx, ly) || (sub === 1 && (inArrow(lx - 1, ly) || inArrow(lx + 1, ly) || inArrow(lx, ly - 1) || inArrow(lx, ly + 1)))) continue;
              if (sub > 1 && ARROW_CELLS.some((c) => c.x + ax >= x && c.x + ax < x + sub && c.y + ay >= y && c.y + ay < y + sub)) continue;
              const v = field(cx, cy, t);
              // The field stays quiet so the arrow carries the scene: dimmer close
              // to it, and a finer block shows more contrast, as detail should.
              const near = Math.hypot((cx - acx) * 0.8, cy - acy);
              const hush = 0.35 + 0.65 * clamp01((near - AH * 0.55) / (AH * 0.9));
              const contrast = block.level === 2 ? v * v * 1.5 : block.level === 1 ? v * 1.1 : v * 0.8;
              let a = (0.025 + 0.2 * contrast) * hush * (st === 'offline' ? 0.6 : 1);
              let r = 255, g = 255, b = 255;
              let heat = block.heat * (0.5 + 0.5 * hash(x, y));
              if (beamX > -50) {
                const k = Math.exp(-Math.pow((cx - beamX) / 3.2, 2));
                a += k * 0.16;
              }
              if (rippleA > 0) {
                const dist = Math.hypot((cx - acx) * 0.8, cy - acy);
                heat = Math.max(heat, Math.exp(-Math.pow((dist - rippleR) / 2.4, 2)) * rippleA * (0.6 + 0.4 * hash(x + 3, y)));
              }
              if (scanY > -50) a += Math.exp(-Math.pow((cy - scanY) / 1.6, 2)) * 0.3;
              if (st === 'error') { g = 200; b = 190; a *= 0.7; }
              if (heat > 0.02) {
                const [hr, hg, hb] = heatColor(heat);
                const k = Math.min(1, heat * 1.4);
                r = r + (hr - r) * k; g = g + (hg - g) * k; b = b + (hb - b) * k;
                a = Math.max(a, heat * 0.85);
              }
              square(x, y, size, r, g, b, a);
            }
          }
        }
      }

      // The arrow: a ghost outline while searching, heat filling it from the base
      // while downloading, white when it is done.
      const fillRow = AH - fill * AH;
      const cool = st === 'ready' ? clamp01((since - 0.35) / 0.9) : st === 'verifying' ? clamp01(since / 1.2) * 0.6 : 0;
      const runner = searching ? (t * 9) % OUTLINE.length : -99;
      for (const cell of ARROW_CELLS) {
        const x = cell.x + ax, y = cell.y + ay;
        const s = hash(x * 3, y * 5);
        let r = 255, g = 255, b = 255, a: number;
        const filled = cell.y + 0.5 >= fillRow && (st === 'downloading' || resolved || st === 'error');
        if (filled) {
          // Hottest at the fill line, cooler toward the base; twinkling like embers.
          const depth = (cell.y - fillRow) / AH;
          const edge = Math.max(0, 1 - (cell.y - fillRow) / 1.6);
          const twinkle = reduce ? 0.8 : 0.7 + 0.3 * Math.sin(t * (2.5 + s * 3) + s * 40);
          const heat = Math.min(1, 0.35 + 0.35 * (1 - depth) * twinkle + edge * 0.6);
          [r, g, b] = heatColor(st === 'error' ? heat * 0.35 : heat);
          a = st === 'error' ? 0.55 : 0.75 + 0.25 * twinkle;
          if (cool > 0) {
            r += (244 - r) * cool; g += (244 - g) * cool; b += (244 - b) * cool;
            a += (1 - a) * cool;
          }
        } else if (searching) {
          const i = cell.edge ? OUTLINE.indexOf(cell) : -1;
          const behind = i >= 0 ? (runner - i + OUTLINE.length) % OUTLINE.length : 99;
          const trail = behind < 7 ? 1 - behind / 7 : 0;
          a = (cell.edge ? 0.2 : 0.045) * (st === 'offline' ? 0.7 : 1) + trail * 0.75;
          if (trail > 0.02) [r, g, b] = heatColor(0.55 + trail * 0.45);
        } else if (st === 'error') {
          [r, g, b] = [255, 120, 100];
          a = cell.edge ? 0.45 : 0.06;
        } else {
          const pulse = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(t * 2.1 - cell.y * 0.35);
          a = cell.edge ? 0.42 + 0.22 * pulse : 0.07 + 0.04 * pulse;
          if (st === 'models' && cell.y >= AH - 2 && s > 0.35) {
            [r, g, b] = heatColor(0.3 + 0.35 * pulse);
            a = 0.35 + 0.4 * pulse * s;
          }
        }
        if (rippleA > 0 && !filled) a = Math.max(a, rippleA * 0.5);
        square(x, y, pitch - gap, r, g, b, a);
      }

      // Sparks lift off the fill line, drift, and go out: whole cells, like the rest.
      if (!reduce) {
        const spawn = st === 'downloading' ? 16 : st === 'models' ? 2.5 : st === 'ready' && since < 0.8 ? 60 : 0;
        let count = Math.floor(spawn * dt) + (Math.random() < (spawn * dt) % 1 ? 1 : 0);
        while (count-- > 0) {
          const onTip = st === 'ready';
          const rowY = onTip ? 0 : st === 'models' ? AH - 1 : Math.max(0, Math.min(AH - 1, Math.floor(fillRow)));
          const span = ARROW_CELLS.filter((c) => c.y === rowY);
          const from = span[Math.floor(Math.random() * span.length)] || { x: AW / 2, y: 0 };
          sparks.push({
            x: ax + from.x + 0.5, y: ay + from.y,
            vx: (Math.random() - 0.5) * (onTip ? 10 : 3),
            vy: -(onTip ? 10 + Math.random() * 14 : 4 + Math.random() * 6),
            life: 1, decay: 0.6 + Math.random() * 0.9
          });
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
          const p = sparks[i];
          p.x += p.vx * dt + Math.sin(t * 6 + i) * dt * 1.2;
          p.y += p.vy * dt;
          p.vy *= 0.985;
          p.life -= p.decay * dt;
          if (p.life <= 0 || p.y < -BLOCK) { sparks.splice(i, 1); continue; }
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
    const ro = new ResizeObserver(wake);
    ro.observe(canvas);
    wake();
    return () => { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); };
  }, []);

  // Reduced motion draws one frame per change; otherwise the loop is already running.
  useEffect(() => { wakeRef.current(); }, [stage, progress]);

  return (
    <div className={className} data-stage={stage} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}

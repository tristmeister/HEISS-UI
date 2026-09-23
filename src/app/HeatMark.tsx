import React, { useEffect, useRef } from 'react';

/**
 * The website's footer wordmark, brought into the app: "HEISS UI" in pixel
 * letters that develop out of a gray flow mosaic. A small, dense flame
 * stands on the pointer and warms the letters beside it. Press to stoke it.
 *
 * The site draws its letters with PP Neue Bit, which must not ship with the
 * app, so the letters here come from a tiny built-in 5x7 pixel alphabet. The
 * shader is the site's (docs/fx.js), with a faint ember glow at rest.
 */

const GLYPHS: Record<string, string[]> = {
  H: ['X...X', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  E: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'XXXXX'],
  I: ['XXX', '.X.', '.X.', '.X.', '.X.', '.X.', 'XXX'],
  S: ['.XXXX', 'X....', 'X....', '.XXX.', '....X', '....X', 'XXXX.'],
  U: ['X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  ' ': ['..', '..', '..', '..', '..', '..', '..']
};
const TEXT = 'HEISS UI';
const SUB = 3;            // shader cells per letter pixel
const ROWS = 7;
const MARGIN_X = 3;       // cells
const BELOW = 3;          // cells under the letters
const ABOVE = 12;         // cells of headroom for steam
const letterCols = [...TEXT].reduce((sum, ch, i) => sum + GLYPHS[ch][0].length + (i < TEXT.length - 1 ? 1 : 0), 0);
const GRID_W = letterCols * SUB + MARGIN_X * 2;
const GRID_H = ROWS * SUB + BELOW + ABOVE;
export const heatMarkAspect = `${GRID_W} / ${GRID_H}`;

const COMMON = `
  precision highp float;
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uDpr;
  float hash(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
    return v;
  }
  float chrome(vec2 p, float t) {
    vec2 q = vec2(fbm(p + vec2(0.0, t * 0.07)), fbm(p + vec2(5.2, 1.3) - t * 0.05));
    float v = fbm(p + 2.4 * q + vec2(t * 0.03, 0.0));
    float b = 0.5 + 0.5 * sin(v * 11.0 + q.x * 4.0 - t * 0.35);
    return clamp(b * b * (0.35 + 0.9 * v), 0.0, 1.0);
  }
  float cellSquare(vec2 f, float s, float aa) { float d = max(abs(f.x), abs(f.y)); return 1.0 - smoothstep(s - aa, s, d); }
`;

const MARK = `
  uniform sampler2D uMask;
  uniform float uCell;
  uniform vec4 uBox;
  uniform float uP;
  uniform vec2 uMouse;
  uniform vec2 uTip;
  uniform float uSpeed;
  uniform float uHeat;
  uniform float uEmber;

  void main() {
    vec2 g = gl_FragCoord.xy / uCell;
    vec2 id = floor(g);
    vec2 f = g - id - 0.5;
    vec2 c = (id + 0.5) * uCell;
    vec2 uv = c / uRes;

    float ink = step(0.5, texture2D(uMask, uv).a);
    vec2 bq = (c - uBox.xy) / uBox.zw;
    float inBox = step(0.0, bq.x) * step(bq.x, 1.0) * step(0.0, bq.y) * step(bq.y, 1.0);
    float h = hash(id);
    float v = chrome(c / (uDpr * 300.0), uTime);

    float n = fbm(bq * vec2(3.0, 1.2) + 3.0);
    float lp = smoothstep(0.0, 1.0, clamp(uP * 2.0 - n * 0.5 - bq.x * 0.35 - h * 0.15, 0.0, 1.0));

    // Fire: a small, dense flame standing on the pointer, not a glow around it.
    // rel is in CSS pixels, y up. The base sits on the pointer; the tip trails
    // behind on its own slower spring (uTip), so the flame bends into its
    // movement and straightens when it rests. Speed stretches and thins it.
    vec2 rel = (c - uMouse) / uDpr;
    float R = 14.0 + 5.0 * uHeat;
    float breathe = 0.9 + 0.1 * sin(uTime * 3.1) + 0.06 * sin(uTime * 7.3);
    float H = (40.0 + 28.0 * uHeat) * breathe * (1.0 + 0.35 * uSpeed);
    vec2 tipOff = clamp((uTip - uMouse) / uDpr, vec2(-R * 2.2), vec2(R * 2.2));
    float up = rel.y / H;
    float upc = clamp(up, 0.0, 1.0);
    float bend = tipOff.x * upc * upc;
    float sway = (fbm(vec2(rel.y * 0.05 - uTime * 2.4, 7.0)) - 0.5) * R * 1.4 * upc;
    float xw = rel.x - bend + sway;
    float width = R * pow(1.0 - upc, 0.6) * (1.0 - 0.12 * uSpeed) * (1.0 + 0.25 * abs(tipOff.x) / (R * 2.2)) + 2.0;
    // A rounded base under the pointer and a ragged, flickering tip: no flat cuts.
    float base = rel.y < 0.0 ? exp(-pow(rel.y / (R * 0.6), 2.0)) : 1.0;
    float tipNoise = fbm(vec2(xw * 0.08, uTime * 1.7));
    float top = 1.0 - smoothstep(0.5 + 0.3 * tipNoise, 1.05, up);
    float body = exp(-pow(xw / width, 2.0) * 2.0) * base * top;
    float tongues = fbm(vec2(xw * 0.1 + 3.0, rel.y * 0.06 - uTime * 2.8));
    float lit = smoothstep(0.0, 0.3, uHeat);
    // Soft threshold: edges fade through dim red instead of stopping hard.
    float fire = smoothstep(0.16, 0.8, body * (0.55 + 0.9 * tongues)) * lit;
    // A few embers lift off the tip, following its lean.
    float emberCell = step(0.965, hash(id + floor(uTime * 6.0))) * exp(-pow((rel.x - tipOff.x * 0.9) / (R * 1.4), 2.0)) * step(H * 0.5, rel.y) * (1.0 - smoothstep(H * 0.95, H * 1.5, rel.y)) * lit;
    // Temperature falls toward the tip: white only in the core at the base.
    float temp = fire * (1.0 - upc * 0.8);
    vec3 fireC = mix(vec3(0.62, 0.1, 0.03), vec3(1.0, 0.4, 0.08), smoothstep(0.08, 0.35, temp));
    fireC = mix(fireC, vec3(1.0, 0.72, 0.25), smoothstep(0.4, 0.65, temp));
    fireC = mix(fireC, vec3(1.0, 0.95, 0.78), smoothstep(0.78, 0.95, temp));
    fireC = mix(fireC, vec3(1.0, 0.45, 0.12), emberCell * (1.0 - fire));

    // Letters only warm right beside the flame; at rest they smoulder from the bottom up.
    float near = exp(-dot(rel, rel) / (R * R * 9.0)) * uHeat;
    float ember = uEmber * (1.0 - smoothstep(0.0, 0.7, bq.y)) * (0.25 + 0.75 * v) * step(0.55, fract(h * 7.0 + uTime * 0.35));
    float glow = clamp(near * (0.4 + 0.6 * v) + ember * 0.55, 0.0, 1.0);

    vec3 genC = mix(vec3(0.2), vec3(0.75), v);
    float genA = inBox * (0.1 + 0.45 * v);

    float shade = mix(0.24, 0.46, bq.y) + 0.06 * v;
    vec3 hot = mix(vec3(1.0, 0.45, 0.18), vec3(1.0, 0.86, 0.66), v);
    vec3 txtC = mix(vec3(shade), hot, glow);

    vec3 col = mix(genC, txtC, lp);
    float a = mix(genA, ink, lp);

    // Quiet steam from the letter tops, never louder on hover.
    float above = c.y - (uBox.y + uBox.w);
    float stem = texture2D(uMask, vec2(uv.x, (uBox.y + uBox.w - uCell * 0.5) / uRes.y)).a;
    float band = step(0.0, above) * (1.0 - smoothstep(0.0, uBox.w * 0.5, above));
    float wob = sin(id.y * 0.45 - uTime * 1.2) * 1.4;
    float s = noise(vec2((id.x + wob) * 0.5, id.y * 0.3 - uTime * 1.5));
    float steamA = band * step(0.5, stem) * step(0.7, s) * lp * uEmber * 0.16 * (1.0 - above / (uBox.w * 0.5));
    col = mix(col, vec3(0.5), step(0.001, steamA) * (1.0 - ink));
    a = max(a, steamA);

    float flame = max(fire, emberCell * 0.8) * lp;
    col = mix(col, fireC, flame);
    a = max(a, flame);

    float sq = cellSquare(f, 0.44, 1.0 / uCell);
    gl_FragColor = vec4(col * a * sq, a * sq);
  }
`;

function drawMask(canvas: HTMLCanvasElement, cell: number, width: number, height: number) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  const px = cell * SUB;
  const top = height - (BELOW + ROWS * SUB) * cell;
  let x = MARGIN_X * cell;
  for (const ch of TEXT) {
    const rows = GLYPHS[ch];
    rows.forEach((row, r) => {
      [...row].forEach((bit, col) => { if (bit === 'X') ctx.fillRect(x + col * px, top + r * px, px, px); });
    });
    x += (rows[0].length + 1) * px;
  }
  // Box in GL coordinates (y up): left, bottom, width, height.
  return [MARGIN_X * cell, BELOW * cell, letterCols * px, ROWS * px] as const;
}

export function HeatMark({ className }: { className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vs = compile(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}');
    const fs = compile(gl.FRAGMENT_SHADER, COMMON + MARK);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(prog, name);
    gl.uniform1i(u('uMask'), 0);
    gl.uniform1f(u('uDpr'), dpr);
    const texture = gl.createTexture();
    const mask = document.createElement('canvas');

    let size = { w: 0, h: 0, cell: 1 };
    const layout = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      const cell = Math.max(2, Math.floor(Math.min(w / GRID_W, h / GRID_H)));
      if (w === size.w && h === size.h) return;
      canvas.width = w;
      canvas.height = h;
      size = { w, h, cell };
      gl.viewport(0, 0, w, h);
      const box = drawMask(mask, cell, w, h);
      if (!box) return;
      // Centre the grid-aligned letters: shift by whole cells so pixels stay on the grid.
      const spare = Math.floor((w - GRID_W * cell) / 2 / cell) * cell;
      const shifted = document.createElement('canvas');
      shifted.width = w;
      shifted.height = h;
      shifted.getContext('2d')?.drawImage(mask, spare, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, shifted);
      for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, value);
      gl.uniform1f(u('uCell'), cell);
      gl.uniform4f(u('uBox'), box[0] + spare, box[1], box[2], box[3]);
      gl.uniform2f(u('uRes'), w, h);
    };

    // Pointer in canvas device pixels (y up), eased; heat builds while hovering, a press flares it.
    const p = { x: -1e5, y: -1e5, tx: -1e5, ty: -1e5, vx: 0, vy: 0, bx: -1e5, by: -1e5, bvx: 0, bvy: 0, speed: 0, on: 0, heat: 0, flare: 0 };
    const move = (event: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      p.tx = (event.clientX - r.left) * dpr;
      p.ty = (r.bottom - event.clientY) * dpr;
      if (p.x < -1e4) { p.x = p.bx = p.tx; p.y = p.by = p.ty; }
      p.on = 1;
    };
    const leave = () => { p.on = 0; };
    const press = (event: PointerEvent) => { move(event); p.flare = 1; };
    wrap.addEventListener('pointermove', move, { passive: true });
    wrap.addEventListener('pointerleave', leave);
    wrap.addEventListener('pointerdown', press);

    const t0 = performance.now();
    let raf = 0;
    let visible = true;
    const frame = (now: number) => {
      raf = 0;
      const t = (now - t0) / 1000;
      layout();
      // The base follows the pointer on a soft spring (a slight, fluid delay);
      // the tip follows the base on a slower one, so the flame trails and bends.
      p.vx = (p.vx + (p.tx - p.x) * 0.075) * 0.74;
      p.vy = (p.vy + (p.ty - p.y) * 0.075) * 0.74;
      p.x += p.vx;
      p.y += p.vy;
      p.bvx = (p.bvx + (p.x - p.bx) * 0.045) * 0.8;
      p.bvy = (p.bvy + (p.y - p.by) * 0.045) * 0.8;
      p.bx += p.bvx;
      p.by += p.bvy;
      p.speed += (Math.min(1, Math.hypot(p.vx, p.vy) / (dpr * 14)) - p.speed) * 0.2;
      p.heat += (p.on - p.heat) * (p.on ? 0.16 : 0.06);
      p.flare *= 0.94;
      const reveal = reduce ? 1 : Math.min(1, Math.max(0, (t - 0.15) / 1.8));
      gl.uniform1f(u('uTime'), reduce ? 4 : t);
      gl.uniform1f(u('uP'), 1 - Math.pow(1 - reveal, 3));
      gl.uniform2f(u('uMouse'), p.x, p.y);
      gl.uniform2f(u('uTip'), p.bx, p.by);
      gl.uniform1f(u('uSpeed'), p.speed);
      gl.uniform1f(u('uHeat'), reduce ? 0 : Math.min(1.6, p.heat + p.flare * 0.8));
      gl.uniform1f(u('uEmber'), reduce ? 0.4 : 1);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduce && visible) raf = requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && document.visibilityState !== 'hidden';
      if (visible && !raf) raf = requestAnimationFrame(frame);
    });
    io.observe(wrap);
    const ro = new ResizeObserver(() => { if (reduce) frame(performance.now()); });
    ro.observe(canvas);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      wrap.removeEventListener('pointermove', move);
      wrap.removeEventListener('pointerleave', leave);
      wrap.removeEventListener('pointerdown', press);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return (
    <div ref={wrapRef} className={className} style={{ aspectRatio: heatMarkAspect }} role="img" aria-label="HEISS UI">
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}

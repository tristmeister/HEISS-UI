import React, { useEffect, useRef, useState } from 'react';
import { COMMON } from './HeatMark';

/**
 * The offline empty state: a pixel plug (HEISS) and socket (ComfyUI) in the
 * same gray cell mosaic as the About wordmark. A warm pulse runs down the
 * HEISS cable, the plug reaches for the socket, a spark tries to jump the gap
 * and dies into a few embers. Then it tries again.
 *
 * One fragment shader over a tiny cell mask, capped at 30 fps, paused while
 * hidden or scrolled away, a single still frame for reduced motion, and the
 * static logo when WebGL is not available.
 */

const W = 60;
const H = 24;
const TIP = 26;   // first cell past the prongs
const FACE = 38;  // socket face
const CYCLE = 5.2;

type Rect = [x: number, y: number, w: number, h: number];
// Cells, top-down. R = plug side, G = socket side, B = cable.
const PLUG: Rect[] = [[12, 12, 2, 3], [14, 9, 8, 9], [22, 11, 4, 1], [22, 15, 4, 1]];
const PLUG_CUT: Rect[] = [[14, 9, 1, 1], [21, 9, 1, 1], [14, 17, 1, 1], [21, 17, 1, 1]];
const SOCKET: Rect[] = [[38, 9, 8, 9], [46, 12, 2, 3]];
const SOCKET_CUT: Rect[] = [[38, 9, 1, 1], [45, 9, 1, 1], [38, 17, 1, 1], [45, 17, 1, 1], [38, 11, 2, 1], [38, 15, 2, 1]];
const CABLES: Rect[] = [[0, 13, 12, 1], [48, 13, 12, 1]];

const SCENE = `
  uniform sampler2D uMask;
  uniform float uCell;
  uniform vec2 uOrigin;
  uniform vec2 uGrid;
  uniform float uReveal;
  uniform float uPulse;
  uniform float uPulseA;
  uniform float uOL;
  uniform float uOR;
  uniform float uWarm;
  uniform float uSpark;
  uniform float uAfter;

  vec3 fire(float temp) {
    vec3 c = mix(vec3(0.62, 0.1, 0.03), vec3(1.0, 0.4, 0.08), smoothstep(0.08, 0.35, temp));
    c = mix(c, vec3(1.0, 0.72, 0.25), smoothstep(0.4, 0.65, temp));
    return mix(c, vec3(1.0, 0.95, 0.78), smoothstep(0.78, 0.95, temp));
  }
  vec3 sampleMask(vec2 cell) { return texture2D(uMask, (cell + 0.5) / uGrid).rgb; }

  void main() {
    vec2 g = (gl_FragCoord.xy - uOrigin) / uCell;
    vec2 id = floor(g);
    if (id.x < 0.0 || id.y < 0.0 || id.x >= uGrid.x || id.y >= uGrid.y) { gl_FragColor = vec4(0.0); return; }
    float sq = cellSquare(g - id - 0.5, 0.44, 1.0 / uCell);
    if (sq <= 0.0) { gl_FragColor = vec4(0.0); return; }

    vec2 cell = vec2(id.x, uGrid.y - 1.0 - id.y);  // top-down, like the mask
    float h = hash(id);
    float t = uTime;
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

    if (solid > 0.5) {
      float v = chrome(cell / 18.0, t);
      float rowShade = mix(0.52, 0.3, (cell.y - 9.0) / 9.0);
      if (plug > 0.5) {
        // The plug smoulders from the bottom and warms from the prongs when the pulse lands.
        float fromTip = max(0.0, TIP_X + uOL - cell.x);
        float warm = uWarm * exp(-fromTip / 5.0) * (0.55 + 0.45 * v);
        float smoulder = smoothstep(12.0, 17.0, cell.y) * step(0.62, fract(h * 7.0 + t * 0.35)) * 0.35;
        float cable = L.b;
        float d = cell.x - uPulse;
        float pulse = cable * uPulseA * (d < 0.0 ? exp(d / 4.0) : exp(-d * d / 1.5));
        float glow = clamp(max(warm, smoulder * (1.0 - cable)), 0.0, 1.0);
        // Grip ribs: recessed columns, not holes.
        float px = cell.x - uOL;
        float rib = (step(abs(px - 16.0), 0.1) + step(abs(px - 18.0), 0.1)) * step(11.0, cell.y) * step(cell.y, 15.0);
        float base = (rowShade + 0.08 * v) * (1.0 - 0.4 * rib);
        col = mix(vec3(base), mix(vec3(1.0, 0.45, 0.18), vec3(1.0, 0.86, 0.66), v), glow);
        col = mix(col, fire(pulse), clamp(pulse * 1.4, 0.0, 1.0));
        a = 1.0;
      } else {
        // The ComfyUI side stays cold: dimmer, with dead static crawling down its cable.
        float stat = R.b * step(0.82, hash(id + floor(t * 3.0))) * 0.12;
        float flash = uSpark * exp(-max(0.0, cell.x - (FACE_X - uOR)) / 2.5) * 0.35;
        col = vec3(rowShade * 0.72 + 0.05 * v - stat) + vec3(0.75, 0.82, 1.0) * flash;
        a = 0.9;
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
    // The flash lights the mosaic around the gap for a moment.
    float gx = (cell.x - (lo + hi) * 0.5) / 9.0;
    float gy = (cell.y - 13.0) / 6.0;
    float ambient = uSpark * exp(-(gx * gx + gy * gy)) * (1.0 - solid) * step(0.45, h);

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
    float heat = clamp(max(spark, embers * 0.85), 0.0, 1.0);
    if (heat > 0.0) {
      float temp = spark > 0.0 ? (arc > 0.5 ? 0.8 + 0.2 * hash(id + strike * 0.3) : 0.35) : 0.45 * (1.0 - uAfter) + 0.12;
      col = mix(col, fire(temp), clamp(heat * 2.0, 0.0, 1.0));
      a = max(a, heat);
    }

    // Develop out of the mosaic, like the wordmark.
    float lp = smoothstep(0.0, 1.0, clamp(uReveal * 2.0 - fbm(cell * 0.2 + 3.0) * 0.6 - h * 0.2, 0.0, 1.0));
    a *= lp;
    gl_FragColor = vec4(col * a * sq, a * sq);
  }
`.replace(/TIP_X/g, TIP.toFixed(1)).replace(/FACE_X/g, FACE.toFixed(1));

function drawMask() {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  const fill = (rects: Rect[], color: string) => { ctx.fillStyle = color; rects.forEach(([x, y, w, h]) => ctx.fillRect(x, y, w, h)); };
  fill(CABLES.slice(0, 1), '#f00');
  fill(CABLES.slice(1), '#0f0');
  fill(CABLES, '#00f');
  fill(PLUG, '#f00');
  fill(SOCKET, '#0f0');
  // Cuts clear their channel only; nothing else overlaps them.
  ctx.globalCompositeOperation = 'source-over';
  fill([...PLUG_CUT, ...SOCKET_CUT], '#000');
  return canvas;
}

/** Where the loop is at time t: pulse, reach, spark and embers. */
function timeline(t: number) {
  const ss = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  const ph = t < 0 ? 0 : (t / CYCLE) % 1;
  const reach = ss(0.28, 0.46, ph) * (1 - ss(0.62, 0.92, ph));
  const oL = Math.round(3 * reach);
  const burst = (a: number, b: number) => (ph > a && ph < b ? Math.sin(((ph - a) / (b - a)) * Math.PI) : 0);
  const spark = Math.max(burst(0.47, 0.52), burst(0.535, 0.585)) * (0.65 + 0.35 * Math.random());
  return {
    pulse: -6 + (TIP + oL + 6) * ss(0, 0.44, ph),
    pulseA: t < 0 ? 0 : 1 - ss(0.42, 0.5, ph),
    oL,
    oR: Math.round(reach),
    warm: ss(0.36, 0.47, ph) * (1 - ss(0.55, 0.95, ph)),
    spark,
    after: ph > 0.5 ? Math.min(1, (ph - 0.5) / 0.42) : 0,
  };
}

export function OfflineMark({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    const mask = drawMask();
    if (!gl || !mask) { setFailed(true); return; }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
      console.warn('OfflineMark shader:', gl.getShaderInfoLog(shader));
      return null;
    };
    const vs = compile(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}');
    const fs = compile(gl.FRAGMENT_SHADER, COMMON + SCENE);
    const prog = gl.createProgram()!;
    if (vs && fs) { gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); }
    if (!vs || !fs || !gl.getProgramParameter(prog, gl.LINK_STATUS)) { setFailed(true); return; }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(prog, name);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, value);
    gl.uniform1i(u('uMask'), 0);
    gl.uniform1f(u('uDpr'), dpr);
    gl.uniform2f(u('uGrid'), W, H);

    let size = { w: 0, h: 0 };
    const layout = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (w === size.w && h === size.h) return;
      size = { w, h };
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      const cell = Math.max(2, Math.floor(Math.min(w / W, h / H)));
      gl.uniform1f(u('uCell'), cell);
      gl.uniform2f(u('uOrigin'), Math.floor((w - W * cell) / 2), Math.floor((h - H * cell) / 2));
      gl.uniform2f(u('uRes'), w, h);
    };

    const t0 = performance.now();
    let raf = 0;
    let last = -1e9;
    let onScreen = true;
    const draw = (now: number) => {
      const t = reduce ? 4 : (now - t0) / 1000;
      layout();
      // The first attempt starts once the scene has developed.
      const state = reduce ? timeline(CYCLE * 0.4) : timeline(t - 1.4);
      const reveal = reduce ? 1 : Math.min(1, Math.max(0, (t - 0.1) / 1.6));
      gl.uniform1f(u('uTime'), t);
      gl.uniform1f(u('uReveal'), 1 - Math.pow(1 - reveal, 3));
      gl.uniform1f(u('uPulse'), state.pulse);
      gl.uniform1f(u('uPulseA'), state.pulseA);
      gl.uniform1f(u('uOL'), state.oL);
      gl.uniform1f(u('uOR'), state.oR);
      gl.uniform1f(u('uWarm'), state.warm);
      gl.uniform1f(u('uSpark'), reduce ? 0 : state.spark);
      gl.uniform1f(u('uAfter'), reduce ? 0 : state.after);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const running = () => !reduce && onScreen && document.visibilityState !== 'hidden';
    const frame = (now: number) => {
      raf = 0;
      // 30 fps is plenty for a pixel grid and halves the GPU time.
      if (now - last >= 32) { last = now; draw(now); }
      if (running()) raf = requestAnimationFrame(frame);
    };
    const wake = () => { if (running() && !raf) raf = requestAnimationFrame(frame); };
    const io = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; wake(); });
    io.observe(canvas);
    const ro = new ResizeObserver(() => { if (!running()) draw(performance.now()); });
    ro.observe(canvas);
    document.addEventListener('visibilitychange', wake);
    const lost = (event: Event) => { event.preventDefault(); setFailed(true); };
    canvas.addEventListener('webglcontextlost', lost);
    draw(performance.now());
    wake();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', wake);
      canvas.removeEventListener('webglcontextlost', lost);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  if (failed) return <img className="offline-mark-fallback" src="/heiss-mark-black.svg" alt="" aria-hidden="true" />;
  return (
    <div className={className} style={{ aspectRatio: `${W} / ${H}` }} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}

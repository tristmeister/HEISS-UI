import { useEffect, useRef, useState } from 'react';
import { COMMON } from './HeatMark';

/**
 * The engine behind the pixel-cell scenes (offline, empty gallery): one
 * fragment shader over a small cell mask, drawn on a grid of rounded squares
 * like the About wordmark.
 *
 * Runs at most 30 fps, pauses while the page is hidden or the canvas is off
 * screen, draws a single still frame for reduced motion, and reports failure
 * (no WebGL, a shader that will not compile, a lost context) so the caller can
 * show a static fallback. Scenes provide their own uniforms each frame.
 */

export type CellRect = [x: number, y: number, w: number, h: number];
export type Uniforms = Record<string, number | [number, number]>;

export type CellSceneConfig = {
  /** Grid size in cells. */
  width: number;
  height: number;
  /** Paints the scene's mask, one pixel per cell, top-down, on black. */
  drawMask: (ctx: CanvasRenderingContext2D) => void;
  /** Declares its own uniforms; COMMON provides uRes, uTime, uDpr, hash, fbm, chrome, cellSquare. */
  fragment: string;
  /** Uniform values for a moment. `t` is seconds since mount (frozen for reduced motion). */
  frame: (t: number, reduce: boolean) => Uniforms;
};

/** Paints rectangles into one mask channel (additively, so channels can overlap). */
export function fillRects(ctx: CanvasRenderingContext2D, rects: CellRect[], color: string) {
  ctx.fillStyle = color;
  for (const [x, y, w, h] of rects) ctx.fillRect(x, y, w, h);
}

/** The frame and cell helpers every scene's shader starts with. */
export const SCENE_HEAD = `
  uniform sampler2D uMask;
  uniform float uCell;
  uniform vec2 uOrigin;
  uniform vec2 uGrid;
  uniform float uReveal;

  vec3 fire(float temp) {
    vec3 c = mix(vec3(0.62, 0.1, 0.03), vec3(1.0, 0.4, 0.08), smoothstep(0.08, 0.35, temp));
    c = mix(c, vec3(1.0, 0.72, 0.25), smoothstep(0.4, 0.65, temp));
    return mix(c, vec3(1.0, 0.95, 0.78), smoothstep(0.78, 0.95, temp));
  }
  vec3 sampleMask(vec2 cell) { return texture2D(uMask, (cell + 0.5) / uGrid).rgb; }
  // Develop out of (or dissolve back into) the mosaic, like the wordmark.
  float develop(vec2 cell, float h) {
    return smoothstep(0.0, 1.0, clamp(uReveal * 2.0 - fbm(cell * 0.2 + 3.0) * 0.6 - h * 0.2, 0.0, 1.0));
  }
`;

/** A cell id for this fragment, or discards outside the grid and between cells. */
export const SCENE_CELL = `
    vec2 g = (gl_FragCoord.xy - uOrigin) / uCell;
    vec2 id = floor(g);
    if (id.x < 0.0 || id.y < 0.0 || id.x >= uGrid.x || id.y >= uGrid.y) { gl_FragColor = vec4(0.0); return; }
    float sq = cellSquare(g - id - 0.5, 0.44, 1.0 / uCell);
    if (sq <= 0.0) { gl_FragColor = vec4(0.0); return; }
    vec2 cell = vec2(id.x, uGrid.y - 1.0 - id.y);
    float h = hash(id);
    float t = uTime;
`;

/** Smoothstep for timelines. */
export const ease = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/**
 * Runs a scene on `canvas`. The config is read on every frame through a ref,
 * so scenes can change their inputs (say, "connected") without restarting.
 */
export function useCellScene(config: CellSceneConfig) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width: W, height: H } = configRef.current;
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    const mask = document.createElement('canvas');
    mask.width = W;
    mask.height = H;
    const mctx = mask.getContext('2d');
    if (!gl || !mctx) { setFailed(true); return; }
    mctx.fillStyle = '#000';
    mctx.fillRect(0, 0, W, H);
    mctx.globalCompositeOperation = 'lighter';
    configRef.current.drawMask(mctx);
    mctx.globalCompositeOperation = 'source-over';

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
      console.warn('Cell scene shader:', gl.getShaderInfoLog(shader));
      return null;
    };
    const vs = compile(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}');
    const fs = compile(gl.FRAGMENT_SHADER, COMMON + SCENE_HEAD + configRef.current.fragment);
    const prog = gl.createProgram()!;
    if (vs && fs) { gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); }
    if (!vs || !fs || !gl.getProgramParameter(prog, gl.LINK_STATUS)) { setFailed(true); return; }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const locations = new Map<string, WebGLUniformLocation | null>();
    const u = (name: string) => {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(prog, name));
      return locations.get(name)!;
    };

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
      gl.uniform1f(u('uTime'), t);
      for (const [name, value] of Object.entries(configRef.current.frame(t, reduce))) {
        if (Array.isArray(value)) gl.uniform2f(u(name), value[0], value[1]);
        else gl.uniform1f(u(name), value);
      }
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

  return { canvasRef, failed };
}

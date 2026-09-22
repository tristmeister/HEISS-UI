/* Pixel-mosaic effects, modelled on the app's generation preview ("pixels-organic"):
   a flowing grayscale field drawn as square cells that resolves into an image. */
(() => {
  const root = document.documentElement;
  if (!root.classList.contains("fx")) return;

  const reduce = root.classList.contains("rm");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const COMMON = `
    precision highp float;
    uniform vec2 uRes;
    uniform float uTime;
    uniform float uDpr;

    float hash(vec2 p) {
      p = fract(p * vec2(234.34, 435.345));
      p += dot(p, p + 34.23);
      return fract(p.x * p.y);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
      for (int i = 0; i < 4; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
      return v;
    }
    // Domain-warped flow folded into soft metallic bands.
    float chrome(vec2 p, float t) {
      vec2 q = vec2(fbm(p + vec2(0.0, t * 0.07)), fbm(p + vec2(5.2, 1.3) - t * 0.05));
      float v = fbm(p + 2.4 * q + vec2(t * 0.03, 0.0));
      float b = 0.5 + 0.5 * sin(v * 11.0 + q.x * 4.0 - t * 0.35);
      return clamp(b * b * (0.35 + 0.9 * v), 0.0, 1.0);
    }
    // Rounded-ish square cell: f in [-0.5, 0.5], half-size s.
    float cellSquare(vec2 f, float s, float aa) {
      float d = max(abs(f.x), abs(f.y));
      return 1.0 - smoothstep(s - aa, s, d);
    }
  `;

  function surface(canvas, frag) {
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
    if (!gl) return null;
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn(gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = shader(gl.VERTEX_SHADER, "attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}");
    const fs = shader(gl.FRAGMENT_SHADER, COMMON + frag);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uniforms = {};
    const u = (name) => (name in uniforms ? uniforms[name] : (uniforms[name] = gl.getUniformLocation(prog, name)));
    const s = {
      gl,
      w: 0,
      h: 0,
      u,
      // Layout size, not getBoundingClientRect: the screenshot is transformed in 3D.
      resize() {
        const w = Math.max(1, Math.round(canvas.clientWidth * DPR));
        const h = Math.max(1, Math.round(canvas.clientHeight * DPR));
        if (w === s.w && h === s.h) return false;
        canvas.width = s.w = w;
        canvas.height = s.h = h;
        gl.viewport(0, 0, w, h);
        return true;
      },
      texture(source, unit = 0, { flip = true, filter = gl.LINEAR } = {}) {
        const tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
      },
      draw(t) {
        gl.uniform2f(u("uRes"), s.w, s.h);
        gl.uniform1f(u("uTime"), t);
        gl.uniform1f(u("uDpr"), DPR);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
    };
    return s;
  }

  // rAF loop that only runs while the element is on screen. `frame` returns false to stop.
  function loop(target, frame) {
    let raf = 0, visible = false, stopped = false;
    const t0 = performance.now();
    const tick = (now) => {
      raf = 0;
      if (!visible || stopped) return;
      if (frame((now - t0) / 1000) === false) {
        stopped = true;
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf && !stopped) raf = requestAnimationFrame(tick);
    });
    io.observe(target);
  }

  // Pointer position in the canvas's device pixels (y up), eased, plus a "heat" that builds while hovering.
  function pointer(target, canvas) {
    const p = { x: -1e5, y: -1e5, tx: -1e5, ty: -1e5, on: 0, heat: 0 };
    target.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      p.tx = (e.clientX - r.left) * DPR;
      p.ty = (r.bottom - e.clientY) * DPR;
      if (p.x < -1e4) { p.x = p.tx; p.y = p.ty; }
      p.on = 1;
    }, { passive: true });
    target.addEventListener("pointerleave", () => (p.on = 0));
    p.step = (k = 0.12, heatIn = 0.06, heatOut = 0.03) => {
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
      p.heat += (p.on - p.heat) * (p.on ? heatIn : heatOut);
    };
    return p;
  }

  /* ── 1. Hero field ────────────────────────────────────────────────── */

  const HERO = `
    uniform float uIntro;
    uniform vec2 uMouse;
    uniform float uHeat;

    void main() {
      // Cells start coarse and settle into a fine grid, like a render resolving.
      float level = floor((1.0 - uIntro) * 3.999);
      float cell = 14.0 * uDpr * pow(2.0, level);
      vec2 origin = vec2(uRes.x * 0.5, uRes.y);
      vec2 g = (gl_FragCoord.xy - origin) / cell;
      vec2 id = floor(g);
      vec2 f = g - id - 0.5;
      vec2 c = origin + (id + 0.5) * cell;
      vec2 q = c / uRes;

      float v = chrome(c / (uDpr * 540.0), uTime);
      float tw = 0.78 + 0.22 * sin(uTime * 1.6 + hash(id) * 6.2831);
      float lum = v * tw;

      float d = length((c - uMouse) / (uDpr * 230.0));
      float heat = exp(-d * d * 2.2) * uHeat;

      float fall = smoothstep(0.04, 0.62, q.y);
      float sides = smoothstep(0.0, 0.1, q.x) * smoothstep(1.0, 0.9, q.x);
      float hollow = 1.0 - 0.72 * exp(-pow((q.x - 0.5) * 2.4, 2.0) - pow((q.y - 0.72) * 3.0, 2.0));
      float mask = fall * sides * hollow;

      float lit = clamp(lum + heat * 0.75, 0.0, 1.0);
      float sq = cellSquare(f, 0.43 * mix(0.3, 1.0, lit), 1.2 / cell);
      vec3 col = mix(vec3(0.22), vec3(0.9), lit);
      col = mix(col, vec3(1.0, 0.6, 0.32), clamp(heat * 1.3, 0.0, 0.92));
      float a = sq * mask * (0.05 + 0.4 * lit) * smoothstep(0.0, 0.3, uIntro);
      gl_FragColor = vec4(col * a, a);
    }
  `;

  const heroCanvas = document.querySelector(".hero-fx");
  const heroSection = document.querySelector(".hero");
  const hero = heroCanvas && surface(heroCanvas, HERO);
  if (hero) {
    root.classList.add("fx-hero");
    const p = pointer(heroSection, heroCanvas);
    let introStart = null;
    const frame = (t) => {
      hero.resize();
      if (introStart === null) introStart = t;
      const intro = reduce ? 1 : clamp((t - introStart - 0.1) / 1.6);
      p.step();
      hero.gl.uniform1f(hero.u("uIntro"), intro);
      hero.gl.uniform2f(hero.u("uMouse"), p.x, p.y);
      hero.gl.uniform1f(hero.u("uHeat"), reduce ? 0 : p.heat);
      hero.draw(reduce ? 8 : t + 8);
      return !reduce;
    };
    loop(heroCanvas, frame);
    if (reduce) new ResizeObserver(() => { hero.resize(); frame(0); }).observe(heroCanvas);
  }

  /* ── 2. Screenshot: "generates" like a real render ─────────────────── */

  const SHOT = `
    uniform sampler2D uImg;
    uniform float uP;

    void main() {
      vec2 px = gl_FragCoord.xy;
      vec2 uv = px / uRes;
      vec3 bg = vec3(0.051);

      // Generating: the gray flow field on a fine grid.
      float gc = 15.0 * uDpr;
      vec2 gg = px / gc;
      vec2 gid = floor(gg);
      vec2 gf = gg - gid - 0.5;
      float v = chrome((gid + 0.5) * gc / (uDpr * 460.0), uTime);
      float gsq = cellSquare(gf, 0.43 * mix(0.45, 1.0, v), 1.2 / gc);
      vec3 gray = mix(bg, mix(vec3(0.2), vec3(0.82), v), gsq * (0.3 + 0.7 * v));

      // Resolving: the image through a mosaic that gets finer, in organic order.
      float n = fbm(uv * vec2(uRes.x / uRes.y, 1.0) * 2.2 + 7.0);
      float lp = clamp(uP * 1.7 - n * 0.7, 0.0, 1.0);
      float level = floor((1.0 - lp) * 5.0);
      float cell = 4.0 * uDpr * pow(2.0, level);
      vec2 g = px / cell;
      vec2 id = floor(g);
      vec2 f = g - id - 0.5;
      vec3 img = texture2D(uImg, (id + 0.5) * cell / uRes).rgb;
      float gap = 0.5 - 0.06 * (1.0 - smoothstep(0.6, 0.95, lp));
      vec3 mosaic = mix(bg, img, cellSquare(f, gap, 1.0 / cell));
      vec3 col = mix(mosaic, texture2D(uImg, uv).rgb, step(0.999, lp));
      col = mix(gray, col, smoothstep(0.02, 0.2, lp));
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const shot = document.querySelector(".shot");
  const shotCanvas = shot?.querySelector(".shot-fx");
  const shotImg = shot?.querySelector("img");
  const status = shot?.querySelector(".shot-status-text");
  const finishShot = () => shot?.classList.add("is-done");

  if (shot && reduce) finishShot();
  else if (shotCanvas && shotImg) {
    const fx = surface(shotCanvas, SHOT);
    if (!fx) finishShot();
    else {
      // Never leave the screenshot hidden if something goes wrong.
      const safety = setTimeout(finishShot, 9000);
      const ready = shotImg.decode ? shotImg.decode() : new Promise((r) => (shotImg.complete ? r() : (shotImg.onload = r)));
      ready
        .then(() => {
          fx.texture(shotImg, 0);
          fx.gl.uniform1i(fx.u("uImg"), 0);
          let seen = null, start = null, lastStep = "";
          const io = new IntersectionObserver(([e]) => { if (e.isIntersecting && seen === null) seen = performance.now(); }, { threshold: 0.05 });
          io.observe(shot);
          loop(shotCanvas, (t) => {
            fx.resize();
            const now = performance.now();
            if (start === null && seen !== null && t > 2.2 && now - seen > 900) start = t;
            const p = start === null ? 0 : clamp((t - start) / 2.8);
            fx.gl.uniform1f(fx.u("uP"), easeInOut(p));
            fx.draw(t + 3);

            const step = start === null ? Math.min(3, 1 + Math.floor(t / 0.7)) : 3 + Math.round(p * 5);
            const label = p >= 1 ? "Done" : `Step ${step}/8`;
            if (label !== lastStep) status.textContent = lastStep = label;
            if (p >= 1) {
              clearTimeout(safety);
              io.disconnect();
              finishShot();
              return false;
            }
          });
        })
        .catch(finishShot);
    }
  }

  /* ── 3. Footer wordmark: pixel letters that develop, then run hot ─── */

  const MARK = `
    uniform sampler2D uMask;
    uniform float uCell;
    uniform vec2 uOffset;
    uniform vec4 uBox;
    uniform float uP;
    uniform vec2 uMouse;
    uniform float uHeat;

    void main() {
      vec2 g = (gl_FragCoord.xy - uOffset) / uCell;
      vec2 id = floor(g);
      vec2 f = g - id - 0.5;
      vec2 c = uOffset + (id + 0.5) * uCell;
      vec2 uv = c / uRes;

      float ink = step(0.5, texture2D(uMask, uv).a);
      vec2 bq = (c - uBox.xy) / uBox.zw;
      float inBox = step(0.0, bq.x) * step(bq.x, 1.0) * step(0.0, bq.y) * step(bq.y, 1.0);
      float h = hash(id);
      float v = chrome(c / (uDpr * 360.0), uTime);

      // Reveal order: organic, left to right, with per-cell jitter.
      float n = fbm(bq * vec2(3.0, 1.2) + 3.0);
      float lp = smoothstep(0.0, 1.0, clamp(uP * 2.0 - n * 0.5 - bq.x * 0.35 - h * 0.15, 0.0, 1.0));

      float d = length((c - uMouse) / (uDpr * 190.0));
      float heat = exp(-d * d * 1.8) * uHeat;

      // Before: the text box is still a gray flow mosaic.
      vec3 genC = mix(vec3(0.2), vec3(0.75), v);
      float genA = inBox * (0.1 + 0.45 * v);

      // After: lit pixel letters with a slow shimmer. Heat pulls cells back into the flow, glowing.
      float shade = mix(0.11, 0.26, bq.y) + 0.05 * v;
      vec3 txtC = vec3(shade);
      vec3 hot = mix(vec3(1.0, 0.45, 0.18), vec3(1.0, 0.86, 0.66), v);
      txtC = mix(txtC, hot, clamp(heat * (0.3 + 0.9 * v), 0.0, 1.0));
      float txtA = ink;

      vec3 col = mix(genC, txtC, lp);
      float a = mix(genA, txtA, lp);

      // Sparks: loose cells around the cursor flicker in the gaps.
      float spark = inBox * (1.0 - ink) * heat * step(0.8, fract(h * 13.0 + uTime * 1.3)) * lp;
      col = mix(col, hot, spark);
      a = max(a, spark * 0.7);

      // Steam: pixels drift up from the tops of the letters, stronger when hot.
      float above = c.y - (uBox.y + uBox.w);
      float stem = texture2D(uMask, vec2(uv.x, (uBox.y + uBox.w - uCell * 0.5) / uRes.y)).a;
      float band = step(0.0, above) * (1.0 - smoothstep(0.0, uBox.w * 0.5, above));
      float wob = sin(id.y * 0.45 - uTime * 1.2) * 1.4;
      float s = noise(vec2((id.x + wob) * 0.5, id.y * 0.3 - uTime * 1.5));
      float steam = band * step(0.5, stem) * step(0.66 - uHeat * 0.12, s) * lp;
      float steamA = steam * (0.22 + 0.5 * uHeat) * (1.0 - above / (uBox.w * 0.5));
      col = mix(col, mix(vec3(0.5), hot, uHeat * 0.6), step(0.001, steamA) * (1.0 - ink));
      a = max(a, steamA);

      float sq = cellSquare(f, 0.44, 1.0 / uCell);
      gl_FragColor = vec4(col * a * sq, a * sq);
    }
  `;

  const wrap = document.querySelector(".bigmark-wrap");
  const markCanvas = wrap?.querySelector(".bigmark-fx");
  const mark = markCanvas && surface(markCanvas, MARK);
  if (mark) {
    root.classList.add("fx-mark");
    const TEXT = "HEISS UI";
    const UNITS_PER_EM = 28; // PP Neue Bit draws on a 28-unit em grid
    const maskCanvas = document.createElement("canvas");
    const ctx = maskCanvas.getContext("2d");
    const p = pointer(wrap, markCanvas);
    const state = { cell: 1, ox: 0, oy: 0, box: [0, 0, 1, 1] };
    let revealAt = null;

    const layout = () => {
      mark.resize();
      const W = mark.w, H = mark.h;
      // Integer device pixels per font pixel keeps the letters exactly on the grid.
      ctx.font = `700 ${UNITS_PER_EM * 10}px "PP Neue Bit"`;
      const m10 = ctx.measureText(TEXT);
      const inkUnits = (m10.actualBoundingBoxLeft + m10.actualBoundingBoxRight) / 10;
      const cell = Math.max(2, Math.floor(W / (inkUnits + 2)));
      const size = cell * UNITS_PER_EM;
      maskCanvas.width = W;
      maskCanvas.height = H;
      ctx.clearRect(0, 0, W, H);
      ctx.font = `700 ${size}px "PP Neue Bit"`;
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#fff";
      const m = ctx.measureText(TEXT);
      const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
      const inkH = m.actualBoundingBoxAscent;
      const left = Math.round((W - inkW) / 2 / cell) * cell;
      const baseline = H - cell * 2;
      ctx.fillText(TEXT, left + m.actualBoundingBoxLeft, baseline);
      mark.texture(maskCanvas, 0, { flip: true, filter: mark.gl.NEAREST });
      mark.gl.uniform1i(mark.u("uMask"), 0);
      state.cell = cell;
      state.ox = left % cell;
      state.oy = (H - baseline) % cell;
      state.box = [left, H - baseline, inkW, inkH];
    };

    const frame = (t) => {
      if (mark.resize()) layout();
      p.step(0.14, 0.08, 0.025);
      const r = reduce ? 1 : revealAt === null ? 0 : clamp((t - revealAt) / 2.2);
      const gl = mark.gl;
      gl.uniform1f(mark.u("uCell"), state.cell);
      gl.uniform2f(mark.u("uOffset"), state.ox, state.oy);
      gl.uniform4f(mark.u("uBox"), ...state.box);
      gl.uniform1f(mark.u("uP"), easeOut(r));
      gl.uniform2f(mark.u("uMouse"), p.x, p.y);
      gl.uniform1f(mark.u("uHeat"), reduce ? 0 : p.heat);
      mark.draw(reduce ? 4 : t);
      return !reduce;
    };

    document.fonts.load(`700 40px "PP Neue Bit"`).then(() => {
      layout();
      let clock = 0;
      loop(markCanvas, (t) => {
        clock = t;
        return frame(t);
      });
      new IntersectionObserver(([e]) => {
        if (e.isIntersecting && revealAt === null) revealAt = clock + 0.25;
      }, { threshold: 0.5 }).observe(wrap);
      if (reduce) new ResizeObserver(() => { layout(); frame(0); }).observe(markCanvas);
    });
  }
})();

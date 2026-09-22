/* HEISS UI landing page: interactions, feature scroller, generated scene art. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const SVG = "http://www.w3.org/2000/svg";
  const el = (tag, attrs) => {
    const node = document.createElementNS(SVG, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  };

  // Small deterministic noise so generated art looks the same on every load.
  const hash = (x, y) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  /* ── GitHub stars ─────────────────────────────────────────────────── */

  fetch("https://api.github.com/repos/tristmeister/HEISS-UI")
    .then((r) => (r.ok ? r.json() : null))
    .then((repo) => {
      if (!repo || !(repo.stargazers_count > 0)) return;
      const n = repo.stargazers_count;
      const text = n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
      $$("[data-stars]").forEach((node) => {
        node.textContent = text;
        node.hidden = false;
      });
      $$("[data-stars-wrap]").forEach((node) => (node.hidden = false));
    })
    .catch(() => {});

  /* ── Install tabs ─────────────────────────────────────────────────── */

  const seg = $(".seg");
  if (seg) {
    const tabs = $$('[role="tab"]', seg);
    const select = (tab, focus) => {
      tabs.forEach((t, i) => {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
        if (on) seg.style.setProperty("--i", i);
      });
      if (focus) tab.focus();
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => select(tab));
      tab.addEventListener("keydown", (e) => {
        const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        select(tabs[(i + dir + tabs.length) % tabs.length], true);
      });
    });
  }

  /* ── Copy buttons ─────────────────────────────────────────────────── */

  $$("[data-copy]").forEach((btn) => {
    const label = $(".copy-label", btn);
    const original = label.textContent;
    let timer;
    btn.addEventListener("click", async () => {
      const source = document.getElementById(btn.dataset.copy);
      try {
        await navigator.clipboard.writeText(source.textContent.trim());
      } catch {
        const range = document.createRange();
        range.selectNodeContents(source);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand("copy");
        sel.removeAllRanges();
      }
      btn.classList.add("is-copied");
      label.textContent = "Copied";
      clearTimeout(timer);
      timer = setTimeout(() => {
        btn.classList.remove("is-copied");
        label.textContent = original;
      }, 1800);
    });
  });

  /* ── Reveal on scroll ─────────────────────────────────────────────── */

  const revealer = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        revealer.unobserve(e.target);
      }),
    { rootMargin: "0px 0px -12% 0px" }
  );
  $$("[data-reveal]").forEach((node) => revealer.observe(node));

  /* ── Scene art: "Watch it render" mosaic cells ────────────────────── */

  const cells = $("[data-cells]");
  if (cells) {
    const x0 = 96, y0 = 36, size = 20, n = 13;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const flow = noise(i * 0.28 + 3.1, j * 0.28 + 1.7) * 0.7 + noise(i * 0.7, j * 0.7) * 0.3;
        const tone = Math.round(34 + flow * 150);
        const order = noise(i * 0.22 + 9.4, j * 0.22 + 4.2) * 0.75 + hash(i, j) * 0.25;
        cells.append(
          el("rect", {
            x: x0 + i * size + 2,
            y: y0 + j * size + 2,
            width: size - 4,
            height: size - 4,
            rx: 2,
            fill: `rgb(${tone} ${tone} ${tone})`,
            style: `--o: ${(0.55 + flow * 0.45).toFixed(2)}; --d: ${order.toFixed(3)}`,
          })
        );
      }
    }
  }

  /* ── Scene art: "Upscale and compare" (smooth vs. low-res) ────────── */

  const smoothLayer = $("[data-u-smooth]");
  const pixelLayer = $("[data-u-pixels]");
  if (smoothLayer && pixelLayer) {
    const X = 40, Y = 36, W = 400, H = 260;
    const sky = [
      [0, [14, 22, 51]],
      [0.5, [58, 79, 138]],
      [0.8, [231, 165, 124]],
      [1, [243, 199, 154]],
    ];
    const skyAt = (v) => {
      for (let k = 1; k < sky.length; k++) {
        if (v <= sky[k][0]) {
          const [p0, c0] = sky[k - 1], [p1, c1] = sky[k];
          const t = (v - p0) / (p1 - p0);
          return c0.map((c, m) => c + (c1[m] - c) * t);
        }
      }
      return sky[sky.length - 1][1];
    };
    const back = (u) => 0.58 + 0.07 * Math.sin(u * 7 + 1.3) + 0.035 * Math.sin(u * 17 + 0.4);
    const front = (u) => 0.76 + 0.05 * Math.sin(u * 5 + 2.1) + 0.025 * Math.sin(u * 13 + 1);
    const sun = { u: 0.68, v: 0.5, r: 0.075 };
    const scene = (u, v) => {
      if (v > front(u)) return [22, 21, 43];
      if (v > back(u)) return [59, 53, 99];
      const dx = (u - sun.u) * (W / H), dy = v - sun.v;
      const d = Math.hypot(dx, dy);
      if (d < sun.r) return [255, 240, 216];
      const glow = Math.max(0, 1 - (d - sun.r) / 0.22) ** 2 * 0.55;
      return skyAt(v).map((c, m) => c + ([255, 201, 143][m] - c) * glow);
    };

    // Smooth, "upscaled" version.
    const grad = $("[data-u-sky]");
    sky.forEach(([o, c]) => grad.append(el("stop", { offset: o, "stop-color": `rgb(${c.join(" ")})` })));
    smoothLayer.append(el("rect", { x: X, y: Y, width: W, height: H, fill: "url(#u-sky)" }));
    const sx = X + sun.u * W, sy = Y + sun.v * H;
    const glow = el("radialGradient", { id: "u-glow" });
    [[0, 0.55], [0.3, 0.3], [0.6, 0.1], [1, 0]].forEach(([o, a]) =>
      glow.append(el("stop", { offset: o, "stop-color": "#ffc98f", "stop-opacity": a }))
    );
    grad.after(glow);
    smoothLayer.append(el("circle", { cx: sx, cy: sy, r: (sun.r + 0.22) * H, fill: "url(#u-glow)" }));
    smoothLayer.append(el("circle", { cx: sx, cy: sy, r: sun.r * H, fill: "#fff0d8" }));
    const ridge = (fn, color) => {
      let d = `M${X} ${Y + H}`;
      for (let k = 0; k <= 100; k++) {
        const u = k / 100;
        d += `L${(X + u * W).toFixed(1)} ${(Y + fn(u) * H).toFixed(1)}`;
      }
      smoothLayer.append(el("path", { d: d + `L${X + W} ${Y + H}Z`, fill: color }));
    };
    ridge(back, "rgb(59 53 99)");
    ridge(front, "rgb(22 21 43)");

    // Low-res version: the same scene sampled into 16-unit cells.
    const c = 16;
    for (let y = 0; y < H; y += c) {
      for (let x = 0; x < W; x += c) {
        const acc = [0, 0, 0];
        for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
          const s = scene((x + ox * c) / W, (y + oy * c) / H);
          acc[0] += s[0] / 4;
          acc[1] += s[1] / 4;
          acc[2] += s[2] / 4;
        }
        pixelLayer.append(
          el("rect", { x: X + x, y: Y + y, width: c + 0.5, height: c + 0.5, fill: `rgb(${acc.map(Math.round).join(" ")})`, "shape-rendering": "crispEdges" })
        );
      }
    }
  }

  /* ── Feature scroller ─────────────────────────────────────────────── */

  const stage = $(".stage");
  const features = $$(".feature");
  const arts = $$("[data-art]");
  if (stage && features.length) {
    const idx = $("[data-stage-idx]");
    const name = $("[data-stage-name]");
    const bar = $(".stage-bar");
    const ticks = $$("[data-stage-ticks] i");
    const names = features.map((f) => $("h3", f).textContent);
    let current = 0;
    ticks[0]?.classList.add("on");

    const activate = (i) => {
      if (i === current) return;
      current = i;
      features.forEach((f, k) => f.classList.toggle("is-active", k === i));
      arts.forEach((a, k) => a.classList.toggle("is-active", k === i));
      ticks.forEach((t, k) => t.classList.toggle("on", k === i));
      bar.classList.remove("swap");
      void bar.offsetWidth;
      bar.classList.add("swap");
      idx.textContent = String(i + 1).padStart(2, "0");
      name.textContent = names[i];
    };

    // The feature crossing the reading line wins. On phones the stage is
    // pinned on top, so the reading line sits lower.
    let picker;
    const watch = () => {
      picker?.disconnect();
      const narrow = matchMedia("(max-width: 880px)").matches;
      picker = new IntersectionObserver(
        (entries) => entries.forEach((e) => e.isIntersecting && activate(features.indexOf(e.target))),
        { rootMargin: narrow ? "-70% 0px -29% 0px" : "-50% 0px -49% 0px" }
      );
      features.forEach((f) => picker.observe(f));
    };
    watch();
    matchMedia("(max-width: 880px)").addEventListener("change", watch);

    // Only animate the stage while it's on screen.
    new IntersectionObserver(([e]) => stage.classList.toggle("in-view", e.isIntersecting), { threshold: 0.2 }).observe(stage);

    features.forEach((f) =>
      f.addEventListener("click", (e) => {
        if (e.target.closest("a")) return;
        f.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      })
    );
  }
})();

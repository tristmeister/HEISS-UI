import React from "react";
import { Brush, BrushCleaning, Eraser, Redo2, RotateCcw, Undo2 } from "lucide-react";
import { cn } from "./format";
import { Tip } from "./components";
import { SafeImg } from "./SafeImg";
import { SizeSlider, drawStroke, sizes, type Stroke } from "./InpaintStudio";

/**
 * Settings › Features › Inpainting: the inpaint studio in miniature, built
 * from its own pieces (stroke drawing, size slider, tool pill and their CSS)
 * so it looks and paints exactly like the real one. Paint over part of a
 * small scene, press Generate, and only the painted part turns to night.
 *
 * Kept light: the scene is two inline SVGs (no download), nothing renders
 * per frame except while painting, and the "result" is one canvas composite
 * made on Generate. It paints a stroke by itself once, the first time it's
 * seen, unless reduced motion is on or you got there first.
 */

const W = 800;
const H = 450;
const PROMPT = "under a starry night sky with northern lights";
const workMs = 1500;

type Phase = "paint" | "working" | "done";
type Box = { x: number; y: number; w: number; h: number };

/** A lake under mountains, by day or by night with an aurora. Same shapes, so a painted patch lines up. */
function scene(night: boolean) {
  const c = night
    ? { sky: ["#0c1640", "#2a3478", "#7a5f9e"], far: "#45507e", snow: "#d6dcf2", near: "#2c4560", shore: "#22344a", tree: "#142233", water: ["#2a3f6e", "#162746"], sun: "#eef1ff" }
    : { sky: ["#6fa6de", "#bcd8ef", "#f1dfc4"], far: "#8ba3c2", snow: "#f4f7fb", near: "#557a62", shore: "#3e5a44", tree: "#2b4433", water: ["#6d9cc6", "#3f6a8f"], sun: "#fff3d2" };
  const far = "0,236 90,152 160,204 250,108 340,192 420,140 520,216 610,128 700,192 800,150 800,262 0,262";
  const near = "0,262 120,194 210,242 330,172 450,252 560,204 680,252 800,212 800,286 0,286";
  const caps = "<polygon points='250,108 230,134 244,128 256,138 270,130'/><polygon points='610,128 592,150 606,145 618,154 630,147'/><polygon points='90,152 76,170 88,166 98,172'/><polygon points='420,140 406,158 418,154 430,160'/>";
  const trees = [52, 78, 104, 664, 690, 716, 742].map((x, i) => {
    const h = 46 + (i % 3) * 12;
    return `<polygon points='${x},${292 - h} ${x - 14},292 ${x + 14},292'/>`;
  }).join("");
  // Stars from a fixed seed, so the night is the same every time.
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const stars = night ? Array.from({ length: 90 }, () => `<circle cx='${(rand() * W).toFixed(0)}' cy='${(rand() * 200).toFixed(0)}' r='${(rand() * 1.3 + 0.4).toFixed(1)}' opacity='${(rand() * 0.6 + 0.35).toFixed(2)}'/>`).join("") : "";
  const aurora = night
    ? "<g filter='url(#b)' opacity='.85'><path d='M-20,150 C120,40 260,170 400,80 S650,30 820,110 L820,150 C650,80 520,150 400,130 S150,110 -20,200 Z' fill='url(#a)'/><path d='M60,120 C200,60 300,120 430,60 S620,40 760,70 L760,92 C620,70 520,110 430,96 S220,110 60,150 Z' fill='url(#a2)'/></g>"
    : "<g fill='#fff' opacity='.78'><ellipse cx='170' cy='86' rx='70' ry='16'/><ellipse cx='214' cy='76' rx='44' ry='14'/><ellipse cx='470' cy='60' rx='56' ry='12'/></g>";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' width='${W}' height='${H}'>
<defs>
<linearGradient id='s' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${c.sky[0]}'/><stop offset='.62' stop-color='${c.sky[1]}'/><stop offset='1' stop-color='${c.sky[2]}'/></linearGradient>
<linearGradient id='w' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${c.water[0]}'/><stop offset='1' stop-color='${c.water[1]}'/></linearGradient>
<linearGradient id='a' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='#3ef0a6' stop-opacity='0'/><stop offset='.35' stop-color='#3ef0a6' stop-opacity='.75'/><stop offset='.7' stop-color='#55d8ff' stop-opacity='.6'/><stop offset='1' stop-color='#9a7cff' stop-opacity='0'/></linearGradient>
<linearGradient id='a2' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='#b4ffd9' stop-opacity='0'/><stop offset='.5' stop-color='#b4ffd9' stop-opacity='.55'/><stop offset='1' stop-color='#b4ffd9' stop-opacity='0'/></linearGradient>
<filter id='b' x='-10%' y='-50%' width='120%' height='200%'><feGaussianBlur stdDeviation='9'/></filter>
</defs>
<rect width='${W}' height='290' fill='url(#s)'/>
<g fill='#fff'>${stars}</g>
${aurora}
<circle cx='590' cy='112' r='${night ? 64 : 76}' fill='${c.sun}' opacity='${night ? 0.12 : 0.32}'/>
<circle cx='590' cy='112' r='${night ? 24 : 32}' fill='${c.sun}'/>
<polygon points='${far}' fill='${c.far}'/>
<g fill='${c.snow}'>${caps}</g>
<polygon points='${near}' fill='${c.near}'/>
<rect y='284' width='${W}' height='${H - 284}' fill='url(#w)'/>
<g transform='translate(0,572) scale(1,-1)' opacity='${night ? 0.32 : 0.22}'><polygon points='${far}' fill='${c.far}'/>${night ? aurora : ""}</g>
<g fill='${c.sun}' opacity='${night ? 0.18 : 0.3}'><rect x='560' y='300' width='60' height='3' rx='1.5'/><rect x='572' y='318' width='36' height='2' rx='1'/><rect x='580' y='334' width='20' height='2' rx='1'/></g>
<g fill='${c.tree}'>${trees}</g>
<polygon points='0,${H} 0,402 140,384 270,414 330,${H}' fill='${c.shore}'/>
<polygon points='560,${H} 640,410 800,392 800,${H}' fill='${c.shore}'/>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

let scenes: { day: string; night: string } | null = null;
const sceneUrls = () => (scenes ||= { day: scene(false), night: scene(true) });

/** The stroke it paints by itself: a loose scribble across the sky. */
const autoPath = [[150, 96], [300, 70], [450, 104], [640, 64], [720, 120], [560, 160], [380, 150], [220, 176], [130, 150]];

export function InpaintDemo() {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const resultRef = React.useRef<HTMLCanvasElement>(null);
  const ringRef = React.useRef<HTMLDivElement>(null);
  const [tool, setTool] = React.useState<"brush" | "eraser">("brush");
  const [sizeIndex, setSizeIndex] = React.useState(5);
  const [previewing, setPreviewing] = React.useState(false);
  const [history, setHistory] = React.useState({ undo: 0, redo: 0, painted: false });
  const [phase, setPhase] = React.useState<Phase>("paint");
  const [box, setBox] = React.useState<Box | null>(null);
  const [comparing, setComparing] = React.useState(false);
  const urls = sceneUrls();

  const strokes = React.useRef<Stroke[]>([]);
  const redo = React.useRef<Stroke[]>([]);
  const active = React.useRef<{ stroke: Extract<Stroke, { kind: "stroke" }>; pointerId: number } | null>(null);
  const touched = React.useRef(false);
  const live = React.useRef({ sizeIndex, tool, phase });
  live.current = { sizeIndex, tool, phase };

  const ctx = () => canvasRef.current?.getContext("2d") || null;
  const brushPixels = () => sizes[live.current.sizeIndex] * W;
  // Canvas pixels per CSS pixel: the stage is the viewport, scaled from 800×450.
  const scale = () => (viewportRef.current?.clientWidth || W) / W;

  const replay = React.useCallback(() => {
    const context = ctx();
    if (!context) return;
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, W, H);
    for (const stroke of strokes.current) {
      if (stroke.kind === "clear") context.clearRect(0, 0, W, H);
      else drawStroke(context, stroke);
    }
  }, []);

  const changed = React.useCallback(() => {
    const list = strokes.current;
    const lastClear = list.map((item) => item.kind).lastIndexOf("clear");
    const painted = list.slice(lastClear + 1).some((item) => item.kind === "stroke" && item.tool === "brush");
    setHistory({ undo: list.length, redo: redo.current.length, painted });
  }, []);

  const commit = (stroke: Extract<Stroke, { kind: "stroke" }>) => {
    strokes.current.push(stroke);
    redo.current = [];
    changed();
  };
  const undo = () => { const stroke = strokes.current.pop(); if (!stroke) return; redo.current.push(stroke); replay(); changed(); };
  const redoStroke = () => { const stroke = redo.current.pop(); if (!stroke) return; strokes.current.push(stroke); replay(); changed(); };
  const clear = () => { strokes.current.push({ kind: "clear" }); redo.current = []; replay(); changed(); };

  /* ---- The brush ring, written to the DOM, never through React. */
  const ringAt = React.useRef<{ x: number; y: number } | null>(null);
  const moveRing = (point: { x: number; y: number } | null) => {
    const ring = ringRef.current;
    ringAt.current = point;
    if (!ring) return;
    if (!point || live.current.phase !== "paint") { ring.style.opacity = "0"; return; }
    const diameter = brushPixels() * scale();
    ring.style.opacity = "1";
    ring.style.width = ring.style.height = `${diameter}px`;
    ring.style.transform = `translate3d(${point.x - diameter / 2}px, ${point.y - diameter / 2}px, 0)`;
  };
  React.useEffect(() => {
    const viewport = viewportRef.current;
    moveRing(previewing && viewport ? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 } : previewing ? null : ringAt.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeIndex, previewing]);

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const toImage = (point: { x: number; y: number }) => ({ x: point.x / scale(), y: point.y / scale() });

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (phase !== "paint" || active.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    touched.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = toImage(local(event));
    const stroke: Extract<Stroke, { kind: "stroke" }> = { kind: "stroke", tool, size: brushPixels(), points: [at.x, at.y] };
    active.current = { stroke, pointerId: event.pointerId };
    const context = ctx();
    if (context) drawStroke(context, stroke);
  }
  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") moveRing(local(event));
    const current = active.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const events = typeof event.nativeEvent.getCoalescedEvents === "function" ? event.nativeEvent.getCoalescedEvents() : [];
    const from = current.stroke.points.length;
    for (const sample of events.length ? events : [event.nativeEvent]) {
      const at = toImage(local(sample));
      current.stroke.points.push(at.x, at.y);
    }
    const context = ctx();
    if (context) drawStroke(context, current.stroke, from);
  }
  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const current = active.current;
    if (!current || current.pointerId !== event.pointerId) return;
    active.current = null;
    commit(current.stroke);
  }

  /* ---- Painting by itself, once, the first time most of it is on screen. */
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let timer = 0;
    const play = () => {
      if (touched.current || strokes.current.length) return;
      const stroke: Extract<Stroke, { kind: "stroke" }> = { kind: "stroke", tool: "brush", size: brushPixels(), points: [] };
      const lengths = autoPath.slice(1).map(([x, y], i) => Math.hypot(x - autoPath[i][0], y - autoPath[i][1]));
      const total = lengths.reduce((sum, item) => sum + item, 0);
      const started = performance.now();
      const duration = 1500;
      const step = (now: number) => {
        if (touched.current) {
          // You took over mid-stroke: drop its stroke and keep yours.
          replay();
          const context = ctx();
          if (context && active.current) drawStroke(context, active.current.stroke);
          return;
        }
        const t = Math.min(1, (now - started) / duration);
        let along = (1 - Math.pow(1 - t, 2)) * total;
        let segment = 0;
        while (segment < lengths.length - 1 && along > lengths[segment]) { along -= lengths[segment]; segment += 1; }
        const [ax, ay] = autoPath[segment];
        const [bx, by] = autoPath[segment + 1];
        const k = Math.min(1, along / lengths[segment]);
        const x = ax + (bx - ax) * k;
        const y = ay + (by - ay) * k;
        const from = stroke.points.length;
        stroke.points.push(x, y);
        const context = ctx();
        if (context) drawStroke(context, stroke, from);
        moveRing({ x: x * scale(), y: y * scale() });
        if (t < 1) frame = requestAnimationFrame(step);
        else { commit(stroke); window.setTimeout(() => { if (!touched.current) moveRing(null); }, 500); }
      };
      frame = requestAnimationFrame(step);
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.intersectionRatio < 0.6) return;
      observer.disconnect();
      timer = window.setTimeout(play, 650);
    }, { threshold: [0, 0.6] });
    observer.observe(root);
    return () => { observer.disconnect(); window.clearTimeout(timer); cancelAnimationFrame(frame); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Generate: the night scene, only inside the painted part, feathered at its edge. */
  const night = React.useRef<HTMLImageElement | null>(null);
  const generate = async () => {
    const paint = canvasRef.current;
    const result = resultRef.current?.getContext("2d");
    if (!paint || !result) return;
    const list = strokes.current;
    const lastClear = list.map((item) => item.kind).lastIndexOf("clear");
    let minX = W, minY = H, maxX = 0, maxY = 0;
    for (const stroke of list.slice(lastClear + 1)) {
      if (stroke.kind !== "stroke" || stroke.tool !== "brush") continue;
      const r = stroke.size / 2;
      for (let i = 0; i < stroke.points.length; i += 2) {
        minX = Math.min(minX, stroke.points[i] - r); maxX = Math.max(maxX, stroke.points[i] + r);
        minY = Math.min(minY, stroke.points[i + 1] - r); maxY = Math.max(maxY, stroke.points[i + 1] + r);
      }
    }
    minX = Math.max(0, minX); minY = Math.max(0, minY); maxX = Math.min(W, maxX); maxY = Math.min(H, maxY);
    setBox({ x: minX / W, y: minY / H, w: Math.max(0, maxX - minX) / W, h: Math.max(0, maxY - minY) / H });
    setPhase("working");
    moveRing(null);
    const started = performance.now();
    if (!night.current) {
      const image = new Image();
      image.src = urls.night;
      await image.decode().catch(() => null);
      night.current = image;
    }
    result.globalCompositeOperation = "source-over";
    result.clearRect(0, 0, W, H);
    if ("filter" in result) result.filter = "blur(14px)";
    result.drawImage(paint, 0, 0);
    if ("filter" in result) result.filter = "none";
    result.globalCompositeOperation = "source-in";
    result.drawImage(night.current, 0, 0, W, H);
    window.setTimeout(() => setPhase("done"), Math.max(0, workMs - (performance.now() - started)));
  };
  const again = () => { setPhase("paint"); setComparing(false); };

  const tools = [
    { id: "brush" as const, label: "Brush", icon: <Brush size={16} /> },
    { id: "eraser" as const, label: "Eraser", icon: <Eraser size={16} /> }
  ];

  return (
    <div className="inpaint-demo-wrap" ref={rootRef}>
      <div className={cn("inpaint-demo", `is-${phase}`, comparing && "is-comparing")} role="group" aria-label="Try inpainting">
        <div
          ref={viewportRef}
          className={cn("inpaint-viewport", phase === "paint" ? `is-${tool}` : "is-idle")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={(event) => { if (active.current?.pointerId !== event.pointerId) moveRing(null); }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="inpaint-stage">
            <SafeImg src={urls.day} draggable={false} />
            <canvas ref={resultRef} className="inpaint-demo-result" width={W} height={H} />
            <canvas ref={canvasRef} className="inpaint-demo-paint" width={W} height={H} />
          </div>
          {phase === "working" && box ? (
            <div className="inpaint-demo-working" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} aria-hidden="true" />
          ) : null}
          <div ref={ringRef} className={cn("inpaint-ring", tool === "eraser" && "is-eraser", previewing && "is-preview")} aria-hidden="true" />
          <p className={cn("inpaint-hint", (history.painted || phase !== "paint") && "is-hidden")} aria-hidden={history.painted}>Paint over what should change</p>
          {phase === "done" ? (
            <button
              type="button"
              className="inpaint-hint inpaint-demo-compare"
              onPointerDown={() => setComparing(true)}
              onPointerUp={() => setComparing(false)}
              onPointerLeave={() => setComparing(false)}
              onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") setComparing(true); }}
              onKeyUp={() => setComparing(false)}
            >
              {comparing ? "The original" : "Hold to see the original"}
            </button>
          ) : null}
        </div>

        <div className={cn("inpaint-pill", phase !== "paint" && "is-resting")} role="toolbar" aria-label="Painting tools">
          {tools.map((item) => (
            <Tip key={item.id} content={item.label}>
              <button type="button" className={cn("inpaint-tool", tool === item.id && "is-active")} aria-label={item.label} aria-pressed={tool === item.id} disabled={phase !== "paint"} onClick={() => { touched.current = true; setTool(item.id); }}>
                {item.icon}
              </button>
            </Tip>
          ))}
          <span className="inpaint-divider" aria-hidden="true" />
          <Tip content="Undo">
            <button type="button" className="inpaint-tool" aria-label="Undo" disabled={!history.undo || phase !== "paint"} onClick={undo}><Undo2 size={16} /></button>
          </Tip>
          <Tip content="Redo">
            <button type="button" className="inpaint-tool" aria-label="Redo" disabled={!history.redo || phase !== "paint"} onClick={redoStroke}><Redo2 size={16} /></button>
          </Tip>
          <span className="inpaint-divider" aria-hidden="true" />
          <Tip content="Clear the painting">
            <button type="button" className="inpaint-tool" aria-label="Clear the painting" disabled={!history.painted || phase !== "paint"} onClick={clear}><BrushCleaning size={16} /></button>
          </Tip>
        </div>

        {phase === "paint" ? <SizeSlider index={sizeIndex} onChange={(next) => { touched.current = true; setSizeIndex(next); }} onPreview={setPreviewing} /> : null}
      </div>

      <div className="inpaint-demo-prompt">
        <span className="inpaint-demo-text"><span>Prompt</span>{PROMPT}</span>
        {phase === "done" ? (
          <button type="button" className="btn" onClick={again}><RotateCcw size={14} /> Paint again</button>
        ) : (
          <button type="button" className={cn("btn is-primary", history.painted && phase === "paint" && "is-ready")} disabled={!history.painted || phase !== "paint"} onClick={generate}>
            {phase === "working" ? "Making it…" : "Generate"}
          </button>
        )}
      </div>
    </div>
  );
}

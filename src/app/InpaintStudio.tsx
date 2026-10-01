import React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Brush, Eraser, Hand, Redo2, Undo2, X } from "lucide-react";
import { cn } from "./format";
import { Tip } from "./components";
import { SafeImg } from "./SafeImg";
import type { ReferenceAsset } from "./types";

/**
 * The inpaint studio: paint over the part of a reference image that should
 * change. It rises out of the prompt bar like the reference picker, so the
 * prompt stays right there to say what the painted part becomes.
 *
 * Strokes are kept as vectors (undo replays them) on a canvas at the image's
 * resolution, capped at `maxSide`. The mask leaves as a PNG, white where it
 * should change, a moment after each stroke; the server stretches it over the
 * full image. Pointer moves never touch React state: zoom, pan and the brush
 * ring are written to the DOM in an animation frame.
 */

type Tool = "brush" | "eraser" | "hand";
type Stroke = { kind: "stroke"; tool: "brush" | "eraser"; size: number; points: number[] } | { kind: "clear" };
type View = { scale: number; x: number; y: number };

const maxSide = 2048;
// Brush diameters as a share of the image's long side, so a step looks the same at any zoom.
const sizes = [0.008, 0.014, 0.022, 0.034, 0.05, 0.075, 0.11, 0.16];
const maxZoom = 12;
const exportDelay = 220;
const tint = "#ff9a52";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Extract<Stroke, { kind: "stroke" }>, from = 0) {
  const { points, size } = stroke;
  ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = tint;
  ctx.fillStyle = tint;
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (points.length === 2) {
    ctx.beginPath();
    ctx.arc(points[0], points[1], size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const start = Math.max(0, from - 2);
  ctx.beginPath();
  ctx.moveTo(points[start], points[start + 1]);
  for (let index = start + 2; index < points.length; index += 2) ctx.lineTo(points[index], points[index + 1]);
  ctx.stroke();
}

/** The painted canvas as the mask the server reads: white where painted, on black. Null when empty. */
function exportMask(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  let painted = false;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha) painted = true;
    data[index] = data[index + 1] = data[index + 2] = alpha;
    data[index + 3] = 255;
  }
  if (!painted) return null;
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  out.getContext("2d")!.putImageData(image, 0, 0);
  return out.toDataURL("image/png");
}

/** A mask the studio exported earlier, back as tinted paint on a canvas of this size. */
async function maskLayer(dataUrl: string, width: number, height: number) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  const ctx = layer.getContext("2d")!;
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    pixels.data[index + 3] = pixels.data[index];
    pixels.data[index] = 255;
    pixels.data[index + 1] = 154;
    pixels.data[index + 2] = 82;
  }
  ctx.putImageData(pixels, 0, 0);
  return layer;
}

/* ------------------------------------------------------------ Size slider */

/**
 * The brush size: a slim vertical pill on the left that becomes a wedge
 * (thin at the bottom, wide at the top) while it's hovered or dragged.
 * It snaps to `sizes`, top is biggest.
 */
function SizeSlider({ index, onChange, onPreview }: { index: number; onChange: (index: number) => void; onPreview: (active: boolean) => void }) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const last = sizes.length - 1;
  const pick = (clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    onChange(Math.round(clamp(1 - (clientY - rect.top) / rect.height, 0, 1) * last));
  };
  return (
    <div
      className={cn("inpaint-size", dragging && "is-dragging")}
      role="slider"
      tabIndex={0}
      aria-label="Brush size"
      aria-orientation="vertical"
      aria-valuemin={1}
      aria-valuemax={sizes.length}
      aria-valuenow={index + 1}
      onPointerEnter={() => onPreview(true)}
      onPointerLeave={() => { if (!dragging) onPreview(false); }}
      onFocus={() => onPreview(true)}
      onBlur={() => onPreview(false)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        onPreview(true);
        pick(event.clientY);
      }}
      onPointerMove={(event) => { if (dragging) pick(event.clientY); }}
      onPointerUp={(event) => {
        setDragging(false);
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onPreview(false);
      }}
      onKeyDown={(event) => {
        const step = event.key === "ArrowUp" || event.key === "ArrowRight" ? 1 : event.key === "ArrowDown" || event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        event.stopPropagation();
        onChange(clamp(index + step, 0, last));
      }}
    >
      <div className="inpaint-size-track" ref={trackRef}>
        <span className="inpaint-size-wedge" aria-hidden="true" />
        <span className="inpaint-size-thumb" aria-hidden="true" style={{ top: `${(1 - index / last) * 100}%` }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Studio */

export function InpaintStudio({ anchor, asset, mask, popRef, onChange, onClose }: {
  anchor: HTMLElement;
  asset: ReferenceAsset;
  mask: string | null;
  popRef: React.RefObject<HTMLDivElement | null>;
  onChange: (dataUrl: string | null) => void;
  onClose: () => void;
}) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const ringRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [tool, setTool] = React.useState<Tool>("brush");
  const [spaceHand, setSpaceHand] = React.useState(false);
  const [sizeIndex, setSizeIndex] = React.useState(3);
  const [previewing, setPreviewing] = React.useState(false);
  const [history, setHistory] = React.useState({ undo: 0, redo: 0, painted: Boolean(mask) });
  const [zoom, setZoom] = React.useState({ fit: true, percent: 100 });

  const strokes = React.useRef<Stroke[]>([]);
  const redo = React.useRef<Stroke[]>([]);
  const base = React.useRef<HTMLCanvasElement | null>(null);
  const view = React.useRef<View>({ scale: 1, x: 0, y: 0 });
  const fit = React.useRef<View>({ scale: 1, x: 0, y: 0 });
  const frame = React.useRef(0);
  const exportTimer = React.useRef(0);
  const live = React.useRef({ onChange, sizeIndex, tool: tool as Tool, spaceHand });
  live.current = { onChange, sizeIndex, tool, spaceHand };
  const activeTool: Tool = spaceHand ? "hand" : tool;
  const image = asset.url || asset.thumbnailUrl || "";

  // Pinned above the prompt bar, like the reference picker; its height follows the image.
  const [box, setBox] = React.useState<{ left: number; width: number; bottom: number } | null>(null);
  React.useLayoutEffect(() => {
    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      setBox({ left: rect.left, width: rect.width, bottom: window.innerHeight - rect.top + 10 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(anchor);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [anchor]);
  const asSheet = anchor.classList.contains("phone-compose");

  /* ---- Image and canvas */
  React.useEffect(() => {
    let cancelled = false;
    const element = new Image();
    element.onload = async () => {
      if (cancelled) return;
      const scale = Math.min(1, maxSide / Math.max(element.naturalWidth, element.naturalHeight));
      const width = Math.max(1, Math.round(element.naturalWidth * scale));
      const height = Math.max(1, Math.round(element.naturalHeight * scale));
      if (mask) base.current = await maskLayer(mask, width, height).catch(() => null);
      if (!cancelled) setSize({ width, height });
    };
    element.onerror = () => { if (!cancelled) setFailed(true); };
    element.src = image;
    return () => { cancelled = true; };
    // The mask is read once, when the studio opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  const ctx = () => canvasRef.current?.getContext("2d", { willReadFrequently: true }) || null;

  const replay = React.useCallback(() => {
    const context = ctx();
    const canvas = canvasRef.current;
    if (!context || !canvas) return;
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (base.current) context.drawImage(base.current, 0, 0);
    for (const stroke of strokes.current) {
      if (stroke.kind === "clear") {
        context.globalCompositeOperation = "source-over";
        context.clearRect(0, 0, canvas.width, canvas.height);
      } else drawStroke(context, stroke);
    }
  }, []);

  const flushExport = React.useCallback(() => {
    window.clearTimeout(exportTimer.current);
    exportTimer.current = 0;
    const canvas = canvasRef.current;
    if (canvas) live.current.onChange(exportMask(canvas));
  }, []);
  const changed = React.useCallback(() => {
    // Painted: a brush stroke since the last clear, or the earlier mask with no clear yet.
    const list = strokes.current;
    const lastClear = list.map((item) => item.kind).lastIndexOf("clear");
    const painted = list.slice(lastClear + 1).some((item) => item.kind === "stroke" && item.tool === "brush") || (lastClear < 0 && Boolean(base.current));
    setHistory({ undo: list.length, redo: redo.current.length, painted });
    window.clearTimeout(exportTimer.current);
    exportTimer.current = window.setTimeout(flushExport, exportDelay);
  }, [flushExport]);
  // Closing mid-wait still hands the last strokes over.
  React.useEffect(() => () => { if (exportTimer.current) flushExport(); }, [flushExport]);

  const undo = React.useCallback(() => {
    const stroke = strokes.current.pop();
    if (!stroke) return;
    redo.current.push(stroke);
    replay();
    changed();
  }, [changed, replay]);
  const redoStroke = React.useCallback(() => {
    const stroke = redo.current.pop();
    if (!stroke) return;
    strokes.current.push(stroke);
    replay();
    changed();
  }, [changed, replay]);
  const clear = React.useCallback(() => {
    strokes.current.push({ kind: "clear" });
    redo.current = [];
    replay();
    changed();
  }, [changed, replay]);

  /* ---- Zoom and pan */
  const apply = React.useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const { scale, x, y } = view.current;
      if (stageRef.current) stageRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
      const atFit = Math.abs(scale - fit.current.scale) < 0.001;
      const percent = Math.round(scale / fit.current.scale * 100);
      setZoom((current) => current.fit === atFit && current.percent === percent ? current : { fit: atFit, percent });
    });
  }, []);

  const contain = React.useCallback((next: View) => {
    const viewport = viewportRef.current;
    if (!viewport || !size) return next;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const scale = clamp(next.scale, fit.current.scale, fit.current.scale * maxZoom);
    const w = size.width * scale;
    const h = size.height * scale;
    return {
      scale,
      x: w <= vw ? (vw - w) / 2 : clamp(next.x, vw - w, 0),
      y: h <= vh ? (vh - h) / 2 : clamp(next.y, vh - h, 0)
    };
  }, [size]);

  const resetZoom = React.useCallback(() => {
    view.current = { ...fit.current };
    apply();
  }, [apply]);

  const zoomAt = React.useCallback((factor: number, px: number, py: number) => {
    const current = view.current;
    const scale = clamp(current.scale * factor, fit.current.scale, fit.current.scale * maxZoom);
    const ratio = scale / current.scale;
    view.current = contain({ scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio });
    apply();
  }, [apply, contain]);

  // Fit the image whenever the studio or the image changes size.
  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !size) return;
    const refit = () => {
      const scale = Math.min(viewport.clientWidth / size.width, viewport.clientHeight / size.height);
      const wasFit = Math.abs(view.current.scale - fit.current.scale) < 0.001 || !fit.current.scale;
      fit.current = { scale, x: (viewport.clientWidth - size.width * scale) / 2, y: (viewport.clientHeight - size.height * scale) / 2 };
      view.current = wasFit ? { ...fit.current } : contain(view.current);
      apply();
    };
    fit.current = { scale: 0, x: 0, y: 0 };
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [apply, contain, size]);

  React.useLayoutEffect(() => {
    if (size) replay();
  }, [replay, size]);

  /* ---- Pointers: paint, erase, pan, pinch */
  const pointers = React.useRef(new Map<number, { x: number; y: number }>());
  const gesture = React.useRef<
    | { kind: "stroke"; stroke: Extract<Stroke, { kind: "stroke" }>; pointerId: number }
    | { kind: "pan"; pointerId: number; x: number; y: number; start: View }
    | { kind: "pinch"; distance: number; mid: { x: number; y: number }; start: View }
    | null
  >(null);
  const [panning, setPanning] = React.useState(false);

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const toImage = (point: { x: number; y: number }) => ({ x: (point.x - view.current.x) / view.current.scale, y: (point.y - view.current.y) / view.current.scale });
  const brushPixels = () => sizes[live.current.sizeIndex] * Math.max(size?.width || 0, size?.height || 0);

  const ringAt = React.useRef<{ x: number; y: number } | null>(null);
  const moveRing = (point: { x: number; y: number } | null) => {
    const ring = ringRef.current;
    ringAt.current = point;
    if (!ring) return;
    if (!point) { ring.style.opacity = "0"; return; }
    const diameter = brushPixels() * view.current.scale;
    ring.style.opacity = "1";
    ring.style.width = ring.style.height = `${diameter}px`;
    ring.style.transform = `translate3d(${point.x - diameter / 2}px, ${point.y - diameter / 2}px, 0)`;
  };

  const startPinch = () => {
    const [a, b] = Array.from(pointers.current.values());
    gesture.current = { kind: "pinch", distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, start: { ...view.current } };
  };

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!size || (event.pointerType === "mouse" && event.button !== 0 && event.button !== 1)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = local(event);
    pointers.current.set(event.pointerId, point);
    // A second finger turns a stroke that has barely begun into a pinch.
    if (pointers.current.size === 2) {
      if (gesture.current?.kind === "stroke") {
        if (gesture.current.stroke.points.length <= 12) replay();
        else { strokes.current.push(gesture.current.stroke); redo.current = []; changed(); }
      }
      startPinch();
      return;
    }
    if (pointers.current.size > 2) return;
    const current = live.current.spaceHand ? "hand" : live.current.tool;
    if (current === "hand" || event.button === 1) {
      gesture.current = { kind: "pan", pointerId: event.pointerId, x: point.x, y: point.y, start: { ...view.current } };
      setPanning(true);
      return;
    }
    const at = toImage(point);
    const stroke: Extract<Stroke, { kind: "stroke" }> = { kind: "stroke", tool: current, size: brushPixels(), points: [at.x, at.y] };
    gesture.current = { kind: "stroke", stroke, pointerId: event.pointerId };
    const context = ctx();
    if (context) drawStroke(context, stroke);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const point = local(event);
    if (event.pointerType !== "touch") moveRing(activeTool === "hand" ? null : point);
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, point);
    const active = gesture.current;
    if (!active) return;
    if (active.kind === "pinch") {
      const [a, b] = Array.from(pointers.current.values());
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = clamp(active.start.scale * distance / active.distance, fit.current.scale, fit.current.scale * maxZoom);
      const ratio = scale / active.start.scale;
      view.current = contain({ scale, x: mid.x - (active.mid.x - active.start.x) * ratio, y: mid.y - (active.mid.y - active.start.y) * ratio });
      apply();
      return;
    }
    if (active.pointerId !== event.pointerId) return;
    if (active.kind === "pan") {
      view.current = contain({ scale: active.start.scale, x: active.start.x + point.x - active.x, y: active.start.y + point.y - active.y });
      apply();
      return;
    }
    const events = typeof event.nativeEvent.getCoalescedEvents === "function" ? event.nativeEvent.getCoalescedEvents() : [];
    const from = active.stroke.points.length;
    for (const sample of events.length ? events : [event.nativeEvent]) {
      const at = toImage(local(sample));
      active.stroke.points.push(at.x, at.y);
    }
    const context = ctx();
    if (context) drawStroke(context, active.stroke, from);
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    const active = gesture.current;
    if (active?.kind === "pinch") {
      // Lifting one finger of a pinch ends it; the other doesn't start painting.
      if (pointers.current.size < 2) gesture.current = null;
      return;
    }
    if (!active || active.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (active.kind === "pan") { setPanning(false); return; }
    strokes.current.push(active.stroke);
    redo.current = [];
    changed();
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const point = local(event);
    // A trackpad pinch arrives as ctrl+wheel; a mouse wheel scrolls in whole lines or big steps.
    const mouseWheel = event.deltaMode === 1 || (event.deltaX === 0 && Math.abs(event.deltaY) >= 50 && Number.isInteger(event.deltaY));
    if (event.ctrlKey || event.metaKey || mouseWheel) {
      // Each event zooms at most ~25%, whether it's a pinch tick or a whole wheel notch.
      const delta = clamp(event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY, -110, 110);
      // A pinch sends many small deltas, a wheel a few big ones.
      zoomAt(Math.exp(-delta * (event.ctrlKey && Math.abs(delta) < 50 ? 0.01 : 0.002)), point.x, point.y);
    } else {
      view.current = contain({ ...view.current, x: view.current.x - event.deltaX, y: view.current.y - event.deltaY });
      apply();
    }
    moveRing(activeTool === "hand" ? null : point);
  }
  const wheel = React.useRef(onWheel);
  wheel.current = onWheel;
  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handler = (event: WheelEvent) => wheel.current(event);
    viewport.addEventListener("wheel", handler, { passive: false });
    return () => viewport.removeEventListener("wheel", handler);
  }, [size]);

  /* ---- Keys: B, E, H, Space, [ ], 0, ⌘Z, ⇧⌘Z, Delete. Never while typing the prompt. */
  React.useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (typing(event.target)) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      let handled = true;
      if (mod && key === "z") event.shiftKey ? redoStroke() : undo();
      else if (mod && key === "y") redoStroke();
      else if (mod) handled = false;
      else if (key === "b") setTool("brush");
      else if (key === "e") setTool("eraser");
      else if (key === "h") setTool("hand");
      else if (key === " ") { if (!event.repeat) setSpaceHand(true); }
      else if (key === "[") setSizeIndex((index) => Math.max(0, index - 1));
      else if (key === "]") setSizeIndex((index) => Math.min(sizes.length - 1, index + 1));
      else if (key === "0") resetZoom();
      else if (key === "backspace" || key === "delete") clear();
      else handled = false;
      if (handled) event.preventDefault();
    };
    const up = (event: KeyboardEvent) => { if (event.key === " ") setSpaceHand(false); };
    const blur = () => setSpaceHand(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, [clear, redoStroke, resetZoom, undo]);

  // While the size slider is touched, the ring sits in the middle to show the size;
  // a size changed from the keyboard resizes it where it is.
  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (previewing && viewport) moveRing({ x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 });
    else moveRing(previewing ? null : ringAt.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeIndex]);
  React.useEffect(() => {
    const viewport = viewportRef.current;
    moveRing(previewing && viewport ? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewing]);

  if (!box) return null;
  const aspect = size ? size.height / size.width : 0.75;
  const height = `min(${Math.round(Math.max(300, box.width * aspect))}px, 70dvh)`;
  const tools: Array<{ id: Tool; label: string; key: string; icon: React.ReactNode }> = [
    { id: "brush", label: "Brush", key: "B", icon: <Brush size={16} /> },
    { id: "eraser", label: "Eraser", key: "E", icon: <Eraser size={16} /> },
    { id: "hand", label: "Move", key: "H or hold Space", icon: <Hand size={16} /> }
  ];

  return createPortal(
    <motion.div
      ref={popRef}
      className={cn("inpaint-studio", asSheet && "is-sheet")}
      style={asSheet ? undefined : { left: box.left, width: box.width, bottom: box.bottom, height }}
      role="dialog"
      aria-label="Paint the part to change"
      data-open-surface
      initial={{ opacity: 0, y: 10, scale: 0.97, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: 8, scale: 0.98, filter: "blur(3px)" }}
      transition={{ type: "spring", duration: 0.38, bounce: 0.12 }}
    >
      <div
        ref={viewportRef}
        className={cn("inpaint-viewport", `is-${activeTool}`, panning && "is-panning")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(event) => { if (!pointers.current.has(event.pointerId)) moveRing(null); }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {size ? (
          <div ref={stageRef} className="inpaint-stage" style={{ width: size.width, height: size.height }}>
            <SafeImg src={image} draggable={false} onError={() => setFailed(true)} />
            <canvas ref={canvasRef} width={size.width} height={size.height} />
          </div>
        ) : (
          <div className="inpaint-loading">{failed ? "This image couldn’t be opened." : null}</div>
        )}
        <div ref={ringRef} className={cn("inpaint-ring", activeTool === "eraser" && "is-eraser", previewing && "is-preview")} aria-hidden="true" />
        <p className={cn("inpaint-hint", (history.painted || !size) && "is-hidden")} aria-hidden={history.painted}>Paint over what should change</p>
      </div>

      <div className="inpaint-pill" role="toolbar" aria-label="Painting tools">
        {tools.map((item) => (
          <Tip key={item.id} content={<>{item.label} <kbd>{item.key}</kbd></>}>
            <button type="button" className={cn("inpaint-tool", activeTool === item.id && "is-active")} aria-label={item.label} aria-pressed={activeTool === item.id} onClick={() => setTool(item.id)}>
              {item.icon}
            </button>
          </Tip>
        ))}
        <span className="inpaint-divider" aria-hidden="true" />
        <Tip content={<>Undo <kbd>⌘Z</kbd></>}>
          <button type="button" className="inpaint-tool" aria-label="Undo" disabled={!history.undo} onClick={undo}><Undo2 size={16} /></button>
        </Tip>
        <Tip content={<>Redo <kbd>⇧⌘Z</kbd></>}>
          <button type="button" className="inpaint-tool" aria-label="Redo" disabled={!history.redo} onClick={redoStroke}><Redo2 size={16} /></button>
        </Tip>
        {/* Only there while zoomed in: at fit it takes no room and has no tooltip. */}
        <AnimatePresence initial={false}>
          {!zoom.fit ? (
            <motion.div
              key="zoom"
              className="inpaint-zoom"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "auto", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: "spring", duration: 0.32, bounce: 0 }}
            >
              <Tip content={<>Fit to view <kbd>0</kbd></>}>
                <button type="button" className="inpaint-zoom-reset" onClick={resetZoom}>{zoom.percent}%</button>
              </Tip>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <span className="inpaint-divider" aria-hidden="true" />
        <Tip content={<>Done <kbd>Esc</kbd></>}>
          <button type="button" className="inpaint-tool" aria-label="Done painting" onClick={onClose}><X size={16} /></button>
        </Tip>
      </div>

      <SizeSlider index={sizeIndex} onChange={setSizeIndex} onPreview={setPreviewing} />
    </motion.div>,
    document.body
  );
}

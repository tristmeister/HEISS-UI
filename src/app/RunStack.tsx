import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronsDownUp, Ungroup } from 'lucide-react';
import { cn } from './format';
import { Media, Tip } from './components';
import { SafeImg } from './SafeImg';
import { mediaUrl } from './mediaUrl';
import { runTitle, type Moment, type Run } from './runs';
import { videoPreviewUrl } from './videoPreviewScheduler';
import { BURST_EDGE, FLOW_FACE_HEIGHT, FLOW_FACE_WIDTH, SHELF_FOOT, SHELF_HEAD } from './galleryLayout';
import type { GalleryItem } from './types';

/** A still of an output for the cards behind a stack: the thumbnail, or a video's poster. */
export function Still({ item, onLoad }: { item: GalleryItem; onLoad?: () => void }) {
  const preview = item.type === "video" && item.url ? videoPreviewUrl(item.url) : "";
  // Through mediaUrl like a tile's image: the same address, so it comes from the same cache entry.
  const src = item.type === "video" ? (preview ? `${preview}${preview.includes("?") ? "&" : "?"}poster=1` : "") : mediaUrl(item.thumbnailUrl || item.url, item);
  // Unblurs in like a gallery tile's image (media-loading in the styles), instead of popping in.
  const [loaded, setLoaded] = useState(false);
  return (
    <SafeImg
      src={src}
      className={loaded ? undefined : "media-loading"}
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={() => { requestAnimationFrame(() => setLoaded(true)); onLoad?.(); }}
      onDragStart={(event) => event.preventDefault()}
    />
  );
}

const timeFormat = () => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** "7:42 – 11:10 PM", or one time when it all happened at once. */
export function timeSpan(start: number, end: number) {
  const format = timeFormat() as Intl.DateTimeFormat & { formatRange?: (a: Date, b: Date) => string };
  if (end - start < 60_000) return format.format(new Date(end));
  return format.formatRange ? format.formatRange(new Date(start), new Date(end)) : `${format.format(new Date(start))} – ${format.format(new Date(end))}`;
}

function countLabel(items: GalleryItem[]) {
  const done = items.filter((item) => item.status === "done");
  const videos = done.filter((item) => item.type === "video").length;
  const noun = videos === done.length ? (done.length === 1 ? "video" : "videos") : videos ? "outputs" : done.length === 1 ? "image" : "images";
  return `${done.length} ${noun}`;
}

/** What a run is, in a word: takes of one prompt, or variations of it. */
export function runKind(run: Run) {
  return run.variations > 1 ? `${run.count} variations` : `${run.count} takes`;
}

/** A moment's heading: its name, and when and how much, quietly beside it. */
export function MomentHeading({ moment }: { moment: Moment }) {
  return (
    <header className="moment-heading">
      <h2>{moment.title}</h2>
      <span className="moment-meta">
        {moment.part ? <>{moment.part}<i aria-hidden="true">·</i></> : null}
        {timeSpan(moment.start, moment.end)}
        <i aria-hidden="true">·</i>
        {countLabel(moment.items)}
      </span>
    </header>
  );
}

/** How many of a run's outputs the pointer can skim across a stack. */
const SKIM_MAX = 12;

/**
 * A run folded into one tile: its newest output in front, the two before it
 * peeking out behind. Along the bottom, under the title, a strip of ticks:
 * moving the pointer along it skims through the run, the way iPhoto's events
 * did, while the rest of the card stays still. A click deals the run out.
 */
type RunStackProps = {
  run: Run;
  width: number;
  height: number;
  arriving?: boolean;
  onOpen: () => void;
  titleFromPrompt: (value?: string) => string;
  /** A photo with edges under it, or a cover flow inside the card. */
  variant?: "burst" | "flow";
};

function RunStackComponent(props: RunStackProps) {
  return props.variant === "flow" ? <FlowStack {...props} /> : <BurstStack {...props} />;
}

/**
 * A run folded the way Photos folds a burst: it looks like any other photo
 * in the wall, full bleed, with its count in the corner and two hairline
 * edges showing under it. What it is shows on hover; skimming the bottom
 * fifth crossfades through it; a click opens it.
 */
function BurstStack({ run, width, height, arriving = false, onOpen, titleFromPrompt }: RunStackProps) {
  const reducedMotion = useReducedMotion();
  const done = run.items.filter((item) => item.status === "done").slice(0, SKIM_MAX);
  const [skim, setSkim] = useState<number | null>(null);
  const shown = skim !== null ? done[skim] : null;
  const title = runTitle(run);
  return (
    <motion.div
      className={cn("run-stack-wrap is-burst", width < 190 && "is-compact")}
      data-tile-id={run.id}
      style={{ width, height }}
      initial={arriving && !reducedMotion ? { scale: 0.96, opacity: 0.4 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
    >
      <button type="button" className="run-stack run-burst" aria-label={`${title}. ${runKind(run)}. Open the run`} onClick={onOpen}>
        <span className="run-burst-edge is-2" aria-hidden="true" />
        <span className="run-burst-edge is-1" aria-hidden="true" />
        <span className="run-stack-cover run-burst-cover" style={{ top: 0, bottom: BURST_EDGE }}>
          <Media item={run.cover} muted />
          {done.map((item) => item.id === run.cover.id ? null : (
            <span key={item.id} className={cn("run-stack-skim-frame", shown?.id === item.id && "is-shown")}>{skim !== null ? <Still item={item} /> : null}</span>
          ))}
          <span className="run-burst-shade" aria-hidden="true" />
          <span className="run-stack-count" aria-hidden="true">{run.count}</span>
          <span className="run-stack-text">
            <small>{runKind(run)}</small>
            <strong title={titleFromPrompt(run.cover.prompt)}>{title}</strong>
          </span>
          <SkimStrip count={done.length} at={skim} onSkim={setSkim} />
        </span>
      </button>
    </motion.div>
  );
}

/** Skim ticks along the bottom fifth of a card; `onSkim` gets the output pointed at, or null. */
function SkimStrip({ count, at, onSkim }: { count: number; at: number | null; onSkim: (index: number | null) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  if (count < 2) return null;
  return (
    <span
      ref={ref}
      className={cn("run-stack-skim", at !== null && "is-on")}
      aria-hidden="true"
      onPointerMove={(event) => {
        // A mouse or a pen (Surface, tablets) skims; a finger scrolls.
        if (event.pointerType === "touch" || !ref.current) return;
        const box = ref.current.getBoundingClientRect();
        const share = Math.min(0.999, Math.max(0, (event.clientX - box.left) / box.width));
        onSkim(Math.floor(share * count));
      }}
      onPointerLeave={() => onSkim(null)}
    >
      {Array.from({ length: count }, (_, index) => <i key={index} className={cn(index === at && "is-at")} />)}
    </span>
  );
}

/**
 * A run folded into one card as a cover flow. The card is shaped by its
 * cover, so the face in front nearly fills it; the faces beside it turn gently
 * away like prints fanned on a table and fade out at the card's edges; and
 * behind them all glows the cover itself, blurred right down, so the card
 * takes its colour from the run instead of sitting in the wall as a dark box.
 * The run wraps round, so the oldest takes wait on the left of the newest.
 * Skimming the bottom fifth turns the flow; a click opens the run.
 */
function FlowStack({ run, width, height, arriving = false, onOpen, titleFromPrompt }: RunStackProps) {
  const reducedMotion = useReducedMotion();
  const done = run.items.filter((item) => item.status === "done").slice(0, SKIM_MAX);
  const [skim, setSkim] = useState<number | null>(null);
  const center = skim ?? 0;
  const count = done.length;
  const title = runTitle(run);
  const compact = width < 190;
  const ratio = Number(run.cover.width || 1) / Math.max(1, Number(run.cover.height || 1));
  let faceH = height * FLOW_FACE_HEIGHT;
  let faceW = faceH * ratio;
  if (faceW > width * FLOW_FACE_WIDTH) { faceW = width * FLOW_FACE_WIDTH; faceH = faceW / ratio; }
  // Even whole pixels, so the front face, centred at -50%, sits on the pixel
  // grid: at 125% or 150% display scaling (Windows) it is otherwise drawn
  // half a pixel off and comes out soft.
  faceW = Math.max(2, Math.round(faceW / 2) * 2);
  faceH = Math.max(2, Math.round(faceH / 2) * 2);
  // Two faces to a side at most: more are lost in the fade and cost frames.
  const reach = Math.min(2, Math.floor((count - 1) / 2));
  const extraRight = count > 1 && (count - 1) % 2 === 1 && reach < 2 ? 1 : 0;
  // The front image loads first, like any tile; the faces beside it and the
  // glow follow once it's in, so a card costs one image at first, not six.
  const [frontReady, setFrontReady] = useState(false);
  useEffect(() => {
    if (frontReady) return;
    const timer = window.setTimeout(() => setFrontReady(true), 1500);
    return () => window.clearTimeout(timer);
  }, [frontReady]);
  const leaves: Array<{ item: GalleryItem; offset: number }> = [];
  for (let offset = -reach; offset <= reach + extraRight; offset += 1) {
    if (offset && !frontReady) continue;
    leaves.push({ item: done[(((center + offset) % count) + count) % count], offset });
  }
  return (
    <motion.div
      className={cn("run-stack-wrap is-flow", compact && "is-compact")}
      data-tile-id={run.id}
      style={{ width, height }}
      initial={arriving && !reducedMotion ? { scale: 0.96, opacity: 0.4 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
    >
      <button type="button" className="run-stack run-flow" aria-label={`${title}. ${runKind(run)}. Open the run`} onClick={onOpen}>
        {frontReady ? <span className="run-flow-ambient" aria-hidden="true"><Still item={run.cover} /></span> : null}
        <span className="run-flow-stage" style={{ "--face-w": `${faceW}px`, "--face-h": `${faceH}px`, "--face-x": `${Math.round((width - faceW) / 2)}px`, "--face-y": `${Math.round((height - faceH) / 2)}px` } as React.CSSProperties}>
          {leaves.map(({ item, offset }) => {
            const side = Math.sign(offset);
            const away = Math.abs(offset);
            const x = away ? side * (faceW * 0.42 + away * faceW * 0.16) : 0;
            return (
              <span
                key={item.id}
                className={cn("run-flow-face", !away && "is-front")}
                style={{
                  transform: `translateX(${Math.round(x)}px) translateZ(${-away * 46}px) rotateY(${-side * 40}deg)`,
                  zIndex: 10 - away,
                  "--away": away,
                } as React.CSSProperties}
              >
                {item.id === run.cover.id && !away && item.type === "video" ? <Media item={item} muted /> : <Still item={item} onLoad={away ? undefined : () => setFrontReady(true)} />}
              </span>
            );
          })}
        </span>
        <span className="run-flow-shade" aria-hidden="true" />
        <span className="run-stack-count" aria-hidden="true">{run.count}</span>
        <span className="run-stack-text">
          <small>{runKind(run)}</small>
          <strong title={titleFromPrompt(run.cover.prompt)}>{title}</strong>
        </span>
        <SkimStrip count={count} at={skim} onSkim={setSkim} />
      </button>
    </motion.div>
  );
}

export const RunStack = React.memo(RunStackComponent, (previous, next) =>
  previous.run === next.run
  && previous.width === next.width
  && previous.height === next.height
  && previous.arriving === next.arriving
  && previous.variant === next.variant);

/**
 * An open run on its shelf: a line naming it, with the fold right beside the
 * name, its rows (ordinary gallery tiles, laid over this), and a thin lit
 * ledge just under them. The shelf is as wide as its rows.
 */
export function RunShelf({ run, y, width, height, folding, arriving, onClose, onUnstack }: {
  run: Run;
  y: number;
  width: number;
  height: number;
  folding: boolean;
  arriving: boolean;
  onClose: () => void;
  onUnstack?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const title = runTitle(run);
  const meta = [run.live ? "Generating" : runKind(run), run.model ? modelName(run.model) : "", timeSpan(run.start, run.end)].filter(Boolean);
  return (
    <motion.div
      className={cn("run-shelf", run.live && "is-live")}
      data-run-shelf={run.id}
      style={{ left: 0, top: 0, width, height }}
      initial={arriving && !reducedMotion ? { y: y + 8, opacity: 0 } : false}
      animate={{ y, opacity: folding ? 0 : 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 42, opacity: { duration: folding ? 0.2 : 0.3 } }}
    >
      <header className="run-shelf-head" style={{ height: SHELF_HEAD }}>
        <strong>{title}</strong>
        <small>{meta.map((part, index) => <React.Fragment key={part}>{index ? <i aria-hidden="true">·</i> : null}{part}</React.Fragment>)}</small>
        <span className="run-shelf-actions">
          <button type="button" className="run-shelf-action" aria-label={`Fold ${title} back into a stack`} onClick={onClose}>
            <ChevronsDownUp size={13} strokeWidth={2.2} />
            <span>Fold</span>
          </button>
          {onUnstack ? (
            <Tip content="Keep these as separate images">
              <button type="button" className="run-shelf-action" aria-label={`Unstack ${title}`} onClick={onUnstack}>
                <Ungroup size={13} strokeWidth={2} />
                <span>Unstack</span>
              </button>
            </Tip>
          ) : null}
        </span>
      </header>
      <span className="run-shelf-ledge" aria-hidden="true" style={{ height: SHELF_FOOT }} />
    </motion.div>
  );
}

/** "flux1-dev-fp8.safetensors" → "flux1-dev-fp8". */
export function modelName(model: string) {
  const base = model.split(/[\\/]/).pop() || model;
  return base.replace(/\.(safetensors|ckpt|gguf|pt|pth|bin)$/i, "");
}

/**
 * A stacked run as zen shows it: a little fan of its outputs, what it is, and
 * the way into it. Zen steps over a run as one thing; the run itself opens in
 * the gallery.
 */
export function RunCard({ run, onOpen }: { run: Run; onOpen: () => void }) {
  const reducedMotion = useReducedMotion();
  const done = run.items.filter((item) => item.status === "done").slice(0, 5);
  const fan = done.slice().reverse();
  const middle = (fan.length - 1) / 2;
  const ratio = Number(run.cover.width || 1) / Math.max(1, Number(run.cover.height || 1));
  return (
    <div className="run-card" style={{ "--card-ratio": ratio } as React.CSSProperties}>
      <button type="button" className="run-card-fan" aria-label={`Open ${runTitle(run)} in the gallery`} onClick={onOpen}>
        {fan.map((item, index) => {
          const offset = index - middle;
          const front = index === fan.length - 1;
          return (
            <motion.span
              key={item.id}
              className={cn("run-card-leaf", front && "is-front")}
              initial={reducedMotion ? false : { rotate: 0, x: 0, opacity: 0, scale: 0.9 }}
              animate={{ rotate: front ? 0 : offset * 5, x: front ? 0 : `${offset * 16}%`, y: front ? 0 : Math.abs(offset) * 6, opacity: 1, scale: front ? 1 : 0.9 }}
              transition={{ type: "spring", stiffness: 260, damping: 26, delay: reducedMotion ? 0 : index * 0.035 }}
              style={{ zIndex: front ? 10 : index }}
            >
              {front ? <Media item={item} muted /> : <Still item={item} />}
            </motion.span>
          );
        })}
      </button>
      <div className="run-card-text">
        <small>{runKind(run)}{run.model ? <><i aria-hidden="true">·</i>{modelName(run.model)}</> : null}</small>
        <strong>{runTitle(run)}</strong>
        <button type="button" className="run-card-open" onClick={onOpen}>
          <span>Open in gallery</span>
        </button>
      </div>
    </div>
  );
}

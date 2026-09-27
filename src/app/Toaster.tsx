import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useAnimate, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { AnimatedNumber } from './AnimatedNumber';
import { cn } from './format';
import { dismissToast, runToastAction, subscribeToasts, toastSnapshot, type ToastGlyph, type ToastRecord, type ToastTone } from './toast';
import { usePageHidden, usePausableTimeout } from '@/hooks/use-pausable-timeout';

/**
 * The toast stack, top center under the pills. At rest the newest sits in
 * front and up to two older ones peek out below it, smaller; hovering (or a
 * tap on a phone) fans them out and pauses every timer. A toast leaves when
 * its time is up, on its close button, or with a flick upwards.
 */

const VISIBLE = 3;
const PEEK = 10;
const GAP = 8;
const FALLBACK_HEIGHT = 50;

const STACK_SPRING = { type: 'spring', duration: 0.5, bounce: 0.18 } as const;

/* ------------------------------------------------------------- Glyphs
   Seven-by-seven cells, the same pixel language as the upscale arrow and the
   plug. Each draws itself in on arrival, in its own order, and again on every
   bump, so a trash lid flaps once per delete. */

const GLYPHS: Record<ToastGlyph, string[]> = {
  info: ['...X...', '.......', '..XX...', '...X...', '...X...', '...X...', '..XXX..'],
  check: ['.......', '......X', '.....XX', 'X...XX.', 'XX.XX..', '.XXX...', '..X....'],
  bang: ['..XXX..', '..XXX..', '..XXX..', '...X...', '...X...', '.......', '...X...'],
  cross: ['X.....X', '.X...X.', '..X.X..', '...X...', '..X.X..', '.X...X.', 'X.....X'],
  trash: ['..XXX..', 'XXXXXXX', '.......', '.XXXXX.', '.X.X.X.', '.X.X.X.', '..XXX..'],
  lock: ['..XXX..', '.X...X.', '.X...X.', 'XXXXXXX', 'XXX.XXX', 'XXX.XXX', 'XXXXXXX']
};

const TONE_GLYPH: Record<ToastTone, ToastGlyph> = { neutral: 'info', success: 'check', warning: 'bang', error: 'cross', removed: 'trash' };

/** Rows that move as one piece: the trash lid lifts, the lock's shackle clicks shut. */
const LID_ROWS: Partial<Record<ToastGlyph, number>> = { trash: 2, lock: 3 };

/** When each cell lights, in steps: the order the glyph would be drawn by hand. */
function cellStep(glyph: ToastGlyph, x: number, y: number) {
  switch (glyph) {
    case 'check': return x;
    case 'cross': return Math.max(Math.abs(x - 3), Math.abs(y - 3));
    case 'trash': return 6 - y;
    case 'lock': return 6 - y;
    default: return y;
  }
}

function CellGlyph({ glyph }: { glyph: ToastGlyph }) {
  const rows = GLYPHS[glyph];
  const lidRows = LID_ROWS[glyph] || 0;
  const cells = rows.flatMap((row, y) => [...row].map((bit, x) => (bit === 'X' ? { x, y } : null)).filter(Boolean)) as Array<{ x: number; y: number }>;
  const rect = ({ x, y }: { x: number; y: number }) => (
    <rect key={`${x}-${y}`} x={x + 0.08} y={y + 0.08} width={0.84} height={0.84} rx={0.16} style={{ animationDelay: `${cellStep(glyph, x, y) * 38}ms` }} />
  );
  return (
    <svg className={cn('toast-cells', `is-${glyph}`)} viewBox="-0.5 -0.5 8 8" aria-hidden="true">
      <g className="toast-cells-body">{cells.filter((cell) => cell.y >= lidRows).map(rect)}</g>
      {lidRows ? <g className="toast-cells-lid">{cells.filter((cell) => cell.y < lidRows).map(rect)}</g> : null}
    </svg>
  );
}

const isGlyphName = (value: unknown): value is ToastGlyph => typeof value === 'string' && value in GLYPHS;

/* -------------------------------------------------------------- Title
   With a plural, the count sits inside the words ("3 images deleted") and only
   the digits roll; without one, repeats show as a small ×N after the title. */

function numberAt(text: string, number: string) {
  const match = new RegExp(`(^|\\D)${number}(?!\\d)`).exec(text);
  return match ? match.index + match[1].length : -1;
}

function ToastTitle({ toast }: { toast: ToastRecord }) {
  const reduced = useReducedMotion();
  const counted = toast.count > 1 && toast.plural;
  const text = counted ? toast.plural!(toast.count) : toast.title;
  const digits = String(toast.count);
  const at = counted ? numberAt(text, digits) : -1;
  const before = at >= 0 ? text.slice(0, at) : text;
  const after = at >= 0 ? text.slice(at + digits.length) : '';
  return (
    <strong className="toast-title">
      {/* Words only swap when they change; the number rolls on its own. */}
      <motion.span
        key={`${before}#${after}`}
        className="toast-title-text"
        initial={reduced ? false : { opacity: 0, y: 5, filter: 'blur(3px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ type: 'spring', duration: 0.34, bounce: 0 }}
      >
        {before}
        {at >= 0 ? <AnimatedNumber value={toast.count} className="toast-number" /> : null}
        {after}
      </motion.span>
      {!toast.plural && toast.count > 1 ? (
        <span className="toast-count" aria-label={`${toast.count} times`}>
          ×<AnimatedNumber value={toast.count} />
        </span>
      ) : null}
    </strong>
  );
}

/* -------------------------------------------------------------- Stack */

/** `offset`: how far below the top edge the stack starts, so it clears the pills. */
export function Toaster({ offset = 0 }: { offset?: number }) {
  const toasts = useSyncExternalStore(subscribeToasts, toastSnapshot, toastSnapshot);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const pageHidden = usePageHidden();
  const listRef = useRef<HTMLOListElement>(null);

  const expanded = (hovered || focused || pinned) && toasts.length > 1;
  const paused = hovered || focused || pinned || pageHidden;

  const onHeight = useCallback((id: string, height: number) => {
    setHeights((current) => (current[id] === height ? current : { ...current, [id]: height }));
  }, []);

  // A stack of one has nothing to fan out, and heights of toasts that left are dead weight.
  useEffect(() => {
    if (!toasts.length) { setPinned(false); setHovered(false); }
    setHeights((current) => {
      const live = Object.fromEntries(Object.entries(current).filter(([id]) => toasts.some((toast) => toast.id === id)));
      return Object.keys(live).length === Object.keys(current).length ? current : live;
    });
  }, [toasts]);

  // A tap fans the stack out on touch; a tap anywhere else folds it again.
  useEffect(() => {
    if (!pinned) return;
    const fold = (event: PointerEvent) => {
      if (!listRef.current?.contains(event.target as Node)) setPinned(false);
    };
    document.addEventListener('pointerdown', fold, true);
    return () => document.removeEventListener('pointerdown', fold, true);
  }, [pinned]);

  const shown = toasts.slice(0, VISIBLE + 1);
  const heightOf = (toast?: ToastRecord) => (toast && heights[toast.id]) || FALLBACK_HEIGHT;
  const frontHeight = heightOf(shown[0]);
  const offsets: number[] = [];
  let run = 0;
  for (const toast of shown) {
    offsets.push(run);
    run += heightOf(toast) + GAP;
  }
  const visibleCount = Math.min(shown.length, VISIBLE);
  const extent = !shown.length ? 0
    : expanded ? offsets[visibleCount - 1] + heightOf(shown[visibleCount - 1])
    : frontHeight + PEEK * (visibleCount - 1);

  return createPortal(
    <section className="toasts" data-toaster="" aria-label="Notifications" style={{ '--toasts-offset': `${offset}px` } as React.CSSProperties}>
      <ol
        ref={listRef}
        className={cn('toasts-list', expanded && 'is-expanded')}
        style={{ height: extent }}
        onPointerEnter={(event) => { if (event.pointerType === 'mouse') setHovered(true); }}
        onPointerLeave={(event) => { if (event.pointerType === 'mouse') setHovered(false); }}
        onClick={(event) => {
          const touch = !window.matchMedia('(hover: hover)').matches;
          if (touch && !(event.target as Element).closest('button, a')) setPinned((value) => !value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false); }}
      >
        <AnimatePresence initial={false}>
          {shown.map((toast, index) => (
            <ToastItem
              key={toast.id}
              toast={toast}
              index={index}
              expanded={expanded}
              paused={paused}
              y={expanded ? offsets[index] : Math.min(index, VISIBLE - 1) * PEEK}
              height={expanded || index === 0 ? heights[toast.id] : frontHeight}
              onHeight={onHeight}
            />
          ))}
        </AnimatePresence>
      </ol>
    </section>,
    document.body
  );
}

function ToastItem({ toast, index, expanded, paused, y, height, onHeight }: {
  toast: ToastRecord;
  index: number;
  expanded: boolean;
  paused: boolean;
  y: number;
  /** Undefined until measured: the glass then sizes to its content. */
  height?: number;
  onHeight: (id: string, height: number) => void;
}) {
  const reduced = useReducedMotion();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bumpScope, animate] = useAnimate<HTMLDivElement>();
  const front = index === 0;
  const hiddenBehind = index >= VISIBLE;
  const readable = expanded || front;

  // The glass is sized from its content, which is never squeezed, so this is the real height.
  useLayoutEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    const measure = () => onHeight(toast.id, node.offsetHeight + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [toast.id, onHeight]);

  // Time on screen, paused while the stack is hovered or the tab is hidden.
  // A merge (new version) starts it over.
  usePausableTimeout(toast.duration, () => dismissToast(toast.id), paused, toast.version);

  // Another one of the same: a small bump of the glass.
  const seen = useRef(toast.version);
  useEffect(() => {
    if (toast.version === seen.current) return;
    seen.current = toast.version;
    if (reduced || !bumpScope.current) return;
    animate(bumpScope.current, { scale: [1, 1.045, 0.99, 1] }, { duration: 0.46, times: [0, 0.3, 0.7, 1], ease: 'easeOut' });
  }, [toast.version, reduced, animate, bumpScope]);

  const glyph = toast.glyph === undefined || isGlyphName(toast.glyph) ? (toast.glyph as ToastGlyph | undefined) || TONE_GLYPH[toast.tone] : null;
  const timed = Boolean(toast.actionLabel) && Number.isFinite(toast.duration);

  return (
    <motion.li
      className="toast"
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-hidden={hiddenBehind || undefined}
      style={{ zIndex: 20 - index }}
      initial={reduced ? false : { y: -26, scale: 0.9 }}
      animate={{ y, scale: expanded ? 1 : 1 - Math.min(index, VISIBLE) * 0.05 }}
      exit={reduced ? undefined : { scale: 0.9, y: y - 10, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
      transition={reduced ? { duration: 0 } : STACK_SPRING}
    >
      <motion.div
        className="toast-drag"
        drag={readable ? 'y' : false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.55, bottom: 0.06 }}
        dragSnapToOrigin
        onDragEnd={(_, info) => { if (info.offset.y < -26 || info.velocity.y < -420) dismissToast(toast.id); }}
      >
        <div ref={bumpScope} className="toast-bump">
          {/* Opacity lives on the glass itself: on a parent it would cut off the backdrop blur. */}
          <motion.div
            className={cn('island', 'toast-island', `is-${toast.tone}`)}
            initial={{ opacity: 0 }}
            animate={{ opacity: hiddenBehind ? 0 : 1, height: height ?? 'auto' }}
            exit={{ opacity: 0, transition: { duration: 0.18 } }}
            transition={reduced ? { duration: 0.15 } : { opacity: { duration: 0.2 }, height: STACK_SPRING }}
          >
            <div ref={bodyRef} className={cn('toast-body', !readable && 'is-tucked')} inert={!readable || undefined}>
              {glyph ? (
                <span className="toast-glyph">
                  <CellGlyph key={toast.version} glyph={glyph} />
                  {timed ? (
                    <svg className={cn('toast-ring', paused && 'is-paused')} viewBox="0 0 36 36" aria-hidden="true">
                      <circle key={toast.version} cx="18" cy="18" r="17" pathLength={100} style={{ animationDuration: `${toast.duration}ms` }} />
                    </svg>
                  ) : null}
                </span>
              ) : (
                <span className="toast-glyph is-custom" key={toast.version}>{toast.glyph as React.ReactNode}</span>
              )}
              <span className="toast-text">
                <ToastTitle toast={toast} />
                {toast.description ? <small>{toast.description}</small> : null}
              </span>
              {toast.actionLabel ? (
                <button type="button" className="island-action" onClick={() => runToastAction(toast.id)}>{toast.actionLabel}</button>
              ) : null}
              <button type="button" className="island-close toast-close" onClick={() => dismissToast(toast.id)} aria-label="Dismiss"><X size={13} /></button>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </motion.li>
  );
}

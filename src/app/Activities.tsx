import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { CellBar } from './UpscaleDialogs';
import { Tip } from './components';
import { cn } from './format';
import { usePageHidden, usePausableTimeout } from '@/hooks/use-pausable-timeout';

/**
 * Activities: the long-running work that floats at the top edge while it
 * happens (a download, an update, a generation you can't see), one island
 * each, stacked in a column above the toasts.
 *
 * Each is declared from state: a hook returns an `Activity` while there is
 * something to show, or null. The column owns everything that is the same
 * for all of them: the glass, the order, entering and leaving, the words
 * morphing when the phase changes, and how a finished one behaves.
 *
 * When the work ends, the island stays and becomes a note ("Smart upscale is
 * ready"): same glass, new words, a close button, and `expire` takes it away
 * after a while, held for as long as the pointer rests on it.
 */

export type ActivityState = 'live' | 'done' | 'error';
export type ActivityCommand = { label: string; run: () => void };
/**
 * A round icon button in the island's expanded row: `label` for screen
 * readers, `tip` on hover. `run` may return a promise; once it settles, focus
 * that went with a button the new phase took away comes back to the island.
 */
export type ActivityControl = { key: string; label: string; tip: string; icon: React.ReactNode; tone?: 'danger'; run: () => unknown };

export type Activity = {
  /** Stable for as long as it is the same work: the island stays and its content morphs. */
  id: string;
  /** What it is doing now. A new phase swaps the words; the glyph stays and animates by itself. */
  phase: string;
  state: ActivityState;
  glyph: React.ReactNode;
  title: React.ReactNode;
  /** A figure right of the title, like the percentage. */
  figure?: React.ReactNode;
  /** A small count after the title, like "+2" for more waiting their turn. */
  badge?: React.ReactNode;
  /** 0–1: a cell bar under the title. */
  progress?: number;
  meta?: React.ReactNode;
  /** The whole meta line as a tooltip, when it may be cut off. */
  metaTitle?: string;
  /** Let the meta wrap onto a second line instead of trailing off. */
  metaLines?: 1 | 2;
  /** Something small on the right edge of the body, like a thumbnail. */
  aside?: React.ReactNode;
  wide?: boolean;
  /** Clicking the body: where this work lives. */
  open?: ActivityCommand;
  /**
   * Buttons the island grows to hold, like the Dynamic Island: on hover, on
   * keyboard focus, or on a first tap where there is no hover (the second
   * tap opens). The words stay where they are; a row opens under them.
   */
  controls?: ActivityControl[];
  /** Where `open` goes, said quietly at the end of that row, like "Show in Workflows". */
  openHint?: string;
  /** One bright capsule. */
  action?: ActivityCommand;
  dismiss?: ActivityCommand & { title?: string };
  /** A finished note leaves after this long on screen, never while it is hovered. */
  expire?: { after: number; run: () => void };
};

const ENTER = { type: 'spring', duration: 0.46, bounce: 0.16 } as const;

/**
 * The column, in the order given. `onHeight` reports how tall it is, so the
 * toasts can start just under it.
 */
export function ActivityColumn({ activities, onHeight }: {
  activities: Array<Activity | null | undefined | false>;
  onHeight?: (height: number) => void;
}) {
  const observer = useRef<ResizeObserver | null>(null);
  const report = useRef(onHeight);
  report.current = onHeight;
  const measureRef = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    const measure = () => report.current?.(node.offsetHeight);
    measure();
    observer.current = new ResizeObserver(measure);
    observer.current.observe(node);
  }, []);
  const shown = activities.filter(Boolean) as Activity[];
  return (
    <div className="islands" ref={measureRef}>
      <AnimatePresence initial={false}>
        {shown.map((activity) => <ActivityIsland key={activity.id} activity={activity} />)}
      </AnimatePresence>
    </div>
  );
}

const HOVER_IN_MS = 90;
const HOVER_OUT_MS = 240;

/** Focus that came from the keyboard. A click or tap focuses too, and that is hover's (or the tap's) business. */
function keyboardFocus(target: EventTarget) {
  try { return (target as HTMLElement).matches(':focus-visible'); } catch { return true; }
}

function ActivityIsland({ activity }: { activity: Activity }) {
  const reduced = useReducedMotion();
  const [held, setHeld] = useState(false);
  const pageHidden = usePageHidden();
  const [height, setHeight] = useState<number>();
  const islandRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const { expire, controls } = activity;

  // Open while hovered, while a key has focus inside, or pinned by a tap; the hover with a little intent either way.
  const canExpand = Boolean(controls?.length);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const expanded = canExpand && (hovered || focused || pinned);
  const hoverTimer = useRef(0);
  const pointer = useRef('');
  const hover = (on: boolean) => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHovered(on), on ? HOVER_IN_MS : HOVER_OUT_MS);
  };
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  useEffect(() => { if (!canExpand) setPinned(false); }, [canExpand]);
  // A tap anywhere else folds a pinned island back.
  useEffect(() => {
    if (!pinned) return;
    const away = (event: PointerEvent) => { if (!islandRef.current?.contains(event.target as Node)) setPinned(false); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [pinned]);

  usePausableTimeout(expire ? expire.after : null, () => expire?.run(), held || expanded || pageHidden, `${activity.id}:${activity.phase}`);

  // The glass follows its content's height, so a new phase grows or shrinks it smoothly.
  useLayoutEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    const measure = () => setHeight(node.offsetHeight + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const clickMain = () => {
    // No hover on touch: the first tap shows the buttons, the next one opens.
    if (canExpand && pointer.current === 'touch' && !expanded) { setPinned(true); return; }
    activity.open?.run();
  };
  // A control that swaps the island's phase can take its own button away; focus stays on the island.
  const runControl = (control: ActivityControl) => {
    Promise.resolve(control.run()).catch(() => null).finally(() => window.requestAnimationFrame(() => {
      const island = islandRef.current;
      // Only focus that fell to the page; never pull it back from somewhere it was moved to.
      if (!island || document.activeElement !== document.body) return;
      // In this order: a list selector would always find the main button first.
      const next = ['.activity-control', '.island-action', '.activity-main'].map((selector) => island.querySelector<HTMLElement>(selector)).find(Boolean);
      next?.focus();
    }));
  };
  const fold = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || !expanded) return;
    event.stopPropagation();
    // Off a button that is about to go, back onto the island itself.
    if (!mainRef.current?.contains(document.activeElement) && activity.open) mainRef.current?.focus();
    setPinned(false);
    setFocused(false);
    setHovered(false);
  };

  const Main = activity.open ? 'button' : 'div';
  return (
    <motion.div
      ref={islandRef}
      layout="position"
      className={cn('island', 'activity', `is-${activity.state}`, activity.wide && 'is-wide', expanded && 'is-expanded')}
      role="status"
      aria-live="polite"
      // Opacity on the glass itself: on a parent it would cut off the backdrop blur.
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -18, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1, height: height ?? 'auto' }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.96 }}
      transition={reduced ? { duration: 0.15 } : ENTER}
      onPointerDownCapture={(event) => { pointer.current = event.pointerType; }}
      onPointerEnter={(event) => { setHeld(true); if (event.pointerType !== 'touch') hover(true); }}
      onPointerLeave={(event) => { setHeld(false); if (event.pointerType !== 'touch') hover(false); }}
      onFocus={(event) => { setHeld(true); if (keyboardFocus(event.target)) setFocused(true); }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { setHeld(false); setFocused(false); } }}
      onKeyDown={fold}
    >
      <div ref={bodyRef} className="activity-body">
        <Main
          ref={mainRef as React.Ref<never>}
          {...(activity.open ? { type: 'button' as const, onClick: clickMain, 'aria-label': activity.open.label } : canExpand ? { onClick: clickMain } : {})}
          className="activity-main"
        >
          <span className="activity-glyph">{activity.glyph}</span>
          <span className="activity-text">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={activity.phase}
                className="activity-copy"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, filter: 'blur(3px)' }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6, filter: 'blur(3px)' }}
                transition={{ type: 'spring', duration: 0.38, bounce: 0 }}
              >
                <span className="activity-title">
                  <strong>{activity.title}</strong>
                  {activity.badge !== undefined ? <span className="activity-badge">{activity.badge}</span> : null}
                  {activity.figure !== undefined ? <em>{activity.figure}</em> : null}
                </span>
                {activity.progress !== undefined ? <CellBar value={activity.progress} /> : null}
                {activity.meta ? (
                  <small className={cn(activity.metaLines === 2 && 'is-two-line')} title={activity.metaTitle}>{activity.meta}</small>
                ) : null}
              </motion.span>
            </AnimatePresence>
          </span>
          {activity.aside}
        </Main>
        {activity.action ? <button type="button" className="island-action" onClick={activity.action.run}>{activity.action.label}</button> : null}
        {activity.dismiss ? (
          <button type="button" className="island-close" onClick={activity.dismiss.run} aria-label={activity.dismiss.label} title={activity.dismiss.title}><X size={13} /></button>
        ) : null}
        {/* Popped out of the flow as it leaves, so the glass closes while the buttons fade. */}
        <AnimatePresence mode="popLayout" initial={false}>
          {expanded ? (
            <motion.div
              key="controls"
              className="activity-controls"
              role="group"
              aria-label="Controls"
              aria-live="off"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.94, filter: 'blur(4px)' }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97, filter: 'blur(4px)' }}
              transition={reduced ? { duration: 0.12 } : { type: 'spring', duration: 0.4, bounce: 0.12 }}
            >
              {controls!.map((control) => (
                <Tip key={control.key} content={control.tip}>
                  <button type="button" className={cn('activity-control', control.tone === 'danger' && 'is-danger')} aria-label={control.label} onClick={() => runControl(control)}>
                    {control.icon}
                  </button>
                </Tip>
              ))}
              {activity.open && activity.openHint ? (
                <button type="button" className="activity-control-hint" onClick={activity.open.run}>{activity.openHint}</button>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

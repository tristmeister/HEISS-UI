import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { CellBar } from './UpscaleDialogs';
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

function ActivityIsland({ activity }: { activity: Activity }) {
  const reduced = useReducedMotion();
  const [held, setHeld] = useState(false);
  const pageHidden = usePageHidden();
  const [height, setHeight] = useState<number>();
  const bodyRef = useRef<HTMLDivElement>(null);
  const { expire } = activity;

  usePausableTimeout(expire ? expire.after : null, () => expire?.run(), held || pageHidden, `${activity.id}:${activity.phase}`);

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

  const Main = activity.open ? 'button' : 'div';
  return (
    <motion.div
      layout="position"
      className={cn('island', 'activity', `is-${activity.state}`, activity.wide && 'is-wide')}
      role="status"
      aria-live="polite"
      // Opacity on the glass itself: on a parent it would cut off the backdrop blur.
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -18, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1, height: height ?? 'auto' }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.96 }}
      transition={reduced ? { duration: 0.15 } : ENTER}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setHeld(false); }}
    >
      <div ref={bodyRef} className="activity-body">
        <Main
          {...(activity.open ? { type: 'button' as const, onClick: activity.open.run, 'aria-label': activity.open.label } : {})}
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
      </div>
    </motion.div>
  );
}

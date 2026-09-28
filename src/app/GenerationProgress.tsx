import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from './format';
import { ElapsedTime } from './ElapsedTime';
import { serverClockOffset } from './api';
import type { GalleryItem, Progress } from './types';

const numberVariants = {
  initial: { opacity: 0, y: 3 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const } },
  exit: { opacity: 0, y: -3, transition: { duration: 0.1 } },
};

/**
 * Sampler steps are the only count shown as steps. Anything else ComfyUI
 * reports (tiles of a VAE encode, an upscale) is a named phase; older progress
 * without a phase keeps reading as steps.
 */
export function progressReading(progress?: Progress | null) {
  if (progress?.phase && !progress.steps) {
    const percent = progress.max > 1 ? Math.min(100, Math.round((progress.value / progress.max) * 100)) : null;
    return { kind: 'phase' as const, label: progress.phase, percent };
  }
  if (progress?.max) return { kind: 'steps' as const, value: progress.value, max: progress.max, ratio: Math.min(1, Math.max(0, progress.value / progress.max)) };
  return { kind: 'queued' as const };
}

/** One short line for status text: "Step 3/20", "Encoding image 40%", "Queued". */
export function progressLine(progress?: Progress | null) {
  const reading = progressReading(progress);
  if (reading.kind === 'steps') return `Step ${reading.value} of ${reading.max}`;
  if (reading.kind === 'phase') return reading.percent !== null ? `${reading.label} ${reading.percent}%` : reading.label;
  return '';
}

/**
 * Time left, the way people say it: exact while short, rounded once it is
 * long enough that a second either way means nothing, and "almost done"
 * rather than a countdown stuck at zero.
 */
export function formatLeft(ms: number) {
  if (ms <= 1500) return 'Almost done';
  const seconds = ms / 1000;
  if (seconds < 20) return `${Math.ceil(seconds)} s left`;
  if (seconds < 60) return `About ${Math.max(20, Math.round(seconds / 5) * 5)} s left`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `About ${Math.max(1, minutes)} min left`;
  const hours = Math.floor(minutes / 60);
  return `About ${hours} h ${minutes % 60} min left`;
}

/**
 * A run's clock, ticking each second on the server's time: how long is left
 * and, once it is running, how far along it is overall (never quite full, so
 * a late finish never looks stuck at 100%). Nulls when the server has no
 * honest estimate.
 */
export function useRunClock(progress?: Progress | null) {
  const endsAt = progress?.endsAt;
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!endsAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [endsAt]);
  if (!endsAt) return { leftMs: null, ratio: null };
  const serverNow = now + serverClockOffset;
  const leftMs = Math.max(0, endsAt - serverNow);
  const started = progress?.runStartedAt;
  const ratio = started && endsAt > started ? Math.min(0.98, Math.max(0, (serverNow - started) / (endsAt - started))) : null;
  return { leftMs, ratio };
}

/** "12 s left" for a running item, ticking by itself, or nothing without an estimate. */
export function RunLeft({ progress }: { progress?: Progress | null }) {
  const { leftMs } = useRunClock(progress);
  return leftMs === null ? null : <>{formatLeft(leftMs)}</>;
}

/** The overlay on a running generation: what it is doing, how far, and how long is left (or how long it has been). */
export function GenerationProgress({ item, formatElapsed }: { item: GalleryItem; formatElapsed: (value: number) => string }) {
  const reading = progressReading(item.progress);
  const clock = useRunClock(item.progress);
  // With an estimate the bar follows the whole run, setup and decoding too, instead of steps alone.
  const timed = clock.ratio !== null;
  const ratio = timed ? clock.ratio : reading.kind === 'steps' ? reading.ratio : 0;
  return (
    <div className={cn('generation-progress', item.progress?.reconnecting && 'is-reconnecting')} style={{ '--progress-ratio': ratio } as React.CSSProperties}>
      <div className="generate-overlay" title={item.progress?.reconnecting ? 'ComfyUI stopped responding. The image appears when it’s back.' : undefined}>
        <span className="generate-step">
          {reading.kind === 'steps' ? (
            <>
              <span className="generate-step-label">Step</span>
              <span className="generate-step-count">
                <AnimatePresence mode="wait">
                  <motion.span key={reading.value} variants={numberVariants} initial="initial" animate="animate" exit="exit">
                    {reading.value}
                  </motion.span>
                </AnimatePresence>
                <i>/</i>{reading.max}
              </span>
            </>
          ) : reading.kind === 'phase' ? (
            <>
              <span className="generate-step-label is-queued">{reading.label}</span>
              {reading.percent !== null ? <span className="generate-step-count">{reading.percent}<i className="is-unit">%</i></span> : null}
            </>
          ) : (
            <span className="generate-step-label is-queued">Queued</span>
          )}
        </span>
        <span className="generate-elapsed">{clock.leftMs !== null ? formatLeft(clock.leftMs) : <ElapsedTime startedAt={item.createdAt} format={formatElapsed} />}</span>
      </div>
      {/* Only steps (or a timed run) fill the bar; a phase's own count would fill and reset it. */}
      <div className={cn('generate-bar', timed ? 'is-timed' : reading.kind !== 'steps' && 'is-indeterminate')}>
        <div className="generate-bar-fill" />
      </div>
    </div>
  );
}

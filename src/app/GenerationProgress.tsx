import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from './format';
import { ElapsedTime } from './ElapsedTime';
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

/** The overlay on a running generation: what it is doing, how far, and for how long. */
export function GenerationProgress({ item, formatElapsed }: { item: GalleryItem; formatElapsed: (value: number) => string }) {
  const reading = progressReading(item.progress);
  const ratio = reading.kind === 'steps' ? reading.ratio : 0;
  return (
    <div className="generation-progress" style={{ '--progress-ratio': ratio } as React.CSSProperties}>
      <div className="generate-overlay">
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
        <span className="generate-elapsed"><ElapsedTime startedAt={item.createdAt} format={formatElapsed} /></span>
      </div>
      {/* Only steps fill the bar; a phase's own count would fill and reset it. */}
      <div className={cn('generate-bar', reading.kind !== 'steps' && 'is-indeterminate')}>
        <div className="generate-bar-fill" />
      </div>
    </div>
  );
}

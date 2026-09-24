import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { AnimatedNumber } from './AnimatedNumber';
import { CellBar } from './UpscaleDialogs';
import { MiniArrow, formatEta } from './UpscaleDownloadWidget';
import { cn } from './format';
import { formatBytes } from './useUpscale';
import { useModelDownloads } from './useModelDownloads';
import type { ModelDownload } from './types';

const READY_HOLD_MS = 4200;

/**
 * The upscale pill's sibling for text encoders and VAEs: shows while a file
 * downloads, flashes when it lands, and stays on a failure until dismissed.
 * Clicking it opens the workflow gallery, where the same setup panel lives.
 * `onDone` rescans models, so the app catches up wherever it is.
 */
export function useModelDownloadWidget({ onDone, onError }: { onDone: (item: ModelDownload) => void; onError: (item: ModelDownload) => void }) {
  const [flash, setFlash] = React.useState<ModelDownload | null>(null);
  const [failed, setFailed] = React.useState<ModelDownload | null>(null);
  const downloads = useModelDownloads({
    onDone: (item) => { onDone(item); if (!item.already) setFlash(item); },
    onError: (item) => { onError(item); setFailed(item); }
  });
  React.useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), READY_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);
  const active = downloads.state?.active || null;
  const queued = downloads.state?.queued.length || 0;
  const mode = active ? 'downloading' as const : failed ? 'error' as const : flash && !queued ? 'ready' as const : null;
  return {
    mode,
    visible: mode !== null,
    active,
    queued,
    flash,
    failed,
    dismiss: () => { setFailed(null); setFlash(null); }
  };
}

/** `stacked`: the upscale download pill is showing too, so this one sits below it rather than hiding. */
export function ModelDownloadWidget({ widget, hidden, stacked = false, onOpen }: { widget: ReturnType<typeof useModelDownloadWidget>; hidden?: boolean; stacked?: boolean; onOpen: () => void }) {
  const reduced = useReducedMotion();
  const { mode, active, queued, flash, failed } = widget;
  const received = active?.receivedBytes || 0;
  const total = active?.totalBytes || 0;
  const progress = total ? Math.min(1, received / total) : 0;
  const speed = active?.bytesPerSecond || 0;
  const title = mode === 'downloading' ? `Downloading ${active?.label || 'model file'}`
    : mode === 'ready' ? `${flash?.label || 'File'} is in place`
    : `${failed?.label || 'Download'} stopped`;
  const meta = mode === 'downloading'
    ? [`${formatBytes(received)} of ${formatBytes(total)}`, speed > 0 ? `${formatBytes(speed)}/s` : 'connecting', speed > 0 ? formatEta((total - received) / speed) : '', queued ? `${queued} more after` : ''].filter(Boolean).join(' · ')
    : mode === 'ready' ? 'Ready to use'
    : failed?.retryable === false ? (failed.error || 'Trying again won’t help; see the model setup for why')
    : 'Click to resume where it left off';
  const show = mode && !hidden;
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="model-download-widget"
          className={cn('udw', `is-${mode}`, stacked && 'is-stacked')}
          role="status"
          aria-live="polite"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -18, scale: 0.94 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.96 }}
          transition={{ type: 'spring', duration: 0.42, bounce: 0.18 }}
        >
          <button type="button" className="udw-main" onClick={onOpen} aria-label={`${title}. Open model setup`}>
            <MiniArrow mode={mode!} progress={progress} />
            <span className="udw-text">
              <span className="udw-title">
                <strong>{title}</strong>
                {mode === 'downloading' ? <em><AnimatedNumber value={Math.floor(progress * 100)} />%</em> : null}
              </span>
              {mode === 'downloading' ? <CellBar value={progress} /> : null}
              <small>{meta}</small>
            </span>
          </button>
          {mode !== 'downloading' ? <button type="button" className="udw-close" onClick={widget.dismiss} aria-label="Dismiss"><X size={13} /></button> : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

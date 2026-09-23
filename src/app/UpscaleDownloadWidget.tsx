import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { AnimatedNumber } from './AnimatedNumber';
import { CellBar } from './UpscaleDialogs';
import { ARROW, heatColor } from './UpscaleHero';
import { cn } from './format';
import { formatBytes } from './useUpscale';
import type { UpscaleSetup } from './useUpscale';
import type { UpscaleInstall } from './types';

/**
 * While the SeedVR2 weights download with the setup dialog closed, a small
 * glass pill floats at the top: the setup hero's arrow in miniature, filling
 * with heat, over a cell bar and the numbers. Clicking it reopens setup. It
 * checks the download, flashes ready, and leaves; a failed download stays
 * until it is dealt with.
 */

type Mode = 'downloading' | 'verifying' | 'ready' | 'error';

const READY_HOLD_MS = 4200;
const CELLS = ARROW.flatMap((row, y) => [...row].map((bit, x) => (bit === 'X' ? { x, y } : null)).filter(Boolean)) as Array<{ x: number; y: number }>;
const isEdge = (x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => ARROW[y + dy]?.[x + dx] !== 'X');
const rows = ARROW.length;
// A fixed scatter so twinkles and sparks never line up.
const jitter = (x: number, y: number) => ((x * 73 + y * 151) % 97) / 97;

/** The setup hero's arrow, drawn as SVG cells: dim until the fill line reaches them, ember below it, white-hot at it. */
function MiniArrow({ mode, progress }: { mode: Mode; progress: number }) {
  const filled = mode === 'downloading' ? Math.round(progress * rows) : rows;
  const front = rows - filled;
  const bottomRow = ARROW[rows - 1];
  const sparkXs = [...bottomRow].map((bit, x) => (bit === 'X' ? x : -1)).filter((x) => x >= 0);
  return (
    <svg className={cn('udw-arrow', `is-${mode}`)} viewBox="-1 -5 17 21" aria-hidden="true">
      {CELLS.map(({ x, y }) => {
        const hot = y >= front;
        let fill = `rgb(255 255 255 / ${isEdge(x, y) ? 0.32 : 0.1})`;
        if (mode === 'error') fill = isEdge(x, y) ? 'rgb(255 120 100 / .75)' : 'rgb(255 120 100 / .14)';
        else if (mode === 'ready' || mode === 'verifying') fill = '#f4f4f4';
        else if (hot) {
          const heat = y === front ? 1 : Math.max(0.2, 0.78 - ((y - front) / rows) * 0.9);
          const [r, g, b] = heatColor(heat);
          fill = `rgb(${r | 0} ${g | 0} ${b | 0})`;
        }
        const twinkle = mode === 'downloading' && hot && y !== front;
        return (
          <rect
            key={`${x}-${y}`}
            className={cn(twinkle && 'udw-twinkle', mode === 'verifying' && 'udw-scan')}
            x={x + 0.1}
            y={y + 0.1}
            width={0.8}
            height={0.8}
            fill={fill}
            style={{ animationDelay: mode === 'verifying' ? `${(rows - y) * 45}ms` : `${-jitter(x, y) * 2.4}s` }}
          />
        );
      })}
      {mode === 'downloading' && filled > 0
        ? sparkXs.filter((_, i) => i % 2 === 0).map((x, i) => (
          <rect
            key={`spark-${x}`}
            className="udw-spark"
            x={x + 0.25}
            y={Math.max(0, front) - 0.6}
            width={0.5}
            height={0.5}
            fill="#ffd9b0"
            style={{ animationDelay: `${-(i * 0.37 + jitter(x, i) * 0.9)}s` }}
          />
        ))
        : null}
    </svg>
  );
}

function formatEta(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return 'under a minute left';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min left`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
}

/**
 * Whether the widget shows and in which mode. The toaster shares the top
 * edge, so StudioView reads `visible` to move toasts out of the way.
 */
export function useUpscaleDownloadWidget(setup: UpscaleSetup, install: UpscaleInstall) {
  const { stage, open } = setup;
  const [readyFlash, setReadyFlash] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState<string>('');
  // setup clears the waiting image the moment it starts the upscale, so keep a copy for the ready line.
  const lastPending = useRef<string>('');
  if (setup.pending) lastPending.current = setup.pending.thumbnailUrl || setup.pending.url || 'pending';
  const previous = useRef(stage);
  useEffect(() => {
    const was = previous.current;
    previous.current = stage;
    if ((was === 'downloading' || was === 'verifying') && stage === 'ready' && !open) {
      setReadyFlash(lastPending.current || '');
      lastPending.current = '';
    }
  }, [stage, open]);
  // Its own effect, so a later stage or open change cannot cancel the hide.
  useEffect(() => {
    if (readyFlash === null) return;
    const timer = window.setTimeout(() => setReadyFlash(null), READY_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [readyFlash]);
  useEffect(() => { if (open) setReadyFlash(null); }, [open]);

  const errorKey = install?.status === 'error' ? `${install.error}` : '';
  const mode: Mode | null = open ? null
    : stage === 'downloading' ? 'downloading'
    : stage === 'verifying' ? 'verifying'
    : stage === 'error' && errorKey && errorKey !== dismissedError ? 'error'
    : readyFlash !== null ? 'ready'
    : null;
  return {
    mode,
    visible: mode !== null,
    readyThumb: readyFlash && readyFlash !== 'pending' ? readyFlash : '',
    upscaling: Boolean(readyFlash),
    dismiss: () => {
      if (mode === 'error') setDismissedError(errorKey);
      setReadyFlash(null);
    }
  };
}

export function UpscaleDownloadWidget({ widget, setup, install }: {
  widget: ReturnType<typeof useUpscaleDownloadWidget>;
  setup: UpscaleSetup;
  install: UpscaleInstall;
}) {
  const reduced = useReducedMotion();
  const { mode } = widget;
  const received = install?.receivedBytes || 0;
  const total = install?.totalBytes || 0;
  const progress = total ? Math.min(1, received / total) : 0;
  const speed = install?.bytesPerSecond || 0;
  const eta = speed > 0 ? (total - received) / speed : 0;
  const waiting = Boolean(setup.pending);

  const title = mode === 'downloading' ? 'Downloading SeedVR2'
    : mode === 'verifying' ? 'Checking the download'
    : mode === 'ready' ? 'Smart upscale is ready'
    : 'Download stopped';
  const meta = mode === 'downloading'
    ? [`${formatBytes(received)} of ${formatBytes(total)}`, speed > 0 ? `${formatBytes(speed)}/s` : 'connecting', formatEta(eta)].filter(Boolean).join(' · ')
    : mode === 'verifying' ? 'Matching checksums, then ComfyUI'
    : mode === 'ready' ? (widget.upscaling ? 'Upscaling your image now' : 'Every finished image has an upscale arrow')
    : 'Click to resume where it left off';

  return (
    <AnimatePresence>
      {mode ? (
        <motion.div
          key="upscale-download-widget"
          className={cn('udw', `is-${mode}`)}
          role="status"
          aria-live="polite"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -18, scale: 0.94 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.96 }}
          transition={{ type: 'spring', duration: 0.42, bounce: 0.18 }}
        >
          <button type="button" className="udw-main" onClick={() => setup.openSetup()} aria-label={`${title}. Open smart upscale setup`}>
            <MiniArrow mode={mode} progress={progress} />
            <span className="udw-text">
              <span className="udw-title">
                <strong>{title}</strong>
                {mode === 'downloading' ? <em><AnimatedNumber value={Math.floor(progress * 100)} />%</em> : null}
              </span>
              {mode === 'downloading' ? <CellBar value={progress} /> : null}
              <small>{meta}</small>
            </span>
            {waiting && mode !== 'ready' && setup.pending?.thumbnailUrl ? (
              <img className="udw-thumb" src={setup.pending.thumbnailUrl} alt="" draggable={false} title="Upscales when the download is done" />
            ) : widget.readyThumb ? (
              <img className="udw-thumb" src={widget.readyThumb} alt="" draggable={false} />
            ) : null}
          </button>
          {mode === 'error' || mode === 'ready' ? (
            <button type="button" className="udw-close" onClick={widget.dismiss} aria-label="Dismiss"><X size={13} /></button>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

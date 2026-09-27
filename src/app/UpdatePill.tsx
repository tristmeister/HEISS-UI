import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { AnimatedNumber } from './AnimatedNumber';
import { CellBar } from './UpscaleDialogs';
import { ARROW } from './UpscaleHero';
import { MiniArrow } from './UpscaleDownloadWidget';
import { cn } from './format';
import { formatBytes } from './useUpscale';
import type { UpdateStatus } from './types';

/**
 * A new release, offered once. The pill floats in with the other islands
 * at the top: the upscale arrow in cells, with a warm pulse rising through it.
 * "Update" downloads in the background while the arrow fills with heat, then
 * "Restart" swaps it in and the page comes back with the arrow lit white.
 *
 * It never speaks about checking: offline, switched off or a failed ask
 * simply means no pill. "Later" puts that version away on every device.
 */

export type UpdatePillMode = 'available' | 'downloading' | 'verifying' | 'ready' | 'waiting' | 'restarting' | 'updated' | 'error';

const UPDATED_HOLD_MS = 6500;
const ROWS = ARROW.length;
const CELLS = ARROW.flatMap((row, y) => [...row].map((bit, x) => (bit === 'X' ? { x, y } : null)).filter(Boolean)) as Array<{ x: number; y: number }>;
const isEdge = (x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => ARROW[y + dy]?.[x + dx] !== 'X');
const releaseNotesUrl = (version: string) => `https://github.com/tristmeister/HEISS-UI/releases/tag/v${version}`;

/** The arrow at rest (a pulse of heat rising through it) or just updated (lit bottom to top). */
function RisingArrow({ mode }: { mode: 'available' | 'updated' }) {
  return (
    <svg className={cn('udw-arrow', 'uup-arrow', `is-${mode}`)} viewBox="-1 -5 17 21" aria-hidden="true">
      {CELLS.map(({ x, y }) => (
        <rect
          key={`${x}-${y}`}
          x={x + 0.1}
          y={y + 0.1}
          width={0.8}
          height={0.8}
          className={isEdge(x, y) ? 'is-edge' : undefined}
          style={{ animationDelay: `${(ROWS - 1 - y) * (mode === 'updated' ? 38 : 70)}ms` }}
        />
      ))}
    </svg>
  );
}

/** Which pill to show, if any. */
export function useUpdatePill({ status, thisComputer, restarting, justUpdated, running, hiddenSpace, settingsOpen, onRestart, onDoneUpdated }: {
  status: UpdateStatus | null;
  thisComputer: boolean;
  restarting: boolean;
  justUpdated: string;
  running: number;
  hiddenSpace: boolean;
  settingsOpen: boolean;
  onRestart: () => void;
  onDoneUpdated: () => void;
}) {
  // "Restart" while something renders: wait for it, then restart.
  const [armed, setArmed] = useState(false);
  const [putAway, setPutAway] = useState('');
  const download = status?.download;
  const latest = status?.latest || download?.version || '';

  const restart = useRef(onRestart);
  restart.current = onRestart;
  useEffect(() => {
    if (!armed || running > 0 || download?.status !== 'ready') return;
    setArmed(false);
    restart.current();
  }, [armed, running, download?.status]);

  const doneUpdated = useRef(onDoneUpdated);
  doneUpdated.current = onDoneUpdated;
  const [holding, setHolding] = useState(false);
  useEffect(() => {
    if (!justUpdated || holding) return;
    const timer = window.setTimeout(() => doneUpdated.current(), UPDATED_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [justUpdated, holding]);

  const errorKey = download?.status === 'error' ? `error:${download.error}` : '';
  let mode: UpdatePillMode | null = null;
  if (restarting) mode = settingsOpen ? null : 'restarting';
  else if (justUpdated) mode = 'updated';
  else if (!thisComputer || !status?.release || settingsOpen) mode = null;
  else if (download?.status === 'downloading') mode = 'downloading';
  else if (download?.status === 'verifying' || download?.status === 'unpacking') mode = 'verifying';
  else if (download?.status === 'ready') mode = armed ? 'waiting' : putAway === `ready:${latest}` ? null : 'ready';
  else if (download?.status === 'error') mode = putAway === errorKey ? null : 'error';
  else if (status.available && status.canInstall && status.prefs?.autoCheck !== false && status.prefs?.dismissed !== latest && !hiddenSpace && running === 0) mode = 'available';

  return {
    mode,
    visible: mode !== null,
    latest,
    armed,
    arm: () => setArmed(true),
    disarm: () => setArmed(false),
    putAway: (key: string) => setPutAway(key),
    errorKey,
    hold: setHolding
  };
}

export function UpdatePill({ pill, status, running, onUpdate, onRestart, onLater, onDoneUpdated, justUpdated }: {
  pill: ReturnType<typeof useUpdatePill>;
  status: UpdateStatus | null;
  running: number;
  onUpdate: () => void;
  onRestart: () => void;
  onLater: (version: string) => void;
  onDoneUpdated: () => void;
  justUpdated: string;
}) {
  const reduced = useReducedMotion();
  const { mode, latest } = pill;
  const download = status?.download;
  const received = download?.receivedBytes || 0;
  const total = download?.totalBytes || status?.size || 0;
  const progress = total ? Math.min(1, received / total) : 0;
  const generations = `${running} generation${running === 1 ? '' : 's'}`;

  let title = '';
  let meta: React.ReactNode = '';
  let action: { label: string; run: () => void } | null = null;
  let close: (() => void) | null = null;
  switch (mode) {
    case 'available':
      title = `HEISS UI ${latest} is here`;
      meta = status?.highlight
        ? <>{status.highlight}{status.more ? <span className="uup-more"> · {status.more} more</span> : null}</>
        : `A ${status?.size ? `${formatBytes(status.size)} ` : ''}download, in the background`;
      action = { label: 'Update', run: onUpdate };
      close = () => onLater(latest);
      break;
    case 'downloading':
      title = `Updating to ${latest}`;
      meta = total ? `${formatBytes(received)} of ${formatBytes(total)} · keep working` : 'Starting the download';
      break;
    case 'verifying':
      title = `Getting ${latest} ready`;
      meta = 'Checking the download';
      break;
    case 'ready':
      title = `HEISS UI ${latest} is ready`;
      meta = running ? `Restarting stops ${generations}` : 'Takes a few seconds';
      action = running ? { label: 'When done', run: pill.arm } : { label: 'Restart', run: onRestart };
      close = () => pill.putAway(`ready:${latest}`);
      break;
    case 'waiting':
      title = 'Restarting when done';
      meta = `After ${generations} finish${running === 1 ? 'es' : ''}`;
      action = { label: 'Now', run: onRestart };
      close = pill.disarm;
      break;
    case 'restarting':
      title = 'Restarting';
      meta = 'Back in a few seconds';
      break;
    case 'updated':
      title = `You’re on HEISS UI ${justUpdated}`;
      meta = <a className="uup-link" href={releaseNotesUrl(justUpdated)} target="_blank" rel="noreferrer">See what’s new</a>;
      close = onDoneUpdated;
      break;
    case 'error':
      title = 'The update stopped';
      meta = download?.error || 'The download did not finish';
      action = { label: 'Try again', run: onUpdate };
      close = () => pill.putAway(pill.errorKey);
      break;
  }

  const glyph = mode === 'available' || mode === 'updated'
    ? <RisingArrow mode={mode} />
    : mode === 'downloading' ? <MiniArrow mode="downloading" progress={progress} />
    : mode === 'verifying' || mode === 'restarting' ? <MiniArrow mode="verifying" progress={1} />
    : mode === 'error' ? <MiniArrow mode="error" progress={0} />
    : <MiniArrow mode="ready" progress={1} />;

  return (
    <AnimatePresence>
      {mode ? (
        <motion.div
          key="update-pill"
          layout="position"
          className={cn('island', 'udw', 'uup', `is-${mode}`)}
          role="status"
          aria-live="polite"
          // No filter on the glass itself: it would cut off its backdrop blur.
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -18, scale: 0.94 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.96 }}
          transition={{ type: 'spring', duration: 0.5, bounce: 0.16 }}
          onPointerEnter={() => pill.hold(true)}
          onPointerLeave={() => pill.hold(false)}
          onFocus={() => pill.hold(true)}
          onBlur={() => pill.hold(false)}
        >
          <div className="udw-main uup-main">
            {glyph}
            <span className="udw-text">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={mode}
                  className="uup-copy"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, filter: 'blur(3px)' }}
                  animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6, filter: 'blur(3px)' }}
                  transition={{ type: 'spring', duration: 0.38, bounce: 0 }}
                >
                  <span className="udw-title">
                    <strong>{title}</strong>
                    {mode === 'downloading' && total ? <em><AnimatedNumber value={Math.floor(progress * 100)} />%</em> : null}
                  </span>
                  {mode === 'downloading' ? <CellBar value={progress} /> : null}
                  <small title={typeof meta === 'string' ? meta : status?.highlight}>{meta}</small>
                </motion.span>
              </AnimatePresence>
            </span>
            {action ? <button type="button" className="island-action" onClick={action.run}>{action.label}</button> : null}
          </div>
          {close ? (
            <button type="button" className="island-close" onClick={close} aria-label={mode === 'available' ? 'Later' : mode === 'waiting' ? 'Don’t restart' : 'Dismiss'} title={mode === 'available' ? 'Later' : undefined}><X size={13} /></button>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

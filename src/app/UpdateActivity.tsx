import React, { useEffect, useRef, useState } from 'react';
import { AnimatedNumber } from './AnimatedNumber';
import { ARROW } from './UpscaleHero';
import { MiniArrow } from './UpscaleDownloadActivity';
import { cn } from './format';
import { formatBytes } from './useUpscale';
import type { Activity } from './Activities';
import type { UpdateStatus } from './types';

/**
 * A new release, offered once, as an activity: the upscale arrow in cells,
 * with a warm pulse rising through it. "Update" downloads in the background
 * while the arrow fills with heat, then "Restart" swaps it in and the page
 * comes back to a note with the arrow lit white.
 *
 * It never speaks about checking: offline, switched off or a failed ask
 * simply means nothing shows. "Later" puts that version away on every device.
 */

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

type UpdateMode = 'available' | 'downloading' | 'verifying' | 'ready' | 'waiting' | 'restarting' | 'updated' | 'error';

/** The update as an activity, or null while there is nothing to say. Hidden while settings (which shows the same) is open. */
export function useUpdateActivity({ status, thisComputer, restarting, justUpdated, running, hiddenSpace, settingsOpen, onUpdate, onRestart, onLater, onDoneUpdated }: {
  status: UpdateStatus | null;
  thisComputer: boolean;
  restarting: boolean;
  justUpdated: string;
  running: number;
  hiddenSpace: boolean;
  settingsOpen: boolean;
  onUpdate: () => void;
  onRestart: () => void;
  onLater: (version: string) => void;
  onDoneUpdated: () => void;
}): Activity | null {
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

  const errorKey = download?.status === 'error' ? `error:${download.error}` : '';
  let mode: UpdateMode | null = null;
  if (restarting) mode = settingsOpen ? null : 'restarting';
  else if (justUpdated) mode = 'updated';
  else if (!thisComputer || !status?.release || settingsOpen) mode = null;
  else if (download?.status === 'downloading') mode = 'downloading';
  else if (download?.status === 'verifying' || download?.status === 'unpacking') mode = 'verifying';
  else if (download?.status === 'ready') mode = armed ? 'waiting' : putAway === `ready:${latest}` ? null : 'ready';
  else if (download?.status === 'error') mode = putAway === errorKey ? null : 'error';
  else if (status.available && status.canInstall && status.prefs?.autoCheck !== false && status.prefs?.dismissed !== latest && !hiddenSpace && running === 0) mode = 'available';
  if (!mode) return null;

  const received = download?.receivedBytes || 0;
  const total = download?.totalBytes || status?.size || 0;
  const progress = total ? Math.min(1, received / total) : 0;
  const generations = `${running} generation${running === 1 ? '' : 's'}`;

  const base = { id: 'update', phase: mode, state: 'live' as Activity['state'] };
  const glyph = mode === 'available' || mode === 'updated'
    ? <RisingArrow mode={mode} />
    : mode === 'downloading' ? <MiniArrow mode="downloading" progress={progress} />
    : mode === 'verifying' || mode === 'restarting' ? <MiniArrow mode="verifying" progress={1} />
    : mode === 'error' ? <MiniArrow mode="error" progress={0} />
    : <MiniArrow mode="ready" progress={1} />;

  switch (mode) {
    case 'available':
      return {
        ...base,
        glyph,
        wide: true,
        title: `HEISS UI ${latest} is here`,
        meta: status?.highlight
          ? <>{status.highlight}{status.more ? <span className="uup-more"> · {status.more} more</span> : null}</>
          : `A ${status?.size ? `${formatBytes(status.size)} ` : ''}download, in the background`,
        metaTitle: status?.highlight,
        metaLines: 2,
        action: { label: 'Update', run: onUpdate },
        dismiss: { label: 'Later', title: 'Later', run: () => onLater(latest) }
      };
    case 'downloading':
      return {
        ...base,
        glyph,
        title: `Updating to ${latest}`,
        figure: total ? <><AnimatedNumber value={Math.floor(progress * 100)} />%</> : undefined,
        progress,
        meta: total ? `${formatBytes(received)} of ${formatBytes(total)} · keep working` : 'Starting the download'
      };
    case 'verifying':
      return { ...base, glyph, title: `Getting ${latest} ready`, meta: 'Checking the download' };
    case 'ready':
      return {
        ...base,
        glyph,
        title: `HEISS UI ${latest} is ready`,
        meta: running ? `Restarting stops ${generations}` : 'Takes a few seconds',
        action: running ? { label: 'When done', run: () => setArmed(true) } : { label: 'Restart', run: onRestart },
        dismiss: { label: 'Dismiss', run: () => setPutAway(`ready:${latest}`) }
      };
    case 'waiting':
      return {
        ...base,
        glyph,
        title: 'Restarting when done',
        meta: `After ${generations} finish${running === 1 ? 'es' : ''}`,
        action: { label: 'Now', run: onRestart },
        dismiss: { label: 'Don’t restart', run: () => setArmed(false) }
      };
    case 'restarting':
      return { ...base, glyph, title: 'Restarting', meta: 'Back in a few seconds' };
    case 'updated':
      return {
        ...base,
        state: 'done',
        glyph,
        title: `You’re on HEISS UI ${justUpdated}`,
        meta: <a className="uup-link" href={releaseNotesUrl(justUpdated)} target="_blank" rel="noreferrer">See what’s new</a>,
        dismiss: { label: 'Dismiss', run: onDoneUpdated },
        expire: { after: UPDATED_HOLD_MS, run: onDoneUpdated }
      };
    case 'error':
      return {
        ...base,
        state: 'error',
        glyph,
        title: 'The update stopped',
        meta: download?.error || 'The download did not finish',
        metaTitle: download?.error,
        action: { label: 'Try again', run: onUpdate },
        dismiss: { label: 'Dismiss', run: () => setPutAway(errorKey) }
      };
  }
}

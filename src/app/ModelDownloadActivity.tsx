import React from 'react';
import { Pause, Play, X } from 'lucide-react';
import { AnimatedNumber } from './AnimatedNumber';
import { MiniArrow, formatEta } from './UpscaleDownloadActivity';
import { formatBytes } from './useUpscale';
import { downloadFor, downloadOrigin, islandActions, revealDownload, useModelDownloads, type DownloadOrigin } from './useModelDownloads';
import { isStarterFile, starterHas } from './StarterModels';
import { cn } from './format';
import type { Activity, ActivityControl } from './Activities';
import type { ModelDownload } from './types';

const READY_HOLD_MS = 4200;

const placeName: Record<DownloadOrigin['kind'], string> = { starter: 'Get a model', setup: 'Workflows' };

/** Where a download lives: where it was started this session, else a starter model's card if it is one, else its workflow's setup panel. */
function placeOf(item: ModelDownload): DownloadOrigin['kind'] | null {
  const origin = downloadOrigin(item.id);
  if (origin) return origin.kind;
  const starter = starterHas(item.file);
  return starter === null ? null : starter ? 'starter' : 'setup';
}

function waiting(count: number, word: string) {
  return count ? <><span aria-hidden="true">+{count}</span><span className="sr-only">, {count} more {word}</span></> : undefined;
}

/**
 * The upscale download's sibling for model files, text encoders and VAEs: an
 * activity while a file downloads, a "ready" note when the last one lands,
 * and a failure that stays until dismissed (it is the only place that says
 * so; no toast repeats it).
 *
 * Hovered, focused or tapped, it grows Pause (or Resume) and Cancel for the
 * whole line of downloads; a cancel holds the partial file for a few seconds
 * behind Undo instead of asking first. Clicking it opens the place that
 * download lives, the starter card or the workflow's setup panel, with that
 * row lit, and while that is open it steps aside. `onDone` rescans models,
 * so the app catches up wherever it is.
 */
export function useModelDownloadActivity({ onDone, hidden, onOpen }: { onDone: (item: ModelDownload) => void; hidden: boolean; onOpen: (where: DownloadOrigin['kind']) => void }): Activity | null {
  const [flash, setFlash] = React.useState<ModelDownload | null>(null);
  const [failed, setFailed] = React.useState<ModelDownload | null>(null);
  const downloads = useModelDownloads({
    onDone: (item) => { onDone(item); if (!item.already) setFlash(item); },
    onError: (item) => setFailed(item)
  });
  // The gallery shows the same landing itself; a note waiting behind it would be old news.
  React.useEffect(() => { if (hidden) setFlash(null); }, [hidden]);

  const { state, held, canceled } = downloads;
  const active = state?.active || null;
  const queued = state?.queued.length || 0;
  const mode = canceled.length ? 'canceled' as const
    : active ? 'downloading' as const
    : held.length ? 'paused' as const
    : failed ? 'error' as const
    : flash && !queued ? 'ready' as const
    : null;
  if (!mode || hidden) return null;

  // A paused file's bytes come from the server's view of the part on disk.
  const shown: ModelDownload | null = mode === 'canceled' ? canceled[0]
    : mode === 'downloading' ? active
    : mode === 'paused' ? { ...held[0], ...downloadFor(state, held[0].file), id: held[0].id }
    : mode === 'error' ? failed
    : flash;
  const label = shown?.label || 'model file';
  const received = shown?.receivedBytes || 0;
  const total = shown?.totalBytes || 0;
  const progress = total ? Math.min(1, received / total) : 0;
  const speed = active?.bytesPerSecond || 0;
  const title = mode === 'downloading' ? `Downloading ${label}`
    : mode === 'paused' ? `${label} paused`
    : mode === 'canceled' ? (canceled.length > 1 ? `${canceled.length} downloads canceled` : `${label} canceled`)
    : mode === 'ready' ? `${flash?.label || 'File'} downloaded`
    : `${failed?.label || 'Download'} stopped`;
  const sizes = received ? `${formatBytes(received)} of ${formatBytes(total)}` : total ? formatBytes(total) : '';
  const meta = mode === 'downloading'
    ? [sizes, active?.verifying ? 'checking the file' : speed > 0 ? `${formatBytes(speed)}/s` : active?.reconnecting ? 'connection dropped, reconnecting' : 'connecting', speed > 0 ? formatEta((total - received) / speed) : ''].filter(Boolean).join(' · ')
    : mode === 'paused' ? [sizes, 'resumes where it stopped'].filter(Boolean).join(' · ')
    : mode === 'canceled' ? (received ? `Undo keeps the ${formatBytes(received)} already here` : 'Undo puts it back in line')
    : mode === 'ready' ? 'Ready to use'
    : failed?.needsBrowser ? 'Open model setup to download it in the browser'
    : failed?.retryable === false ? (failed.error || 'Open model setup for details')
    : failed?.error ? `${failed.error}. Click to resume`
    : 'Click to resume';

  // A failed request leaves the island as it was; the next poll says how things stand.
  const guard = (action: () => Promise<unknown>) => () => action().catch(() => downloads.refresh());
  // One key for Pause and Resume: the same button changes, so keyboard focus stays on it.
  const controls: ActivityControl[] | undefined = mode === 'downloading' ? [
    ...(active?.verifying ? [] : [{ key: 'toggle', icon: <Pause size={14} fill="currentColor" strokeWidth={0} />, tip: queued ? 'Pause all' : 'Pause', label: queued ? `Pause all ${queued + 1} downloads` : `Pause ${label}`, run: guard(islandActions.pauseAll) }]),
    { key: 'cancel', icon: <X size={15} />, tone: 'danger', tip: 'Cancel', label: `Cancel ${label}`, run: guard(() => islandActions.cancel([active!])) }
  ] : mode === 'paused' ? [
    { key: 'toggle', icon: <Play size={14} fill="currentColor" strokeWidth={0} />, tip: held.length > 1 ? 'Resume all' : 'Resume', label: held.length > 1 ? `Resume all ${held.length} downloads` : `Resume ${label}`, run: guard(islandActions.resumeAll) },
    { key: 'cancel', icon: <X size={15} />, tone: 'danger', tip: held.length > 1 ? 'Cancel all' : 'Cancel', label: held.length > 1 ? `Cancel all ${held.length} downloads` : `Cancel ${label}`, run: guard(() => islandActions.cancel(held)) }
  ] : undefined;

  const place = shown ? placeOf(shown) : null;
  const open = async () => {
    if (!shown) return;
    const origin = downloadOrigin(shown.id);
    const where = place || (await isStarterFile(shown.file) ? 'starter' : 'setup');
    revealDownload(shown, where, origin?.kind === 'setup' ? origin.subject : undefined);
    onOpen(where);
  };
  const dismiss = () => { setFailed(null); setFlash(null); };
  return {
    id: 'model-download',
    phase: mode,
    state: mode === 'error' ? 'error' : mode === 'ready' || mode === 'canceled' ? 'done' : 'live',
    glyph: (
      <span className={cn('model-dl-glyph', `is-${mode}`)}>
        <MiniArrow mode={mode === 'paused' || mode === 'canceled' ? 'downloading' : mode} progress={progress} />
      </span>
    ),
    title,
    badge: mode === 'downloading' ? waiting(queued, 'waiting') : mode === 'paused' ? waiting(held.length - 1, 'paused') : undefined,
    figure: mode === 'downloading' || mode === 'paused' ? <><AnimatedNumber value={Math.floor(progress * 100)} />%</> : undefined,
    progress: mode === 'downloading' || mode === 'paused' ? progress : undefined,
    meta,
    metaTitle: mode === 'error' ? meta : undefined,
    open: { label: `${title}. Show it in ${place ? placeName[place] : 'model setup'}`, run: () => { open(); } },
    openHint: place ? `Show in ${placeName[place]}` : 'Show',
    controls,
    action: mode === 'canceled' ? { label: 'Undo', run: () => { islandActions.undoCancel().catch(() => downloads.refresh()); } } : undefined,
    dismiss: mode === 'canceled' ? { label: 'Discard now', title: 'Discard now', run: islandActions.commitCancel }
      : mode === 'paused' ? { label: 'Hide. It stays paused', title: 'Hide. It stays paused', run: islandActions.forgetHeld }
      : mode !== 'downloading' ? { label: 'Dismiss', run: dismiss } : undefined,
    expire: mode === 'ready' ? { after: READY_HOLD_MS, run: () => setFlash(null) } : undefined
  };
}

import React from 'react';
import { AnimatedNumber } from './AnimatedNumber';
import { MiniArrow, formatEta } from './UpscaleDownloadActivity';
import { formatBytes } from './useUpscale';
import { useModelDownloads } from './useModelDownloads';
import type { Activity } from './Activities';
import type { ModelDownload } from './types';

const READY_HOLD_MS = 4200;

/**
 * The upscale download's sibling for text encoders and VAEs: an activity while
 * a file downloads, a "ready" note when the last one lands, and a failure that
 * stays until dismissed (it is the only place that says so; no toast repeats
 * it). Clicking it opens the workflow gallery, where the same setup panel
 * lives, and while that is open it steps aside. `onDone` rescans models, so
 * the app catches up wherever it is.
 */
export function useModelDownloadActivity({ onDone, hidden, onOpen }: { onDone: (item: ModelDownload) => void; hidden: boolean; onOpen: () => void }): Activity | null {
  const [flash, setFlash] = React.useState<ModelDownload | null>(null);
  const [failed, setFailed] = React.useState<ModelDownload | null>(null);
  const downloads = useModelDownloads({
    onDone: (item) => { onDone(item); if (!item.already) setFlash(item); },
    onError: (item) => setFailed(item)
  });
  // The gallery shows the same landing itself; a note waiting behind it would be old news.
  React.useEffect(() => { if (hidden) setFlash(null); }, [hidden]);

  const active = downloads.state?.active || null;
  const queued = downloads.state?.queued.length || 0;
  const mode = active ? 'downloading' as const : failed ? 'error' as const : flash && !queued ? 'ready' as const : null;
  if (!mode || hidden) return null;

  const received = active?.receivedBytes || 0;
  const total = active?.totalBytes || 0;
  const progress = total ? Math.min(1, received / total) : 0;
  const speed = active?.bytesPerSecond || 0;
  const title = mode === 'downloading' ? `Downloading ${active?.label || 'model file'}`
    : mode === 'ready' ? `${flash?.label || 'File'} is in place`
    : `${failed?.label || 'Download'} stopped`;
  const meta = mode === 'downloading'
    ? [received ? `${formatBytes(received)} of ${formatBytes(total)}` : total ? formatBytes(total) : '', active?.verifying ? 'checking the file' : speed > 0 ? `${formatBytes(speed)}/s` : active?.reconnecting ? 'connection dropped, reconnecting' : 'connecting', speed > 0 ? formatEta((total - received) / speed) : '', queued ? `${queued} more after` : ''].filter(Boolean).join(' · ')
    : mode === 'ready' ? 'Ready to use'
    : failed?.needsBrowser ? 'Needs your browser; open the model setup'
    : failed?.retryable === false ? (failed.error || 'Trying again won’t help; see the model setup for why')
    : failed?.error ? `${failed.error}. Click to resume where it left off`
    : 'Click to resume where it left off';
  const dismiss = () => { setFailed(null); setFlash(null); };
  return {
    id: 'model-download',
    phase: mode,
    state: mode === 'error' ? 'error' : mode === 'ready' ? 'done' : 'live',
    glyph: <MiniArrow mode={mode} progress={progress} />,
    title,
    figure: mode === 'downloading' ? <><AnimatedNumber value={Math.floor(progress * 100)} />%</> : undefined,
    progress: mode === 'downloading' ? progress : undefined,
    meta,
    metaTitle: mode === 'error' ? meta : undefined,
    open: { label: `${title}. Open model setup`, run: onOpen },
    dismiss: mode !== 'downloading' ? { label: 'Dismiss', run: dismiss } : undefined,
    expire: mode === 'ready' ? { after: READY_HOLD_MS, run: () => setFlash(null) } : undefined
  };
}

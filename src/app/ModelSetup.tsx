import React from 'react';
import { Check, Download, ExternalLink, Pause, Play, RefreshCw, RotateCw, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ComfyRestart } from './ComfyRestart';
import { NodeInstall, ShellCommand } from './NodeInstall';
import { CellBar } from './UpscaleDialogs';
import { formatEta } from './UpscaleDownloadWidget';
import { cn } from './format';
import { downloadFor, useModelDownloads } from './useModelDownloads';
import type { MissingPart, ModelDownload, Profile } from './types';

function formatBytes(bytes = 0) {
  if (!bytes) return '';
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

const partVerb: Record<MissingPart['part'], string> = {
  encoder: 'Text encoder',
  vae: 'VAE',
  model: 'Model file',
  comfy: 'ComfyUI'
};

type RowState = 'idle' | 'queued' | 'downloading' | 'paused' | 'error' | 'landed' | 'manual';

/**
 * What the selected model still needs before it can run: every part as one
 * row with its own progress, a single "Get everything" for the lot, and
 * downloads that pause and resume where they stopped. The same panel sits in
 * the sidebar and in the workflow gallery.
 */
export function ModelSetup({ profile, showToast, onInstalled, variant = 'sidebar' }: {
  profile: Profile;
  showToast: (message: string, tone?: 'default' | 'success' | 'error') => void;
  onInstalled: () => void;
  variant?: 'sidebar' | 'gallery';
}) {
  const reduced = useReducedMotion();
  const { state, landed, start, pause, discard } = useModelDownloads();
  const [remote, setRemote] = React.useState(false);
  const missing = profile.missing || [];

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed';
      if (/not on this computer/i.test(message)) setRemote(true);
      showToast(message, 'error');
    }
  };

  if (!missing.length) return null;

  const rows = missing.map((item) => {
    const download = item.downloads[0];
    const current = download ? downloadFor(state, download.file) : undefined;
    let rowState: RowState = !download ? 'manual' : 'idle';
    if (current?.status === 'queued') rowState = 'queued';
    else if (current?.status === 'downloading') rowState = 'downloading';
    else if (current?.status === 'paused') rowState = 'paused';
    else if (current?.status === 'error') rowState = 'error';
    else if (download && landed.has(download.file)) rowState = 'landed';
    return { item, download, current, rowState };
  });

  const startable = remote ? [] : rows.filter((row) => row.download && (row.rowState === 'idle' || row.rowState === 'paused' || row.rowState === 'error'));
  const remainingBytes = startable.reduce((sum, row) => sum + Math.max(0, (row.current?.totalBytes || row.download?.bytes || 0) - (row.current?.receivedBytes || 0)), 0);
  const moving = rows.some((row) => row.rowState === 'downloading' || row.rowState === 'queued');
  const stuck = rows.some((row) => row.rowState === 'landed');
  const fetchable = rows.filter((row) => row.download).length;

  // A missing node pack comes first: nothing else can be checked until ComfyUI has it.
  const pack = missing.find((item) => item.nodePack)?.nodePack;
  const manual = rows.some((row) => row.rowState === 'manual');
  const title = moving ? 'Downloading'
    : pack ? `Add ${pack.name} to ComfyUI`
    : fetchable === missing.length ? `Needs ${missing.length} more file${missing.length === 1 ? '' : 's'}` : 'Not ready yet';
  const subtitle = pack ? `${profile.displayName} runs on custom nodes that ComfyUI does not ship. They install once.`
    : profile.encoderBuiltIn === false && profile.source === 'checkpoint'
    ? 'This checkpoint ships without everything it needs.'
    : `${profile.displayName} runs once ${missing.length === 1 ? 'this is' : 'these are'} in place.`;

  return (
    <section className={cn('model-setup', `is-${variant}`)} aria-label="Files this model needs">
      <header className="model-setup-head">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        {startable.length > 1 ? (
          <button type="button" className="btn is-primary" onClick={() => run(async () => { for (const row of startable) await start(row.download!.id); })}>
            <Download size={14} /> Get all{remainingBytes ? ` · ${formatBytes(remainingBytes)}` : ''}
          </button>
        ) : null}
      </header>
      <ul className="model-setup-list">
        {rows.map(({ item, download, current, rowState }) => (
          <li key={`${item.part}:${item.slot || item.kind || item.label}`} className={cn('model-setup-item', `is-${rowState}`)}>
            <div className="model-setup-row">
              <span className={cn('model-setup-dot', `is-${rowState}`)} aria-hidden="true">
                {rowState === 'landed' ? <Check size={11} strokeWidth={3} /> : null}
              </span>
              <div className="model-setup-copy">
                <small>{partVerb[item.part]}</small>
                <strong>{item.label}</strong>
              </div>
              <div className="model-setup-actions">
                <RowActions rowState={rowState} download={download} current={current} remote={remote} run={run} start={start} pause={pause} discard={discard} />
              </div>
            </div>
            <AnimatePresence initial={false}>
              {current && (rowState === 'downloading' || rowState === 'queued' || rowState === 'paused') ? (
                <motion.div
                  className="model-setup-progress"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  animate={reduced ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.22 }}
                >
                  <CellBar value={current.totalBytes ? current.receivedBytes / current.totalBytes : 0} />
                  <small>{progressLine(current, rowState)}</small>
                </motion.div>
              ) : null}
            </AnimatePresence>
            {rowState === 'error' ? <p className="model-setup-error">{current?.error || 'The download stopped.'} It picks up where it left off.</p> : null}
            {rowState === 'idle' || rowState === 'manual' ? <p className="model-setup-detail">{item.detail}</p> : null}
            {item.nodePack ? (
              <NodeInstall pack={item.nodePack} plan={item.install} showToast={showToast} onRestarted={onInstalled} afterRestart={`${profile.displayName} is ready after that.`} />
            ) : item.command ? (
              <div className="model-setup-command"><ShellCommand plan={item.command} showToast={showToast} /></div>
            ) : null}
          </li>
        ))}
      </ul>
      {stuck && !moving && !remote ? (
        <div className="model-setup-restart">
          <p>Downloaded and in place, but ComfyUI has not listed it yet. A restart makes it look again.</p>
          <ComfyRestart compact onBack={onInstalled} />
        </div>
      ) : null}
      {manual && !moving ? (
        <button type="button" className="btn is-ghost model-setup-recheck" onClick={onInstalled}><RefreshCw size={13} /> Check again</button>
      ) : null}
      {remote ? <p className="model-setup-note">ComfyUI runs on another computer, so put these files into its models folders there, then rescan.</p> : null}
    </section>
  );
}

function progressLine(current: ModelDownload, rowState: RowState) {
  const pct = current.totalBytes ? Math.floor((current.receivedBytes / current.totalBytes) * 100) : 0;
  if (rowState === 'queued') return current.receivedBytes ? `Waiting · resumes at ${pct}%` : 'Waiting for the file before it';
  if (rowState === 'paused') return `Paused at ${pct}% · ${formatBytes(current.receivedBytes)} of ${formatBytes(current.totalBytes)}`;
  const speed = current.bytesPerSecond || 0;
  const eta = speed > 0 && current.totalBytes ? formatEta((current.totalBytes - current.receivedBytes) / speed) : '';
  return [`${pct}%`, `${formatBytes(current.receivedBytes)} of ${formatBytes(current.totalBytes)}`, speed > 0 ? `${formatBytes(speed)}/s` : 'connecting', eta].filter(Boolean).join(' · ');
}

function RowActions({ rowState, download, current, remote, run, start, pause, discard }: {
  rowState: RowState;
  download?: MissingPart['downloads'][number];
  current?: ModelDownload;
  remote: boolean;
  run: (action: () => Promise<unknown>) => void;
  start: (id: string) => Promise<unknown>;
  pause: (id: string) => Promise<unknown>;
  discard: (id: string) => Promise<unknown>;
}) {
  if (!download) return null;
  const link = (
    <a className="btn is-ghost is-icon" href={download.url.replace('/resolve/', '/blob/')} target="_blank" rel="noreferrer" aria-label={`Open ${download.file} on Hugging Face`} title={download.file}>
      <ExternalLink size={14} />
    </a>
  );
  if (rowState === 'downloading' || rowState === 'queued') {
    return <button type="button" className="btn is-ghost is-icon" aria-label={`Pause ${download.file}`} title="Pause" onClick={() => run(() => pause(current?.id || download.id))}><Pause size={14} /></button>;
  }
  if (rowState === 'paused') {
    return (
      <>
        <button type="button" className="btn" onClick={() => run(() => start(download.id))}><Play size={13} /> Resume</button>
        <button type="button" className="btn is-ghost is-icon" aria-label={`Discard the partial ${download.file}`} title="Discard" onClick={() => run(() => discard(download.id))}><X size={14} /></button>
      </>
    );
  }
  if (rowState === 'error') {
    return <button type="button" className="btn" onClick={() => run(() => start(download.id))}><RotateCw size={13} /> Retry</button>;
  }
  if (rowState === 'landed') return <span className="model-setup-meta">In place</span>;
  return (
    <>
      {!remote ? (
        <button type="button" className="btn" onClick={() => run(() => start(download.id))} title={download.file}>
          <Download size={14} /> {download.bytes ? formatBytes(download.bytes) : 'Get'}
        </button>
      ) : null}
      {link}
    </>
  );
}

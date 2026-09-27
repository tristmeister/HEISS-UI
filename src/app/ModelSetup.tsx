import React from 'react';
import { Check, Download, ExternalLink, Pause, Play, RefreshCw, RotateCw, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ComfyRestart } from './ComfyRestart';
import { NodeInstall, ShellCommand } from './NodeInstall';
import { CellBar } from './UpscaleDialogs';
import { formatEta } from './UpscaleDownloadActivity';
import { cn } from './format';
import { downloadFor, useModelDownloads } from './useModelDownloads';
import type { MissingPart, ModelDownload, Profile } from './types';
import { useThisComputer } from './device';
import type { ShowToast } from './toast';

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

/** One plain line for the parts people new to ComfyUI will not know by name. */
const partHint: Partial<Record<MissingPart['part'], string>> = {
  encoder: 'Reads your prompt for the model',
  vae: 'Turns the model’s result into pixels'
};

type RowState = 'idle' | 'queued' | 'downloading' | 'paused' | 'error' | 'landed' | 'manual' | 'installed';

/** What a setup panel is for: a built-in model's profile, or an imported workflow. */
export type SetupSubject = Pick<Profile, 'id' | 'missing'> & Partial<Pick<Profile, 'displayName' | 'label' | 'encoderBuiltIn' | 'source'>>;

const partKey = (item: MissingPart) => `${item.part}:${item.slot || item.kind || item.label}`;

/**
 * The parts each model was missing while its panel was on screen, so a part
 * that lands keeps its row (ticked) instead of vanishing, and the last one
 * closes the set with a "ready" moment. Module-wide, so a ComfyUI restart
 * that remounts the panel does not forget; cleared once "ready" has shown.
 */
const setupMemory = new Map<string, Map<string, MissingPart>>();
const READY_HOLD_MS = 6000;

/**
 * What the selected model still needs before it can run: every part as one
 * row with its own progress, a single "Get everything" for the lot, and
 * downloads that pause and resume where they stopped. The same panel sits in
 * the sidebar and in the workflow gallery.
 */
export function ModelSetup({ profile, showToast, onInstalled, variant = 'sidebar', alsoNeedsNodes = false }: {
  profile: SetupSubject;
  showToast: ShowToast;
  onInstalled: () => void;
  variant?: 'sidebar' | 'gallery';
  /** An imported workflow that lacks custom nodes as well; those are listed below the panel. */
  alsoNeedsNodes?: boolean;
}) {
  const reduced = useReducedMotion();
  const { state, landed, start, pause, discard } = useModelDownloads();
  const [remoteAnswer, setRemote] = React.useState(false);
  // Known before anyone clicks: a ComfyUI elsewhere cannot receive downloads from here.
  const thisComputer = useThisComputer();
  // Downloads land on the computer running HEISS UI; from another device they are its job.
  const remote = remoteAnswer || state?.local === false || !thisComputer;
  const missing = profile.missing || [];
  const name = profile.displayName || profile.label || 'This workflow';

  // Remember every part seen missing here; the ones no longer missing are in place.
  let memory = setupMemory.get(profile.id);
  if (missing.length) {
    if (!memory) setupMemory.set(profile.id, memory = new Map());
    for (const item of missing) memory.set(partKey(item), item);
  }
  const missingKeys = new Set(missing.map(partKey));
  const installed = [...(memory?.values() || [])].filter((item) => !missingKeys.has(partKey(item)));
  const allDone = !missing.length && installed.length > 0;
  // The ready moment keeps its own copy: the memory is let go as soon as it shows.
  const [ready, setReady] = React.useState<MissingPart[] | null>(null);
  React.useEffect(() => {
    if (!allDone) return;
    setReady(installed);
    setupMemory.delete(profile.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone, profile.id]);
  React.useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => setReady(null), READY_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [ready]);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed';
      if (/(not|isn.t) on this computer/i.test(message)) setRemote(true);
      showToast(message, 'error');
    }
  };

  const shownDone = allDone ? installed : ready;
  // A download that just landed waits for the rescan; only a file ComfyUI still does not list after that is stuck.
  // The server's onDisk covers files fetched before HEISS restarted, which `landed` has forgotten.
  const landedWaiting = missing.some((item) => item.downloads[0] && (landed.has(item.downloads[0].file) || item.downloads[0].onDisk) && !downloadFor(state, item.downloads[0].file));
  const [stuckShown, setStuckShown] = React.useState(false);
  React.useEffect(() => {
    if (!landedWaiting) { setStuckShown(false); return; }
    const timer = window.setTimeout(() => setStuckShown(true), 3000);
    return () => window.clearTimeout(timer);
  }, [landedWaiting]);

  if (!missing.length && shownDone?.length) {
    return (
      <section className={cn('model-setup', `is-${variant}`, 'is-ready')} aria-label={alsoNeedsNodes ? 'Files in place' : `${name} is ready`} role="status">
        <header className="model-setup-head">
          <div>
            {/* Files alone do not make an imported workflow ready while its custom nodes are missing. */}
            <strong>{alsoNeedsNodes ? `${shownDone.length === 1 ? 'Its file is' : 'Its files are'} in place` : `${name} is ready`}</strong>
            <span>{alsoNeedsNodes ? 'Only the custom nodes below are left.' : shownDone.length === 1 ? 'What it was missing is in place.' : shownDone.length === 2 ? 'Both missing parts are in place.' : `All ${shownDone.length} missing parts are in place.`}</span>
          </div>
        </header>
        <ul className="model-setup-list">
          {shownDone.map((item) => <SetupRowShell key={partKey(item)} item={item} rowState="installed" />)}
        </ul>
      </section>
    );
  }
  if (!missing.length) return null;

  const rows = missing.map((item) => {
    const download = item.downloads[0];
    const current = download ? downloadFor(state, download.file) : undefined;
    let rowState: RowState = !download ? 'manual' : 'idle';
    if (current?.status === 'queued') rowState = 'queued';
    else if (current?.status === 'downloading') rowState = 'downloading';
    else if (current?.status === 'paused') rowState = 'paused';
    else if (current?.status === 'error') rowState = 'error';
    else if (download && (landed.has(download.file) || download.onDisk)) rowState = 'landed';
    return { item, download, current, rowState };
  });

  // Failures that trying again cannot fix (a gated file, a full disk) stay out of "Get all".
  const startable = remote ? [] : rows.filter((row) => row.download && (row.rowState === 'idle' || row.rowState === 'paused' || (row.rowState === 'error' && row.current?.retryable !== false)));
  const remainingBytes = startable.reduce((sum, row) => sum + Math.max(0, (row.current?.totalBytes || row.download?.bytes || 0) - (row.current?.receivedBytes || 0)), 0);
  const sizeUnknown = startable.some((row) => !(row.current?.totalBytes || row.download?.bytes));
  const moving = rows.some((row) => row.rowState === 'downloading' || row.rowState === 'queued');
  const stuck = stuckShown && rows.some((row) => row.rowState === 'landed');
  const fetchable = rows.filter((row) => row.download).length;

  // A missing node pack comes first: nothing else can be checked until ComfyUI has it.
  const pack = missing.find((item) => item.nodePack)?.nodePack;
  // An older ComfyUI cannot run this family at all, whatever gets downloaded.
  const outdated = missing.some((item) => item.part === 'comfy' && !item.nodePack);
  const manual = rows.some((row) => row.rowState === 'manual');
  const title = moving ? 'Downloading'
    : outdated ? 'Update ComfyUI first'
    : pack ? `Add ${pack.name} to ComfyUI`
    : fetchable === missing.length ? `Needs ${missing.length} more file${missing.length === 1 ? '' : 's'}` : 'Not ready yet';
  const subtitle = outdated ? `This ComfyUI is too old for ${name}. Update it before downloading the rest.`
    : pack ? `${name} runs on custom nodes that ComfyUI does not ship. They install once.`
    : alsoNeedsNodes ? `${name} needs ${missing.length === 1 ? 'this file' : 'these files'} and the custom nodes listed below.`
    : profile.encoderBuiltIn === false && profile.source === 'checkpoint'
    ? 'This checkpoint ships without everything it needs.'
    : `${name} runs once ${missing.length === 1 ? 'this is' : 'these are'} in place.`;
  // Parts already in place keep their place in the list, ticked, until the set is done.
  const order = [...(memory?.keys() || [])];
  const rowFor = new Map(rows.map((row) => [partKey(row.item), row]));

  return (
    <section className={cn('model-setup', `is-${variant}`)} aria-label="Files this model needs">
      <header className="model-setup-head">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        {startable.length > 1 && !outdated ? (
          <button type="button" className="btn is-primary" onClick={() => run(async () => { for (const row of startable) await start(row.download!.id); })}>
            <Download size={14} /> Get all{remainingBytes ? ` · ${formatBytes(remainingBytes)}${sizeUnknown ? '+' : ''}` : ''}
          </button>
        ) : null}
      </header>
      <ul className="model-setup-list">
        {order.map((key) => {
          const row = rowFor.get(key);
          if (!row) return <SetupRowShell key={key} item={memory!.get(key)!} rowState="installed" />;
          const { item, download, current, rowState } = row;
          return (
          <li key={key} className={cn('model-setup-item', `is-${rowState}`)}>
            <SetupRowHead item={item} rowState={rowState}>
              <RowActions rowState={rowState} download={download} current={current} remote={remote} run={run} start={start} pause={pause} discard={discard} />
            </SetupRowHead>
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
            {rowState === 'error' ? <p className="model-setup-error">{current?.error || 'The download stopped.'}</p> : null}
            {/* A row with its own download says enough; the where-to-put-it line is for the rest. */}
            {rowState === 'manual' || (rowState === 'idle' && remote) ? <p className="model-setup-detail">{item.detail}</p> : null}
            {item.nodePack ? (
              <NodeInstall pack={item.nodePack} plan={item.install} autoInstall={item.autoInstall} showToast={showToast} onRestarted={onInstalled} afterRestart={`${name} is ready after that.`} />
            ) : item.command ? (
              <div className="model-setup-command"><ShellCommand plan={item.command} showToast={showToast} /></div>
            ) : null}
          </li>
          );
        })}
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
      {remote ? <p className="model-setup-note">{thisComputer ? 'ComfyUI runs on another computer, so put these files into its models folders there, then rescan.' : 'Add these on the computer running HEISS UI; this workflow is ready here once they are in place.'}</p> : null}
    </section>
  );
}

/** A file name may wrap after its separators, not mid-word. */
function breakable(text: string) {
  return text.split(/(?<=[_.-])/).flatMap((piece, index) => (index ? [<wbr key={index} />, piece] : [piece]));
}

/** The part's dot, name and whatever sits on the right; shared by live and finished rows. */
function SetupRowHead({ item, rowState, children }: { item: MissingPart; rowState: RowState; children?: React.ReactNode }) {
  const ticked = rowState === 'landed' || rowState === 'installed';
  return (
    <div className="model-setup-row">
      <span className={cn('model-setup-dot', `is-${ticked ? 'landed' : rowState}`)} aria-hidden="true">
        {ticked ? <Check size={11} strokeWidth={3} /> : null}
      </span>
      <div className="model-setup-copy">
        <small title={partHint[item.part]}>{partVerb[item.part]}{partHint[item.part] ? <span className="model-setup-hint"> · {partHint[item.part]}</span> : null}</small>
        <strong>{breakable(item.label)}</strong>
      </div>
      <div className="model-setup-actions">{children}</div>
    </div>
  );
}

function SetupRowShell({ item, rowState }: { item: MissingPart; rowState: RowState }) {
  return (
    <li className={cn('model-setup-item', `is-${rowState}`)}>
      <SetupRowHead item={item} rowState={rowState}><span className="model-setup-meta">In place</span></SetupRowHead>
    </li>
  );
}

function progressLine(current: ModelDownload, rowState: RowState) {
  const pct = current.totalBytes ? Math.floor((current.receivedBytes / current.totalBytes) * 100) : 0;
  if (rowState === 'queued') return current.receivedBytes ? `Waiting · resumes at ${pct}%` : 'Waiting for the file before it';
  if (rowState === 'paused') return `Paused at ${pct}% · ${formatBytes(current.receivedBytes)} of ${formatBytes(current.totalBytes)}`;
  if (current.reconnecting) return `Connection dropped at ${pct}% · reconnecting (try ${current.reconnecting} of 3)…`;
  const speed = current.bytesPerSecond || 0;
  const eta = speed > 0 && current.totalBytes ? formatEta((current.totalBytes - current.receivedBytes) / speed) : '';
  return [`${pct}%`, current.receivedBytes ? `${formatBytes(current.receivedBytes)} of ${formatBytes(current.totalBytes)}` : formatBytes(current.totalBytes), speed > 0 ? `${formatBytes(speed)}/s` : 'connecting', eta].filter(Boolean).join(' · ');
}

/** Throwing away gigabytes takes a second tap: the first one asks, then it resets. */
function DiscardButton({ file, receivedBytes, onDiscard }: { file: string; receivedBytes: number; onDiscard: () => void }) {
  const [asking, setAsking] = React.useState(false);
  React.useEffect(() => {
    if (!asking) return;
    const timer = window.setTimeout(() => setAsking(false), 4000);
    return () => window.clearTimeout(timer);
  }, [asking]);
  if (asking) {
    return <button type="button" className="btn is-danger-soft" onClick={() => { setAsking(false); onDiscard(); }}>Discard {formatBytes(receivedBytes) || 'it'}?</button>;
  }
  return <button type="button" className="btn is-ghost is-icon" aria-label={`Discard the partial ${file}`} title="Discard" onClick={() => setAsking(true)}><X size={14} /></button>;
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
        <DiscardButton file={download.file} receivedBytes={current?.receivedBytes || 0} onDiscard={() => run(() => discard(download.id))} />
      </>
    );
  }
  if (rowState === 'error' && current?.needsBrowser) {
    // Gated: only a logged-in browser can fetch it, so the way on is its page.
    return <a className="btn" href={download.url.replace('/resolve/', '/blob/')} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Hugging Face</a>;
  }
  if (rowState === 'error') {
    return <button type="button" className="btn" onClick={() => run(() => start(download.id))}><RotateCw size={13} /> {current?.retryable === false ? 'Try again' : 'Resume'}</button>;
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

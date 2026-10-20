import { t } from '../i18n/core.js';
import { useLanguage } from '../i18n/react';
import React from 'react';
import { Check, ChevronDown, Download, ExternalLink, Pause, Play, RefreshCw, RotateCw, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ComfyRestart } from './ComfyRestart';
import { NodeInstall, ShellCommand } from './NodeInstall';
import { CellBar, Watcher } from './UpscaleDialogs';
import { formatEta } from './UpscaleDownloadActivity';
import { cn } from './format';
import { downloadFor, scrollRevealed, useDownloadReveal, useModelDownloads } from './useModelDownloads';
import type { MissingPart, ModelDownload, PartDownload, Profile } from './types';
import { useThisComputer } from './device';
import type { ShowToast } from './toast';
import { openFamilySetup } from './FamilySetupDialog';
import { apiJson } from './api';

function formatBytes(bytes = 0) {
  if (!bytes) return '';
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

const partVerb: Record<MissingPart['part'], string> = {
  encoder: 'Text encoder',
  vae: 'VAE',
  model: 'Model file',
  vision: 'Vision encoder',
  comfy: 'ComfyUI'
};

/** One plain line for the parts people new to ComfyUI will not know by name. */
const partHint: Partial<Record<MissingPart['part'], string>> = {
  encoder: 'Reads your prompt for the model',
  vae: 'Turns the model’s result into pixels',
  vision: 'Reads your start image for the model'
};

type RowState = 'idle' | 'queued' | 'downloading' | 'paused' | 'error' | 'landed' | 'manual' | 'installed';

/** What a setup panel is for: a built-in model's profile, or an imported workflow. */
export type SetupSubject = Pick<Profile, 'id' | 'missing'> & Partial<Pick<Profile, 'displayName' | 'label' | 'encoderBuiltIn' | 'source' | 'setupGuide' | 'recommended'>>;

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
  useLanguage();
  const reduced = useReducedMotion();
  const { state, landed, start: startDownload, pause, discard } = useModelDownloads();
  // Remembered with each download, so the top pill can bring people back to this panel.
  const start = (id: string) => startDownload(id, { kind: 'setup', subject: profile.id });
  // Opened from that pill: its row lights up. Only in the gallery, which is what the pill opens.
  const reveal = useDownloadReveal('setup');
  const revealing = variant === 'gallery' && reveal ? reveal.file : '';
  const [remoteAnswer, setRemote] = React.useState(false);
  // Known before anyone clicks: a ComfyUI elsewhere cannot receive downloads from here.
  const thisComputer = useThisComputer();
  // Downloads land on the computer running HEISS UI; from another device they are its job.
  const remote = remoteAnswer || state?.local === false || !thisComputer;
  const blocking = profile.missing || [];
  // "Don't show again" hides it at once; the server keeps the answer for good (server/dismissals.js).
  const [dismissedNow, setDismissedNow] = React.useState(false);
  // Nothing needed, but something recommended (FLUX.3's prompt upsampler): the same rows, worded as an offer.
  const optional = !blocking.length && Boolean(profile.recommended?.length) && !dismissedNow;
  const missing = optional ? profile.recommended! : blocking;
  // Waiting on ComfyUI itself (an update, a node pack and its restart) happens outside HEISS,
  // so the panel looks again by itself until it changes, rather than waiting for a reload.
  const waitingOnComfy = missing.some((item) => item.part === 'comfy');
  const [lookedAt, setLookedAt] = React.useState(0);
  const recheck = React.useRef(onInstalled);
  recheck.current = onInstalled;
  React.useEffect(() => {
    if (!waitingOnComfy) return;
    setLookedAt(Date.now());
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      recheck.current();
      setLookedAt(Date.now());
    }, 6000);
    return () => window.clearInterval(timer);
  }, [waitingOnComfy]);
  const name = profile.displayName || profile.label || 'This model';

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

  const setRecommendation = (keys: string[], dismissed: boolean) => Promise.all(keys.map((key) => apiJson(`/api/models/recommendations/${encodeURIComponent(key)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dismissed })
  })));
  const dismissRecommended = (keys: string[]) => {
    // Forget the rows it showed, or their going would read as "now in place".
    setupMemory.delete(profile.id);
    setDismissedNow(true);
    setRecommendation(keys, true)
      .then(() => {
        onInstalled();
        showToast(t("Won’t show this again"), 'success', {
          action: { label: t("Undo"), onClick: () => { setRecommendation(keys, false).then(() => { setDismissedNow(false); onInstalled(); }).catch(() => null); } }
        });
      })
      .catch((error) => { setDismissedNow(false); showToast(error instanceof Error ? error.message : 'Couldn’t save that', 'error'); });
  };
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed';
      if (/(not|isn.t) on this computer/i.test(message)) setRemote(true);
      showToast(message, 'error');
    }
  };

  // Which build of a part someone picked under "Other versions", by part.
  const [chosen, setChosen] = React.useState<Record<string, string>>({});
  const shownDone = allDone ? installed : ready;
  // A download that just landed waits for the rescan; only a file ComfyUI still does not list after that is stuck.
  // The server's onDisk covers files fetched before HEISS restarted, which `landed` has forgotten.
  const landedWaiting = missing.some((item) => item.downloads.some((download) => (landed.has(download.file) || download.onDisk) && !downloadFor(state, download.file)));
  const [stuckShown, setStuckShown] = React.useState(false);
  React.useEffect(() => {
    if (!landedWaiting) { setStuckShown(false); return; }
    const timer = window.setTimeout(() => setStuckShown(true), 3000);
    return () => window.clearTimeout(timer);
  }, [landedWaiting]);

  if (!missing.length && shownDone?.length) {
    return (
      <section className={cn('model-setup', `is-${variant}`, 'is-ready')} aria-label={alsoNeedsNodes ? t("Files in place") : t("{0} is ready", { "0": (name) })} role="status">
        <header className="model-setup-head">
          <div>
            {/* Files alone do not make an imported workflow ready while its custom nodes are missing. */}
            <strong>{alsoNeedsNodes ? t("{0} in place", { "0": (shownDone.length === 1 ? t("Its file is") : t("Its files are")) }) : t("{0} is ready", { "0": (name) })}</strong>
            <span>{alsoNeedsNodes ? t("Only the custom nodes below are missing.") : shownDone.length === 1 ? t("The missing part is in place.") : shownDone.length === 2 ? t("Both missing parts are in place.") : t("All {0} missing parts are in place.", { "0": (shownDone.length) })}</span>
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
    // The build this row is about: one already moving or in place (a fallback the
    // server picked by itself included), else the one picked here, else the catalog's first.
    const tracked = item.downloads.map((entry) => ({ entry, state: downloadFor(state, entry.file) }));
    const moving = tracked.find((row) => row.state?.status === 'downloading' || row.state?.status === 'queued');
    const inPlace = tracked.find((row) => landed.has(row.entry.file) || row.entry.onDisk);
    const paused = tracked.find((row) => row.state?.status === 'paused');
    const picked = tracked.find((row) => row.entry.id === chosen[partKey(item)]);
    const failed = [...tracked].reverse().find((row) => row.state?.status === 'error');
    const pick = moving || inPlace || paused || picked || failed || tracked[0];
    const download = pick?.entry;
    const current = pick?.state;
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
  // "Get all" lands several files, maybe on one disk: check them together before the first starts,
  // with the same margin per file the server keeps.
  const perDisk = new Map<string, { need: number; free: number }>();
  for (const row of startable) {
    const room = state?.space?.[row.download!.folder];
    if (!room) continue;
    const left = Math.max(0, (row.current?.totalBytes || row.download?.bytes || 0) - (row.current?.receivedBytes || 0));
    const disk = perDisk.get(room.disk) || { need: 0, free: room.free };
    disk.need += left + 256 * 1024 * 1024;
    perDisk.set(room.disk, disk);
  }
  const short = startable.length > 1 ? [...perDisk.values()].find((disk) => disk.need > disk.free) : undefined;
  const getAll = () => {
    if (short) {
      showToast(t("Not enough space. These need {0} and the disk has {1} free. Free up space or get them one at a time.", { "0": (formatBytes(short.need)), "1": (formatBytes(short.free)) }), 'error');
      return;
    }
    run(async () => { for (const row of startable) await start(row.download!.id); });
  };
  const moving = rows.some((row) => row.rowState === 'downloading' || row.rowState === 'queued');
  const stuck = stuckShown && rows.some((row) => row.rowState === 'landed');
  const fetchable = rows.filter((row) => row.download).length;

  // A missing node pack comes first: nothing else can be checked until ComfyUI has it.
  const pack = missing.find((item) => item.nodePack)?.nodePack;
  // An older ComfyUI cannot run this family at all, whatever gets downloaded.
  const outdated = missing.some((item) => item.part === 'comfy' && !item.nodePack);
  const manual = rows.some((row) => row.rowState === 'manual');
  const title = moving ? 'Downloading'
    : optional ? 'Recommended'
    : outdated ? 'Update ComfyUI first'
    : pack ? `Add ${pack.name} to ComfyUI`
    : fetchable === missing.length ? `Needs ${missing.length} more file${missing.length === 1 ? '' : 's'}` : 'Not ready yet';
  const subtitle = optional ? (missing.length === 1 && missing[0].detail ? missing[0].detail : `${name} runs now, and works better with ${missing.length === 1 ? 'this' : 'these'}.`)
    : outdated ? `${name} needs a newer ComfyUI. Update it before downloading the rest.`
    : pack ? `${name} needs custom nodes that don’t come with ComfyUI.`
    : alsoNeedsNodes ? `${name} needs ${missing.length === 1 ? 'this file' : 'these files'} and the custom nodes listed below.`
    : profile.encoderBuiltIn === false && profile.source === 'checkpoint'
    ? 'This checkpoint doesn’t include everything it needs.'
    : `${name} runs once ${missing.length === 1 ? 'this is' : 'these are'} in place.`;
  // Parts already in place keep their place in the list, ticked, until the set is done.
  const order = [...(memory?.keys() || [])];
  const rowFor = new Map(rows.map((row) => [partKey(row.item), row]));

  return (
    <section className={cn('model-setup', `is-${variant}`)} aria-label={t("Files this model needs")}>
      <header className="model-setup-head">
        <div>
          <strong>{title}</strong>
          <span>{short && !moving ? t("These need {0} and the disk has {1} free.", { "0": (formatBytes(short.need)), "1": (formatBytes(short.free)) }) : subtitle}</span>
        </div>
        {profile.setupGuide ? (
          // A family with its own guided setup: the same parts, with the choices that come before them.
          <button type="button" className="btn" onClick={() => openFamilySetup(profile.setupGuide!, profile.id)}>{t("Guided setup")}</button>
        ) : null}
        {startable.length > 1 && !outdated ? (
          <button type="button" className={cn('btn', short ? 'is-ghost' : 'is-primary')} onClick={getAll}>
            <Download size={14} />{t("Get all")}{remainingBytes ? ` · ${formatBytes(remainingBytes)}${sizeUnknown ? '+' : ''}` : ''}
          </button>
        ) : null}
      </header>
      <ul className="model-setup-list">
        {order.map((key) => {
          const row = rowFor.get(key);
          if (!row) return <SetupRowShell key={key} item={memory!.get(key)!} rowState="installed" />;
          const { item, download, current, rowState } = row;
          const revealed = Boolean(revealing) && item.downloads.some((entry) => entry.file === revealing);
          return (
          <li key={key} ref={revealed ? scrollRevealed : undefined} className={cn('model-setup-item', `is-${rowState}`, revealed && 'is-revealed')}>
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
            {rowState === 'error' ? <p className="model-setup-error">{current?.error || t("The download stopped.")}</p> : null}
            {rowState === 'error' && current?.needsBrowser ? <p className="model-setup-detail">{t("Or add a Hugging Face token in Settings › Models, then try again here.")}</p> : null}
            {download && download.id !== item.downloads[0]?.id && downloadFor(state, item.downloads[0].file)?.status === 'error' && (rowState === 'downloading' || rowState === 'queued')
              ? <p className="model-setup-detail">{item.downloads[0].file}{t("wasn’t available, so this version is downloading instead.")}</p>
              : null}
            {download && item.downloads.length > 1 && !remote && rowState !== 'landed' && rowState !== 'downloading' && rowState !== 'queued' ? (
              <OtherVersions
                downloads={item.downloads}
                current={download}
                onPick={(entry) => { setChosen((all) => ({ ...all, [key]: entry.id })); run(() => start(entry.id)); }}
              />
            ) : null}
            {/* A row with its own download says enough; the where-to-put-it line is for the rest. */}
            {rowState === 'manual' || (rowState === 'idle' && remote) ? <p className="model-setup-detail">{item.detail}</p> : null}
            {item.nodePack ? (
              <NodeInstall pack={item.nodePack} plan={item.install} autoInstall={item.autoInstall} showToast={showToast} onRestarted={onInstalled} afterRestart={t("{0} is ready after that.", { "0": (name) })} />
            ) : item.command ? (
              <div className="model-setup-command"><ShellCommand plan={item.command} showToast={showToast} /></div>
            ) : null}
          </li>
          );
        })}
      </ul>
      {stuck && !moving && !remote ? (
        <div className="model-setup-restart">
          <p>{t("Downloaded, but ComfyUI hasn’t listed it yet. Restart ComfyUI to load it.")}</p>
          <ComfyRestart compact onBack={onInstalled} />
        </div>
      ) : null}
      {optional && missing.some((item) => item.dismissKey) && !moving ? (
        <button type="button" className="btn is-ghost model-setup-recheck" onClick={() => dismissRecommended(missing.filter((item) => item.dismissKey).map((item) => item.dismissKey!))}>{t("Don’t show again")}</button>
      ) : null}
      {waitingOnComfy ? (
        <div className="model-setup-watch"><Watcher lastChecked={lookedAt}>{outdated ? t("Watching for the ComfyUI update…") : t("Watching for the nodes…")}</Watcher></div>
      ) : null}
      {manual && !moving && !waitingOnComfy ? (
        <button type="button" className="btn is-ghost model-setup-recheck" onClick={onInstalled}><RefreshCw size={13} />{t("Check again")}</button>
      ) : null}
      {remote ? <p className="model-setup-note">{thisComputer ? t("ComfyUI runs on another computer. Put these files in its model folders there, then rescan.") : t("Add these on the computer running HEISS UI.")}</p> : null}
    </section>
  );
}

/** Who publishes a build, as a short line: Comfy-Org's own repackaging, or the community converter's name. */
function sourceLine(download: PartDownload) {
  const size = formatBytes(download.bytes);
  const who = download.source === 'Comfy-Org' ? 'Comfy-Org' : download.source ? `${download.source} (community)` : '';
  return [size, who].filter(Boolean).join(' · ');
}

/**
 * The other builds of a part (another precision, another publisher), folded
 * away under one quiet line: the default is the first, and most people never
 * need to open this.
 */
function OtherVersions({ downloads, current, onPick }: { downloads: PartDownload[]; current: PartDownload; onPick: (download: PartDownload) => void }) {
  useLanguage();
  const [open, setOpen] = React.useState(false);
  const others = downloads.filter((entry) => entry.id !== current.id);
  if (!others.length) return null;
  return (
    <div className={cn('model-setup-versions', open && 'is-open')}>
      <button type="button" className="model-setup-versions-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {current.file === downloads[0].file ? t("Other version{0}", { "0": (others.length === 1 ? t("") : t("s")) }) : t("All versions")} <em>{others.length}</em> <ChevronDown size={12} />
      </button>
      {open ? (
        <ul>
          <li className="is-current">
            <span><strong>{breakable(current.file)}</strong><small>{sourceLine(current)}</small></span>
            <em>{t("Selected")}</em>
          </li>
          {others.map((entry) => (
            <li key={entry.id}>
              <span><strong>{breakable(entry.file)}</strong><small>{sourceLine(entry)}{entry.onDisk ? t(" · already downloaded") : ''}</small></span>
              <button type="button" className="btn is-ghost" onClick={() => { setOpen(false); onPick(entry); }}><Download size={13} />{t("Download")}</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A file name may wrap after its separators, not mid-word. */
function breakable(text: string) {
  return text.split(/(?<=[_.-])/).flatMap((piece, index) => (index ? [<wbr key={index} />, piece] : [piece]));
}

/** The part's dot, name and whatever sits on the right; shared by live and finished rows. */
function SetupRowHead({ item, rowState, children }: { item: MissingPart; rowState: RowState; children?: React.ReactNode }) {
  useLanguage();
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
  useLanguage();
  return (
    <li className={cn('model-setup-item', `is-${rowState}`)}>
      <SetupRowHead item={item} rowState={rowState}><span className="model-setup-meta">{t("In place")}</span></SetupRowHead>
    </li>
  );
}

function progressLine(current: ModelDownload, rowState: RowState) {
  const pct = current.totalBytes ? Math.floor((current.receivedBytes / current.totalBytes) * 100) : 0;
  if (rowState === 'queued') return current.receivedBytes ? `Waiting · resumes at ${pct}%` : 'Waiting for the previous file';
  if (rowState === 'paused') return `Paused at ${pct}% · ${formatBytes(current.receivedBytes)} of ${formatBytes(current.totalBytes)}`;
  if (current.reconnecting) return `Connection dropped at ${pct}% · reconnecting (try ${current.reconnecting} of 3)…`;
  if (current.verifying) return `${formatBytes(current.totalBytes)} · checking the file…`;
  const speed = current.bytesPerSecond || 0;
  const eta = speed > 0 && current.totalBytes ? formatEta((current.totalBytes - current.receivedBytes) / speed) : '';
  return [`${pct}%`, current.receivedBytes ? `${formatBytes(current.receivedBytes)} of ${formatBytes(current.totalBytes)}` : formatBytes(current.totalBytes), speed > 0 ? `${formatBytes(speed)}/s` : 'connecting', eta].filter(Boolean).join(' · ');
}

/** Throwing away gigabytes takes a second tap: the first one asks, then it resets. */
function DiscardButton({ file, receivedBytes, onDiscard }: { file: string; receivedBytes: number; onDiscard: () => void }) {
  useLanguage();
  const [asking, setAsking] = React.useState(false);
  React.useEffect(() => {
    if (!asking) return;
    const timer = window.setTimeout(() => setAsking(false), 4000);
    return () => window.clearTimeout(timer);
  }, [asking]);
  if (asking) {
    return <button type="button" className="btn is-danger-soft" onClick={() => { setAsking(false); onDiscard(); }}>{t("Discard")}{" "}{formatBytes(receivedBytes) || t("it")}?</button>;
  }
  return <button type="button" className="btn is-ghost is-icon" aria-label={t("Discard partial download of {0}", { "0": (file) })} title={t("Discard")} onClick={() => setAsking(true)}><X size={14} /></button>;
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
  useLanguage();
  if (!download) return null;
  const link = (
    <a className="btn is-ghost is-icon" href={download.url.replace('/resolve/', '/blob/')} target="_blank" rel="noreferrer" aria-label={t("Open {0} on Hugging Face", { "0": (download.file) })} title={download.file}>
      <ExternalLink size={14} />
    </a>
  );
  if (rowState === 'downloading' || rowState === 'queued') {
    return <button type="button" className="btn is-ghost is-icon" aria-label={t("Pause {0}", { "0": (download.file) })} title={t("Pause")} onClick={() => run(() => pause(current?.id || download.id))}><Pause size={14} /></button>;
  }
  if (rowState === 'paused') {
    return (
      <>
        <button type="button" className="btn" onClick={() => run(() => start(download.id))}><Play size={13} />{t("Resume")}</button>
        <DiscardButton file={download.file} receivedBytes={current?.receivedBytes || 0} onDiscard={() => run(() => discard(download.id))} />
      </>
    );
  }
  if (rowState === 'error' && current?.needsBrowser) {
    // Gated: only a logged-in browser can fetch it, so the way on is its page.
    return <a className="btn" href={download.url.replace('/resolve/', '/blob/')} target="_blank" rel="noreferrer"><ExternalLink size={13} />{t("Hugging Face")}</a>;
  }
  if (rowState === 'error') {
    return <button type="button" className="btn" onClick={() => run(() => start(download.id))}><RotateCw size={13} /> {current?.retryable === false ? t("Try again") : t("Resume")}</button>;
  }
  if (rowState === 'landed') return <span className="model-setup-meta">{t("In place")}</span>;
  return (
    <>
      {!remote ? (
        <button type="button" className="btn" onClick={() => run(() => start(download.id))} title={[download.file, download.source].filter(Boolean).join(' · ')}>
          <Download size={14} /> {download.bytes ? formatBytes(download.bytes) : t("Get")}
        </button>
      ) : null}
      {link}
    </>
  );
}

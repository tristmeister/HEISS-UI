import { t } from '../i18n/core.js';
import { useLanguage } from '../i18n/react';
import React from 'react';
import { ArrowLeft, Check, Download, ExternalLink, Pause, RefreshCw } from 'lucide-react';
import { Modal } from './Modal';
import { NodeInstall } from './NodeInstall';
import { FamilySetupHero, type FamilySetupHeroStage } from './FamilySetupHero';
import { CellBar, Watcher } from './UpscaleDialogs';
import { formatEta } from './UpscaleDownloadActivity';
import { apiJson } from './api';
import { cn } from './format';
import { useThisComputer } from './device';
import { downloadFor, useModelDownloads } from './useModelDownloads';
import type { MissingPart, ModelDownload } from './types';
import type { ShowToast } from './toast';

/**
 * Guided setup for a model already in ComfyUI whose family runs more than one
 * way (MOSS-Image: Comfy-Org's single files on ComfyUI's own nodes, or the
 * official folder on its makers' nodes; server/family-setup.js). HEISS never
 * fetches the model: the file says which way it runs, and three steps under
 * one hero walk through what that needs. ComfyUI: an update or the node pack.
 * Files: the text encoder and VAE, where the way needs them. Ready. It
 * watches ComfyUI the whole time, so work done elsewhere moves it on.
 */

type SetupDownload = { id: string; file: string; folder: string; label: string; bytes: number; url: string; part: 'encoder' | 'vae'; onDisk: boolean };
type Route = 'native' | 'pack';
type Step = 'comfy' | 'files' | 'ready';
export type FamilySetupPlan = {
  family: string; title: string; maker: string; blurb: string; license: string; page: string; filesPage: string;
  profile: { id: string; model: string; displayName: string; variant: string; ready: boolean } | null;
  route: Route;
  parts: Array<{ part: 'encoder' | 'vae'; label: string; have: string; download: SetupDownload | null }>;
  comfy: {
    online: boolean; version: string; native: boolean;
    pack: { id: string; name: string; loaded: boolean; ready: boolean; part: MissingPart | null } | null;
  };
  local?: boolean;
};

/* ------------------------------------------------------------ Opening it from anywhere */

type Request = { family: string; profileId: string };
const openListeners = new Set<(request: Request) => void>();
/** Opens the guided setup for one model profile of a family (from its setup panel). */
export function openFamilySetup(family: string, profileId = '') {
  openListeners.forEach((listener) => listener({ family, profileId }));
}
export function useFamilySetupRequests(onOpen: (request: Request) => void) {
  const latest = React.useRef(onOpen);
  latest.current = onOpen;
  React.useEffect(() => {
    const listener = (request: Request) => latest.current(request);
    openListeners.add(listener);
    return () => { openListeners.delete(listener); };
  }, []);
}

/* ------------------------------------------------------------ Helpers */

function formatBytes(bytes = 0) {
  if (!bytes) return '';
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'comfy', label: 'ComfyUI' },
  { id: 'files', label: 'Files' },
  { id: 'ready', label: 'Ready' }
];

function SetupSteps({ step }: { step: Step }) {
  useLanguage();
  const current = STEPS.findIndex((item) => item.id === step);
  return (
    <ol className="upscale-stepper" aria-label={t("Setup steps")}>
      {STEPS.map((item, index) => {
        const state = step === 'ready' || index < current ? 'done' : index === current ? 'active' : 'todo';
        return (
          <li key={item.id} className={`is-${state}`} aria-current={state === 'active' ? 'step' : undefined}>
            <i aria-hidden="true">{state === 'done' ? <Check size={10} strokeWidth={3} /> : null}</i>
            <span>{t(item.label)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** The plan, read again every few seconds while the dialog is open. */
function useFamilySetupPlan(family: string, profileId: string, open: boolean) {
  const [plan, setPlan] = React.useState<FamilySetupPlan | null>(null);
  const [checkedAt, setCheckedAt] = React.useState(0);
  const load = React.useCallback(async () => {
    try {
      setPlan(await apiJson<FamilySetupPlan & { ok: boolean }>(`/api/family-setup/${encodeURIComponent(family)}?profile=${encodeURIComponent(profileId)}`));
    } catch {
      // The watcher keeps counting; the next poll tries again.
    } finally {
      setCheckedAt(Date.now());
    }
  }, [family, profileId]);
  React.useEffect(() => {
    if (!open || !family) return;
    load();
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, [open, family, load]);
  return { plan, checkedAt, reload: load };
}

/* ------------------------------------------------------------ The dialog */

export function FamilySetupDialog({ family, profileId, open, onOpenChange, showToast, onUse, onChanged, comfyUrl }: {
  family: string;
  profileId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showToast: ShowToast;
  /** Select the model in the composer, by its profile id. */
  onUse: (profileId: string) => void;
  /** Something this dialog saw change (ComfyUI updated, nodes in, a file landed): rescan, so the rest of the studio agrees. */
  onChanged?: () => void;
  comfyUrl?: string;
}) {
  useLanguage();
  const { plan, checkedAt, reload } = useFamilySetupPlan(family, profileId, open);
  const { state: downloads, landed, start, pause } = useModelDownloads();
  const admin = useThisComputer();
  const [step, setStep] = React.useState<Step>('comfy');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (open) setStep('comfy'); }, [open]);

  // What the dialog last saw. Any change means the sidebar's copy is stale: it rescans now,
  // not on the next reload, and once more when the dialog closes.
  const seen = plan ? [plan.comfy.online, plan.comfy.native, plan.comfy.pack?.loaded, plan.comfy.pack?.ready, plan.profile?.ready, ...plan.parts.map((row) => Boolean(row.have))].join('|') : '';
  const lastSeen = React.useRef('');
  const changed = React.useRef(onChanged);
  changed.current = onChanged;
  React.useEffect(() => {
    if (!seen) return;
    if (lastSeen.current && lastSeen.current !== seen) changed.current?.();
    lastSeen.current = seen;
  }, [seen]);
  React.useEffect(() => {
    if (open) { lastSeen.current = ''; return; }
    changed.current?.();
  }, [open]);

  const route: Route = plan?.route || 'native';
  const routeOk = Boolean(plan && (route === 'native' ? plan.comfy.native : plan.comfy.pack?.ready));
  const ready = Boolean(plan?.profile?.ready);
  // Done elsewhere (an update, the nodes, the files): the dialog moves on by itself.
  React.useEffect(() => {
    if (ready && step !== 'ready') setStep('ready');
  }, [ready, step]);

  const rowState = (download: SetupDownload | null, have: string) => {
    if (have || !download) return 'installed' as const;
    const current = downloadFor(downloads, download.file);
    if (current?.status === 'downloading' || current?.status === 'queued') return 'downloading' as const;
    if (current?.status === 'paused') return 'paused' as const;
    if (current?.status === 'error') return 'error' as const;
    if (download.onDisk || landed.has(download.file) || current?.status === 'done') return 'landed' as const;
    return 'idle' as const;
  };
  const parts = plan?.parts || [];
  const pending = parts.filter((row) => ['idle', 'paused', 'error'].includes(rowState(row.download, row.have)));
  const moving = parts.filter((row) => rowState(row.download, row.have) === 'downloading');
  const totals = parts.reduce((sum, row) => {
    const state = rowState(row.download, row.have);
    const size = row.download?.bytes || 0;
    if (state === 'installed') return sum;
    const current = row.download ? downloadFor(downloads, row.download.file) : undefined;
    const received = state === 'landed' ? size : current?.receivedBytes || 0;
    return { total: sum.total + size, received: sum.received + Math.min(size, received), speed: sum.speed + (current?.status === 'downloading' ? current.bytesPerSecond || 0 : 0) };
  }, { total: 0, received: 0, speed: 0 });
  const remaining = pending.reduce((sum, row) => sum + Math.max(0, (row.download?.bytes || 0) - (downloadFor(downloads, row.download!.file)?.receivedBytes || 0)), 0);
  const space = downloads?.space?.text_encoders;
  const short = space && remaining ? remaining + 1024 ** 3 > space.free : false;
  const downloading = moving.length > 0;
  const progress = totals.total ? totals.received / totals.total : 0;
  const failed = parts.some((row) => rowState(row.download, row.have) === 'error');

  const heroStage: FamilySetupHeroStage = !plan ? 'checking'
    : !plan.comfy.online ? 'offline'
    : step === 'comfy' ? (routeOk ? 'version' : 'comfy')
    : step === 'ready' ? 'ready'
    : downloading ? 'downloading'
    : failed ? 'error'
    : 'files';

  const title = plan?.title || 'Model setup';
  const name = plan?.profile?.displayName || title;
  const close = () => onOpenChange(false);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try { await action(); } catch (error) {
      showToast(error instanceof Error ? error.message : 'That didn’t work.', 'error');
    } finally {
      setBusy(false);
      reload();
    }
  };
  const getAll = () => run(async () => { for (const row of pending) if (row.download) await start(row.download.id); });

  /* ---------------------------------------------------------- Copy */

  let heading = `Set up ${name}`;
  let description: React.ReactNode = plan
    ? route === 'pack'
      ? `This is the official ${title} folder. Its makers’ nodes load it, text encoder and VAE included.`
      : `This is ${title} as single files. ComfyUI runs it on its own nodes, with a text encoder and VAE beside it.`
    : 'Checking ComfyUI…';
  if (plan && !plan.comfy.online) { heading = 'Waiting for ComfyUI'; description = 'Start ComfyUI to set this model up.'; }
  else if (step === 'files') {
    heading = downloading ? 'Downloading' : failed ? 'The download stopped' : 'Text encoder and VAE';
    description = downloading ? `${name} is ready when these land. The download continues if you close this.` : `${title} reads your prompt with one and draws the pixels with the other.`;
  } else if (step === 'ready') { heading = `${name} is ready`; description = 'Set up with the settings its makers use.'; }

  /* ---------------------------------------------------------- Body */

  let body: React.ReactNode = null;
  let footer: React.ReactNode = <button className="btn is-ghost" onClick={close}>{t("Not now")}</button>;
  const recheck = <button className="btn" onClick={() => reload()}><RefreshCw size={13} />{t("Check again")}</button>;
  const nextStep: Step = route === 'pack' || !parts.some((row) => !row.have) ? 'ready' : 'files';

  if (!plan) {
    body = <Watcher>{t("Checking ComfyUI…")}</Watcher>;
  } else if (!plan.comfy.online) {
    body = <Watcher lastChecked={checkedAt}>{t("Waiting for ComfyUI")}{comfyUrl ? <>{t("at")}{" "}<code>{comfyUrl.replace(/^https?:\/\//, '')}</code></> : null}</Watcher>;
    footer = <>{footer}{recheck}</>;
  } else if (step === 'comfy') {
    const pack = plan.comfy.pack;
    body = (
      <>
        <div className="family-setup-file">
          <span className="family-setup-file-dot" aria-hidden="true"><Check size={11} strokeWidth={3} /></span>
          <div>
            <strong>{name}{plan.profile?.variant ? <em>{plan.profile.variant}</em> : null}</strong>
            <code>{plan.profile?.model}</code>
          </div>
          <span className="family-setup-file-route">{route === 'pack' ? t("{0} nodes", { "0": (pack?.name) }) : t("ComfyUI’s own nodes")}</span>
        </div>
        {route === 'native' && !plan.comfy.native ? (
          <>
            <div className="upscale-callout family-setup-gap">
              <strong>{t("Update ComfyUI to its newest version")}</strong>
              <span>{t("ComfyUI learned")}{" "}{title}{t("on 16 October 2026, after release 0.41.3")}{plan.comfy.version ? t(". This one is {0}", { "0": (plan.comfy.version) }) : ''}{t(". Update it (")}<code>{t("git pull")}</code>{t("in its folder, or the nightly in ComfyUI-Manager), then restart it.")}</span>
            </div>
            <p className="upscale-fine">{t("Or use the official model folder in")}{" "}<code>models/diffusers</code>{t("with its makers’ nodes, which run on the ComfyUI you have.")}{" "}<a href={plan.page} target="_blank" rel="noreferrer">{t("How")}{" "}<ExternalLink size={11} /></a></p>
            <Watcher lastChecked={checkedAt}>{t("Waiting for ComfyUI to know")}{" "}{title}…</Watcher>
          </>
        ) : route === 'pack' && pack && !pack.loaded && pack.part?.nodePack ? (
          <div className="family-setup-gap">
            <NodeInstall pack={pack.part.nodePack} plan={pack.part.install} autoInstall={pack.part.autoInstall} showToast={showToast} onRestarted={() => reload()} afterRestart={t("{0} is ready after that.", { "0": (name) })} />
            <Watcher lastChecked={checkedAt}>{t("Waiting for the")}{" "}{pack.name}{t("nodes…")}</Watcher>
          </div>
        ) : route === 'pack' && pack && !pack.ready ? (
          <div className="upscale-callout family-setup-gap">
            <strong>{t("Update ComfyUI")}</strong>
            <span>{t("The")}{" "}{pack.name}{t("nodes are in, but this ComfyUI lacks the layer skip node they sample with. Version 0.38 or newer has it.")}</span>
          </div>
        ) : (
          <p className="family-setup-ok family-setup-gap"><Check size={13} strokeWidth={2.6} aria-hidden="true" /> {route === 'native' ? t("This ComfyUI runs {0} on its own.", { "0": (title) }) : t("The {0} nodes are in.", { "0": (pack?.name) })}</p>
        )}
      </>
    );
    footer = (
      <>
        {footer}
        {!routeOk ? recheck : null}
        <button className="btn is-primary" disabled={!routeOk} onClick={() => setStep(ready ? 'ready' : nextStep)}>{t("Continue")}</button>
      </>
    );
  } else if (step === 'files') {
    body = (
      <>
        {downloading ? (
          <div className="upscale-meter">
            <strong>{Math.floor(progress * 100)}<small>%</small></strong>
            <div>
              <span>{formatBytes(totals.received) || t("0 MB")}{t("of")}{" "}{formatBytes(totals.total)}</span>
              <span>{totals.speed > 0 ? `${formatBytes(totals.speed)}/s · ${formatEta((totals.total - totals.received) / totals.speed)}` : t("Connecting to Hugging Face")}</span>
            </div>
          </div>
        ) : null}
        <ul className="upscale-files is-live">
          {parts.map((row) => {
            const state = rowState(row.download, row.have);
            const current: ModelDownload | undefined = row.download ? downloadFor(downloads, row.download.file) : undefined;
            const done = state === 'installed' || state === 'landed';
            const value = done ? 1 : current?.totalBytes ? current.receivedBytes / current.totalBytes : 0;
            return (
              <li key={row.part} className={cn(done && 'is-done')}>
                <div>
                  <strong>{row.label}<em>{row.part === 'encoder' ? t("reads your prompt") : t("draws the pixels")}</em></strong>
                  {state === 'downloading' || state === 'paused' ? <CellBar value={value} /> : <code>{row.have || row.download?.file}</code>}
                </div>
                <span>
                  {done ? <><Check size={12} strokeWidth={3} /> {state === 'installed' ? t("In place") : t("Downloaded")}</>
                    : state === 'downloading' ? `${Math.floor(value * 100)}%`
                    : state === 'paused' ? t("Paused")
                    : state === 'error' ? t("Stopped")
                    : formatBytes(row.download?.bytes)}
                </span>
              </li>
            );
          })}
        </ul>
        {!admin ? <p className="upscale-fine">{t("Files download on the computer running HEISS UI. Set")}{" "}{title}{t("up there.")}</p>
          : plan.local === false ? <p className="upscale-fine">{t("ComfyUI runs on another computer. Put these files in its model folders there.")}</p>
          : short ? <p className="upscale-fine is-warn">{t("These need")}{" "}{formatBytes(remaining)}{t("and the disk has")}{" "}{formatBytes(space?.free)}{t("free.")}</p>
          : null}
        {!pending.length && !moving.length ? <Watcher lastChecked={checkedAt}>{t("Waiting for ComfyUI to list the files…")}</Watcher> : null}
      </>
    );
    footer = (
      <>
        <button className="btn is-ghost" onClick={() => setStep('comfy')}><ArrowLeft size={13} />{t("Back")}</button>
        {moving.length ? (
          <>
            <button className="btn" onClick={() => run(async () => { for (const row of moving) await pause(row.download!.id); })}><Pause size={13} />{t("Pause")}</button>
            <button className="btn is-primary" onClick={close}>{t("Continue in background")}</button>
          </>
        ) : pending.length && admin && plan.local !== false ? (
          <button className="btn is-primary" disabled={busy || short} onClick={getAll}>
            <Download size={14} /> {failed || pending.some((row) => rowState(row.download, row.have) === 'paused') ? t("Resume") : t("Download")} · {formatBytes(remaining)}
          </button>
        ) : null}
      </>
    );
  } else if (step === 'ready') {
    body = (
      <div className="family-setup-ready">
        <div>
          <strong>{name}</strong>
          <span>{route === 'pack' ? t("Through the {0} nodes, skipping layer 22 on the negative pass", { "0": (plan.comfy.pack?.name) }) : t("On ComfyUI’s own nodes")}{t("· 50 steps · CFG 3 · 1024 × 1024")}</span>
        </div>
        <p>{t("Put words you want in the picture in quotes, like")}{" "}<q>{t("a café sign that reads “Open late”")}</q>.</p>
      </div>
    );
    footer = (
      <>
        <button className="btn is-ghost" onClick={close}>{t("Close")}</button>
        <button className="btn is-primary" disabled={!plan.profile} onClick={() => { if (plan.profile) onUse(plan.profile.id); close(); }}><Check size={14} />{t("Use")}{" "}{title}</button>
      </>
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="form"
      className="upscale-modal family-setup-modal"
      hero={
        <div className="upscale-hero-wrap">
          <FamilySetupHero className="upscale-hero" stage={heroStage} progress={progress} focus={step === 'comfy' ? (route === 'native' ? 0 : 1) : 2} />
          <SetupSteps step={step} />
        </div>
      }
      title={heading}
      description={description}
      footer={footer}
    >
      <div className="upscale-body" key={step}>{body}</div>
    </Modal>
  );
}

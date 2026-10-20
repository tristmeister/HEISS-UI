import { languages, setLanguage, t } from '../i18n/core.js';
import { useLanguage } from '../i18n/react';
import React from 'react';
import { ComfyManagerNote, ComfyRestart, restartResultLine, useComfyRestart, useComfyRestartEta, useComfyRestarting } from './ComfyRestart';
import { NodeInstall } from './NodeInstall';
import { CopyIcon, useCopyFeedback } from './CopyFeedback';
import { useAtComputer, usePhone, useThisComputer } from './device';
import type { ConfirmAction } from './useConfirmation';
import { ArrowUpRight, Check, RotateCw, Download, ExternalLink, FolderOpen, FolderSearch, ScanSearch, Puzzle, Boxes, Github, Globe, Info, LifeBuoy, LockKeyhole, MessageSquarePlus, Plug, Plus, RefreshCw, Scale, ScrollText, SlidersHorizontal, Wand2, Library } from 'lucide-react';
import { discordUrl, features, githubUrl } from './constants';
import { DiscordIcon } from './DiscordIcon';
import { cn } from './format';
import { BetaTag, NumberPicker, Skeleton, StudioSelect, Tip } from './components';
import { Modal } from './Modal';
import { HeatMark } from './HeatMark';
import { MosaicButton } from './MosaicButton';
import { apiFetch, apiJson } from './api';
import type { ModelFile, Models, Profile, OutputFolderReport, UpdateStatus, UpscaleInstall, UpscaleStatus } from './types';
import type { ModelFolders } from './useModelFolders';
import { formatBytes, upscaleEfforts, upscaleQualityLabel } from './useUpscale';
import { HiddenSettings } from './HiddenSettings';
import { shortcuts } from './shortcuts';
import { SettingsDrawer } from './SettingsDrawer';
import { useStarterPlan } from './StarterModels';
import { InpaintDemo } from './InpaintDemo';
import { CivitaiRow, EarlierImagesGroup, PromptHistoryRow } from './LibrarySettings';
import { knownDiagnostics, loadDiagnostics, troubleshootingUrl } from './diagnostics';
import { boardUrl, openFeedback } from './feedback';
import { HuggingFaceTokenSettings } from './HuggingFaceToken';
import { OtherDevicesGroup } from './OtherDevices';
import { TrashRow } from './TrashRow';
import type { ShowToast } from './toast';

export const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, description: 'Layout, keyboard, safety and reset.' },
  { id: 'generation', label: 'Generation', icon: Wand2, description: 'The composer, previews and starting values.' },
  { id: 'features', label: 'Features', icon: Puzzle, description: 'Upscaling and inpainting.' },
  { id: 'models', label: 'Models', icon: Boxes, description: 'What ComfyUI has installed and where it finds models.' },
  { id: 'library', label: 'Library', icon: Library, description: 'Where images are saved and what the gallery shows.' },
  { id: 'privacy', label: 'Hidden', icon: LockKeyhole, description: 'Images you keep to yourself, encrypted and unlocked with a password, Touch ID or Windows Hello.' },
  { id: 'connection', label: 'Connection', icon: Plug, description: 'Reaching ComfyUI, restarting it, and opening the studio on other devices.' },
  { id: 'about', label: 'About', icon: Info, description: 'Version, stats, updates, feedback and credits.' }
] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number]['id'];

/* ------------------------------------------------------------ Primitives */

export function Switch({ checked, onChange, disabled, label, size = 'md' }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string; size?: 'sm' | 'md' }) {
  useLanguage();
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={cn('switch', size === 'sm' && 'is-sm')} onClick={() => onChange(!checked)}>
      <span className="switch-thumb" />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: React.ReactNode }>; onChange: (next: T) => void; label: string }) {
  useLanguage();
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className={cn(value === option.value && 'active')} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** The two looks of a stacked run, drawn small: a photo with two edges under it, and a cover flow. */
function RunStyleGlyph({ kind }: { kind: 'burst' | 'flow' }) {
  useLanguage();
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === 'burst' ? (
        <>
          <rect x="3" y="1" width="12" height="9" rx="2" />
          <path d="M4.5 11.6h9" opacity=".7" />
          <path d="M6 13.2h6" opacity=".45" />
        </>
      ) : (
        <>
          <rect x="5.5" y="1.5" width="7" height="11" rx="1.6" />
          <path d="M3.6 3.4 1 4.4v5.2l2.6 1" opacity=".6" />
          <path d="M14.4 3.4 17 4.4v5.2l-2.6 1" opacity=".6" />
        </>
      )}
    </svg>
  );
}

/** Where HEISS UI looks for ComfyUI: test an address, then keep it. */
function ComfyAddressRow({ current, search, showToast, onSaved }: { current: string; search: boolean; showToast: ShowToast; onSaved: () => void }) {
  useLanguage();
  const [value, setValue] = React.useState(current);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState('');
  React.useEffect(() => { setValue(current); }, [current]);
  const submit = async (save: boolean) => {
    setBusy(true);
    setNote('');
    try {
      const response = await apiFetch('/api/comfy-url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: value, save }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setNote(data.error || 'Couldn’t check that address.'); return; }
      setValue(data.url);
      if (!data.reachable) { setNote(`${data.detail || 'ComfyUI didn’t respond at that address.'}${save ? ' The address wasn’t saved.' : ''}`); return; }
      if (data.saved) { setNote(t("Saved. Connected to ComfyUI.")); onSaved(); }
      else setNote(t("ComfyUI responds at that address."));
    } catch {
      setNote(t("Can’t reach HEISS UI. Make sure it’s running."));
    } finally {
      setBusy(false);
    }
  };
  const changed = value.trim() && value.trim() !== current;
  return (
    <Row label={t("Address")} description={note || t("Where ComfyUI runs. ComfyUI Desktop usually uses port 8000, a manual install 8188{0}.", { "0": (search ? t("; on this computer both are tried") : t("")) })}>
      <div className="set-address">
        <input className="set-path-input" value={value} onChange={(event) => setValue(event.target.value)} aria-label={t("ComfyUI address")} spellCheck={false} autoComplete="off" onKeyDown={(event) => { if (event.key === 'Enter' && changed) submit(true); }} />
        <button className="btn" onClick={() => submit(false)} disabled={busy || !value.trim()}>{t("Test")}</button>
        <button className="btn is-primary" onClick={() => submit(true)} disabled={busy || !changed}>{busy ? t("Checking…") : t("Save")}</button>
      </div>
    </Row>
  );
}

export function Group({ title, note, tone, children }: React.PropsWithChildren<{ title?: string; note?: React.ReactNode; tone?: 'danger' }>) {
  useLanguage();
  return (
    <section className="set-group">
      {title ? <h4 className="set-group-title">{title}</h4> : null}
      <div className={cn('set-card', tone === 'danger' && 'is-danger')}>{children}</div>
      {note ? <p className="set-note">{note}</p> : null}
    </section>
  );
}

export function Row({ label, description, children, stacked, disabled }: React.PropsWithChildren<{ label: React.ReactNode; description?: React.ReactNode; stacked?: boolean; disabled?: boolean }>) {
  useLanguage();
  return (
    <div className={cn('set-row', stacked && 'is-stacked', disabled && 'is-disabled')}>
      <div className="set-row-text">
        <strong>{label}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      {children ? <div className="set-row-control">{children}</div> : null}
    </div>
  );
}

function SwitchRow({ label, tag, description, checked, onChange, disabled }: { label: string; tag?: React.ReactNode; description?: React.ReactNode; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  useLanguage();
  return (
    <Row label={tag ? <>{label}{tag}</> : label} description={description} disabled={disabled}>
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </Row>
  );
}

/** Whether HEISS looks on the usual ports when its address doesn't answer. Off for a second ComfyUI kept just for HEISS. */
function ComfySearchRow({ enabled, onSaved }: { enabled: boolean; onSaved: () => void }) {
  useLanguage();
  const [checked, setChecked] = React.useState(enabled);
  const [note, setNote] = React.useState('');
  React.useEffect(() => { setChecked(enabled); }, [enabled]);
  const change = async (next: boolean) => {
    setChecked(next);
    setNote('');
    try {
      const response = await apiFetch('/api/comfy-search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: next }) });
      if (!response.ok) throw new Error();
      onSaved();
    } catch {
      setChecked(!next);
      setNote(t("Couldn’t save that. Make sure HEISS UI is running."));
    }
  };
  return (
    <SwitchRow
      label={t("Find ComfyUI on its own")}
      description={note || t("When nothing answers at this address, try ports 8188 and 8000 and switch to the ComfyUI there. Turn off to stay on this address, e.g. with a second ComfyUI just for HEISS.")}
      checked={checked}
      onChange={change}
    />
  );
}

/** Folders ComfyUI reads because HEISS added them, and the way to find more. */
function ModelFolderSettings({ folders, confirmAction, onOpen, hints, onHintsChange }: { folders: ModelFolders; confirmAction: ConfirmAction; onOpen: () => void; hints: boolean; onHintsChange: (next: boolean) => void }) {
  useLanguage();
  const report = folders.report;
  const stray = (report?.folders || []).reduce((sum, folder) => sum + folder.count, 0);
  const linked = report?.linked || [];
  // Settings is where people come to check: look again, quietly, each time it opens.
  React.useEffect(() => { folders.scan({ quiet: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Group title={t("Model folders")} note={report?.configLabel ? <>{t("Stored in")}{" "}<code>{report.configLabel}</code>.</> : undefined}>
      {linked.map((item) => (
        <Row key={item.path} label={<span className="set-folder-path" title={item.path}>{item.label}</span>} description={item.read ? t("Added here · ComfyUI reads it") : t("Added here · ComfyUI reads it after a restart")}>
          <button className="btn is-ghost" onClick={async () => {
            if (!await confirmAction({ title: t("Stop using {0}?", { "0": (item.label) }), description: t("ComfyUI stops reading this folder after its next restart."), action: t("Remove folder") })) return;
            folders.remove(item.path);
          }}>{t("Remove")}</button>
        </Row>
      ))}
      <Row
        label={stray ? <Status tone="warn">{stray}{t("model")}{stray === 1 ? '' : 's'}{t("found")}</Status> : t("Find models")}
        description={stray ? t("They’re in a folder ComfyUI doesn’t read.") : t("Searches other ComfyUI installs, shared folders and external drives.")}
      >
        <button className={cn('btn', stray > 0 && 'is-primary')} onClick={onOpen}><FolderSearch size={14} /> {stray ? t("Add") : t("Search")}</button>
      </Row>
      <SwitchRow
        label={t("Notify about unread model folders")}
        description={t("Shows a note in the sidebar and model menu when models are in a folder ComfyUI doesn’t read.")}
        checked={hints}
        onChange={onHintsChange}
      />
    </Group>
  );
}

function Status({ tone, children }: React.PropsWithChildren<{ tone?: 'ok' | 'bad' | 'warn' }>) {
  useLanguage();
  return <span className={cn('set-status', tone && `is-${tone}`)}><i aria-hidden="true" />{children}</span>;
}

/* ------------------------------------------------------------ Keyboard */

/** Every shortcut, folded away until asked for: the list is long and rarely needed here. */
function ShortcutsDrawer() {
  useLanguage();
  return (
    <SettingsDrawer id="set-shortcuts" title={t("Keyboard shortcuts")} description={<>{shortcuts.length} · <kbd className="set-kbd">?</kbd>{t("shows them anywhere")}</>}>
      <dl className="set-keys">
        {shortcuts.map(([keys, what]) => (
          <React.Fragment key={keys}>
            <dt><kbd className="set-kbd">{keys}</kbd></dt>
            <dd>{t(what)}</dd>
          </React.Fragment>
        ))}
      </dl>
    </SettingsDrawer>
  );
}

/* ------------------------------------------------------------ Restarts */

/** A plain restart button: its arrow turns while it works and becomes a check when it's back. */
function RestartButton({ what, busy, done, disabled, onClick }: { what: string; busy: boolean; done?: boolean; disabled?: boolean; onClick: () => void }) {
  useLanguage();
  return (
    <button type="button" className={cn('btn', done && 'is-done')} onClick={onClick} disabled={disabled || busy || done} aria-label={t("Restart {0}", { "0": (what) })} aria-live="polite">
      {done ? <Check size={14} /> : <RotateCw size={14} className={cn(busy && 'is-spinning')} />}
      {done ? t("Restarted") : busy ? t("Restarting…") : t("Restart")}
    </button>
  );
}

/**
 * Restarting ComfyUI (new nodes and files, freed memory) and HEISS UI itself,
 * as two ordinary rows like the rest of General.
 */
function RestartGroup({ confirmAction, onComfyBack, restartHeiss, heissRestarting, updateStatus }: {
  confirmAction: ConfirmAction;
  onComfyBack: () => void;
  restartHeiss: () => Promise<boolean>;
  heissRestarting: boolean;
  updateStatus: UpdateStatus | null;
}) {
  useLanguage();
  const comfy = useComfyRestart({
    onBack: onComfyBack,
    confirm: () => confirmAction({ title: t("Restart ComfyUI?"), description: t("Running and queued generations stop. It takes a few seconds."), action: t("Restart ComfyUI"), destructive: true })
  });
  const comfyBack = comfy.phase === 'back';
  const comfyLine = comfyBack ? restartResultLine(comfy.result)
    : comfy.busy ? (comfy.eta?.text || 'Usually back in a few seconds.')
    : comfy.phase === 'error' ? comfy.error
    : 'Loads new custom nodes and files, and frees memory.';

  // A release copy knows whether its launcher can bring it back; a checkout finds out on the first try.
  const [heissFailed, setHeissFailed] = React.useState(false);
  const unsupervised = Boolean(updateStatus?.release && updateStatus.supervised === false) || heissFailed;
  const restartApp = async () => {
    if (!await confirmAction({ title: t("Restart HEISS UI?"), description: t("Running generations stop and this page reloads."), action: t("Restart HEISS UI"), destructive: true })) return;
    if (!await restartHeiss()) setHeissFailed(true);
  };
  const heissLine = heissRestarting ? 'This page reloads when it’s done.'
    : unsupervised ? 'Started without its launcher, so it can’t restart from here. Quit it and start it again.'
    : 'Reloads the studio. Running generations stop.';

  return (
    <Group title={t("Restart")} note={comfy.off && comfy.info ? <ComfyManagerNote info={comfy.info} refresh={comfy.refresh} /> : undefined}>
      <Row label={t("ComfyUI")} description={comfyLine}>
        <RestartButton what="ComfyUI" busy={comfy.busy} done={comfyBack} disabled={comfy.off || comfy.info === null} onClick={comfy.restart} />
      </Row>
      <Row label={t("HEISS UI")} description={heissLine}>
        <RestartButton what="HEISS UI" busy={heissRestarting} disabled={unsupervised} onClick={restartApp} />
      </Row>
    </Group>
  );
}

/* ------------------------------------------------------------ Upscale */

/**
 * One line on where smart upscale stands. Anything that needs doing opens the
 * setup dialog, which owns installing nodes, downloading and verifying.
 */
function UpscaleReadiness({ status, reason, install, onOpenSetup, onDownload }: { status: UpscaleStatus | null; reason?: string; install: UpscaleInstall; onOpenSetup: () => void; onDownload: () => void }) {
  useLanguage();
  if (install?.status === 'running') {
    const ratio = install.totalBytes ? Math.min(1, (install.receivedBytes || 0) / install.totalBytes) : 0;
    return (
      <Row label={<Status tone="warn">{t("Downloading the model")}</Status>} description={t("{0} of {1}", { "0": (formatBytes(install.receivedBytes)), "1": (formatBytes(install.totalBytes)) })} stacked>
        <div className="set-progress"><div style={{ width: `${Math.round(ratio * 100)}%` }} /></div>
        <button className="btn" onClick={onOpenSetup}>{t("Show progress")}</button>
      </Row>
    );
  }
  if (!status) {
    return <Row label={<Status tone="warn">{t("Unavailable")}</Status>} description={reason || t("Smart upscale isn’t available right now.")}><button className="btn" onClick={onOpenSetup}>{t("Open setup")}</button></Row>;
  }
  if (!status.nodesInstalled) {
    return <Row label={<Status tone="warn">{t("Needs the SeedVR2 nodes")}</Status>} description={t("A one-time install of its ComfyUI nodes.")}><button className="btn is-primary" onClick={onOpenSetup}>{t("Set up")}</button></Row>;
  }
  if (install?.status === 'error' && !status.ready) {
    return <Row label={<Status tone="bad">{t("Download stopped")}</Status>} description={install.error}><button className="btn is-primary" onClick={onOpenSetup}>{t("Resume")}</button></Row>;
  }
  if (status.needsDownload) {
    return <Row label={<Status tone="warn">{t("Needs a download")}</Status>} description={t("{0} of SeedVR2 weights, downloaded once.", { "0": (formatBytes(status.downloadBytes)) })}><button className="btn is-primary" onClick={onOpenSetup}>{t("Set up")}</button></Row>;
  }
  if (status.substituting) {
    const effort = upscaleQualityLabel(status.quality);
    const scale = upscaleEfforts.find((item) => item.value === status.quality)?.scale;
    return (
      <Row
        label={<Status tone="warn">{t("Download needed")}</Status>}
        description={t("{0} still upscales{1} with a model you already have, so results can look different. Download its own model for the best quality.", { "0": (effort), "1": (scale ? ` at ${scale}` : t("")) })}
        stacked
      >
        <button className="btn is-primary" onClick={onDownload}>{t("Download")}{" "}{effort} · {formatBytes(status.downloadBytes)}</button>
      </Row>
    );
  }
  return <Row label={<Status tone="ok">{t("Ready")}</Status>} description={t("Hover a finished image and click the arrow in its top-left corner.")} />;
}

/** Smart upscale's state in a word or two, for its drawer. */
function upscaleSummary(status: UpscaleStatus | null, install: UpscaleInstall) {
  if (install?.status === 'running') return { label: t("downloading") };
  if (!status) return { label: t("unavailable") };
  if (!status.nodesInstalled || status.needsDownload) return { label: t("needs setup") };
  if (install?.status === 'error' && !status.ready) return { label: t("download stopped") };
  if (status.substituting) return { label: t("download needed") };
  return { label: t("ready") };
}

const profileName = (profile: Profile) => profile.displayName || profile.label;

/** Models as small chips with their family, the first few shown and the rest a tap away. */
function ModelChips({ profiles, limit = 8 }: { profiles: Profile[]; limit?: number }) {
  useLanguage();
  const [all, setAll] = React.useState(false);
  const unique = profiles.filter((profile, index) => profiles.findIndex((other) => profileName(other) === profileName(profile)) === index);
  const shown = all ? unique : unique.slice(0, limit);
  return (
    <ul className="set-chips" aria-label={t("Models")}>
      {shown.map((profile) => (
        <li key={profile.id} className="set-chip" title={profileName(profile)}>
          <span>{profileName(profile)}</span>
          {profile.familyName ? <small>{profile.familyName}</small> : null}
        </li>
      ))}
      {unique.length > limit ? (
        <li><button type="button" className="set-chip is-more" onClick={() => setAll((value) => !value)}>{all ? t("Fewer") : t("+{0} more", { "0": (unique.length - limit) })}</button></li>
      ) : null}
    </ul>
  );
}

/** No model can inpaint yet: the starter models can, and the studio downloads them. */
function InpaintSuggestions({ onGetModels }: { onGetModels?: () => void }) {
  useLanguage();
  const { plan } = useStarterPlan();
  const families = plan?.families || [];
  return (
    <Row label={t("Models that can inpaint")} description={onGetModels ? t("Each downloads in the studio with its text encoder and VAE.") : t("Get one on the computer running HEISS UI.")} stacked>
      <div className="set-suggest">
        <ul className="set-chips" aria-label={t("Suggested models")}>
          {families.length ? families.map((family) => (
            <li key={family.family} className="set-chip is-suggest" title={family.blurb || undefined}><span>{family.title}</span></li>
          )) : <li><Skeleton className="skeleton-text short" /></li>}
        </ul>
        {onGetModels ? <button className="btn is-primary" onClick={onGetModels}><Download size={14} />{t("Get a model")}</button> : null}
      </div>
    </Row>
  );
}

/* ------------------------------------------------------------ Updates */

/**
 * A release copy: download the new release, then restart into it. Each stage
 * says what happens next, and a rolled-back update says so plainly.
 */
function ReleaseUpdateRow({ status, busy, restarting, checking, onCheck, onInstall, onRestart }: {
  status: UpdateStatus;
  busy: boolean;
  restarting: boolean;
  checking: boolean;
  onCheck: () => void;
  onInstall: () => void;
  onRestart: () => void;
}) {
  useLanguage();
  const download = status.download;
  const latest = status.latest || download?.version || '';
  const notes = status.url ? <a className="btn is-ghost" href={status.url} target="_blank" rel="noreferrer"><ExternalLink size={13} />{t("What's new")}</a> : null;
  const check = (
    <MosaicButton busy={checking} disabled={checking || busy} onClick={onCheck}>
      {checking ? t("Checking for updates…") : status.ok && !status.available ? t("Up to date · check again") : t("Check for updates")}
    </MosaicButton>
  );
  const result = status.result;
  const resultRow = result && !result.ok ? (
    <Row
      label={<Status tone="bad">{result.rolledBack ? t("{0} didn’t start", { "0": (result.to) }) : t("The last update didn’t install")}</Status>}
      description={result.rolledBack ? t("Still on {0}.{1}", { "0": (result.from), "1": (result.error ? ` ${result.error}` : t("")) }) : result.error}
    />
  ) : null;

  if (restarting) {
    return <Row label={<Status tone="warn">{download?.status === 'ready' ? t("Restarting into {0}", { "0": (latest) }) : t("Restarting")}</Status>} description={t("This page reloads when it’s done.")} />;
  }
  if (download?.status === 'downloading' || download?.status === 'verifying' || download?.status === 'unpacking') {
    const ratio = download.totalBytes ? Math.min(1, (download.receivedBytes || 0) / download.totalBytes) : 0;
    return (
      <Row
        label={<Status tone="warn">{download.status === 'downloading' ? t("Downloading {0}", { "0": (latest) }) : t("Checking the download")}</Status>}
        description={download.status === 'downloading' ? t("{0} of {1}. You can keep working.", { "0": (formatBytes(download.receivedBytes)), "1": (formatBytes(download.totalBytes)) }) : t("Checking and unpacking.")}
        stacked
      >
        <div className="set-progress"><div style={{ width: `${Math.round((download.status === 'downloading' ? ratio : 1) * 100)}%` }} /></div>
      </Row>
    );
  }
  if (download?.status === 'ready') {
    return (
      <Row
        label={<Status tone="ok">{latest}{t("is ready to install")}</Status>}
        description={status.supervised ? t("Running generations stop when HEISS UI restarts.") : t("Quit HEISS UI and open it again to finish.")}
        stacked
      >
        <div className="about-update">
          {status.supervised ? <button className="btn is-primary" onClick={onRestart}>{t("Restart now")}</button> : null}
          {notes}
        </div>
      </Row>
    );
  }
  if (status.available) {
    return (
      <>
        {resultRow}
        <Row
          label={<Status tone="warn">{t("HEISS UI")}{" "}{latest}{t("is available")}</Status>}
          description={download?.status === 'error'
            ? t("The download stopped: {0}", { "0": (download.error) })
            : status.canInstall
              ? t("You have {0}.{1} Installs on restart.", { "0": (status.current), "1": (status.size ? ` ${formatBytes(status.size)}.` : t("")) })
              : status.unsigned
                ? t("You have {0}. This release can’t be verified, so it won’t install from here. Download it yourself only if you trust the source.", { "0": (status.current) })
                : t("You have {0}. Download this release, replace this folder with it and keep your data folder.", { "0": (status.current) })}
          stacked
        >
          <div className="about-update">
            {status.canInstall
              ? <button className="btn is-primary" onClick={onInstall} disabled={busy}>{download?.status === 'error' ? t("Try again") : t("Install update")}</button>
              : status.url ? <a className="btn is-primary" href={status.url} target="_blank" rel="noreferrer"><ExternalLink size={13} />{t("Download")}</a> : null}
            {notes}
            {check}
          </div>
        </Row>
      </>
    );
  }
  return (
    <>
      {resultRow}
      <Row
        label={<Status tone={status.error ? 'bad' : status.ok ? 'ok' : undefined}>{status.error || (result?.ok && result.to ? t("Updated to {0}", { "0": (result.to) }) : status.ok ? t("Up to date") : t("Not checked yet"))}</Status>}
        description={status.current ? t("HEISS UI {0}. Checks GitHub for a newer release.", { "0": (status.current) }) : t("Checks GitHub for a newer release.")}
        stacked
      >
        <div className="about-update">{check}</div>
      </Row>
    </>
  );
}

/* ------------------------------------------------------------ Help */

/** About › Help: where the common fixes are, and the setup lines a bug report needs. */
function HelpGroup({ copyToClipboard }: { copyToClipboard: (text: string) => Promise<boolean> }) {
  useLanguage();
  const copy = useCopyFeedback();
  // Asks ComfyUI too, so it waits until the page has settled.
  React.useEffect(() => {
    const idle = window.requestIdleCallback?.(() => void loadDiagnostics(), { timeout: 2000 });
    const timer = idle === undefined ? window.setTimeout(() => void loadDiagnostics(), 800) : 0;
    return () => { if (idle !== undefined) window.cancelIdleCallback(idle); window.clearTimeout(timer); };
  }, []);
  const copyDiagnostics = async () => {
    const text = knownDiagnostics() || await loadDiagnostics();
    return text ? copyToClipboard(text) : false;
  };
  return (
    <Group title={t("Help")}>
      <Row label={t("Troubleshooting")} description={t("Common errors and how to fix them.")}>
        <a className="btn is-ghost" href={troubleshootingUrl()} target="_blank" rel="noreferrer"><LifeBuoy size={13} />{t("Open")}</a>
      </Row>
      <Row label={t("Copy diagnostics")} description={t("HEISS UI, ComfyUI and Node.js versions, system and GPU, for a bug report. Prompts, images and file names aren’t included.")}>
        <button className="btn" onClick={() => copy.copyWith(copyDiagnostics)}><CopyIcon copied={Boolean(copy.copied)} /> {copy.copied ? t("Copied") : t("Copy")}</button>
      </Row>
    </Group>
  );
}

/* ------------------------------------------------------------ Output folder */

const fileCount = (report: OutputFolderReport) => {
  const count = report.media || 0;
  return `${new Intl.NumberFormat().format(count)}${report.capped ? '+' : ''} file${count === 1 && !report.capped ? '' : 's'}`;
};

/** One sentence per state, always saying what it means for the gallery. */
function describeFolder(report: OutputFolderReport | null): { tone?: 'ok' | 'warn' | 'bad'; label: string; detail: string } {
  if (!report) return { label: t("Checking…"), detail: '' };
  switch (report.state) {
    case 'empty': return { tone: 'warn', label: t("Not set"), detail: t("Needed to delete files and to remove ComfyUI’s copies of hidden images.") };
    case 'missing': return { tone: 'bad', label: t("Folder not found"), detail: t("There’s nothing at that path on this computer.") };
    case 'not-folder': return { tone: 'bad', label: t("Not a folder"), detail: t("That path points at a file.") };
    case 'mismatch': return { tone: 'warn', label: t("Recent images aren’t here"), detail: t("None of the last {0} images are in this folder ({1}). ComfyUI probably saves somewhere else; try Find automatically.", { "0": (report.checked), "1": (fileCount(report)) }) };
    case 'match': return { tone: 'ok', label: t("Linked"), detail: t("{0} recent images found here · {1}", { "0": (report.found === report.checked ? `All ${report.checked}` : `${report.found} of ${report.checked}`), "1": (fileCount(report)) }) };
    default: return { tone: report.looksLikeComfy ? 'ok' : 'warn', label: report.looksLikeComfy ? 'Linked' : 'Set', detail: t("{0}{1}. Checked again after the next image.", { "0": (fileCount(report)), "1": (report.looksLikeComfy ? t("") : t(" · doesn’t look like a ComfyUI output folder")) }) };
  }
}

function OutputFolderRow({ savedDir, galleryNote, onSave, onOpen, onCopy, showToast }: {
  savedDir: string;
  galleryNote?: string;
  onSave: (dir: string) => Promise<OutputFolderReport | null>;
  onOpen: () => void;
  onCopy: (dir: string) => Promise<boolean>;
  showToast: ShowToast;
}) {
  useLanguage();
  const pathCopy = useCopyFeedback();
  const [report, setReport] = React.useState<OutputFolderReport | null>(null);
  const [canBrowse, setCanBrowse] = React.useState(false);
  const [draft, setDraft] = React.useState(savedDir);
  const [draftReport, setDraftReport] = React.useState<OutputFolderReport | null>(null);
  const [busy, setBusy] = React.useState<'' | 'browse' | 'detect' | 'save'>('');
  const [candidates, setCandidates] = React.useState<OutputFolderReport[] | null>(null);

  const refresh = React.useCallback(() => {
    apiJson<{ outputDir: string; report: OutputFolderReport; canBrowse: boolean }>('/api/output-dir')
      .then((data) => { setReport(data.report); setCanBrowse(data.canBrowse); setDraft(data.outputDir || ''); })
      .catch(() => setReport({ path: savedDir, state: savedDir ? 'ok' : 'empty' }));
  }, [savedDir]);
  React.useEffect(refresh, [refresh]);

  // Check the typed path as it settles, so problems show before Save.
  const dirty = draft.trim() !== '' && draft.trim() !== (report?.path || savedDir);
  React.useEffect(() => {
    if (!dirty) { setDraftReport(null); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      apiJson<OutputFolderReport>('/api/output-dir/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outputDir: draft }), signal: controller.signal })
        .then(setDraftReport)
        .catch(() => null);
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [draft, dirty]);

  const save = async (dir: string) => {
    setBusy('save');
    const next = await onSave(dir);
    setBusy('');
    if (!next) return;
    setReport(next);
    setDraft(next.path);
    setDraftReport(null);
    setCandidates(null);
  };

  const browse = async () => {
    setBusy('browse');
    try {
      const data = await apiJson<{ path?: string; canceled?: boolean }>('/api/output-dir/browse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ start: draft || savedDir }) });
      setBusy('');
      if (data.path) await save(data.path);
    } catch (error) {
      setBusy('');
      showToast(error instanceof Error ? error.message : 'Couldn’t open the folder picker', 'error');
    }
  };

  const detect = async () => {
    setBusy('detect');
    try {
      const data = await apiJson<{ candidates: OutputFolderReport[] }>('/api/output-dir/detect');
      const list = data.candidates.filter((item) => item.path !== report?.path);
      if (!list.length) showToast(report?.state === 'match' ? 'This is already the right folder' : 'No output folder found. Is ComfyUI running?', report?.state === 'match' ? 'success' : 'error');
      setCandidates(list.length ? list : null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Couldn’t search for the output folder', 'error');
    } finally {
      setBusy('');
    }
  };

  const shown = describeFolder(dirty ? draftReport : report);
  const draftBlocked = dirty && (!draftReport || draftReport.state === 'missing' || draftReport.state === 'not-folder');
  const hasSaved = Boolean(report?.path && report.state !== 'missing');

  // Searching is for when the folder isn't the one ComfyUI uses; once it is, it's noise.
  const needsSearch = !dirty && report && report.state !== 'match';
  return (
    <Row
      label={<span className="set-folder-title">{t("Output folder")}<Status tone={shown.tone}>{dirty ? t("New path: {0}", { "0": (shown.label.toLowerCase()) }) : shown.label}</Status></span>}
      description={<span aria-live="polite">{shown.detail || galleryNote}</span>}
      stacked
    >
      <form className="set-inline-form set-folder-form" onSubmit={(event) => { event.preventDefault(); if (dirty && !draftBlocked) save(draft); }}>
        <div className="set-folder-field">
          <input
            className="modal-input set-path-input"
            aria-label={t("Output folder")}
            value={draft}
            placeholder={canBrowse ? t("Paste a path, or browse") : t("Paste the full folder path")}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape' && dirty) { event.stopPropagation(); setDraft(report?.path || savedDir); } }}
          />
          {!dirty && hasSaved ? (
            <span className="set-folder-tools">
              <Tip content={t("Open in the file manager")}><button type="button" className="set-folder-tool" aria-label={t("Open the output folder")} onClick={onOpen}><FolderOpen size={14} /></button></Tip>
              <Tip content={pathCopy.copied ? t("Copied") : t("Copy path")}><button type="button" className="set-folder-tool" aria-label={t("Copy the path")} onClick={() => pathCopy.copyWith(() => onCopy(report?.path || savedDir))}><CopyIcon copied={Boolean(pathCopy.copied)} /></button></Tip>
            </span>
          ) : null}
        </div>
        {dirty
          ? <button className="btn is-primary" type="submit" disabled={draftBlocked || busy === 'save'}>{t("Save")}</button>
          : canBrowse ? <button className="btn" type="button" onClick={browse} disabled={Boolean(busy)}><FolderSearch size={14} /> {busy === 'browse' ? t("Waiting…") : t("Browse…")}</button> : null}
      </form>
      {candidates ? (
        <div className="set-folder-picks" role="list" aria-label={t("Folders found")}>
          {candidates.map((item) => (
            <button key={item.path} type="button" role="listitem" className="set-folder-pick" onClick={() => save(item.path)} disabled={busy === 'save'}>
              <code className="set-path">{item.path}</code>
              <span>
                {item.source === 'comfy' ? t("From ComfyUI · ") : ''}
                {item.state === 'match' ? t("{0} of {1} recent images here", { "0": (item.found), "1": (item.checked) }) : item.state === 'mismatch' ? t("Recent images aren’t here") : fileCount(item)}
              </span>
              {item.state === 'match' ? <Check size={14} className="set-folder-pick-mark" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
      {needsSearch ? (
        <div className="set-actions">
          <button className="btn is-ghost" onClick={detect} disabled={Boolean(busy)}><ScanSearch size={14} /> {busy === 'detect' ? t("Searching…") : t("Find automatically")}</button>
        </div>
      ) : null}
    </Row>
  );
}

type StudioStats = {
  outputs: number; images: number; videos: number; upscales: number; renderMs: number; megapixels: number;
  firstAt: string; activeDays: number; currentStreak: number; longestStreak: number;
  busiestDay: string; busiestCount: number; topWorkflow: string; topWorkflowCount: number;
};

type AboutData = { stats: StudioStats; version: string; sinceRelease: { tag: string; commits: number } | null };
let aboutCache: AboutData | null = null;

const compact = (value: number) => new Intl.NumberFormat(undefined, { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value || 0);

function formatDuration(ms: number) {
  const minutes = Math.round((ms || 0) / 60000);
  if (minutes < 1) return `${Math.round((ms || 0) / 1000)}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 100 ? `${hours}h ${minutes % 60}m` : `${compact(hours)}h`;
}

function formatDay(value: string) {
  if (!value) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

/* ------------------------------------------------------------ Dialog */

export function SettingsDialog({ view, open, section, onSectionChange, onClose, onGetModels }: { view: Record<string, any>; open: boolean; section: SettingsSection; onSectionChange: (section: SettingsSection) => void; onClose: () => void; onGetModels?: () => void }) {
  const language = useLanguage();
  const {
    prefs, setPrefs,
    upscaleStatus, upscaleUnavailableReason, upscaleInstall, upscaleSetup,
    gallery, galleryLoaded, paths, saveOutputDirectory, openOutputFolder, copyToClipboard, showToast,
    clearFailedItems, clearGallery, clearAllCache, resetAllSettings, confirmAction,
    hidden,
    health, refreshHealth, models, refreshModels, refreshWorkflows, modelFolders,
    updateStatus, updateBusy, checkForUpdates, installUpdate, restartForUpdate, restartHeiss, restarting, setUpdatePrefs, refreshUpdateStatus, workflows, modelProfiles
  } = view;
  const current = SETTINGS_SECTIONS.find((item) => item.id === section) || SETTINGS_SECTIONS[0];

  // Models nothing picked up, plus the ones you assigned by hand so they can be undone.
  const modelList = models as Models | null;
  // Models nothing picked up, ones still missing a part, and ones you assigned by hand (so they can be undone).
  const typedModels = (modelList?.modelFiles || []).filter((file) => !file.supported || file.via === 'choice' || (file.missing?.length || 0) > 0);
  const [typeBusy, setTypeBusy] = React.useState('');
  const setModelType = async (file: ModelFile, type: string) => {
    const key = `${file.source}:${file.name}`;
    setTypeBusy(key);
    try {
      await apiJson('/api/models/types', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: file.source, name: file.name, type: type === 'auto' ? '' : type })
      });
      refreshModels(false);
      refreshWorkflows();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Couldn’t save the model type', 'error');
    } finally {
      setTypeBusy('');
    }
  };

  // About: stats come from the local gallery; the update check always runs long
  // enough for the mosaic button to show its burn.
  // Kept between opens, and fetched as soon as Settings opens, so About draws filled in.
  const [about, setAbout] = React.useState<AboutData | null>(aboutCache);
  const { stats = null, version: appVersion = '', sinceRelease = null } = about || {};
  const [checking, setChecking] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    let live = true;
    fetch('/api/stats').then((response) => response.ok ? response.json() : null).then((data) => {
      if (!live || !data?.stats) return;
      aboutCache = { stats: data.stats, version: data.version || '', sinceRelease: data.sinceRelease || null };
      setAbout(aboutCache);
    }).catch(() => null);
    return () => { live = false; };
  }, [open, section === 'about']); // eslint-disable-line react-hooks/exhaustive-deps
  const topWorkflowName = stats?.topWorkflow
    ? (workflows || []).find((item: { profileId: string; name: string }) => item.profileId === stats.topWorkflow)?.name
      || (modelProfiles || []).find((item: { id: string; displayName?: string; label?: string }) => item.id === stats.topWorkflow)?.displayName
      || stats.topWorkflow.replace(/^custom:/, '')
    : '';
  // Opened before the automatic check answered: ask now (quietly, from the
  // server's cache when it has one), so the row doesn't change shape later.
  React.useEffect(() => {
    if (open && section === 'about' && !updateStatus) refreshUpdateStatus?.();
  }, [open, section]); // eslint-disable-line react-hooks/exhaustive-deps
  const runUpdateCheck = async () => {
    const started = performance.now();
    setChecking(true);
    try { await checkForUpdates(false); } finally {
      window.setTimeout(() => setChecking(false), Math.max(0, 1600 - (performance.now() - started)));
    }
  };


  const upscaleOn = prefs.smartUpscale !== false;
  const upscaleState = upscaleSummary(upscaleStatus, upscaleInstall);
  // Inpainting ships behind a release switch; while it's off its group stays away.
  const inpaintReleased = Boolean((models as Models | null)?.features?.inpainting);
  const inpaintModels = ((modelProfiles || []) as Profile[]).filter((profile) => profile.capabilities?.inpaint);
  const inpaintOn = prefs.inpainting !== false;
  const effort = upscaleEfforts.find((item) => item.value === (prefs.upscaleQuality || 'balanced')) || upscaleEfforts[1];
  const faceDetailReady = Boolean(upscaleStatus?.faceDetail?.nodesInstalled);
  const connected = Boolean(health?.ok);
  const comfyRestarting = useComfyRestarting();
  const restartEta = useComfyRestartEta();
  // Folders, models, updates and wiping the gallery are looked after at the computer itself.
  const thisComputer = useThisComputer();
  // Earlier images opens a folder picker on the computer itself; the server takes it from nowhere else.
  const atComputer = useAtComputer();
  const phoneDevice = usePhone();
  const updateLabel = updateStatus?.error || (updateStatus?.available ? `${updateStatus.behind || 1} update${updateStatus.behind === 1 ? '' : 's'} available` : updateStatus?.ok ? 'Up to date' : 'Not checked yet');

  // On phones the section row scrolls sideways; keep the chosen one in view.
  React.useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const item = document.querySelector<HTMLElement>(`.set-nav [data-section="${section}"]`);
      const nav = item?.parentElement;
      if (!item || !nav || nav.scrollWidth <= nav.clientWidth) return;
      nav.scrollTo({ left: Math.max(0, item.offsetLeft - (nav.clientWidth - item.offsetWidth) / 2), behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, section]);

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) onClose(); }} size="sheet" className="settings-modal" bodyClassName="set-layout" title={t("Settings")}>
      <nav className="set-nav" aria-label={t("Settings sections")}>
        {SETTINGS_SECTIONS.filter((item) => thisComputer || item.id !== 'models').map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} type="button" className={cn('set-nav-item', section === item.id && 'active')} aria-current={section === item.id ? 'page' : undefined} aria-controls="settings-panel" data-section={item.id} onClick={() => onSectionChange(item.id)}>
              <Icon size={15} />
              <span>{t(item.label)}</span>
            </button>
          );
        })}
        <a className="set-nav-discord" href={discordUrl} target="_blank" rel="noreferrer">
          <DiscordIcon size={13} />
          <span>{t("Join the Discord")}</span>
        </a>
        <button type="button" className="set-nav-feedback" onClick={() => openFeedback({ from: 'settings' })}>
          <strong>{t("Idea or bug?")}</strong>
          <span>{t("Send it to the board")}</span>
        </button>
      </nav>

      {/* A region named by its heading, so a screen reader hears where it landed. */}
      <div className="set-panel" key={section} id="settings-panel" role="region" aria-labelledby="settings-panel-title">
        <header className="set-page-head">
          <h3 id="settings-panel-title">{t(current.label)}</h3>
          <p>{t(current.description)}</p>
        </header>

        {section === 'general' ? (
          <>
            <Group title={t('Language')}>
              <Row label={t('Interface language')} description={t('Changes labels and help text only. Your prompts, model names and workflow values stay unchanged.')}>
                <StudioSelect value={language} onChange={setLanguage} options={[...languages]} label={t('Interface language')} />
              </Row>
            </Group>
            {phoneDevice || prefs.fullStudioOnPhone ? <Group title={t("Layout")}>
              <SwitchRow label={t("Simple phone studio")} description={t("A simpler layout for making, browsing and sharing. Everything else stays on the computer.")} checked={!prefs.fullStudioOnPhone} onChange={(next) => setPrefs({ fullStudioOnPhone: !next })} />
            </Group> : null}
            <Group title={t("Keyboard")} note={t("Shortcuts pause while you type in a field, except the ones that send the prompt.")}>
              <ShortcutsDrawer />
            </Group>
            <Group title={t("Safety")}>
              <SwitchRow label={t("Confirm before removing things")} description={t("Asks before deleting or stopping something. Permanent deletes always ask.")} checked={prefs.confirmActions} onChange={(next) => setPrefs({ confirmActions: next })} />
            </Group>
            <Group title={t("Reset")} tone="danger">
              {thisComputer ? (
                <>
                  <Row label={t("Delete all finished images")} description={t("Moves their files to the trash for 30 days, then deletes them. Hidden isn’t affected.")}>
                    <button className="btn is-danger-soft" onClick={clearGallery}>{t("Delete all")}</button>
                  </Row>
                  <Row label={t("Clear all cache")} description={t("Clears the browser cache, stale queue state and ComfyUI’s memory.")}>
                    <button className="btn is-danger-soft" onClick={clearAllCache}>{t("Clear cache")}</button>
                  </Row>
                </>
              ) : null}
              <Row label={t("Reset all settings")} description={t("Resets prompts, layout, model choices, LoRA stacks and every preference here.")}>
                <button className="btn is-danger-soft" onClick={resetAllSettings}>{t("Reset")}</button>
              </Row>
            </Group>
          </>
        ) : null}

        {section === 'generation' ? (
          <>
            <Group title={t("Composer")}>
              <SwitchRow label={t("Enter to generate")} description={t("Press Enter to generate and Shift+Enter for a new line.")} checked={prefs.enterToGenerate} onChange={(next) => setPrefs({ enterToGenerate: next })} />
              <Row label={t("Run variants as")} description={prefs.variationQueueMode === 'separate' ? t("One job per variant. Easier to cancel one at a time.") : t("One ComfyUI job with a larger batch. Usually faster.")}>
                <Segmented label={t("Run variants as")} value={prefs.variationQueueMode === 'separate' ? 'separate' : 'batch'} onChange={(next) => setPrefs({ variationQueueMode: next })} options={[{ value: 'batch', label: t("One batch") }, { value: 'separate', label: t("Separate jobs") }]} />
              </Row>
              <PromptHistoryRow Row={Row} Switch={Switch} showToast={showToast} confirmAction={confirmAction} />
              <SwitchRow label={t("Size in megapixels")} description={prefs.megapixelSizing ? t("The size menu has a Megapixels field in place of 2K. Every shape is drawn at the count you set.") : t("Set a megapixel count in the size menu instead of choosing 2K.")} checked={Boolean(prefs.megapixelSizing)} onChange={(next) => setPrefs({ megapixelSizing: next })} />
            </Group>
            <Group title={t("Previews")}>
              <Row label={t("While generating")} description={prefs.generationPreviewMode === 'simple' ? t("Each sampler step as it arrives. Lighter on the GPU.") : t("Early steps show as an animated pixel mosaic. With reduced motion on, Simple is used.")}>
                <Segmented label={t("Generation previews")} value={prefs.generationPreviewMode === 'simple' ? 'simple' : 'advanced'} onChange={(next) => setPrefs({ generationPreviewMode: next })} options={[{ value: 'advanced', label: t("Mosaic") }, { value: 'simple', label: t("Simple") }]} />
              </Row>
            </Group>
            <Group title={t("Input images")}>
              <SwitchRow label={t("Automatically resize input images")} description={t("Fits large start and reference images to the generation size. Keeps their proportions and your originals.")} checked={prefs.autoResizeInputs !== false} onChange={(next) => setPrefs({ autoResizeInputs: next })} />
            </Group>
            <Group title={t("Starting values")} note={t("Used when a model doesn’t set its own. The current draft stays as it is.")}>
              <Row label={t("Variants")}><NumberPicker label={t("Variants")} value={Number(prefs.defaultImageCount)} onChange={(next) => setPrefs({ defaultImageCount: next })} min={1} max={16} /></Row>
              <Row label={t("Image steps")}><NumberPicker label={t("Steps")} value={Number(prefs.defaultImageSteps)} onChange={(next) => setPrefs({ defaultImageSteps: next })} min={1} max={150} /></Row>
              <Row label={t("Video steps")}><NumberPicker label={t("Steps")} value={Number(prefs.defaultVideoSteps)} onChange={(next) => setPrefs({ defaultVideoSteps: next })} min={1} max={150} /></Row>
              <Row label={t("Video frames")}><NumberPicker label={t("Frames")} value={Number(prefs.defaultVideoFrames)} onChange={(next) => setPrefs({ defaultVideoFrames: next })} min={1} max={1000} step={4} /></Row>
              <Row label={t("Video FPS")}><NumberPicker label={t("FPS")} value={Number(prefs.defaultFps)} onChange={(next) => setPrefs({ defaultFps: next })} min={1} max={60} /></Row>
            </Group>
          </>
        ) : null}

        {section === 'features' ? (
          <>
          <Group>
            <SettingsDrawer id="set-feature-upscale" title={t("Smart upscale")} description={upscaleOn ? t("On · {0}", { "0": (upscaleState.label) }) : t("Off")}>
              <SwitchRow label={t("Smart upscale")} description={t("Shows an upscale arrow on finished images. The larger, sharper copy is saved next to the original.")} checked={upscaleOn} onChange={(next) => setPrefs({ smartUpscale: next })} />
              {upscaleOn ? (
                <>
                  <Row label={t("Effort")} description={effort.detail}>
                    <Segmented label={t("Upscale effort")} value={effort.value} onChange={(next) => setPrefs({ upscaleQuality: next })} options={upscaleEfforts.map(({ value, label, scale }) => ({ value, label: `${label} ${scale}` }))} />
                  </Row>
                  <SwitchRow
                    label={t("Face detail pass")}
                    tag={<BetaTag />}
                    description={faceDetailReady
                      ? t("Redraws small faces before the upscale. Close-ups are left as they are.")
                      : t("Redraws small faces before the upscale. Needs the Impact Pack and Impact Subpack nodes.")}
                    checked={Boolean(prefs.upscaleFaceDetail) && faceDetailReady}
                    disabled={!faceDetailReady}
                    onChange={(next) => setPrefs({ upscaleFaceDetail: next })}
                  />
                  {!faceDetailReady && upscaleStatus?.faceDetail?.setup?.length ? upscaleStatus.faceDetail.setup.map((setup: NonNullable<NonNullable<typeof upscaleStatus.faceDetail.setup>>[number]) => (
                    <div className="set-node-install" key={setup.pack.name}>
                      <NodeInstall pack={setup.pack} plan={setup} managerHint={setup.manager} autoInstall={setup.autoInstall} showToast={showToast} onRestarted={() => view.refreshUpscaleStatus?.()} afterRestart={t("Then the face pass can be turned on here.")} />
                    </div>
                  )) : null}
                  <UpscaleReadiness status={upscaleStatus} reason={upscaleUnavailableReason} install={upscaleInstall} onOpenSetup={() => upscaleSetup.openSetup()} onDownload={() => upscaleSetup.openSetup(null, { download: true })} />
                </>
              ) : null}
            </SettingsDrawer>
          </Group>

          {inpaintReleased ? (
            <Group>
              <SettingsDrawer id="set-feature-inpaint" title={<>{t("Inpainting")}<BetaTag /></>} description={!inpaintOn ? t("Off") : inpaintModels.length ? t("On · {0} of your models can", { "0": (inpaintModels.length) }) : t("On · no model can yet")}>
                <SwitchRow label={t("Inpainting")} description={t("A brush in a start or reference image’s menu: paint over part of it and only that part changes. Off hides the brush everywhere.")} checked={inpaintOn} onChange={(next) => setPrefs({ inpainting: next })} />
                {inpaintOn ? (
                  <>
                    {inpaintModels.length ? (
                      <Row label={t("Your models that can inpaint")} stacked>
                        <ModelChips profiles={inpaintModels} />
                      </Row>
                    ) : (
                      <InpaintSuggestions onGetModels={onGetModels} />
                    )}
                    <Row label={t("Strength and edge softness")} description={t("While a painted image is in the prompt bar, both are in {0}. Strength is there for models that take a start image.", { "0": (phoneDevice ? t("the Advanced sheet") : t("the sidebar’s Basics, under the image")) })} />
                    <InpaintDemo />
                  </>
                ) : null}
              </SettingsDrawer>
            </Group>
          ) : null}
          </>
        ) : null}

        {section === 'library' ? (
          <>
            {thisComputer ? <Group title={t("Folders")}>
              <OutputFolderRow
                savedDir={paths.outputDir || ''}
                galleryNote={galleryLoaded ? `${gallery.length} item${gallery.length === 1 ? '' : 's'} in the gallery` : undefined}
                onSave={saveOutputDirectory}
                onOpen={openOutputFolder}
                onCopy={(dir) => copyToClipboard(dir)}
                showToast={showToast}
              />
              <Row label={t("Workflows folder")} description={paths.workflowsDir ? <code className="set-path is-oneline" title={paths.workflowsDir}><bdi>{paths.workflowsDir}</bdi></code> : <Skeleton className="skeleton-text path" />}>
                <button className="btn is-ghost" onClick={() => { refreshModels(); refreshWorkflows(); }}><RefreshCw size={14} />{t("Rescan")}</button>
              </Row>
            </Group> : null}
            <Group title={t("Gallery")}>
              <SwitchRow label={t("Follow the latest output")} description={t("Shows each new image as it finishes.")} checked={prefs.followLatest} onChange={(next) => setPrefs({ followLatest: next })} />
              {features.moments ? <SwitchRow label={t("Group by time")} description={t("Headings like “This evening” split the gallery by when you made things.")} checked={prefs.showMoments !== false} onChange={(next) => setPrefs({ showMoments: next })} /> : null}
              <SwitchRow label={t("Wide images take two columns")} description={t("Landscape images span two columns when there are three or more.")} checked={Boolean(prefs.spanWideImages)} onChange={(next) => setPrefs({ spanWideImages: next })} />
              <SwitchRow label={t("Show failed items")} description={t("Interrupted and failed generations stay in the gallery.")} checked={prefs.showFailedItems} onChange={(next) => setPrefs({ showFailedItems: next })} />
            </Group>
            <Group title={t("Auto-grouping")} note={t("Similar generations group themselves into a stack, found by prompt, model and time. The button next to search switches this too.")}>
              <SwitchRow label={t("Auto-grouping")} description={t("Pictures from similar prompts fold into one tile that opens to show all of them.")} checked={Boolean(prefs.stackRuns)} onChange={(next) => setPrefs({ stackRuns: next })} />
              {prefs.stackRuns ? (
                <Row label={t("Stacks look like")} description={prefs.runStackStyle === 'flow' ? t("A cover flow of the run inside one card.") : t("The newest image, with two edges under it.")}>
                  <Segmented
                    label={t("Stacks look like")}
                    value={prefs.runStackStyle === 'flow' ? 'flow' : 'burst'}
                    onChange={(next) => setPrefs({ runStackStyle: next })}
                    options={[
                      { value: 'burst', label: <><RunStyleGlyph kind="burst" />{t("Photo")}</> },
                      { value: 'flow', label: <><RunStyleGlyph kind="flow" />{t("Cover flow")}</> },
                    ]}
                  />
                </Row>
              ) : null}
            </Group>
            {atComputer ? <EarlierImagesGroup Group={Group} Row={Row} showToast={showToast} confirmAction={confirmAction} outputDir={paths.outputDir || ''} /> : null}
            <Group title={t("Sharing")}>
              <SwitchRow label={t("Share without settings")} description={t("Leaves the prompt, seed and workflow out of downloaded and shared files. The gallery’s own files keep them.")} checked={prefs.shareWithoutSettings === true} onChange={(next) => setPrefs({ shareWithoutSettings: next })} />
              <Row label={t("Export gallery")} description={t("Every finished image in one ZIP file. Hidden has its own export.")}>
                <a className="btn" href="/api/gallery/export" download><Download size={14} />{t("Export")}</a>
              </Row>
              <CivitaiRow Row={Row} Switch={Switch} showToast={showToast} canChange={thisComputer} />
            </Group>
            <Group title={t("Clean up")}>
              <Row label={t("Clear failed items")} description={t("Removes failed and interrupted cards.")}>
                <button className="btn" onClick={clearFailedItems}>{t("Clear")}</button>
              </Row>
              {thisComputer ? <TrashRow confirmAction={confirmAction} showToast={showToast} Row={Row} /> : null}
            </Group>
          </>
        ) : null}

        {section === 'privacy' ? (
          <HiddenSettings hidden={hidden} prefs={prefs} setPrefs={setPrefs} showToast={showToast} confirmAction={confirmAction} Group={Group} Row={Row} Status={Status} Switch={Switch} />
        ) : null}

        {section === 'connection' ? (
          <>
            <Group title={t("ComfyUI")}>
              <Row
                label={comfyRestarting ? <Status tone="warn">{t("Restarting")}</Status> : health ? <Status tone={connected ? 'ok' : 'bad'}>{connected ? t("Connected") : t("Not connected")}</Status> : <Skeleton className="skeleton-text short" />}
                description={comfyRestarting ? t("Reconnects when it’s back. {0}", { "0": (restartEta?.text || 'Usually a few seconds.') }) : health ? (connected ? health.comfyUrl : health.error || t("Start ComfyUI at {0}, then check again.", { "0": (health.comfyUrl || 'http://127.0.0.1:8188') })) : undefined}
              >
                {connected
                  ? <button className="btn is-ghost" onClick={() => window.open(health?.comfyUrl || 'http://127.0.0.1:8188', '_blank')}><ExternalLink size={14} />{t("Open ComfyUI")}</button>
                  : <button className="btn is-primary" onClick={refreshHealth} disabled={comfyRestarting}>{comfyRestarting ? t("Waiting…") : t("Check again")}</button>}
              </Row>
              {thisComputer ? (
                <SettingsDrawer key={health && !connected ? 'off' : 'on'} id="set-comfy-address" title={t("Change address")} description={t("If ComfyUI runs on another port or computer")} defaultOpen={Boolean(health && !connected && !comfyRestarting)}>
                  <ComfyAddressRow current={health?.comfyUrl || 'http://127.0.0.1:8188'} search={health?.comfySearch !== false} showToast={showToast} onSaved={() => { refreshHealth(); refreshModels(false); refreshWorkflows(); }} />
                  <ComfySearchRow enabled={health?.comfySearch !== false} onSaved={refreshHealth} />
                </SettingsDrawer>
              ) : (
                <Row label={t("Restart ComfyUI")} description={t("Loads new custom nodes and files, and frees memory.")}>
                  <ComfyRestart className="is-end" onBack={() => { refreshModels(false); refreshWorkflows(); }} confirm={() => confirmAction({ title: t("Restart ComfyUI?"), description: t("Running and queued generations stop. It takes a few seconds."), action: t("Restart ComfyUI"), destructive: true })} />
                </Row>
              )}
            </Group>
            {thisComputer ? <RestartGroup confirmAction={confirmAction} onComfyBack={() => { refreshModels(false); refreshWorkflows(); }} restartHeiss={restartHeiss} heissRestarting={Boolean(restarting)} updateStatus={updateStatus} /> : null}
            <OtherDevicesGroup
              canChange={thisComputer}
              confirmAction={confirmAction}
              restartHeiss={restartHeiss}
              restarting={Boolean(restarting)}
              copyToClipboard={copyToClipboard}
              showToast={showToast}
              Group={Group}
              Row={Row}
              Status={Status}
              Switch={Switch}
            />
          </>
        ) : null}

        {section === 'models' ? (
          <>
            {typedModels.length ? (
              <Group title={t("Model types")} note={t("Set the type for models that weren’t recognized or were detected wrong.")}>
                {typedModels.map((file) => {
                  const key = `${file.source}:${file.name}`;
                  const folder = file.source === 'checkpoint' ? 'Checkpoint' : 'Diffusion model';
                  const how = file.via === 'choice' ? 'set by you' : file.via === 'file' ? 'read from its weights' : file.via === 'name' ? 'guessed from its name' : '';
                  const status = [folder, file.label ? `${file.label}${how ? ` (${how})` : ''}` : '', file.reason || (file.supported ? '' : 'Not recognized. Pick a type to use it.')]
                    .filter(Boolean).join(' · ');
                  return (
                    <Row key={key} label={<span className="set-model-name" title={file.name}>{file.name.split(/[\\/]/).pop()}</span>} description={status} disabled={typeBusy === key}>
                      <div className="set-type-picker">
                        <StudioSelect
                          value={file.via === 'choice' ? file.choice : 'auto'}
                          onChange={(type) => setModelType(file, type)}
                          options={[{ label: file.via === 'choice' ? 'Detect again' : file.supported ? 'Automatic' : 'Not used', value: 'auto' }, ...(modelList?.modelTypeChoices?.[file.source] || [])]}
                        />
                      </div>
                    </Row>
                  );
                })}
              </Group>
            ) : null}
            <Group title={t("Installed")}>
              <Row
                label={models ? t("{0} image · {1} video", { "0": (models.imageModels.length), "1": (models.videoModels.length) }) : <Skeleton className="skeleton-text short" />}
                description={t("Rescan finds models and workflows added since ComfyUI started.")}
              >
                <button className="btn" onClick={() => { refreshModels(); refreshWorkflows(); }}><RefreshCw size={14} />{t("Rescan")}</button>
              </Row>
            </Group>
            {modelFolders ? <ModelFolderSettings folders={modelFolders} confirmAction={confirmAction} onOpen={() => { onClose(); modelFolders.openDialog(); }} hints={prefs.modelFolderHints !== false} onHintsChange={(next) => setPrefs({ modelFolderHints: next })} /> : null}
            <HuggingFaceTokenSettings showToast={showToast} />
          </>
        ) : null}

        {section === 'about' ? (
          <>
            <section className="about-hero">
              <HeatMark className="about-mark" />
              <p className="about-tagline">{t("A local image and video studio for ComfyUI.")}</p>
              {/* What staying local means, in numbers: everything made here stays here. */}
              {stats ? (
                <p className="about-value">
                  {stats.outputs.toLocaleString()} {stats.videos ? t("images and videos") : stats.outputs === 1 ? t("image") : t("images")}{t("made here · none uploaded · no telemetry")}</p>
              ) : null}
              <div className="about-meta">
                {appVersion ? (
                  sinceRelease?.commits
                    ? <span title={t("{0} commit{1} since the {2} release", { "0": (sinceRelease.commits), "1": (sinceRelease.commits === 1 ? t("") : t("s")), "2": (sinceRelease.tag) })}>v{appVersion} + {sinceRelease.commits}</span>
                    : <span>v{appVersion}</span>
                ) : null}
                {updateStatus?.current ? <span>{updateStatus.branch || t("main")} · {String(updateStatus.current).slice(0, 7)}</span> : null}
                <span>{t("MIT licensed")}</span>
              </div>
            </section>

            <Group title={t("Stats")} note={stats && stats.outputs ? <>{t("Since")}{" "}{formatDay(stats.firstAt)} · {stats.activeDays}{t("active day")}{stats.activeDays === 1 ? '' : 's'}{stats.busiestCount > 1 ? <>{t("· busiest day")}{" "}{formatDay(stats.busiestDay)}{t("with")}{" "}{stats.busiestCount}</> : null}.</> : undefined}>
              <div className="about-stats">
                {[
                  { value: stats ? compact(stats.outputs) : null, label: t("Outputs"), hint: stats ? `${compact(stats.images)} images · ${compact(stats.videos)} videos` : '' },
                  { value: stats ? formatDuration(stats.renderMs) : null, label: t("Rendering"), hint: stats?.upscales ? `${compact(stats.upscales)} upscaled` : 'time in ComfyUI' },
                  { value: stats ? `${compact(stats.megapixels)} MP` : null, label: t("Pixels made"), hint: 'megapixels' },
                  { value: stats ? `${stats.currentStreak} day${stats.currentStreak === 1 ? '' : 's'}` : null, label: t("Current streak"), hint: stats?.currentStreak ? '' : 'starts with today’s first image' },
                  { value: stats ? `${stats.longestStreak} day${stats.longestStreak === 1 ? '' : 's'}` : null, label: t("Longest streak"), hint: '' },
                  { value: stats ? (topWorkflowName || '—') : null, label: t("Most used"), hint: stats?.topWorkflowCount ? `${compact(stats.topWorkflowCount)} outputs` : '' }
                ].map((tile) => (
                  <div className="about-stat" key={tile.label}>
                    <strong title={typeof tile.value === 'string' ? tile.value : undefined}>{tile.value ?? <Skeleton className="skeleton-text short" />}</strong>
                    <span>{tile.label}</span>
                    {tile.hint ? <small>{tile.hint}</small> : null}
                  </div>
                ))}
              </div>
            </Group>

            {thisComputer ? <Group title={t("Updates")} note={updateStatus?.restartRequired ? t("Restart HEISS UI to finish updating.") : undefined}>
              {updateStatus?.release ? (
                <ReleaseUpdateRow
                  status={updateStatus}
                  busy={updateBusy}
                  restarting={Boolean(restarting)}
                  checking={checking}
                  onCheck={runUpdateCheck}
                  onInstall={installUpdate}
                  onRestart={restartForUpdate}
                />
              ) : (
                <Row label={<Status tone={updateStatus?.error ? 'bad' : updateStatus?.available ? 'warn' : updateStatus?.ok ? 'ok' : undefined}>{updateLabel}</Status>} description={updateStatus?.available ? t("Downloads the latest code and rebuilds.") : t("Checks GitHub for a newer commit.")} stacked>
                  <div className="about-update">
                    <MosaicButton busy={checking} disabled={checking || updateBusy} onClick={runUpdateCheck}>
                      {checking ? t("Checking for updates…") : updateStatus?.ok && !updateStatus.available ? t("Up to date · check again") : t("Check for updates")}
                    </MosaicButton>
                    {updateStatus?.available ? <button className="btn is-primary" onClick={installUpdate} disabled={updateBusy}>{updateBusy ? t("Installing…") : t("Install update")}</button> : null}
                  </div>
                </Row>
              )}
              {updateStatus?.release && updateStatus.prefs ? (
                <SwitchRow
                  label={t("Check automatically")}
                  description={t("Checks GitHub for a new version every few hours.")}
                  checked={updateStatus.prefs.autoCheck}
                  onChange={(autoCheck) => setUpdatePrefs({ autoCheck })}
                />
              ) : null}
            </Group> : null}

            <section className="feedback-hero">
              <div className="feedback-hero-copy">
                <span className="feedback-hero-eyebrow">{t("Feedback")}</span>
                <strong>{t("Make HEISS better.")}</strong>
                <p>{t("Report a bug or suggest an idea on the public board.")}</p>
                <div className="feedback-hero-actions">
                  <button type="button" className="feedback-hero-post" onClick={() => openFeedback({ from: 'settings' })}>{t("New post")}{" "}<span><Plus size={14} strokeWidth={2.4} /></span>
                  </button>
                  <a className="feedback-hero-link" href={boardUrl} target="_blank" rel="noreferrer">{t("View board")}{" "}<ArrowUpRight size={14} /></a>
                </div>
              </div>
              <a className="feedback-hero-stage" href={boardUrl} target="_blank" rel="noreferrer" tabIndex={-1} aria-hidden="true">
                <span className="feedback-hero-sheet" />
                <span className="feedback-hero-sheet" />
                <span className="feedback-hero-sheet" />
                <span className="feedback-hero-sheet" />
                <span className="feedback-hero-window">
                  <img src="/feedback-board.webp" alt="" width={1120} height={749} loading="lazy" decoding="async" draggable={false} />
                </span>
              </a>
              <p className="feedback-hero-fine">{t("Posts never include prompts, images or file names.")}</p>
            </section>

            <HelpGroup copyToClipboard={copyToClipboard} />

            <Group title={t("Links")}>
              <div className="about-links">
                <a href={githubUrl} target="_blank" rel="noreferrer"><Github size={15} /><span>{t("Source on GitHub")}</span><ExternalLink size={12} /></a>
                <a href={boardUrl} target="_blank" rel="noreferrer"><MessageSquarePlus size={15} /><span>{t("Feedback board")}</span><ExternalLink size={12} /></a>
                <a href={discordUrl} target="_blank" rel="noreferrer"><DiscordIcon size={15} /><span>{t("Discord")}</span><ExternalLink size={12} /></a>
                <a href="https://heiss-ui.vercel.app/" target="_blank" rel="noreferrer"><Globe size={15} /><span>{t("Website")}</span><ExternalLink size={12} /></a>
                <a href={`${githubUrl}/blob/main/LICENSE`} target="_blank" rel="noreferrer"><Scale size={15} /><span>{t("MIT license")}</span><ExternalLink size={12} /></a>
                <a href={`${githubUrl}/blob/main/CHANGELOG.md`} target="_blank" rel="noreferrer"><ScrollText size={15} /><span>{t("Changelog")}</span><ExternalLink size={12} /></a>
              </div>
            </Group>

            <Group title={t("Credits")}>
              <Row label={t("J-AI Studio by Jasper")} description={t("HEISS UI started as a fork of J-AI Studio. The prompt-first idea and much of the foundation are his work.")}>
                <a className="btn is-ghost" href="https://github.com/jasperdevs/J-AI-Studio" target="_blank" rel="noreferrer"><ExternalLink size={13} />{t("J-AI Studio")}</a>
              </Row>
              <Row label={t("ComfyUI")} description={t("Renders every image and video.")}>
                <a className="btn is-ghost" href="https://github.com/comfyanonymous/ComfyUI" target="_blank" rel="noreferrer"><ExternalLink size={13} />{t("ComfyUI")}</a>
              </Row>
            </Group>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

import React from 'react';
import { ComfyRestart, useComfyRestarting } from './ComfyRestart';
import { NodeInstall } from './NodeInstall';
import { usePhone, useThisComputer } from './device';
import type { ConfirmAction } from './useConfirmation';
import { Boxes, Bug, Check, Copy, Download, ExternalLink, FolderOpen, FolderSearch, ScanSearch, Github, Globe, Info, LockKeyhole, Plug, RefreshCw, Scale, Sparkles, SlidersHorizontal, Wand2, Library } from 'lucide-react';
import { githubUrl } from './constants';
import { cn } from './format';
import { NumberPicker, Skeleton, StudioSelect } from './components';
import { Modal } from './Modal';
import { HeatMark } from './HeatMark';
import { MosaicButton } from './MosaicButton';
import { apiJson } from './api';
import type { ModelFile, Models, OutputFolderReport, UpdateStatus, UpscaleInstall, UpscaleStatus } from './types';
import type { ModelFolders } from './useModelFolders';
import { formatBytes, upscaleEfforts, upscaleQualityLabel } from './useUpscale';
import { HiddenSettings } from './HiddenSettings';

export const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, description: 'How the studio looks and behaves, and starting over.' },
  { id: 'generation', label: 'Generation', icon: Wand2, description: 'The composer, previews and the values new workflows start from.' },
  { id: 'upscale', label: 'Upscale', icon: Sparkles, description: 'The arrow on finished images: one click makes a larger, sharper copy (SeedVR2, run in ComfyUI).' },
  { id: 'library', label: 'Library', icon: Library, description: 'Where outputs live and how the gallery groups them.' },
  { id: 'privacy', label: 'Hidden', icon: LockKeyhole, description: 'Images you keep to yourself, encrypted and opened with a password, Touch ID or Windows Hello.' },
  { id: 'models', label: 'Models', icon: Boxes, description: 'What ComfyUI has installed, where it looks for more, and what type each file is.' },
  { id: 'connection', label: 'Connection', icon: Plug, description: 'Where ComfyUI runs, and opening the studio on other devices.' },
  { id: 'about', label: 'About', icon: Info, description: 'Version, your numbers, updates and credits.' }
] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number]['id'];

/* ------------------------------------------------------------ Primitives */

export function Switch({ checked, onChange, disabled, label, size = 'md' }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string; size?: 'sm' | 'md' }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={cn('switch', size === 'sm' && 'is-sm')} onClick={() => onChange(!checked)}>
      <span className="switch-thumb" />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (next: T) => void; label: string }) {
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

/** Where HEISS UI looks for ComfyUI: test an address, then keep it. */
function ComfyAddressRow({ current, showToast, onSaved }: { current: string; showToast: (message: string, tone?: 'default' | 'success' | 'error') => void; onSaved: () => void }) {
  const [value, setValue] = React.useState(current);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState('');
  React.useEffect(() => { setValue(current); }, [current]);
  const submit = async (save: boolean) => {
    setBusy(true);
    setNote('');
    try {
      const response = await fetch('/api/comfy-url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: value, save }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setNote(data.error || 'That address could not be checked.'); return; }
      setValue(data.url);
      if (!data.reachable) { setNote(`${data.detail || 'ComfyUI didn’t answer there.'}${save ? ' Nothing was changed.' : ''}`); return; }
      if (data.saved) { showToast('ComfyUI address saved', 'success'); onSaved(); }
      else setNote('ComfyUI answers there.');
    } catch {
      setNote('HEISS UI could not be reached to check it.');
    } finally {
      setBusy(false);
    }
  };
  const changed = value.trim() && value.trim() !== current;
  return (
    <Row label="Address" description={note || 'Where HEISS UI looks for ComfyUI. ComfyUI Desktop usually uses port 8000; a manual install, 8188.'}>
      <div className="set-address">
        <input className="set-path-input" value={value} onChange={(event) => setValue(event.target.value)} aria-label="ComfyUI address" spellCheck={false} autoComplete="off" onKeyDown={(event) => { if (event.key === 'Enter' && changed) submit(true); }} />
        <button className="btn" onClick={() => submit(false)} disabled={busy || !value.trim()}>Test</button>
        <button className="btn is-primary" onClick={() => submit(true)} disabled={busy || !changed}>{busy ? 'Checking…' : 'Save'}</button>
      </div>
    </Row>
  );
}

function Group({ title, note, tone, children }: React.PropsWithChildren<{ title?: string; note?: React.ReactNode; tone?: 'danger' }>) {
  return (
    <section className="set-group">
      {title ? <h4 className="set-group-title">{title}</h4> : null}
      <div className={cn('set-card', tone === 'danger' && 'is-danger')}>{children}</div>
      {note ? <p className="set-note">{note}</p> : null}
    </section>
  );
}

function Row({ label, description, children, stacked, disabled }: React.PropsWithChildren<{ label: React.ReactNode; description?: React.ReactNode; stacked?: boolean; disabled?: boolean }>) {
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

function SwitchRow({ label, description, checked, onChange, disabled }: { label: string; description?: React.ReactNode; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <Row label={label} description={description} disabled={disabled}>
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </Row>
  );
}

/** Folders ComfyUI reads because HEISS added them, and the way to find more. */
function ModelFolderSettings({ folders, confirmAction, onOpen }: { folders: ModelFolders; confirmAction: ConfirmAction; onOpen: () => void }) {
  const report = folders.report;
  const stray = (report?.folders || []).reduce((sum, folder) => sum + folder.count, 0);
  const linked = report?.linked || [];
  // Settings is where people come to check: look again, quietly, each time it opens.
  React.useEffect(() => { folders.scan({ quiet: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Group title="Model folders" note={report?.configLabel ? <>Stored in <code>{report.configLabel}</code>.</> : undefined}>
      {linked.map((item) => (
        <Row key={item.path} label={<span className="set-folder-path" title={item.path}>{item.label}</span>} description={item.read ? 'Added by HEISS UI · read by ComfyUI' : 'Added by HEISS UI · ComfyUI reads it after a restart'}>
          <button className="btn is-ghost" onClick={async () => {
            if (!await confirmAction({ title: `Stop using ${item.label}?`, description: 'ComfyUI stops reading this folder after its next restart.', action: 'Remove folder' })) return;
            folders.remove(item.path);
          }}>Remove</button>
        </Row>
      ))}
      <Row
        label={stray ? <Status tone="warn">{stray} model{stray === 1 ? '' : 's'} found</Status> : 'Find models'}
        description={stray ? 'They’re in a folder ComfyUI doesn’t read.' : 'Searches other ComfyUI installs, shared folders and external drives.'}
      >
        <button className={cn('btn', stray > 0 && 'is-primary')} onClick={onOpen}><FolderSearch size={14} /> {stray ? 'Add' : 'Search'}</button>
      </Row>
    </Group>
  );
}

function Status({ tone, children }: React.PropsWithChildren<{ tone?: 'ok' | 'bad' | 'warn' }>) {
  return <span className={cn('set-status', tone && `is-${tone}`)}><i aria-hidden="true" />{children}</span>;
}

/* ------------------------------------------------------------ Upscale */

/**
 * One line on where smart upscale stands. Anything that needs doing opens the
 * setup dialog, which owns installing nodes, downloading and verifying.
 */
function UpscaleReadiness({ status, reason, install, onOpenSetup, onDownload }: { status: UpscaleStatus | null; reason?: string; install: UpscaleInstall; onOpenSetup: () => void; onDownload: () => void }) {
  if (install?.status === 'running') {
    const ratio = install.totalBytes ? Math.min(1, (install.receivedBytes || 0) / install.totalBytes) : 0;
    return (
      <Row label={<Status tone="warn">Downloading the model</Status>} description={`${formatBytes(install.receivedBytes)} of ${formatBytes(install.totalBytes)}`} stacked>
        <div className="set-progress"><div style={{ width: `${Math.round(ratio * 100)}%` }} /></div>
        <button className="btn" onClick={onOpenSetup}>Show progress</button>
      </Row>
    );
  }
  if (!status) {
    return <Row label={<Status tone="warn">Unavailable</Status>} description={reason || 'Smart upscale is unavailable right now.'}><button className="btn" onClick={onOpenSetup}>Open setup</button></Row>;
  }
  if (!status.nodesInstalled) {
    return <Row label={<Status tone="warn">Needs the SeedVR2 nodes</Status>} description="A one-time install of its ComfyUI nodes; Set up offers one click where it can."><button className="btn is-primary" onClick={onOpenSetup}>Set up</button></Row>;
  }
  if (install?.status === 'error' && !status.ready) {
    return <Row label={<Status tone="bad">Download stopped</Status>} description={install.error}><button className="btn is-primary" onClick={onOpenSetup}>Resume</button></Row>;
  }
  if (status.needsDownload) {
    return <Row label={<Status tone="warn">Needs a download</Status>} description={`${formatBytes(status.downloadBytes)} of SeedVR2 weights, once.`}><button className="btn is-primary" onClick={onOpenSetup}>Set up</button></Row>;
  }
  if (status.substituting) {
    const effort = upscaleQualityLabel(status.quality);
    return (
      <Row
        label={<Status tone="warn">Running on a fallback model</Status>}
        description={`${effort} has no weights of its own yet, so it uses ${status.fallbackFile || 'another installed SeedVR2 weight'} instead. Results can differ from what ${effort} is tuned for.`}
        stacked
      >
        <button className="btn is-primary" onClick={onDownload}>Download {effort} · {formatBytes(status.downloadBytes)}</button>
      </Row>
    );
  }
  return <Row label={<Status tone="ok">Ready</Status>} description="Hover a finished image and click the arrow in its top-left corner." />;
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
  const download = status.download;
  const latest = status.latest || download?.version || '';
  const notes = status.url ? <a className="btn is-ghost" href={status.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> What's new</a> : null;
  const check = (
    <MosaicButton busy={checking} disabled={checking || busy} onClick={onCheck}>
      {checking ? 'Checking for updates…' : status.ok && !status.available ? 'Up to date · check again' : 'Check for updates'}
    </MosaicButton>
  );
  const result = status.result;
  const resultRow = result && !result.ok ? (
    <Row
      label={<Status tone="bad">{result.rolledBack ? `${result.to} would not start` : 'The last update did not install'}</Status>}
      description={result.rolledBack ? `Still on ${result.from}.${result.error ? ` ${result.error}` : ''}` : result.error}
    />
  ) : null;

  if (restarting) {
    return <Row label={<Status tone="warn">Restarting into {latest}</Status>} description="This page reloads when it’s done." />;
  }
  if (download?.status === 'downloading' || download?.status === 'verifying' || download?.status === 'unpacking') {
    const ratio = download.totalBytes ? Math.min(1, (download.receivedBytes || 0) / download.totalBytes) : 0;
    return (
      <Row
        label={<Status tone="warn">{download.status === 'downloading' ? `Downloading ${latest}` : 'Checking the download'}</Status>}
        description={download.status === 'downloading' ? `${formatBytes(download.receivedBytes)} of ${formatBytes(download.totalBytes)}. You can keep working.` : 'Verifying and unpacking.'}
        stacked
      >
        <div className="set-progress"><div style={{ width: `${Math.round((download.status === 'downloading' ? ratio : 1) * 100)}%` }} /></div>
      </Row>
    );
  }
  if (download?.status === 'ready') {
    return (
      <Row
        label={<Status tone="ok">{latest} is ready to install</Status>}
        description={status.supervised ? 'Running generations stop when HEISS UI restarts.' : 'Quit HEISS UI and open it again to switch.'}
        stacked
      >
        <div className="about-update">
          {status.supervised ? <button className="btn is-primary" onClick={onRestart}>Restart now</button> : null}
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
          label={<Status tone="warn">HEISS UI {latest} is out</Status>}
          description={download?.status === 'error'
            ? `The download stopped: ${download.error}`
            : status.canInstall
              ? `You have ${status.current}.${status.size ? ` ${formatBytes(status.size)},` : ''} installs on restart.`
              : `You have ${status.current}. This release has to be downloaded by hand: replace this folder with it and keep your data folder.`}
          stacked
        >
          <div className="about-update">
            {status.canInstall
              ? <button className="btn is-primary" onClick={onInstall} disabled={busy}>{download?.status === 'error' ? 'Try again' : 'Install update'}</button>
              : status.url ? <a className="btn is-primary" href={status.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Download</a> : null}
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
        label={<Status tone={status.error ? 'bad' : status.ok ? 'ok' : undefined}>{status.error || (result?.ok && result.to ? `Updated to ${result.to}` : status.ok ? 'Up to date' : 'Not checked yet')}</Status>}
        description={status.current ? `HEISS UI ${status.current}. Checks GitHub for a newer release.` : 'Checks GitHub for a newer release.'}
        stacked
      >
        <div className="about-update">{check}</div>
      </Row>
    </>
  );
}

/* ------------------------------------------------------------ Output folder */

const fileCount = (report: OutputFolderReport) => {
  const count = report.media || 0;
  return `${new Intl.NumberFormat().format(count)}${report.capped ? '+' : ''} file${count === 1 && !report.capped ? '' : 's'}`;
};

/** One sentence per state, always saying what it means for the gallery. */
function describeFolder(report: OutputFolderReport | null): { tone?: 'ok' | 'warn' | 'bad'; label: string; detail: string } {
  if (!report) return { label: 'Checking…', detail: '' };
  switch (report.state) {
    case 'empty': return { tone: 'warn', label: 'Not set', detail: 'Needed to delete files and to remove ComfyUI’s copies of hidden images.' };
    case 'missing': return { tone: 'bad', label: 'Folder not found', detail: 'Nothing exists at that path on this computer.' };
    case 'not-folder': return { tone: 'bad', label: 'Not a folder', detail: 'That path points at a file.' };
    case 'mismatch': return { tone: 'warn', label: 'Your recent images aren’t here', detail: `None of your last ${report.checked} images are in this folder (${fileCount(report)}). ComfyUI is probably saving somewhere else. Try Find automatically.` };
    case 'match': return { tone: 'ok', label: 'Linked', detail: `${report.found === report.checked ? `All ${report.checked}` : `${report.found} of ${report.checked}`} recent images found here · ${fileCount(report)}` };
    default: return { tone: report.looksLikeComfy ? 'ok' : 'warn', label: report.looksLikeComfy ? 'Linked' : 'Set', detail: `${fileCount(report)}${report.looksLikeComfy ? '' : ' · does not look like a ComfyUI folder'}. It gets confirmed after your next gen.` };
  }
}

function OutputFolderRow({ savedDir, galleryNote, onSave, onOpen, onCopy, showToast }: {
  savedDir: string;
  galleryNote?: string;
  onSave: (dir: string) => Promise<OutputFolderReport | null>;
  onOpen: () => void;
  onCopy: (dir: string) => void;
  showToast: (message: string, tone?: 'default' | 'success' | 'error') => void;
}) {
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
      showToast(error instanceof Error ? error.message : 'Could not open the folder picker', 'error');
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
      showToast(error instanceof Error ? error.message : 'Could not search for the output folder', 'error');
    } finally {
      setBusy('');
    }
  };

  const shown = describeFolder(dirty ? draftReport : report);
  const draftBlocked = dirty && (!draftReport || draftReport.state === 'missing' || draftReport.state === 'not-folder');
  const hasSaved = Boolean(report?.path && report.state !== 'missing');

  return (
    <Row label="Output folder" description={galleryNote} stacked>
      <div className={cn('set-folder-status', dirty && 'is-draft')} aria-live="polite">
        <Status tone={shown.tone}>{dirty ? `New path: ${shown.label.toLowerCase()}` : shown.label}</Status>
        {shown.detail ? <span>{shown.detail}</span> : null}
      </div>
      <form className="set-inline-form" onSubmit={(event) => { event.preventDefault(); if (dirty && !draftBlocked) save(draft); }}>
        <input
          className="modal-input set-path-input"
          aria-label="Output folder"
          value={draft}
          placeholder={canBrowse ? 'Paste a path, or browse' : 'Paste the full folder path'}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape' && dirty) { event.stopPropagation(); setDraft(report?.path || savedDir); } }}
        />
        {dirty
          ? <button className="btn is-primary" type="submit" disabled={draftBlocked || busy === 'save'}>Save</button>
          : canBrowse ? <button className="btn" type="button" onClick={browse} disabled={Boolean(busy)}><FolderSearch size={14} /> {busy === 'browse' ? 'Waiting…' : 'Browse…'}</button> : null}
      </form>
      {candidates ? (
        <div className="set-folder-picks" role="list" aria-label="Folders found">
          {candidates.map((item) => (
            <button key={item.path} type="button" role="listitem" className="set-folder-pick" onClick={() => save(item.path)} disabled={busy === 'save'}>
              <code className="set-path">{item.path}</code>
              <span>
                {item.source === 'comfy' ? 'From ComfyUI · ' : ''}
                {item.state === 'match' ? `${item.found} of ${item.checked} recent images here` : item.state === 'mismatch' ? 'Your recent images aren’t here' : fileCount(item)}
              </span>
              {item.state === 'match' ? <Check size={14} className="set-folder-pick-mark" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
      <div className="set-actions">
        <button className="btn is-ghost" onClick={detect} disabled={Boolean(busy)}><ScanSearch size={14} /> {busy === 'detect' ? 'Searching…' : 'Find automatically'}</button>
        <button className="btn is-ghost" onClick={onOpen} disabled={!hasSaved}><FolderOpen size={14} /> Open</button>
        <button className="btn is-ghost" onClick={() => onCopy(report?.path || savedDir)} disabled={!hasSaved}><Copy size={14} /> Copy path</button>
      </div>
    </Row>
  );
}

type StudioStats = {
  outputs: number; images: number; videos: number; upscales: number; renderMs: number; megapixels: number;
  firstAt: string; activeDays: number; currentStreak: number; longestStreak: number;
  busiestDay: string; busiestCount: number; topWorkflow: string; topWorkflowCount: number;
};

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

export function SettingsDialog({ view, open, section, onSectionChange, onClose }: { view: Record<string, any>; open: boolean; section: SettingsSection; onSectionChange: (section: SettingsSection) => void; onClose: () => void }) {
  const {
    prefs, setPrefs, setZenMode, zenGalleryOpen, setZenGalleryOpen,
    upscaleStatus, upscaleUnavailableReason, upscaleInstall, upscaleSetup,
    gallery, galleryLoaded, paths, saveOutputDirectory, openOutputFolder, copyAndToast, showToast,
    clearFailedItems, clearGallery, clearAllCache, resetAllSettings, confirmAction,
    hidden,
    health, refreshHealth, models, refreshModels, refreshWorkflows, modelFolders,
    updateStatus, updateBusy, checkForUpdates, installUpdate, restartForUpdate, restarting, workflows, modelProfiles
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
      showToast(error instanceof Error ? error.message : 'Could not save the model type', 'error');
    } finally {
      setTypeBusy('');
    }
  };

  // About: stats come from the local gallery; the update check always runs long
  // enough for the mosaic button to show its burn.
  const [stats, setStats] = React.useState<StudioStats | null>(null);
  const [appVersion, setAppVersion] = React.useState('');
  const [sinceRelease, setSinceRelease] = React.useState<{ tag: string; commits: number } | null>(null);
  const [checking, setChecking] = React.useState(false);
  React.useEffect(() => {
    if (!open || section !== 'about') return;
    let live = true;
    fetch('/api/stats').then((response) => response.ok ? response.json() : null).then((data) => {
      if (!live || !data?.stats) return;
      setStats(data.stats);
      setAppVersion(data.version || '');
      setSinceRelease(data.sinceRelease || null);
    }).catch(() => null);
    return () => { live = false; };
  }, [open, section]);
  const topWorkflowName = stats?.topWorkflow
    ? (workflows || []).find((item: { profileId: string; name: string }) => item.profileId === stats.topWorkflow)?.name
      || (modelProfiles || []).find((item: { id: string; displayName?: string; label?: string }) => item.id === stats.topWorkflow)?.displayName
      || stats.topWorkflow.replace(/^custom:/, '')
    : '';
  const runUpdateCheck = async () => {
    const started = performance.now();
    setChecking(true);
    try { await checkForUpdates(false); } finally {
      window.setTimeout(() => setChecking(false), Math.max(0, 1600 - (performance.now() - started)));
    }
  };

  const [network, setNetwork] = React.useState<{ listening: boolean; port: number; interfaces: Array<{ name: string; address: string; likelyVirtual: boolean }> } | null>(null);
  React.useEffect(() => {
    if (!open || section !== 'connection') return;
    let live = true;
    fetch('/api/network').then((response) => response.ok ? response.json() : null).then((data) => { if (live && data) setNetwork({ listening: Boolean(data.listening), port: Number(data.port), interfaces: data.interfaces || [] }); }).catch(() => null);
    return () => { live = false; };
  }, [open, section]);
  // The page's own port: Vite's in development, HEISS UI's otherwise.
  const lanUrl = (address: string) => `${window.location.protocol}//${address}:${window.location.port || network?.port || 8787}`;
  const copyLanUrl = React.useCallback((address: string) => copyAndToast(lanUrl(address), 'Address copied'), [copyAndToast, network]); // eslint-disable-line react-hooks/exhaustive-deps

  const upscaleOn = prefs.smartUpscale !== false;
  const effort = upscaleEfforts.find((item) => item.value === (prefs.upscaleQuality || 'balanced')) || upscaleEfforts[1];
  const faceDetailReady = Boolean(upscaleStatus?.faceDetail?.nodesInstalled);
  const connected = Boolean(health?.ok);
  const comfyRestarting = useComfyRestarting();
  // Folders, models, updates and wiping the gallery are looked after at the computer itself.
  const thisComputer = useThisComputer();
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
    <Modal open={open} onOpenChange={(next) => { if (!next) onClose(); }} size="sheet" className="settings-modal" bodyClassName="set-layout" title="Settings">
      <nav className="set-nav" aria-label="Settings sections">
        {SETTINGS_SECTIONS.filter((item) => thisComputer || item.id !== 'models').map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} type="button" className={cn('set-nav-item', section === item.id && 'active')} aria-current={section === item.id ? 'page' : undefined} aria-controls="settings-panel" data-section={item.id} onClick={() => onSectionChange(item.id)}>
              <Icon size={15} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* A region named by its heading, so a screen reader hears where it landed. */}
      <div className="set-panel" key={section} id="settings-panel" role="region" aria-labelledby="settings-panel-title">
        <header className="set-page-head">
          <h3 id="settings-panel-title">{current.label}</h3>
          <p>{current.description}</p>
        </header>

        {section === 'general' ? (
          <>
            <Group title="Layout">
              <SwitchRow label="Zen mode" description="A prompt-first fullscreen layout: one image at a time, the composer below. Leave it with the same switch, the dock’s expand button or Escape." checked={prefs.zenMode} onChange={setZenMode} />
              <SwitchRow label="Gallery strip in zen" description="Show recent outputs as a strip across the top." checked={zenGalleryOpen} onChange={setZenGalleryOpen} />
              {phoneDevice ? <SwitchRow label="Simple phone studio" description="Just making, browsing and sharing, laid out for your thumb. Everything else stays on the computer." checked={!prefs.fullStudioOnPhone} onChange={(next) => setPrefs({ fullStudioOnPhone: !next })} /> : null}
              <SwitchRow label="Follow the latest output" description="Jump to each new image as it finishes." checked={prefs.followLatest} onChange={(next) => setPrefs({ followLatest: next })} />
            </Group>
            <Group title="Keyboard" note="Shortcuts pause while you type in a field, except the ones that send the prompt.">
              {([
                ["Enter", "Generate (when “Enter to generate” is on)"],
                ["⌘/Ctrl + Enter", "Generate, always"],
                ["Shift + Enter", "New line in the prompt"],
                ["Any letter", "Jump to the prompt and start typing"],
                ["← →", "Previous or next image (viewer and zen)"],
                ["Arrow keys", "Move between gallery tiles, newest to oldest"],
                ["+  −  0", "Zoom in, out, reset (viewer)"],
                ["Delete", "Delete the open image (undo for a few seconds)"],
                ["Esc", "Close the menu, viewer or dialog on top"]
              ] as const).map(([keys, what]) => (
                <Row key={keys} label={<kbd className="set-kbd">{keys}</kbd>} description={what} />
              ))}
            </Group>
            <Group title="Safety">
              <SwitchRow label="Confirm before removing things" description="Ask before deleting or stopping things. Deletes can still be undone for a few seconds, and anything permanent always asks." checked={prefs.confirmActions} onChange={(next) => setPrefs({ confirmActions: next })} />
            </Group>
            <Group title="Reset" tone="danger">
              {thisComputer ? (
                <>
                  <Row label="Delete all finished images" description="Deletes their files from ComfyUI’s output folder, not only from the gallery. Hidden isn’t affected.">
                    <button className="btn is-danger-soft" onClick={clearGallery}>Delete all</button>
                  </Row>
                  <Row label="Clear all cache" description="Browser cache, stale queue state, and ComfyUI memory.">
                    <button className="btn is-danger-soft" onClick={clearAllCache}>Clear cache</button>
                  </Row>
                </>
              ) : null}
              <Row label="Reset all settings" description="Prompts, layout, model choices, LoRA stacks and every preference here.">
                <button className="btn is-danger-soft" onClick={resetAllSettings}>Reset</button>
              </Row>
            </Group>
          </>
        ) : null}

        {section === 'generation' ? (
          <>
            <Group title="Composer">
              <SwitchRow label="Enter to generate" description="Shift+Enter adds a new line." checked={prefs.enterToGenerate} onChange={(next) => setPrefs({ enterToGenerate: next })} />
              <Row label="Multiple images" description={prefs.variationQueueMode === 'separate' ? 'One job per image. Easier to cancel one at a time.' : 'One ComfyUI prompt with a larger batch. Usually faster.'}>
                <Segmented label="Multiple images" value={prefs.variationQueueMode === 'separate' ? 'separate' : 'batch'} onChange={(next) => setPrefs({ variationQueueMode: next })} options={[{ value: 'batch', label: 'One batch' }, { value: 'separate', label: 'Separate jobs' }]} />
              </Row>
            </Group>
            <Group title="Previews">
              <Row label="While generating" description={prefs.generationPreviewMode === 'simple' ? 'Each sampler step as it arrives. Lighter on the GPU.' : 'Early steps resolve through an animated pixel mosaic. Reduced motion always uses simple.'}>
                <Segmented label="Generation previews" value={prefs.generationPreviewMode === 'simple' ? 'simple' : 'advanced'} onChange={(next) => setPrefs({ generationPreviewMode: next })} options={[{ value: 'advanced', label: 'Mosaic' }, { value: 'simple', label: 'Simple' }]} />
              </Row>
            </Group>
            <Group title="Starting values" note="Used when a workflow doesn't define its own. Changing them doesn't touch the current draft.">
              <Row label="Images per run"><NumberPicker label="Images" value={Number(prefs.defaultImageCount)} onChange={(next) => setPrefs({ defaultImageCount: next })} min={1} max={16} /></Row>
              <Row label="Image steps"><NumberPicker label="Steps" value={Number(prefs.defaultImageSteps)} onChange={(next) => setPrefs({ defaultImageSteps: next })} min={1} max={150} /></Row>
              <Row label="Video steps"><NumberPicker label="Steps" value={Number(prefs.defaultVideoSteps)} onChange={(next) => setPrefs({ defaultVideoSteps: next })} min={1} max={150} /></Row>
              <Row label="Video frames"><NumberPicker label="Frames" value={Number(prefs.defaultVideoFrames)} onChange={(next) => setPrefs({ defaultVideoFrames: next })} min={1} max={1000} step={4} /></Row>
              <Row label="Video FPS"><NumberPicker label="FPS" value={Number(prefs.defaultFps)} onChange={(next) => setPrefs({ defaultFps: next })} min={1} max={60} /></Row>
            </Group>
          </>
        ) : null}

        {section === 'upscale' ? (
          <>
            <Group>
              <SwitchRow label="Smart upscale" description="Show an upscale arrow on finished images. The original file is never replaced." checked={upscaleOn} onChange={(next) => setPrefs({ smartUpscale: next })} />
            </Group>
            {upscaleOn ? (
              <>
                <Group title="Quality">
                  <Row label="Effort" description={effort.detail}>
                    <Segmented label="Upscale effort" value={effort.value} onChange={(next) => setPrefs({ upscaleQuality: next })} options={upscaleEfforts.map(({ value, label, scale }) => ({ value, label: `${label} ${scale}` }))} />
                  </Row>
                  <SwitchRow
                    label="Face detail pass"
                    description={faceDetailReady
                      ? 'Sharpens faces after the upscale.'
                      : 'Sharpens faces after the upscale. Needs the Impact Pack and Impact Subpack nodes.'}
                    checked={Boolean(prefs.upscaleFaceDetail) && faceDetailReady}
                    disabled={!faceDetailReady}
                    onChange={(next) => setPrefs({ upscaleFaceDetail: next })}
                  />
                  {!faceDetailReady && upscaleStatus?.faceDetail?.setup?.length ? upscaleStatus.faceDetail.setup.map((setup: NonNullable<NonNullable<typeof upscaleStatus.faceDetail.setup>>[number]) => (
                    <div className="set-node-install" key={setup.pack.name}>
                      <NodeInstall pack={setup.pack} plan={setup} managerHint={setup.manager} autoInstall={setup.autoInstall} showToast={showToast} onRestarted={() => view.refreshUpscaleStatus?.()} afterRestart="The face pass turns on here once ComfyUI loads it." />
                    </div>
                  )) : null}
                </Group>
                <Group title="Status">
                  <UpscaleReadiness status={upscaleStatus} reason={upscaleUnavailableReason} install={upscaleInstall} onOpenSetup={() => upscaleSetup.openSetup()} onDownload={() => upscaleSetup.openSetup(null, { download: true })} />
                </Group>
              </>
            ) : null}
          </>
        ) : null}

        {section === 'library' ? (
          <>
            {thisComputer ? <Group title="Folders" note="Where ComfyUI saves your images.">
              <OutputFolderRow
                savedDir={paths.outputDir || ''}
                galleryNote={galleryLoaded ? `${gallery.length} item${gallery.length === 1 ? '' : 's'} in the gallery` : undefined}
                onSave={saveOutputDirectory}
                onOpen={openOutputFolder}
                onCopy={(dir) => copyAndToast(dir, 'Output path copied')}
                showToast={showToast}
              />
              <Row label="Workflows folder" description={paths.workflowsDir ? <code className="set-path">{paths.workflowsDir}</code> : <Skeleton className="skeleton-text path" />}>
                <button className="btn is-ghost" onClick={() => { refreshModels(); refreshWorkflows(); }}><RefreshCw size={14} /> Rescan</button>
              </Row>
            </Group> : null}
            <Group title="Runs" note="Hidden images only group with each other.">
              <SwitchRow label="Group generation runs" description="Collapse a burst of related outputs into one stack you can open in place." checked={prefs.groupRuns !== false} onChange={(next) => setPrefs({ groupRuns: next })} />
              {prefs.groupRuns !== false ? (
                <>
                  <Row label="Group by" description={prefs.runGroupingMode === 'job' ? 'Only outputs from the same generation job.' : 'The same prompt repeated, or one batch.'}>
                    <Segmented label="Group by" value={prefs.runGroupingMode === 'job' ? 'job' : 'smart'} onChange={(next) => setPrefs({ runGroupingMode: next })} options={[{ value: 'smart', label: 'Smart' }, { value: 'job', label: 'Batches' }]} />
                  </Row>
                  <Row label="Close a run after" description="Minutes of quiet before a run is stacked. Later outputs start a new run.">
                    <NumberPicker label="Minutes" value={Number(prefs.runCooldownMinutes ?? 5)} onChange={(next) => setPrefs({ runCooldownMinutes: next })} min={1} max={240} />
                  </Row>
                </>
              ) : null}
            </Group>
            <Group title="Gallery">
              <SwitchRow label="Show failed items" description="Keep interrupted or failed generations visible." checked={prefs.showFailedItems} onChange={(next) => setPrefs({ showFailedItems: next })} />
              <Row label="Clear failed items" description="Removes failed and interrupted cards.">
                <button className="btn" onClick={clearFailedItems}>Clear</button>
              </Row>
              <Row label="Export gallery" description="Every finished image in one ZIP file. Hidden has its own export.">
                <a className="btn" href="/api/gallery/export" download><Download size={14} /> Export</a>
              </Row>
            </Group>
          </>
        ) : null}

        {section === 'privacy' ? (
          <HiddenSettings hidden={hidden} prefs={prefs} setPrefs={setPrefs} showToast={showToast} confirmAction={confirmAction} Group={Group} Row={Row} Status={Status} />
        ) : null}

        {section === 'connection' ? (
          <>
            <Group title="ComfyUI">
              <Row
                label={comfyRestarting ? <Status tone="warn">Restarting</Status> : health ? <Status tone={connected ? 'ok' : 'bad'}>{connected ? 'Connected' : 'Not connected'}</Status> : <Skeleton className="skeleton-text short" />}
                description={comfyRestarting ? 'ComfyUI is restarting and reconnects by itself, usually within a few seconds.' : health ? (connected ? health.comfyUrl : health.error || `Start ComfyUI at ${health.comfyUrl || 'http://127.0.0.1:8188'}, then check again.`) : undefined}
              >
                <button className="btn is-primary" onClick={refreshHealth} disabled={comfyRestarting}>{comfyRestarting ? 'Waiting…' : 'Check again'}</button>
              </Row>
              {thisComputer ? <ComfyAddressRow current={health?.comfyUrl || 'http://127.0.0.1:8188'} showToast={showToast} onSaved={() => { refreshHealth(); refreshModels(false); refreshWorkflows(); }} /> : null}
              <Row label="Open ComfyUI" description="Its own interface, in a new tab.">
                <button className="btn" onClick={() => window.open(health?.comfyUrl || 'http://127.0.0.1:8188', '_blank')}><ExternalLink size={14} /> Open</button>
              </Row>
              <Row label="Restart ComfyUI" description="Picks up new custom nodes and files, and frees everything it holds.">
                <ComfyRestart className="is-end" onBack={() => { refreshModels(false); refreshWorkflows(); }} confirm={() => confirmAction({ title: 'Restart ComfyUI?', description: 'Running and queued generations stop. ComfyUI comes back in a few seconds.', action: 'Restart ComfyUI', destructive: true })} />
              </Row>
            </Group>
            <Group title="Other devices" note="Other devices unlock with your Hidden password, so set up Hidden on this computer first. Only do this on a network you trust.">
              {network && !network.listening ? (
                <Row label={<Status tone="bad">Off</Status>} description={<>This studio only answers this computer. Start it with <code>HOST=0.0.0.0</code> (in <code>.env</code> or the shell) and allow the port through your firewall, then open one of the addresses below on your phone.</>} />
              ) : null}
              {(network?.interfaces || []).map((item) => (
                <Row key={`${item.name}-${item.address}`} label={<span className="set-model-name">{lanUrl(item.address)}</span>} description={`${item.name}${item.likelyVirtual ? ' · probably a VPN or virtual adapter' : ''}`}>
                  <button className="btn" onClick={() => copyLanUrl(item.address)} disabled={!network?.listening}><Copy size={14} /> Copy</button>
                </Row>
              ))}
              {network && !network.interfaces.length ? <Row label="No network address" description="This computer isn't on a local network right now." /> : null}
              {!network ? <Row label={<Skeleton className="skeleton-text short" />} /> : null}
            </Group>
          </>
        ) : null}

        {section === 'models' ? (
          <>
            <Group title="Models">
              <Row label="Image models"><span className="set-value">{models ? models.imageModels.length : <Skeleton className="skeleton-text tiny" />}</span></Row>
              <Row label="Video models"><span className="set-value">{models ? models.videoModels.length : <Skeleton className="skeleton-text tiny" />}</span></Row>
              <Row label="Rescan" description="Look again for models and workflows added since ComfyUI started.">
                <button className="btn" onClick={() => { refreshModels(); refreshWorkflows(); }}><RefreshCw size={14} /> Rescan</button>
              </Row>
            </Group>
            {modelFolders ? <ModelFolderSettings folders={modelFolders} confirmAction={confirmAction} onOpen={() => { onClose(); modelFolders.openDialog(); }} /> : null}
            {typedModels.length ? (
              <Group title="Model types" note="Set the type for models that weren’t recognized or were detected wrong.">
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
          </>
        ) : null}

        {section === 'about' ? (
          <>
            <section className="about-hero">
              <HeatMark className="about-mark" />
              <p className="about-tagline">A local image and video studio for ComfyUI.</p>
              <div className="about-meta">
                {appVersion ? (
                  sinceRelease?.commits
                    ? <span title={`${sinceRelease.commits} commit${sinceRelease.commits === 1 ? '' : 's'} since the ${sinceRelease.tag} release`}>v{appVersion} + {sinceRelease.commits}</span>
                    : <span>v{appVersion}</span>
                ) : null}
                {updateStatus?.current ? <span>{updateStatus.branch || 'main'} · {String(updateStatus.current).slice(0, 7)}</span> : null}
                <span>MIT licensed</span>
              </div>
            </section>

            <Group title="Your studio" note={stats && stats.outputs ? <>Since {formatDay(stats.firstAt)} · {stats.activeDays} active day{stats.activeDays === 1 ? '' : 's'}{stats.busiestCount > 1 ? <> · busiest day {formatDay(stats.busiestDay)} with {stats.busiestCount}</> : null}.</> : undefined}>
              <div className="about-stats">
                {[
                  { value: stats ? compact(stats.outputs) : null, label: 'Outputs', hint: stats ? `${compact(stats.images)} images · ${compact(stats.videos)} videos` : '' },
                  { value: stats ? formatDuration(stats.renderMs) : null, label: 'Rendering', hint: stats?.upscales ? `${compact(stats.upscales)} upscaled` : 'time in ComfyUI' },
                  { value: stats ? `${compact(stats.megapixels)} MP` : null, label: 'Pixels made', hint: 'megapixels' },
                  { value: stats ? `${stats.currentStreak} day${stats.currentStreak === 1 ? '' : 's'}` : null, label: 'Current streak', hint: stats?.currentStreak ? 'keep it going' : 'generate today to start one' },
                  { value: stats ? `${stats.longestStreak} day${stats.longestStreak === 1 ? '' : 's'}` : null, label: 'Longest streak', hint: '' },
                  { value: stats ? (topWorkflowName || '—') : null, label: 'Most used', hint: stats?.topWorkflowCount ? `${compact(stats.topWorkflowCount)} outputs` : '' }
                ].map((tile) => (
                  <div className="about-stat" key={tile.label}>
                    <strong title={typeof tile.value === 'string' ? tile.value : undefined}>{tile.value ?? <Skeleton className="skeleton-text short" />}</strong>
                    <span>{tile.label}</span>
                    {tile.hint ? <small>{tile.hint}</small> : null}
                  </div>
                ))}
              </div>
            </Group>

            {thisComputer ? <Group title="Updates" note={updateStatus?.restartRequired ? 'Restart HEISS UI to finish updating.' : undefined}>
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
                <Row label={<Status tone={updateStatus?.error ? 'bad' : updateStatus?.available ? 'warn' : updateStatus?.ok ? 'ok' : undefined}>{updateLabel}</Status>} description={updateStatus?.available ? 'Pulls the latest code, installs packages and rebuilds.' : 'Checks GitHub for a newer commit.'} stacked>
                  <div className="about-update">
                    <MosaicButton busy={checking} disabled={checking || updateBusy} onClick={runUpdateCheck}>
                      {checking ? 'Checking for updates…' : updateStatus?.ok && !updateStatus.available ? 'Up to date · check again' : 'Check for updates'}
                    </MosaicButton>
                    {updateStatus?.available ? <button className="btn is-primary" onClick={installUpdate} disabled={updateBusy}>{updateBusy ? 'Installing…' : 'Install update'}</button> : null}
                  </div>
                </Row>
              )}
            </Group> : null}

            <Group title="Links">
              <div className="about-links">
                <a href={githubUrl} target="_blank" rel="noreferrer"><Github size={15} /><span>Source on GitHub</span><ExternalLink size={12} /></a>
                <a href={`${githubUrl}/issues`} target="_blank" rel="noreferrer"><Bug size={15} /><span>Report an issue</span><ExternalLink size={12} /></a>
                <a href="https://tristmeister.github.io/HEISS-UI/" target="_blank" rel="noreferrer"><Globe size={15} /><span>Website</span><ExternalLink size={12} /></a>
                <a href={`${githubUrl}/blob/main/LICENSE`} target="_blank" rel="noreferrer"><Scale size={15} /><span>MIT license</span><ExternalLink size={12} /></a>
              </div>
            </Group>

            <Group title="Credits">
              <Row label="J-AI Studio by Jasper" description="HEISS UI started as a fork of J-AI Studio. The calm, prompt-first idea and much of the foundation are his work.">
                <a className="btn is-ghost" href="https://github.com/jasperdevs/J-AI-Studio" target="_blank" rel="noreferrer"><ExternalLink size={13} /> J-AI Studio</a>
              </Row>
              <Row label="ComfyUI" description="Renders every image and video.">
                <a className="btn is-ghost" href="https://github.com/comfyanonymous/ComfyUI" target="_blank" rel="noreferrer"><ExternalLink size={13} /> ComfyUI</a>
              </Row>
            </Group>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

import React from 'react';
import { Copy, Download, ExternalLink, FolderOpen, Github, Info, LockKeyhole, Plug, RefreshCw, Sparkles, SlidersHorizontal, Wand2, Library } from 'lucide-react';
import { githubUrl } from './constants';
import { cn } from './format';
import { NumberPicker, Skeleton } from './components';
import { Modal } from './Modal';

export const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, description: 'How the studio looks and behaves.' },
  { id: 'generation', label: 'Generation', icon: Wand2, description: 'The composer, previews and the values new workflows start from.' },
  { id: 'upscale', label: 'Upscale', icon: Sparkles, description: 'A one-click SeedVR2 restore pass behind the arrow on finished images.' },
  { id: 'library', label: 'Library', icon: Library, description: 'Where outputs live and how the gallery groups them.' },
  { id: 'privacy', label: 'Privacy', icon: LockKeyhole, description: 'Encrypt prompts and private generations behind a password.' },
  { id: 'connection', label: 'Connection', icon: Plug, description: 'ComfyUI, installed models and other devices on your network.' },
  { id: 'about', label: 'About', icon: Info, description: 'Version, updates and resetting things.' }
] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number]['id'];

/* ------------------------------------------------------------ Primitives */

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="switch" onClick={() => onChange(!checked)}>
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

function Status({ tone, children }: React.PropsWithChildren<{ tone?: 'ok' | 'bad' | 'warn' }>) {
  return <span className={cn('set-status', tone && `is-${tone}`)}><i aria-hidden="true" />{children}</span>;
}

/* ------------------------------------------------------------ Helpers */

function formatInstallBytes(bytes = 0) {
  if (!bytes) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const upscaleEfforts = [
  { value: 'fast', label: 'Fast', detail: '1.5× with the 3B model. Lowest VRAM.' },
  { value: 'balanced', label: 'Balanced', detail: '2× with the 7B fp8 model.' },
  { value: 'high', label: 'High', detail: '3× with the 7B fp16 model. Slowest, needs the most VRAM.' }
] as const;

function UpscaleReadiness({ status, reason, install, onRefresh, onCancel, onSetup }: { status: any; reason?: string; install: any; onRefresh: () => void; onCancel: () => void; onSetup: () => void }) {
  if (install?.status === 'running') {
    const ratio = install.totalBytes ? Math.min(1, install.receivedBytes / install.totalBytes) : 0;
    return (
      <Row label={`Downloading ${install.current}`} description={`${formatInstallBytes(install.receivedBytes)} of ${formatInstallBytes(install.totalBytes)}`} stacked>
        <div className="set-progress"><div style={{ width: `${Math.round(ratio * 100)}%` }} /></div>
        <button className="btn" onClick={onCancel}>Cancel download</button>
      </Row>
    );
  }
  if (install?.status === 'error' && install.error) return <Row label={<Status tone="bad">Download failed</Status>} description={install.error}><button className="btn" onClick={() => onRefresh()}>Re-check</button></Row>;
  if (install?.status === 'done' && install.restartHint) return <Row label={<Status tone="ok">Models installed</Status>} description="Restart ComfyUI if the upscale still reports them as missing."><button className="btn" onClick={() => onRefresh()}>Re-check</button></Row>;
  if (!status || typeof status.nodesInstalled !== 'boolean') return <Row label={<Status tone="warn">Unavailable</Status>} description={reason || 'Smart upscale is unavailable right now.'}><button className="btn" onClick={() => onRefresh()}>Re-check</button></Row>;
  if (!status.nodesInstalled) {
    return (
      <Row label={<Status tone="warn">Needs the SeedVR2 nodes</Status>} description="ComfyUI does not have them installed yet.">
        <button className="btn" onClick={() => onRefresh()}>Re-check</button>
        <button className="btn is-primary" onClick={onSetup}>How to install</button>
      </Row>
    );
  }
  if (status.needsDownload) {
    const missing = (status.models || []).filter((model: any) => !model.present).map((model: any) => model.label).join(' and ');
    return <Row label={<Status tone="warn">Ready after a download</Status>} description={`The first upscale at this effort downloads ${missing} into ${status.modelDir || 'the ComfyUI models folder'}.`} />;
  }
  if (status.substituting) return <Row label={<Status tone="ok">Ready</Status>} description="Using the SeedVR2 weights already installed instead of this effort's preferred model." />;
  return <Row label={<Status tone="ok">Ready</Status>} description="Hover a finished image and click the arrow in its top-left corner." />;
}

/* ------------------------------------------------------------ Dialog */

export function SettingsDialog({ view, open, section, onSectionChange, onClose }: { view: Record<string, any>; open: boolean; section: SettingsSection; onSectionChange: (section: SettingsSection) => void; onClose: () => void }) {
  const {
    prefs, setPrefs, setZenMode, zenGalleryOpen, setZenGalleryOpen,
    upscaleStatus, upscaleUnavailableReason, upscaleInstall, refreshUpscaleStatus, cancelUpscaleInstall, setUpscaleSetupOpen,
    gallery, galleryLoaded, paths, outputDirDraft, setOutputDirDraft, saveOutputDirectory, openOutputFolder, copyAndToast, showToast,
    clearFailedItems, clearGallery, clearAllCache, resetAllSettings,
    privacyStatus, privacyBusy, privacyPassword, setPrivacyPassword, privacyConfirmPassword, setPrivacyConfirmPassword,
    setupPrivacyPassword, unlockPrivacy, lockPrivacy, refreshPrivacyStatus,
    health, refreshHealth, models, refreshModels, refreshWorkflows,
    updateStatus, updateBusy, checkForUpdates, installUpdate
  } = view;
  const current = SETTINGS_SECTIONS.find((item) => item.id === section) || SETTINGS_SECTIONS[0];

  const [lanBusy, setLanBusy] = React.useState(false);
  const copyLanUrl = React.useCallback(async () => {
    setLanBusy(true);
    try {
      const response = await fetch('/api/network');
      if (!response.ok) throw new Error('LAN address unavailable');
      const data = await response.json();
      const address = data.addresses?.[0];
      if (!address) throw new Error('No local network address found');
      copyAndToast(`${window.location.protocol}//${address}:${window.location.port || 5173}`, 'LAN URL copied');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not find LAN address', 'error');
    } finally {
      setLanBusy(false);
    }
  }, [copyAndToast, showToast]);

  const privacyState: 'off' | 'locked' | 'unlocked' = !privacyStatus?.enabled ? 'off' : privacyStatus.unlocked ? 'unlocked' : 'locked';
  const upscaleOn = prefs.smartUpscale !== false;
  const effort = upscaleEfforts.find((item) => item.value === (prefs.upscaleQuality || 'balanced')) || upscaleEfforts[1];
  const faceDetailReady = Boolean(upscaleStatus?.faceDetail?.nodesInstalled);
  const connected = Boolean(health?.ok);
  const updateLabel = updateStatus?.error || (updateStatus?.available ? `${updateStatus.behind || 1} update${updateStatus.behind === 1 ? '' : 's'} available` : updateStatus?.ok ? 'Up to date' : 'Not checked yet');

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) onClose(); }} size="sheet" className="settings-modal" bodyClassName="set-layout" title="Settings">
      <nav className="set-nav" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} type="button" className={cn('set-nav-item', section === item.id && 'active')} aria-current={section === item.id ? 'page' : undefined} onClick={() => onSectionChange(item.id)}>
              <Icon size={15} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="set-panel" key={section}>
        <header className="set-page-head">
          <h3>{current.label}</h3>
          <p>{current.description}</p>
        </header>

        {section === 'general' ? (
          <>
            <Group title="Layout">
              <SwitchRow label="Zen mode" description="A prompt-first fullscreen layout. Press Escape to leave it." checked={prefs.zenMode} onChange={setZenMode} />
              <SwitchRow label="Gallery strip in zen" description="Show recent outputs as a strip across the top." checked={zenGalleryOpen} onChange={setZenGalleryOpen} />
              <SwitchRow label="Follow the latest output" description="Jump to each new image as it finishes." checked={prefs.followLatest} onChange={(next) => setPrefs({ followLatest: next })} />
            </Group>
            <Group title="Safety">
              <SwitchRow label="Confirm before removing things" description="Ask before deleting, cancelling, resetting or clearing the cache." checked={prefs.confirmActions} onChange={(next) => setPrefs({ confirmActions: next })} />
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
                    <Segmented label="Upscale effort" value={effort.value} onChange={(next) => setPrefs({ upscaleQuality: next })} options={upscaleEfforts.map(({ value, label }) => ({ value, label }))} />
                  </Row>
                  <SwitchRow
                    label="Face detail pass"
                    description={faceDetailReady ? 'Run the Impact Pack FaceDetailer after the upscale.' : 'Needs the ComfyUI Impact Pack and Impact Subpack nodes.'}
                    checked={Boolean(prefs.upscaleFaceDetail) && faceDetailReady}
                    disabled={!faceDetailReady}
                    onChange={(next) => setPrefs({ upscaleFaceDetail: next })}
                  />
                </Group>
                <Group title="Status">
                  <UpscaleReadiness status={upscaleStatus} reason={upscaleUnavailableReason} install={upscaleInstall} onRefresh={refreshUpscaleStatus} onCancel={cancelUpscaleInstall} onSetup={() => setUpscaleSetupOpen(true)} />
                </Group>
              </>
            ) : null}
          </>
        ) : null}

        {section === 'library' ? (
          <>
            <Group title="Folders" note="Private Vault needs the output folder: HEISS UI only picks up and removes finished outputs from that exact folder.">
              <Row label="Output folder" description={galleryLoaded ? `${gallery.length} item${gallery.length === 1 ? '' : 's'} in the gallery` : undefined} stacked>
                <form className="set-inline-form" onSubmit={(event) => { event.preventDefault(); saveOutputDirectory(); }}>
                  <input className="modal-input" aria-label="Output folder" value={outputDirDraft} placeholder="ComfyUI output folder" onChange={(event) => setOutputDirDraft(event.target.value)} />
                  <button className="btn" type="submit" disabled={!outputDirDraft.trim() || outputDirDraft.trim() === paths.outputDir}>Save</button>
                </form>
                <div className="set-actions">
                  <button className="btn is-ghost" onClick={openOutputFolder} disabled={!paths.outputDir}><FolderOpen size={14} /> Open</button>
                  <button className="btn is-ghost" onClick={() => copyAndToast(paths.outputDir || '', 'Output path copied')} disabled={!paths.outputDir}><Copy size={14} /> Copy path</button>
                </div>
              </Row>
              <Row label="Workflows folder" description={paths.workflowsDir ? <code className="set-path">{paths.workflowsDir}</code> : <Skeleton className="skeleton-text path" />}>
                <button className="btn is-ghost" onClick={() => { refreshModels(); refreshWorkflows(); }}><RefreshCw size={14} /> Reload</button>
              </Row>
            </Group>
            <Group title="Runs" note="Grouping is exact and local, never similarity matching. Private outputs only group with each other, inside the vault.">
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
              <Row label="Export gallery" description={privacyState === 'locked' ? 'Unlock Private Vault to export normal and private items together.' : 'Normal and private items in one ZIP file.'} disabled={privacyState === 'locked'}>
                {privacyState === 'locked'
                  ? <button className="btn" onClick={() => onSectionChange('privacy')}>Unlock</button>
                  : <a className="btn" href="/api/gallery/export" download><Download size={14} /> Export</a>}
              </Row>
            </Group>
          </>
        ) : null}

        {section === 'privacy' ? (
          <>
            <Group>
              <Row
                label={<Status tone={privacyState === 'unlocked' ? 'ok' : privacyState === 'locked' ? 'warn' : undefined}>{privacyState === 'off' ? 'Private Vault is off' : privacyState === 'locked' ? 'Locked' : 'Unlocked'}</Status>}
                description={privacyState === 'off'
                  ? 'Set a password to encrypt prompts and keep opted-in generations in an encrypted vault. The normal gallery stays as it is.'
                  : privacyState === 'locked'
                    ? 'Prompts and private items stay encrypted until you enter the password.'
                    : 'Prompts and private items are readable in this session.'}
              >
                <button className="btn is-ghost" aria-label="Refresh privacy status" onClick={refreshPrivacyStatus} disabled={privacyBusy}><RefreshCw size={14} /></button>
              </Row>
            </Group>

            {privacyState === 'off' ? (
              <Group title="Create a password" note="There's no way to reset this password, so keep it somewhere safe. It also protects LAN access.">
                <Row label="Password" description="At least 8 characters." stacked>
                  <form className="set-stack" onSubmit={(event) => { event.preventDefault(); setupPrivacyPassword(); }}>
                    <input className="modal-input" type="password" autoComplete="new-password" aria-label="New password" placeholder="Password" value={privacyPassword} onChange={(event) => setPrivacyPassword(event.target.value)} />
                    <input className="modal-input" type="password" autoComplete="new-password" aria-label="Confirm password" placeholder="Confirm password" value={privacyConfirmPassword} onChange={(event) => setPrivacyConfirmPassword(event.target.value)} />
                    <div className="set-actions">
                      <button className="btn is-primary" type="submit" disabled={privacyBusy || privacyPassword.length < 8 || !privacyConfirmPassword}>{privacyBusy ? 'Saving…' : 'Turn on Private Vault'}</button>
                    </div>
                  </form>
                </Row>
              </Group>
            ) : privacyState === 'locked' ? (
              <Group title="Unlock">
                <Row label="Password" stacked>
                  <form className="set-inline-form" onSubmit={(event) => { event.preventDefault(); unlockPrivacy(); }}>
                    <input className="modal-input" type="password" autoComplete="current-password" aria-label="Privacy password" placeholder="Privacy password" value={privacyPassword} onChange={(event) => setPrivacyPassword(event.target.value)} />
                    <button className="btn is-primary" type="submit" disabled={privacyBusy || !privacyPassword}>{privacyBusy ? 'Unlocking…' : 'Unlock'}</button>
                  </form>
                </Row>
              </Group>
            ) : (
              <Group title="Session">
                <Row label="Lock now" description="Hide prompts and private items again until the password is entered.">
                  <button className="btn is-primary" onClick={lockPrivacy} disabled={privacyBusy}>{privacyBusy ? 'Locking…' : 'Lock'}</button>
                </Row>
                {privacyStatus?.vault?.assetCount ? (
                  <Row label="Back up the vault" description={`${privacyStatus.vault.assetCount} encrypted item${privacyStatus.vault.assetCount === 1 ? '' : 's'}. The archive can only be opened with this password.`}>
                    <a className="btn" href="/api/vault/export" download><Download size={14} /> Export</a>
                  </Row>
                ) : null}
              </Group>
            )}
          </>
        ) : null}

        {section === 'connection' ? (
          <>
            <Group title="ComfyUI">
              <Row
                label={health ? <Status tone={connected ? 'ok' : 'bad'}>{connected ? 'Connected' : 'Not connected'}</Status> : <Skeleton className="skeleton-text short" />}
                description={health ? (connected ? health.comfyUrl : health.error || `Start ComfyUI at ${health.comfyUrl || 'http://127.0.0.1:8188'}, then check again.`) : undefined}
              >
                <button className="btn is-primary" onClick={refreshHealth}>Check again</button>
              </Row>
              <Row label="Open ComfyUI" description="Its own interface, in a new tab.">
                <button className="btn" onClick={() => window.open(health?.comfyUrl || 'http://127.0.0.1:8188', '_blank')}><ExternalLink size={14} /> Open</button>
              </Row>
            </Group>
            <Group title="Models">
              <Row label="Image models"><span className="set-value">{models ? models.imageModels.length : <Skeleton className="skeleton-text tiny" />}</span></Row>
              <Row label="Video models"><span className="set-value">{models ? models.videoModels.length : <Skeleton className="skeleton-text tiny" />}</span></Row>
              {(models?.unsupportedModels?.length || 0) > 0 ? <Row label="Not supported" description="Found on disk, but no workflow can run them."><span className="set-value">{models.unsupportedModels.length}</span></Row> : null}
              <Row label="Rescan" description="Pick up models and workflows added since the studio started.">
                <button className="btn" onClick={() => { refreshModels(); refreshWorkflows(); }}><RefreshCw size={14} /> Rescan</button>
              </Row>
            </Group>
            <Group title="Other devices" note={<>Start the studio with <code>npm run dev:lan</code> first. With Private Vault on, other devices need the password.</>}>
              <Row label="Open on your phone or another computer" description={`This studio runs at ${window.location.host || 'localhost'}.`}>
                <button className="btn" onClick={copyLanUrl} disabled={lanBusy}><Copy size={14} /> {lanBusy ? 'Finding…' : 'Copy LAN URL'}</button>
              </Row>
            </Group>
          </>
        ) : null}

        {section === 'about' ? (
          <>
            <Group>
              <div className="set-about">
                <img src="/heiss-mark-white.svg" alt="" />
                <div>
                  <strong>HEISS UI</strong>
                  <span>A local image and video studio for ComfyUI. Based on <a href="https://github.com/jasperdevs/J-AI-Studio" target="_blank" rel="noreferrer">J-AI Studio</a> by Jasper.</span>
                </div>
                <a className="btn" href={githubUrl} target="_blank" rel="noreferrer"><Github size={14} /> GitHub</a>
              </div>
            </Group>
            <Group title="Updates" note={updateStatus?.restartRequired ? 'Restart the local server to finish updating.' : undefined}>
              <Row label={<Status tone={updateStatus?.error ? 'bad' : updateStatus?.available ? 'warn' : updateStatus?.ok ? 'ok' : undefined}>{updateLabel}</Status>} description={updateStatus?.current ? `${updateStatus.branch || 'main'} · ${String(updateStatus.current).slice(0, 7)}` : undefined}>
                {updateStatus?.available
                  ? <button className="btn is-primary" onClick={installUpdate} disabled={updateBusy}>{updateBusy ? 'Installing…' : 'Install update'}</button>
                  : <button className="btn" onClick={() => checkForUpdates()} disabled={updateBusy}>{updateBusy ? 'Checking…' : 'Check for updates'}</button>}
              </Row>
            </Group>
            <Group title="Reset" tone="danger" note="Generated files on disk are never touched.">
              <Row label="Clear the gallery" description="Remove finished items from what HEISS UI shows.">
                <button className="btn is-danger-soft" onClick={clearGallery}>Clear gallery</button>
              </Row>
              <Row label="Clear all cache" description="Browser cache, stale queue state, and ComfyUI memory.">
                <button className="btn is-danger-soft" onClick={clearAllCache}>Clear cache</button>
              </Row>
              <Row label="Reset all settings" description="Prompts, layout, model choices, LoRA stacks and every preference here.">
                <button className="btn is-danger-soft" onClick={resetAllSettings}>Reset</button>
              </Row>
            </Group>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

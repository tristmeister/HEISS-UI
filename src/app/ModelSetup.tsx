import React from 'react';
import { Download, ExternalLink, X } from 'lucide-react';
import { apiJson } from './api';
import { ComfyRestart } from './ComfyRestart';
import { cn } from './format';
import type { DownloadState, MissingPart, ModelDownload, Profile } from './types';

function formatBytes(bytes = 0) {
  if (!bytes) return '';
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

const partVerb: Record<MissingPart['part'], string> = {
  encoder: 'text encoder',
  vae: 'VAE',
  model: 'model file',
  comfy: 'update'
};

/**
 * What the selected model still needs before it can run, each part with a
 * one-click download into ComfyUI's own folder (or a link when ComfyUI runs on
 * another machine). Rescans the models once a download lands.
 */
export function ModelSetup({ profile, onInstalled, showToast }: { profile: Profile; onInstalled: () => void; showToast: (message: string, tone?: string) => void }) {
  const [downloads, setDownloads] = React.useState<DownloadState | null>(null);
  const [remote, setRemote] = React.useState(false);
  const missing = profile.missing || [];
  const busy = Boolean(downloads?.active || downloads?.queued.length);
  // Set once a file lands; if the model still reports it missing after the rescan, a restart is the fix.
  const [landed, setLanded] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      setDownloads(await apiJson<DownloadState & { ok: boolean }>('/api/models/downloads'));
    } catch {
      // The panel still works as a list of links without progress.
    }
  }, []);

  React.useEffect(() => { refresh(); }, [refresh, profile.id]);

  // Poll only while something is moving; rescan models when a file lands.
  const finishedRef = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [busy, refresh]);
  React.useEffect(() => {
    for (const item of downloads?.recent || []) {
      const key = `${item.id}:${item.status}`;
      if (finishedRef.current.has(key)) continue;
      finishedRef.current.add(key);
      if (item.status === 'done') { onInstalled(); setLanded(true); }
      if (item.status === 'error') showToast(item.error || `${item.label} failed to download`, 'error');
    }
  }, [downloads, onInstalled, showToast]);

  if (!missing.length) return null;

  const stateFor = (file: string): ModelDownload | undefined => {
    if (downloads?.active?.file === file) return downloads.active;
    return downloads?.queued.find((item) => item.file === file);
  };

  const start = async (id: string) => {
    try {
      const data = await apiJson<DownloadState & { ok: boolean }>('/api/models/downloads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id })
      });
      setDownloads(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed';
      if (/not on this computer/i.test(message)) setRemote(true);
      showToast(message, 'error');
    }
  };

  const cancel = async (id: string) => {
    try {
      setDownloads(await apiJson<DownloadState & { ok: boolean }>('/api/models/downloads/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id })
      }));
    } catch { /* the next poll shows the truth */ }
  };

  const fetchable = missing.filter((item) => item.downloads.length);

  return (
    <section className="model-setup" aria-label="Files this model needs">
      <header className="model-setup-head">
        <strong>{fetchable.length === missing.length ? `Needs ${missing.length} more file${missing.length === 1 ? '' : 's'}` : 'Not ready yet'}</strong>
        <span>{profile.encoderBuiltIn === false && profile.source === 'checkpoint' ? 'This checkpoint ships without everything it needs.' : `${profile.displayName} can run once these are in place.`}</span>
      </header>
      <ul className="model-setup-list">
        {missing.map((item) => {
          const download = item.downloads[0];
          const state = download ? stateFor(download.file) : undefined;
          const progress = state && state.totalBytes ? Math.min(1, state.receivedBytes / state.totalBytes) : 0;
          return (
            <li key={`${item.part}:${item.slot || item.kind || item.label}`} className={cn('model-setup-item', state && 'is-busy')}>
              <div className="model-setup-copy">
                <strong>{item.label}</strong>
                <span>{item.detail || `Missing ${partVerb[item.part]}.`}</span>
              </div>
              {download ? (
                <div className="model-setup-actions">
                  {state ? (
                    <>
                      <span className="model-setup-progress" aria-label={`${Math.round(progress * 100)} percent`}>
                        <i style={{ transform: `scaleX(${progress})` }} />
                      </span>
                      <span className="model-setup-meta">{state.status === 'queued' ? 'Waiting' : `${Math.round(progress * 100)}%`}</span>
                      <button type="button" className="btn is-ghost is-icon" aria-label={`Stop downloading ${download.file}`} onClick={() => cancel(state.id)}><X size={14} /></button>
                    </>
                  ) : (
                    <>
                      {!remote ? (
                        <button type="button" className="btn" onClick={() => start(download.id)} title={download.file}>
                          <Download size={14} /> Download{download.bytes ? ` · ${formatBytes(download.bytes)}` : ''}
                        </button>
                      ) : null}
                      <a className="btn is-ghost is-icon" href={download.url.replace('/resolve/', '/blob/')} target="_blank" rel="noreferrer" aria-label={`Open ${download.file} on Hugging Face`} title={download.file}>
                        <ExternalLink size={14} />
                      </a>
                    </>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {landed && !busy && !remote ? (
        <div className="model-setup-restart">
          <p className="model-setup-note">Downloaded, but ComfyUI has not picked it up yet. A restart makes it load the new file.</p>
          <ComfyRestart compact onBack={onInstalled} />
        </div>
      ) : null}
      {remote ? <p className="model-setup-note">ComfyUI runs on another computer, so put these files into its models folders there, then rescan.</p> : null}
    </section>
  );
}

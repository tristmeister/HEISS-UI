import React from 'react';
import { Check, Download, Pause, Play, RotateCw } from 'lucide-react';
import { apiJson } from './api';
import { cn } from './format';
import { Modal } from './Modal';
import { CellBar } from './UpscaleDialogs';
import { formatEta } from './UpscaleDownloadActivity';
import { downloadFor, useModelDownloads } from './useModelDownloads';
import { formatDownload, formatGB, hardwareSentence, memoryWord, type Hardware } from './hardware';
import { useThisComputer } from './device';
import type { ModelDownload } from './types';
import type { ShowToast } from './toast';

/**
 * "Pick a first model": Krea 2, Flux.2 and SDXL, each in three versions for
 * different amounts of memory (server/starter-models.js). The version that
 * suits this computer is picked and marked; the others stay one tap away and
 * nothing is ever greyed out or warned about. One tap fetches the model with
 * its text encoder and VAE through the same downloads as the setup panel.
 */

type StarterDownload = { id: string; file: string; folder: string; label: string; bytes: number; onDisk: boolean; part: 'encoder' | 'vae' | 'model' };
type StarterVersion = {
  id: string; family: string; label: string; detail: string; memoryGB: number; ramGB?: number; fp8: boolean;
  file: string; downloads: StarterDownload[]; totalBytes: number; remainingBytes: number; installed: boolean; fits: boolean | null;
};
type StarterFamily = { family: string; title: string; blurb: string; versions: StarterVersion[]; best: string | null };
type StarterPlan = { hardware: Hardware | null; local: boolean; families: StarterFamily[] };

/** What the studio does once a starter model is in place: select it and offer a prompt. */
export type StarterPick = { family: string; file: string; title: string };

let planCache: StarterPlan | null = null;

function useStarterPlan() {
  const [plan, setPlan] = React.useState<StarterPlan | null>(planCache);
  const load = React.useCallback(() => {
    apiJson<StarterPlan & { ok: boolean }>('/api/starter-models')
      .then((data) => { planCache = data; setPlan(data); })
      .catch(() => null);
  }, []);
  React.useEffect(() => { load(); }, [load]);
  return { plan, reload: load };
}

type Progress = { state: 'idle' | 'moving' | 'paused' | 'error' | 'done'; received: number; total: number; speed: number; error: string; retryable: boolean };

/** One version's files, summed: how far along they are and what they are doing. */
function progressOf(version: StarterVersion, state: ReturnType<typeof useModelDownloads>['state'], landed: Set<string>): Progress {
  let received = 0;
  let total = 0;
  let speed = 0;
  let moving = false;
  let paused = false;
  let error: ModelDownload | undefined;
  let pending = false;
  for (const item of version.downloads) {
    const current = downloadFor(state, item.file);
    const size = current?.totalBytes || item.bytes || 0;
    total += size;
    if (item.onDisk || landed.has(item.file) || current?.status === 'done') { received += size; continue; }
    pending = true;
    received += current?.receivedBytes || 0;
    if (current?.status === 'downloading' || current?.status === 'queued') moving = true;
    if (current?.status === 'downloading') speed = current.bytesPerSecond || 0;
    if (current?.status === 'paused') paused = true;
    if (current?.status === 'error') error = current;
  }
  const status: Progress['state'] = !pending ? 'done' : moving ? 'moving' : error ? 'error' : paused ? 'paused' : 'idle';
  return { state: status, received, total, speed, error: error?.error || '', retryable: error?.retryable !== false };
}

export function StarterModels({ showToast, onStarted, onUse, compact = false }: {
  showToast: ShowToast;
  /** Downloads for a version were started; the studio selects it once it is in place. */
  onStarted: (pick: StarterPick) => void;
  /** A version that is already installed: select it now. */
  onUse: (file: string) => void;
  /** Inside the "Get a model" sheet rather than on the empty stage. */
  compact?: boolean;
}) {
  const { plan, reload } = useStarterPlan();
  const { state, landed, start, pause } = useModelDownloads({ onDone: () => reload() });
  const thisComputer = useThisComputer();
  const [chosen, setChosen] = React.useState<Record<string, string>>({});
  if (!plan) return <div className={cn('starter-models', 'is-loading', compact && 'is-compact')} aria-busy="true" />;
  const hardware = plan.hardware;
  const canDownload = plan.local !== false && thisComputer;
  const sentence = hardwareSentence(hardware);

  const get = async (family: StarterFamily, version: StarterVersion) => {
    try {
      // The model file last: the studio lists it once every part is in place, ready to run.
      for (const item of version.downloads) if (!item.onDisk && !landed.has(item.file)) await start(item.id);
      onStarted({ family: version.family, file: version.file, title: family.title });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The download could not start', 'error');
    }
  };
  const stop = async (version: StarterVersion) => {
    for (const item of version.downloads) {
      const current = downloadFor(state, item.file);
      if (current && (current.status === 'downloading' || current.status === 'queued')) await pause(current.id).catch(() => null);
    }
  };

  return (
    <div className={cn('starter-models', compact && 'is-compact')}>
      <p className="starter-note">
        {sentence ? <>{sentence} </> : null}Each version shows the {memoryWord(hardware)} it runs in.
      </p>
      <div className="starter-grid">
        {plan.families.map((family) => {
          const selectedId = chosen[family.family] || family.best || family.versions[0]?.id;
          const version = family.versions.find((item) => item.id === selectedId) || family.versions[0];
          if (!version) return null;
          const fitting = family.versions.filter((item) => item.fits).length;
          const progress = progressOf(version, state, landed);
          const ready = version.installed || progress.state === 'done';
          const fitNote = version.fits ? (version.id === family.best && fitting > 1 ? 'Best on this computer' : 'Fits this computer') : '';
          const left = progress.total - progress.received;
          return (
            <article key={family.family} className={cn('starter-card', progress.state !== 'idle' && !ready && 'is-busy')} aria-label={family.title}>
              <header className="starter-card-head">
                <h3>{family.title}</h3>
                <p>{family.blurb}</p>
              </header>
              <div className="starter-versions" role="radiogroup" aria-label={`${family.title} versions`}>
                {family.versions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={item.id === version.id}
                    className={cn('starter-version', item.id === version.id && 'is-selected')}
                    onClick={() => setChosen((current) => ({ ...current, [family.family]: item.id }))}
                  >
                    <span className="starter-version-name">
                      <strong>{item.label}{item.id === family.best ? <i className="starter-best-dot" aria-label="Suits this computer" /> : null}</strong>
                      <small>{item.detail}</small>
                    </span>
                    <span className="starter-version-memory">{item.installed ? <Check size={13} strokeWidth={2.6} aria-label="Installed" /> : formatGB(item.memoryGB)}</span>
                  </button>
                ))}
              </div>
              <p className="starter-caption">
                <span>{ready ? 'In place' : `${formatDownload(version.remainingBytes || version.totalBytes)} download`}</span>
                {fitNote ? <span className="starter-fit"><i aria-hidden="true" />{fitNote}</span> : null}
              </p>
              <footer className="starter-card-foot">
                {ready ? (
                  <button type="button" className="btn" onClick={() => onUse(version.file)}><Check size={14} /> Use {family.title}</button>
                ) : !canDownload ? (
                  <p className="starter-remote">{thisComputer ? 'ComfyUI runs on another computer. Get it there.' : 'Get it on the computer running HEISS UI.'}</p>
                ) : progress.state === 'moving' || progress.state === 'paused' ? (
                  <div className="starter-progress">
                    <CellBar value={progress.total ? progress.received / progress.total : 0} />
                    <div className="starter-progress-row">
                      <small>
                        {progress.state === 'paused' ? 'Paused' : 'Downloading'} · {formatDownload(progress.received) || '0 MB'} of {formatDownload(progress.total)}
                        {progress.state === 'moving' && progress.speed > 0 ? ` · ${formatEta(left / progress.speed)}` : ''}
                      </small>
                      {progress.state === 'moving'
                        ? <button type="button" className="btn is-ghost is-icon" aria-label={`Pause ${family.title}`} title="Pause" onClick={() => stop(version)}><Pause size={14} /></button>
                        : <button type="button" className="btn is-ghost is-icon" aria-label={`Resume ${family.title}`} title="Resume" onClick={() => get(family, version)}><Play size={14} /></button>}
                    </div>
                  </div>
                ) : progress.state === 'error' ? (
                  <div className="starter-progress">
                    <p className="starter-error">{progress.error || 'The download stopped.'}</p>
                    <button type="button" className="btn" onClick={() => get(family, version)}><RotateCw size={13} /> {progress.retryable ? 'Resume' : 'Try again'}</button>
                  </div>
                ) : (
                  <button type="button" className="btn" onClick={() => get(family, version)}>
                    <Download size={14} /> Get {family.title}
                  </button>
                )}
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/** The same picks later on, from the model menu's "Get more models". */
export function GetModelsSheet({ open, onOpenChange, showToast, onStarted, onUse, onFindModels }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showToast: ShowToast;
  onStarted: (pick: StarterPick) => void;
  onUse: (file: string) => void;
  onFindModels?: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Get a model"
      description="Each one downloads with everything it needs, and is selected once it’s in place."
      className="starter-sheet"
      footer={onFindModels ? <button type="button" className="btn is-ghost" onClick={() => { onOpenChange(false); onFindModels(); }}>Find models on this computer</button> : undefined}
    >
      <StarterModels compact showToast={showToast} onStarted={onStarted} onUse={(file) => { onOpenChange(false); onUse(file); }} />
    </Modal>
  );
}

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, FolderOpen, FolderPlus, RefreshCw } from 'lucide-react';
import { Modal } from './Modal';
import { AnimatedNumber } from './AnimatedNumber';
import { ComfyRestart } from './ComfyRestart';
import { ModelFoldersHero } from './ModelFoldersHero';
import { Watcher } from './UpscaleDialogs';
import { cn } from './format';
import { formatBytes } from './useUpscale';
import type { ModelFolders, ModelFolderStage } from './useModelFolders';
import type { StrayModelFolder } from './types';

const kindNames: Record<string, [string, string]> = {
  checkpoints: ['checkpoint', 'checkpoints'],
  diffusion_models: ['diffusion model', 'diffusion models'],
  loras: ['LoRA', 'LoRAs'],
  vae: ['VAE', 'VAEs'],
  text_encoders: ['text encoder', 'text encoders'],
  controlnet: ['ControlNet', 'ControlNets'],
  upscale_models: ['upscaler', 'upscalers'],
  clip_vision: ['vision encoder', 'vision encoders'],
  embeddings: ['embedding', 'embeddings'],
  diffusers: ['diffusers model', 'diffusers models']
};

function kindLabel(kind: string, count: number) {
  const [one, many] = kindNames[kind] || [kind.replace(/_/g, ' '), kind.replace(/_/g, ' ')];
  return `${count} ${count === 1 ? one : many}`;
}

/** "3 LoRAs · 1 diffusion model", merging kinds that come from two folders (unet and diffusion_models). */
export function folderSummary(folder: StrayModelFolder) {
  const byKind = new Map<string, number>();
  for (const item of folder.kinds) byKind.set(item.kind, (byKind.get(item.kind) || 0) + item.count);
  return [...byKind].sort((a, b) => b[1] - a[1]).map(([kind, count]) => kindLabel(kind, count)).join(' · ');
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const STEPS = [
  { label: 'Find', stages: ['scanning', 'found', 'none', 'remote', 'offline'] },
  { label: 'Add', stages: ['adding'] },
  { label: 'Restart', stages: ['restarting', 'waiting'] }
] as const;

function Steps({ stage }: { stage: ModelFolderStage }) {
  const current = stage === 'done' ? STEPS.length : Math.max(0, STEPS.findIndex((step) => (step.stages as readonly string[]).includes(stage)));
  return (
    <ol className="upscale-stepper" aria-label="Setup steps">
      {STEPS.map((step, index) => {
        const state = index < current ? 'done' : index === current && stage !== 'error' ? 'active' : 'todo';
        return (
          <li key={step.label} className={`is-${state}`} aria-current={state === 'active' ? 'step' : undefined}>
            <i aria-hidden="true">{state === 'done' ? <Check size={10} strokeWidth={3} /> : null}</i>
            <span>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function copyFor(stage: ModelFolderStage, folders: StrayModelFolder[], added: ModelFolders['added']): { title: string; description: string } {
  const count = folders.reduce((sum, folder) => sum + folder.count, 0);
  switch (stage) {
    case 'scanning': return { title: 'Searching for models', description: 'Checking your folders, other ComfyUI installs and connected drives.' };
    case 'found': return {
      title: `Add ${plural(count, 'model')}`,
      description: folders.length === 1
        ? `They’re in ${folders[0].name}, which ComfyUI doesn’t read.`
        : `They’re in ${plural(folders.length, 'folder')} ComfyUI doesn’t read.`
    };
    case 'none': return { title: 'All your models are in ComfyUI', description: 'Keep models somewhere else? Choose the folder.' };
    case 'remote': return { title: 'ComfyUI runs on another computer', description: 'HEISS UI can only look through the folders of the computer it runs on.' };
    case 'offline': return { title: 'Waiting for ComfyUI', description: 'Start ComfyUI to continue.' };
    case 'adding': return { title: 'Adding folders', description: 'The previous settings are kept as a backup.' };
    case 'restarting': return { title: 'Restarting ComfyUI', description: 'ComfyUI reads its model folders when it starts. This takes a few seconds.' };
    case 'waiting': return { title: 'Restart ComfyUI to finish', description: 'ComfyUI reads its model folders when it starts. Quit ComfyUI and open it again.' };
    case 'done': return {
      title: added.count ? `${plural(added.count, 'model')} ready` : 'Folder added',
      description: 'New files in it show up after a rescan.'
    };
    case 'error': return { title: 'Couldn’t add the folder', description: 'ComfyUI’s settings were not changed.' };
  }
}

function FolderCard({ folder, checked, onToggle, index, selectable }: { folder: StrayModelFolder; checked: boolean; onToggle: () => void; index: number; selectable: boolean }) {
  const reduced = useReducedMotion();
  const examples = folder.kinds.flatMap((item) => item.examples).slice(0, 2);
  const more = folder.count - examples.length;
  return (
    <motion.li
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.985 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', duration: 0.5, bounce: 0.18, delay: reduced ? 0 : 0.06 * index }}
    >
      <button type="button" role="checkbox" aria-checked={checked} className={cn('mf-folder', checked && 'is-checked')} onClick={onToggle} disabled={!selectable}>
        <span className="mf-check" aria-hidden="true">{checked ? <Check size={11} strokeWidth={3.2} /> : null}</span>
        <span className="mf-folder-copy">
          <strong>
            {folder.name}
            {folder.app && folder.app !== folder.name ? <em>{folder.app}</em> : null}
          </strong>
          <code title={folder.path}>{folder.label}</code>
          <span className="mf-kinds">{folderSummary(folder)}</span>
          {examples.length ? (
            <small title={folder.kinds.flatMap((item) => item.examples).join('\n')}>
              {examples.join(', ')}{more > 0 ? ` and ${more} more` : ''}
            </small>
          ) : null}
        </span>
        <span className="mf-count">
          <b>{folder.count}</b>
          <span>{formatBytes(folder.bytes)}</span>
        </span>
      </button>
    </motion.li>
  );
}

export function ModelFoldersDialog({ folders: state, runningCount = 0 }: { folders: ModelFolders; runningCount?: number }) {
  const { report, stage, open, error, selected, added } = state;
  const folders = report?.folders || [];
  const chosen = folders.filter((folder) => selected.includes(folder.path));
  const chosenCount = chosen.reduce((sum, folder) => sum + folder.count, 0);
  const heroFiles = stage === 'found' ? chosenCount : added.count || chosenCount;
  const { title, description } = copyFor(stage, folders, added);
  const toggle = (path: string) => state.setSelected(selected.includes(path) ? selected.filter((item) => item !== path) : [...selected, path]);
  const later = <button className="btn is-ghost" onClick={state.close}>Not now</button>;
  const choose = <button className="btn" onClick={state.pick}><FolderOpen size={14} /> Choose a folder…</button>;

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;

  if (stage === 'scanning') {
    body = <Watcher>Searching…</Watcher>;
  } else if (stage === 'found') {
    body = (
      <>
        <ul className="mf-folders">
          {folders.map((folder, index) => (
            <FolderCard key={folder.path} folder={folder} index={index} checked={selected.includes(folder.path)} onToggle={() => toggle(folder.path)} selectable={folders.length > 1 || !selected.includes(folder.path)} />
          ))}
        </ul>
        <p className="upscale-fine">
          Adds {chosen.length === 1 ? 'it' : 'them'} to <code title={report?.configPath}>extra_model_paths.yaml</code>.
          {runningCount ? <> ComfyUI restarts once, which stops the {plural(runningCount, 'generation')} still running.</> : <> ComfyUI restarts once.</>}
        </p>
        {report?.writable === false ? <p className="upscale-fine is-warn">HEISS UI may not change {report.configLabel}. Check its permissions, or add the folder in ComfyUI yourself.</p> : null}
      </>
    );
    footer = (
      <>
        <button className="btn is-ghost mf-other" onClick={state.pick}>Choose another folder…</button>
        {later}
        <button className="btn is-primary" onClick={() => state.add()} disabled={!chosen.length}>
          <FolderPlus size={14} /> Add {plural(chosenCount, 'model')}
        </button>
      </>
    );
  } else if (stage === 'none') {
    body = report?.linked?.length ? (
      <ul className="mf-linked">
        {report.linked.map((item) => <li key={item.path}><Check size={12} strokeWidth={3} /><code title={item.path}>{item.label}</code><span>{item.read ? 'Read by ComfyUI' : 'Restart ComfyUI to read it'}</span></li>)}
      </ul>
    ) : null;
    footer = <>{choose}<button className="btn is-primary" onClick={state.close}>Done</button></>;
  } else if (stage === 'remote') {
    body = (
      <div className="upscale-callout">
        <strong>Add the folder on that computer.</strong>
        <span>In ComfyUI’s folder there, copy <code>extra_model_paths.yaml.example</code> to <code>extra_model_paths.yaml</code>, set <code>base_path</code> to your models folder, and restart ComfyUI.</span>
      </div>
    );
    footer = <button className="btn is-primary" onClick={state.close}>Done</button>;
  } else if (stage === 'offline') {
    body = <Watcher>Waiting for ComfyUI…</Watcher>;
    footer = <>{later}<button className="btn" onClick={() => state.scan()}><RefreshCw size={13} /> Check again</button></>;
  } else if (stage === 'adding') {
    body = <Watcher>Adding folders…</Watcher>;
  } else if (stage === 'restarting' || stage === 'waiting') {
    body = (
      <>
        <ul className="mf-folders is-moving">
          {added.folders.map((folder) => (
            <li key={folder.path} className="mf-moving">
              <span className="mf-spinner" aria-hidden="true" />
              <strong>{folder.name}</strong>
              <span>{folderSummary(folder)}</span>
            </li>
          ))}
        </ul>
        <Watcher>{stage === 'restarting' ? 'Waiting for ComfyUI…' : 'Waiting for ComfyUI to restart…'}</Watcher>
        {stage === 'waiting' ? <ComfyRestart compact className="upscale-restart" /> : null}
      </>
    );
    footer = stage === 'waiting' ? <button className="btn is-ghost" onClick={state.close}>Finish later</button> : null;
  } else if (stage === 'done') {
    body = (
      <>
        {added.count ? (
          <div className="upscale-meter mf-meter">
            <strong><AnimatedNumber value={added.count} /></strong>
            <div>
              <span>From {added.folders.map((folder) => folder.name).join(', ')}</span>
              <span>Pick them in the model menu</span>
            </div>
          </div>
        ) : null}
        <ul className="upscale-files is-live mf-done">
          {added.folders.map((folder) => (
            <li key={folder.path} className="is-done">
              <div>
                <strong>{folder.name}</strong>
                <span className="mf-done-kinds">{folderSummary(folder)}</span>
                <code title={folder.path}>{folder.label}</code>
              </div>
              <span><Check size={12} strokeWidth={3} /> Added</span>
            </li>
          ))}
        </ul>
      </>
    );
    footer = <button className="btn is-primary" onClick={state.close}>Done</button>;
  } else if (stage === 'error') {
    body = <div className="upscale-callout is-danger"><strong>{error || 'Something went wrong.'}</strong></div>;
    footer = <>{later}<button className="btn is-primary" onClick={() => state.scan()}>Try again</button></>;
  }

  const busy = stage === 'adding' || stage === 'restarting';
  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) state.close(); }}
      size="form"
      busy={busy}
      className="upscale-modal mf-modal"
      hero={
        <div className="upscale-hero-wrap">
          <ModelFoldersHero className="upscale-hero mf-hero" stage={stage} files={heroFiles} />
          <Steps stage={stage} />
        </div>
      }
      title={title}
      description={description}
      footer={footer}
    >
      <div className="upscale-body" key={stage}>{body}</div>
    </Modal>
  );
}

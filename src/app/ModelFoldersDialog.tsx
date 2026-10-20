import { t } from '../i18n/core.js';
import { useLanguage } from '../i18n/react';
import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, FolderOpen, FolderPlus, RefreshCw } from 'lucide-react';
import { Modal } from './Modal';
import { AnimatedNumber } from './AnimatedNumber';
import { ComfyRestart, useComfyRestarting } from './ComfyRestart';
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
  useLanguage();
  const current = stage === 'done' ? STEPS.length : Math.max(0, STEPS.findIndex((step) => (step.stages as readonly string[]).includes(stage)));
  return (
    <ol className="upscale-stepper" aria-label={t("Setup steps")}>
      {STEPS.map((step, index) => {
        const state = index < current ? 'done' : index === current && stage !== 'error' ? 'active' : 'todo';
        return (
          <li key={step.label} className={`is-${state}`} aria-current={state === 'active' ? 'step' : undefined}>
            <i aria-hidden="true">{state === 'done' ? <Check size={10} strokeWidth={3} /> : null}</i>
            <span>{t(step.label)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function copyFor(stage: ModelFolderStage, folders: StrayModelFolder[], added: ModelFolders['added'], saved = false, comfyRestarting = false): { title: string; description: string } {
  const count = folders.reduce((sum, folder) => sum + folder.count, 0);
  switch (stage) {
    case 'scanning': return { title: t("Searching for models"), description: t("Checking your folders, other ComfyUI installs and connected drives.") };
    case 'found': return {
      title: t("Add {0}", { "0": (plural(count, 'model')) }),
      description: folders.length === 1
        ? folders[0].partlyRead
          ? `ComfyUI reads ${folders[0].name}’s models folder, but not ${folders[0].kinds.length === 1 ? `its ${folders[0].kinds[0].name} subfolder` : 'these subfolders'}.`
          : `They’re in ${folders[0].name}, which ComfyUI doesn’t read.`
        : `They’re in ${plural(folders.length, 'folder')} ComfyUI doesn’t fully read.`
    };
    case 'none': return { title: t("No models found outside ComfyUI"), description: t("If models are somewhere else, choose the folder.") };
    case 'remote': return { title: t("ComfyUI runs on another computer"), description: t("Only folders on the computer running HEISS UI can be searched.") };
    case 'offline': return comfyRestarting
      ? { title: t("ComfyUI is restarting"), description: t("The search continues when it’s back, usually in a few seconds.") }
      : { title: t("Waiting for ComfyUI"), description: t("Start ComfyUI to continue.") };
    case 'adding': return { title: t("Adding folders"), description: t("ComfyUI’s previous settings are saved as a backup.") };
    case 'restarting': return { title: t("Restarting ComfyUI"), description: t("ComfyUI reads its model folders when it starts. This takes a few seconds.") };
    case 'waiting': return { title: t("Restart ComfyUI to finish"), description: t("ComfyUI reads its model folders when it starts. Quit ComfyUI and open it again.") };
    case 'done': return {
      title: added.count ? `${plural(added.count, 'model')} ready` : 'Folder added',
      description: t("New files in it show up after a rescan.")
    };
    case 'error': return saved
      ? { title: t("Folders saved, waiting for ComfyUI"), description: t("ComfyUI reads them the next time it starts.") }
      : { title: t("Couldn’t add the folder"), description: t("ComfyUI’s settings weren’t changed.") };
  }
}

function FolderCard({ folder, checked, onToggle, index, selectable }: { folder: StrayModelFolder; checked: boolean; onToggle: () => void; index: number; selectable: boolean }) {
  useLanguage();
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
              {examples.join(', ')}{more > 0 ? t(" and {0} more", { "0": (more) }) : ''}
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
  useLanguage();
  const { report, stage, open, error, selected, added } = state;
  const folders = report?.folders || [];
  const chosen = folders.filter((folder) => selected.includes(folder.path));
  const chosenCount = chosen.reduce((sum, folder) => sum + folder.count, 0);
  const heroFiles = stage === 'found' ? chosenCount : added.count || chosenCount;
  const comfyRestarting = useComfyRestarting();
  const { title, description } = copyFor(stage, folders, added, state.saved, comfyRestarting);
  const toggle = (path: string) => state.setSelected(selected.includes(path) ? selected.filter((item) => item !== path) : [...selected, path]);
  const later = <button className="btn is-ghost" onClick={state.close}>{t("Not now")}</button>;
  const choose = <button className="btn" onClick={state.pick}><FolderOpen size={14} />{t("Choose a folder…")}</button>;

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;

  if (stage === 'scanning') {
    body = <Watcher>{t("Searching…")}</Watcher>;
  } else if (stage === 'found') {
    body = (
      <>
        <ul className="mf-folders">
          {folders.map((folder, index) => (
            <FolderCard key={folder.path} folder={folder} index={index} checked={selected.includes(folder.path)} onToggle={() => toggle(folder.path)} selectable={folders.length > 1 || !selected.includes(folder.path)} />
          ))}
        </ul>
        <p className="upscale-fine">{t("Adds")}{" "}{chosen.length === 1 ? t("it") : t("them")}{t("to")}{" "}<code title={report?.configPath}>extra_model_paths.yaml</code>.
          {runningCount ? <>{t("ComfyUI restarts once, stopping")}{" "}{plural(runningCount, 'running generation')}.</> : <>{t("ComfyUI restarts once.")}</>}
        </p>
        {report?.writable === false ? <p className="upscale-fine is-warn">{t("Can’t write to")}{" "}{report.configLabel}{t(". Check its permissions, or add the folder in ComfyUI yourself.")}</p> : null}
      </>
    );
    footer = (
      <>
        <button className="btn is-ghost mf-other" onClick={state.pick}>{t("Choose another folder…")}</button>
        {later}
        <button className="btn is-primary" onClick={() => state.add()} disabled={!chosen.length}>
          <FolderPlus size={14} />{t("Add")}{" "}{plural(chosenCount, 'model')}
        </button>
      </>
    );
  } else if (stage === 'none') {
    body = report?.linked?.length ? (
      <ul className="mf-linked">
        {report.linked.map((item) => <li key={item.path}><Check size={12} strokeWidth={3} /><code title={item.path}>{item.label}</code><span>{item.read ? t("Read by ComfyUI") : t("Restart ComfyUI to read it")}</span></li>)}
      </ul>
    ) : null;
    footer = <>{choose}<button className="btn is-primary" onClick={state.close}>{t("Done")}</button></>;
  } else if (stage === 'remote') {
    body = (
      <div className="upscale-callout">
        <strong>{t("Add the folder on that computer.")}</strong>
        <span>{t("In ComfyUI’s folder there, copy")}{" "}<code>extra_model_paths.yaml.example</code>{t("to")}{" "}<code>extra_model_paths.yaml</code>{t(", set")}{" "}<code>{t("base_path")}</code>{t("to your models folder, and restart ComfyUI.")}</span>
      </div>
    );
    footer = <button className="btn is-primary" onClick={state.close}>{t("Done")}</button>;
  } else if (stage === 'offline') {
    body = <Watcher>{t("Waiting for ComfyUI…")}</Watcher>;
    footer = <>{later}<button className="btn" onClick={() => state.scan()}><RefreshCw size={13} />{t("Check again")}</button></>;
  } else if (stage === 'adding') {
    body = <Watcher>{t("Adding folders…")}</Watcher>;
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
        <Watcher>{stage === 'restarting' ? t("Waiting for ComfyUI…") : t("Waiting for ComfyUI to restart…")}</Watcher>
        {stage === 'waiting' ? <ComfyRestart compact className="upscale-restart" /> : null}
      </>
    );
    footer = stage === 'waiting' ? <button className="btn is-ghost" onClick={state.close}>{t("Finish later")}</button> : null;
  } else if (stage === 'done') {
    body = (
      <>
        {added.count ? (
          <div className="upscale-meter mf-meter">
            <strong><AnimatedNumber value={added.count} /></strong>
            <div>
              <span>{t("From")}{" "}{added.folders.map((folder) => folder.name).join(', ')}</span>
              <span>{t("Pick them in the model menu")}</span>
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
              <span><Check size={12} strokeWidth={3} />{t("Added")}</span>
            </li>
          ))}
        </ul>
      </>
    );
    footer = <button className="btn is-primary" onClick={state.close}>{t("Done")}</button>;
  } else if (stage === 'error') {
    body = state.saved
      ? <><div className="upscale-callout"><strong>{error}</strong></div><ComfyRestart compact className="upscale-restart" onBack={() => state.scan()} /></>
      : <div className="upscale-callout is-danger"><strong>{error || t("Try again, or add the folder in ComfyUI yourself.")}</strong></div>;
    footer = state.saved
      ? <button className="btn is-ghost" onClick={state.close}>{t("Finish later")}</button>
      : <>{later}<button className="btn is-primary" onClick={() => state.scan()}>{t("Try again")}</button></>;
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

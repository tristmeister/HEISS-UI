import { t } from '../i18n/core.js';
import { useLanguage } from '../i18n/react';
import React, { useEffect, useState } from 'react';
import { Check, Download, RotateCw } from 'lucide-react';
import { ComfyRestart, managerMajor, useComfyManager } from './ComfyRestart';
import { CopyIcon, useCopyFeedback } from './CopyFeedback';
import { apiJson, copyText } from './api';
import { BetaTag } from './components';
import { useThisComputer } from './device';
import { cn } from './format';
import type { NodePackInfo, PackAutoInstall, PackInstallState, ShellPlan } from './types';
import type { ShowToast } from './toast';


export function CopyRow({ text, label, block, showToast }: { text: string; label: string; block?: boolean; showToast: ShowToast }) {
  useLanguage();
  const { copied, copyWith } = useCopyFeedback();
  const copy = () => copyWith(async () => {
    const ok = await copyText(text);
    if (!ok) showToast(t("Copy failed"), 'error');
    return ok;
  });
  return (
    <div className={cn('upscale-url', block && 'is-block')}>
      <code>{text}</code>
      <button type="button" className={copied ? 'is-copied' : ''} onClick={copy} aria-label={label}>
        <CopyIcon copied={Boolean(copied)} size={13} />
        <span>{copied ? t("Copied") : t("Copy")}</span>
      </button>
    </div>
  );
}

/** A command per shell (Terminal, or PowerShell and Command Prompt on Windows), with a switch between them. */
export function ShellCommand({ plan, showToast }: { plan: ShellPlan; showToast: ShowToast }) {
  useLanguage();
  const [index, setIndex] = useState(0);
  const shell = plan.commands[Math.min(index, plan.commands.length - 1)];
  if (!shell) return null;
  return (
    <>
      {plan.commands.length > 1 ? (
        <div className="upscale-routes is-small" role="tablist" aria-label={t("Shell")}>
          {plan.commands.map((item, i) => (
            <button key={item.shell} type="button" role="tab" aria-selected={item === shell} className={cn(item === shell && 'is-active')} onClick={() => setIndex(i)}>{item.label}</button>
          ))}
        </div>
      ) : null}
      <CopyRow text={shell.command} label={t("Copy the {0} command", { "0": (shell.label) })} block showToast={showToast} />
    </>
  );
}

/**
 * The Install button: HEISS asks ComfyUI-Manager to install the pack when it is
 * in Manager's list, or clones it and installs its requirements itself when
 * ComfyUI runs on this computer. Progress comes from polling the server.
 */
function QuickInstall({ pack, onDone, showToast, onRestarted, afterRestart }: {
  pack: NodePackInfo & { id: string };
  onDone: (state: PackInstallState | null) => void;
  showToast: ShowToast;
  onRestarted: () => void;
  afterRestart: string;
}) {
  useLanguage();
  const [state, setState] = useState<PackInstallState | null>(null);
  const alive = React.useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const url = `/api/node-packs/${encodeURIComponent(pack.id)}/install`;
  // An install started earlier (another panel, a reload) keeps reporting here.
  useEffect(() => {
    apiJson<{ install: PackInstallState | null }>(url).then(({ install }) => { if (alive.current && install) follow(install); }).catch(() => null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  const follow = async (first: PackInstallState) => {
    let current: PackInstallState | null = first;
    setState(current);
    while (alive.current && current?.status === 'running') {
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      current = (await apiJson<{ install: PackInstallState | null }>(url).catch(() => ({ install: current }))).install;
      if (alive.current) setState(current);
    }
    if (alive.current) onDone(current);
  };
  const start = async (override = false) => {
    try {
      const { install } = await apiJson<{ install: PackInstallState }>(url, override
        ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ override: 'manager-security' }) }
        : { method: 'POST' });
      await follow(install);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Couldn’t start the install', 'error');
    }
  };
  // Where the code comes from, and which version: it runs inside ComfyUI once installed.
  const source = (() => {
    const match = /github\.com\/([^/]+\/[^/.]+)/.exec(pack.repository || '');
    return match ? `github.com/${match[1]}${pack.ref ? ` · ${pack.ref}` : ''}` : '';
  })();
  if (state?.status === 'blocked') {
    return (
      <div className="node-quick" role="alert">
        <p className="upscale-fine is-warn">{state.error}</p>
        <p className="upscale-fine">{state.canOverride
          ? <>{t("You can install")}{" "}{pack.name}{t("with ComfyUI’s own Python instead. It’s third-party code from")}{" "}{source || t("GitHub")}{t("and runs inside ComfyUI.")}</>
          : <>{t("Lower Manager’s security level if you trust")}{" "}{pack.name}{t(", or install it yourself below.")}</>}</p>
        {state.canOverride ? <button type="button" className="btn" onClick={() => start(true)}><Download size={14} />{t("Install anyway")}</button> : null}
      </div>
    );
  }
  if (state?.status === 'done') {
    return (
      <div className="node-quick is-done" role="status">
        <p><Check size={13} strokeWidth={3} /><span>{pack.name}{t("is installed.")}{" "}<strong>{t("Restart ComfyUI")}</strong>{t("to load it.")}{afterRestart ? ` ${afterRestart}` : ''}</span></p>
        <ComfyRestart compact className="upscale-restart" onBack={onRestarted} />
      </div>
    );
  }
  const running = state?.status === 'running';
  return (
    <div className="node-quick">
      <button type="button" className="btn is-primary" onClick={() => start()} disabled={running}>
        {running ? <RotateCw size={14} className="is-spinning" /> : <Download size={14} />}
        {running ? state.step || t("Installing…") : state?.status === 'error' ? t("Try again") : t("Install {0}", { "0": (pack.name) })}
        {running ? null : <BetaTag />}
      </button>
      {running ? <p className="upscale-fine">{state.route === 'manager' ? t("Installing through ComfyUI-Manager. ") : t("Installing with ComfyUI’s own Python. ")}{t("It can take a few minutes.")}</p> : null}
      {!running && source ? <p className="upscale-fine">{t("Third-party code from")}{" "}{source}{t(", run inside ComfyUI.")}</p> : null}
      {state?.status === 'error' ? <p className="upscale-fine is-warn">{state.error}</p> : null}
    </div>
  );
}

/**
 * Adding a custom node pack to ComfyUI, the same way everywhere: through
 * ComfyUI-Manager when it answers (its Git URL install), otherwise one
 * terminal command that clones the pack and installs its requirements with
 * ComfyUI's own Python. Manager 4 ships switched off (ComfyUI needs
 * --enable-manager), so without it the terminal route opens first.
 */
export function NodeInstall({ pack, plan, managerHint, autoInstall, showToast, onRestarted, afterRestart = '' }: {
  pack: NodePackInfo;
  /** The one-click routes the server has for this pack; without one only the manual steps show. */
  autoInstall?: PackAutoInstall;
  plan?: ShellPlan & { cloned?: boolean; needsGit?: boolean; exact?: boolean; customNodesDir?: string; python?: string };
  /** What the server last knew about Manager, used until ComfyUI answers directly. */
  managerHint?: boolean;
  showToast: ShowToast;
  onRestarted: () => void;
  afterRestart?: string;
}) {
  useLanguage();
  const { info: manager } = useComfyManager();
  const hasManager = manager ? manager.available : managerHint !== false;
  const managerV4 = managerMajor(manager) >= 4;
  const [route, setRoute] = useState<'manager' | 'terminal'>(hasManager ? 'manager' : 'terminal');
  const commands = plan?.commands?.length ? plan.commands : [{ shell: 'sh' as const, label: t("Terminal"), command: `cd ComfyUI/custom_nodes && git clone ${pack.repository}` }];
  // The first answer from ComfyUI decides the default; after that the choice is the user's.
  const decided = React.useRef(Boolean(manager));
  useEffect(() => {
    if (!manager || decided.current) return;
    decided.current = true;
    setRoute(manager.available ? 'manager' : 'terminal');
  }, [manager]);
  // One click where HEISS can do it, for whoever may install; the manual routes stay one tap away.
  const admin = useThisComputer();
  const canQuick = Boolean(admin && pack.id && autoInstall && (autoInstall.local || (autoInstall.manager && hasManager)));
  const [manual, setManual] = useState(false);
  const [quickError, setQuickError] = useState('');
  const [installed, setInstalled] = useState(false);
  if (canQuick && !manual && !quickError) {
    return (
      <div className="node-install">
        <QuickInstall pack={pack as NodePackInfo & { id: string }} showToast={showToast} onRestarted={onRestarted} afterRestart={afterRestart} onDone={(state) => { if (state?.status === 'error') setQuickError(state.error || 'The install stopped.'); if (state?.status === 'done') setInstalled(true); }} />
        {installed ? null : <button type="button" className="comfy-restart-link node-install-manual" onClick={() => setManual(true)}>{t("Install it yourself instead")}</button>}
      </div>
    );
  }
  const restartStep = (n: number) => (
    <li>
      <span className="upscale-step-n">{n}</span>
      <div>
        <strong>{t("Restart ComfyUI")}</strong>{t("once it finishes.")}{" "}{afterRestart}
        <ComfyRestart compact className="upscale-restart" onBack={onRestarted} />
      </div>
    </li>
  );
  return (
    <div className="node-install">
      {quickError && !manual ? <p className="upscale-fine is-warn">{t("The install stopped.")}{" "}{quickError}{t("Install it yourself below.")}</p> : null}
      <div className="upscale-routes" role="tablist" aria-label={t("How to install")}>
        {(['manager', 'terminal'] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={route === value} className={cn(route === value && 'is-active')} onClick={() => setRoute(value)}>
            {value === 'manager' ? t("ComfyUI-Manager") : t("Terminal")}
            {value === 'manager' && !hasManager ? <span className="upscale-route-tag">{t("Off")}</span> : null}
          </button>
        ))}
      </div>
      {route === 'manager' ? (
        <ol className="upscale-steps">
          <li>
            <span className="upscale-step-n">1</span>
            <div>
              {managerV4
                ? pack.search
                  ? <>{t("In ComfyUI, open")}{" "}<strong>{t("Manager")}</strong>{t(", search the node list for")}{" "}<strong>{pack.search}</strong>{t("and install it.")}</>
                  : <>{t("ComfyUI-Manager")}{" "}{manager?.version}{t("can’t install from a Git URL in its main view, and")}{" "}{pack.name}{t("isn’t in its list. Use the")}{" "}<strong>{t("Terminal")}</strong>{t("tab instead.")}</>
                : pack.subdir && pack.search
                  // A pack inside a bigger repository can't come in by Git URL: only its own folder belongs in custom_nodes.
                  ? <>{t("In ComfyUI, open")}{" "}<strong>{t("Manager")}</strong>{t(", search the node list for")}{" "}<strong>{pack.search}</strong>{t("and install it.")}</>
                  : <>{t("In ComfyUI, open")}{" "}<strong>{t("Manager")}</strong>{t("and choose")}{" "}<strong>{t("Install via Git URL")}</strong>.{pack.search ? <>{t("Searching the node list for")}{" "}<strong>{pack.search}</strong>{t("works too.")}</> : null}</>}
              {pack.note ? <p className="upscale-fine">{pack.note}</p> : null}
              {!hasManager ? <p className="upscale-fine">{t("ComfyUI-Manager is off. Start ComfyUI with")}{" "}<code>--enable-manager</code>{t(", or use the terminal.")}</p> : null}
            </div>
          </li>
          {managerV4 || pack.subdir ? null : (
            <li>
              <span className="upscale-step-n">2</span>
              <div>{t("Paste the")}{" "}{pack.name}{t("repository:")}<CopyRow text={pack.repository} label={t("Copy the repository URL")} showToast={showToast} />
              </div>
            </li>
          )}
          {managerV4 && !pack.search ? null : restartStep(managerV4 || pack.subdir ? 2 : 3)}
        </ol>
      ) : (
        <ol className="upscale-steps">
          <li>
            <span className="upscale-step-n">1</span>
            <div>
              {plan?.cloned
                ? <>{t("The")}{" "}{pack.name}{t("folder is already in")}{" "}<code>{t("custom_nodes")}</code>{t(". If it doesn’t load after a restart, its Python packages are missing. This installs them:")}</>
                : <>{t("Run this in")}{" "}{commands.length > 1 ? t("a terminal") : t("Terminal")}{t(". It downloads the nodes into")}{" "}<code>{t("custom_nodes")}</code>{t("and installs what they need")}{plan?.python ? t(" with ComfyUI’s own Python") : ''}:</>}
              <ShellCommand plan={{ commands }} showToast={showToast} />
              {plan?.needsGit !== false ? <p className="upscale-fine">{t("Needs")}{" "}<code>{t("git")}</code>{t(". Without it, use the ComfyUI-Manager route.")}</p> : null}
              {plan && !plan.exact ? (
                <p className="upscale-fine">
                  {plan.customNodesDir ? null : <>{t("Run it from the folder that holds ComfyUI.")}{" "}</>}{t("If ComfyUI runs from its own environment, swap")}{" "}<code>{t("python")}</code>{t("for that Python.")}</p>
              ) : null}
            </div>
          </li>
          {restartStep(2)}
        </ol>
      )}
    </div>
  );
}

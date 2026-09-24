import React, { useEffect, useState } from 'react';
import { Check, Copy, Download, RotateCw } from 'lucide-react';
import { ComfyRestart, useComfyManager } from './ComfyRestart';
import { apiJson, copyText } from './api';
import { cn } from './format';
import type { NodePackInfo, PackAutoInstall, PackInstallState, ShellPlan } from './types';

type Toast = (message: string, tone?: 'default' | 'success' | 'error') => void;

export function CopyRow({ text, label, block, showToast }: { text: string; label: string; block?: boolean; showToast: Toast }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!(await copyText(text))) {
      showToast('Copy failed', 'error');
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className={cn('upscale-url', block && 'is-block')}>
      <code>{text}</code>
      <button type="button" className={copied ? 'is-copied' : ''} onClick={copy} aria-label={label}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}

/** A command per shell (Terminal, or PowerShell and Command Prompt on Windows), with a switch between them. */
export function ShellCommand({ plan, showToast }: { plan: ShellPlan; showToast: Toast }) {
  const [index, setIndex] = useState(0);
  const shell = plan.commands[Math.min(index, plan.commands.length - 1)];
  if (!shell) return null;
  return (
    <>
      {plan.commands.length > 1 ? (
        <div className="upscale-routes is-small" role="tablist" aria-label="Shell">
          {plan.commands.map((item, i) => (
            <button key={item.shell} type="button" role="tab" aria-selected={item === shell} className={cn(item === shell && 'is-active')} onClick={() => setIndex(i)}>{item.label}</button>
          ))}
        </div>
      ) : null}
      <CopyRow text={shell.command} label={`Copy the ${shell.label} command`} block showToast={showToast} />
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
  showToast: Toast;
  onRestarted: () => void;
  afterRestart: string;
}) {
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
  const start = async () => {
    try {
      const { install } = await apiJson<{ install: PackInstallState }>(url, { method: 'POST' });
      await follow(install);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start the install', 'error');
    }
  };
  if (state?.status === 'done') {
    return (
      <div className="node-quick is-done" role="status">
        <p><Check size={13} strokeWidth={3} /> {pack.name} is installed. <strong>Restart ComfyUI</strong> to load it{afterRestart ? <>; {afterRestart.charAt(0).toLowerCase() + afterRestart.slice(1)}</> : '.'}</p>
        <ComfyRestart compact className="upscale-restart" onBack={onRestarted} />
      </div>
    );
  }
  const running = state?.status === 'running';
  return (
    <div className="node-quick">
      <button type="button" className="btn is-primary" onClick={start} disabled={running}>
        {running ? <RotateCw size={14} className="is-spinning" /> : <Download size={14} />}
        {running ? state.step || 'Installing…' : state?.status === 'error' ? 'Try again' : `Install ${pack.name}`}
      </button>
      {running ? <p className="upscale-fine">{state.route === 'manager' ? 'ComfyUI-Manager is doing this. ' : "Using ComfyUI's own Python. "}It can take a few minutes.</p> : null}
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
  showToast: Toast;
  onRestarted: () => void;
  afterRestart?: string;
}) {
  const { info: manager } = useComfyManager();
  const hasManager = manager ? manager.available : managerHint !== false;
  const [route, setRoute] = useState<'manager' | 'terminal'>(hasManager ? 'manager' : 'terminal');
  const commands = plan?.commands?.length ? plan.commands : [{ shell: 'sh' as const, label: 'Terminal', command: `cd ComfyUI/custom_nodes && git clone ${pack.repository}` }];
  // The first answer from ComfyUI decides the default; after that the choice is the user's.
  const decided = React.useRef(Boolean(manager));
  useEffect(() => {
    if (!manager || decided.current) return;
    decided.current = true;
    setRoute(manager.available ? 'manager' : 'terminal');
  }, [manager]);
  // One click where HEISS can do it; the manual routes stay one tap away.
  const canQuick = Boolean(pack.id && autoInstall && (autoInstall.local || (autoInstall.manager && hasManager)));
  const [manual, setManual] = useState(false);
  const [quickError, setQuickError] = useState('');
  if (canQuick && !manual && !quickError) {
    return (
      <div className="node-install">
        <QuickInstall pack={pack as NodePackInfo & { id: string }} showToast={showToast} onRestarted={onRestarted} afterRestart={afterRestart} onDone={(state) => { if (state?.status === 'error') setQuickError(state.error || 'The install stopped.'); }} />
        <button type="button" className="comfy-restart-link node-install-manual" onClick={() => setManual(true)}>Install it yourself instead</button>
      </div>
    );
  }
  const restartStep = (n: number) => (
    <li>
      <span className="upscale-step-n">{n}</span>
      <div>
        <strong>Restart ComfyUI</strong> once it finishes. {afterRestart}
        <ComfyRestart compact className="upscale-restart" onBack={onRestarted} />
      </div>
    </li>
  );
  return (
    <div className="node-install">
      {quickError && !manual ? <p className="upscale-fine is-warn">The one-click install stopped: {quickError} Here is how to do it by hand.</p> : null}
      <div className="upscale-routes" role="tablist" aria-label="How to install">
        {(['manager', 'terminal'] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={route === value} className={cn(route === value && 'is-active')} onClick={() => setRoute(value)}>
            {value === 'manager' ? 'ComfyUI Manager' : 'Terminal'}
            {value === 'manager' && !hasManager ? <span className="upscale-route-tag">Off</span> : null}
          </button>
        ))}
      </div>
      {route === 'manager' ? (
        <ol className="upscale-steps">
          <li>
            <span className="upscale-step-n">1</span>
            <div>
              In ComfyUI, open <strong>Manager</strong> and choose <strong>Install via Git URL</strong>.{pack.search ? <> Searching the node list for <strong>{pack.search}</strong> works too.</> : null}
              {pack.note ? <p className="upscale-fine">{pack.note}</p> : null}
              {!hasManager ? <p className="upscale-fine">ComfyUI-Manager is off. Start ComfyUI with <code>--enable-manager</code>, or use the terminal.</p> : null}
            </div>
          </li>
          <li>
            <span className="upscale-step-n">2</span>
            <div>
              Paste the {pack.name} repository:
              <CopyRow text={pack.repository} label="Copy the repository URL" showToast={showToast} />
            </div>
          </li>
          {restartStep(3)}
        </ol>
      ) : (
        <ol className="upscale-steps">
          <li>
            <span className="upscale-step-n">1</span>
            <div>
              {plan?.cloned
                ? <>The {pack.name} folder is already in <code>custom_nodes</code>. If it still does not show up after a restart, its Python packages are missing; this installs them:</>
                : <>Run this in {commands.length > 1 ? 'a terminal' : 'Terminal'}. It downloads the nodes into <code>custom_nodes</code> and installs what they need{plan?.python ? " with ComfyUI's own Python" : ''}:</>}
              <ShellCommand plan={{ commands }} showToast={showToast} />
              {plan?.needsGit !== false ? <p className="upscale-fine">Needs <code>git</code>. Without it, the ComfyUI Manager route does the same.</p> : null}
              {plan && !plan.exact ? (
                <p className="upscale-fine">
                  {plan.customNodesDir ? null : <>Run it from the folder that holds ComfyUI. </>}
                  If ComfyUI runs from its own environment, swap <code>python</code> for that Python.
                </p>
              ) : null}
            </div>
          </li>
          {restartStep(2)}
        </ol>
      )}
    </div>
  );
}

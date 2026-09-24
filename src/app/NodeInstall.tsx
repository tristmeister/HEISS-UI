import React, { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { ComfyRestart, useComfyManager } from './ComfyRestart';
import { copyText } from './api';
import { cn } from './format';
import type { NodePackInfo, ShellPlan } from './types';

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
 * Adding a custom node pack to ComfyUI, the same way everywhere: through
 * ComfyUI-Manager when it answers (its Git URL install), otherwise one
 * terminal command that clones the pack and installs its requirements with
 * ComfyUI's own Python. Manager 4 ships switched off (ComfyUI needs
 * --enable-manager), so without it the terminal route opens first.
 */
export function NodeInstall({ pack, plan, managerHint, showToast, onRestarted, afterRestart = 'HEISS UI notices the new nodes by itself.' }: {
  pack: NodePackInfo;
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
              {!hasManager ? <p className="upscale-fine">ComfyUI is not answering as having Manager. Newer ComfyUI ships it switched off: start ComfyUI with <code>--enable-manager</code>, or use the terminal instead.</p> : null}
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

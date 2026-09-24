import React from 'react';
import { Check, RotateCw } from 'lucide-react';
import { apiJson } from './api';
import { cn } from './format';
import { useThisComputer } from './device';

export type ManagerInfo = { connected: boolean; available: boolean; version: string | null; stale?: boolean; error?: string };

// One answer shared by every restart button on screen, refreshed at most every 20 s.
let cached: { info: ManagerInfo; at: number } | null = null;
let pending: Promise<ManagerInfo> | null = null;
const listeners = new Set<(info: ManagerInfo) => void>();

export async function fetchManager(force = false): Promise<ManagerInfo> {
  if (!force && cached && Date.now() - cached.at < 20_000) return cached.info;
  if (!pending) {
    pending = apiJson<ManagerInfo & { ok: boolean }>('/api/comfy/manager')
      .then(({ connected, available, version }) => ({ connected, available, version }))
      .catch((error) => ({ connected: false, available: false, version: null, error: String(error?.message || ''), stale: /out of date|Unknown API route/i.test(String(error?.message || '')) }))
      .then((info) => {
        cached = { info, at: Date.now() };
        listeners.forEach((listener) => listener(info));
        return info;
      })
      .finally(() => { pending = null; });
  }
  return pending;
}

/**
 * Whether ComfyUI is restarting on purpose, as the app's status poll last
 * heard from the server. Every surface that would otherwise say "offline"
 * reads this and says "restarting" instead.
 */
let restartingNow = false;
const restartingListeners = new Set<(value: boolean) => void>();
export function setComfyRestarting(value: boolean) {
  if (restartingNow === value) return;
  restartingNow = value;
  restartingListeners.forEach((listener) => listener(value));
}
export function useComfyRestarting() {
  const [value, setValue] = React.useState(restartingNow);
  React.useEffect(() => {
    restartingListeners.add(setValue);
    setValue(restartingNow);
    return () => { restartingListeners.delete(setValue); };
  }, []);
  return value;
}
/** Tells the app a restart just started, so it asks the server at once and polls faster. */
export function announceComfyRestart() {
  setComfyRestarting(true);
  window.dispatchEvent(new CustomEvent('heiss:comfy-restart'));
}

/**
 * The app registers one confirmation (it knows what is running), so every
 * restart button asks before stopping work, not only the one in Settings.
 */
let defaultConfirm: (() => Promise<boolean>) | null = null;
export function registerRestartConfirm(confirm: (() => Promise<boolean>) | null) { defaultConfirm = confirm; }

/** Manager 4 dropped "Install via Git URL" from its main UI. */
export function managerMajor(info: ManagerInfo | null) {
  const match = String(info?.version || '').match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

/** Whether ComfyUI-Manager answers, so install and restart steps can offer the one-click route. */
export function useComfyManager() {
  const [info, setInfo] = React.useState<ManagerInfo | null>(cached?.info ?? null);
  React.useEffect(() => {
    listeners.add(setInfo);
    fetchManager().then(setInfo);
    return () => { listeners.delete(setInfo); };
  }, []);
  const refresh = React.useCallback(() => fetchManager(true), []);
  return { info, refresh };
}

type Phase = 'idle' | 'restarting' | 'back' | 'error';

/**
 * Restarts ComfyUI through Manager and waits until it answers again, then
 * calls onBack so the caller can rescan. Without Manager it stays visible but
 * off, saying what would turn it on.
 */
export function ComfyRestart({ onBack, confirm, compact = false, className }: {
  onBack?: () => void;
  confirm?: () => Promise<boolean>;
  compact?: boolean;
  className?: string;
}) {
  const { info, refresh } = useComfyManager();
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [error, setError] = React.useState('');
  const alive = React.useRef(true);
  React.useEffect(() => () => { alive.current = false; }, []);

  const restart = async () => {
    const ask = confirm || defaultConfirm;
    if (ask && !await ask()) return;
    setPhase('restarting');
    setError('');
    try {
      await apiJson('/api/comfy/restart', { method: 'POST' });
      announceComfyRestart();
    } catch (reason) {
      if (!alive.current) return;
      setPhase('error');
      setError(reason instanceof Error ? reason.message : 'Could not restart ComfyUI');
      refresh();
      return;
    }
    // Wait until ComfyUI has actually gone down, so an answer from the old
    // process is not taken for "back"; a restart too quick to catch counts after 15 s.
    const started = Date.now();
    const deadline = started + 120_000;
    let sawDown = false;
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
    while (alive.current && Date.now() < deadline) {
      const next = await fetchManager(true);
      if (!next.connected) sawDown = true;
      if (next.connected && (sawDown || Date.now() - started > 15_000)) {
        setPhase('back');
        onBack?.();
        window.setTimeout(() => { if (alive.current) setPhase('idle'); }, 2400);
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }
    if (!alive.current) return;
    setPhase('error');
    setError('ComfyUI has not come back yet. Check its window for errors.');
  };

  // A restart started anywhere (another button, a setup step, another tab) shows here too.
  const globalRestarting = useComfyRestarting();
  const busy = phase === 'restarting' || (globalRestarting && phase !== 'back');
  const off = !busy && info !== null && !info.available;
  const thisComputer = useThisComputer();
  // Restarting is looked after at the computer; elsewhere only its progress shows.
  if (!thisComputer && !busy) return <p className={cn('comfy-restart-note', className)}>Restart ComfyUI from the computer running HEISS UI.</p>;
  return (
    <div className={cn('comfy-restart', compact && 'is-compact', className)}>
      <button type="button" className={cn('btn', phase === 'back' && 'is-done')} onClick={restart} disabled={off || busy || info === null} aria-live="polite">
        {phase === 'back' ? <Check size={14} /> : <RotateCw size={14} className={cn(busy && 'is-spinning')} />}
        {phase === 'back' ? 'Back online' : busy ? 'Restarting…' : 'Restart ComfyUI'}
      </button>
      {off ? (
        <p className="comfy-restart-note">
          {info?.stale
            ? <>HEISS UI is running older code. Restart it to use this.</>
            : info?.connected
            ? <>Needs ComfyUI-Manager. Start ComfyUI with <code>--enable-manager</code>, or restart it yourself.</>
            : info?.error ? <>Could not check ComfyUI: {info.error}</>
            : <>ComfyUI is not answering.</>}{' '}
          <button type="button" className="comfy-restart-link" onClick={() => refresh()}>Check again</button>
        </p>
      ) : null}
      {busy && !compact ? <p className="comfy-restart-note">ComfyUI is restarting and reads new nodes and folders as it starts. Back in a few seconds.</p> : null}
      {phase === 'error' ? <p className="comfy-restart-note is-error">{error}</p> : null}
    </div>
  );
}

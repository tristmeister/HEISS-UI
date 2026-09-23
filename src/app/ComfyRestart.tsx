import React from 'react';
import { Check, RotateCw } from 'lucide-react';
import { apiJson } from './api';
import { cn } from './format';

export type ManagerInfo = { connected: boolean; available: boolean; version: string | null; stale?: boolean; error?: string };

// One answer shared by every restart button on screen, refreshed at most every 20 s.
let cached: { info: ManagerInfo; at: number } | null = null;
let pending: Promise<ManagerInfo> | null = null;
const listeners = new Set<(info: ManagerInfo) => void>();

async function fetchManager(force = false): Promise<ManagerInfo> {
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
    if (confirm && !await confirm()) return;
    setPhase('restarting');
    setError('');
    try {
      await apiJson('/api/comfy/restart', { method: 'POST' });
    } catch (reason) {
      if (!alive.current) return;
      setPhase('error');
      setError(reason instanceof Error ? reason.message : 'Could not restart ComfyUI');
      refresh();
      return;
    }
    // Give ComfyUI a moment to go down, then wait for it to answer again.
    const deadline = Date.now() + 120_000;
    await new Promise((resolve) => window.setTimeout(resolve, 2500));
    while (alive.current && Date.now() < deadline) {
      const next = await fetchManager(true);
      if (next.connected) {
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

  const off = info !== null && !info.available;
  const busy = phase === 'restarting';
  return (
    <div className={cn('comfy-restart', compact && 'is-compact', className)}>
      <button type="button" className={cn('btn', phase === 'back' && 'is-done')} onClick={restart} disabled={off || busy || info === null} aria-live="polite">
        {phase === 'back' ? <Check size={14} /> : <RotateCw size={14} className={cn(busy && 'is-spinning')} />}
        {phase === 'back' ? 'Back online' : busy ? 'Restarting…' : 'Restart ComfyUI'}
      </button>
      {off ? (
        <p className="comfy-restart-note">
          {info?.stale
            ? <>The HEISS server is running older code. Restart it to use this.</>
            : info?.connected
            ? <>Needs ComfyUI-Manager. Start ComfyUI with <code>--enable-manager</code>, or restart it yourself.</>
            : info?.error ? <>Could not ask HEISS about ComfyUI: {info.error}</>
            : <>ComfyUI is not answering.</>}{' '}
          <button type="button" className="comfy-restart-link" onClick={() => refresh()}>Check again</button>
        </p>
      ) : null}
      {phase === 'error' ? <p className="comfy-restart-note is-error">{error}</p> : null}
    </div>
  );
}

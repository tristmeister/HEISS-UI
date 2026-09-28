import React from 'react';
import { Check, RotateCw } from 'lucide-react';
import { apiJson } from './api';
import { cn } from './format';
import { useThisComputer } from './device';
import type { RestartResult } from './types';

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

/**
 * The restart under way, on this device's clock: the server says how long it
 * has been running, so a phone with a clock off by a few seconds still counts
 * right. typicalMs is how long restarts usually take here, once they agree.
 */
type RestartClock = { startedAt: number; localStart: number; typicalMs: number | null };
let restartClock: RestartClock | null = null;
let restartResult: RestartResult | null = null;
const clockListeners = new Set<() => void>();
const notifyClock = () => clockListeners.forEach((listener) => listener());

export function setComfyRestartClock(next: { startedAt: number; elapsedMs: number; typicalMs?: number | null } | null) {
  if (!next) {
    if (!restartClock) return;
    restartClock = null;
  } else if (restartClock?.startedAt === next.startedAt) {
    if (restartClock.typicalMs === (next.typicalMs ?? null)) return;
    restartClock = { ...restartClock, typicalMs: next.typicalMs ?? null };
  } else {
    restartClock = { startedAt: next.startedAt, localStart: Date.now() - Math.max(0, next.elapsedMs), typicalMs: next.typicalMs ?? null };
    restartResult = null;
  }
  notifyClock();
}

/** The restart this device watched just ended; every restart control can say how. */
export function setComfyRestartResult(result: RestartResult | null) {
  if (restartResult?.startedAt === result?.startedAt) return;
  restartResult = result;
  notifyClock();
}

export function useComfyRestartResult() {
  const [, setVersion] = React.useState(0);
  React.useEffect(() => {
    const listener = () => setVersion((value) => value + 1);
    clockListeners.add(listener);
    return () => { clockListeners.delete(listener); };
  }, []);
  return restartResult;
}

export type RestartEta = {
  /** A sentence for notes and empty states. */
  text: string;
  /** A few words for a status line. */
  short: string;
  /** How full a progress line should be (never quite 1), or null with nothing learned yet. */
  ratio: number | null;
  /** Well past the usual time: probably installing something. */
  slow: boolean;
};

// Without anything learned, a restart past this long is worth a word.
const SLOW_WITHOUT_ESTIMATE_MS = 45_000;

/**
 * What to say about a restart after `elapsed` ms. With a usual time it counts
 * down, says "almost" near the end rather than promising a second, and past
 * twice the usual time admits it is slow instead of counting on.
 */
export function restartEta(elapsed: number, typicalMs: number | null): RestartEta {
  if (!typicalMs) {
    if (elapsed > SLOW_WITHOUT_ESTIMATE_MS) return { text: 'Taking a while. ComfyUI may be installing something new.', short: 'Taking a while…', ratio: null, slow: true };
    return { text: 'Usually back in a few seconds.', short: 'Restarting…', ratio: null, slow: false };
  }
  // Eases toward full: about 90% at the usual time, still moving if it runs late.
  const ratio = Math.min(0.97, 1 - Math.exp(-2.3 * (elapsed / typicalMs)));
  const remaining = typicalMs - elapsed;
  if (elapsed > typicalMs * 2 && elapsed > 20_000) return { text: 'Taking longer than usual. ComfyUI may be installing something new.', short: 'Longer than usual…', ratio, slow: true };
  if (remaining > 2500) {
    const seconds = Math.ceil(remaining / 1000);
    return { text: `Back in about ${seconds} s.`, short: `Back in about ${seconds} s`, ratio, slow: false };
  }
  return { text: 'Almost back.', short: 'Almost back…', ratio, slow: false };
}

/** The live estimate for the restart under way, or null when there is none. */
export function useComfyRestartEta(): RestartEta | null {
  const [, setVersion] = React.useState(0);
  React.useEffect(() => {
    const listener = () => setVersion((value) => value + 1);
    clockListeners.add(listener);
    return () => { clockListeners.delete(listener); };
  }, []);
  const running = Boolean(restartClock);
  React.useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setVersion((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, [running]);
  if (!restartClock) return null;
  return restartEta(Date.now() - restartClock.localStart, restartClock.typicalMs);
}

/** "A and B", or "A, B and 3 more" when there are many. */
export function listNames(names: string[]) {
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ');
}

/** The restart estimate as text, ticking on its own so the surface around it does not re-render. */
export function RestartEtaText({ fallback = 'Usually back in a few seconds.' }: { fallback?: string }) {
  const eta = useComfyRestartEta();
  return <>{eta?.text || fallback}</>;
}

/** "Back in 18 s", or what the restart brought: a new pack, or one that did not load. */
export function restartResultLine(result: RestartResult | null) {
  if (!result || result.outcome !== 'back') return 'Back online';
  if (result.failedPacks?.length) return `Back · ${listNames(result.failedPacks)} didn’t load`;
  if (result.newPacks?.length) return `Back · ${listNames(result.newPacks)} ${result.newPacks.length === 1 ? 'is' : 'are'} new`;
  return result.durationMs ? `Back in ${Math.max(1, Math.round(result.durationMs / 1000))} s` : 'Back online';
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
 * calls onBack so the caller can rescan. Shared by every restart control.
 */
export function useComfyRestart({ onBack, confirm }: { onBack?: () => void; confirm?: () => Promise<boolean> } = {}) {
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
      setError(reason instanceof Error ? reason.message : 'Couldn’t restart ComfyUI');
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
        // The server looks at what the restart brought before calling it done; give it a moment.
        const settle = Date.now() + 8000;
        while (alive.current && restartingNow && Date.now() < settle) await new Promise((resolve) => window.setTimeout(resolve, 400));
        if (!alive.current) return;
        setPhase('back');
        onBack?.();
        // A new or broken pack is worth reading; a plain "back" only needs a glance.
        const notable = Boolean(restartResult?.newPacks?.length || restartResult?.failedPacks?.length);
        window.setTimeout(() => { if (alive.current) setPhase('idle'); }, notable ? 6000 : 2400);
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }
    if (!alive.current) return;
    setPhase('error');
    setError('ComfyUI hasn’t come back yet. Check its window for errors.');
  };

  // A restart started anywhere (another button, a setup step, another tab) shows here too.
  const globalRestarting = useComfyRestarting();
  const busy = phase === 'restarting' || (globalRestarting && phase !== 'back');
  const off = !busy && info !== null && !info.available;
  const eta = useComfyRestartEta();
  const result = useComfyRestartResult();
  return { info, refresh, phase, error, busy, off, restart, eta, result };
}

/** Why the restart button is off, with a way to check again. */
export function ComfyManagerNote({ info, refresh, className }: { info: ManagerInfo | null; refresh: () => void; className?: string }) {
  return (
    <p className={cn('comfy-restart-note', className)}>
      {info?.stale
        ? <>Restart HEISS UI to use this.</>
        : info?.connected
        ? <>Needs ComfyUI-Manager. Start ComfyUI with <code>--enable-manager</code>, or restart it yourself.</>
        : info?.error ? <>Couldn’t check ComfyUI: {info.error}</>
        : <>ComfyUI is offline.</>}{' '}
      <button type="button" className="comfy-restart-link" onClick={() => refresh()}>Check again</button>
    </p>
  );
}

/**
 * The restart button with its notes. Without Manager it stays visible but
 * off, saying what would turn it on.
 */
export function ComfyRestart({ onBack, confirm, compact = false, className }: {
  onBack?: () => void;
  confirm?: () => Promise<boolean>;
  compact?: boolean;
  className?: string;
}) {
  const { info, refresh, phase, error, busy, off, restart, eta, result } = useComfyRestart({ onBack, confirm });
  const thisComputer = useThisComputer();
  // Restarting is looked after at the computer; elsewhere only its progress shows.
  if (!thisComputer && !busy) return <p className={cn('comfy-restart-note', className)}>Restart ComfyUI from the computer running HEISS UI.</p>;
  return (
    <div className={cn('comfy-restart', compact && 'is-compact', className)}>
      <button type="button" className={cn('btn', phase === 'back' && 'is-done')} onClick={restart} disabled={off || busy || info === null} aria-live="polite">
        {phase === 'back' ? <Check size={14} /> : <RotateCw size={14} className={cn(busy && 'is-spinning')} />}
        {phase === 'back' ? 'Back online' : busy ? 'Restarting…' : 'Restart ComfyUI'}
      </button>
      {off ? <ComfyManagerNote info={info} refresh={refresh} /> : null}
      {busy && !compact ? <p className="comfy-restart-note">ComfyUI is restarting to pick up new nodes and folders. {eta?.text || 'Usually back in a few seconds.'}</p> : null}
      {phase === 'back' && !compact && result && restartResultLine(result) !== 'Back online' ? <p className={cn('comfy-restart-note', Boolean(result.failedPacks?.length) && 'is-error')}>{restartResultLine(result)}</p> : null}
      {phase === 'error' ? <p className="comfy-restart-note is-error">{error}</p> : null}
    </div>
  );
}

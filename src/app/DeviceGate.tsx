import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';
import { ApiError, apiJson, signedOutEvent } from './api';
import { setAtComputer, setThisComputer } from './device';
import { LockMark, type LockMarkStage } from './LockMark';
import { cn } from './format';

/** What /api/access/status says about this browser (server/access-routes.js). */
export type AccessStatus = {
  thisComputer: boolean;
  signedIn: boolean;
  canAdmin: boolean;
  studioPassword: { set: boolean; hidden: boolean };
};

type GateState =
  | { kind: 'checking' }
  | { kind: 'in' }
  | { kind: 'sign-in'; status: AccessStatus }
  | { kind: 'refused'; title: string; text: string };

const loopbackNames = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Other devices sign in before the studio loads: phones and other computers
 * see this screen until the studio password opens it. On the computer HEISS
 * UI runs on the studio starts at once and nothing here shows. When a
 * session ends (a week passed, or "Sign out all devices"), the next request
 * says so and this screen comes back.
 */
export function DeviceGate({ children }: React.PropsWithChildren) {
  // On localhost there is nothing to wait for; the check runs behind the studio.
  const [state, setState] = useState<GateState>(() => (typeof window !== 'undefined' && loopbackNames.has(window.location.hostname) ? { kind: 'in' } : { kind: 'checking' }));

  const check = useCallback(async () => {
    try {
      const status = await apiJson<AccessStatus & { ok: boolean }>('/api/access/status', { cache: 'no-store' });
      setThisComputer(status.canAdmin);
      setAtComputer(status.thisComputer);
      setState(status.signedIn ? { kind: 'in' } : { kind: 'sign-in', status });
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setState(error.reason === 'host'
          ? { kind: 'refused', title: 'Open HEISS UI by its address', text: error.message }
          : { kind: 'refused', title: 'Not open to other devices', text: 'HEISS UI only answers the computer it runs on right now. On that computer, open Settings › Connection and turn on “Open on other devices”, then reload this page.' });
        return;
      }
      // Not reachable at all: the studio has its own offline screens.
      setState({ kind: 'in' });
    }
  }, []);

  useEffect(() => { check(); }, [check]);
  useEffect(() => {
    const again = () => { check(); };
    window.addEventListener(signedOutEvent, again);
    return () => window.removeEventListener(signedOutEvent, again);
  }, [check]);

  if (state.kind === 'in') return <>{children}</>;
  if (state.kind === 'checking') return <div className="device-gate" aria-busy="true" />;
  if (state.kind === 'refused') return <GateMessage title={state.title} text={state.text} />;
  const { studioPassword } = state.status;
  if (!studioPassword.set && !studioPassword.hidden) {
    return <GateMessage title="Finish setting up on the computer" text="Other devices open the studio with a studio password. On the computer running HEISS UI, open Settings › Connection and set one, then reload this page." />;
  }
  return <SignIn legacy={studioPassword.hidden} onSignedIn={() => { window.location.reload(); }} />;
}

function GateMessage({ title, text }: { title: string; text: string }) {
  return (
    <section className="device-gate hidden-lockscreen">
      <div className="empty stage-empty hidden-lock-stage">
        <div className="stage-mark"><LockMark className="stage-layer" stage="locked" /></div>
        <div className="stage-copy">
          <h2>{title}</h2>
          <p>{text}</p>
          <div className="empty-actions">
            <button className="reconnect-btn primary" onClick={() => window.location.reload()}><RefreshCw size={13} /> Reload</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SignIn({ legacy, onSignedIn }: { legacy: boolean; onSignedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [stage, setStage] = useState<LockMarkStage>('locked');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const working = stage === 'asking' || stage === 'opening';

  useEffect(() => { window.setTimeout(() => inputRef.current?.focus(), 80); }, []);

  const submit = async () => {
    if (!password || working) return;
    setStage('asking');
    setError('');
    try {
      await apiJson('/api/access/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
      setStage('opening');
      // The lock gets its moment before the studio comes in.
      window.setTimeout(onSignedIn, 600);
    } catch (reason) {
      setStage('failed');
      setError(reason instanceof Error ? reason.message : 'That password is incorrect.');
      setPassword('');
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  return (
    <section className={cn('device-gate hidden-lockscreen', `is-${stage}`)}>
      <div className="empty stage-empty hidden-lock-stage">
        <div className="stage-mark"><LockMark className="stage-layer" stage={stage} /></div>
        <div className="stage-copy">
          <h2>{stage === 'opening' ? 'Signed in' : 'Sign in to HEISS UI'}</h2>
          <p>{legacy
            ? 'Enter the studio password. Until one is set on the computer running HEISS UI, that’s its Hidden password.'
            : 'Enter the studio password set on the computer running HEISS UI.'}</p>
          <div className="empty-actions">
            {stage !== 'opening' ? (
              <div className="hidden-unlock">
                <form className={cn('hidden-unlock-field', stage === 'failed' && 'is-wrong')} onSubmit={(event) => { event.preventDefault(); submit(); }}>
                  <KeyRound size={14} aria-hidden="true" />
                  {/* A name for password managers, so they file the password under this studio. */}
                  <input type="text" name="username" autoComplete="username" value="HEISS UI" readOnly hidden />
                  <input
                    ref={inputRef}
                    className="is-framed"
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    aria-label="Studio password"
                    placeholder="Studio password"
                    value={password}
                    disabled={working}
                    onChange={(event) => { setPassword(event.target.value); if (stage === 'failed') setStage('locked'); }}
                  />
                  <button type="submit" disabled={!password || working}>{working ? '…' : 'Sign in'}</button>
                </form>
                <div className="hidden-unlock-meta" aria-live="polite">
                  {error ? <span className="is-error">{error}</span> : null}
                </div>
              </div>
            ) : <div className="hidden-unlock-spacer" />}
          </div>
        </div>
      </div>
    </section>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { Check, Plug, RefreshCw } from 'lucide-react';
import { EmptyMark } from './EmptyMark';
import { CONNECT_MS, OfflineMark } from './OfflineMark';
import { cn } from './format';

/**
 * What an empty gallery shows, and how it moves between states:
 *
 *   waiting     nothing yet: the first ComfyUI check has not answered
 *   offline     the plug that keeps trying
 *   connecting  ComfyUI answered: the plug snaps in and the socket warms up
 *   morph       the offline scene dissolves while the empty canvas develops
 *   empty       the blank canvas that keeps developing a picture
 *
 * The phases run on timers here, not on anything the canvases report, so a
 * scene that cannot draw (no WebGL, a lost context) never holds the app up.
 * Going offline again at any point returns straight to the offline scene.
 */
type Phase = 'waiting' | 'offline' | 'connecting' | 'morph' | 'empty';

/** When the empty canvas starts developing under the dissolving plug. */
const MORPH_AT = 420;
/** "Connected" stays readable a little longer than the scene takes. */
const CONNECTED_COPY_MS = 1500;

export function EmptyStage({ known, offline, device, retrying, onRetry, onOpenConnection }: {
  known: boolean;
  offline: boolean;
  device?: string;
  retrying: boolean;
  onRetry: () => void;
  onOpenConnection: () => void;
}) {
  const [phase, setPhase] = useState<Phase>(!known ? 'waiting' : offline ? 'offline' : 'empty');
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [offlineRun, setOfflineRun] = useState(0);
  const [sayConnected, setSayConnected] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (!known) return;
    const timers: number[] = [];
    const current = phaseRef.current;
    if (offline) {
      if (current !== 'offline') {
        // A fresh plug each time it goes offline, trying from the start.
        setOfflineRun((run) => run + 1);
        setConnectedAt(null);
        setSayConnected(false);
        setPhase('offline');
      }
    } else if (current === 'offline') {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) {
        setPhase('empty');
      } else {
        setConnectedAt(performance.now());
        setSayConnected(true);
        setPhase('connecting');
        timers.push(window.setTimeout(() => setSayConnected(false), CONNECTED_COPY_MS));
        timers.push(window.setTimeout(() => setPhase('morph'), MORPH_AT));
        timers.push(window.setTimeout(() => setPhase('empty'), CONNECT_MS + 60));
      }
    } else if (current === 'waiting') {
      setPhase('empty');
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [known, offline]);

  const showPlug = phase === 'offline' || phase === 'connecting' || phase === 'morph';
  const showCanvas = phase === 'morph' || phase === 'empty';
  const copy = phase === 'offline' ? 'offline' : sayConnected ? 'connected' : phase === 'empty' ? 'empty' : '';

  return (
    <section className="gallery">
      <div className={cn('empty stage-empty', `is-${phase}`)} aria-live="polite">
        <div className="stage-mark">
          {showPlug ? <OfflineMark key={`plug-${offlineRun}`} className="stage-layer" connectedAt={connectedAt} /> : null}
          {showCanvas ? <EmptyMark className="stage-layer" /> : null}
        </div>
        <div className="stage-copy" key={copy}>
          {copy === 'offline' ? (
            <>
              <h2>ComfyUI is offline</h2>
              <p>Start ComfyUI to connect your studio.</p>
              <div className="empty-actions">
                <button className="reconnect-btn primary" onClick={onRetry} disabled={retrying} aria-busy={retrying || undefined}><RefreshCw size={13} className={cn(retrying && 'spin')} /> {retrying ? 'Checking…' : 'Retry connection'}</button>
                <button className="reconnect-btn" onClick={onOpenConnection}><Plug size={13} /> Connection settings</button>
              </div>
            </>
          ) : copy === 'connected' ? (
            <>
              <h2 className="stage-connected"><span><Check size={12} strokeWidth={3} /></span> Connected</h2>
              <p>{device ? `ComfyUI on ${device}` : 'ComfyUI is ready.'}</p>
            </>
          ) : copy === 'empty' ? (
            <>
              <h2>No outputs yet</h2>
              <p>Write a prompt to get started.</p>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

import { Zap } from 'lucide-react';
import { cn } from './format';
import { Switch } from './SettingsDialog';
import { Tip } from './components';
import { rapidLabel, type RapidStatus } from './rapid.js';

/**
 * HEISS Rapid in the composer (docs/rapid.md): the switch, and why it is off
 * for the next run when it is. Hidden for models it isn't for.
 */
type RapidView = {
  rapid: { use: boolean; status: RapidStatus };
  prefs: { rapid?: boolean };
  setPrefs: (next: { rapid: boolean }) => void;
  openSettings?: (section: 'features') => void;
};

const explainer = 'Starts each picture at half size and finishes it at full size: about twice as fast, with the same detail and memory. A seed frames a little differently with it, so a seed you fix yourself runs without it.';

export function SidebarRapidRow({ view }: { view: RapidView }) {
  const { rapid, prefs, setPrefs, openSettings } = view;
  if (rapid.status === 'model') return null;
  const enabled = prefs.rapid !== false;
  return (
    <div className={cn('rapid-row', rapid.use && 'is-on')}>
      <Tip content={explainer}>
        <span className="rapid-row-copy">
          <strong><Zap size={13} aria-hidden="true" /> Rapid</strong>
          <small>{rapidLabel(rapid.status)}</small>
        </span>
      </Tip>
      {rapid.status === 'install'
        ? <button type="button" className="btn is-ghost rapid-row-setup" onClick={() => openSettings?.('features')}>Set up</button>
        : <Switch size="sm" label="Rapid" checked={enabled} onChange={(next) => setPrefs({ rapid: next })} />}
    </div>
  );
}

export function PhoneRapidRow({ view }: { view: RapidView }) {
  const { rapid, prefs, setPrefs, openSettings } = view;
  if (rapid.status === 'model') return null;
  if (rapid.status === 'install') {
    return (
      <div className="phone-group">
        <button type="button" className="phone-row" onClick={() => openSettings?.('features')}>
          <Zap size={20} /><span>Rapid<small className="is-setup">About twice as fast · tap to set up</small></span>
        </button>
      </div>
    );
  }
  const enabled = prefs.rapid !== false;
  return (
    <div className="phone-group">
      <button type="button" role="switch" aria-checked={enabled} className="phone-row" onClick={() => setPrefs({ rapid: !enabled })}>
        <Zap size={20} /><span>Rapid<small>{rapid.status === 'on' ? 'About twice as fast, same detail' : rapidLabel(rapid.status)}</small></span>
        <span className={cn('phone-switch', enabled && 'is-on')} aria-hidden="true"><i /></span>
      </button>
    </div>
  );
}

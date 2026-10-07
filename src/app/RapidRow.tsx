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
  rapid: { use: boolean; guidance: boolean; status: RapidStatus };
  prefs: { rapidAll?: boolean; rapid?: boolean; rapidGuidance?: boolean };
  setPrefs: (next: { rapidAll: boolean }) => void;
  openSettings?: (section: 'features') => void;
};

const explainer = 'Starts each picture at half size, and drops prompt guidance for the last detail steps, which then cost half: faster, with the same memory. A seed comes out a little differently with it, so a seed you fix yourself runs without it. Its two parts have their own switches in Settings › Features.';

/** Rapid as a whole; the parts keep their own settings underneath. */
const enabledAll = (prefs: RapidView['prefs']) => prefs.rapidAll !== false;

/** What the next run gets, in a few words. */
function onLabel(rapid: RapidView['rapid']) {
  if (rapid.status !== 'on') return rapidLabel(rapid.status);
  return rapid.use && rapid.guidance ? 'Half-size start and guidance' : rapid.use ? 'Half-size start' : 'Lighter guidance';
}

export function SidebarRapidRow({ view }: { view: RapidView }) {
  const { rapid, prefs, setPrefs, openSettings } = view;
  if (rapid.status === 'model') return null;
  const enabled = enabledAll(prefs);
  return (
    <div className={cn('rapid-row', rapid.status === 'on' && 'is-on')}>
      <Tip content={explainer}>
        <span className="rapid-row-copy" tabIndex={0} aria-label={`Rapid: ${onLabel(rapid)}. ${explainer}`}>
          <strong><Zap size={13} aria-hidden="true" /> Rapid</strong>
          <small>{onLabel(rapid)}</small>
        </span>
      </Tip>
      {rapid.status === 'install'
        ? <button type="button" className="btn is-ghost rapid-row-setup" onClick={() => openSettings?.('features')}>Set up</button>
        : <Switch size="sm" label={`Rapid, ${onLabel(rapid)}`} checked={enabled} onChange={(next) => setPrefs({ rapidAll: next })} />}
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
          <Zap size={20} /><span>Rapid<small className="is-setup">Faster pictures · tap to set up</small></span>
        </button>
      </div>
    );
  }
  const enabled = enabledAll(prefs);
  return (
    <div className="phone-group">
      <button type="button" role="switch" aria-checked={enabled} className="phone-row" onClick={() => setPrefs({ rapidAll: !enabled })}>
        <Zap size={20} /><span>Rapid<small>{onLabel(rapid)}</small></span>
        <span className={cn('phone-switch', enabled && 'is-on')} aria-hidden="true"><i /></span>
      </button>
    </div>
  );
}

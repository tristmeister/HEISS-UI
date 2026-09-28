import React from 'react';
import { KeyRound, LogOut, QrCode as QrIcon } from 'lucide-react';
import { apiJson } from './api';
import { CopyIcon, useCopyFeedback } from './CopyFeedback';
import { useAtComputer } from './device';
import { cn } from './format';
import { passwordStrength } from './HiddenSetup';
import { QrCode } from './QrCode';
import { Skeleton } from './components';
import type { ConfirmAction } from './useConfirmation';
import type { ShowToast } from './toast';

type NetworkInfo = {
  listening: boolean;
  port: number;
  interfaces: Array<{ name: string; address: string; likelyVirtual: boolean }>;
  lan?: { saved: boolean; source: 'flag' | 'shell' | 'setting'; supervised: boolean; hiddenReady: boolean };
};

type DeviceSession = { id: string; label: string; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean };
type AccessSettings = { adminFromDevices: boolean; studioPassword: { set: boolean; hidden: boolean }; devices: DeviceSession[] };

type Pieces = {
  Group: React.ComponentType<React.PropsWithChildren<{ title?: string; note?: React.ReactNode; tone?: 'danger' }>>;
  Row: React.ComponentType<React.PropsWithChildren<{ label: React.ReactNode; description?: React.ReactNode; stacked?: boolean; disabled?: boolean }>>;
  Status: React.ComponentType<React.PropsWithChildren<{ tone?: 'ok' | 'bad' | 'warn' }>>;
  Switch: React.ComponentType<{ checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string }>;
};

function ago(value: string) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return '';
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** The studio password: set or changed here, typed twice like Hidden's, since devices can't reset it. */
function StudioPasswordRow({ access, onSaved, showToast, Row, Status }: { access: AccessSettings | null; onSaved: () => void; showToast: ShowToast } & Pick<Pieces, 'Row' | 'Status'>) {
  const atComputer = useAtComputer();
  const [editing, setEditing] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [again, setAgain] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const state = access?.studioPassword;
  const close = () => { setEditing(false); setPassword(''); setAgain(''); };
  const save = async () => {
    setBusy(true);
    try {
      await apiJson('/api/access/studio-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
      close();
      onSaved();
      showToast(state?.set ? 'Studio password changed. Other devices sign in again.' : 'Studio password set', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save the studio password', 'error');
    } finally {
      setBusy(false);
    }
  };
  const canSave = password.length >= 8 && password === again && !busy;
  const hint = !password ? 'At least 8 characters. Not your Hidden password: this one only lets devices in.'
    : password.length < 8 ? `${8 - password.length} more character${8 - password.length === 1 ? '' : 's'}.`
    : again && again !== password ? 'The two don’t match yet.'
    : !again ? 'Type it once more.'
    : passwordStrength(password) > 0.6 ? 'Strong enough.' : 'It works, but a longer one is safer.';
  const label = !state ? <Skeleton className="skeleton-text short" />
    : state.set ? <Status tone="ok">Studio password set</Status>
    : state.hidden ? <Status tone="warn">Using the Hidden password</Status>
    : <Status tone="warn">No studio password</Status>;
  const description = !state ? undefined
    : !atComputer ? 'Other devices sign in with it. It’s set on the computer HEISS UI runs on.'
    : state.set ? 'Other devices sign in with it. Changing it signs every device out.'
    : state.hidden ? 'Other devices still sign in with your Hidden password. Set a studio password so they don’t need that one.'
    : 'Other devices sign in with it before they see anything.';
  return (
    <Row label={label} description={description} stacked={editing}>
      {editing ? (
        <form className="set-inline-form is-password" onSubmit={(event) => { event.preventDefault(); if (canSave) save(); }}>
          <input className="modal-input" type="password" autoComplete="new-password" aria-label="Studio password" placeholder="Studio password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
          <input className="modal-input" type="password" autoComplete="new-password" aria-label="Studio password again" placeholder="Again" value={again} onChange={(event) => setAgain(event.target.value)} />
          <p className="set-inline-hint" aria-live="polite">{hint}</p>
          <button type="button" className="btn is-ghost" onClick={close}>Cancel</button>
          <button type="submit" className="btn is-primary" disabled={!canSave}>{busy ? 'Saving…' : 'Save'}</button>
        </form>
      ) : atComputer && state ? (
        <button className={cn('btn', !state.set && 'is-primary')} onClick={() => setEditing(true)}><KeyRound size={14} /> {state.set ? 'Change' : 'Set'}</button>
      ) : null}
    </Row>
  );
}

/** One address to open on a phone: copy it, or show it as a code to scan. */
function AddressRow({ url, detail, open, onToggle, copyToClipboard, Row }: { url: string; detail: string; open: boolean; onToggle: () => void; copyToClipboard: (text: string) => Promise<boolean> } & Pick<Pieces, 'Row'>) {
  const copy = useCopyFeedback();
  return (
    <>
      <Row label={<span className="set-model-name">{url}</span>} description={detail}>
        <button className={cn('btn is-ghost', open && 'is-active')} aria-expanded={open} aria-label={open ? `Hide the code for ${url}` : `Show a code for ${url}`} onClick={onToggle}><QrIcon size={14} /></button>
        <button className="btn" onClick={() => copy.copyWith(() => copyToClipboard(url), url)}><CopyIcon copied={copy.copied === url} /> {copy.copied === url ? 'Copied' : 'Copy'}</button>
      </Row>
      {open ? (
        <div className="set-qr">
          <QrCode value={url} label={`Code for ${url}`} />
          <p>Point your phone’s camera at it, then sign in with the studio password.</p>
        </div>
      ) : null}
    </>
  );
}

/**
 * Settings › Connection › Other devices. One switch restarts HEISS UI into
 * (or out of) LAN mode; then the addresses to open, the studio password other
 * devices sign in with, whether they may look after the computer, and who is
 * signed in. Passwords, the admin switch and signing everyone out only change
 * on the computer itself; the server refuses them from anywhere else.
 */
export function OtherDevicesGroup({ canChange, confirmAction, restartHeiss, restarting, copyToClipboard, showToast, Group, Row, Status, Switch }: {
  canChange: boolean;
  confirmAction: ConfirmAction;
  restartHeiss: () => Promise<boolean>;
  restarting: boolean;
  copyToClipboard: (text: string) => Promise<boolean>;
  showToast: ShowToast;
} & Pieces) {
  const atComputer = useAtComputer();
  const [network, setNetwork] = React.useState<NetworkInfo | null>(null);
  const [access, setAccess] = React.useState<AccessSettings | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [openCode, setOpenCode] = React.useState('');
  const load = React.useCallback(() => apiJson<NetworkInfo>('/api/network').then(setNetwork).catch(() => null), []);
  const loadAccess = React.useCallback(() => apiJson<AccessSettings>('/api/access/devices').then(setAccess).catch(() => null), []);
  React.useEffect(() => { load(); loadAccess(); }, [load, loadAccess]);
  // The page's own port: Vite's in development, HEISS UI's otherwise.
  const lanUrl = (address: string) => `${window.location.protocol}//${address}:${window.location.port || network?.port || 8787}`;

  const lan = network?.lan;
  const on = Boolean(network?.listening);
  const forced = lan?.source === 'flag' || lan?.source === 'shell';
  // Saved one way, running the other: waiting for a restart.
  const pending = Boolean(lan && !forced && lan.saved !== on);
  const addresses = network?.interfaces || [];
  // One real address: show its code straight away, it's what people came for.
  const shownCode = openCode || (addresses.filter((item) => !item.likelyVirtual).length === 1 ? addresses.find((item) => !item.likelyVirtual)!.address : '');

  const restartNow = () => { restartHeiss(); };
  const toggle = async (next: boolean) => {
    if (!lan) return;
    if (lan.supervised && !await confirmAction({
      title: next ? 'Open on other devices?' : 'Close to other devices?',
      description: next
        ? 'HEISS UI restarts to listen on your network. Running generations stop; this page reloads when it’s back.'
        : 'HEISS UI restarts to answer only this computer. Running generations stop, and phones lose their connection.',
      action: 'Restart HEISS UI'
    })) return;
    setBusy(true);
    try {
      const result = await apiJson<{ restartNeeded: boolean }>('/api/network/lan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: next }) });
      await load();
      if (result.restartNeeded && lan.supervised) restartNow();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not change the setting', 'error');
    } finally {
      setBusy(false);
    }
  };

  const setAdmin = async (enabled: boolean) => {
    if (enabled && !await confirmAction({
      title: 'Trust other devices with admin?',
      description: 'Every device signed in with the studio password can then update HEISS UI, install nodes and models, change the output folder and clear the gallery.',
      action: 'Trust them'
    })) return;
    try {
      const result = await apiJson<{ adminFromDevices: boolean }>('/api/access/admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }) });
      setAccess((current) => current ? { ...current, adminFromDevices: result.adminFromDevices } : current);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not change the setting', 'error');
    }
  };

  const signOutAll = async () => {
    if (!await confirmAction({
      title: 'Sign out all devices?',
      description: 'Every phone and computer signed in to the studio has to enter the studio password again. This computer stays as it is.',
      action: 'Sign out all',
      destructive: true
    })) return;
    try {
      await apiJson('/api/access/sign-out-all', { method: 'POST' });
      await loadAccess();
      showToast('Every other device is signed out', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not sign the devices out', 'error');
    }
  };

  const description = !lan ? undefined
    : lan.source === 'flag' ? 'On for this run: HEISS UI was started with --lan.'
    : lan.source === 'shell' ? 'Set by HOST where HEISS UI was started, so this switch can’t change it.'
    : restarting ? 'Restarting…'
    : pending ? (lan.supervised ? `${lan.saved ? 'Turns on' : 'Turns off'} when HEISS UI restarts.` : `${lan.saved ? 'Turns on' : 'Turns off'} the next time you start HEISS UI.`)
    : on ? 'Phones and other computers on this network can open the studio after signing in.'
    : 'Open the studio from your phone or another computer on this network. HEISS UI restarts to switch.';
  const noPassword = Boolean(access && !access.studioPassword.set && !access.studioPassword.hidden);
  const devices = access?.devices || [];

  return (
    <>
      <Group title="Other devices" note="Only on a network you trust.">
        {lan ? (
          <Row label="Open on other devices" description={description} disabled={busy || restarting}>
            {pending && lan.supervised && !restarting ? <button className="btn" onClick={restartNow}>Restart now</button> : null}
            <Switch label="Open on other devices" checked={forced ? on : lan.saved} disabled={!canChange || forced || busy || restarting} onChange={toggle} />
          </Row>
        ) : !network ? <Row label={<Skeleton className="skeleton-text short" />} /> : null}
        {(on || lan?.saved) && noPassword ? (
          <Row label={<Status tone="warn">Needs a studio password</Status>} description="Other devices sign in with it before they see anything. Set it below." />
        ) : null}
        {on ? addresses.map((item) => (
          <AddressRow
            key={`${item.name}-${item.address}`}
            url={lanUrl(item.address)}
            detail={`${item.name}${item.likelyVirtual ? ' · probably a VPN or virtual adapter' : ''}`}
            open={shownCode === item.address}
            onToggle={() => setOpenCode(shownCode === item.address ? '-' : item.address)}
            copyToClipboard={copyToClipboard}
            Row={Row}
          />
        )) : null}
        {on && network && !addresses.length ? <Row label="No network address" description="This computer isn't on a local network right now." /> : null}
      </Group>

      <Group title="Signing in">
        <StudioPasswordRow access={access} onSaved={loadAccess} showToast={showToast} Row={Row} Status={Status} />
        <Row
          label="Trust other devices with admin"
          description={`Lets signed-in devices update HEISS UI, install nodes and models, change the output folder and clear the gallery.${atComputer ? '' : ' Only this computer can change this.'}`}
          disabled={!atComputer || !access}
        >
          <Switch label="Trust other devices with admin" checked={Boolean(access?.adminFromDevices)} disabled={!atComputer || !access} onChange={setAdmin} />
        </Row>
        {!atComputer ? (
          <Row label="Sign out this device" description="It asks for the studio password again next time.">
            <button className="btn" onClick={() => apiJson('/api/access/sign-out', { method: 'POST' }).catch(() => null).then(() => window.location.reload())}><LogOut size={14} /> Sign out</button>
          </Row>
        ) : null}
      </Group>

      {canChange && (devices.length || atComputer) ? (
        <Group title="Signed-in devices" note={devices.length ? 'Each stays signed in for a week, then asks for the studio password again.' : undefined}>
          {devices.map((device) => (
            <Row key={device.id} label={device.current ? `${device.label} · this device` : device.label} description={`Signed in ${ago(device.createdAt)} · last seen ${ago(device.lastSeenAt)}`} />
          ))}
          {!devices.length ? <Row label="No devices signed in" description="Phones and computers show here once they sign in." /> : null}
          {atComputer && devices.length ? (
            <Row label="Sign out all devices" description="They sign in again with the studio password. This computer stays as it is.">
              <button className="btn is-danger-soft" onClick={signOutAll}><LogOut size={14} /> Sign out all</button>
            </Row>
          ) : null}
        </Group>
      ) : null}
    </>
  );
}

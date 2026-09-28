import React from 'react';
import { KeyRound, LogOut, QrCode as QrIcon } from 'lucide-react';
import { apiJson } from './api';
import { CopyIcon, useCopyFeedback } from './CopyFeedback';
import { useAtComputer } from './device';
import { cn } from './format';
import { SettingsDrawer } from './SettingsDrawer';
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
  /** HTTPS as it runs now (server/tls.js), and `next`: what .env says for the next start. */
  tls?: TlsInfo & { next: TlsInfo; fromShell: boolean; problem?: string };
};

type TlsInfo = { configured: boolean; ok: boolean; error: string; certPath: string; keyPath: string; names: string[]; validTo: string; expired: boolean; port: number; active: boolean };

function day(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * HTTPS for other devices, with a certificate the person already has (for
 * example from `tailscale cert`). Two paths, checked by the server before
 * they are kept; used from the next start.
 */
function HttpsRows({ tls, supervised, restartHeiss, showToast, onSaved, Row, Status }: { tls: NonNullable<NetworkInfo['tls']>; supervised: boolean; restartHeiss: () => Promise<boolean>; showToast: ShowToast; onSaved: () => void } & Pick<Pieces, 'Row' | 'Status'>) {
  const atComputer = useAtComputer();
  const [editing, setEditing] = React.useState(false);
  const [cert, setCert] = React.useState(tls.next.certPath || '');
  const [key, setKey] = React.useState(tls.next.keyPath || '');
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState('');
  const next = tls.next;
  // What .env says differs from what runs: it takes effect after a restart.
  const pending = next.configured !== tls.configured || next.certPath !== tls.certPath || next.keyPath !== tls.keyPath;
  const save = async (off = false) => {
    setBusy(true);
    setProblem('');
    try {
      await apiJson('/api/network/tls', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(off ? {} : { cert, key }) });
      setEditing(false);
      onSaved();
      showToast(off ? 'HTTPS turns off when HEISS UI restarts' : 'Saved. HTTPS starts when HEISS UI restarts.', 'success');
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Those files can’t be used');
    } finally {
      setBusy(false);
    }
  };
  const names = tls.names.filter((name) => !name.startsWith('*.'));
  const label = tls.active ? <Status tone="ok">HTTPS on</Status>
    : tls.configured && (!tls.ok || tls.problem) ? <Status tone="bad">HTTPS can’t start</Status>
    : tls.configured ? <Status tone="warn">HTTPS set up</Status>
    : <Status>HTTPS off</Status>;
  const description = tls.active ? `Other devices connect securely on port ${tls.port}${names.length ? ` as ${names.join(', ')}` : ''}. Certificate valid until ${day(tls.validTo)}.`
    : tls.configured && (!tls.ok || tls.problem) ? `${tls.problem || tls.error} Other devices can’t connect until it’s fixed. This computer still can.`
    : tls.configured ? 'Starts when Open on other devices is on.'
    : 'Traffic from other devices, including the studio password, isn’t encrypted. Fine at home; add a certificate for other networks.';
  return (
    <>
      <Row label={label} description={description} stacked={editing}>
        {editing ? (
          <form className="set-inline-form is-password" onSubmit={(event) => { event.preventDefault(); if (cert.trim() && key.trim() && !busy) save(); }}>
            <input className="modal-input set-path-input" aria-label="Certificate file" placeholder="Certificate file (.crt or .pem)" value={cert} onChange={(event) => setCert(event.target.value)} spellCheck={false} autoComplete="off" autoFocus />
            <input className="modal-input set-path-input" aria-label="Key file" placeholder="Key file (.key)" value={key} onChange={(event) => setKey(event.target.value)} spellCheck={false} autoComplete="off" />
            <p className="set-inline-hint" aria-live="polite">{problem || 'Paths on this computer. With Tailscale, run tailscale cert with this computer’s name and paste the two files it creates.'}</p>
            <button type="button" className="btn is-ghost" onClick={() => { setEditing(false); setProblem(''); }}>Cancel</button>
            <button type="submit" className="btn is-primary" disabled={!cert.trim() || !key.trim() || busy}>{busy ? 'Checking…' : 'Save'}</button>
          </form>
        ) : atComputer && !tls.fromShell ? (
          <>
            {next.configured ? <button className="btn is-ghost" disabled={busy} onClick={() => save(true)}>Turn off</button> : null}
            <button className="btn" onClick={() => setEditing(true)}>{next.configured ? 'Change' : 'Add certificate'}</button>
          </>
        ) : null}
      </Row>
      {pending ? (
        <Row label="Waiting for a restart" description={next.configured ? `HTTPS${next.ok ? ` for ${next.names.join(', ')}` : ''} starts when HEISS UI restarts.` : 'HTTPS turns off when HEISS UI restarts.'}>
          {supervised && atComputer ? <button className="btn" onClick={() => { restartHeiss(); }}>Restart now</button> : null}
        </Row>
      ) : null}
    </>
  );
}

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
      showToast(state?.set ? 'Studio password changed. Other devices need to sign in again.' : 'Studio password set', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Couldn’t save the studio password', 'error');
    } finally {
      setBusy(false);
    }
  };
  const canSave = password.length >= 8 && password === again && !busy;
  const hint = !password ? 'At least 8 characters. Separate from the Hidden password; it only lets devices in.'
    : password.length < 8 ? `${8 - password.length} more character${8 - password.length === 1 ? '' : 's'}.`
    : again && again !== password ? 'The two don’t match yet.'
    : !again ? 'Type it again.'
    : passwordStrength(password) > 0.6 ? 'Strong enough.' : 'It works, but a longer one is safer.';
  const label = !state ? <Skeleton className="skeleton-text short" />
    : state.set ? <Status tone="ok">Studio password set</Status>
    : state.hidden ? <Status tone="warn">Using the Hidden password</Status>
    : <Status tone="warn">No studio password</Status>;
  const description = !state ? undefined
    : !atComputer ? 'Other devices sign in with it. Set it on the computer running HEISS UI.'
    : state.set ? 'Other devices sign in with it. Changing it signs every device out.'
    : state.hidden ? 'Other devices sign in with the Hidden password for now. Set a studio password to keep them separate.'
    : 'Other devices need it to sign in.';
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
        <button className={cn('btn is-ghost', open && 'is-active')} aria-expanded={open} aria-label={open ? `Hide QR code for ${url}` : `Show QR code for ${url}`} onClick={onToggle}><QrIcon size={14} /></button>
        <button className="btn" onClick={() => copy.copyWith(() => copyToClipboard(url), url)}><CopyIcon copied={copy.copied === url} /> {copy.copied === url ? 'Copied' : 'Copy'}</button>
      </Row>
      {open ? (
        <div className="set-qr">
          <QrCode value={url} label={`QR code for ${url}`} />
          <p>Scan with your phone’s camera, then sign in with the studio password.</p>
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
  const tls = network?.tls;
  // With HTTPS the certificate's names are the way in; without it, this computer's addresses.
  // Set up but not running (a bad certificate, a busy port): the network stays closed, and the HTTPS row says why.
  const entries = tls?.configured && !tls.active ? [] : tls?.active
    ? tls.names.filter((name) => !name.startsWith('*.')).map((name) => ({ key: name, url: `https://${name.includes(':') ? `[${name}]` : name}:${tls.port}`, detail: 'HTTPS, from the certificate', virtual: false }))
    : (network?.interfaces || []).map((item) => ({ key: `${item.name}-${item.address}`, url: lanUrl(item.address), detail: `${item.name}${item.likelyVirtual ? ' · probably a VPN or virtual adapter' : ''}`, virtual: item.likelyVirtual }));
  // One real address: show its code straight away, it's what people came for.
  const real = entries.filter((item) => !item.virtual);
  const shownCode = openCode || (real.length === 1 ? real[0].key : '');

  const restartNow = () => { restartHeiss(); };
  const toggle = async (next: boolean) => {
    if (!lan) return;
    if (lan.supervised && !await confirmAction({
      title: next ? 'Open on other devices?' : 'Close to other devices?',
      description: next
        ? 'Running generations stop and this page reloads.'
        : 'Running generations stop and other devices disconnect.',
      action: 'Restart HEISS UI'
    })) return;
    setBusy(true);
    try {
      const result = await apiJson<{ restartNeeded: boolean }>('/api/network/lan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: next }) });
      await load();
      if (result.restartNeeded && lan.supervised) restartNow();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Couldn’t change the setting', 'error');
    } finally {
      setBusy(false);
    }
  };

  const setAdmin = async (enabled: boolean) => {
    if (enabled && !await confirmAction({
      title: 'Trust other devices with admin?',
      description: 'Signed-in devices can then update HEISS UI, install nodes and models, change the output folder and clear the gallery.',
      action: 'Allow admin'
    })) return;
    try {
      const result = await apiJson<{ adminFromDevices: boolean }>('/api/access/admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }) });
      setAccess((current) => current ? { ...current, adminFromDevices: result.adminFromDevices } : current);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Couldn’t change the setting', 'error');
    }
  };

  const signOutAll = async () => {
    if (!await confirmAction({
      title: 'Sign out all devices?',
      description: 'They need the studio password to sign in again. This computer isn’t affected.',
      action: 'Sign out all',
      destructive: true
    })) return;
    try {
      await apiJson('/api/access/sign-out-all', { method: 'POST' });
      await loadAccess();
      showToast('All devices signed out', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Couldn’t sign the devices out', 'error');
    }
  };

  const description = !lan ? undefined
    : lan.source === 'flag' ? 'On because HEISS UI was started with --lan.'
    : lan.source === 'shell' ? 'Set by HOST when HEISS UI was started, so it can’t be changed here.'
    : restarting ? 'Restarting…'
    : pending ? (lan.supervised ? `${lan.saved ? 'Turns on' : 'Turns off'} when HEISS UI restarts.` : `${lan.saved ? 'Turns on' : 'Turns off'} the next time you start HEISS UI.`)
    : on ? 'Phones and other computers on this network can open the studio after signing in.'
    : 'Lets phones and other computers on this network open the studio. Switching restarts HEISS UI.';
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
          <Row label={<Status tone="warn">Needs a studio password</Status>} description="Other devices need it to sign in. Set it below." />
        ) : null}
        {on ? entries.map((item) => (
          <AddressRow
            key={item.key}
            url={item.url}
            detail={item.detail}
            open={shownCode === item.key}
            onToggle={() => setOpenCode(shownCode === item.key ? '-' : item.key)}
            copyToClipboard={copyToClipboard}
            Row={Row}
          />
        )) : null}
        {on && network && !entries.length && !(tls?.configured && !tls.ok) ? <Row label="No network address" description="This computer isn’t on a local network right now." /> : null}
      </Group>

      <Group title="Signing in">
        <StudioPasswordRow access={access} onSaved={loadAccess} showToast={showToast} Row={Row} Status={Status} />
        <Row
          label="Trust other devices with admin"
          description={`Lets signed-in devices update HEISS UI, install nodes and models, change the output folder and clear the gallery.${atComputer ? '' : ' Only the computer running HEISS UI can change this.'}`}
          disabled={!atComputer || !access}
        >
          <Switch label="Trust other devices with admin" checked={Boolean(access?.adminFromDevices)} disabled={!atComputer || !access} onChange={setAdmin} />
        </Row>
        {!atComputer ? (
          <Row label="Sign out this device" description="The studio password is needed again next time.">
            <button className="btn" onClick={() => apiJson('/api/access/sign-out', { method: 'POST' }).catch(() => null).then(() => window.location.reload())}><LogOut size={14} /> Sign out</button>
          </Row>
        ) : null}
      </Group>

      {canChange && (devices.length || atComputer) ? (
        <Group title="Signed-in devices" note={devices.length ? 'Devices stay signed in for a week.' : undefined}>
          {devices.map((device) => (
            <Row key={device.id} label={device.current ? `${device.label} · this device` : device.label} description={`Signed in ${ago(device.createdAt)} · last seen ${ago(device.lastSeenAt)}`} />
          ))}
          {!devices.length ? <Row label="No devices signed in" description="Devices appear here after they sign in." /> : null}
          {atComputer && devices.length ? (
            <Row label="Sign out all devices" description="They need the studio password to sign in again.">
              <button className="btn is-danger-soft" onClick={signOutAll}><LogOut size={14} /> Sign out all</button>
            </Row>
          ) : null}
        </Group>
      ) : null}

      {tls ? (
        <Group title="Advanced">
          <SettingsDrawer
            id="set-https"
            title="HTTPS for other devices"
            description={<>{tls.active ? 'On' : tls.configured && (!tls.ok || tls.problem) ? 'Set up, but it can’t start' : tls.configured ? 'Set up' : 'Off'}. Uses a certificate you already have, such as one from <code>tailscale cert</code>.</>}
            defaultOpen={Boolean(tls.configured && (!tls.ok || tls.problem))}
          >
            <HttpsRows tls={tls} supervised={Boolean(lan?.supervised)} restartHeiss={restartHeiss} showToast={showToast} onSaved={load} Row={Row} Status={Status} />
          </SettingsDrawer>
        </Group>
      ) : null}
    </>
  );
}

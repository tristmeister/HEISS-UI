import React, { useEffect, useState } from 'react';
import { bridgeRequest, type Transfer } from './bridge';
type Device = { id: string; name: string; lastSeen: string; revoked: boolean };
type Network = { enabled: boolean; receiverUrl: string; localReceiverUrl: string; setupUrl: string; fingerprint: string; hostTrust: { status: string; supported: boolean; error?: string } };
export function BridgeSettings({ deviceId, onDeviceChange }: { deviceId: string; onDeviceChange: (id: string) => void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number }>();
  const [tls, setTls] = useState(false);
  const [network, setNetwork] = useState<Network>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const data = await bridgeRequest<{ devices: Device[]; transfers: Transfer[]; tls: boolean; network?: Network }>('/admin');
    setNetwork(data.network);
    setDevices(data.devices); setTransfers(data.transfers); setTls(data.tls); setError('');
  }
  useEffect(() => { refresh().catch(e => setError(e.message)); const timer = setInterval(() => refresh().catch(() => {}), 3000); return () => clearInterval(timer); }, []);
  async function action(fn: () => Promise<unknown>) { setBusy(true); setError(''); try { await fn(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Bridge action failed.'); } finally { setBusy(false); } }
  return <section className="bridge-settings"><h3>LAN Bridge</h3><p className="field-meta">Send generated images to a paired device. The host deletes each original after that device verifies its saved copy.</p>
    <label className="bridge-select">Save new images to<select value={deviceId} onChange={e => onDeviceChange(e.target.value)}><option value="">Host gallery / Private Vault</option>{devices.filter(d => !d.revoked).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    {network && !network.enabled && <><p className="bridge-notice">J AI creates local certificates, starts an encrypted connection, and installs trust on this Mac or Windows computer. Approve any operating-system prompt.{tls && ' Your own JAI_TLS certificate keeps serving this page; the desktop bridge listens on its own port.'}</p><div className="setting-actions"><button disabled={busy} onClick={() => action(() => bridgeRequest('/enable', {}))}>{busy ? 'Setting up…' : 'Enable desktop bridge'}</button></div></>}
    {!network && <p className="bridge-notice">Desktop bridge networking is unavailable in this session. Serve the app over your own trusted HTTPS certificate and open <code>/bridge/receive</code> on the other computer.</p>}
    {network?.enabled && <><div className="setting-row"><span>Desktop bridge</span><strong>HTTPS ready</strong></div><p className="field-meta">On the receiving computer, open this setup address once to trust your host:</p><a className="bridge-address" href={network.setupUrl} target="_blank" rel="noreferrer">{network.setupUrl}</a><div className="setting-actions"><button onClick={() => action(() => navigator.clipboard.writeText(network.setupUrl))}>Copy setup address</button>{network.hostTrust.supported && network.hostTrust.status !== 'installed' && <button disabled={busy || network.hostTrust.status === 'installing'} onClick={() => action(() => bridgeRequest('/trust-host', {}))}>{network.hostTrust.status === 'installing' ? 'Waiting for OS approval…' : 'Trust this host computer'}</button>}</div>{network.hostTrust.error && <p className="field-meta">{network.hostTrust.error}</p>}<details className="bridge-pairing"><summary>Certificate fingerprint</summary><p>Compare this with the certificate shown on the receiving computer before approving trust.</p><code className="bridge-fingerprint">{network.fingerprint}</code></details></>}
    <div className="setting-actions"><button disabled={busy} onClick={() => action(async () => setPairing(await bridgeRequest('/pairings', {})))}>Create pairing code</button><a className="ghost-button" href={network?.enabled ? network.localReceiverUrl : '/bridge/receive'} target="_blank" rel="noreferrer">Open receiver</a></div>
    {pairing && <div className="bridge-pairing"><p>Open {network?.enabled ? <a href={network.receiverUrl} target="_blank" rel="noreferrer">the receiver</a> : 'the receiver page'} on the other computer and enter these six digits:</p><code className="bridge-code">{pairing.code.slice(0, 3)} {pairing.code.slice(3)}</code><p>Expires at {new Date(pairing.expiresAt).toLocaleTimeString()} · one use</p></div>}
    {devices.filter(d => !d.revoked).map(d => <div className="setting-row" key={d.id}><span>{d.name}<small>Last seen {new Date(d.lastSeen).toLocaleTimeString()}</small></span><button disabled={busy} onClick={() => action(async () => { await bridgeRequest(`/devices/${d.id}/revoke`, {}); if (deviceId === d.id) onDeviceChange(''); })}>Revoke</button></div>)}
    {transfers.filter(t => t.state !== 'deleted').map(t => <div className="setting-row" key={t.id}><span>{t.state === 'cleanup-failed' ? 'Host cleanup needs attention' : 'Waiting for device to save'}{t.error && <small>{t.error}</small>}</span><div className="setting-actions">{t.state === 'cleanup-failed' && <button disabled={busy} onClick={() => action(() => bridgeRequest(`/transfers/${t.id}/retry`, {}))}>Retry cleanup</button>}{deviceId && deviceId !== t.deviceId && t.state === 'ready' && <button disabled={busy} onClick={() => action(() => bridgeRequest(`/transfers/${t.id}/assign`, { deviceId }))}>Send to selected device</button>}<button disabled={busy} onClick={() => { if (window.confirm('Permanently delete this host image without waiting for the receiver? It may be the only copy.')) action(async () => { const result = await bridgeRequest<{ ok: boolean; error?: string }>(`/transfers/${t.id}/discard`, {}); if (!result.ok) throw new Error(result.error || 'Host deletion failed.'); }); }}>Discard</button></div></div>)}
    {error && <p role="alert" className="bridge-error">{error}</p>}
  </section>;
}

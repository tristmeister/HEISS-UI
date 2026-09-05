import React, { useEffect, useState } from 'react';
import { bridgeRequest, checksum, stored, type Pair, type SavedImage, type Transfer } from './bridge';

function LocalImage({ item, remove }: { item: SavedImage; remove: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(item.blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [item.blob]);
  return <article className="bridge-image"><img src={url} alt="Received generation" loading="lazy" /><div><span>{item.acknowledged ? 'Saved · host copy deleted' : 'Saved · confirming host cleanup'}</span><a href={url} download={item.name}>Export image</a><button onClick={remove}>Delete from this device</button></div></article>;
}
export function BridgeReceiver() {
  const [pair, setPair] = useState<Pair>();
  const [images, setImages] = useState<SavedImage[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('My device');
  const [status, setStatus] = useState('Starting device library…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [persistent, setPersistent] = useState(false);
  const secure = window.isSecureContext && Boolean(crypto.subtle);
  async function refresh() { setImages((await stored<SavedImage[]>('images', s => s.getAll())).sort((a, b) => b.createdAt.localeCompare(a.createdAt))); }
  useEffect(() => {
    if (!secure) return;
    Promise.all([stored<Pair>('settings', s => s.get('pair')).then(setPair), refresh(), navigator.storage?.persisted?.().then(setPersistent)]).then(() => setStatus('Ready to receive')).catch(e => setError(e.message));
  }, []);
  useEffect(() => {
    if (!pair || !secure) return;
    let stopped = false;
    let reconciled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        let changed = false;
        const inbox = await bridgeRequest<{ transfers: Transfer[] }>('/inbox', undefined, pair!.token);
        for (const transfer of inbox.transfers) {
          if (stopped) break;
          let image = await stored<SavedImage | undefined>('images', s => s.get(transfer.id));
          if (!image) {
            setStatus(`Receiving ${Math.round(transfer.size / 1024)} KB…`);
            if (transfer.size > 128 * 1024 * 1024) throw new Error('Image exceeds the receiver limit.');
            const response = await fetch(`/api/bridge/transfers/${transfer.id}/content`, { headers: { Authorization: `Bearer ${pair!.token}` }, cache: 'no-store' });
            if (!response.ok) throw new Error('Transfer interrupted. Retrying shortly.');
            const blob = await response.blob();
            if (blob.size !== transfer.size || await checksum(blob) !== transfer.sha256) throw new Error('Image verification failed. Host copy retained.');
            await stored('images', s => s.put({ ...transfer, blob, acknowledged: false }), true);
            image = await stored<SavedImage>('images', s => s.get(transfer.id));
          }
          if (!image || await checksum(image.blob) !== transfer.sha256) throw new Error('Device storage verification failed. Host copy retained.');
          setStatus('Saved on this device · confirming host cleanup…');
          const acknowledgement = await bridgeRequest<{ ok: boolean; error?: string }>(`/transfers/${transfer.id}/ack`, { sha256: transfer.sha256 }, pair!.token);
          if (!acknowledgement.ok) throw new Error(acknowledgement.error || 'Saved here, but host cleanup needs attention.');
          await stored('images', s => s.put({ ...image, acknowledged: true }), true);
          changed = true;
        }
        // A lost acknowledgement response may leave a saved local record pending;
        // retrying is safe even when the host has already deleted the original.
        const local = reconciled ? [] : await stored<SavedImage[]>('images', s => s.getAll());
        for (const item of local.filter(i => !i.acknowledged && !inbox.transfers.some(t => t.id === i.id))) {
          if (stopped) break;
          if (await checksum(item.blob) !== item.sha256) throw new Error('Saved image verification failed.');
          const ack = await bridgeRequest<{ ok: boolean }>(`/transfers/${item.id}/ack`, { sha256: item.sha256 }, pair!.token);
          if (ack.ok) { await stored('images', s => s.put({ ...item, acknowledged: true }), true); changed = true; }
        }
        reconciled = true;
        if (!stopped) { if (changed) await refresh(); setError(''); setStatus('Connected · waiting for images'); }
      } catch (e) { if (!stopped) { await refresh().catch(() => {}); setError(e instanceof Error ? e.message : 'Connection interrupted.'); } }
      finally { if (!stopped) timer = setTimeout(poll, 1500); }
    }
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [pair, secure]);
  async function connect() {
    setBusy(true); setError('');
    try {
      const next = await bridgeRequest<Pair>('/pair', { code: code.trim(), name });
      await stored('settings', s => s.put(next, 'pair'), true);
      setPair(next); setCode('');
      setPersistent(await navigator.storage?.persist?.() || false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Pairing failed.'); }
    finally { setBusy(false); }
  }
  return <main className="bridge-receiver"><header><a href="/">J AI Studio</a><h1>Your device library</h1><p>Images generated on your host, saved here.</p></header>
    {!secure ? <section className="bridge-notice"><h2>Open a secure connection</h2><p>Use the host’s trusted HTTPS address to pair and receive images over your local network.</p></section> : <>
      <section className="bridge-panel"><h2>{pair ? 'Receiver connected' : 'Pair this device'}</h2>{pair ? <><p role="status">{status}</p><button onClick={async () => { await stored('settings', s => s.delete('pair'), true); setPair(undefined); }}>Disconnect</button></> : <form onSubmit={e => { e.preventDefault(); connect(); }}><label>Device name<input value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label><label>Six-digit pairing code<input className="bridge-code-input" value={code} type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" spellCheck={false} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" /></label><button disabled={busy || code.length !== 6}>{busy ? 'Pairing…' : 'Pair device'}</button></form>}{error && <p role="alert" className="bridge-error">{error}</p>}</section>
      <p className="bridge-notice">Keep this page open while receiving. {persistent ? 'Persistent browser storage is enabled. ' : 'Browser storage may be cleared automatically. '}Export images you want to keep outside J AI. Clearing site data removes this library.</p>
      <section className="bridge-library" aria-label="Saved images">{images.length ? images.map(item => <LocalImage key={item.id} item={item} remove={async () => { if (!item.acknowledged) { setError('Wait for host cleanup before deleting this local copy.'); return; } if (!window.confirm('Delete this image from this device? The host copy has already been deleted.')) return; await stored('images', s => s.delete(item.id), true); await refresh(); }} />) : <p>Your received images will appear here.</p>}</section>
    </>}</main>;
}

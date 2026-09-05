import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { comfy, comfyOutputDir, isLocalClient, root } from './comfy.js';
import { encryptionKeyFromRequest } from './privacy.js';

const dir = path.join(process.env.JAI_DATA_DIR ? path.resolve(process.env.JAI_DATA_DIR) : path.join(root, 'data'), '.bridge');
const statePath = path.join(dir, 'state.enc');
let state;
const pairings = new Map();
const attempts = new Map();
const maximumBytes = 128 * 1024 * 1024;
const activeStreams = new Map();
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function key() {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
  return fs.readFileSync(file);
}
function read() {
  if (state) return state;
  if (!fs.existsSync(statePath)) return state = { devices: [], jobs: [], transfers: [] };
  const bytes = fs.readFileSync(statePath);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return state = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
}
function save() {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(read())), cipher.final()]);
  const temp = `${statePath}.tmp`;
  const fd = fs.openSync(temp, 'w', 0o600);
  try { fs.writeFileSync(fd, Buffer.concat([iv, cipher.getAuthTag(), data])); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, statePath);
}
export function bridgeDevice(id) { return read().devices.find(d => d.id === id && !d.revoked); }
export function reserveBridgeJob(id, deviceId) {
  if (!/^[\w-]{1,128}$/.test(id)) throw new Error('Invalid bridge job ID.');
  if (!bridgeDevice(deviceId)) throw new Error('Choose a paired receiver.');
  if (!comfyOutputDir) throw new Error('Configure the ComfyUI output folder first.');
  const base = fs.realpathSync(comfyOutputDir);
  const parent = path.join(base, '.jai-bridge');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(parent).isSymbolicLink() || fs.realpathSync(parent) !== parent) throw new Error('Unsafe bridge output folder.');
  const folder = path.join(parent, id);
  fs.mkdirSync(folder, { mode: 0o700 });
  read().jobs.push({ id, deviceId, folder, createdAt: new Date().toISOString() });
  save();
}
export function markBridgePrompt(id, promptId) {
  const job = read().jobs.find(j => j.id === id);
  if (job) { job.promptId = promptId; save(); }
}
export function bridgeGraph(graph, id) {
  let found = false;
  for (const [nodeId, node] of Object.entries(graph)) if (node.class_type === 'SaveImage') {
    node.inputs.filename_prefix = `.jai-bridge/${id}/image-${nodeId.replace(/[^\w-]/g, '_')}`;
    found = true;
  }
  if (!found) throw new Error('Add a standard SaveImage node for the image you want sent through LAN Bridge. Other output nodes are left unchanged.');
  return graph;
}
function safeSource(job, output) {
  const url = new URL(output.url, 'http://localhost');
  const filename = url.searchParams.get('filename') || '';
  const folder = url.searchParams.get('subfolder') || '';
  if (url.searchParams.get('type') !== 'output' || path.basename(filename) !== filename || !filename.endsWith('.png')) throw new Error('Unexpected bridge output.');
  const candidate = path.resolve(fs.realpathSync(comfyOutputDir), folder, filename);
  if (path.dirname(candidate) !== job.folder || fs.lstatSync(candidate).isSymbolicLink() || fs.realpathSync(candidate) !== candidate) throw new Error('Unsafe bridge output.');
  const stat = fs.statSync(candidate);
  if (!stat.isFile() || stat.size > maximumBytes || stat.size === 0) throw new Error('Bridge image is empty or exceeds 128 MB.');
  return { candidate, stat };
}
export function stageBridgeOutputs(id, outputs) {
  const job = read().jobs.find(j => j.id === id);
  if (!job) throw new Error('Bridge job is missing.');
  const bridgeOutputs = outputs.filter(output => {
    const folder = new URL(output.url, 'http://localhost').searchParams.get('subfolder') || '';
    return folder.replaceAll('\\', '/') === `.jai-bridge/${id}`;
  });
  if (!bridgeOutputs.length) throw new Error('No SaveImage bridge outputs were returned by this workflow.');
  for (const output of bridgeOutputs) {
    const { candidate, stat } = safeSource(job, output);
    if (read().transfers.some(t => t.source === candidate)) continue;
    const bytes = fs.readFileSync(candidate);
    if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG output.');
    read().transfers.push({ id: crypto.randomUUID(), jobId: id, deviceId: job.deviceId, source: candidate, name: `JAI-${crypto.randomUUID()}.png`, mime: 'image/png', size: stat.size, sha256: hash(bytes), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), createdAt: job.createdAt, state: 'ready' });
  }
  job.staged = true;
  save();
}
function finishTransfer(t, discard = false) {
  // The receiver's durable acknowledgement is persisted before any deletion.
  if (!t.acknowledged && !discard) throw new Error('Receiver has not confirmed its save.');
  try {
    if (fs.existsSync(t.source)) {
      if (fs.lstatSync(t.source).isSymbolicLink() || fs.realpathSync(t.source) !== t.source || hash(fs.readFileSync(t.source)) !== t.sha256) throw new Error('Host output changed; automatic deletion stopped.');
      fs.unlinkSync(t.source);
    }
    t.state = 'deleted'; delete t.error;
    delete t.source;
    const job = read().jobs.find(j => j.id === t.jobId);
    if (job && read().transfers.filter(x => x.jobId === job.id).every(x => x.state === 'deleted')) {
      try { fs.rmdirSync(job.folder); } catch { /* Never remove unrelated files. */ }
      read().jobs = read().jobs.filter(j => j.id !== job.id);
    }
  } catch (error) { t.state = 'cleanup-failed'; t.error = error.message; }
  save();
  return { ok: t.state === 'deleted', state: t.state, error: t.error };
}
function secure(req) { return Boolean(req.socket.encrypted) || (isLocalClient(req.socket.remoteAddress) && /^localhost(?::\d+)?$|^127\.0\.0\.1(?::\d+)?$|^\[::1\](?::\d+)?$/.test(req.headers.host || '')); }
function sameOrigin(req) { return !req.headers.origin || req.headers.origin === `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`; }
export function bridgeAdmin(req, res) {
  if (!secure(req) || !sameOrigin(req) || !isLocalClient(req.socket.remoteAddress) || !encryptionKeyFromRequest(req)) {
    res.status(403).json({ error: 'Unlock privacy on the host. Bridge requires HTTPS for LAN access.' }); return false;
  }
  return true;
}
function receiver(req, res) {
  if (!secure(req) || !sameOrigin(req)) { res.status(403).json({ error: 'Open the receiver using trusted HTTPS.' }); return null; }
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  const device = read().devices.find(d => !d.revoked && d.tokenHash === hash(token));
  if (!device) { res.status(401).json({ error: 'Pair this device again.' }); return null; }
  device.lastSeen = new Date().toISOString();
  return device;
}
export function installBridgeRoutes(app, network = {}) {
  app.use('/api/bridge', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/api/bridge/admin', (req, res) => {
    if (!bridgeAdmin(req, res)) return;
    res.json({ tls: Boolean(req.socket.encrypted), network: network.info?.(), devices: read().devices.map(({ tokenHash, ...d }) => d), transfers: read().transfers.map(({ source, ...t }) => t) });
  });
  app.post('/api/bridge/enable', async (req, res) => {
    if (!bridgeAdmin(req, res)) return;
    if (!network.enable) return res.status(503).json({ error: 'Desktop bridge networking is unavailable.' });
    try { res.json(await network.enable()); } catch (error) { res.status(500).json({ error: error.message }); }
  });
  app.post('/api/bridge/trust-host', async (req, res) => {
    if (!bridgeAdmin(req, res)) return;
    if (!network.trustHost) return res.status(503).json({ error: 'Host trust installation is unavailable.' });
    try { await network.trustHost(); res.json(network.info()); } catch (error) { res.status(500).json({ error: error.message }); }
  });
  app.post('/api/bridge/pairings', (req, res) => {
    if (!bridgeAdmin(req, res)) return;
    pairings.clear();
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = Date.now() + 5 * 60_000;
    pairings.set(code, { expiresAt, attempts: 0 }); res.json({ code, expiresAt });
  });
  app.post('/api/bridge/disable', (req, res) => {
    if (!bridgeAdmin(req, res)) return;
    if (!network.disable) return res.status(503).json({ error: 'Desktop bridge networking is unavailable.' });
    res.json({ ok: true });
    setTimeout(() => network.disable().catch(() => {}), 100);
  });
  app.post('/api/bridge/pair', (req, res) => {
    if (!secure(req) || !sameOrigin(req)) return res.status(403).json({ error: 'Pairing requires trusted HTTPS on LAN.' });
    const ip = req.socket.remoteAddress;
    if (attempts.size > 1000) attempts.clear();
    const attempt = attempts.get(ip) || { count: 0, until: Date.now() + 60_000 };
    if (attempt.until < Date.now()) { attempt.count = 0; attempt.until = Date.now() + 60_000; }
    attempts.set(ip, attempt);
    if (++attempt.count > 10) return res.status(429).json({ error: 'Too many attempts. Wait one minute.' });
    const code = String(req.body.code || '').trim();
    const active = [...pairings.values()][0];
    if (!active || active.expiresAt <= Date.now() || active.attempts >= 10) { pairings.clear(); return res.status(401).json({ error: 'Pairing code expired. Create a new code on the host.' }); }
    active.attempts += 1;
    if (!/^\d{6}$/.test(code) || !pairings.has(code)) return res.status(401).json({ error: 'Pairing code invalid. Enter the six digits from your host.' });
    pairings.delete(code);
    const token = crypto.randomBytes(32).toString('base64url');
    const device = { id: crypto.randomUUID(), name: String(req.body.name || 'Receiver').slice(0, 80), tokenHash: hash(token), lastSeen: new Date().toISOString(), revoked: false };
    read().devices.push(device); save(); res.json({ deviceId: device.id, token });
  });
  app.post('/api/bridge/devices/:id/revoke', (req, res) => {
    if (!bridgeAdmin(req, res)) return;
    const d = read().devices.find(x => x.id === req.params.id);
    if (!d) return res.status(404).json({ error: 'Device missing.' });
    d.revoked = true;
    for (const stream of activeStreams.get(d.id) || []) stream.destroy();
    save(); res.json({ ok: true });
  });
  app.get('/api/bridge/inbox', (req, res) => {
    const d = receiver(req, res); if (!d) return;
    res.json({ transfers: read().transfers.filter(t => t.deviceId === d.id && t.state !== 'deleted').map(({ source, ...t }) => t) });
  });
  app.get('/api/bridge/transfers/:id/content', async (req, res) => {
    const d = receiver(req, res); if (!d) return;
    const t = read().transfers.find(x => x.id === req.params.id && x.deviceId === d.id && x.state !== 'deleted');
    if (!t) return res.status(404).json({ error: 'Transfer missing.' });
    try {
      if (fs.realpathSync(t.source) !== t.source || fs.lstatSync(t.source).isSymbolicLink()) throw new Error('Unsafe output.');
      res.type(t.mime); res.setHeader('Content-Length', t.size);
      const stream = fs.createReadStream(t.source);
      if (!activeStreams.has(d.id)) activeStreams.set(d.id, new Set());
      activeStreams.get(d.id).add(stream);
      try { await pipeline(stream, res); } finally { activeStreams.get(d.id).delete(stream); }
    } catch { if (!res.headersSent) res.status(409).json({ error: 'Output unavailable.' }); else res.destroy(); }
  });
  app.post('/api/bridge/transfers/:id/ack', (req, res) => {
    const d = receiver(req, res); if (!d) return;
    const t = read().transfers.find(x => x.id === req.params.id && x.deviceId === d.id);
    if (!t) return res.status(404).json({ error: 'Transfer missing.' });
    if (req.body.sha256 !== t.sha256) return res.status(409).json({ error: 'Image checksum mismatch.' });
    if (t.state === 'deleted') return res.json({ ok: true, state: 'deleted' });
    t.acknowledged = true; save(); res.json(finishTransfer(t));
  });
  app.post('/api/bridge/transfers/:id/retry', (req, res) => {
    if (!bridgeAdmin(req, res)) return;
    const t = read().transfers.find(x => x.id === req.params.id);
    if (!t?.acknowledged) return res.status(409).json({ error: 'Waiting for receiver save.' });
    res.json(finishTransfer(t));
  });
  app.post('/api/bridge/transfers/:id/discard', (req, res) => {
    if (!bridgeAdmin(req, res)) return;
    const t = read().transfers.find(x => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'Transfer missing.' });
    if (t.state === 'deleted') return res.json({ ok: true, state: 'deleted' });
    // Explicit host action; never used by automatic expiry or disconnect paths.
    res.json(finishTransfer(t, true));
  });
  app.post('/api/bridge/transfers/:id/assign', (req, res) => {
    if (!bridgeAdmin(req, res)) return;
    const t = read().transfers.find(x => x.id === req.params.id);
    const d = bridgeDevice(String(req.body.deviceId || ''));
    if (!t || !d || t.acknowledged || t.state === 'deleted') return res.status(409).json({ error: 'Choose an active device and an unsaved transfer.' });
    for (const stream of activeStreams.get(t.deviceId) || []) stream.destroy();
    t.deviceId = d.id; save(); res.json({ ok: true });
  });
}
export async function recoverBridgeJobs(activeJobIds = new Set()) {
  for (const t of read().transfers) if (t.acknowledged && t.state !== 'deleted') finishTransfer(t);
  for (const job of read().jobs) {
    if (activeJobIds.has(job.id)) continue;
    if (!job.promptId) {
      const history = await comfy('/history?max_items=500').catch(() => ({}));
      const match = Object.entries(history).find(([, entry]) => entry?.prompt?.[3]?.jai_bridge_id === job.id);
      if (match) { job.promptId = match[0]; save(); }
    }
    if (!job.promptId) continue;
    if (job.staged) {
      await comfy('/history', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delete: [job.promptId] }) }).catch(() => null);
      continue;
    }
    const history = await comfy(`/history/${job.promptId}`).catch(() => ({}));
    const entry = history[job.promptId];
    if (!entry) continue;
    const outputs = Object.values(entry.outputs || {}).flatMap(o => o.images || []).map(i => ({ url: `/comfy/view?${new URLSearchParams(i)}` }));
    if (outputs.length) stageBridgeOutputs(job.id, outputs);
  }
}

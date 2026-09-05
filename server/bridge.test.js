import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';

const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jai-bridge-test-')));
process.env.JAI_DATA_DIR = path.join(temporary, 'data');
process.env.COMFY_OUTPUT_DIR = path.join(temporary, 'output');
delete process.env.JAI_TLS_CERT;
delete process.env.JAI_TLS_KEY;
fs.mkdirSync(process.env.COMFY_OUTPUT_DIR);
const history = new Map();
const comfyFixture = express();
comfyFixture.use(express.json());
comfyFixture.post('/prompt', (req, res) => {
  const save = Object.values(req.body.prompt).find(n => n.class_type === 'SaveImage');
  assert.ok(save.inputs.filename_prefix.startsWith('.jai-bridge/'));
  const filename = 'generated.png';
  const subfolder = path.dirname(save.inputs.filename_prefix).replaceAll('\\', '/');
  fs.writeFileSync(path.join(process.env.COMFY_OUTPUT_DIR, subfolder, filename), png);
  const id = crypto.randomUUID();
  history.set(id, { outputs: { '9': { images: [{ filename, subfolder, type: 'output' }] } }, prompt: [0, id, req.body.prompt, req.body.extra_data] });
  res.json({ prompt_id: id });
});
comfyFixture.get('/history/:id', (req, res) => res.json(history.has(req.params.id) ? { [req.params.id]: history.get(req.params.id) } : {}));
comfyFixture.get('/history', (_req, res) => res.json(Object.fromEntries(history)));
comfyFixture.post('/history', (req, res) => { for (const id of req.body.delete || []) history.delete(id); res.json({}); });
const comfyServer = comfyFixture.listen(0, '127.0.0.1');
await new Promise(resolve => comfyServer.once('listening', resolve));
process.env.COMFY_URL = `http://127.0.0.1:${comfyServer.address().port}`;
const { installBridgeRoutes, reserveBridgeJob, stageBridgeOutputs, bridgeGraph } = await import('./bridge.js');
const { setPrivacyPassword, setUnlockCookie } = await import('./privacy.js');
const { recordsFromComfyHistory } = await import('./gallery-store.js');
const key = setPrivacyPassword('isolated-test-password');
let cookie;
setUnlockCookie({ setHeader(_name, value) { cookie = value.split(';')[0]; } }, key);
const app = express();
app.use(express.json()); installBridgeRoutes(app);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/bridge`;
async function request(route, body, token, extra = {}) {
  const response = await fetch(`${base}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : { cookie }), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: response.headers.get('content-type')?.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
}
async function pair(name = 'Test receiver') {
  const code = (await request('/pairings', {})).data.code;
  return (await request('/pair', { code, name })).data;
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9kAAAAASUVORK5CYII=', 'base64');
function fixture(deviceId) {
  const id = crypto.randomUUID(); reserveBridgeJob(id, deviceId);
  const subfolder = `.jai-bridge/${id}`;
  const file = path.join(process.env.COMFY_OUTPUT_DIR, subfolder, 'image.png');
  fs.writeFileSync(file, png);
  const outputs = [{ url: `/comfy/view?${new URLSearchParams({ filename: 'image.png', subfolder, type: 'output' })}` }];
  stageBridgeOutputs(id, outputs);
  return { id, file, outputs, subfolder };
}

test('bridge pairing, delivery, isolation and cleanup', async t => {
  try {
    const receiver = await pair();
    const other = await pair('Other device');
    await t.test('generation job routes a Comfy output to bridge without persisting gallery content', async () => {
      const { jobs, runJob } = await import('./jobs.js');
      const { gallery, writeGalleryNow } = await import('./gallery-store.js');
      const id = crypto.randomUUID(); reserveBridgeJob(id, receiver.deviceId);
      const body = { kind: 'image', workflow: 'checkpoint-image', model: 'fixture.safetensors', prompt: 'private integration prompt', width: 64, height: 64, steps: 1, cfg: 1, count: 1, bridgeDeviceId: receiver.deviceId };
      jobs.set(id, { status: 'queued', bridgeDeviceId: receiver.deviceId });
      await runJob(id, body);
      assert.equal(jobs.get(id).status, 'done');
      assert.equal(jobs.get(id).bridgePending, true);
      assert.equal(gallery.some(i => i.jobId === id), false);
      writeGalleryNow();
      assert.equal(fs.readFileSync(path.join(process.env.JAI_DATA_DIR, 'gallery.json'), 'utf8').includes(body.prompt), false);
      assert.equal(history.size, 0);
      const transfer = (await request('/inbox', undefined, receiver.token)).data.transfers.find(t => t.jobId === id);
      assert.ok(transfer);
      assert.equal((await request(`/transfers/${transfer.id}/ack`, { sha256: transfer.sha256 }, receiver.token)).data.ok, true);
    });
    await t.test('rejects untrusted origin and insecure LAN host', async () => {
      assert.equal((await request('/pairings', {}, undefined, { origin: 'https://evil.example' })).status, 403);
      const insecure = await new Promise(resolve => {
        http.get(`${base}/inbox`, { headers: { host: '192.168.1.20:8787', Authorization: `Bearer ${receiver.token}` } }, res => { res.resume(); resolve(res.statusCode); });
      });
      assert.equal(insecure, 403);
      assert.equal((await request('/admin', undefined, receiver.token)).status, 403);
      assert.equal((await request('/inbox', undefined, 'invalid')).status, 401);
    });
    await t.test('pairing codes are single use', async () => {
      const code = (await request('/pairings', {})).data.code;
      assert.match(code, /^\d{6}$/);
      assert.equal((await request('/pair', { code, name: 'Third device' })).status, 200);
      assert.equal((await request('/pair', { code })).status, 401);
    });
    const image = fixture(receiver.deviceId);
    const transfer = (await request('/inbox', undefined, receiver.token)).data.transfers[0];
    await t.test('isolates content, retains original before acknowledgement, rejects wrong hashes', async () => {
      assert.equal((await request('/inbox', undefined, other.token)).data.transfers.length, 0);
      assert.equal((await request(`/transfers/${transfer.id}/content`, undefined, other.token)).status, 404);
      assert.equal((await request(`/transfers/${transfer.id}/ack`, { sha256: transfer.sha256 }, other.token)).status, 404);
      assert.deepEqual((await request(`/transfers/${transfer.id}/content`, undefined, receiver.token)).data, png);
      assert.ok(fs.existsSync(image.file));
      assert.equal((await request(`/transfers/${transfer.id}/ack`, { sha256: 'wrong' }, receiver.token)).status, 409);
      assert.ok(fs.existsSync(image.file));
    });
    await t.test('excludes bridge files from Comfy history gallery recovery', () => {
      assert.equal(recordsFromComfyHistory({ [image.id]: { outputs: { '9': { images: [{ filename: 'image.png', subfolder: image.subfolder, type: 'output' }] } } } }).length, 0);
    });
    await t.test('deletes only after matching acknowledgement and handles replay', async () => {
      const ack = await request(`/transfers/${transfer.id}/ack`, { sha256: transfer.sha256 }, receiver.token);
      assert.equal(ack.data.ok, true); assert.equal(fs.existsSync(image.file), false);
      assert.equal((await request(`/transfers/${transfer.id}/ack`, { sha256: transfer.sha256 }, receiver.token)).data.ok, true);
      assert.equal((await request('/inbox', undefined, receiver.token)).data.transfers.length, 0);
    });
    await t.test('fails closed when source changes, then allows cleanup retry', async () => {
      const next = fixture(receiver.deviceId);
      const tx = (await request('/inbox', undefined, receiver.token)).data.transfers[0];
      fs.writeFileSync(next.file, Buffer.concat([png, Buffer.from('changed')]));
      const ack = await request(`/transfers/${tx.id}/ack`, { sha256: tx.sha256 }, receiver.token);
      assert.equal(ack.data.state, 'cleanup-failed'); assert.ok(fs.existsSync(next.file));
      fs.writeFileSync(next.file, png);
      assert.equal((await request(`/transfers/${tx.id}/retry`, {})).data.ok, true);
      assert.equal(fs.existsSync(next.file), false);
    });
    await t.test('rejects traversal and symlinks', () => {
      assert.throws(() => reserveBridgeJob('../escape', receiver.deviceId));
      const next = fixture(receiver.deviceId);
      fs.unlinkSync(next.file); fs.symlinkSync(path.join(temporary, 'unrelated.png'), next.file);
      assert.throws(() => stageBridgeOutputs(next.id, next.outputs));
      const graph = { '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'normal' } } };
      assert.equal(bridgeGraph(graph, next.id)['9'].inputs.filename_prefix, `.jai-bridge/${next.id}/image-9`);
    });
    await t.test('revocation stops receiver access and new jobs', async () => {
      assert.equal((await request(`/devices/${receiver.deviceId}/revoke`, {})).data.ok, true);
      assert.equal((await request('/inbox', undefined, receiver.token)).status, 401);
      assert.throws(() => reserveBridgeJob(crypto.randomUUID(), receiver.deviceId));
    });
    await t.test('host can reassign an unsaved transfer or explicitly discard it', async () => {
      const next = fixture(other.deviceId);
      const tx = (await request('/inbox', undefined, other.token)).data.transfers.find(x => x.jobId === next.id);
      const replacement = await pair('Replacement receiver');
      assert.equal((await request(`/transfers/${tx.id}/assign`, { deviceId: replacement.deviceId })).data.ok, true);
      assert.equal((await request(`/transfers/${tx.id}/content`, undefined, other.token)).status, 404);
      assert.ok(fs.existsSync(next.file));
      assert.equal((await request(`/transfers/${tx.id}/discard`, {}, replacement.token)).status, 403);
      assert.equal((await request(`/transfers/${tx.id}/discard`, {})).data.ok, true);
      assert.equal(fs.existsSync(next.file), false);
    });
    await t.test('journal does not contain plaintext tokens or filenames', () => {
      const data = fs.readFileSync(path.join(process.env.JAI_DATA_DIR, '.bridge', 'state.enc'));
      assert.equal(data.includes(Buffer.from(receiver.token)), false);
      assert.equal(data.includes(Buffer.from('image.png')), false);
    });
    await t.test('custom graphs redirect SaveImage nodes and leave other output nodes alone', async () => {
      const id = crypto.randomUUID(); reserveBridgeJob(id, other.deviceId);
      const graph = { '10': { class_type: 'SaveImage', inputs: { filename_prefix: 'old' } }, '20': { class_type: 'SaveImage', inputs: { filename_prefix: 'other' } }, '30': { class_type: 'CustomFileWriter', inputs: { filename_prefix: 'user-managed' } } };
      bridgeGraph(graph, id);
      assert.equal(graph['30'].inputs.filename_prefix, 'user-managed');
      assert.notEqual(graph['10'].inputs.filename_prefix, graph['20'].inputs.filename_prefix);
      const subfolder = `.jai-bridge/${id}`;
      const file = path.join(process.env.COMFY_OUTPUT_DIR, subfolder, 'image.png');
      const extra = path.join(process.env.COMFY_OUTPUT_DIR, 'user-managed.png');
      fs.writeFileSync(file, png); fs.writeFileSync(extra, png);
      stageBridgeOutputs(id, [
        { url: `/comfy/view?${new URLSearchParams({ filename: 'image.png', subfolder, type: 'output' })}` },
        { url: '/comfy/view?filename=user-managed.png&type=output&subfolder=' },
        { url: '/comfy/view?filename=preview.png&type=temp&subfolder=' }
      ]);
      const transfer = (await request('/inbox', undefined, other.token)).data.transfers.find(x => x.jobId === id);
      assert.ok(transfer);
      assert.equal((await request(`/transfers/${transfer.id}/ack`, { sha256: transfer.sha256 }, other.token)).data.ok, true);
      assert.equal(fs.existsSync(file), false); assert.equal(fs.existsSync(extra), true);
      assert.throws(() => bridgeGraph({ '1': { class_type: 'CustomFileWriter', inputs: {} } }, id), /SaveImage/);
    });
    await t.test('a restarted bridge reloads pairing credentials and unacknowledged transfers', async () => {
      const pending = fixture(other.deviceId);
      const restarted = await import(`./bridge.js?restart=${Date.now()}`);
      assert.equal(restarted.bridgeDevice(other.deviceId).id, other.deviceId);
      const restartedApp = express(); restartedApp.use(express.json()); restarted.installBridgeRoutes(restartedApp);
      const restartedServer = restartedApp.listen(0, '127.0.0.1');
      await new Promise(resolve => restartedServer.once('listening', resolve));
      try {
        const url = `http://127.0.0.1:${restartedServer.address().port}/api/bridge`;
        const inbox = await fetch(`${url}/inbox`, { headers: { Authorization: `Bearer ${other.token}` } }).then(r => r.json());
        const transfer = inbox.transfers.find(t => t.jobId === pending.id);
        assert.ok(transfer); assert.ok(fs.existsSync(pending.file));
        const ack = await fetch(`${url}/transfers/${transfer.id}/ack`, { method: 'POST', headers: { Authorization: `Bearer ${other.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ sha256: transfer.sha256 }) }).then(r => r.json());
        assert.equal(ack.ok, true); assert.equal(fs.existsSync(pending.file), false);
        const reloadedAgain = await import(`./bridge.js?restart-again=${Date.now()}`);
        assert.ok(reloadedAgain.bridgeDevice(other.deviceId));
      } finally { await new Promise(resolve => restartedServer.close(resolve)); }
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => comfyServer.close(resolve));
    // Only the dedicated directory created by this test is removed.
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

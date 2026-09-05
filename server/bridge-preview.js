// Isolated browser verification fixture. Never uses the user's gallery or ComfyUI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jai-bridge-preview-')));
process.env.JAI_DATA_DIR = path.join(temp, 'data');
process.env.COMFY_OUTPUT_DIR = path.join(temp, 'output');
process.env.COMFY_URL = 'http://127.0.0.1:1';
process.env.HOST = '127.0.0.1';
process.env.PORT = '8794';
delete process.env.JAI_TLS_CERT; delete process.env.JAI_TLS_KEY;
fs.mkdirSync(process.env.COMFY_OUTPUT_DIR);
const { setPrivacyPassword, setUnlockCookie } = await import('./privacy.js');
const { reserveBridgeJob, stageBridgeOutputs } = await import('./bridge.js');
const key = setPrivacyPassword('bridge-preview-password');
let cookie;
setUnlockCookie({ setHeader(_name, value) { cookie = value.split(';')[0]; } }, key);
await import('./index.js');
await new Promise(resolve => setTimeout(resolve, 100));
const origin = 'http://127.0.0.1:8794';
const pairing = await fetch(`${origin}/api/bridge/pairings`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' }).then(r => r.json());
console.log(JSON.stringify({ origin, receiver: `${origin}/bridge/receive`, code: pairing.code, temp }));
const seeded = new Set();
setInterval(async () => {
  const admin = await fetch(`${origin}/api/bridge/admin`, { headers: { cookie } }).then(r => r.json());
  for (const d of admin.devices || []) {
    if (seeded.has(d.id) || d.revoked) continue;
    seeded.add(d.id);
    const id = crypto.randomUUID(); reserveBridgeJob(id, d.id);
    const subfolder = `.jai-bridge/${id}`;
    const file = path.join(process.env.COMFY_OUTPUT_DIR, subfolder, 'image.png');
    fs.writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9kAAAAASUVORK5CYII=', 'base64'));
    stageBridgeOutputs(id, [{ url: `/comfy/view?${new URLSearchParams({ filename: 'image.png', subfolder, type: 'output' })}` }]);
    console.log('Seeded fixture image:', file);
  }
}, 1000);

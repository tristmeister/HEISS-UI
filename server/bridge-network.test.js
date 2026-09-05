import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import express from 'express';
import { createCertificateManager, hostTrustCommand } from './bridge-certificates.js';
import { createBridgeNetwork } from './bridge-network.js';

test('automatic certificates and desktop bootstrap', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jai-network-test-'));
  let network;
  try {
    const manager = createCertificateManager(directory);
    const original = await manager.ensure(['localhost', '127.0.0.1', '::1']);
    await t.test('creates a proper CA and signed server certificate with private keys restricted', () => {
      const ca = new crypto.X509Certificate(original.ca);
      const leaf = new crypto.X509Certificate(original.cert);
      assert.equal(ca.ca, true); assert.equal(leaf.ca, false);
      assert.equal(leaf.verify(ca.publicKey), true);
      assert.equal(leaf.checkHost('localhost'), 'localhost');
      assert.equal(leaf.checkIP('127.0.0.1'), '127.0.0.1');
      assert.ok(leaf.checkPrivateKey(crypto.createPrivateKey(original.key)));
      if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(directory, 'authority.json')).mode & 0o777, 0o600);
    });
    await t.test('reuses the same CA and renews host certificates when addresses change', async () => {
      assert.equal((await manager.ensure(['localhost', '127.0.0.1', '::1'])).cert, original.cert);
      const next = await manager.ensure(['localhost', '127.0.0.1', '192.168.1.42']);
      assert.equal(next.ca, original.ca); assert.notEqual(next.cert, original.cert);
      assert.equal(new crypto.X509Certificate(next.cert).checkIP('192.168.1.42'), '192.168.1.42');
    });
    let trustCalls = 0;
    const app = express(); app.get('/bridge/receive', (_req, res) => res.send('receiver over TLS'));
    network = createBridgeNetwork(app, { directory, httpsPort: 0, setupPort: 0, trust: async file => { assert.ok(new crypto.X509Certificate(fs.readFileSync(file)).ca); trustCalls++; } });
    const info = await network.enable();
    await network.trustHost();
    await t.test('starts verified HTTPS without weakening TLS verification', async () => {
      const body = await new Promise((resolve, reject) => {
        https.get(`https://localhost:${info.httpsPort}/bridge/receive`, { ca: original.ca }, res => { let data = ''; res.on('data', b => { data += b; }); res.on('end', () => resolve(data)); }).on('error', reject);
      });
      assert.equal(body, 'receiver over TLS'); assert.ok(trustCalls >= 1);
      assert.equal(network.info().hostTrust.status, 'installed');
    });
    await t.test('bootstrap serves public trust material, never a key or authenticated API', async () => {
      const base = `http://127.0.0.1:${info.setupPort}`;
      const response = await fetch(`${base}/bridge/setup`);
      assert.ok(response.headers.get('content-security-policy'));
      const html = await response.text();
      assert.match(html, /six-digit pairing code/); assert.match(html, /Trust this computer/);
      assert.equal(html.includes('PRIVATE KEY'), false);
      const ca = await fetch(`${base}/bridge/ca.cer`).then(r => r.arrayBuffer());
      assert.equal(new crypto.X509Certificate(Buffer.from(ca)).fingerprint256, info.fingerprint);
      assert.equal((await fetch(`${base}/api/bridge/inbox`)).status, 404);
      const profile = await fetch(`${base}/bridge/trust-mac.mobileconfig`).then(r => r.text());
      const certificate = Buffer.from(profile.match(/<data>(.*?)<\/data>/)[1], 'base64');
      assert.equal(new crypto.X509Certificate(certificate).fingerprint256, info.fingerprint);
      const windows = await fetch(`${base}/bridge/trust-windows.cmd`).then(r => r.text());
      assert.match(windows, /certutil.exe -user -addstore Root/);
      assert.equal(new crypto.X509Certificate(Buffer.from(windows.split(':JAI_CERTIFICATE')[2].trim(), 'base64')).fingerprint256, info.fingerprint);
    });
    await t.test('native trust commands target the user store and survive spaces in paths', () => {
      const file = '/example folder/public certificate.cer';
      assert.deepEqual(hostTrustCommand(file, 'win32').args, ['-user', '-addstore', 'Root', file]);
      assert.equal(hostTrustCommand(file, 'darwin').args.at(-1), file);
      assert.equal(hostTrustCommand(file, 'linux'), null);
    });
    await t.test('disable closes the listeners and prevents automatic restart', async () => {
      await network.disable(); assert.equal(network.info().enabled, false);
      await network.resume(); assert.equal(network.info().enabled, false);
    });
  } finally {
    await network?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

import express from 'express';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createCertificateManager, installHostTrust } from './bridge-certificates.js';

function listen(server, port) {
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', () => { server.removeListener('error', reject); resolve(); }); });
}
const close = server => new Promise(resolve => server ? server.close(resolve) : resolve());
export function createBridgeNetwork(receiverApp, { directory, httpsPort = Number(process.env.JAI_BRIDGE_PORT || 8788), setupPort = Number(process.env.JAI_BRIDGE_SETUP_PORT || 8789), trust = installHostTrust } = {}) {
  const manager = createCertificateManager(directory);
  const enabledFile = path.join(directory, 'enabled.json');
  const trustFile = path.join(directory, 'host-trust.json');
  let certificates, secureServer, setupServer, enabling, timer, trusting;
  let trustState = { status: 'not-installed', supported: ['darwin', 'win32'].includes(process.platform) };
  try { trustState = { ...trustState, ...JSON.parse(fs.readFileSync(trustFile, 'utf8')) }; } catch { /* First setup. */ }
  function info() {
    const address = certificates?.names.find(n => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n)) || certificates?.names.find(n => n.endsWith('.local')) || 'localhost';
    const tlsPort = secureServer?.address()?.port || httpsPort;
    const bootstrapPort = setupServer?.address()?.port || setupPort;
    return { enabled: Boolean(secureServer?.listening && setupServer?.listening), httpsPort: tlsPort, setupPort: bootstrapPort, receiverUrl: `https://${address}:${tlsPort}/bridge/receive`, localReceiverUrl: `https://localhost:${tlsPort}/bridge/receive`, setupUrl: `http://${address}:${bootstrapPort}/bridge/setup`, fingerprint: certificates?.fingerprint || '', hostTrust: trustState };
  }
  async function trustHost() {
    if (!certificates) throw new Error('Enable desktop bridge first.');
    if (trusting) return trusting;
    trustState = { ...trustState, status: 'installing', error: undefined };
    trusting = trust(certificates.publicPath).then(() => {
      trustState = { ...trustState, status: 'installed', fingerprint: certificates.fingerprint, error: undefined };
      fs.writeFileSync(trustFile, JSON.stringify(trustState), { mode: 0o600 });
    }).catch(() => { trustState = { ...trustState, status: 'needs-approval', error: 'Approve certificate trust in the operating system, or use the manual certificate download.' }; }).finally(() => { trusting = undefined; });
    return trusting;
  }
  function macProfile() {
    const payload = crypto.randomUUID();
    return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>PayloadContent</key><array><dict><key>PayloadCertificateFileName</key><string>J-AI-Studio-CA.cer</string><key>PayloadContent</key><data>${certificates.caDer.toString('base64')}</data><key>PayloadDescription</key><string>Trust your J AI Studio host for encrypted local connections.</string><key>PayloadDisplayName</key><string>J AI Studio Local CA</string><key>PayloadIdentifier</key><string>local.jai.ca.${payload}</string><key>PayloadType</key><string>com.apple.security.root</string><key>PayloadUUID</key><string>${payload}</string><key>PayloadVersion</key><integer>1</integer></dict></array><key>PayloadDisplayName</key><string>J AI Studio — Trust this host</string><key>PayloadDescription</key><string>Installs the public certificate of your J AI host. Compare its fingerprint with the host before approving.</string><key>PayloadIdentifier</key><string>local.jai.trust</string><key>PayloadType</key><string>Configuration</string><key>PayloadUUID</key><string>${crypto.randomUUID()}</string><key>PayloadVersion</key><integer>1</integer></dict></plist>`;
  }
  function windowsInstaller() {
    // Embedded public certificate only; the script never fetches or executes remote code.
    const lines = certificates.caDer.toString('base64').match(/.{1,64}/g).join('\r\n');
    return `@echo off\r\nsetlocal\r\necho J AI Studio local certificate\r\necho SHA-256: ${certificates.fingerprint}\r\necho Compare this fingerprint with Privacy settings on your host.\r\nchoice /M "Trust this J AI host for your Windows account"\r\nif errorlevel 2 exit /b 1\r\nset "jaiCert=%TEMP%\\jai-${crypto.randomBytes(8).toString('hex')}.cer"\r\npowershell.exe -NoProfile -Command "$text = Get-Content -LiteralPath '%~f0' -Raw; $data = ($text -split ':JAI_CERTIFICATE', 3)[2]; [IO.File]::WriteAllBytes($env:jaiCert, [Convert]::FromBase64String($data.Trim()))"\r\nif errorlevel 1 goto failed\r\ncertutil.exe -user -addstore Root "%jaiCert%"\r\nif errorlevel 1 goto failed\r\ndel "%jaiCert%"\r\necho Trusted. Return to your browser and open the receiver.\r\npause\r\nexit /b 0\r\n:failed\r\necho Installation failed. Use the certificate download and Windows Certificate Import Wizard.\r\npause\r\nexit /b 1\r\n:JAI_CERTIFICATE\r\n${lines}\r\n`;
  }
  function bootstrap() {
    const app = express();
    app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
    // attachment() derives Content-Type from the file extension, so it must come
    // before type(). macOS only hands a profile to System Settings when it arrives
    // as application/x-apple-aspen-config.
    app.get('/bridge/ca.cer', (_req, res) => res.attachment('J-AI-Studio-CA.cer').type('application/pkix-cert').send(certificates.caDer));
    app.get('/bridge/trust-mac.mobileconfig', (_req, res) => res.attachment('Trust-JAI.mobileconfig').type('application/x-apple-aspen-config').send(macProfile()));
    app.get('/bridge/trust-windows.cmd', (_req, res) => res.attachment('Trust-JAI.cmd').type('application/octet-stream').send(windowsInstaller()));
    app.get('/bridge/setup', (_req, res) => {
      const details = info();
      const nonce = crypto.randomBytes(16).toString('base64');
      res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`);
      res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trust your J AI host</title><style nonce="${nonce}">body{font:16px system-ui;background:#141416;color:#f1f1f3;margin:0;padding:48px 24px}main{max-width:600px;margin:auto}h1{font-size:32px;letter-spacing:-.04em}p{color:#bdbdc5;line-height:1.6}a{color:#c6c6ff}.button{display:inline-block;padding:14px 20px;border-radius:12px;background:#e7e7ee;color:#161618;text-decoration:none;margin:12px 12px 12px 0}code{display:block;overflow-wrap:anywhere;padding:16px;background:#232327;border-radius:12px;font-size:13px}small{display:block;color:#aaa;line-height:1.6}section{margin:32px 0}</style></head><body><main><p>J AI Studio · desktop bridge</p><h1>Trust your J AI host</h1><p>One-time setup for this computer. After installing the certificate, images travel over an encrypted connection.</p><section><p>Compare this certificate fingerprint with the one shown in Privacy settings on your host before installing:</p><code>${details.fingerprint}</code></section><a class="button" id="trust" href="/bridge/ca.cer" download>Trust this computer</a><p id="steps">Download the certificate and import it into your operating system’s trusted root certificates.</p><small>Your operating system must approve certificate trust. This page cannot install it silently.</small><section><a class="button" href="${details.receiverUrl}">Continue to receiver</a><p>Then enter the six-digit pairing code from your host. Do not enter it on this setup page.</p></section><details><summary>Other download options</summary><p><a href="/bridge/trust-mac.mobileconfig">macOS trust profile</a> · <a href="/bridge/trust-windows.cmd">Windows trust helper</a> · <a href="/bridge/ca.cer">Public certificate</a></p><p>Firefox may require importing the public certificate in its own certificate settings. If the code expires during setup, create a new code on the host.</p></details><script nonce="${nonce}">const mac=/Macintosh|Mac OS X/.test(navigator.userAgent);const win=/Windows/.test(navigator.userAgent);if(mac){document.getElementById('trust').href='/bridge/trust-mac.mobileconfig';document.getElementById('steps').textContent='Open the downloaded profile, then approve it in System Settings → General → Device Management (Profiles on older macOS).';}else if(win){document.getElementById('trust').href='/bridge/trust-windows.cmd';document.getElementById('steps').textContent='Open the downloaded trust helper and confirm installation for your Windows account. If your browser blocks scripts, use the public certificate download and the Certificate Import Wizard instead.';}</script></main></body></html>`);
    });
    app.use((_req, res) => res.status(404).end());
    return app;
  }
  async function start() {
    certificates = await manager.ensure();
    secureServer = https.createServer({ cert: certificates.cert, key: certificates.key, minVersion: 'TLSv1.2' }, receiverApp);
    setupServer = http.createServer(bootstrap());
    try { await listen(secureServer, httpsPort); await listen(setupServer, setupPort); }
    catch (error) { await Promise.all([close(secureServer), close(setupServer)]); secureServer = undefined; setupServer = undefined; throw error; }
    fs.writeFileSync(enabledFile, JSON.stringify({ enabled: true }), { mode: 0o600 });
    if (trustState.fingerprint !== certificates.fingerprint || trustState.status !== 'installed') void trustHost();
    timer = setInterval(async () => {
      try { certificates = await manager.ensure(); secureServer.setSecureContext({ cert: certificates.cert, key: certificates.key }); } catch { /* Keep the last working certificate. */ }
    }, 60 * 60_000);
    timer.unref();
    return info();
  }
  return {
    info,
    // True only for sockets accepted by the bridge's own TLS listener. Compares the
    // server object rather than a port or header, so nothing a client sends can forge it.
    isBridgeRequest(req) { return Boolean(secureServer && req?.socket?.server === secureServer && req.socket.encrypted); },
    enable() { if (info().enabled) return Promise.resolve(info()); return enabling ||= start().finally(() => { enabling = undefined; }); },
    trustHost,
    async resume() { if (fs.existsSync(enabledFile) && JSON.parse(fs.readFileSync(enabledFile, 'utf8')).enabled) return this.enable(); },
    async disable() { await this.close(); fs.writeFileSync(enabledFile, JSON.stringify({ enabled: false }), { mode: 0o600 }); return info(); },
    async close() { clearInterval(timer); await Promise.all([close(secureServer), close(setupServer)]); },
  };
}

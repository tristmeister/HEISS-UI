import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import forge from 'node-forge';

const generateKeyPair = promisify(crypto.generateKeyPair);
const run = promisify(execFile);
export function certificateNames() {
  const name = os.hostname().replace(/[^a-zA-Z0-9.-]/g, '-');
  return [...new Set(['localhost', '127.0.0.1', '::1', name, ...(name.includes('.') ? [] : [`${name}.local`]), ...Object.values(os.networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address)])].sort();
}
async function rsa() {
  const keys = await generateKeyPair('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  return { privatePem: keys.privateKey, public: forge.pki.publicKeyFromPem(keys.publicKey), private: forge.pki.privateKeyFromPem(keys.privateKey) };
}
function certificate(publicKey, days) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.serialNumber = `01${crypto.randomBytes(15).toString('hex')}`;
  cert.validity.notBefore = new Date(Date.now() - 5 * 60_000);
  cert.validity.notAfter = new Date(Date.now() + days * 86400_000);
  return cert;
}
function write(file, value) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temp, file);
}
export function createCertificateManager(directory) {
  let pending;
  async function generate(names) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
    else await run('icacls.exe', [directory, '/inheritance:r', '/grant:r', `${os.userInfo().username}:(OI)(CI)F`], { windowsHide: true });
    const caPath = path.join(directory, 'authority.json');
    let ca;
    if (fs.existsSync(caPath)) ca = JSON.parse(fs.readFileSync(caPath, 'utf8'));
    else {
      const keys = await rsa();
      const cert = certificate(keys.public, 3650);
      const subject = [{ name: 'commonName', value: `J AI Studio Local CA ${crypto.randomBytes(4).toString('hex')}` }];
      cert.setSubject(subject); cert.setIssuer(subject);
      cert.setExtensions([{ name: 'basicConstraints', critical: true, cA: true, pathLenConstraint: 0 }, { name: 'keyUsage', critical: true, keyCertSign: true, cRLSign: true }, { name: 'subjectKeyIdentifier' }]);
      cert.sign(keys.private, forge.md.sha256.create());
      ca = { cert: forge.pki.certificateToPem(cert), key: keys.privatePem };
      write(caPath, ca);
    }
    const authority = new crypto.X509Certificate(ca.cert);
    if (Date.parse(authority.validTo) <= Date.now()) throw new Error('The J AI local authority has expired. Renew the authority and trust it again.');
    const leafPath = path.join(directory, 'host.json');
    let leaf;
    if (fs.existsSync(leafPath)) leaf = JSON.parse(fs.readFileSync(leafPath, 'utf8'));
    const current = leaf && new crypto.X509Certificate(leaf.cert);
    if (!current || JSON.stringify(leaf.names) !== JSON.stringify(names) || Date.parse(current.validTo) < Date.now() + 14 * 86400_000 || !current.verify(authority.publicKey)) {
      const keys = await rsa();
      const cert = certificate(keys.public, 90);
      cert.setSubject([{ name: 'commonName', value: 'J AI Studio Desktop Bridge' }]);
      cert.setIssuer(forge.pki.certificateFromPem(ca.cert).subject.attributes);
      cert.setExtensions([
        { name: 'basicConstraints', critical: true, cA: false },
        { name: 'keyUsage', critical: true, digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
        { name: 'subjectAltName', altNames: names.map(name => /^(?:\d{1,3}\.){3}\d{1,3}$|:/.test(name) ? { type: 7, ip: name } : { type: 2, value: name }) },
        { name: 'subjectKeyIdentifier' }
      ]);
      cert.sign(forge.pki.privateKeyFromPem(ca.key), forge.md.sha256.create());
      leaf = { cert: forge.pki.certificateToPem(cert), key: keys.privatePem, names };
      write(leafPath, leaf);
    }
    const publicPath = path.join(directory, 'J-AI-Studio-CA.cer');
    fs.writeFileSync(publicPath, authority.raw, { mode: 0o600 });
    return { cert: leaf.cert, key: leaf.key, ca: ca.cert, caDer: authority.raw, publicPath, fingerprint: authority.fingerprint256, names };
  }
  return { ensure(names = certificateNames()) { return pending ||= generate([...new Set(names)].sort()).finally(() => { pending = undefined; }); } };
}
export function hostTrustCommand(publicPath, platform = process.platform) {
  if (platform === 'darwin') return { command: '/usr/bin/security', args: ['add-trusted-cert', '-r', 'trustRoot', '-k', path.join(os.homedir(), 'Library/Keychains/login.keychain-db'), publicPath] };
  if (platform === 'win32') return { command: 'certutil.exe', args: ['-user', '-addstore', 'Root', publicPath] };
  return null;
}
export async function installHostTrust(publicPath) {
  const command = hostTrustCommand(publicPath);
  if (!command) throw new Error('Automatic trust installation is supported on macOS and Windows.');
  await run(command.command, command.args, { timeout: 60_000, windowsHide: true });
}

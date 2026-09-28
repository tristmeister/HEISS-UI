import crypto from "node:crypto";
import fs from "node:fs";
import tls from "node:tls";
import { normalizeFolderInput } from "./comfy.js";

/**
 * Optional HTTPS for other devices, with a certificate the person already has.
 * No self-signed certificates made up here: browsers warn about those, and a
 * warning people learn to click through protects nothing. Certificates that
 * browsers trust come from, for example:
 *
 *   tailscale cert <machine>.<tailnet>.ts.net   (Tailscale, free, renews)
 *   mkcert <name>                               (a local CA you install)
 *   a certificate for a domain you own
 *
 * HEISS_TLS_CERT and HEISS_TLS_KEY name the two PEM files (Settings ›
 * Connection writes them to .env). With both set and LAN mode on, other
 * devices get HTTPS on HEISS_HTTPS_PORT (8788 unless set) and plain HTTP
 * answers this computer only, on localhost. Without LAN mode nothing changes.
 */

export const httpsPort = (() => {
  const value = Number(process.env.HEISS_HTTPS_PORT || 0);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : Number(process.env.PORT || 8787) + 1;
})();

function readPem(file, what) {
  if (!file) throw new Error(`No ${what} file is set.`);
  try {
    return fs.readFileSync(file);
  } catch (error) {
    throw new Error(error.code === "ENOENT" ? `The ${what} file isn’t there: ${file}` : `The ${what} file can’t be read: ${error.message}`);
  }
}

/** The names a browser will accept this certificate for: DNS names and IP addresses. */
export function certificateNames(x509) {
  return String(x509?.subjectAltName || "").split(/,\s*/).map((entry) => {
    const [kind, ...rest] = entry.split(":");
    const value = rest.join(":").trim().toLowerCase();
    return kind === "DNS" || kind === "IP Address" ? value : "";
  }).filter(Boolean);
}

/**
 * Reads and checks a certificate and key pair. Returns what Settings shows:
 * { ok, error, names, validTo, expired, cert, key }. Never throws.
 */
export function inspectTls(certPath = "", keyPath = "") {
  const cert = normalizeFolderInput(certPath);
  const key = normalizeFolderInput(keyPath);
  const report = { configured: Boolean(cert || key), certPath: cert, keyPath: key, ok: false, error: "", names: [], validTo: "", expired: false };
  if (!report.configured) return report;
  try {
    const certPem = readPem(cert, "certificate");
    const keyPem = readPem(key, "key");
    const x509 = new crypto.X509Certificate(certPem);
    report.names = certificateNames(x509);
    report.validTo = new Date(x509.validTo).toISOString();
    report.expired = Date.parse(x509.validTo) < Date.now();
    // Throws when the key does not belong to the certificate, or either is not PEM.
    tls.createSecureContext({ cert: certPem, key: keyPem });
    if (!x509.checkPrivateKey(crypto.createPrivateKey(keyPem))) throw new Error("The key doesn’t belong to this certificate.");
    if (report.expired) throw new Error(`The certificate expired on ${report.validTo.slice(0, 10)}. Renew it (for Tailscale: tailscale cert), then restart HEISS UI.`);
    if (!report.names.length) throw new Error("The certificate names no host, so no browser will accept it.");
    report.ok = true;
    report.pem = { cert: certPem, key: keyPem };
  } catch (error) {
    report.error = /PEM|asn1|DECODER|bad decrypt|header too long/i.test(error.message)
      ? "Those files aren’t a PEM certificate and its key."
      : /key values mismatch|KEY_VALUES_MISMATCH/i.test(error.message) ? "The key doesn’t belong to this certificate." : error.message;
  }
  return report;
}

/** The pair from the environment, as it was when HEISS UI started. */
export const startupTls = inspectTls(process.env.HEISS_TLS_CERT || "", process.env.HEISS_TLS_KEY || "");

/** Names the certificate is for: the request guard accepts them as Host. */
export function tlsHostNames() {
  return startupTls.ok ? startupTls.names : [];
}

/** Public part of a report, for Settings (never the PEM itself). */
export function tlsSummary(report = startupTls, { active = false } = {}) {
  const { pem, ...rest } = report;
  return { ...rest, port: httpsPort, active };
}

/**
 * Keeps a running HTTPS server on the newest certificate: `tailscale cert`
 * and certbot renew the files in place, so reload them when they change.
 */
export function watchCertificate(server, report = startupTls, everyMs = 6 * 60 * 60 * 1000) {
  if (!report.ok) return null;
  const stamp = () => [report.certPath, report.keyPath].map((file) => { try { return fs.statSync(file).mtimeMs; } catch { return 0; } }).join(":");
  let last = stamp();
  const timer = setInterval(() => {
    const now = stamp();
    if (now === last) return;
    const next = inspectTls(report.certPath, report.keyPath);
    if (!next.ok) {
      console.warn(`[HEISS] The renewed certificate can’t be used (${next.error}); keeping the current one.`);
      return;
    }
    server.setSecureContext({ cert: next.pem.cert, key: next.pem.key });
    last = now;
    console.log(`[HEISS] Reloaded the HTTPS certificate (valid until ${next.validTo.slice(0, 10)}).`);
  }, everyMs);
  timer.unref?.();
  return timer;
}

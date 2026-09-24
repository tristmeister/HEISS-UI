import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { root } from './comfy.js';
import { readJsonFile, writeJsonFile } from './json-store.js';

/**
 * The key ring for Hidden.
 *
 * Everything in Hidden is encrypted under one random master key. That key is
 * never stored as is: it is wrapped once per way in, the password and each
 * passkey (Touch ID, Windows Hello, a phone). Unwrapping with the right secret
 * is the check, so nothing here stores a hash that could be tested offline
 * without paying for scrypt.
 *
 * A passkey unlocks through the WebAuthn PRF extension: the authenticator
 * turns a per-passkey salt into 32 secret bytes that only it can produce, and
 * those bytes wrap the master key. No PRF, no passkey: a passkey is never used
 * as a mere yes/no gate, because then the key would have to sit on disk.
 *
 * An unlocked browser holds the master key sealed in an HttpOnly cookie under
 * this install's session secret; nothing keeps a copy in server memory.
 */

const dataDir = process.env.HEISS_DATA_DIR || process.env.JAI_DATA_DIR ? path.resolve(process.env.HEISS_DATA_DIR || process.env.JAI_DATA_DIR) : path.join(root, "data");
const privacyPath = path.join(dataDir, "privacy.json");
const cookieName = "heiss_privacy_unlock";
const legacyCookieName = "jai_privacy_unlock";
const maxSessionSeconds = 60 * 60 * 24 * 30;
const defaultSessionSeconds = 60 * 60 * 12;

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function fromBase64url(value = "") {
  return Buffer.from(String(value), "base64url");
}

function readConfig() {
  try {
    return readJsonFile(privacyPath);
  } catch {
    return null;
  }
}

function writeConfig(config) {
  fs.mkdirSync(dataDir, { recursive: true });
  writeJsonFile(privacyPath, config);
  try { fs.chmodSync(privacyPath, 0o600); } catch { /* Windows keeps its own ACLs. */ }
}

function scrypt(password, salt) {
  return crypto.scryptSync(String(password || ""), fromBase64url(salt), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

// Version 1 installs derived keys with Node's default cost; their master key
// is that derivation, so it has to be reproduced exactly once to migrate.
function legacyScrypt(password, salt) {
  return crypto.scryptSync(String(password || ""), fromBase64url(salt), 32);
}

function seal(plain, key, aad = "") {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return base64url(Buffer.concat([iv, cipher.getAuthTag(), data]));
}

function open(sealed, key, aad = "") {
  try {
    const raw = fromBase64url(sealed);
    if (raw.length < 28) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    if (aad) decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  } catch {
    return null;
  }
}

/** The PRF output is already uniformly random; HKDF just binds it to its purpose. */
function passkeyWrapKey(prf, salt) {
  return Buffer.from(crypto.hkdfSync("sha256", prf, fromBase64url(salt), Buffer.from("heiss-hidden-passkey-v1"), 32));
}

function sessionKey(config) {
  return crypto.createHash("sha256").update(fromBase64url(config.sessionSecret)).digest();
}

function timingEqual(a, b) {
  const left = Buffer.from(a || "");
  const right = Buffer.from(b || "");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(header.split(";").map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return ["", ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function sealKey(key, config, seconds) {
  const expiresAt = Date.now() + seconds * 1000;
  return base64url(Buffer.from(JSON.stringify({ v: 2, expiresAt, data: seal(key, sessionKey(config), String(expiresAt)) })));
}

function unsealKey(value, config) {
  if (!value || !config?.sessionSecret) return null;
  try {
    const envelope = JSON.parse(fromBase64url(value).toString("utf8"));
    if (Number(envelope.expiresAt || 0) < Date.now()) return null;
    if (envelope.v === 2) return open(envelope.data, sessionKey(config), String(envelope.expiresAt));
    // Version 1 cookies carried iv/tag/data separately.
    const decipher = crypto.createDecipheriv("aes-256-gcm", sessionKey(config), fromBase64url(envelope.iv));
    decipher.setAAD(Buffer.from(String(envelope.expiresAt)));
    decipher.setAuthTag(fromBase64url(envelope.tag));
    return Buffer.concat([decipher.update(fromBase64url(envelope.data)), decipher.final()]);
  } catch {
    return null;
  }
}

export function isPrivacyEnabled() {
  return Boolean(readConfig()?.enabled);
}

function publicPasskey(passkey) {
  return { id: passkey.id, name: passkey.name || "Passkey", createdAt: passkey.createdAt || "", lastUsedAt: passkey.lastUsedAt || "" };
}

export function privacyStatusFor(req) {
  const config = readConfig();
  const unlocked = Boolean(encryptionKeyFromRequest(req));
  return {
    enabled: Boolean(config?.enabled),
    unlocked,
    // Which passkeys exist is not secret (their ids are sent to every unlock
    // prompt anyway), but their names are the person's own words.
    passkeys: config?.enabled ? (config.passkeys || []).map((passkey) => unlocked ? publicPasskey(passkey) : { id: passkey.id }) : [],
    cookieName
  };
}

/** Salts and credential ids, so the browser can ask its authenticator for the right secret. */
export function passkeyUnlockOptions() {
  const config = readConfig();
  if (!config?.enabled) return [];
  return (config.passkeys || []).map((passkey) => ({ id: passkey.id, salt: passkey.salt }));
}

function migrateLegacy(config, password, key) {
  const salt = base64url(crypto.randomBytes(16));
  const next = {
    version: 2,
    enabled: true,
    createdAt: config.createdAt || new Date().toISOString(),
    sessionSecret: config.sessionSecret || base64url(crypto.randomBytes(32)),
    password: { salt, wrapped: seal(key, scrypt(password, salt), "password") },
    passkeys: []
  };
  writeConfig(next);
}

let failedUnlocks = 0;
let lastFailedUnlock = 0;
/** A wrong password costs a little more each time, so guessing from another device is slow. */
export function unlockBackoffMs() {
  if (Date.now() - lastFailedUnlock > 10 * 60 * 1000) failedUnlocks = 0;
  return Math.min(8000, failedUnlocks > 3 ? 500 * 2 ** (failedUnlocks - 4) : 0);
}

function noteUnlock(ok) {
  if (ok) { failedUnlocks = 0; return; }
  failedUnlocks += 1;
  lastFailedUnlock = Date.now();
}

export function unlockWithPassword(password = "") {
  const config = readConfig();
  if (!config?.enabled) return null;
  if (config.version !== 2) {
    if (!config.passwordHash || !config.passwordSalt) return null;
    const hash = base64url(legacyScrypt(password, config.passwordSalt));
    if (!timingEqual(hash, config.passwordHash)) { noteUnlock(false); return null; }
    const key = legacyScrypt(password, config.encryptionSalt);
    migrateLegacy(config, password, key);
    noteUnlock(true);
    return key;
  }
  const key = open(config.password?.wrapped, scrypt(password, config.password?.salt), "password");
  noteUnlock(Boolean(key));
  return key;
}

export function unlockWithPasskey(id = "", prf = "") {
  const config = readConfig();
  if (!config?.enabled || config.version !== 2) return null;
  const passkey = (config.passkeys || []).find((item) => item.id === id);
  const secret = fromBase64url(prf);
  if (!passkey || secret.length < 32) { noteUnlock(false); return null; }
  const key = open(passkey.wrapped, passkeyWrapKey(secret, passkey.salt), `passkey:${passkey.id}`);
  noteUnlock(Boolean(key));
  if (key) {
    passkey.lastUsedAt = new Date().toISOString();
    writeConfig(config);
  }
  return key;
}

function assertPassword(password) {
  if (String(password || "").length < 8) throw new Error("Use at least 8 characters.");
}

/** A fresh key ring: a random master key wrapped by the password. */
export function setupPrivacy(password = "") {
  assertPassword(password);
  if (isPrivacyEnabled()) throw new Error("Hidden is already set up.");
  const key = crypto.randomBytes(32);
  const salt = base64url(crypto.randomBytes(16));
  writeConfig({
    version: 2,
    enabled: true,
    createdAt: new Date().toISOString(),
    sessionSecret: base64url(crypto.randomBytes(32)),
    password: { salt, wrapped: seal(key, scrypt(password, salt), "password") },
    passkeys: []
  });
  return key;
}

/** A new password wraps the same master key, so nothing in Hidden is re-encrypted. */
export function changePassword(key, password = "") {
  assertPassword(password);
  const config = readConfig();
  if (!config?.enabled || config.version !== 2 || !key) throw new Error("Unlock Hidden first.");
  const salt = base64url(crypto.randomBytes(16));
  config.password = { salt, wrapped: seal(key, scrypt(password, salt), "password") };
  writeConfig(config);
}

export function addPasskey(key, { id = "", name = "", salt = "", prf = "" } = {}) {
  const config = readConfig();
  if (!config?.enabled || config.version !== 2 || !key) throw new Error("Unlock Hidden first.");
  const secret = fromBase64url(prf);
  if (!id || !salt || secret.length < 32) throw new Error("This passkey did not return a secret, so it cannot unlock Hidden.");
  const passkeys = (config.passkeys || []).filter((item) => item.id !== id);
  passkeys.push({
    id,
    name: String(name || "Passkey").slice(0, 60),
    salt,
    wrapped: seal(key, passkeyWrapKey(secret, salt), `passkey:${id}`),
    createdAt: new Date().toISOString()
  });
  config.passkeys = passkeys.slice(-8);
  writeConfig(config);
  return publicPasskey(passkeys.at(-1));
}

export function removePasskey(id = "") {
  const config = readConfig();
  if (!config?.enabled) return false;
  const before = (config.passkeys || []).length;
  config.passkeys = (config.passkeys || []).filter((item) => item.id !== id);
  writeConfig(config);
  return config.passkeys.length !== before;
}

/** Forgets the key ring. Without it nothing in Hidden can ever be opened again. */
export function erasePrivacy() {
  try { fs.unlinkSync(privacyPath); } catch { /* already gone */ }
}

export function setUnlockCookie(res, key, seconds = defaultSessionSeconds) {
  const config = readConfig();
  if (!config?.enabled || !key) return;
  const lifetime = Math.max(60, Math.min(maxSessionSeconds, Number(seconds) || defaultSessionSeconds));
  res.setHeader("Set-Cookie", [
    `${cookieName}=${encodeURIComponent(sealKey(key, config, lifetime))}`,
    "Path=/",
    `Max-Age=${lifetime}`,
    "HttpOnly",
    "SameSite=Strict"
  ].join("; "));
}

export function clearUnlockCookie(res) {
  res.setHeader("Set-Cookie", [`${cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`, `${legacyCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`]);
}

export function encryptionKeyFromRequest(req) {
  const config = readConfig();
  if (!config?.enabled) return null;
  const cookies = parseCookies(req);
  return unsealKey(cookies[cookieName] || cookies[legacyCookieName], config);
}

/* Before Hidden, a privacy password also encrypted the prompts of the normal
   gallery. That no longer happens: the password guards Hidden only. Items
   written back then keep their envelope until an unlocked session opens them
   once, and then they go back to plain text for good. */

function decryptEnvelope(value, key) {
  if (!String(value || "").startsWith("enc:v1:") || !key) return "";
  try {
    const envelope = JSON.parse(fromBase64url(String(value).slice("enc:v1:".length)).toString("utf8"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, fromBase64url(envelope.iv));
    decipher.setAuthTag(fromBase64url(envelope.tag));
    return Buffer.concat([decipher.update(fromBase64url(envelope.data)), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export function hasLegacyPrompt(item) {
  return Boolean(item?.promptEncrypted || item?.negativeEncrypted || String(item?.prompt || "").startsWith("enc:v1:"));
}

/** The item with its old envelope opened, or null when it cannot be opened with this key. */
export function openLegacyPrompt(item, key) {
  if (!hasLegacyPrompt(item) || !key) return null;
  const promptSource = item.promptEncrypted || item.prompt || "";
  const negativeSource = item.negativeEncrypted || item.negative || "";
  const prompt = String(promptSource).startsWith("enc:v1:") ? decryptEnvelope(promptSource, key) : String(promptSource);
  const negative = String(negativeSource).startsWith("enc:v1:") ? decryptEnvelope(negativeSource, key) : String(negativeSource);
  if (promptSource && !prompt) return null;
  const { promptEncrypted, negativeEncrypted, promptProtected, ...rest } = item;
  return { ...rest, prompt, negative };
}

export function revealGalleryItemForRequest(item) {
  if (!item || !hasLegacyPrompt(item)) return item;
  // Still sealed from the old scheme: show it without a prompt rather than the envelope.
  const { promptEncrypted, negativeEncrypted, ...rest } = item;
  return { ...rest, prompt: String(rest.prompt || "").startsWith("enc:v1:") ? "" : rest.prompt || "", negative: String(rest.negative || "").startsWith("enc:v1:") ? "" : rest.negative || "", promptProtected: true };
}

export function revealGalleryItemsForRequest(items = []) {
  return items.map((item) => revealGalleryItemForRequest(item));
}

/** What a backup needs besides its ciphertext: the master key, wrapped by the password. */
export function passwordWrapForBackup() {
  const config = readConfig();
  return config?.version === 2 && config.password ? { kdf: "scrypt-n32768-r8-p1", salt: config.password.salt, wrapped: config.password.wrapped } : null;
}

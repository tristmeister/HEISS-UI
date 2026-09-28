import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { root } from './comfy.js';
import { appendSetCookie, clientOf, deviceSession, deviceSessionSeconds, secureRequest } from './access.js';
import { readJsonFile, writeJsonFile } from './json-store.js';
import { scryptAsync, scryptParams } from './kdf.js';

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
 * those bytes wrap the master key. Browsers whose passkeys cannot do PRF get
 * the weaker device passkey described further down.
 *
 * An unlocked browser holds the master key sealed in an HttpOnly cookie under
 * this install's session secret; nothing keeps a copy in server memory. On
 * another device that cookie is also tied to the device's sign-in (see
 * access.js), so signing the device out, or all devices, locks it too.
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
  return scryptAsync(password, fromBase64url(salt), scryptParams);
}

// Version 1 installs derived keys with Node's default cost; their master key
// is that derivation, so it has to be reproduced exactly once to migrate.
function legacyScrypt(password, salt) {
  return scryptAsync(password, fromBase64url(salt), {});
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
  const header = req?.headers?.cookie || "";
  return Object.fromEntries(header.split(";").map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return ["", ""];
    let value = "";
    try { value = decodeURIComponent(part.slice(index + 1).trim()); } catch { /* a mangled cookie is no cookie */ }
    return [part.slice(0, index).trim(), value];
  }).filter(([key]) => key));
}

/** `sid`: the device session it belongs to, for another device; "" on this computer. */
function sealKey(key, config, seconds, sid = "") {
  const expiresAt = Date.now() + seconds * 1000;
  return base64url(Buffer.from(JSON.stringify({ v: 3, expiresAt, sid, data: seal(key, sessionKey(config), `${expiresAt}:${sid}`) })));
}

/**
 * The key a cookie holds, if it is still good for this request. Another
 * device's cookie only counts with the device session it was made for;
 * cookies from before that binding (v1, v2) only count on this computer.
 */
function unsealKey(value, config, { thisComputer = false, sid = "" } = {}) {
  if (!value || !config?.sessionSecret) return null;
  try {
    const envelope = JSON.parse(fromBase64url(value).toString("utf8"));
    if (Number(envelope.expiresAt || 0) < Date.now()) return null;
    if (envelope.v === 3) {
      const bound = String(envelope.sid || "");
      if (thisComputer ? bound && bound !== sid : !bound || bound !== sid) return null;
      return open(envelope.data, sessionKey(config), `${envelope.expiresAt}:${bound}`);
    }
    if (!thisComputer) return null;
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
  return { id: passkey.id, name: passkey.name || "Passkey", kind: passkey.kind === "device" ? "device" : "prf", createdAt: passkey.createdAt || "", lastUsedAt: passkey.lastUsedAt || "" };
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
  return (config.passkeys || []).map((passkey) => passkey.kind === "device"
    ? { id: passkey.id, kind: "device" }
    : { id: passkey.id, kind: "prf", salt: passkey.salt });
}

/* Browser passkeys that cannot do PRF (Chrome's and Arc's own on-device
   store, many Windows setups) unlock another way: Touch ID signs a one-time
   challenge, checked here against the passkey's public key, and the browser
   sends a secret it keeps under a key it can use but never export. Both are
   needed. Weaker than PRF, since that browser key lives in the browser
   profile, and Settings says so. */

const challenges = new Map();
const challengeTtlMs = 10 * 60 * 1000;

export function issueChallenge() {
  const now = Date.now();
  for (const [value, expires] of challenges) if (expires < now) challenges.delete(value);
  const challenge = base64url(crypto.randomBytes(32));
  challenges.set(challenge, now + challengeTtlMs);
  return challenge;
}

function consumeChallenge(value) {
  const expires = challenges.get(value);
  challenges.delete(value);
  return Boolean(expires && expires >= Date.now());
}

/** Checks a WebAuthn assertion: our challenge, this page, the user verified, and signed by this passkey. */
function verifyAssertion(passkey, { clientDataJSON = "", authenticatorData = "", signature = "" }, origin) {
  try {
    const clientBytes = fromBase64url(clientDataJSON);
    const client = JSON.parse(clientBytes.toString("utf8"));
    if (client.type !== "webauthn.get" || !origin || client.origin !== origin) return false;
    if (!consumeChallenge(String(client.challenge || ""))) return false;
    const auth = fromBase64url(authenticatorData);
    if (auth.length < 37) return false;
    const rpIdHash = crypto.createHash("sha256").update(new URL(origin).hostname).digest();
    if (!auth.subarray(0, 32).equals(rpIdHash)) return false;
    // User present and user verified: a fingerprint, a face or the device password, not just a tap.
    if ((auth[32] & 0x05) !== 0x05) return false;
    const signed = Buffer.concat([auth, crypto.createHash("sha256").update(clientBytes).digest()]);
    const key = crypto.createPublicKey({ key: fromBase64url(passkey.publicKey), format: "der", type: "spki" });
    return crypto.verify("sha256", signed, key, fromBase64url(signature));
  } catch {
    return false;
  }
}

export function unlockWithDevicePasskey(body = {}, origin = "") {
  const config = readConfig();
  if (!config?.enabled || config.version !== 2) return null;
  const passkey = (config.passkeys || []).find((item) => item.id === body.id && item.kind === "device");
  const secret = fromBase64url(body.secret || "");
  if (!passkey || secret.length < 32 || !verifyAssertion(passkey, body, origin)) return null;
  const key = open(passkey.wrapped, passkeyWrapKey(secret, passkey.salt), `passkey:${passkey.id}`);
  if (key) {
    passkey.lastUsedAt = new Date().toISOString();
    writeConfig(config);
  }
  return key;
}

async function migrateLegacy(config, password, key) {
  const salt = base64url(crypto.randomBytes(16));
  const next = {
    version: 2,
    enabled: true,
    createdAt: config.createdAt || new Date().toISOString(),
    sessionSecret: config.sessionSecret || base64url(crypto.randomBytes(32)),
    password: { salt, wrapped: seal(key, await scrypt(password, salt), "password") },
    passkeys: []
  };
  writeConfig(next);
}

/**
 * The master key, if this is the Hidden password; null otherwise. Guessing is
 * slowed per address by the caller (guess-limit.js); scrypt runs off the
 * event loop, so a guess never holds up anyone else.
 */
export async function unlockWithPassword(password = "") {
  const config = readConfig();
  if (!config?.enabled) return null;
  if (config.version !== 2) {
    if (!config.passwordHash || !config.passwordSalt) return null;
    const hash = base64url(await legacyScrypt(password, config.passwordSalt));
    if (!timingEqual(hash, config.passwordHash)) return null;
    const key = await legacyScrypt(password, config.encryptionSalt);
    await migrateLegacy(config, password, key);
    return key;
  }
  return open(config.password?.wrapped, await scrypt(password, config.password?.salt), "password");
}

export function unlockWithPasskey(id = "", prf = "") {
  const config = readConfig();
  if (!config?.enabled || config.version !== 2) return null;
  const passkey = (config.passkeys || []).find((item) => item.id === id && item.kind !== "device");
  const secret = fromBase64url(prf);
  if (!passkey || secret.length < 32) return null;
  const key = open(passkey.wrapped, passkeyWrapKey(secret, passkey.salt), `passkey:${passkey.id}`);
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
export async function setupPrivacy(password = "") {
  assertPassword(password);
  if (isPrivacyEnabled()) throw new Error("Hidden is already set up.");
  const key = crypto.randomBytes(32);
  const salt = base64url(crypto.randomBytes(16));
  const wrapKey = await scrypt(password, salt);
  if (isPrivacyEnabled()) throw new Error("Hidden is already set up.");
  writeConfig({
    version: 2,
    enabled: true,
    createdAt: new Date().toISOString(),
    sessionSecret: base64url(crypto.randomBytes(32)),
    password: { salt, wrapped: seal(key, wrapKey, "password") },
    passkeys: []
  });
  return key;
}

/** A new password wraps the same master key, so nothing in Hidden is re-encrypted. */
export async function changePassword(key, password = "") {
  assertPassword(password);
  if (!readConfig()?.enabled || !key) throw new Error("Unlock Hidden first.");
  const salt = base64url(crypto.randomBytes(16));
  const wrapKey = await scrypt(password, salt);
  const config = readConfig();
  if (!config?.enabled || config.version !== 2) throw new Error("Unlock Hidden first.");
  config.password = { salt, wrapped: seal(key, wrapKey, "password") };
  writeConfig(config);
}

/**
 * A passkey that cannot do PRF: keeps its public key to check signatures, and
 * hands back the secret the browser will hold. The secret is never stored here.
 */
export function addDevicePasskey(key, { id = "", name = "", publicKey = "" } = {}) {
  const config = readConfig();
  if (!config?.enabled || config.version !== 2 || !key) throw new Error("Unlock Hidden first.");
  if (!id || !publicKey) throw new Error("This passkey didn’t provide a public key.");
  try { crypto.createPublicKey({ key: fromBase64url(publicKey), format: "der", type: "spki" }); } catch { throw new Error("This passkey type isn’t supported."); }
  const secret = crypto.randomBytes(32);
  const salt = base64url(crypto.randomBytes(32));
  const passkeys = (config.passkeys || []).filter((item) => item.id !== id);
  passkeys.push({
    id,
    kind: "device",
    name: String(name || "Passkey").slice(0, 60),
    salt,
    publicKey,
    wrapped: seal(key, passkeyWrapKey(secret, salt), `passkey:${id}`),
    createdAt: new Date().toISOString()
  });
  config.passkeys = passkeys.slice(-8);
  writeConfig(config);
  return { passkey: publicPasskey(passkeys.at(-1)), secret: base64url(secret) };
}

export function addPasskey(key, { id = "", name = "", salt = "", prf = "" } = {}) {
  const config = readConfig();
  if (!config?.enabled || config.version !== 2 || !key) throw new Error("Unlock Hidden first.");
  const secret = fromBase64url(prf);
  if (!id || !salt || secret.length < 32) throw new Error("This passkey can’t unlock Hidden. Use your password.");
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
  // The JSON store keeps a .bak and reads it when the file is missing; it has to go too,
  // or the old key ring comes straight back.
  for (const file of [privacyPath, `${privacyPath}.bak`]) {
    try { fs.unlinkSync(file); } catch { /* already gone */ }
  }
}

/**
 * Keeps Hidden open in this browser. On another device the cookie lasts no
 * longer than its sign-in (a week at most) and is tied to it; over HTTPS it
 * is Secure, so it never crosses the network in the clear.
 */
export function setUnlockCookie(res, key, seconds = defaultSessionSeconds, req = null) {
  const config = readConfig();
  if (!config?.enabled || !key) return;
  let lifetime = Math.max(60, Math.min(maxSessionSeconds, Number(seconds) || defaultSessionSeconds));
  let sid = "";
  if (req && !clientOf(req).thisComputer) {
    const session = deviceSession(req);
    if (!session) return;
    sid = session.id;
    lifetime = Math.max(60, Math.min(lifetime, deviceSessionSeconds, Math.floor((Number(session.expiresAt) - Date.now()) / 1000)));
  }
  appendSetCookie(res, [
    `${cookieName}=${encodeURIComponent(sealKey(key, config, lifetime, sid))}`,
    "Path=/",
    `Max-Age=${lifetime}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(secureRequest(req) ? ["Secure"] : [])
  ].join("; "));
}

export function clearUnlockCookie(res) {
  appendSetCookie(res, `${cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`);
  appendSetCookie(res, `${legacyCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

export function encryptionKeyFromRequest(req) {
  const config = readConfig();
  if (!config?.enabled) return null;
  const cookies = parseCookies(req);
  const value = cookies[cookieName] || cookies[legacyCookieName];
  if (!value) return null;
  const thisComputer = clientOf(req).thisComputer;
  return unsealKey(value, config, { thisComputer, sid: thisComputer ? "" : deviceSession(req)?.id || "" });
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

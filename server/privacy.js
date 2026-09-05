import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { root } from './comfy.js';

const dataDir = process.env.JAI_DATA_DIR ? path.resolve(process.env.JAI_DATA_DIR) : path.join(root, "data");
const privacyPath = path.join(dataDir, "privacy.json");
const cookieName = "jai_privacy_unlock";
const cookieMaxAgeSeconds = 60 * 60 * 24 * 30;
let activeEncryptionKey = null;

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function fromBase64url(value = "") {
  return Buffer.from(String(value), "base64url");
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(privacyPath, "utf8"));
  } catch {
    return null;
  }
}

function writeConfig(config) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(privacyPath, JSON.stringify(config, null, 2));
}

function scrypt(password, salt) {
  return crypto.scryptSync(String(password || ""), fromBase64url(salt), 32);
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

function sealKey(key, config) {
  const iv = crypto.randomBytes(12);
  const expiresAt = Date.now() + cookieMaxAgeSeconds * 1000;
  const cipher = crypto.createCipheriv("aes-256-gcm", sessionKey(config), iv);
  cipher.setAAD(Buffer.from(String(expiresAt)));
  const encrypted = Buffer.concat([cipher.update(key), cipher.final()]);
  const tag = cipher.getAuthTag();
  return base64url(Buffer.from(JSON.stringify({
    v: 1,
    expiresAt,
    iv: base64url(iv),
    tag: base64url(tag),
    data: base64url(encrypted)
  })));
}

function unsealKey(value, config) {
  if (!value || !config) return null;
  try {
    const envelope = JSON.parse(fromBase64url(value).toString("utf8"));
    if (Number(envelope.expiresAt || 0) < Date.now()) return null;
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

export function privacyStatusFor(req) {
  const config = readConfig();
  return {
    enabled: Boolean(config?.enabled),
    unlocked: Boolean(encryptionKeyFromRequest(req)),
    cookieName
  };
}

export function verifyPrivacyPassword(password = "") {
  const config = readConfig();
  if (!config?.enabled || !config.passwordHash || !config.passwordSalt) return null;
  const hash = base64url(scrypt(password, config.passwordSalt));
  if (!timingEqual(hash, config.passwordHash)) return null;
  return scrypt(password, config.encryptionSalt);
}

export function setPrivacyPassword(password = "") {
  if (String(password).length < 8) throw new Error("Password must be at least 8 characters.");
  const config = {
    enabled: true,
    version: 1,
    passwordSalt: base64url(crypto.randomBytes(16)),
    encryptionSalt: base64url(crypto.randomBytes(16)),
    sessionSecret: base64url(crypto.randomBytes(32)),
    createdAt: new Date().toISOString()
  };
  config.passwordHash = base64url(scrypt(password, config.passwordSalt));
  writeConfig(config);
  activeEncryptionKey = scrypt(password, config.encryptionSalt);
  return activeEncryptionKey;
}

export function setUnlockCookie(res, key) {
  const config = readConfig();
  if (!config?.enabled || !key) return;
  const cookie = [
    `${cookieName}=${encodeURIComponent(sealKey(key, config))}`,
    "Path=/",
    `Max-Age=${cookieMaxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax"
  ];
  res.setHeader("Set-Cookie", cookie.join("; "));
}

export function clearUnlockCookie(res) {
  activeEncryptionKey = null;
  res.setHeader("Set-Cookie", `${cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

export function encryptionKeyFromRequest(req) {
  const config = readConfig();
  if (!config?.enabled) return null;
  const cookieKey = unsealKey(parseCookies(req)[cookieName], config);
  if (cookieKey) {
    activeEncryptionKey = cookieKey;
    return cookieKey;
  }
  return null;
}

export function activePrivacyKey() {
  return activeEncryptionKey;
}

function encryptedEnvelope(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return `enc:v1:${base64url(Buffer.from(JSON.stringify({
    iv: base64url(iv),
    tag: base64url(cipher.getAuthTag()),
    data: base64url(encrypted)
  })))}`;
}

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

export function protectGalleryItemForStorage(item) {
  if (!isPrivacyEnabled()) return item;
  const key = activePrivacyKey();
  const next = { ...item, promptProtected: true };
  if (next.prompt && !String(next.prompt).startsWith("enc:v1:") && key) {
    next.promptEncrypted = encryptedEnvelope(next.prompt, key);
  } else if (String(next.prompt || "").startsWith("enc:v1:")) {
    next.promptEncrypted = next.prompt;
  }
  if (next.negative && !String(next.negative).startsWith("enc:v1:") && key) {
    next.negativeEncrypted = encryptedEnvelope(next.negative, key);
  } else if (String(next.negative || "").startsWith("enc:v1:")) {
    next.negativeEncrypted = next.negative;
  }
  delete next.prompt;
  delete next.negative;
  return next;
}

export function revealGalleryItemForRequest(item, req) {
  if (!item || !isPrivacyEnabled()) return item;
  const key = encryptionKeyFromRequest(req);
  const next = { ...item, promptProtected: true };
  const promptSource = item.promptEncrypted || item.prompt || "";
  const negativeSource = item.negativeEncrypted || item.negative || "";
  next.prompt = key ? String(promptSource).startsWith("enc:v1:") ? decryptEnvelope(promptSource, key) : String(promptSource) : "";
  next.negative = key ? String(negativeSource).startsWith("enc:v1:") ? decryptEnvelope(negativeSource, key) : String(negativeSource) : "";
  if (!key) next.filename = item.filename || "Locked prompt";
  delete next.promptEncrypted;
  delete next.negativeEncrypted;
  return next;
}

export function revealGalleryItemsForRequest(items = [], req) {
  return items.map((item) => revealGalleryItemForRequest(item, req));
}

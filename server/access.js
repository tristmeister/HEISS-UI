import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { allowLanActions, root } from "./comfy.js";
import { classifyClient } from "./client-trust.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { scryptAsync } from "./kdf.js";

/**
 * Other devices: how they sign in, how long they stay signed in, and what
 * they may do once in.
 *
 * - The studio password lets a phone or another computer open the studio.
 *   It is its own password, set in Settings › Connection on this computer;
 *   Hidden keeps its own. (Until one is set, the Hidden password still signs
 *   devices in, as it did before the two were split; see index.js.)
 * - Signing in makes a device session: a random token in an HttpOnly cookie,
 *   with only its hash kept here, so "Sign out all devices" ends every one
 *   of them at once. Sessions last a week (HEISS_DEVICE_SESSION_DAYS).
 * - Looking after the computer (updates, installs, the output folder,
 *   clearing the gallery) stays with this computer unless its owner turns on
 *   "Trust other devices with admin". That switch, the passwords and signing
 *   everyone out can only ever be changed here.
 *
 * Everything lives in data/access.json (0600).
 */

const dataDir = process.env.HEISS_DATA_DIR || process.env.JAI_DATA_DIR ? path.resolve(process.env.HEISS_DATA_DIR || process.env.JAI_DATA_DIR) : path.join(root, "data");
const accessPath = path.join(dataDir, "access.json");
export const deviceCookieName = "heiss_device";
const kdf = "scrypt-n32768-r8-p1";
const maxSessions = 50;
const seenFlushMs = 60 * 1000;

export const deviceSessionSeconds = (() => {
  const days = Number(process.env.HEISS_DEVICE_SESSION_DAYS || 7);
  return Math.round(Math.max(1 / 24, Math.min(30, Number.isFinite(days) && days > 0 ? days : 7)) * 24 * 60 * 60);
})();

/** Who is asking, worked out once per request. */
export function clientOf(req) {
  if (!req) return { address: "", proxied: false, thisComputer: false, network: false };
  if (!req.heissClient) req.heissClient = classifyClient(req, { lanActions: allowLanActions, devToken: process.env.HEISS_DEV_PROXY_TOKEN || "" });
  return req.heissClient;
}

let cache = null;

function emptyConfig() {
  return { version: 1, adminFromDevices: false, studioPassword: null, sessions: [] };
}

function load() {
  if (cache) return cache;
  let saved = {};
  try { saved = readJsonFile(accessPath) || {}; } catch { saved = {}; }
  const now = Date.now();
  cache = {
    ...emptyConfig(),
    adminFromDevices: saved.adminFromDevices === true,
    studioPassword: saved.studioPassword?.salt && saved.studioPassword?.hash ? saved.studioPassword : null,
    sessions: (Array.isArray(saved.sessions) ? saved.sessions : []).filter((item) => item?.id && Number(item.expiresAt) > now)
  };
  return cache;
}

let flushTimer = null;
function save({ twice = false } = {}) {
  clearTimeout(flushTimer);
  flushTimer = null;
  const config = load();
  config.sessions = config.sessions.filter((item) => Number(item.expiresAt) > Date.now()).slice(-maxSessions);
  writeJsonFile(accessPath, config, { mode: 0o600 });
  // The store keeps the previous copy as .bak; a revocation must not survive in it.
  if (twice) writeJsonFile(accessPath, config, { mode: 0o600 });
  try { fs.chmodSync(accessPath, 0o600); } catch { /* Windows keeps its own ACLs. */ }
}

function saveSoon() {
  if (!flushTimer) flushTimer = setTimeout(() => { try { save(); } catch { /* the next change saves it */ } }, seenFlushMs);
  flushTimer.unref?.();
}

/** For tests: forget what was read, so the next call reads the file again. */
export function reloadAccess() {
  clearTimeout(flushTimer);
  flushTimer = null;
  cache = null;
}

/* ---------------------------------------------------------- Admin from devices */

export function devicesMayAdmin() {
  return load().adminFromDevices;
}

export function setDevicesMayAdmin(enabled) {
  load().adminFromDevices = Boolean(enabled);
  save();
  return devicesMayAdmin();
}

/* ---------------------------------------------------------- Studio password */

export function studioPasswordSet() {
  return Boolean(load().studioPassword);
}

export async function setStudioPassword(password = "") {
  if (String(password || "").length < 8) throw new Error("Use at least 8 characters.");
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(password, salt);
  const config = load();
  config.studioPassword = { kdf, salt: salt.toString("base64url"), hash: hash.toString("base64url"), setAt: new Date().toISOString() };
  // A new password is a fresh start: devices that knew the old one sign in again.
  config.sessions = [];
  save({ twice: true });
}

/** Whether this is the studio password. Always pays for scrypt, set or not, so timing says nothing. */
export async function checkStudioPassword(password = "") {
  const saved = load().studioPassword;
  const salt = saved ? Buffer.from(saved.salt, "base64url") : crypto.randomBytes(16);
  const hash = await scryptAsync(password, salt);
  if (!saved) return false;
  const expected = Buffer.from(saved.hash, "base64url");
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}

/* ---------------------------------------------------------- Sessions */

const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("base64url");

function parseCookies(req) {
  const header = req?.headers?.cookie || "";
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key || key in cookies) continue;
    try { cookies[key] = decodeURIComponent(part.slice(index + 1).trim()); } catch { cookies[key] = ""; }
  }
  return cookies;
}

/** Served over HTTPS: cookies get Secure, so they never travel in the clear. */
export const secureRequest = (req) => Boolean(req?.socket?.encrypted);

/** A short, human name for the device, from its browser's own description. */
export function deviceLabel(userAgent = "") {
  const ua = String(userAgent || "");
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? (/Mobile/.test(ua) ? "Android phone" : "Android tablet")
    : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux computer" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\/|FxiOS/.test(ua) ? "Firefox" : /OPR\//.test(ua) ? "Opera" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return browser ? `${device} · ${browser}` : device;
}

/** The session this request's cookie names, while it lasts; null otherwise. */
export function deviceSession(req) {
  if (req && req.heissSession !== undefined) return req.heissSession;
  const token = parseCookies(req)[deviceCookieName];
  let found = null;
  if (token) {
    const id = hashToken(token);
    const session = load().sessions.find((item) => item.id === id);
    if (session && Number(session.expiresAt) > Date.now()) {
      found = session;
      const now = Date.now();
      if (now - Date.parse(session.lastSeenAt || 0) > seenFlushMs) {
        session.lastSeenAt = new Date(now).toISOString();
        saveSoon();
      }
    }
  }
  if (req) req.heissSession = found;
  return found;
}

function cookie(req, value, maxAge) {
  return [`${deviceCookieName}=${value}`, "Path=/", `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Strict", ...(secureRequest(req) ? ["Secure"] : [])].join("; ");
}

/** Adds a Set-Cookie without dropping one another part of the response already set. */
export function appendSetCookie(res, value) {
  const current = res.getHeader?.("Set-Cookie") ?? res.headers?.["Set-Cookie"];
  const list = [].concat(current || [], value);
  res.setHeader("Set-Cookie", list);
}

/** Signs this device in: a new session and its cookie. */
export function startDeviceSession(req, res) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const session = {
    id: hashToken(token),
    createdAt: new Date(now).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    expiresAt: now + deviceSessionSeconds * 1000,
    label: deviceLabel(req?.headers?.["user-agent"]),
    address: clientOf(req).address.slice(0, 64)
  };
  const config = load();
  config.sessions.push(session);
  save();
  appendSetCookie(res, cookie(req, token, deviceSessionSeconds));
  if (req) req.heissSession = session;
  return session;
}

/** Signs this device out. */
export function endDeviceSession(req, res) {
  const session = deviceSession(req);
  if (session) {
    const config = load();
    config.sessions = config.sessions.filter((item) => item.id !== session.id);
    save({ twice: true });
  }
  appendSetCookie(res, cookie(req, "", 0));
  if (req) req.heissSession = null;
}

/** "Sign out all devices": every session ends now. */
export function endAllDeviceSessions() {
  const config = load();
  const count = config.sessions.length;
  config.sessions = [];
  save({ twice: true });
  return count;
}

export function listDeviceSessions(current = null) {
  return load().sessions
    .filter((item) => Number(item.expiresAt) > Date.now())
    .map((item) => ({ id: item.id.slice(0, 12), label: item.label || "Device", createdAt: item.createdAt, lastSeenAt: item.lastSeenAt, expiresAt: new Date(Number(item.expiresAt)).toISOString(), current: Boolean(current && current.id === item.id) }))
    .sort((a, b) => Date.parse(b.lastSeenAt || 0) - Date.parse(a.lastSeenAt || 0));
}

/* ---------------------------------------------------------- Decisions */

/** Another device, signed in, in LAN mode. */
export function isSignedInDevice(req) {
  const client = clientOf(req);
  return !client.thisComputer && client.network && Boolean(deviceSession(req));
}

/**
 * Looking after the computer: this computer always; a signed-in device only
 * when the owner trusts devices with it.
 */
export function canAdmin(req) {
  if (clientOf(req).thisComputer) return true;
  return devicesMayAdmin() && isSignedInDevice(req);
}

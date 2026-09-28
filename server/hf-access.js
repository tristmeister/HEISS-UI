import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { Readable } from "node:stream";
import { envFileKeys, removeLocalEnvValue, writeLocalEnvValue } from "./env.js";

/**
 * How HEISS reaches Hugging Face for model downloads, the way the Hugging Face
 * tools themselves do it:
 *   - a token (HF_TOKEN or HUGGING_FACE_HUB_TOKEN, or the one saved in
 *     Settings) opens gated repos. It goes to huggingface.co over HTTPS and
 *     nowhere else: not to a mirror, not to the CDN a download redirects to.
 *   - HF_ENDPOINT points downloads at a mirror (hf-mirror.com, a company
 *     proxy) instead of huggingface.co.
 *   - HTTPS_PROXY / HTTP_PROXY / NO_PROXY send them through a proxy. Node's
 *     own fetch ignores these, so a proxied request opens its own tunnel.
 */

const tokenKeys = ["HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"];

/** The token in use and where it came from ("settings" when saved in .env, "environment" when set outside). */
export function hfToken(env = process.env) {
  for (const key of tokenKeys) {
    const value = String(env[key] || "").trim();
    if (value) return { token: value, source: envFileKeys.has(key) || savedHere.has(key) ? "settings" : "environment", key };
  }
  return { token: "", source: "", key: "" };
}

// Keys this process wrote itself, so they read as "saved in Settings" before a restart too.
const savedHere = new Set();

/** What Settings may show: whether a token is set, where from and under which name, never the token itself. */
export function hfTokenStatus(env = process.env) {
  const { token, source, key } = hfToken(env);
  return { set: Boolean(token), source, editable: source !== "environment", ...(token ? { key, hint: `hf_…${token.slice(-4)}` } : {}) };
}

/**
 * Saves the token in .env, next to the other local settings. With "" it
 * clears every token .env holds, under either name, so none comes back at the
 * next start. One set in the shell cannot be cleared from here; the status
 * that comes back then names it.
 */
export function saveHfToken(value) {
  const token = String(value || "").trim();
  const current = hfToken();
  if (current.source === "environment") throw new Error(`The token is set by ${current.key} in the environment. Change it there.`);
  if (token && !/^hf_[A-Za-z0-9]{16,}$/.test(token)) throw new Error("That doesn’t look like a Hugging Face token. They start with hf_.");
  if (token) {
    writeLocalEnvValue("HF_TOKEN", token);
    savedHere.add("HF_TOKEN");
    return hfTokenStatus();
  }
  for (const key of tokenKeys) {
    removeLocalEnvValue(key);
    if (savedHere.delete(key)) delete process.env[key];
  }
  return hfTokenStatus();
}

/** The mirror downloads go to instead of huggingface.co, or null. */
export function hfEndpoint(env = process.env) {
  const raw = String(env.HF_ENDPOINT || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol) || url.hostname === "huggingface.co") return null;
    return url;
  } catch {
    return null;
  }
}

/** A catalog URL, pointed at the mirror when one is set. Only huggingface.co addresses move. */
export function mirroredUrl(value, env = process.env) {
  const url = new URL(String(value));
  const mirror = hfEndpoint(env);
  if (!mirror || url.hostname !== "huggingface.co") return url;
  const base = mirror.pathname.replace(/\/+$/, "");
  return new URL(`${mirror.protocol}//${mirror.host}${base}${url.pathname}${url.search}`);
}

/* ------------------------------------------------------------ Proxy */

function hostMatches(pattern, hostname, port) {
  let entry = pattern.trim().toLowerCase();
  if (!entry) return false;
  if (entry === "*") return true;
  let wantPort = "";
  const portMatch = entry.match(/^(.*):(\d+)$/);
  if (portMatch && !entry.includes("]")) [, entry, wantPort] = portMatch;
  if (wantPort && wantPort !== String(port)) return false;
  entry = entry.replace(/^\*?\./, "");
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === entry || host.endsWith(`.${entry}`);
}

/** The proxy a request to `url` goes through, from the usual variables, or null (none set, or NO_PROXY). */
export function proxyFor(value, env = process.env) {
  const url = new URL(String(value));
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const noProxy = String(env.NO_PROXY ?? env.no_proxy ?? "");
  if (noProxy.split(/[\s,]+/).some((entry) => hostMatches(entry, url.hostname, port))) return null;
  // Like curl and undici: HTTPS requests use HTTPS_PROXY and fall back to HTTP_PROXY.
  const raw = url.protocol === "https:"
    ? env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy
    : env.HTTP_PROXY || env.http_proxy;
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    const proxy = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
    return /^https?:$/.test(proxy.protocol) ? proxy : null;
  } catch {
    return null;
  }
}

function proxyAuthorization(proxy) {
  if (!proxy.username) return {};
  const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password || "")}`;
  return { "proxy-authorization": `Basic ${Buffer.from(credentials).toString("base64")}` };
}

/** A raw TCP tunnel to host:port through the proxy (HTTP CONNECT). */
export function openTunnel(proxy, host, port, signal) {
  return new Promise((resolve, reject) => {
    const lib = proxy.protocol === "https:" ? https : http;
    const request = lib.request({
      host: proxy.hostname.replace(/^\[|\]$/g, ""),
      port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
      method: "CONNECT",
      path: `${host}:${port}`,
      headers: { host: `${host}:${port}`, ...proxyAuthorization(proxy) },
      agent: false,
      signal
    });
    request.once("connect", (response, socket) => {
      if (response.statusCode === 200) return resolve(socket);
      socket.destroy();
      reject(Object.assign(new Error(`The proxy did not open a connection to ${host} (HTTP ${response.statusCode}).`), { final: response.statusCode === 407 }));
    });
    request.once("error", reject);
    request.end();
  });
}

/** Node's http response as a fetch Response, so the download code reads both the same way. */
function asResponse(incoming) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else if (value !== undefined) headers.set(key, String(value));
  }
  const empty = incoming.statusCode === 204 || incoming.statusCode === 304;
  if (empty) incoming.resume();
  return new Response(empty ? null : Readable.toWeb(incoming), { status: incoming.statusCode, statusText: incoming.statusMessage || "", headers });
}

/** One request through the proxy: a CONNECT tunnel for https, the absolute URL for plain http. */
async function proxiedRequest(url, proxy, { method = "GET", headers, signal } = {}) {
  const plain = Object.fromEntries(new Headers(headers || {}).entries());
  if (url.protocol === "http:") {
    return new Promise((resolve, reject) => {
      const request = (proxy.protocol === "https:" ? https : http).request({
        host: proxy.hostname.replace(/^\[|\]$/g, ""), port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
        method, path: url.href, headers: { ...plain, host: url.host, ...proxyAuthorization(proxy) }, agent: false, signal
      }, (incoming) => resolve(asResponse(incoming)));
      request.once("error", reject);
      request.end();
    });
  }
  const port = Number(url.port || 443);
  const socket = await openTunnel(proxy, url.hostname, port, signal);
  return new Promise((resolve, reject) => {
    const request = https.request({
      host: url.hostname, port, method, path: `${url.pathname}${url.search}`, headers: { ...plain, host: url.host },
      agent: false, signal,
      createConnection: () => tls.connect({ socket, servername: url.hostname })
    }, (incoming) => resolve(asResponse(incoming)));
    request.once("error", (error) => { socket.destroy(); reject(error); });
    request.end();
  });
}

/* ------------------------------------------------------------ Fetch */

const redirects = new Set([301, 302, 303, 307, 308]);

/**
 * fetch for Hugging Face downloads: mirror, token and proxy applied, and
 * redirects followed by hand so the token never leaves huggingface.co.
 * `transport` replaces the network in tests.
 */
export async function hfFetch(input, init = {}, { env = process.env, transport = null } = {}) {
  let url = mirroredUrl(input, env);
  const { token } = hfToken(env);
  for (let hop = 0; hop <= 10; hop += 1) {
    const headers = new Headers(init.headers || {});
    headers.delete("authorization");
    if (token && url.protocol === "https:" && url.hostname === "huggingface.co") headers.set("authorization", `Bearer ${token}`);
    const proxy = proxyFor(url, env);
    const options = { ...init, headers, redirect: "manual" };
    const response = transport ? await transport(url, options, proxy)
      : proxy ? await proxiedRequest(url, proxy, options)
      : await fetch(url, options);
    const location = response.headers.get("location");
    if (!redirects.has(response.status) || !location) return response;
    await response.body?.cancel().catch(() => {});
    url = new URL(location, url);
  }
  throw new Error("Hugging Face kept redirecting the download.");
}

import crypto from "node:crypto";

/**
 * Who is asking: this computer, another device on the network, or nobody we
 * answer. Every trust decision in the server goes through clientOf(req).
 *
 * "This computer" means the request arrived over loopback and nothing sat in
 * between. A reverse proxy or tunnel on the same machine (Caddy, nginx,
 * `tailscale serve`, cloudflared, ngrok) also connects over loopback, but for
 * someone else, so any proxy header makes a request remote, whatever its
 * socket says. Remote requests are then treated like any other device: they
 * are answered only in LAN mode, and only after signing in.
 *
 * The one proxy trusted to say who is behind it is Vite in `npm run dev`:
 * scripts/dev.mjs hands it and the server a random token, and Vite passes the
 * real client address along with it (see vite.config.ts).
 */

/** Headers a proxy adds. Any one of them means the socket's address is not the client's. */
export const proxyHeaders = [
  "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "via",
  "cf-connecting-ip", "true-client-ip", "fastly-client-ip", "x-client-ip", "x-cluster-client-ip"
];

const loopback = new Set(["127.0.0.1", "::1"]);

/** "::ffff:192.168.1.4" and "192.168.1.4" are the same client. */
export function plainAddress(value = "") {
  return String(value || "").trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "").toLowerCase();
}

export function isLoopbackAddress(value = "") {
  const address = plainAddress(value);
  return loopback.has(address) || /^127\.\d+\.\d+\.\d+$/.test(address);
}

/**
 * A home or office network address: RFC 1918, carrier-grade NAT (which is
 * also where Tailscale puts its devices), and IPv6 unique-local and
 * link-local. Never a public address.
 */
export function isPrivateAddress(value = "") {
  const address = plainAddress(value);
  const v4 = address.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return /^f[cd][0-9a-f]{2}:/.test(address) || /^fe[89ab][0-9a-f]:/.test(address);
}

export function hasProxyHeaders(headers = {}) {
  return proxyHeaders.some((name) => headers[name] !== undefined && headers[name] !== "");
}

function tokenMatches(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * The facts about one request, worked out once:
 *   address       who the server thinks the client is
 *   proxied       something between the client and this server added headers
 *   thisComputer  the browser runs on the machine HEISS UI runs on
 *   network       another device HEISS UI may answer once it signs in (LAN mode)
 */
export function classifyClient(req, { lanActions = false, devToken = "" } = {}) {
  const headers = req?.headers || {};
  let address = plainAddress(req?.socket?.remoteAddress || "");
  // Vite in `npm run dev`, vouched for by the token scripts/dev.mjs made.
  const viaDevProxy = isLoopbackAddress(address) && tokenMatches(headers["x-heiss-dev-token"], devToken);
  if (viaDevProxy) address = plainAddress(headers["x-heiss-dev-client"] || "");
  const proxied = hasProxyHeaders(headers);
  const thisComputer = !proxied && isLoopbackAddress(address);
  // Behind a proxy the real address is unknown (its header can be forged), so
  // it counts as another device, and only when devices are let in at all.
  const network = !thisComputer && lanActions && (proxied || isPrivateAddress(address));
  return { address: proxied ? `proxied:${address}` : address, proxied, thisComputer, network };
}

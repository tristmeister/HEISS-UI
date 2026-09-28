import os from "node:os";

/**
 * The first check on every /api and /comfy request, before anything else runs.
 *
 * Web pages the person visits share the browser with HEISS UI, and a browser
 * sends requests to localhost for any page that asks. Two checks keep other
 * sites out:
 *
 * - The Host header must name this server: localhost, a loopback address, or
 *   (in LAN mode) this machine's own network addresses and names, plus any
 *   HEISS_ALLOWED_HOSTS and the names on a configured HTTPS certificate. A
 *   page that rebinds its own domain to 127.0.0.1 (DNS rebinding) still sends
 *   its own name, so it gets nothing.
 * - Anything that changes state (not GET, HEAD or OPTIONS) must come from the
 *   studio's own page: the browser's Sec-Fetch-Site or Origin has to say same
 *   origin, and the request must be JSON or carry the X-HEISS header. Another
 *   origin cannot send either without a CORS preflight, which this server
 *   never grants. Cross-site reads and embeds of /api and /comfy are refused
 *   too, so a page cannot show or probe what the studio holds.
 *
 * Non-browser clients (curl, scripts) send neither Origin nor Sec-Fetch-Site
 * and are not a cross-site risk; they still need the header or JSON.
 */

export const studioHeader = "x-heiss";
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/** "Localhost.:8787" -> "localhost", "[::1]:8787" -> "::1". "" when it cannot be read. */
export function hostnameOf(hostHeader = "") {
  const text = String(hostHeader || "").trim().toLowerCase();
  if (!text) return "";
  const bracketed = text.match(/^\[([0-9a-f:.]+)\](?::\d+)?$/);
  if (bracketed) return bracketed[1];
  const plain = text.match(/^([a-z0-9._-]+?)\.?(?::\d+)?$/);
  return plain ? plain[1] : "";
}

/** This machine's own addresses and names, for LAN mode. Rebuilt every few seconds: Wi-Fi changes. */
let ownNames = { at: 0, names: new Set() };
function machineNames() {
  if (Date.now() - ownNames.at < 5000) return ownNames.names;
  const names = new Set();
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) names.add(String(entry.address || "").toLowerCase().replace(/%.*$/, ""));
  }
  const host = String(os.hostname() || "").toLowerCase().replace(/\.$/, "");
  if (host) {
    names.add(host);
    const short = host.replace(/\.local$/, "").split(".")[0];
    names.add(short);
    names.add(`${short}.local`);
  }
  names.delete("");
  ownNames = { at: Date.now(), names };
  return names;
}

/** HEISS_ALLOWED_HOSTS: names a person put in front of the studio themselves (a home DNS name, a tailnet name). */
export function configuredHosts(value = process.env.HEISS_ALLOWED_HOSTS || "") {
  return String(value || "").split(/[\s,]+/).map((name) => hostnameOf(name.replace(/^https?:\/\//i, "").replace(/\/.*$/, ""))).filter(Boolean);
}

/**
 * Whether a Host header names this server. `lan`: LAN mode is on, so its
 * network addresses count. `extra`: more names (the HTTPS certificate's).
 */
export function hostAllowed(hostHeader, { lan = false, extra = [] } = {}) {
  const name = hostnameOf(hostHeader);
  if (!name) return false;
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(name) || name === "::1") return true;
  if (extra.some((item) => item === name || (item.startsWith("*.") && name.endsWith(item.slice(1)) && name.split(".").length === item.split(".").length))) return true;
  if (configuredHosts().includes(name)) return true;
  return lan && machineNames().has(name);
}

/** The browser says the request comes from the studio's own page (or from no page: typed, bookmarked). */
function fromOwnPage(req) {
  const site = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (site) return site === "same-origin" || site === "none";
  const origin = req.headers.origin;
  if (origin === undefined) return true; // Not a browser, or one too old to say; the header check below still applies.
  try {
    const url = new URL(String(origin));
    return url.host.toLowerCase() === String(req.headers.host || "").toLowerCase();
  } catch {
    return false; // "null": a sandboxed frame, a file:// page.
  }
}

function refuse(res, reason, error) {
  res.status(403).json({ ok: false, reason, error });
}

/**
 * The middleware. `lan()` says whether LAN mode is on, `extraHosts()` returns
 * the certificate's names; both are asked per request so they follow changes.
 */
export function requestGuard({ lan = () => false, extraHosts = () => [] } = {}) {
  return (req, res, next) => {
    if (!req.path.startsWith("/api") && !req.path.startsWith("/comfy")) return next();
    if (!hostAllowed(req.headers.host, { lan: lan(), extra: extraHosts() })) {
      refuse(res, "host", `HEISS UI doesn’t open at “${hostnameOf(req.headers.host) || "this address"}”. Open it at localhost, or from another device at this computer’s network address. Add other names to HEISS_ALLOWED_HOSTS.`);
      return;
    }
    const site = String(req.headers["sec-fetch-site"] || "").toLowerCase();
    if (site === "cross-site" || site === "same-site") {
      refuse(res, "origin", "Blocked a request from another website.");
      return;
    }
    if (safeMethods.has(req.method)) return next();
    if (!fromOwnPage(req)) {
      refuse(res, "origin", "Blocked a request from another website.");
      return;
    }
    if (!req.headers[studioHeader] && !req.is("application/json")) {
      refuse(res, "header", "This request didn’t come from the studio. Reload the page and try again.");
      return;
    }
    next();
  };
}

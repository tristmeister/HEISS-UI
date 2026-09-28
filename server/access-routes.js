import { canAdmin, checkStudioPassword, clientOf, deviceSession, devicesMayAdmin, endAllDeviceSessions, endDeviceSession, listDeviceSessions, setDevicesMayAdmin, setStudioPassword, startDeviceSession, studioPasswordSet } from "./access.js";
import { createGuessLimiter, waitWords } from "./guess-limit.js";
import { clearUnlockCookie, isPrivacyEnabled, unlockWithPassword } from "./privacy.js";

/** One limiter for every password this server checks: the studio's and Hidden's. */
export const guessLimiter = createGuessLimiter();

/**
 * Runs a password check through the limiter. Resolves to the check's value,
 * or answers the request itself (429) and resolves to null.
 */
export async function limitedCheck(req, res, check, wrongMessage) {
  const client = clientOf(req);
  const result = await guessLimiter.attempt(client.address, client.thisComputer, check);
  if (result.ok) return result.value;
  if (result.reason === "busy") {
    res.status(429).setHeader("Retry-After", "1");
    res.json({ ok: false, error: "Wait a moment, then try again." });
    return null;
  }
  if (result.retryAfterMs) res.setHeader("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
  if (result.reason === "locked") {
    res.status(429).json({ ok: false, error: `Too many wrong passwords. Try again in ${waitWords(result.retryAfterMs)}.` });
    return null;
  }
  res.status(401).json({ ok: false, locked: true, error: result.retryAfterMs ? `${wrongMessage} Try again in ${waitWords(result.retryAfterMs)}.` : wrongMessage });
  return null;
}

/**
 * Until a studio password is set, the Hidden password signs devices in, the
 * way it did before the two were split, so phones that already knew it keep
 * working after an update.
 */
export function hiddenPasswordSignsIn() {
  return !studioPasswordSet() && isPrivacyEnabled();
}

function requireThisComputer(req, res) {
  if (clientOf(req).thisComputer) return true;
  res.status(403).json({ ok: false, reason: "this-computer", error: "Only the computer running HEISS UI can change this." });
  return false;
}

function accessStatus(req) {
  const client = clientOf(req);
  const session = client.thisComputer ? null : deviceSession(req);
  return {
    ok: true,
    thisComputer: client.thisComputer,
    signedIn: client.thisComputer || Boolean(session),
    canAdmin: canAdmin(req),
    // What a device that is not signed in needs to know to sign in, and no more.
    studioPassword: { set: studioPasswordSet(), hidden: hiddenPasswordSignsIn() },
    ...(session ? { session: { expiresAt: new Date(Number(session.expiresAt)).toISOString() } } : {})
  };
}

export function registerAccessRoutes(app) {
  app.get("/api/access/status", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(accessStatus(req));
  });

  app.post("/api/access/sign-in", async (req, res) => {
    const client = clientOf(req);
    if (client.thisComputer) { res.json(accessStatus(req)); return; }
    const password = String(req.body?.password || "");
    if (!studioPasswordSet() && !isPrivacyEnabled()) {
      res.status(409).json({ ok: false, reason: "setup", error: "Set a studio password first, on the computer running HEISS UI (Settings › Connection)." });
      return;
    }
    const legacy = hiddenPasswordSignsIn();
    const right = await limitedCheck(req, res, async () => (legacy ? Boolean(await unlockWithPassword(password)) : checkStudioPassword(password)), "That password is incorrect.");
    if (!right) return;
    startDeviceSession(req, res);
    res.json(accessStatus(req));
  });

  app.post("/api/access/sign-out", (req, res) => {
    if (!clientOf(req).thisComputer) {
      endDeviceSession(req, res);
      clearUnlockCookie(res);
    }
    res.json({ ok: true });
  });

  /* ---------------------------------------------------------- This computer only */

  // Settings › Connection. Every signed-in device sees the switches; the list of devices is for those who look after the computer.
  app.get("/api/access/devices", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    // /api/access/ is open before signing in (index.js), so this one checks for itself.
    if (!clientOf(req).thisComputer && !deviceSession(req)) {
      res.status(401).json({ ok: false, reason: "sign-in", error: "Sign in with the studio password to continue." });
      return;
    }
    res.json({
      ok: true,
      adminFromDevices: devicesMayAdmin(),
      studioPassword: { set: studioPasswordSet(), hidden: hiddenPasswordSignsIn() },
      devices: canAdmin(req) ? listDeviceSessions(deviceSession(req)) : []
    });
  });

  app.post("/api/access/admin", (req, res) => {
    if (!requireThisComputer(req, res)) return;
    res.json({ ok: true, adminFromDevices: setDevicesMayAdmin(Boolean(req.body?.enabled)) });
  });

  app.post("/api/access/studio-password", async (req, res) => {
    if (!requireThisComputer(req, res)) return;
    try {
      await setStudioPassword(String(req.body?.password || ""));
      res.json({ ok: true, studioPassword: { set: true, hidden: false }, devices: [] });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/access/sign-out-all", (req, res) => {
    if (!requireThisComputer(req, res)) return;
    res.json({ ok: true, signedOut: endAllDeviceSessions(), devices: [] });
  });
}

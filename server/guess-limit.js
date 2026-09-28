/**
 * Slows password guessing, one address at a time.
 *
 * - Each address gets a few free tries; after that every wrong one locks it
 *   out for twice as long as the last (1 s, 2 s, 4 s … up to 15 minutes).
 * - One try at a time per address: a second one while the first is still
 *   being checked is turned away, so parallel requests gain nothing.
 * - A handful of remote checks at once overall, so many addresses together
 *   cannot keep the processor busy.
 * - This computer has its own lane that nobody else's failures touch, and it
 *   is never locked out: the owner can always get back in.
 *
 * `attempt(key, local, check)` runs `check()` (which resolves true for a
 * right password) or answers why it will not: { ok, value, retryAfterMs, reason }.
 */
export function createGuessLimiter({ freeTries = 5, baseMs = 1000, maxMs = 15 * 60 * 1000, forgetMs = 60 * 60 * 1000, maxRemoteInFlight = 4, now = () => Date.now() } = {}) {
  const entries = new Map();
  const busy = new Set();
  let remoteInFlight = 0;

  function entry(key) {
    const found = entries.get(key);
    if (found && now() - found.lastFailure > forgetMs) {
      entries.delete(key);
      return null;
    }
    return found || null;
  }

  function prune() {
    if (entries.size < 1000) return;
    for (const [key, value] of entries) if (now() - value.lastFailure > forgetMs) entries.delete(key);
  }

  function lockedFor(key) {
    const found = entry(key);
    return found ? Math.max(0, found.lockedUntil - now()) : 0;
  }

  async function attempt(key, local, check) {
    const lane = local ? "this-computer" : String(key || "unknown");
    if (busy.has(lane)) return { ok: false, reason: "busy", retryAfterMs: 1000 };
    if (!local) {
      const wait = lockedFor(lane);
      if (wait) return { ok: false, reason: "locked", retryAfterMs: wait };
      if (remoteInFlight >= maxRemoteInFlight) return { ok: false, reason: "busy", retryAfterMs: 1000 };
    }
    busy.add(lane);
    if (!local) remoteInFlight += 1;
    try {
      const value = await check();
      if (value) {
        entries.delete(lane);
        return { ok: true, value };
      }
      if (!local) {
        prune();
        const found = entry(lane) || { failures: 0, lockedUntil: 0, lastFailure: 0 };
        found.failures += 1;
        found.lastFailure = now();
        if (found.failures >= freeTries) found.lockedUntil = now() + Math.min(maxMs, baseMs * 2 ** (found.failures - freeTries));
        entries.set(lane, found);
      }
      return { ok: false, reason: "wrong", retryAfterMs: local ? 0 : lockedFor(lane) };
    } finally {
      busy.delete(lane);
      if (!local) remoteInFlight -= 1;
    }
  }

  return { attempt, lockedFor };
}

/** Plain words for a wait: "a few seconds", "2 minutes". */
export function waitWords(ms) {
  const seconds = Math.ceil(ms / 1000);
  if (seconds <= 5) return "a few seconds";
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

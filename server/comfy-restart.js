/**
 * A ComfyUI restart HEISS asked for, so "not answering" can read as
 * "restarting" everywhere (every tab and device polls the same server) instead
 * of "offline". It ends when ComfyUI answers again after going down, or after a
 * short while if the restart was too quick to see; past the window it counts
 * as failed and the app goes back to plain reconnecting.
 *
 * The server watches a restart itself (index.js), so how long it took does not
 * depend on how often a tab happens to poll. The finished restart stays as the
 * last one, so every device that saw it running can say how it went.
 */

export const RESTART_WINDOW_MS = 150_000;
// A restart can finish between two polls; an answer after this long is "back".
const QUICK_RESTART_MS = 15_000;
// How long devices keep hearing about a finished restart.
const LAST_RESTART_MS = 120_000;

let restart = null;
let last = null;

/** `packs`: the node packs loaded before, to compare with after. */
export function beginComfyRestart(now = Date.now(), { packs = null } = {}) {
  restart = { startedAt: now, sawDown: false, packs };
}

/**
 * Folds one reachability answer into the restart and says where it stands:
 * null (none), "restarting", "back" or "failed". "back" and "failed" are
 * reported once. A "back" restart keeps showing as restarting until
 * finishComfyRestart, so the checks after it happen before the app moves on.
 */
export function noteComfyRestart(connected, now = Date.now()) {
  if (!restart || restart.back) return null;
  const elapsed = now - restart.startedAt;
  if (!connected) restart.sawDown = true;
  if (connected && (restart.sawDown || elapsed > QUICK_RESTART_MS)) {
    restart.back = true;
    // Seen going down, the time is real; a restart too quick to see has no honest duration.
    return { phase: "back", startedAt: restart.startedAt, durationMs: restart.sawDown ? elapsed : null, packs: restart.packs };
  }
  if (elapsed > RESTART_WINDOW_MS) {
    const startedAt = restart.startedAt;
    restart = null;
    last = { startedAt, endedAt: now, outcome: "failed" };
    return { phase: "failed" };
  }
  return { phase: "restarting", startedAt: restart.startedAt };
}

/** Ends a restart that came back, with what it brought: `{ durationMs, newPacks, failedPacks }`. */
export function finishComfyRestart(result = {}, now = Date.now()) {
  if (!restart) return;
  last = { startedAt: restart.startedAt, endedAt: now, outcome: "back", ...result };
  restart = null;
}

/** Whether a restart is under way, without counting it as an answer. */
export function comfyRestarting(now = Date.now()) {
  return Boolean(restart && now - restart.startedAt <= RESTART_WINDOW_MS);
}

/** When the restart under way started, for the status poll. */
export function comfyRestartStartedAt() {
  return restart?.startedAt ?? null;
}

/** The restart that ended in the last two minutes, if any. */
export function lastComfyRestart(now = Date.now()) {
  return last && now - last.endedAt <= LAST_RESTART_MS ? last : null;
}

export function resetComfyRestart() {
  restart = null;
  last = null;
}

/**
 * A ComfyUI restart HEISS asked for, so "not answering" can read as
 * "restarting" everywhere (every tab and device polls the same server) instead
 * of "offline". It ends when ComfyUI answers again after going down, or after a
 * short while if the restart was too quick to see; past the window it counts
 * as failed and the app goes back to plain reconnecting.
 */

export const RESTART_WINDOW_MS = 150_000;
// A restart can finish between two polls; an answer after this long is "back".
const QUICK_RESTART_MS = 15_000;

let restart = null;

export function beginComfyRestart(now = Date.now()) {
  restart = { startedAt: now, sawDown: false };
}

/**
 * Folds one reachability answer into the restart and says where it stands:
 * null (none), "restarting", "back" or "failed". "back" and "failed" are
 * reported once; after that there is no restart any more.
 */
export function noteComfyRestart(connected, now = Date.now()) {
  if (!restart) return null;
  const elapsed = now - restart.startedAt;
  if (!connected) restart.sawDown = true;
  if (connected && (restart.sawDown || elapsed > QUICK_RESTART_MS)) {
    restart = null;
    return { phase: "back" };
  }
  if (elapsed > RESTART_WINDOW_MS) {
    restart = null;
    return { phase: "failed" };
  }
  return { phase: "restarting", startedAt: restart.startedAt };
}

/** Whether a restart is under way, without counting it as an answer. */
export function comfyRestarting(now = Date.now()) {
  return Boolean(restart && now - restart.startedAt <= RESTART_WINDOW_MS);
}

export function resetComfyRestart() {
  restart = null;
}

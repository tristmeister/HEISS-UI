import { comfy } from './comfy.js';

/**
 * HEISS's side of ComfyUI's queue: stopping only its own runs, and following a
 * run through a flaky connection. ComfyUI's queue is shared with its own UI,
 * other apps and other devices, so nothing here clears the whole queue or
 * interrupts whatever happens to be running.
 */

const json = { "content-type": "application/json" };

/** A queue entry is [number, prompt_id, prompt, extra_data, outputs]; only the id matters here. */
const idsIn = (list) => (Array.isArray(list) ? list.map((item) => (Array.isArray(item) ? item[1] : item?.prompt_id)).filter(Boolean) : []);

/** Every prompt id in ComfyUI's queue, running or waiting. */
export function queuedIds(queue) {
  return [...idsIn(queue?.queue_running), ...idsIn(queue?.queue_pending)];
}

/** Where a prompt stands in ComfyUI's queue: "running", "pending" or "" when it is in neither. */
export function queuePlace(queue, promptId) {
  if (idsIn(queue?.queue_running).includes(promptId)) return "running";
  if (idsIn(queue?.queue_pending).includes(promptId)) return "pending";
  return "";
}

/**
 * Stops one of HEISS's own prompts and nothing else. A current ComfyUI does it
 * in one atomic call (/api/jobs/{id}/cancel: dequeue if pending, interrupt if
 * running). An older one gets the same by hand: delete it from the pending
 * list, and interrupt only when it is the prompt running right now. Older
 * builds ignore /interrupt's prompt_id and stop whatever runs, which is why the
 * queue is checked first. Returns what it stopped ("canceled" from the atomic
 * call, else "running" or "pending"), or "" when there was nothing to stop.
 */
export async function cancelPrompt(promptId, request = comfy) {
  if (!promptId) return "";
  try {
    const answer = await request(`/api/jobs/${encodeURIComponent(promptId)}/cancel`, { method: "POST", headers: json, body: "{}", timeout: 10_000 });
    // Anything but its JSON answer (an older ComfyUI's 404/405, a front end catching the route) falls through.
    if (answer && typeof answer === "object" && typeof answer.cancelled === "boolean") return answer.cancelled ? "canceled" : "";
  } catch {
    // Not there on this ComfyUI: do it the older way.
  }
  const queue = await request("/queue", { timeout: 10_000 });
  const place = queuePlace(queue, promptId);
  if (place === "pending") {
    await request("/queue", { method: "POST", headers: json, body: JSON.stringify({ delete: [promptId] }), timeout: 10_000 });
    // It may have started between the two calls; if so it is running now.
    const after = await request("/queue", { timeout: 10_000 }).catch(() => null);
    if (queuePlace(after, promptId) !== "running") return "pending";
  } else if (place !== "running") {
    return "";
  }
  await request("/interrupt", { method: "POST", headers: json, body: JSON.stringify({ prompt_id: promptId }), timeout: 10_000 });
  return "running";
}

/** Stops several of HEISS's prompts; one that fails to stop does not keep the rest running. */
export async function cancelPrompts(promptIds = [], request = comfy) {
  const ids = [...new Set(promptIds.filter(Boolean))];
  const results = await Promise.allSettled(ids.map((id) => cancelPrompt(id, request)));
  return results.filter((result) => result.status === "rejected").length;
}

/**
 * Whether a failed request means ComfyUI is briefly out of reach (refused,
 * reset, timed out, a proxy's 5xx) rather than an answer that will not change.
 */
export function isTransientComfyError(error) {
  if (!error) return false;
  if (Number(error.status) >= 500) return true;
  if (Number(error.status)) return false;
  const code = error.code || error.cause?.code || "";
  return error instanceof TypeError
    || error.name === "TimeoutError" || error.name === "AbortError"
    || /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|UND_ERR_\w+)$/.test(code)
    || /fetch failed|socket hang up|terminated|other side closed/i.test(error.message || "");
}

// How long ComfyUI may stay silent before a run is given up on (shorter in tests).
const defaultLostAfterMs = Number(process.env.HEISS_COMFY_LOST_AFTER_MS) > 0 ? Number(process.env.HEISS_COMFY_LOST_AFTER_MS) : 60_000;

export const lostConnectionMessage = "ComfyUI stopped answering for over a minute, so HEISS UI stopped waiting for this run.";
export const droppedRunMessage = "ComfyUI no longer has this run. It may have restarted, or the run was removed from its queue.";

/**
 * Follows one queued prompt until ComfyUI has its result. Each `check()` asks
 * ComfyUI's history once and answers:
 *   { state: "done", entry }          - the history entry is there
 *   { state: "waiting", reconnected } - still queued or running
 *   { state: "reconnecting", delayMs, sinceMs } - ComfyUI is out of reach; ask again after delayMs
 * and throws once ComfyUI has been silent for `lostAfterMs`, or when the
 * prompt is neither queued, running nor in the history (dropped by a restart
 * or removed from ComfyUI's own queue). Any sign of life (a request that
 * answered, a progress message on the socket via `alive()`) resets the clock.
 */
export function promptTracker(promptId, { request = comfy, now = Date.now, lostAfterMs = defaultLostAfterMs, verifyEvery = 10, pollTimeoutMs = 15_000 } = {}) {
  let lastAlive = now();
  let downSince = null;
  let failures = 0;
  let polls = 0;
  let missingChecks = 0;
  let verifyNext = false;

  const noteAlive = () => { lastAlive = now(); };
  const reconnecting = () => {
    failures += 1;
    if (downSince === null) downSince = now();
    if (now() - Math.max(downSince, lastAlive) >= lostAfterMs) {
      throw Object.assign(new Error(lostConnectionMessage), { lostConnection: true });
    }
    // 1 s, 2 s, 4 s, then every 5 s: quick for a blip, calm for a restart.
    return { state: "reconnecting", delayMs: Math.min(5000, 1000 * 2 ** Math.min(failures - 1, 3)), sinceMs: now() - downSince };
  };
  const ask = async (pathname) => {
    try {
      const answer = await request(pathname, { timeout: pollTimeoutMs });
      noteAlive();
      return { answer };
    } catch (error) {
      if (!isTransientComfyError(error)) throw error;
      return { down: reconnecting() };
    }
  };

  return {
    alive: noteAlive,
    async check() {
      const history = await ask(`/history/${encodeURIComponent(promptId)}`);
      if (history.down) return history.down;
      const wasDown = downSince !== null;
      if (wasDown) verifyNext = true;
      downSince = null;
      failures = 0;
      const entry = history.answer?.[promptId];
      if (entry) return { state: "done", entry, reconnected: wasDown };
      polls += 1;
      // After a gap, and now and then anyway: is the prompt still somewhere?
      if (!verifyNext && polls % verifyEvery !== 0 && !missingChecks) return { state: "waiting", reconnected: wasDown };
      verifyNext = false;
      const queue = await ask("/queue");
      if (queue.down) return queue.down;
      if (queuePlace(queue.answer, promptId)) {
        missingChecks = 0;
        return { state: "waiting", reconnected: wasDown };
      }
      // It may have finished between the two requests: history is written before the queue lets go.
      const again = await ask(`/history/${encodeURIComponent(promptId)}`);
      if (again.down) return again.down;
      if (again.answer?.[promptId]) return { state: "done", entry: again.answer[promptId], reconnected: wasDown };
      // ComfyUI's queue listing is read without a lock; only a second miss in a row counts.
      missingChecks += 1;
      if (missingChecks >= 2) throw Object.assign(new Error(droppedRunMessage), { droppedRun: true });
      return { state: "waiting", reconnected: wasDown };
    }
  };
}

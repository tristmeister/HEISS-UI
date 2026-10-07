// How long to wait before asking the server about a running job again.
// Plain JavaScript so `node --test` can check it without a build step; the
// types live beside it in job-poll.d.ts.
//
// The wait follows how close the run is to its end. Waiting in ComfyUI's
// queue, the answer will not change for a while; mid-run, once a second keeps
// the progress moving; near the end (its last step, the decode and save after
// it, or the last seconds of an honest estimate) every third of a second, so
// the picture shows up a moment after ComfyUI saves it instead of up to a
// poll later. Each answer carries the latest preview, so the fast pace is kept
// to that last stretch. A tab in the background asks as it always did.

export const POLL_MS = {
  /** The first ask after queueing: the run may already be under way. */
  first: 700,
  /** Waiting behind other runs, or ComfyUI out of reach for now. */
  queued: 2000,
  running: 1000,
  /** The last stretch: its last step, decoding, saving. */
  closing: 350,
  /** The tab is in the background. */
  hidden: 1600,
  /** After a failed ask; multiplied by the misses in a row, at most five times. */
  retry: 1600
};

/** An estimate this far past its end says nothing any more. */
const overdueMs = 20_000;
/** Inside this much of an estimated end, the run is in its last stretch. */
const closingMs = 2500;

/**
 * Milliseconds until the next ask. `job` is the last answer (null before the
 * first), `serverNow` the time on the server's clock (estimates are on it),
 * `misses` the failed asks in a row.
 */
export function jobPollDelay(job, { hidden = false, serverNow = Date.now(), misses = 0 } = {}) {
  if (misses > 0) return POLL_MS.retry * Math.min(5, 1 + misses);
  if (hidden) return POLL_MS.hidden;
  if (!job) return POLL_MS.first;
  const progress = job.progress || null;
  if (progress?.reconnecting) return POLL_MS.queued;
  if (job.status === "queued" && !progress?.runStartedAt) return POLL_MS.queued;
  return closing(progress, serverNow) ? POLL_MS.closing : POLL_MS.running;
}

function closing(progress, serverNow) {
  if (!progress) return false;
  // An estimate, while it still holds, knows best: a long video decode is not the last moment.
  const endsAt = Number(progress.endsAt);
  if (Number.isFinite(endsAt) && endsAt > 0) {
    const left = endsAt - serverNow;
    if (left > -overdueMs) return left <= closingMs;
  }
  // Smart upscale runs after the picture is saved and can take minutes.
  if (progress.upscaling) return false;
  const max = Number(progress.max) || 0;
  if (progress.steps && max > 0) return Number(progress.value) >= max - 1;
  return progress.phase === "Decoding" || progress.phase === "Saving";
}

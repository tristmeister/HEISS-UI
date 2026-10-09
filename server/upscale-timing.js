/**
 * How long a SeedVR2 upscale takes on this machine, learned from every upscale
 * HEISS UI runs: the arrow on a finished image and Smart upscale inside a run
 * alike, since both load the same weights the same way. One weight costs about
 * the same for the same output size, so an upscale is a fixed part (loading
 * the DiT and VAE, which are never kept loaded) plus a part that grows with
 * the megapixels it writes. With sizes spread far enough apart both parts are
 * fitted; until then whole upscales are scaled by size.
 *
 * Like generation estimates, these stay quiet until they have earned trust:
 * two upscales of the weight (or of the effort, when the weight is unknown),
 * a size not far outside what it has seen, and recent predictions that landed
 * within about 35%. Hidden upscales never enter it.
 */

const PER_KEY = 30;
const TOTAL = 200;
const MIN_UPSCALES = 2;
const TRUSTED_ERROR = 0.35;
// How a whole upscale scales with size before there is spread to fit both parts.
const SIZE_EXPONENT = 0.8;

const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** What an upscale writes, in output megapixels across the batch. */
export function upscaleWork({ width = 0, height = 0, count = 1 } = {}) {
  const pixels = (Number(width) || 0) * (Number(height) || 0);
  return pixels ? (pixels / 1e6) * Math.max(1, Number(count) || 1) : 0;
}

/** The upscales that speak for this one: the same weight when known, else the same effort; face pass alike. */
function samplesFor(history, { quality = "", model = "", faceDetail = false }) {
  const faces = Boolean(faceDetail);
  const alike = history.filter((item) => Boolean(item.f) === faces);
  const byModel = model ? alike.filter((item) => item.m === model).slice(-PER_KEY) : [];
  if (byModel.length >= MIN_UPSCALES) return byModel;
  return alike.filter((item) => item.q === quality).slice(-PER_KEY);
}

/** Fixed + per-megapixel parts by least squares, or null when sizes are too alike to tell them apart. */
function fit(samples) {
  if (samples.length < 3) return null;
  const xs = samples.map((item) => item.w);
  if (Math.max(...xs) / Math.min(...xs) < 1.5) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = samples.reduce((a, item) => a + item.ms, 0) / samples.length;
  const slope = samples.reduce((a, item) => a + (item.w - mx) * (item.ms - my), 0) / samples.reduce((a, item) => a + (item.w - mx) ** 2, 0);
  const intercept = my - slope * mx;
  return slope > 0 && intercept >= 0 ? { fixedMs: intercept, perWorkMs: slope } : null;
}

/** What an upscale should take here: `{ totalMs, trusted }`, or null with too little to go on. */
export function estimateUpscale(history = [], { quality = "", model = "", faceDetail = false, work = 0 } = {}) {
  if (!work) return null;
  const samples = samplesFor(history, { quality, model, faceDetail });
  if (samples.length < MIN_UPSCALES) return null;
  const sizes = samples.map((item) => item.w);
  if (work > Math.max(...sizes) * 3 || work < Math.min(...sizes) / 3) return null;
  const errors = samples.map((item) => item.e).filter(Number.isFinite).slice(-5);
  const trusted = errors.length < 2 || median(errors) <= TRUSTED_ERROR;
  const line = fit(samples);
  const totalMs = line
    ? line.fixedMs + line.perWorkMs * work
    : median(samples.map((item) => item.ms / item.w ** SIZE_EXPONENT)) * work ** SIZE_EXPONENT;
  return Number.isFinite(totalMs) && totalMs > 0 ? { totalMs: Math.round(totalMs), trusted } : null;
}

/** The history with one finished upscale added; `predicted` says how far off its estimate was. */
export function addUpscale(history = [], { quality = "", model = "", faceDetail = false, work = 0, ms = 0, predicted = null, at = new Date().toISOString() } = {}) {
  if (!work || !(ms > 0)) return history;
  const entry = { q: String(quality), m: String(model), w: Math.round(work * 1000) / 1000, ms: Math.round(ms), at };
  if (faceDetail) entry.f = 1;
  if (predicted?.totalMs) entry.e = Math.round((Math.abs(ms - predicted.totalMs) / ms) * 100) / 100;
  const next = [...history, entry];
  const counts = new Map();
  const kept = [];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const key = `${next[index].m || next[index].q}|${next[index].f ? 1 : 0}`;
    const count = counts.get(key) || 0;
    if (count >= PER_KEY || kept.length >= TOTAL) continue;
    counts.set(key, count + 1);
    kept.push(next[index]);
  }
  return kept.reverse();
}

/**
 * How long is left of an upscale that started at `startAt` and should take
 * `estimate`: never quite nothing while it still runs, so an overrun reads
 * "almost done" rather than a clock stuck at zero. Null without a trusted estimate.
 */
export function upscaleLeftMs(estimate, startAt, now = Date.now()) {
  if (!estimate?.trusted) return null;
  if (!startAt) return estimate.totalMs;
  return Math.max(0, estimate.totalMs - (now - startAt));
}

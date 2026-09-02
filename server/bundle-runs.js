import crypto from "node:crypto";

/**
 * Pure run-detection engine shared by the plaintext gallery store
 * (gallery-bundles.js) and the encrypted vault store (vault.js). Nothing here
 * touches the filesystem or a privacy key - every function takes the items and
 * the current bundle records as plain arguments and returns new values. The
 * two callers differ only in how they read/persist the bundle array:
 * plaintext writes a JSON file, the vault writes inside its encrypted
 * manifest. The grouping rules themselves must stay identical either way.
 */

export const DEFAULT_COOLDOWN_MINUTES = 1;
export const MAX_INLINE_CHILDREN = 120;

function normalizedPrompt(item) {
  return String(item?.prompt || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function shortHash(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function timeOf(item) {
  const value = Date.parse(item?.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function runKeyFor(item, mode) {
  if (mode === "job") return item.jobId ? `job:${item.jobId}` : "";
  const prompt = normalizedPrompt(item);
  if (prompt) return `prompt:${shortHash(prompt)}`;
  return item.jobId ? `job:${item.jobId}` : "";
}

function reasonFor(key) {
  return key.startsWith("prompt:") ? "prompt" : "batch";
}

export function reasonLabel(reason) {
  return reason === "prompt" ? "Prompt run" : "Batch";
}

/**
 * Splits candidate items into runs: same key, and no gap longer than the
 * cooldown between consecutive members. The gap check is what stops
 * "everything ever made with this prompt" from becoming one enormous stack.
 */
function runsFrom(items, isCandidate, { mode = "smart", cooldownMs }) {
  const buckets = new Map();
  const ordered = items.filter(isCandidate).slice().sort((a, b) => timeOf(a) - timeOf(b));
  for (const item of ordered) {
    const key = runKeyFor(item, mode);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  const runs = [];
  for (const [key, members] of buckets) {
    let current = [];
    for (const item of members) {
      const previous = current.at(-1);
      // Members of one generation job always stay together, however long it ran.
      const sameJob = previous && previous.jobId && previous.jobId === item.jobId;
      if (previous && !sameJob && timeOf(item) - timeOf(previous) > cooldownMs) {
        runs.push({ key, items: current });
        current = [];
      }
      current.push(item);
    }
    if (current.length) runs.push({ key, items: current });
  }
  return runs;
}

/** Runs that are closed, big enough, and not already covered by a bundle. */
export function pendingRuns(items, bundles, isCandidate, { mode = "smart", cooldownMinutes = DEFAULT_COOLDOWN_MINUTES, now = Date.now() } = {}) {
  const cooldownMs = Math.max(0, Number(cooldownMinutes) || 0) * 60_000;
  const claimed = new Set(bundles.flatMap((bundle) => bundle.itemIds));
  return runsFrom(items, isCandidate, { mode, cooldownMs })
    .map((run) => ({ ...run, items: run.items.filter((item) => !claimed.has(item.id)) }))
    .filter((run) => run.items.length >= 2)
    .filter((run) => now - timeOf(run.items.at(-1)) >= cooldownMs);
}

export function pendingSummary(items, bundles, isCandidate, options = {}) {
  const runs = pendingRuns(items, bundles, isCandidate, options);
  return {
    runs: runs.length,
    items: runs.reduce((total, run) => total + run.items.length, 0),
    itemIds: runs.flatMap((run) => run.items.map((item) => item.id))
  };
}

/** Returns the new bundle array plus the records that were just created. */
export function createBundleRecords(items, bundles, isCandidate, options = {}) {
  const runs = pendingRuns(items, bundles, isCandidate, options);
  const created = [];
  for (const run of runs) {
    const ordered = run.items.slice().sort((a, b) => timeOf(a) - timeOf(b));
    const cover = ordered.at(-1);
    created.push({
      id: crypto.randomUUID(),
      key: run.key,
      reason: reasonFor(run.key),
      itemIds: ordered.map((item) => item.id),
      coverId: cover.id,
      startedAt: ordered[0]?.createdAt || "",
      endedAt: cover?.createdAt || "",
      createdAt: new Date().toISOString()
    });
  }
  return { bundles: created.length ? [...bundles, ...created] : bundles, created };
}

/** Drops bundles whose members are gone, so deleting outputs cannot strand a card. */
export function pruneBundles(bundles, existingIds) {
  let changed = false;
  const next = [];
  for (const bundle of bundles) {
    const itemIds = bundle.itemIds.filter((id) => existingIds.has(id));
    if (itemIds.length < 2) { changed = true; continue; }
    if (itemIds.length !== bundle.itemIds.length) {
      changed = true;
      next.push({ ...bundle, itemIds, coverId: itemIds.includes(bundle.coverId) ? bundle.coverId : itemIds.at(-1) });
      continue;
    }
    next.push(bundle);
  }
  return { bundles: next, changed };
}

/**
 * Collapses bundled members into one synthetic item, in place. Must run
 * before pagination - doing it in the browser would break grouping as soon as
 * a run straddles a page boundary. `domain` is stamped onto each synthetic
 * bundle so the client knows which endpoint family to call for cover/ungroup.
 */
export function applyBundlesToItems(items, bundles, isCandidate, { domain, enabled = true } = {}) {
  if (!enabled || !bundles.length) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const activeIds = new Set(items.filter(isCandidate).map((item) => item.id));
  const { bundles: active } = pruneBundles(bundles, activeIds);
  if (!active.length) return items;

  const bundleOf = new Map();
  for (const bundle of active) {
    for (const id of bundle.itemIds) bundleOf.set(id, bundle);
  }

  const emitted = new Set();
  const output = [];
  for (const item of items) {
    const bundle = bundleOf.get(item.id);
    if (!bundle) { output.push(item); continue; }
    if (emitted.has(bundle.id)) continue;
    emitted.add(bundle.id);
    const children = bundle.itemIds.map((id) => byId.get(id)).filter(Boolean);
    if (children.length < 2) { output.push(item); continue; }
    const cover = byId.get(bundle.coverId) || children.at(-1);
    output.push({
      ...cover,
      id: `bundle:${bundle.id}`,
      bundle: {
        id: bundle.id,
        domain,
        reason: bundle.reason,
        reasonLabel: reasonLabel(bundle.reason),
        count: children.length,
        startedAt: bundle.startedAt,
        endedAt: bundle.endedAt,
        coverId: cover.id,
        items: children.slice(0, MAX_INLINE_CHILDREN)
      }
    });
  }
  return output;
}

export function setBundleCover(bundles, bundleId, itemId) {
  const bundle = bundles.find((entry) => entry.id === bundleId);
  if (!bundle) throw new Error("Run was not found.");
  if (!bundle.itemIds.includes(itemId)) throw new Error("That output is not part of this run.");
  return bundles.map((entry) => entry.id === bundleId ? { ...entry, coverId: itemId } : entry);
}

/** Ungroups a run: the record goes, the outputs it pointed at are untouched. */
export function dissolveBundle(bundles, bundleId) {
  if (!bundles.some((entry) => entry.id === bundleId)) throw new Error("Run was not found.");
  return bundles.filter((entry) => entry.id !== bundleId);
}

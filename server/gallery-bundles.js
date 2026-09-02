import fs from "node:fs";
import path from "node:path";
import { dataDir } from './gallery-store.js';
import {
  applyBundlesToItems,
  createBundleRecords,
  DEFAULT_COOLDOWN_MINUTES,
  dissolveBundle as dissolveBundleRecord,
  pendingSummary as pendingSummaryOf,
  pruneBundles,
  reasonLabel,
  setBundleCover as setBundleCoverRecord
} from './bundle-runs.js';

/**
 * Creative runs over the plaintext gallery. Bundle records live in their own
 * JSON file, in the clear, next to gallery.json.
 *
 * Two deliberate limits:
 * - Grouping uses exact local fingerprints (same job, or same normalised
 *   prompt) rather than semantic similarity. Predictable, fast, and it cannot
 *   accidentally pull unrelated work together.
 * - Private Vault items are never candidates here. They get their own bundle
 *   records inside the encrypted vault manifest (see vault.js) - this file's
 *   records are plaintext, so a private relationship must never be written
 *   into it, locked or unlocked.
 */

export const bundlesPath = path.join(dataDir, "gallery-bundles.json");
export { DEFAULT_COOLDOWN_MINUTES, reasonLabel };

function readBundles() {
  try {
    const raw = JSON.parse(fs.readFileSync(bundlesPath, "utf8"));
    return Array.isArray(raw?.bundles) ? raw.bundles : [];
  } catch {
    return [];
  }
}

let bundles = readBundles();

function persist() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(bundlesPath, JSON.stringify({ bundles }, null, 2));
}

export function bundleCandidate(item) {
  if (!item || item.status !== "done") return false;
  if (item.privateVault || item.vaultLocked) return false;
  return Boolean(item.id) && !String(item.id).startsWith("bundle:");
}

export function pendingSummary(items, options = {}) {
  return pendingSummaryOf(items, bundles, bundleCandidate, options);
}

export function createBundles(items, options = {}) {
  const result = createBundleRecords(items, bundles, bundleCandidate, options);
  if (result.created.length) {
    bundles = result.bundles;
    persist();
  }
  return result.created;
}

export function listBundles() {
  return bundles;
}

export function setBundleCover(bundleId, itemId) {
  bundles = setBundleCoverRecord(bundles, bundleId, itemId);
  persist();
  return { ok: true, id: bundleId, coverId: itemId };
}

export function dissolveBundle(bundleId) {
  bundles = dissolveBundleRecord(bundles, bundleId);
  persist();
  return { ok: true, id: bundleId };
}

/**
 * Collapses bundled members into one synthetic item, in place. Must run
 * before pagination - doing it in the browser would break grouping as soon as
 * a run straddles a page boundary.
 */
export function applyBundles(items, { enabled = true } = {}) {
  const activeIds = new Set(items.filter(bundleCandidate).map((item) => item.id));
  const { bundles: pruned, changed } = pruneBundles(bundles, activeIds);
  if (changed) {
    bundles = pruned;
    persist();
  }
  return applyBundlesToItems(items, bundles, bundleCandidate, { domain: "gallery", enabled });
}

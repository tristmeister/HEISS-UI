import { useCallback, useEffect, useState } from 'react';
import { apiJson } from './api';
import type { BundlePending, BundleStatus, Preferences } from './types';

type Domain = "gallery" | "vault";

const emptyPending = { runs: 0, items: 0, itemIds: [] as string[] };
const gatherDurationMs = 300;
const settleDurationMs = 620;

function endpointFor(domain: Domain) {
  return domain === "vault" ? "/api/vault/bundles" : "/api/gallery/bundles";
}

function addPending(a: BundlePending, b: BundlePending) {
  return { runs: a.runs + b.runs, items: a.items + b.items, itemIds: [...(a.itemIds || []), ...(b.itemIds || [])] };
}

/**
 * Tracks how many finished runs could be tidied away, and performs the tidy.
 * Grouping itself is a server concern - a run can straddle a gallery page, so
 * the browser is not in a position to detect one.
 *
 * Gallery and Hidden runs are two separate domains end to end: separate
 * records (a plaintext file vs. inside Hidden's encrypted manifest) and
 * separate endpoints. Only the space on screen is asked about, and Hidden not
 * at all while it is locked - there is nothing to ask without the key.
 */
export function useGalleryBundles({
  prefs,
  galleryRevision,
  domain,
  enabled: domainEnabled,
  reloadGallery,
  showToast
}: {
  prefs: Preferences;
  galleryRevision: number;
  domain: Domain;
  enabled: boolean;
  reloadGallery: () => Promise<unknown>;
  showToast: (message: string, tone?: "default" | "success" | "error") => void;
}) {
  const [pending, setPending] = useState(emptyPending);
  const [busy, setBusy] = useState(false);
  const [gathering, setGathering] = useState<Set<string>>(() => new Set());
  const [settling, setSettling] = useState<Set<string>>(() => new Set());
  const enabled = prefs.groupRuns !== false && domainEnabled;

  const query = `mode=${encodeURIComponent(prefs.runGroupingMode || "smart")}&cooldownMinutes=${Number(prefs.runCooldownMinutes ?? 5)}`;

  const refreshBundles = useCallback(async () => {
    if (!enabled) { setPending(emptyPending); return; }
    try {
      const status = await apiJson<BundleStatus>(`${endpointFor(domain)}?${query}`);
      setPending(addPending(emptyPending, { ...emptyPending, ...(status.pending || {}) }));
    } catch {
      setPending(emptyPending);
    }
  }, [domain, enabled, query]);

  // A run only becomes eligible once it has been quiet for a while, so poll
  // gently alongside gallery changes rather than only on load.
  useEffect(() => { refreshBundles(); }, [refreshBundles, galleryRevision]);
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(refreshBundles, 60_000);
    return () => window.clearInterval(timer);
  }, [enabled, refreshBundles]);

  const compactGallery = useCallback(async () => {
    if (busy || !pending.runs) return;
    setBusy(true);
    // Let the tiles that are about to be grouped visibly gather first; the
    // reload swaps them for the stack, so the motion has to happen before it.
    setGathering(new Set(pending.itemIds || []));
    try {
      const body = JSON.stringify({ mode: prefs.runGroupingMode || "smart", cooldownMinutes: Number(prefs.runCooldownMinutes ?? 5) });
      // Compacting runs alongside the gather animation rather than after it -
      // waiting in series left a hole on screen where the tiles used to be.
      const requests: Promise<{ created: number; items: number; ids?: string[] }>[] = [
        apiJson(`${endpointFor(domain)}/compact`, { method: "POST", headers: { "content-type": "application/json" }, body })
      ];
      const [results] = await Promise.all([
        Promise.all(requests),
        new Promise((resolve) => window.setTimeout(resolve, gatherDurationMs))
      ]);
      const createdTotal = results.reduce((total, result) => total + result.created, 0);
      const settledIds = results.flatMap((result) => result.ids || []);
      // Collapsing changes which items the page returns, so take a fresh page
      // rather than a delta.
      setSettling(new Set(settledIds));
      window.setTimeout(() => setSettling(new Set()), settleDurationMs);
      await reloadGallery();
      await refreshBundles();
      showToast(createdTotal === 1 ? "Grouped 1 run" : `Grouped ${createdTotal} runs`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not group runs", "error");
    } finally {
      setGathering(new Set());
      setBusy(false);
    }
  }, [busy, domain, pending.itemIds, pending.runs, prefs.runCooldownMinutes, prefs.runGroupingMode, refreshBundles, reloadGallery, showToast]);

  const setBundleCover = useCallback(async (domain: Domain, bundleId: string, itemId: string) => {
    try {
      await apiJson(`${endpointFor(domain)}/${encodeURIComponent(bundleId)}/cover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId })
      });
      await reloadGallery();
      showToast("Cover updated", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not set the cover", "error");
    }
  }, [reloadGallery, showToast]);

  const ungroupBundle = useCallback(async (domain: Domain, bundleId: string) => {
    try {
      await apiJson(`${endpointFor(domain)}/${encodeURIComponent(bundleId)}`, { method: "DELETE" });
      await reloadGallery();
      // The run becomes tidy-able again straight away, so refresh the count.
      await refreshBundles();
      showToast("Run ungrouped", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not ungroup the run", "error");
    }
  }, [refreshBundles, reloadGallery, showToast]);

  return { pendingBundles: enabled ? pending : emptyPending, compactGallery, compactBusy: busy, gatheringIds: gathering, settlingBundles: settling, refreshBundles, setBundleCover, ungroupBundle };
}

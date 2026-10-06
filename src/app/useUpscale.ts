import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiJson } from './api';
import type { AutoUpscale, GalleryItem, Preferences, UpscaleInstall, UpscaleQuality, UpscaleStatus } from './types';
import type { ShowToast } from './toast';

/** The gallery keeps the original as the record; only the view swaps. */
export function upscaleDisplayUrl(item: GalleryItem) {
  return item.upscaleActive && item.upscale?.url ? item.upscale.url : item.url;
}

export function upscaleDisplayThumbnail(item: GalleryItem) {
  if (!item.upscaleActive || !item.upscale?.url) return item.thumbnailUrl;
  return item.upscale.thumbnailUrl || item.upscale.url;
}

export function canUpscaleItem(item: GalleryItem) {
  // Images added from another folder stay where they are, so there is nothing to upscale into.
  return item.status === "done" && item.type === "image" && !item.vaultLocked && !item.library && Boolean(item.url);
}

/** Decimal units, like the Finder and every model setup panel, so one file never shows two sizes. */
export function formatBytes(bytes = 0) {
  if (!bytes) return "unknown size";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** The three efforts, with what each first download weighs (DiT plus the shared VAE). */
export const upscaleEfforts = [
  { value: "fast", label: "Fast", scale: "1.5×", model: "SeedVR2 3B", detail: "1.5× with the 3B model. Uses the least graphics memory.", downloadBytes: 3_892_869_510 },
  { value: "balanced", label: "Balanced", scale: "2×", model: "SeedVR2 7B", detail: "2× with the 7B fp8 model.", downloadBytes: 8_967_621_152 },
  { value: "high", label: "High", scale: "3×", model: "SeedVR2 7B fp16", detail: "3× with the 7B fp16 model. Slowest, and uses the most graphics memory.", downloadBytes: 16_980_659_238 }
] as const;

/** Smart upscale's tabs in the size menu, each riding on one of the efforts above. */
export const autoUpscaleTiers: { value: AutoUpscale; label: string; quality?: UpscaleQuality }[] = [
  { value: "none", label: "None" },
  { value: "2k", label: "2K", quality: "balanced" },
  { value: "4k", label: "4K", quality: "high" }
];

export function autoUpscaleQuality(tier: AutoUpscale | undefined) {
  return autoUpscaleTiers.find((item) => item.value === tier)?.quality || null;
}

export function upscaleQualityLabel(quality = "balanced") {
  return upscaleEfforts.find((effort) => effort.value === quality)?.label || "Balanced";
}

/** Why an image could not be upscaled, shown in a popover on its upscale button. */
export type UpscaleNotice = { title: string; message: string; reason: string };

const noticeTitles: Record<string, string> = {
  missing: "The image file is missing",
  video: "Only images can be upscaled",
  unfinished: "Still rendering",
  source: "Couldn’t read the original",
  switch: "Couldn’t switch versions",
  cancel: "Couldn’t stop the upscale",
  failed: "Upscale failed"
};

export function upscaleNoticeFrom(error: unknown, fallbackReason = ""): UpscaleNotice {
  const reason = error instanceof ApiError && error.reason ? error.reason : fallbackReason;
  const message = error instanceof Error ? error.message : "The upscale didn’t start.";
  const offline = error instanceof TypeError;
  return {
    reason,
    title: noticeTitles[reason] || (offline ? "Can’t reach HEISS UI" : "Couldn’t start the upscale"),
    message: offline ? "Make sure it’s running, then try again." : message
  };
}

/** Where the setup flow stands; the dialog, its hero and the stepper all read from this. */
export type UpscaleSetupStage = "checking" | "offline" | "nodes" | "models" | "downloading" | "verifying" | "ready" | "error";

type UpscaleOptions = {
  gallery: GalleryItem[];
  prefs: Preferences;
  showToast: ShowToast;
  loadGalleryDelta: () => void;
  patchGalleryItems: (update: (item: GalleryItem) => GalleryItem) => void;
  setPrefs: (patch: Partial<Preferences>) => void;
};

// Long enough to read the check as a step of its own, short enough to never feel like waiting.
const VERIFY_BEAT_MS = 1500;
const READY_BEAT_MS = 1400;

export function useUpscale({ gallery, prefs, showToast, loadGalleryDelta, patchGalleryItems, setPrefs }: UpscaleOptions) {
  const [status, setStatus] = useState<UpscaleStatus | null>(null);
  const [install, setInstall] = useState<UpscaleInstall>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [notices, setNotices] = useState<Map<string, UpscaleNotice>>(() => new Map());
  const setNotice = useCallback((id: string, notice: UpscaleNotice | null) => {
    setNotices((current) => {
      if (!notice && !current.has(id)) return current;
      const next = new Map(current);
      if (notice) next.set(id, notice); else next.delete(id);
      return next;
    });
  }, []);
  // An upscale that started and then failed in ComfyUI says why on its image,
  // the way one that could not start does. Only failures seen happening count,
  // so old ones don't pop up again on every load.
  const lastUpscaleStatus = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const seen = lastUpscaleStatus.current;
    for (const item of gallery) {
      const now = item.upscale?.status || "";
      const before = seen.get(item.id);
      if (before === "running" && now === "error") {
        setNotice(item.id, { reason: "failed", title: noticeTitles.failed, message: item.upscale?.error || "ComfyUI stopped the upscale. Check its window for details." });
      }
      // Sealed into Hidden, but ComfyUI's own copy is still readable where HEISS UI could not reach it.
      if (before === "running" && now === "done" && item.upscale?.leftBehind) {
        showToast("Upscaled in Hidden. ComfyUI’s copy is still in its output folder (heiss-ui). If ComfyUI runs on this computer, set that folder in Settings › Library to remove these copies.", "warning");
      }
      seen.set(item.id, now);
    }
  }, [gallery, setNotice, showToast]);
  const [reason, setReason] = useState("");
  const [offline, setOffline] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [startError, setStartError] = useState("");
  const [lastChecked, setLastChecked] = useState(0);
  // The image whose click opened setup; it upscales on its own once setup is done.
  const [pending, setPending] = useState<GalleryItem | null>(null);
  // Setup opened from Smart upscale's tabs: it sets up that tab's effort, not the one in Settings.
  const [setupAuto, setSetupAuto] = useState<AutoUpscale | null>(null);
  const setupQuality: UpscaleQuality = autoUpscaleQuality(setupAuto ?? undefined) || prefs.upscaleQuality || "balanced";
  // What Smart upscale was on before a tab opened setup, to go back to if setup is left unfinished.
  const autoBefore = useRef<AutoUpscale>("none");
  const startingRef = useRef(false);
  // Callers need the reason in the same tick they call refreshStatus.
  const reasonRef = useRef("");

  const failStatus = useCallback((message: string, isOffline = false) => {
    setStatus(null);
    setOffline(isOffline);
    reasonRef.current = message;
    setReason(message);
    setLastChecked(Date.now());
    return null;
  }, []);

  const refreshStatus = useCallback(async (quality: string = prefs.upscaleQuality, { fresh = false } = {}) => {
    const url = `/api/upscale/status?quality=${encodeURIComponent(quality)}${fresh ? "&fresh=1" : ""}`;
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      return failStatus("Can’t reach HEISS UI.", true);
    }
    // Report what actually came back rather than guessing at a cause: a non-JSON
    // body means something other than this route answered (SPA shell, proxy).
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      console.warn(`Smart upscale status: ${contentType || "unknown type"} (HTTP ${response.status}) instead of JSON`);
      return failStatus("Restart HEISS UI to finish updating.");
    }
    let payload: UpscaleStatus & { error?: string; offline?: boolean };
    try {
      payload = await response.json();
    } catch {
      return failStatus(`Couldn’t read the smart upscale status (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      if (payload?.install !== undefined) setInstall(payload.install);
      return failStatus(payload?.error || `Couldn’t check smart upscale (HTTP ${response.status}).`, Boolean(payload?.offline));
    }
    if (typeof payload?.nodesInstalled !== "boolean") {
      return failStatus(`Couldn’t check smart upscale’s nodes (HTTP ${response.status}).`);
    }
    setStatus(payload);
    setInstall(payload.install);
    setOffline(false);
    setLastChecked(Date.now());
    reasonRef.current = "";
    setReason("");
    return payload;
  }, [failStatus, prefs.upscaleQuality]);

  useEffect(() => {
    if (!prefs.smartUpscale) return;
    refreshStatus(setupQuality);
  }, [prefs.smartUpscale, setupQuality, refreshStatus]);

  // Downloads are long; poll the cheap install route only while one runs. It
  // answers even while ComfyUI restarts, so progress never freezes.
  const running = install?.status === "running";
  useEffect(() => {
    if (!running) return;
    let live = true;
    const timer = window.setInterval(async () => {
      try {
        const data = await apiJson<{ install: UpscaleInstall }>("/api/upscale/install");
        if (live) setInstall(data.install);
      } catch {
        // The next tick tries again.
      }
    }, 800);
    return () => { live = false; window.clearInterval(timer); };
  }, [running]);

  // The moment a download finishes, check it as a step of its own: the files
  // were hashed on the way in, and a fresh ComfyUI read confirms SeedVR2 can load them.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running) { wasRunning.current = true; return; }
    if (!wasRunning.current) return;
    wasRunning.current = false;
    if (install?.status !== "done") {
      refreshStatus();
      return;
    }
    setVerifying(true);
    const started = performance.now();
    refreshStatus(setupQuality, { fresh: true }).finally(() => {
      window.setTimeout(() => setVerifying(false), Math.max(0, VERIFY_BEAT_MS - (performance.now() - started)));
    });
  }, [running, install?.status, setupQuality, refreshStatus]);

  // A tier running on a fallback weight is ready, but its own download stays one click away.
  const [wantsOwnModel, setWantsOwnModel] = useState(false);
  const stage: UpscaleSetupStage = running ? "downloading"
    : verifying ? "verifying"
    : !status ? (offline || reason ? "offline" : "checking")
    : !status.nodesInstalled ? "nodes"
    : status.ready && !(wantsOwnModel && status.substituting) ? "ready"
    : install?.status === "error" ? "error"
    : "models";

  // While setup waits on something outside HEISS UI (installing nodes,
  // restarting ComfyUI), watch for it instead of asking for a re-check.
  const watching = setupOpen && (stage === "nodes" || stage === "offline" || stage === "checking");
  useEffect(() => {
    if (!watching) return;
    const timer = window.setInterval(() => { refreshStatus(setupQuality, { fresh: true }); }, 3000);
    return () => window.clearInterval(timer);
  }, [watching, setupQuality, refreshStatus]);

  const markBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const openSetup = useCallback((item: GalleryItem | null = null, options: { download?: boolean; auto?: AutoUpscale } = {}) => {
    if (item) setPending(item);
    const auto = options.auto && options.auto !== "none" ? options.auto : null;
    setSetupAuto(auto);
    setWantsOwnModel(Boolean(options.download));
    setStartError("");
    setSetupOpen(true);
    refreshStatus(autoUpscaleQuality(auto ?? undefined) || prefs.upscaleQuality, { fresh: true });
  }, [prefs.upscaleQuality, refreshStatus]);

  // Hiding the dialog mid-download keeps the waiting image; it still upscales when the download lands.
  const inFlight = running || verifying;
  const closeSetup = useCallback(() => {
    setSetupOpen(false);
    setWantsOwnModel(false);
    if (inFlight) return;
    setPending(null);
    // Smart upscale stays on only if it can run; left unfinished, the tab goes back.
    if (setupAuto && stage !== "ready") setPrefs({ autoUpscale: autoBefore.current });
    setSetupAuto(null);
  }, [inFlight, setupAuto, stage, setPrefs]);

  /** Nothing downloads without an explicit yes in the setup dialog, which names the files and size. */
  const startDownload = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStartError("");
    try {
      const started = await apiJson<{ install: UpscaleInstall }>("/api/upscale/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quality: setupQuality })
      });
      setInstall(started.install);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Couldn’t start the download");
    } finally {
      startingRef.current = false;
    }
  }, [setupQuality]);

  const cancelInstall = useCallback(async () => {
    try {
      const result = await apiJson<{ install: UpscaleInstall }>("/api/upscale/install/cancel", { method: "POST" });
      setInstall(result.install);
    } catch {
      // The poll picks up the real state either way.
    }
  }, []);

  // Images whose upscale was clicked but has no job yet: they already show as
  // running, and there is nothing to stop until the server answers.
  const startingIds = useRef<Set<string>>(new Set());

  /** Shows the upscale running from the click on; if the server says no, it steps back and says why. */
  const runUpscale = useCallback(async (item: GalleryItem, quality: UpscaleQuality = prefs.upscaleQuality || "balanced") => {
    const before = item.upscale;
    startingIds.current.add(item.id);
    setNotice(item.id, null);
    patchGalleryItems((current) => current.id === item.id
      ? { ...current, upscale: { ...before, status: "running", jobId: undefined, quality, faceDetail: Boolean(prefs.upscaleFaceDetail), progress: null, error: undefined } }
      : current);
    try {
      await apiJson("/api/upscale", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ galleryItemId: item.id, quality, faceDetail: Boolean(prefs.upscaleFaceDetail) })
      });
      loadGalleryDelta();
    } catch (error) {
      // Going back to an earlier failure is not a new one; the watcher above must not announce it.
      lastUpscaleStatus.current.set(item.id, before?.status || "");
      patchGalleryItems((current) => current.id === item.id && current.upscale?.status === "running" && !current.upscale.jobId
        ? { ...current, upscale: before }
        : current);
      setNotice(item.id, upscaleNoticeFrom(error));
    } finally {
      startingIds.current.delete(item.id);
    }
  }, [loadGalleryDelta, patchGalleryItems, prefs.upscaleFaceDetail, prefs.upscaleQuality, setNotice]);

  // Setup finished for an image that was waiting: hold the ready moment for a
  // beat, then close and do what the click asked for in the first place.
  // With the dialog hidden there is no moment to hold, so it starts straight
  // away; the download widget at the top announces it instead.
  useEffect(() => {
    if (stage !== "ready" || !pending) return;
    const item = pending;
    const shown = setupOpen;
    const timer = window.setTimeout(() => {
      setSetupOpen(false);
      setPending(null);
      runUpscale(item);
    }, shown ? READY_BEAT_MS : 0);
    return () => window.clearTimeout(timer);
  }, [setupOpen, stage, pending, runUpscale]);

  const upscaleItem = useCallback(async (item: GalleryItem) => {
    if (!canUpscaleItem(item) || item.upscale?.status === "running") return;
    // Known ready: start at once. The server still checks, and a no comes back as a notice.
    if (status?.ready) {
      await runUpscale(item);
      return;
    }
    markBusy(item.id, true);
    const current = await refreshStatus(prefs.upscaleQuality || "balanced");
    markBusy(item.id, false);
    if (current?.ready) {
      await runUpscale(item);
      return;
    }
    openSetup(item);
  }, [markBusy, openSetup, prefs.upscaleQuality, refreshStatus, runUpscale, status?.ready]);

  /* Smart upscale: runs queued while a tab was on upscale each image as it
     finishes, at that tab's effort. Only this device's own runs, so two open
     windows never upscale the same image twice. A download still landing
     holds them back until it is checked. */
  const autoJobs = useRef<Map<string, UpscaleQuality>>(new Map());
  const autoStarted = useRef<Set<string>>(new Set());
  const queueAutoUpscale = useCallback((jobId: string) => {
    const quality = prefs.smartUpscale !== false ? autoUpscaleQuality(prefs.autoUpscale) : null;
    if (quality && jobId) autoJobs.current.set(jobId, quality);
  }, [prefs.autoUpscale, prefs.smartUpscale]);
  useEffect(() => {
    if (!autoJobs.current.size || inFlight) return;
    for (const item of gallery) {
      const quality = item.jobId ? autoJobs.current.get(item.jobId) : undefined;
      if (!quality || autoStarted.current.has(item.id) || !canUpscaleItem(item) || item.upscale?.status) continue;
      autoStarted.current.add(item.id);
      runUpscale(item, quality);
    }
  }, [gallery, inFlight, runUpscale]);

  /** A Smart upscale tab: on at once when its effort can run, otherwise through setup for that effort. */
  const chooseAutoUpscale = useCallback(async (tier: AutoUpscale) => {
    const before = prefs.autoUpscale || "none";
    if (tier === before) return;
    setPrefs({ autoUpscale: tier });
    const quality = autoUpscaleQuality(tier);
    if (!quality) return;
    const current = await refreshStatus(quality);
    if (current?.ready) return;
    autoBefore.current = before;
    openSetup(null, { auto: tier });
  }, [openSetup, prefs.autoUpscale, refreshStatus, setPrefs]);

  const toggleUpscale = useCallback(async (item: GalleryItem, active?: boolean) => {
    if (!item.upscale?.url) return;
    markBusy(item.id, true);
    try {
      await apiJson("/api/upscale/toggle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ galleryItemId: item.id, active })
      });
      loadGalleryDelta();
    } catch (error) {
      setNotice(item.id, upscaleNoticeFrom(error, "switch"));
    } finally {
      markBusy(item.id, false);
    }
  }, [loadGalleryDelta, markBusy, setNotice]);

  const cancelUpscale = useCallback(async (item: GalleryItem) => {
    if (startingIds.current.has(item.id)) return;
    markBusy(item.id, true);
    try {
      await apiJson("/api/upscale/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ galleryItemId: item.id })
      });
    } catch (error) {
      setNotice(item.id, upscaleNoticeFrom(error, "cancel"));
    } finally {
      // The run notices the cancel on its next poll, so give it a moment to land.
      window.setTimeout(() => { markBusy(item.id, false); loadGalleryDelta(); }, 1800);
    }
  }, [loadGalleryDelta, markBusy, setNotice]);

  /** One click: upscale the first time, then flip between the two versions. */
  const activateUpscale = useCallback((item: GalleryItem) => {
    if (item.upscale?.url) return toggleUpscale(item);
    return upscaleItem(item);
  }, [toggleUpscale, upscaleItem]);

  return {
    upscaleStatus: status,
    upscaleUnavailableReason: reason,
    upscaleInstall: install,
    upscaleBusyIds: busyIds,
    upscaleNotices: notices,
    dismissUpscaleNotice: (id: string) => setNotice(id, null),
    upscaleSetup: {
      open: setupOpen,
      stage,
      pending,
      startError,
      lastChecked,
      openSetup,
      closeSetup,
      downloadOwnModel: () => setWantsOwnModel(true),
      startDownload,
      cancelInstall,
      auto: setupAuto,
      quality: setupQuality,
      recheck: () => refreshStatus(setupQuality, { fresh: true })
    },
    chooseAutoUpscale,
    queueAutoUpscale,
    refreshUpscaleStatus: refreshStatus,
    cancelUpscaleInstall: cancelInstall,
    openUpscaleSetup: openSetup,
    upscaleItem,
    toggleUpscale,
    cancelUpscale,
    activateUpscale
  };
}

export type UpscaleSetup = ReturnType<typeof useUpscale>["upscaleSetup"];

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiJson } from './api';
import type { GalleryItem, Preferences, UpscaleInstall, UpscaleStatus } from './types';

/** The gallery keeps the original as the record; only the view swaps. */
export function upscaleDisplayUrl(item: GalleryItem) {
  return item.upscaleActive && item.upscale?.url ? item.upscale.url : item.url;
}

export function upscaleDisplayThumbnail(item: GalleryItem) {
  if (!item.upscaleActive || !item.upscale?.url) return item.thumbnailUrl;
  return item.upscale.thumbnailUrl || item.upscale.url;
}

export function canUpscaleItem(item: GalleryItem) {
  return item.status === "done" && item.type === "image" && !item.vaultLocked && Boolean(item.url);
}

export function formatBytes(bytes = 0) {
  if (!bytes) return "unknown size";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** The three efforts, with what each first download weighs (DiT plus the shared VAE). */
export const upscaleEfforts = [
  { value: "fast", label: "Fast", scale: "1.5×", model: "SeedVR2 3B", detail: "1.5× with the 3B model. Lightest on VRAM.", downloadBytes: 3_892_869_510 },
  { value: "balanced", label: "Balanced", scale: "2×", model: "SeedVR2 7B", detail: "2× with the 7B fp8 model.", downloadBytes: 8_967_621_152 },
  { value: "high", label: "High", scale: "3×", model: "SeedVR2 7B fp16", detail: "3× with the 7B fp16 model. Slowest, needs the most VRAM.", downloadBytes: 16_980_659_238 }
] as const;

export function upscaleQualityLabel(quality = "balanced") {
  return upscaleEfforts.find((effort) => effort.value === quality)?.label || "Balanced";
}

/** Why an image could not be upscaled, shown in a popover on its upscale button. */
export type UpscaleNotice = { title: string; message: string; reason: string };

const noticeTitles: Record<string, string> = {
  missing: "This image is gone from the server",
  video: "Only images can be upscaled",
  unfinished: "Still rendering",
  source: "Could not read the original",
  switch: "Could not switch versions"
};

export function upscaleNoticeFrom(error: unknown, fallbackReason = ""): UpscaleNotice {
  const reason = error instanceof ApiError && error.reason ? error.reason : fallbackReason;
  const message = error instanceof Error ? error.message : "Upscale failed to start.";
  const offline = error instanceof TypeError;
  return {
    reason,
    title: noticeTitles[reason] || (offline ? "Could not reach HEISS UI" : "Upscale could not start"),
    message: offline ? "Check that HEISS UI is still running, then try again." : message
  };
}

/** Where the setup flow stands; the dialog, its hero and the stepper all read from this. */
export type UpscaleSetupStage = "checking" | "offline" | "nodes" | "models" | "downloading" | "verifying" | "ready" | "error";

type UpscaleOptions = {
  prefs: Preferences;
  showToast: (message: string, tone?: "default" | "success" | "error") => void;
  loadGalleryDelta: () => void;
};

// Long enough to read the check as a step of its own, short enough to never feel like waiting.
const VERIFY_BEAT_MS = 1500;
const READY_BEAT_MS = 1400;

export function useUpscale({ prefs, showToast, loadGalleryDelta }: UpscaleOptions) {
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
  const [reason, setReason] = useState("");
  const [offline, setOffline] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [startError, setStartError] = useState("");
  const [lastChecked, setLastChecked] = useState(0);
  // The image whose click opened setup; it upscales on its own once setup is done.
  const [pending, setPending] = useState<GalleryItem | null>(null);
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
      return failStatus("Could not reach HEISS UI.", true);
    }
    // Report what actually came back rather than guessing at a cause: a non-JSON
    // body means something other than this route answered (SPA shell, proxy).
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      console.warn(`Smart upscale status: ${contentType || "unknown type"} (HTTP ${response.status}) instead of JSON`);
      return failStatus("HEISS UI is running older code. Restart it to finish updating.");
    }
    let payload: UpscaleStatus & { error?: string; offline?: boolean };
    try {
      payload = await response.json();
    } catch {
      return failStatus(`Could not read the smart upscale status (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      if (payload?.install !== undefined) setInstall(payload.install);
      return failStatus(payload?.error || `Smart upscale status failed (HTTP ${response.status}).`, Boolean(payload?.offline));
    }
    if (typeof payload?.nodesInstalled !== "boolean") {
      return failStatus(`The smart upscale status was missing its node report (HTTP ${response.status}).`);
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
    refreshStatus();
  }, [prefs.smartUpscale, prefs.upscaleQuality, refreshStatus]);

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
    refreshStatus(prefs.upscaleQuality, { fresh: true }).finally(() => {
      window.setTimeout(() => setVerifying(false), Math.max(0, VERIFY_BEAT_MS - (performance.now() - started)));
    });
  }, [running, install?.status, prefs.upscaleQuality, refreshStatus]);

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
    const timer = window.setInterval(() => { refreshStatus(prefs.upscaleQuality, { fresh: true }); }, 3000);
    return () => window.clearInterval(timer);
  }, [watching, prefs.upscaleQuality, refreshStatus]);

  const markBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const openSetup = useCallback((item: GalleryItem | null = null, options: { download?: boolean } = {}) => {
    if (item) setPending(item);
    setWantsOwnModel(Boolean(options.download));
    setStartError("");
    setSetupOpen(true);
    refreshStatus(prefs.upscaleQuality, { fresh: true });
  }, [prefs.upscaleQuality, refreshStatus]);

  // Hiding the dialog mid-download keeps the waiting image; it still upscales when the download lands.
  const inFlight = running || verifying;
  const closeSetup = useCallback(() => {
    setSetupOpen(false);
    setWantsOwnModel(false);
    if (!inFlight) setPending(null);
  }, [inFlight]);

  /** Nothing downloads without an explicit yes in the setup dialog, which names the files and size. */
  const startDownload = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStartError("");
    try {
      const started = await apiJson<{ install: UpscaleInstall }>("/api/upscale/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quality: prefs.upscaleQuality || "balanced" })
      });
      setInstall(started.install);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Could not start the download");
    } finally {
      startingRef.current = false;
    }
  }, [prefs.upscaleQuality]);

  const cancelInstall = useCallback(async () => {
    try {
      const result = await apiJson<{ install: UpscaleInstall }>("/api/upscale/install/cancel", { method: "POST" });
      setInstall(result.install);
    } catch {
      // The poll picks up the real state either way.
    }
  }, []);

  const runUpscale = useCallback(async (item: GalleryItem) => {
    const quality = prefs.upscaleQuality || "balanced";
    markBusy(item.id, true);
    setNotice(item.id, null);
    try {
      await apiJson("/api/upscale", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ galleryItemId: item.id, quality, faceDetail: Boolean(prefs.upscaleFaceDetail) })
      });
      loadGalleryDelta();
    } catch (error) {
      setNotice(item.id, upscaleNoticeFrom(error));
    } finally {
      markBusy(item.id, false);
    }
  }, [loadGalleryDelta, markBusy, prefs.upscaleFaceDetail, prefs.upscaleQuality, setNotice]);

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
    markBusy(item.id, true);
    const current = await refreshStatus(prefs.upscaleQuality || "balanced");
    markBusy(item.id, false);
    if (current?.ready) {
      await runUpscale(item);
      return;
    }
    openSetup(item);
  }, [markBusy, openSetup, prefs.upscaleQuality, refreshStatus, runUpscale, setNotice]);

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
      recheck: () => refreshStatus(prefs.upscaleQuality, { fresh: true })
    },
    refreshUpscaleStatus: refreshStatus,
    cancelUpscaleInstall: cancelInstall,
    openUpscaleSetup: openSetup,
    upscaleItem,
    toggleUpscale,
    activateUpscale
  };
}

export type UpscaleSetup = ReturnType<typeof useUpscale>["upscaleSetup"];

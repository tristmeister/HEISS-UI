import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJson } from './api';
import type { ConfirmAction } from './useConfirmation';
import type { GalleryItem, Preferences, UpscaleDownloadPreview, UpscaleInstall, UpscaleStatus } from './types';

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

const qualityLabels: Record<string, string> = {
  fast: "Fast",
  balanced: "Balanced",
  high: "High"
};

export function upscaleQualityLabel(quality = "balanced") {
  return qualityLabels[quality] || "Balanced";
}

type UpscaleOptions = {
  prefs: Preferences;
  confirmAction: ConfirmAction;
  showToast: (message: string, tone?: "default" | "success" | "error") => void;
  loadGalleryDelta: () => void;
};

export function useUpscale({ prefs, confirmAction, showToast, loadGalleryDelta }: UpscaleOptions) {
  const [status, setStatus] = useState<UpscaleStatus | null>(null);
  const [install, setInstall] = useState<UpscaleInstall>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const installingRef = useRef(false);

  const refreshStatus = useCallback(async (quality = prefs.upscaleQuality) => {
    try {
      const next = await apiJson<UpscaleStatus>(`/api/upscale/status?quality=${encodeURIComponent(quality)}`);
      // An older server answers this route with the SPA shell, not a status.
      if (typeof next?.nodesInstalled !== "boolean") {
        setStatus(null);
        return null;
      }
      setStatus(next);
      setInstall(next.install);
      return next;
    } catch {
      setStatus(null);
      return null;
    }
  }, [prefs.upscaleQuality]);

  useEffect(() => {
    if (!prefs.smartUpscale) return;
    refreshStatus();
  }, [prefs.smartUpscale, prefs.upscaleQuality, refreshStatus]);

  // Downloads are long; poll only while one is actually running.
  useEffect(() => {
    if (install?.status !== "running") return;
    const timer = window.setInterval(() => { refreshStatus(); }, 1200);
    return () => window.clearInterval(timer);
  }, [install?.status, refreshStatus]);

  const markBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  /** Nothing downloads without an explicit yes that names the files and size. */
  const ensureModels = useCallback(async (quality: string) => {
    const current = await refreshStatus(quality as Preferences["upscaleQuality"]);
    if (!current) {
      showToast("ComfyUI is offline, so smart upscale is unavailable", "error");
      return false;
    }
    if (!current.nodesInstalled) {
      showToast(`ComfyUI is missing the SeedVR2 nodes: ${(current.missingNodes || []).join(", ")}`, "error");
      return false;
    }
    if (current.ready) return true;
    if (!current.canDownload) {
      showToast("Set the ComfyUI output folder in Settings so J AI knows where to install SeedVR2 models", "error");
      return false;
    }
    if (installingRef.current) return false;
    let preview: UpscaleDownloadPreview;
    try {
      preview = await apiJson<UpscaleDownloadPreview>("/api/upscale/install/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quality })
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not check the SeedVR2 download", "error");
      return false;
    }
    const list = preview.files.map((file) => `${file.label} (${formatBytes(file.bytes)})`).join(", ");
    const accepted = await confirmAction({
      title: "Install the smart upscale models?",
      description: `${upscaleQualityLabel(quality)} upscaling needs ${list}. That is about ${formatBytes(preview.totalBytes)} downloaded once into ${preview.modelDir}. ComfyUI may need a restart afterwards before the models appear.`,
      action: "Download"
    });
    if (!accepted) return false;
    installingRef.current = true;
    try {
      const started = await apiJson<{ install: UpscaleInstall }>("/api/upscale/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quality })
      });
      setInstall(started.install);
      showToast("Downloading the SeedVR2 models", "default");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not start the download", "error");
    } finally {
      installingRef.current = false;
    }
    return false;
  }, [confirmAction, refreshStatus, showToast]);

  const cancelInstall = useCallback(async () => {
    try {
      const result = await apiJson<{ install: UpscaleInstall }>("/api/upscale/install/cancel", { method: "POST" });
      setInstall(result.install);
    } catch {
      // The poll picks up the real state either way.
    }
  }, []);

  const upscaleItem = useCallback(async (item: GalleryItem) => {
    if (!canUpscaleItem(item) || item.upscale?.status === "running") return;
    const quality = prefs.upscaleQuality || "balanced";
    markBusy(item.id, true);
    try {
      if (!(await ensureModels(quality))) return;
      await apiJson("/api/upscale", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ galleryItemId: item.id, quality, faceDetail: Boolean(prefs.upscaleFaceDetail) })
      });
      loadGalleryDelta();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Upscale failed to start", "error");
    } finally {
      markBusy(item.id, false);
    }
  }, [ensureModels, loadGalleryDelta, markBusy, prefs.upscaleFaceDetail, prefs.upscaleQuality, showToast]);

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
      showToast(error instanceof Error ? error.message : "Could not switch versions", "error");
    } finally {
      markBusy(item.id, false);
    }
  }, [loadGalleryDelta, markBusy, showToast]);

  /** One click: upscale the first time, then flip between the two versions. */
  const activateUpscale = useCallback((item: GalleryItem) => {
    if (item.upscale?.url) return toggleUpscale(item);
    return upscaleItem(item);
  }, [toggleUpscale, upscaleItem]);

  return {
    upscaleStatus: status,
    upscaleInstall: install,
    upscaleBusyIds: busyIds,
    refreshUpscaleStatus: refreshStatus,
    cancelUpscaleInstall: cancelInstall,
    upscaleItem,
    toggleUpscale,
    activateUpscale
  };
}

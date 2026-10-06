import { useEffect, useRef } from 'react';
import { toast } from './toast';
import { apiFetch, apiJson, serverClockOffset } from './api';
import { clientJobUuid } from './format';
import { dedupeGalleryItems } from './gallery';
import { clearLoraLibrary } from './lora-storage';
import { retryRequest, type RetryOptions, type RetryRequest } from './retry';
import { downloadActions } from './useModelDownloads';
import { autoUpscaleQuality } from './useUpscale';
import type { GalleryItem, Job } from './types';

type GalleryPayload = { items?: GalleryItem[]; outputs?: GalleryItem[] };

function payloadItems(data: GalleryPayload | null | undefined) {
  return data?.items || data?.outputs || [];
}

export function useGenerationActions(view: any) {
  const {
    active, canUseStartImage, confirmAction, count, currentProfile, denoise,
    frames, fps, generateDisabled, generatePostingRef, height, loadGallery, loadGalleryDelta, loras, missingRequiredReference, mode,
    model, negative, prefs, hiddenSpace, hidden, prompt, sampler, scheduler, seed, setActive, setGallery,
    upsertGalleryItems, removeGalleryItems, removeGalleryItemsWhere, patchGalleryItems, setStatus, setZenSelectedId, showToast, startImage, startImageId, startImageName, steps, cfg,
    referenceAssets, inpaint, textEncoder, textEncoders, vae, clipType, weightDtype, width, visibleGallery, outputDir, generateDisabledReason, comfyOffline, comfyRestarting, openModelSetup, retryComfyStatus, refreshModels
  } = view;
  const galleryUpsert = upsertGalleryItems || ((items: GalleryItem[]) => setGallery((current: GalleryItem[]) => dedupeGalleryItems([...items, ...current])));
  const galleryRemove = removeGalleryItems || ((keys: string[]) => setGallery((current: GalleryItem[]) => current.filter((item: GalleryItem) => !keys.includes(item.id) && !keys.includes(item.url) && (!item.jobId || !keys.includes(item.jobId)))));
  const galleryRemoveWhere = removeGalleryItemsWhere || ((predicate: (item: GalleryItem) => boolean) => setGallery((current: GalleryItem[]) => current.filter((item: GalleryItem) => !predicate(item))));
  const galleryPatch = patchGalleryItems || ((update: (item: GalleryItem) => GalleryItem) => setGallery((current: GalleryItem[]) => current.map(update)));

  // A run that finishes while the tab is in the background says so in the tab title.
  const unseenRef = useRef(0);
  useEffect(() => {
    const clear = () => {
      if (document.visibilityState !== "visible" || !unseenRef.current) return;
      unseenRef.current = 0;
      document.title = document.title.replace(/^\(\d+\)\s*/, "");
    };
    document.addEventListener("visibilitychange", clear);
    return () => document.removeEventListener("visibilitychange", clear);
  }, []);
  function announceFinished() {
    if (document.visibilityState === "visible") return;
    unseenRef.current += 1;
    document.title = `(${unseenRef.current}) ${document.title.replace(/^\(\d+\)\s*/, "")}`;
  }

  function pendingItemsFor(jobId: string, body: any): GalleryItem[] {
    const itemCount = body.kind === "image" ? Math.max(1, Math.min(8, Number(body.count || 1))) : 1;
    // On the server's clock, like the stamp the server puts on it moments later.
    const createdAt = new Date(Date.now() + serverClockOffset).toISOString();
    const title = String(body.prompt || "Untitled prompt").replace(/\s+/g, " ").trim().slice(0, 68) || "Untitled prompt";
    return Array.from({ length: itemCount }, (_, index) => ({
      id: `${jobId}-${index}`,
      jobId,
      index,
      url: "",
      filename: body.kind === "image" && itemCount > 1 ? `${title} ${index + 1}` : title,
      type: body.kind === "video" ? "video" : "image",
      status: "pending",
      optimistic: true,
      prompt: body.prompt || "",
      negative: body.negative || "",
      createdAt,
      width: Number(body.width || 0),
      height: Number(body.height || 0),
      model: body.model || "",
      referenceImage: body.referenceAssets?.[0]?.assetId || body.startImageId || "",
      referenceImageName: body.startImageName || "",
      startImageId: body.referenceAssets?.[0]?.assetId || body.startImageId || "",
      settings: { workflow: body.workflow || "", profileId: body.profileId || "", count: itemCount }
    }));
  }

  function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  /** Runs what the composer holds. Takes no argument, so it can be a click handler as is. */
  function generate() {
    return runGeneration();
  }

  /**
   * Runs the composer's settings, or with `retry` a failed item's own
   * settings again (see retry.ts), past the composer's checks: the server
   * validates that run the same way.
   */
  async function runGeneration(retry?: RetryRequest) {
    if (generatePostingRef.current) return;
    if (comfyRestarting) {
      showToast("ComfyUI is restarting. Try again in a few seconds.", "warning");
      return;
    }
    if (comfyOffline) {
      showToast("ComfyUI is offline, so nothing was sent. Start it, then try again.", "error", retryComfyStatus ? { action: { label: "Check again", onClick: retryComfyStatus } } : undefined);
      return;
    }
    if (!retry && !prompt.trim()) {
      showToast("Enter a prompt to generate", "error");
      return;
    }
    if (!retry && !currentProfile) {
      showToast(generateDisabledReason || "Choose a model first", "error", openModelSetup ? { action: { label: "Models", onClick: openModelSetup } } : undefined);
      return;
    }
    if (!retry && missingRequiredReference) {
      showToast("Add the required reference image", "error");
      return;
    }
    if (!retry && generateDisabled) {
      // Straight to the setup panel for this model, instead of a hint to go find it.
      showToast(`${currentProfile.displayName || currentProfile.label} isn’t ready yet. ${generateDisabledReason || "It needs files first"}.`, "error");
      openModelSetup?.();
      return;
    }
    const runMode: "image" | "video" = retry ? retry.kind : mode;
    const toHidden = retry ? Boolean(retry.body.privateVault) : Boolean(hiddenSpace);
    // Asked before anything is sent, so a Hidden prompt never runs in the open.
    if (toHidden && !hidden.ensureReady({ kind: "generate" })) return;
    generatePostingRef.current = true;
    const optimisticJobIds: string[] = [];
    try {
      const effectiveCount = retry ? Math.max(1, Number(retry.body.count) || 1) : mode === "image" && currentProfile?.capabilities?.variations === false ? 1 : count;
      const separate = !retry && runMode === "image" && prefs.variationQueueMode === "separate";
      const imageRuns = separate ? effectiveCount : 1;
      const requestCount = separate ? 1 : effectiveCount;
      const startMessage = retry ? retry.label
        : runMode === "image"
        ? separate && effectiveCount > 1
          ? `Started ${effectiveCount} separate generations`
          : `Started ${effectiveCount} image${effectiveCount === 1 ? "" : "s"}`
        : "Started video";
      setStatus(startMessage);

      const requestBody: Record<string, any> = retry ? retry.body : {
        kind: mode,
        prompt,
        negative,
        profileId: currentProfile?.id || model,
        model: currentProfile?.model || model,
        workflow: currentProfile?.workflow || "",
        textEncoder,
        textEncoders,
        vae,
        clipType,
        weightDtype,
        width,
        height,
        steps,
        cfg,
        denoise,
        sampler,
        scheduler,
        seed,
        count: effectiveCount,
        frames,
        fps,
        autoResizeInputs: prefs.autoResizeInputs !== false,
        loras,
        referenceAssets: (referenceAssets || []).map(({ slot, asset }: any) => ({ slot, assetId: asset.id })),
        // A painted mask on the first reference: change only that part.
        ...(inpaint ? { inpaint } : {}),
        startImageId: canUseStartImage ? startImageId : "",
        startImageName,
        privateVault: Boolean(hiddenSpace),
        // Smart upscale: the server upscales each image once the run is done.
        autoUpscale: mode === "image" && prefs.smartUpscale !== false && autoUpscaleQuality(prefs.autoUpscale)
          ? { quality: autoUpscaleQuality(prefs.autoUpscale), faceDetail: Boolean(prefs.upscaleFaceDetail) }
          : null
      };
      const queuedJobs: string[] = [];
      // One tile per job, so a failure can open straight onto its report.
      const firstItemOf = new Map<string, GalleryItem>();
      for (let index = 0; index < imageRuns; index += 1) {
        const clientJobId = clientJobUuid();
        optimisticJobIds.push(clientJobId);
        // Separate runs from one pinned seed would all be the same picture; step it per run.
        const baseSeed = retry ? String(requestBody.seed || "") : seed;
        const runSeed = imageRuns > 1 && /^\d+$/.test(String(baseSeed || "").trim()) ? String(Number(baseSeed) + index) : baseSeed;
        // An inpainted image keeps its reference's size, so its tile has that shape while it renders.
        const paintedOn = requestBody.inpaint ? (referenceAssets || [])[0]?.asset : null;
        const optimisticBody = { ...requestBody, ...(paintedOn?.width && paintedOn?.height ? { width: paintedOn.width, height: paintedOn.height } : {}), seed: runSeed, count: requestCount, startImageId: retry ? requestBody.startImageId : canUseStartImage ? startImageId : "" };
        const optimisticItems = pendingItemsFor(clientJobId, optimisticBody);
        galleryUpsert(optimisticItems);
        if (prefs.zenMode) setZenSelectedId(optimisticItems[0].id);
        await nextPaint();
        const { jobId, items, hidden: wentHidden } = await apiJson<{ jobId: string; items: GalleryItem[]; hidden?: boolean; revision?: number }>("/api/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...requestBody, seed: runSeed, clientJobId, count: requestCount, startImage: !retry && canUseStartImage && !startImageId ? startImage : "" })
        });
        queuedJobs.push(jobId);
        firstItemOf.set(jobId, items?.[0] || optimisticItems[0]);
        if (wentHidden && !toHidden) {
          // Made from a Hidden image, so it stays hidden: the tile leaves this gallery and says where it went.
          galleryRemove([clientJobId, jobId]);
          if (index === 0) showToast("Made from a Hidden image, so it’s saved in Hidden", "default");
          continue;
        }
        if (items?.length) {
          galleryUpsert(items);
          if (prefs.zenMode) setZenSelectedId(items[0].id);
        }
      }
      generatePostingRef.current = false;

      await Promise.all(queuedJobs.map(async (jobId) => {
        // A dropped Wi-Fi, a sleeping laptop or a server restart is not a failed
        // job: keep asking, slower each time, and give up only after a long gap.
        let misses = 0;
        while (true) {
          await new Promise((resolve) => setTimeout(resolve, 1600 * Math.min(5, 1 + misses)));
          let job: Job;
          try {
            job = await apiJson<Job>(`/api/jobs/${jobId}`);
            misses = 0;
          } catch {
            misses += 1;
            if (misses < 12) continue;
            galleryPatch((item: GalleryItem) => item.jobId === jobId && item.status === "pending" ? { ...item, status: "error", optimistic: false, filename: "Lost the connection to HEISS UI. The image may still finish. Reload to check." } : item);
            return null;
          }
          if (job.status === "missing") {
            galleryPatch((item: GalleryItem) => item.jobId === jobId ? { ...item, status: "error", optimistic: false, filename: "Generation interrupted" } : item);
            return job;
          }
          if (job.status === "error") {
            const message = job.error || "Generation failed";
            galleryPatch((item: GalleryItem) => item.jobId === jobId ? { ...item, status: "error", optimistic: false, filename: message } : item);
            const failed = firstItemOf.get(jobId);
            showToast(message, "error", failed ? { action: { label: "See why", onClick: () => setActive({ ...failed, status: "error", optimistic: false, filename: message }) } } : undefined);
            setStatus(message);
            return job;
          }
          if (job.status === "done") { announceFinished(); return job; }
          if (job.status === "canceled") return job;
          if (job.preview || job.previews?.length || job.progress || job.status === "queued" || job.status === "running") {
            galleryPatch((item: GalleryItem) => {
              if (item.jobId !== jobId) return item;
              const batchCount = Number(item.settings?.count || 1);
              const indexedPreview = Number.isInteger(item.index) ? job.previews?.[item.index || 0] : undefined;
              const sharedPreview = batchCount <= 1 ? job.preview : undefined;
              return {
                ...item,
                preview: indexedPreview || sharedPreview || item.preview,
                progress: job.progress || item.progress || { value: 0, max: 0, node: job.status },
                status: item.status === "pending" ? "pending" : item.status
              };
            });
          }
          if (job.progress?.steps !== false && job.progress?.max) {
            setStatus(`Rendering ${job.progress.value}/${job.progress.max}`);
          } else if (job.progress?.phase) {
            setStatus(job.progress.phase);
          } else {
            setStatus(job.status === "queued" ? "Queued" : "Started");
          }
        }
      }));
      await (loadGalleryDelta ? loadGalleryDelta() : loadGallery());
      if (prefs.zenMode && prefs.followLatest && !toHidden) {
        const data = await apiJson<GalleryPayload>(`/api/gallery?type=${encodeURIComponent(runMode)}&limit=80`).catch(() => null);
        const outputs = payloadItems(data).filter((item: GalleryItem) => item.status !== "canceled");
        const latest = outputs.find((item: GalleryItem) => item.type === runMode && item.status === "done");
        if (latest) {
          galleryUpsert(outputs);
          setZenSelectedId(latest.id);
        }
      }
      setStatus(runMode === "image" ? "Finished. The images are in the gallery." : "Finished. The video is in the gallery.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Generation failed";
      galleryPatch((item: GalleryItem) => {
        if (item.status === "pending" && item.jobId && optimisticJobIds.includes(item.jobId)) return { ...item, status: "error", optimistic: false, filename: message };
        return item;
      });
      setStatus(message);
      showToast(message, "error");
    } finally {
      generatePostingRef.current = false;
    }
  }

  async function cancelJob(jobId: string | undefined) {
    if (!jobId) return;
    // Stop acts on the whole run, so say how many images it takes with it.
    const runSize = ((visibleGallery || []) as GalleryItem[]).filter((item) => item.jobId === jobId && item.status === "pending").length;
    const many = runSize > 1;
    if (!await confirmAction({
      title: many ? `Stop all ${runSize} variants?` : "Stop generation?",
      description: many ? "They’re one run, so they stop together. Nothing is saved." : "It won’t be saved.",
      action: many ? "Stop all" : "Stop",
      destructive: true
    })) return;
    await stopJob(jobId);
  }

  async function stopJob(jobId: string) {
    const response = await apiFetch(`/api/jobs/${jobId}/cancel`, { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      showToast("Couldn’t stop it. It may still be running in ComfyUI.", "error", { action: { label: "Try again", onClick: () => stopJob(jobId) } });
      return;
    }
    galleryRemove([jobId]);
    setStatus("Ready");
  }

  async function cancelQueue() {
    if (!await confirmAction({"title": "Stop all generations?", "description": "Running and queued generations and upscales stop.", "action": "Stop all", "destructive": true})) return;
    await stopQueue();
  }

  async function stopQueue() {
    const response = await apiFetch("/api/queue/cancel", { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      showToast("Couldn’t stop the queue. Generations may still be running in ComfyUI.", "error", { action: { label: "Try again", onClick: stopQueue } });
      return;
    }
    galleryRemoveWhere((item: GalleryItem) => item.status === "pending" || item.status === "canceled");
    setStatus("Ready");
  }

  async function clearGallery() {
    const where = outputDir ? ` in ${outputDir}` : " in ComfyUI’s output folder";
    if (!await confirmAction({
      title: "Delete all finished images?",
      description: `Their files${where} move to HEISS UI’s trash there for 30 days. Hidden isn’t affected.`,
      action: "Delete all",
      destructive: true
    })) return;
    const data = await apiJson<GalleryPayload & { files?: { deleted: number; skipped: number }; trash?: { batch: string; moved: number; days: number } }>("/api/gallery/clear", { method: "POST" }).catch(() => null);
    if (!data) {
      showToast("Couldn’t clear the gallery. Nothing was deleted.", "error");
      return;
    }
    const items = payloadItems(data);
    setGallery(items.filter((item: GalleryItem) => item.status !== "canceled"));
    const moved = data.trash?.moved ?? data.files?.deleted ?? 0;
    const batch = data.trash?.batch || "";
    showToast(moved ? `Moved ${moved} file${moved === 1 ? "" : "s"} to the trash` : "Gallery cleared", "removed", batch ? { action: { label: "Undo", onClick: () => restoreCleared(batch) } } : undefined);
    setStatus("Ready");
  }

  /** Undo for "Delete all": the batch comes back out of the trash, into the gallery. */
  async function restoreCleared(batch: string) {
    const data = await apiJson<GalleryPayload & { restored: number; missing: number }>("/api/gallery/trash/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batch }) }).catch(() => null);
    if (!data) {
      showToast("Couldn’t restore them. They’re still in the trash. Try again from Settings › Library.", "error");
      return;
    }
    setGallery(payloadItems(data).filter((item: GalleryItem) => item.status !== "canceled"));
    showToast(data.missing ? `${data.restored} back in the gallery. ${data.missing} file${data.missing === 1 ? "" : "s"} stayed in the trash because newer files have the same name.` : `${data.restored} back in the gallery`, data.missing ? "warning" : "success");
  }

  async function clearFailedItems() {
    if (!await confirmAction({"title": "Clear failed generations?", "description": "Removes failed and interrupted items from the gallery.", "action": "Clear", "destructive": true})) return;
    const data = await apiJson<GalleryPayload>("/api/gallery/errors/clear", { method: "POST" }).catch(() => null);
    if (!data) { showToast("Couldn’t clear failed generations", "error"); return; }
    setGallery(payloadItems(data).filter((item: GalleryItem) => item.status !== "canceled"));
    setStatus("Ready");
  }

  async function resetAllSettings() {
    if (!await confirmAction({"title": "Reset all settings?", "description": "Preferences, prompt drafts and saved LoRA stacks are deleted here and on the server. The page reloads. This can’t be undone.", "action": "Reset", "destructive": true, "irreversible": true})) return;
    localStorage.removeItem("heiss-ui-draft");
    localStorage.removeItem("heiss-ui-prefs");
    localStorage.removeItem("j-ai-studio-draft");
    localStorage.removeItem("j-ai-studio-prefs");
    clearLoraLibrary();
    // The server keeps its own copy of LoRA strengths and stacks; clear it too,
    // or the next load would restore everything the dialog said was cleared.
    await apiFetch("/api/loras", { method: "DELETE" }).catch(() => null);
    if ("caches" in window) {
      await caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))).catch(() => null);
    }
    window.location.reload();
  }

  async function clearAllCache() {
    if (!await confirmAction({"title": "Clear cache?", "description": "Clears cached previews and frees ComfyUI’s memory. The gallery isn’t affected.", "action": "Clear", "destructive": false})) return;
    await clearCaches();
  }

  async function clearCaches() {
    if ("caches" in window) {
      await caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))).catch(() => null);
    }
    const data = await apiFetch("/api/cache/clear", { method: "POST" }).then((res) => res.ok ? res.json() : null).catch(() => null);
    if (!data) { showToast("Couldn’t clear ComfyUI’s cache", "error", { action: { label: "Try again", onClick: clearCaches } }); return; }
    setGallery(payloadItems(data).filter((item: GalleryItem) => item.status !== "canceled"));
    showToast("Cache cleared", "removed");
    setStatus("Ready");
  }

  async function openOutputFolder() {
    const response = await apiFetch("/api/open-output-folder", { method: "POST" }).catch(() => null);
    if (!response?.ok) showToast("Couldn’t open the folder", "error");
  }

  // Deletes wait out the undo toast before the file is actually removed: they
  // commit when it leaves without an Undo, so hovering it keeps the undo open.
  const UNDO_MS = 6000;
  const pendingDeletes = useRef(new Map<string, GalleryItem>());

  async function commitDelete(item: GalleryItem) {
    const response = await apiFetch(`/api/gallery/${encodeURIComponent(item.id)}`, { method: "DELETE", keepalive: true }).catch(() => null);
    if (response?.ok) return;
    // Put it back: the server still has it, and the screen must say so.
    galleryUpsert([item]);
    const reason = await response?.json().then((data: { error?: string }) => data?.error).catch(() => null);
    showToast(reason || "Couldn’t delete it, so it’s back in the gallery.", "error");
  }

  // Leaving the page commits whatever is still waiting; keepalive lets the request finish.
  useEffect(() => {
    const flush = () => {
      for (const item of pendingDeletes.current.values()) commitDelete(item);
      pendingDeletes.current.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function deleteItem(item: GalleryItem, confirmed = false) {
    if (!confirmed && !await confirmAction(item.privateVault
      ? {"title": "Delete from Hidden?", "description": "This image and its upscale are erased. There’s no other copy.", "action": "Delete", "destructive": true}
      : item.library
        ? {"title": "Remove from the gallery?", "description": "The file stays in its folder.", "action": "Remove"}
        : {"title": "Delete this image?", "description": "The file is deleted from disk.", "action": "Delete", "destructive": true})) return;
    // In the viewer, step to the next image rather than closing, so culling a batch stays in place.
    if (active?.id === item.id) {
      const items = ((visibleGallery || []) as GalleryItem[]).filter((entry) => entry.status === "pending" || entry.status === "done" || entry.status === "error");
      const index = items.findIndex((entry) => entry.id === item.id);
      const next = items[index + 1] || items[index - 1];
      setActive(next && next.id !== item.id ? next : null);
    }
    galleryRemove([item.id, item.url].filter(Boolean));
    offerUndo([item]);
  }

  /**
   * One toast for a run of deletes: clicking through a batch counts up in it
   * ("4 images deleted") instead of stacking toasts, and its Undo brings back
   * all of them. Gallery and Hidden deletes count separately.
   */
  function offerUndo(targets: GalleryItem[]) {
    targets.forEach((item) => pendingDeletes.current.set(item.id, item));
    const hiddenOnes = targets.some((item) => item.privateVault);
    toast.removed(hiddenOnes ? "Deleted from Hidden" : "Image deleted", {
      group: hiddenOnes ? "delete-hidden" : "delete",
      count: targets.length,
      plural: (count) => hiddenOnes ? `${count} deleted from Hidden` : `${count} images deleted`,
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          const back = targets.filter((item) => pendingDeletes.current.delete(item.id));
          if (back.length) galleryUpsert(back);
        }
      },
      onClose: () => {
        targets.forEach((item) => { if (pendingDeletes.current.delete(item.id)) commitDelete(item); });
      }
    });
  }

  /** Several at once (the phone's selection): one question, one undo for all of them. */
  async function deleteItems(items: GalleryItem[]) {
    const targets = items.filter(Boolean);
    if (!targets.length) return;
    if (targets.length === 1) return deleteItem(targets[0]);
    const hiddenOnes = targets.some((item) => item.privateVault);
    if (!await confirmAction({
      title: `Delete ${targets.length} images?`,
      description: hiddenOnes ? "They and their upscales are erased. There’s no other copy." : "Their files are deleted from disk.",
      action: `Delete ${targets.length}`,
      destructive: true
    })) return;
    if (active && targets.some((item) => item.id === active.id)) setActive(null);
    galleryRemove(targets.flatMap((item) => [item.id, item.url]).filter(Boolean));
    offerUndo(targets);
  }

  /* ------------------------------------------------ Fixes on a failed run */

  /** The failed run again, as it was (or smaller, or decoding in tiles); the viewer closes onto the new tile. */
  async function retryFailed(item: GalleryItem, options: RetryOptions = {}) {
    setActive(null);
    await runGeneration(retryRequest(item, options));
  }

  /** Out of memory: let ComfyUI unload what it holds (it does so between runs), then run it again. */
  async function freeMemoryAndRetry(item: GalleryItem) {
    const response = await apiFetch("/api/comfy/free", { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      showToast("Couldn’t reach ComfyUI to free its memory", "error", { action: { label: "Try again", onClick: () => freeMemoryAndRetry(item) } });
      return;
    }
    await retryFailed(item, { tiledDecode: Boolean(item.failure?.retry?.tiledDecode) });
  }

  /** A damaged catalog file: fetch it again, and say where to watch it. */
  async function redownloadDamaged(item: GalleryItem) {
    const download = item.failure?.redownload;
    if (!download) return;
    try {
      await downloadActions.replace(download.id);
      showToast(`Downloading ${download.label} again. Generate when it’s done.`, "default");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn’t start the download", "error");
    }
  }

  /** A file ComfyUI no longer lists: look again, so the pickers show what is really there. */
  function rescanModels() {
    refreshModels?.(true);
    showToast("Rescanning models", "default");
  }

  const failureFixes = { retry: retryFailed, freeMemoryAndRetry, redownload: redownloadDamaged, rescan: rescanModels };

  return { generate, cancelJob, cancelQueue, clearGallery, clearFailedItems, resetAllSettings, clearAllCache, openOutputFolder, deleteItem, deleteItems, failureFixes };
}

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { apiJson, serverClockOffset } from './api';
import { clientJobUuid } from './format';
import { dedupeGalleryItems } from './gallery';
import { clearLoraLibrary } from './lora-storage';
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
    referenceAssets, textEncoder, textEncoders, vae, clipType, weightDtype, width, visibleGallery, outputDir, generateDisabledReason, comfyOffline, comfyRestarting
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

  async function generate() {
    if (generatePostingRef.current) return;
    if (comfyRestarting) {
      showToast("ComfyUI is restarting. Generate again once it’s back, in a few seconds.");
      return;
    }
    if (comfyOffline) {
      showToast("ComfyUI isn’t reachable, so nothing was sent. Start it, then try again.", "error");
      return;
    }
    if (!prompt.trim()) {
      showToast("Enter a prompt to generate", "error");
      return;
    }
    if (!currentProfile) {
      showToast(generateDisabledReason || "Choose a workflow first", "error");
      return;
    }
    if (missingRequiredReference) {
      showToast("Add the required reference image", "error");
      return;
    }
    if (generateDisabled) {
      showToast(generateDisabledReason ? `${generateDisabledReason}. Open Set up in the workflow menu.` : "This model needs files first. Open Set up in the workflow menu.", "error");
      return;
    }
    // Asked before anything is sent, so a Hidden prompt never runs in the open.
    if (hiddenSpace && !hidden.ensureReady({ kind: "generate" })) return;
    generatePostingRef.current = true;
    const optimisticJobIds: string[] = [];
    try {
      const effectiveCount = mode === "image" && currentProfile?.capabilities?.variations === false ? 1 : count;
      const imageRuns = mode === "image" && prefs.variationQueueMode === "separate" ? effectiveCount : 1;
      const requestCount = mode === "image" && prefs.variationQueueMode === "separate" ? 1 : effectiveCount;
      const startMessage = mode === "image"
        ? prefs.variationQueueMode === "separate" && effectiveCount > 1
          ? `Started ${effectiveCount} separate generations`
          : `Started ${effectiveCount} image${effectiveCount === 1 ? "" : "s"}`
        : "Started video";
      setStatus(startMessage);

      const requestBody = {
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
        loras,
        referenceAssets: (referenceAssets || []).map(({ slot, asset }: any) => ({ slot, assetId: asset.id })),
        startImageId: canUseStartImage ? startImageId : "",
        startImageName,
        privateVault: Boolean(hiddenSpace)
      };
      const queuedJobs: string[] = [];
      for (let index = 0; index < imageRuns; index += 1) {
        const clientJobId = clientJobUuid();
        optimisticJobIds.push(clientJobId);
        // Separate runs from one pinned seed would all be the same picture; step it per run.
        const runSeed = imageRuns > 1 && /^\d+$/.test(String(seed || "").trim()) ? String(Number(seed) + index) : seed;
        const optimisticBody = { ...requestBody, seed: runSeed, count: requestCount, startImageId: canUseStartImage ? startImageId : "" };
        const optimisticItems = pendingItemsFor(clientJobId, optimisticBody);
        galleryUpsert(optimisticItems);
        if (prefs.zenMode) setZenSelectedId(optimisticItems[0].id);
        await nextPaint();
        const { jobId, items, hidden: wentHidden } = await apiJson<{ jobId: string; items: GalleryItem[]; hidden?: boolean; revision?: number }>("/api/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...requestBody, seed: runSeed, clientJobId, count: requestCount, startImage: canUseStartImage && !startImageId ? startImage : "" })
        });
        queuedJobs.push(jobId);
        if (wentHidden && !hiddenSpace) {
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
            galleryPatch((item: GalleryItem) => item.jobId === jobId && item.status === "pending" ? { ...item, status: "error", optimistic: false, filename: "Lost contact with HEISS UI. The image may still finish; reload to check." } : item);
            return null;
          }
          if (job.status === "missing") {
            galleryPatch((item: GalleryItem) => item.jobId === jobId ? { ...item, status: "error", optimistic: false, filename: "Generation interrupted" } : item);
            return job;
          }
          if (job.status === "error") {
            const message = job.error || "Generation failed";
            galleryPatch((item: GalleryItem) => item.jobId === jobId ? { ...item, status: "error", optimistic: false, filename: message } : item);
            showToast(message, "error");
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
          if (job.progress?.max) {
            setStatus(`Rendering ${job.progress.value}/${job.progress.max}`);
          } else {
            setStatus(job.status === "queued" ? "Queued" : "Started");
          }
        }
      }));
      await (loadGalleryDelta ? loadGalleryDelta() : loadGallery());
      if (prefs.zenMode && prefs.followLatest && !hiddenSpace) {
        const data = await apiJson<GalleryPayload>(`/api/gallery?type=${encodeURIComponent(mode)}&limit=80`).catch(() => null);
        const outputs = payloadItems(data).filter((item: GalleryItem) => item.status !== "canceled");
        const latest = outputs.find((item: GalleryItem) => item.type === mode && item.status === "done");
        if (latest) {
          galleryUpsert(outputs);
          setZenSelectedId(latest.id);
        }
      }
      setStatus(mode === "image" ? "Finished. Your images are in the gallery." : "Finished. Your video is in the gallery.");
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
      description: many ? "They belong to one run, so they stop together. Nothing from it is saved." : "It won’t be saved.",
      action: many ? "Stop all" : "Stop generation",
      destructive: true
    })) return;
    const response = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      showToast("Couldn’t stop it. It may still be running in ComfyUI.", "error");
      return;
    }
    galleryRemove([jobId]);
    setStatus("Ready");
  }

  async function cancelQueue() {
    if (!await confirmAction({"title": "Stop all generations?", "description": "All queued and running generations and upscales will be canceled.", "action": "Stop all", "destructive": true})) return;
    const response = await fetch("/api/queue/cancel", { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      showToast("Couldn’t stop the queue. Generations may still be running in ComfyUI.", "error");
      return;
    }
    galleryRemoveWhere((item: GalleryItem) => item.status === "pending" || item.status === "canceled");
    setStatus("Ready");
  }

  async function clearGallery() {
    const where = outputDir ? ` in ${outputDir}` : " in ComfyUI’s output folder";
    if (!await confirmAction({
      title: "Delete every finished image?",
      description: `The files${where} are deleted from disk, not only from the gallery. This can’t be undone. Hidden isn’t affected.`,
      action: "Delete all",
      destructive: true,
      irreversible: true
    })) return;
    const data = await apiJson<GalleryPayload & { files?: { deleted: number; skipped: number } }>("/api/gallery/clear", { method: "POST" }).catch(() => null);
    if (!data) {
      showToast("Couldn’t clear the gallery. Nothing was deleted.", "error");
      return;
    }
    const items = payloadItems(data);
    setGallery(items.filter((item: GalleryItem) => item.status !== "canceled"));
    const deleted = data.files?.deleted || 0;
    showToast(deleted ? `Deleted ${deleted} file${deleted === 1 ? "" : "s"}` : "Gallery cleared", "success");
    setStatus("Ready");
  }

  async function clearFailedItems() {
    if (!await confirmAction({"title": "Clear failed generations?", "description": "Removes failed and interrupted items from your gallery.", "action": "Clear failed", "destructive": true})) return;
    const data = await apiJson<GalleryPayload>("/api/gallery/errors/clear", { method: "POST" }).catch(() => null);
    if (!data) { showToast("Couldn’t clear failed generations", "error"); return; }
    setGallery(payloadItems(data).filter((item: GalleryItem) => item.status !== "canceled"));
    setStatus("Ready");
  }

  async function resetAllSettings() {
    if (!await confirmAction({"title": "Reset all settings?", "description": "Your preferences, prompt drafts and saved LoRA stacks and strengths are deleted, here and on the server. The app reloads. This can’t be undone.", "action": "Reset settings", "destructive": true, "irreversible": true})) return;
    localStorage.removeItem("heiss-ui-draft");
    localStorage.removeItem("heiss-ui-prefs");
    localStorage.removeItem("j-ai-studio-draft");
    localStorage.removeItem("j-ai-studio-prefs");
    clearLoraLibrary();
    // The server keeps its own copy of LoRA strengths and stacks; clear it too,
    // or the next load would restore everything the dialog said was cleared.
    await fetch("/api/loras", { method: "DELETE" }).catch(() => null);
    if ("caches" in window) {
      await caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))).catch(() => null);
    }
    window.location.reload();
  }

  async function clearAllCache() {
    if (!await confirmAction({"title": "Clear cache?", "description": "Clear cached previews and free ComfyUI memory. Finished gallery items will stay.", "action": "Clear cache", "destructive": false})) return;
    if ("caches" in window) {
      await caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))).catch(() => null);
    }
    const data = await fetch("/api/cache/clear", { method: "POST" }).then((res) => res.ok ? res.json() : null).catch(() => null);
    if (!data) { showToast("Couldn’t clear ComfyUI’s cache", "error"); return; }
    setGallery(payloadItems(data).filter((item: GalleryItem) => item.status !== "canceled"));
    showToast("Cache cleared", "success");
    setStatus("Ready");
  }

  async function openOutputFolder() {
    const response = await fetch("/api/open-output-folder", { method: "POST" }).catch(() => null);
    if (!response?.ok) showToast("Could not open folder", "error");
  }

  // Deletes wait out a short undo window before the file is actually removed.
  const UNDO_MS = 6000;
  const pendingDeletes = useRef(new Map<string, { item: GalleryItem; timer: number }>());

  async function commitDelete(item: GalleryItem) {
    const response = await fetch(`/api/gallery/${encodeURIComponent(item.id)}`, { method: "DELETE", keepalive: true }).catch(() => null);
    if (response?.ok) return;
    // Put it back: the server still has it, and the screen must say so.
    galleryUpsert([item]);
    const reason = await response?.json().then((data: { error?: string }) => data?.error).catch(() => null);
    showToast(reason || "Couldn’t delete it, so it’s back in the gallery.", "error");
  }

  // Leaving the page commits whatever is still waiting; keepalive lets the request finish.
  useEffect(() => {
    const flush = () => {
      for (const { item, timer } of pendingDeletes.current.values()) {
        window.clearTimeout(timer);
        commitDelete(item);
      }
      pendingDeletes.current.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function deleteItem(item: GalleryItem, confirmed = false) {
    if (!confirmed && !await confirmAction(item.privateVault
      ? {"title": "Delete from Hidden?", "description": "This image and its upscale are erased. There’s no other copy.", "action": "Delete", "destructive": true}
      : {"title": "Delete this image?", "description": "The file is deleted from disk, not only from the gallery.", "action": "Delete", "destructive": true})) return;
    // In the viewer, step to the next image rather than closing, so culling a batch stays in place.
    if (active?.id === item.id) {
      const items = ((visibleGallery || []) as GalleryItem[]).filter((entry) => entry.status === "pending" || entry.status === "done" || entry.status === "error");
      const index = items.findIndex((entry) => entry.id === item.id);
      const next = items[index + 1] || items[index - 1];
      setActive(next && next.id !== item.id ? next : null);
    }
    galleryRemove([item.id, item.url].filter(Boolean));
    const timer = window.setTimeout(() => {
      pendingDeletes.current.delete(item.id);
      commitDelete(item);
    }, UNDO_MS);
    pendingDeletes.current.set(item.id, { item, timer });
    toast(item.privateVault ? "Deleted from Hidden" : "Image deleted", {
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          const pending = pendingDeletes.current.get(item.id);
          if (!pending) return;
          window.clearTimeout(pending.timer);
          pendingDeletes.current.delete(item.id);
          galleryUpsert([item]);
        }
      }
    });
  }

  return { generate, cancelJob, cancelQueue, clearGallery, clearFailedItems, resetAllSettings, clearAllCache, openOutputFolder, deleteItem };
}

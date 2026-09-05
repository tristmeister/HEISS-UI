import { apiJson } from './api';
import { clientJobUuid } from './format';
import { dedupeGalleryItems } from './gallery';
import type { GalleryItem, Job } from './types';

type GalleryPayload = { items?: GalleryItem[]; outputs?: GalleryItem[] };

function payloadItems(data: GalleryPayload | null | undefined) {
  return data?.items || data?.outputs || [];
}

export function useGenerationActions(view: any) {
  const {
    active, canUseStartImage, confirmAction, count, currentProfile, denoise,
    frames, fps, generateDisabled, generatePostingRef, height, loadGallery, loadGalleryDelta, loras, mode,
    model, negative, prefs, privateGeneration, prompt, sampler, scheduler, seed, setActive, setGallery,
    upsertGalleryItems, removeGalleryItems, removeGalleryItemsWhere, patchGalleryItems, setStatus, setZenSelectedId, showToast, startImage, startImageId, startImageName, steps, cfg,
    textEncoder, vae, clipType, weightDtype, width
  } = view;
  const galleryUpsert = upsertGalleryItems || ((items: GalleryItem[]) => setGallery((current: GalleryItem[]) => dedupeGalleryItems([...items, ...current])));
  const galleryRemove = removeGalleryItems || ((keys: string[]) => setGallery((current: GalleryItem[]) => current.filter((item: GalleryItem) => !keys.includes(item.id) && !keys.includes(item.url) && (!item.jobId || !keys.includes(item.jobId)))));
  const galleryRemoveWhere = removeGalleryItemsWhere || ((predicate: (item: GalleryItem) => boolean) => setGallery((current: GalleryItem[]) => current.filter((item: GalleryItem) => !predicate(item))));
  const galleryPatch = patchGalleryItems || ((update: (item: GalleryItem) => GalleryItem) => setGallery((current: GalleryItem[]) => current.map(update)));

  function pendingItemsFor(jobId: string, body: any): GalleryItem[] {
    const itemCount = body.kind === "image" ? Math.max(1, Math.min(8, Number(body.count || 1))) : 1;
    const createdAt = new Date().toISOString();
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
      referenceImage: body.startImageId || "",
      referenceImageName: body.startImageName || "",
      startImageId: body.startImageId || "",
      settings: { workflow: body.workflow || "", profileId: body.profileId || "", count: itemCount }
    }));
  }

  function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function generate() {
    if (generatePostingRef.current) return;
    if (!prompt.trim()) {
      showToast("Prompt is required", "error");
      return;
    }
    if (!currentProfile) {
      showToast("Choose a supported model first", "error");
      return;
    }
    if (generateDisabled) {
      showToast("Model setup is missing required files", "error");
      return;
    }
    generatePostingRef.current = true;
    const optimisticJobIds: string[] = [];
    try {
      const imageRuns = mode === "image" && prefs.variationQueueMode === "separate" ? count : 1;
      const requestCount = mode === "image" && prefs.variationQueueMode === "separate" ? 1 : count;
      const startMessage = mode === "image"
        ? prefs.variationQueueMode === "separate" && count > 1
          ? `Started ${count} separate generations`
          : `Started ${count} image${count === 1 ? "" : "s"}`
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
        count,
        frames,
        fps,
        loras,
        startImageId: canUseStartImage ? startImageId : "",
        startImageName,
        privateVault: Boolean(privateGeneration)
      };
      const queuedJobs: string[] = [];
      for (let index = 0; index < imageRuns; index += 1) {
        const clientJobId = clientJobUuid();
        optimisticJobIds.push(clientJobId);
        const optimisticBody = { ...requestBody, count: requestCount, startImageId: canUseStartImage ? startImageId : "" };
        const optimisticItems = pendingItemsFor(clientJobId, optimisticBody);
        galleryUpsert(optimisticItems);
        if (prefs.zenMode) setZenSelectedId(optimisticItems[0].id);
        await nextPaint();
        const { jobId, items } = await apiJson<{ jobId: string; items: GalleryItem[]; revision?: number }>("/api/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...requestBody, clientJobId, count: requestCount, startImage: canUseStartImage && !startImageId ? startImage : "" })
        });
        queuedJobs.push(jobId);
        if (items?.length) {
          galleryUpsert(items);
          if (prefs.zenMode) setZenSelectedId(items[0].id);
        }
      }
      generatePostingRef.current = false;

      await Promise.all(queuedJobs.map(async (jobId) => {
        while (true) {
          await new Promise((resolve) => setTimeout(resolve, 1600));
          const job: Job = await apiJson<Job>(`/api/jobs/${jobId}`);
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
          if (job.status === "done" || job.status === "canceled") return job;
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
            setStatus(job.status === "queued" ? "Queued" : "Rendering on the right");
          }
        }
      }));
      await (loadGalleryDelta ? loadGalleryDelta() : loadGallery());
      if (prefs.zenMode && prefs.followLatest) {
        const data = await apiJson<GalleryPayload>(`/api/gallery?type=${encodeURIComponent(mode)}&limit=80`).catch(() => null);
        const outputs = payloadItems(data).filter((item: GalleryItem) => item.status !== "canceled");
        const latest = outputs.find((item: GalleryItem) => item.type === mode && item.status === "done");
        if (latest) {
          galleryUpsert(outputs);
          setZenSelectedId(latest.id);
        }
      }
      setStatus("Ready");
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
    if (!await confirmAction({"title": "Stop generation?", "description": "This stops the current generation before it finishes.", "action": "Stop generation", "destructive": true})) return;
    galleryRemove([jobId]);
    await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" }).catch(() => null);
    setStatus("Ready");
  }

  async function cancelQueue() {
    if (!await confirmAction({"title": "Stop all generations?", "description": "All queued and running generations will be canceled.", "action": "Stop all", "destructive": true})) return;
    galleryRemoveWhere((item: GalleryItem) => item.status === "pending" || item.status === "canceled");
    await fetch("/api/queue/cancel", { method: "POST" }).catch(() => null);
    setStatus("Ready");
  }

  async function clearGallery() {
    if (!await confirmAction({"title": "Clear gallery?", "description": "Finished outputs will be removed from this app\u2019s gallery.", "action": "Clear gallery", "destructive": true})) return;
    const data = await apiJson<GalleryPayload>("/api/gallery/clear", { method: "POST" }).catch(() => null);
    const items = payloadItems(data);
    if (data) setGallery(items.filter((item: GalleryItem) => item.status !== "canceled"));
    setStatus("Ready");
  }

  async function clearFailedItems() {
    if (!await confirmAction({"title": "Clear failed generations?", "description": "Remove failed and interrupted entries from your gallery.", "action": "Clear failed", "destructive": true})) return;
    const data = await apiJson<GalleryPayload>("/api/gallery/errors/clear", { method: "POST" }).catch(() => null);
    const items = payloadItems(data);
    if (data) setGallery(items.filter((item: GalleryItem) => item.status !== "canceled"));
    setStatus("Ready");
  }

  async function resetAllSettings() {
    if (!await confirmAction({"title": "Reset settings?", "description": "Your saved preferences and prompt drafts will be cleared. The app will reload.", "action": "Reset settings", "destructive": true})) return;
    localStorage.removeItem("j-ai-studio-draft");
    localStorage.removeItem("j-ai-studio-prefs");
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
    const data = await fetch("/api/cache/clear", { method: "POST" }).then((res) => res.json()).catch(() => null);
    const items = payloadItems(data);
    if (data) setGallery(items.filter((item: GalleryItem) => item.status !== "canceled"));
    setStatus("Ready");
  }

  async function openOutputFolder() {
    const response = await fetch("/api/open-output-folder", { method: "POST" }).catch(() => null);
    if (!response?.ok) showToast("Could not open folder", "error");
  }

  async function deleteItem(item: GalleryItem, confirmed = false) {
    if (!confirmed && !await confirmAction({"title": "Delete generation?", "description": "This output will be removed from your gallery.", "action": "Delete generation", "destructive": true})) return;
    galleryRemove([item.id, item.url].filter(Boolean));
    if (active?.id === item.id) setActive(null);
    const response = await fetch(`/api/gallery/${encodeURIComponent(item.id)}`, { method: "DELETE" }).catch(() => null);
    showToast(response?.ok ? "Deleted from gallery" : "Delete failed", response?.ok ? "success" : "error");
  }

  return { generate, cancelJob, cancelQueue, clearGallery, clearFailedItems, resetAllSettings, clearAllCache, openOutputFolder, deleteItem };
}

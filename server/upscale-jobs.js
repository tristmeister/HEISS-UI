import { comfy, comfyUrl, normalizeComfyError } from "./comfy.js";
import { gallery, outputsFrom, updateGalleryJob } from "./gallery-store.js";
import { jobs, setTerminalJob } from "./jobs.js";
import { upscaleGraph } from "./upscale.js";
import { forgetComfyRun } from "./hidden-traces.js";
import { attachVaultUpscale, patchVaultItem, setRuntimeUpscale } from "./vault.js";

export function findUpscaleTarget(id) {
  return gallery.find((item) => item.id === id || item.url === id) || null;
}

function patchUpscale(itemId, patch, options = {}) {
  const item = findUpscaleTarget(itemId);
  if (!item) return false;
  return updateGalleryJob(item.id, { upscale: { ...(item.upscale || {}), ...patch } }, options);
}

/** Where an upscale's state and result go: the gallery item, by default. */
function galleryTarget(itemId) {
  return {
    patch: (patch, options) => patchUpscale(itemId, patch, options),
    async finish(output, plan) {
      patchUpscale(itemId, {
        status: "done",
        progress: null,
        url: output.url,
        thumbnailUrl: output.thumbnailUrl || "",
        outputName: output.filename,
        width: plan.estimatedWidth,
        height: plan.estimatedHeight,
        scale: plan.scale,
        completedAt: new Date().toISOString(),
        error: ""
      });
      updateGalleryJob(itemId, { upscaleActive: true });
    }
  };
}

/**
 * A Hidden item's upscale: progress in memory, the result encrypted straight
 * into the item, and ComfyUI's copies of both images gone once it lands.
 */
export function hiddenTarget(itemId, key, inputNames = []) {
  let promptId = "";
  const forget = () => forgetComfyRun({ promptIds: [promptId], inputNames }).catch(() => null);
  return {
    hidden: true,
    setPromptId(value) { promptId = value; },
    patch(patch) {
      if (patch.status === "error" || patch.status === "canceled") {
        setRuntimeUpscale(itemId, null);
        // An earlier upscale that worked stays; this attempt only leaves its reason.
        try {
          patchVaultItem(key, itemId, (item) => ({
            upscale: item.upscale?.assetFile
              ? { ...item.upscale, error: patch.error || "" }
              : { status: patch.status, error: patch.error || "" }
          }));
        } catch { /* the item may be gone */ }
        forget();
        return;
      }
      setRuntimeUpscale(itemId, patch);
    },
    async finish(output, plan) {
      try {
        await attachVaultUpscale(key, itemId, output, {
          quality: plan.quality,
          scale: plan.scale,
          width: plan.estimatedWidth,
          height: plan.estimatedHeight,
          completedAt: new Date().toISOString(),
          error: ""
        });
      } finally {
        setRuntimeUpscale(itemId, null);
        await forget();
      }
    }
  };
}

function watchUpscaleProgress(clientId, target, promptId) {
  let socket;
  try {
    socket = new WebSocket(`${comfyUrl.replace(/^http/i, "ws")}/ws?clientId=${encodeURIComponent(clientId)}`);
  } catch {
    return null;
  }
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try {
      const message = JSON.parse(event.data);
      const data = message.data || {};
      if (data.prompt_id && data.prompt_id !== promptId) return;
      if (message.type === "progress") {
        target.patch({ status: "running", progress: { value: Number(data.value || 0), max: Number(data.max || 0) } }, { persist: false });
      }
      if (message.type === "execution_interrupted") {
        target.patch({ status: "canceled", progress: null });
      }
      if (message.type === "execution_error") {
        target.patch({ status: "error", progress: null, error: normalizeComfyError(data.exception_message || "Upscale failed") });
      }
    } catch {
      // Ignore malformed frames from Comfy extensions.
    }
  });
  return socket;
}

export async function runUpscaleJob(jobId, body, info, target = galleryTarget(body.galleryItemId)) {
  let socket = null;
  try {
    const { graph, plan } = upscaleGraph(body, info);
    target.patch({ status: "running", jobId, quality: plan.quality, faceDetail: Boolean(body.faceDetail), scale: plan.scale, startedAt: new Date().toISOString(), error: "" });
    const queued = await comfy("/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: jobId, extra_data: { preview_method: "none" } })
    });
    // Canceled while ComfyUI was taking the prompt: take it back out instead of running it.
    if (jobs.get(jobId)?.terminalAt) {
      await comfy("/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ delete: [queued.prompt_id] }) }).catch(() => null);
      await comfy("/interrupt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt_id: queued.prompt_id }) }).catch(() => null);
      target.setPromptId?.(queued.prompt_id);
      target.patch({ status: "canceled", progress: null });
      return;
    }
    jobs.set(jobId, { ...jobs.get(jobId), status: "running", promptId: queued.prompt_id });
    target.setPromptId?.(queued.prompt_id);
    socket = watchUpscaleProgress(jobId, target, queued.prompt_id);
    while (true) {
      const state = jobs.get(jobId)?.status;
      if (state === "canceling" || state === "canceled") {
        target.patch({ status: "canceled", progress: null });
        setTerminalJob(jobId, { status: "canceled" });
        socket?.close();
        return;
      }
      const history = await comfy(`/history/${queued.prompt_id}`);
      if (history[queued.prompt_id]) {
        const outputs = outputsFrom(history[queued.prompt_id]);
        const output = outputs.find((item) => item.type === "image");
        if (!output) throw new Error("The upscale finished without producing an image.");
        await target.finish(output, plan);
        setTerminalJob(jobId, { status: "done", outputs: target.hidden ? [] : [output] });
        socket?.close();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1600));
    }
  } catch (error) {
    const message = normalizeComfyError(error.message);
    target.patch({ status: "error", progress: null, error: message });
    setTerminalJob(jobId, { status: "error", error: message });
    socket?.close();
  }
}

export function toggleUpscaleView(itemId, active) {
  const item = findUpscaleTarget(itemId);
  if (!item) throw new Error("That image is no longer in the gallery.");
  if (!item.upscale?.url) throw new Error("This image has no upscale to switch to.");
  const next = typeof active === "boolean" ? active : !item.upscaleActive;
  updateGalleryJob(item.id, { upscaleActive: next });
  return { ...item, upscaleActive: next };
}

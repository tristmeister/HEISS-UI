import { comfy, comfyUrl, normalizeComfyError } from "./comfy.js";
import { gallery, outputsFrom, updateGalleryJob } from "./gallery-store.js";
import { jobs, setTerminalJob } from "./jobs.js";
import { upscaleGraph } from "./upscale.js";

export function findUpscaleTarget(id) {
  return gallery.find((item) => item.id === id || item.url === id) || null;
}

function patchUpscale(itemId, patch, options = {}) {
  const item = findUpscaleTarget(itemId);
  if (!item) return false;
  return updateGalleryJob(item.id, { upscale: { ...(item.upscale || {}), ...patch } }, options);
}

function watchUpscaleProgress(clientId, itemId, promptId) {
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
        patchUpscale(itemId, { status: "running", progress: { value: Number(data.value || 0), max: Number(data.max || 0) } }, { persist: false });
      }
      if (message.type === "execution_interrupted") {
        patchUpscale(itemId, { status: "canceled", progress: null });
      }
      if (message.type === "execution_error") {
        patchUpscale(itemId, { status: "error", progress: null, error: normalizeComfyError(data.exception_message || "Upscale failed") });
      }
    } catch {
      // Ignore malformed frames from Comfy extensions.
    }
  });
  return socket;
}

export async function runUpscaleJob(jobId, body, info) {
  const itemId = body.galleryItemId;
  let socket = null;
  try {
    const { graph, plan } = upscaleGraph(body, info);
    patchUpscale(itemId, { status: "running", jobId, quality: plan.quality, faceDetail: Boolean(body.faceDetail), scale: plan.scale, startedAt: new Date().toISOString(), error: "" });
    const queued = await comfy("/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: jobId, extra_data: { preview_method: "none" } })
    });
    jobs.set(jobId, { ...jobs.get(jobId), status: "running", promptId: queued.prompt_id });
    socket = watchUpscaleProgress(jobId, itemId, queued.prompt_id);
    while (true) {
      const state = jobs.get(jobId)?.status;
      if (state === "canceling" || state === "canceled") {
        patchUpscale(itemId, { status: "canceled", progress: null });
        setTerminalJob(jobId, { status: "canceled" });
        socket?.close();
        return;
      }
      const history = await comfy(`/history/${queued.prompt_id}`);
      if (history[queued.prompt_id]) {
        const outputs = outputsFrom(history[queued.prompt_id]);
        const output = outputs.find((item) => item.type === "image");
        if (!output) throw new Error("The upscale finished without producing an image.");
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
        setTerminalJob(jobId, { status: "done", outputs: [output] });
        socket?.close();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1600));
    }
  } catch (error) {
    const message = normalizeComfyError(error.message);
    patchUpscale(itemId, { status: "error", progress: null, error: message });
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

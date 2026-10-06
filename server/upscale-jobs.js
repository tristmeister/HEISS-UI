import crypto from "node:crypto";
import { comfy, comfyUrl, normalizeComfyError } from "./comfy.js";
import { cancelPrompt, promptTracker } from "./comfy-queue.js";
import { gallery, outputsFrom, updateGalleryJob } from "./gallery-store.js";
import { jobs, setTerminalJob } from "./jobs.js";
import { faceDetailSource, normalizeQuality, upscaleGraph, upscalePlan, upscaleStatus } from "./upscale.js";
import { stageUpscaleSource } from "./reference-assets.js";
import { forgetComfyRun } from "./hidden-traces.js";
import { releaseHiddenRun, rememberHiddenRun } from "./hidden-runs.js";
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
 * into the item, and ComfyUI's copies of both images gone once it lands. Like
 * a Hidden generation it is written down before ComfyUI gets it
 * (hidden-runs.js), so one that ends any other way is finished from there.
 */
export function hiddenTarget(itemId, key, inputNames = []) {
  let promptId = "";
  let details = null;
  const forget = async ({ stored = false } = {}) => {
    const historyGone = stored ? await forgetComfyRun({ promptIds: [promptId], inputNames }).catch(() => false) : false;
    releaseHiddenRun(promptId, { clean: historyGone, stored });
  };
  return {
    hidden: true,
    begin(id, plan) {
      promptId = id;
      details = { kind: "upscale", itemId, state: { quality: plan.quality, scale: plan.scale, width: plan.estimatedWidth, height: plan.estimatedHeight }, inputNames };
      rememberHiddenRun(key, id, details);
    },
    setPromptId(value) {
      // An older ComfyUI names the run itself.
      if (details && value && value !== promptId) {
        rememberHiddenRun(key, value, details);
        releaseHiddenRun(promptId, { clean: true });
      }
      promptId = value;
    },
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
      let stored = false;
      try {
        await attachVaultUpscale(key, itemId, output, {
          quality: plan.quality,
          scale: plan.scale,
          width: plan.estimatedWidth,
          height: plan.estimatedHeight,
          completedAt: new Date().toISOString(),
          error: ""
        });
        stored = true;
      } finally {
        setRuntimeUpscale(itemId, null);
        await forget({ stored });
      }
    }
  };
}

function watchUpscaleProgress(clientId, target, promptId, alive = () => {}) {
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
      alive();
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
    const hiddenPromptId = target.hidden ? crypto.randomUUID() : "";
    if (hiddenPromptId) target.begin(hiddenPromptId, plan);
    const queued = await comfy("/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: jobId, ...(hiddenPromptId ? { prompt_id: hiddenPromptId } : {}), extra_data: { preview_method: "none", ...(hiddenPromptId ? { heiss_hidden: true } : {}) } })
    });
    // Canceled while ComfyUI was taking the prompt: take it back out instead of running it.
    if (jobs.get(jobId)?.terminalAt) {
      await cancelPrompt(queued.prompt_id).catch(() => null);
      target.setPromptId?.(queued.prompt_id);
      target.patch({ status: "canceled", progress: null });
      return;
    }
    jobs.set(jobId, { ...jobs.get(jobId), status: "running", promptId: queued.prompt_id });
    target.setPromptId?.(queued.prompt_id);
    const tracker = promptTracker(queued.prompt_id);
    socket = watchUpscaleProgress(jobId, target, queued.prompt_id, tracker.alive);
    while (true) {
      const state = jobs.get(jobId)?.status;
      if (state === "canceling" || state === "canceled") {
        await cancelPrompt(queued.prompt_id).catch(() => null);
        target.patch({ status: "canceled", progress: null });
        setTerminalJob(jobId, { status: "canceled" });
        socket?.close();
        return;
      }
      // A blip in the connection is waited out; a minute of silence or a dropped run ends it.
      const checked = await tracker.check();
      if (checked.state === "reconnecting") {
        await new Promise((resolve) => setTimeout(resolve, checked.delayMs));
        continue;
      }
      if (checked.state === "done") {
        const outputs = outputsFrom(checked.entry);
        const output = outputs.find((item) => item.type === "image");
        if (!output) throw new Error("The upscale ended without an image.");
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

/**
 * Queues one image's upscale, already staged in ComfyUI as `imageName`; the
 * route behind the upscale arrow and Smart upscale after a run both start here.
 */
export function startUpscale({ item, imageName, quality, faceDetail = false, info, customWorkflow = null, hiddenKey = null }) {
  const jobId = crypto.randomUUID();
  const body = {
    galleryItemId: item.id,
    imageName,
    quality,
    faceDetail,
    width: Number(item.width || 0),
    height: Number(item.height || 0),
    prompt: item.prompt || "",
    ...faceDetailSource(item, customWorkflow)
  };
  const plan = upscalePlan(body);
  jobs.set(jobId, { status: "queued", kind: "upscale", galleryItemId: item.id, startedAt: Date.now(), outputs: [] });
  setTimeout(() => hiddenKey
    ? runUpscaleJob(jobId, body, info, hiddenTarget(item.id, hiddenKey, [imageName]))
    : runUpscaleJob(jobId, body, info), 0);
  return { jobId, plan };
}

/**
 * Smart upscale: a run asked for its images at 2K or 4K, so each one upscales
 * the moment the run finishes, here on the server, whether or not any page is
 * still open. An image whose upscale cannot start says why on its tile.
 */
export async function upscaleFinishedRun(items, { quality, faceDetail = false, info, customWorkflow = null, hiddenKey = null }) {
  const normalized = normalizeQuality(quality);
  const status = upscaleStatus(info, normalized);
  const fail = (item, error) => {
    if (hiddenKey) {
      try { patchVaultItem(hiddenKey, item.id, { upscale: { status: "error", quality: normalized, error } }); } catch { /* the item may be gone */ }
    }
    else patchUpscale(item.id, { status: "error", progress: null, quality: normalized, error });
  };
  const images = items.filter((item) => item?.type === "image" && item.id);
  if (!status.ready) {
    const error = status.nodesInstalled ? "Smart upscale’s SeedVR2 model isn’t installed yet." : "Smart upscale needs the SeedVR2 nodes in ComfyUI.";
    images.forEach((item) => fail(item, error));
    return;
  }
  // The face pass is a nicety: without its nodes the upscale still runs.
  const withFaces = Boolean(faceDetail && status.faceDetail?.nodesInstalled);
  for (const item of images) {
    try {
      const imageName = await stageUpscaleSource(item, hiddenKey);
      if (!imageName) throw new Error("ComfyUI didn’t accept the image.");
      startUpscale({ item, imageName, quality: normalized, faceDetail: withFaces, info, customWorkflow, hiddenKey });
    } catch (error) {
      fail(item, `Couldn’t start Smart upscale: ${normalizeComfyError(error.message)}`);
    }
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

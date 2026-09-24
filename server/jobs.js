import { comfy, comfyUrl, normalizeComfyError } from './comfy.js';
import { describeFailure } from './failures.js';
import { rememberMissingParts } from './model-families.js';
import { imageGraph, videoGraph } from './graphs.js';
import { gallery, outputsFrom, removeGalleryJob, replaceGalleryJob, updateGalleryJob, updateGalleryJobPreviews } from './gallery-store.js';
import { forgetComfyRun } from './hidden-traces.js';
import { storeHiddenOutputs } from './vault.js';
import { markWorkflowUsed } from './workflow-catalog.js';

export const jobs = new Map();
const previewSlots = new Map();
const terminalCleanupTimers = new Map();
const previewIntervalMs = Math.max(100, Number(process.env.HEISS_PREVIEW_INTERVAL_MS || process.env.JAI_PREVIEW_INTERVAL_MS || 500));
const terminalJobTtlMs = Math.max(10_000, Number(process.env.HEISS_TERMINAL_JOB_TTL_MS || process.env.JAI_TERMINAL_JOB_TTL_MS || 5 * 60 * 1000));

function clearPreviewSlot(id) {
  const slot = previewSlots.get(id);
  if (slot?.timer) clearTimeout(slot.timer);
  previewSlots.delete(id);
}

export function setTerminalJob(id, patch) {
  clearPreviewSlot(id);
  const current = jobs.get(id) || {};
  const next = {
    ...current,
    ...patch,
    preview: undefined,
    previews: undefined,
    prompt: undefined,
    items: undefined,
    vaultKey: null,
    terminalAt: Date.now()
  };
  jobs.set(id, next);
  const previousTimer = terminalCleanupTimers.get(id);
  if (previousTimer) clearTimeout(previousTimer);
  const timer = setTimeout(() => {
    if (jobs.get(id)?.terminalAt === next.terminalAt) jobs.delete(id);
    terminalCleanupTimers.delete(id);
  }, terminalJobTtlMs);
  timer.unref?.();
  terminalCleanupTimers.set(id, timer);
  return next;
}

function binaryPreviewBuffer(data) {
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (Buffer.isBuffer(data)) return data;
  return null;
}

async function previewBuffer(data) {
  const buffer = binaryPreviewBuffer(data);
  if (buffer) return buffer;
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return Buffer.from(await data.arrayBuffer());
  }
  return null;
}

function applyPreviewBuffer(id, buffer) {
  if (!buffer || buffer.length < 8) return false;
  const eventType = buffer.readUInt32BE(0);
  if (eventType !== 1 && eventType !== 4) return false;
  let mime = "image/jpeg";
  let image = buffer.subarray(8);
  if (eventType === 1) {
    const imageType = buffer.readUInt32BE(4);
    mime = imageType === 2 ? "image/png" : "image/jpeg";
  } else {
    const metadataLength = buffer.readUInt32BE(4);
    const metadataStart = 8;
    const imageStart = metadataStart + metadataLength;
    if (imageStart > buffer.length) return true;
    try {
      const metadata = JSON.parse(buffer.subarray(metadataStart, imageStart).toString("utf8"));
      if (typeof metadata.image_type === "string") mime = metadata.image_type;
    } catch {
      // Keep default mime when metadata is not parseable.
    }
    image = buffer.subarray(imageStart);
  }
  if (image.length < 16) return true;
  const preview = `data:${mime};base64,${image.toString("base64")}`;
  const current = jobs.get(id) || {};
  // A Hidden run's previews live in memory only and are shown in Hidden alone.
  jobs.set(id, { ...current, preview });
  if ((current.items?.length || 1) <= 1) updateGalleryJob(id, { preview }, { persist: false });
  return true;
}

function queueLatestPreview(id, buffer) {
  if (!buffer) return;
  const current = previewSlots.get(id);
  if (current) {
    current.buffer = buffer;
    return;
  }
  const slot = { buffer, timer: null };
  slot.timer = setTimeout(() => {
    previewSlots.delete(id);
    applyPreviewBuffer(id, slot.buffer);
  }, previewIntervalMs);
  slot.timer.unref?.();
  previewSlots.set(id, slot);
}

function outputsFromExecutedOutput(output = {}) {
  return outputsFrom({ outputs: { executed: output } });
}

function applyExecutedOutputPreviews(id, output) {
  const outputs = outputsFromExecutedOutput(output);
  if (!outputs.length) return false;
  const previews = outputs.map((item) => item.url);
  const current = jobs.get(id) || {};
  const nextPreviews = [...(Array.isArray(current.previews) ? current.previews : [])];
  previews.forEach((preview, index) => {
    if (preview) nextPreviews[index] = preview;
  });
  jobs.set(id, { ...current, previews: nextPreviews });
  updateGalleryJobPreviews(id, nextPreviews);
  return true;
}

function openProgressSocket(id) {
  const wsUrl = comfyUrl.replace(/^http/i, "ws");
  let socket;
  try {
    socket = new WebSocket(`${wsUrl}/ws?clientId=${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
  socket.binaryType = "arraybuffer";
  return socket;
}

function waitForSocketOpen(socket) {
  if (!socket || socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", done, { once: true });
    setTimeout(done, 1200);
  });
}

function sendSocketFeatureFlags(socket) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify({ type: "feature_flags", data: { supports_preview_metadata: true } }));
  } catch {
    // Preview frames are optional; generation should still continue.
  }
}

function watchProgress(id, promptId, socket = openProgressSocket(id)) {
  if (!socket) return null;
  socket.addEventListener("message", async (event) => {
    try {
      const buffer = await previewBuffer(event.data);
      if (buffer) {
        queueLatestPreview(id, buffer);
        return;
      }
    } catch {
      // Ignore malformed binary frames.
    }
    if (typeof event.data !== "string") {
      return;
    }
    try {
      const message = JSON.parse(event.data);
      const data = message.data || {};
      if (data.prompt_id && data.prompt_id !== promptId) return;
      const current = jobs.get(id) || {};
      if (message.type === "progress") {
        const progress = { value: Number(data.value || 0), max: Number(data.max || 0), node: data.node || "" };
        jobs.set(id, { ...current, status: "running", progress });
        updateGalleryJob(id, { status: "pending", progress }, { persist: false });
      }
      if (message.type === "executed" && data.output) {
        applyExecutedOutputPreviews(id, data.output);
      }
      if (message.type === "execution_interrupted") {
        setTerminalJob(id, { status: "canceled" });
        updateGalleryJob(id, { status: "canceled" });
      }
      if (message.type === "execution_error") {
        const learned = learnFromFailure(jobBodies.get(id), data.exception_message);
        const failure = describeFailure({ message: data.exception_message, nodeType: data.node_type, nodeId: data.node_id, exceptionType: data.exception_type, traceback: data.traceback, learned });
        setTerminalJob(id, { status: "error", error: failure.summary, failure });
        updateGalleryJob(id, { status: "error", filename: failure.title, failure });
      }
    } catch {
      // Ignore malformed websocket messages from Comfy extensions.
    }
  });
  return socket;
}

/** A Hidden run that stopped early still leaves its graph and inputs in ComfyUI. */
function forgetHiddenRun(body, promptId) {
  if (body?.privateVault) forgetComfyRun({ promptIds: [promptId], inputNames: body.stagedInputNames }).catch(() => null);
  else if (body?.hiddenInputNames?.length) forgetComfyRun({ inputNames: body.hiddenInputNames }).catch(() => null);
}

// What each running job asked for, so a failure can be read against it.
const jobBodies = new Map();

/**
 * A checkpoint assumed to be all-in-one (its header was out of reach) that
 * turns out to lack its text encoder or VAE: remember that for the file, so the
 * next scan asks for the missing part, and say so plainly.
 */
function learnFromFailure(body, message = "") {
  if (body?.source !== "checkpoint" || !body.bundled) return "";
  const text = String(message || "");
  const noEncoder = /clip input is invalid: None|does not contain a valid clip|no CLIP\/text encoder/i.test(text);
  const noVae = /VAE is invalid: None|vae.*is None|does not contain a valid vae/i.test(text);
  if (!noEncoder && !noVae) return "";
  rememberMissingParts(body.model, { encoder: noEncoder, vae: noVae });
  const part = noEncoder ? "text encoder" : "VAE";
  return `This checkpoint has no ${part} built in. HEISS now knows to use a separate one: rescan models, pick it in Advanced (or download it), and generate again.`;
}

async function runJob(id, body) {
  jobBodies.set(id, body);
  let socket = null;
  try {
    const prompt = body.kind === "video" ? await videoGraph(body) : await imageGraph(body);
    socket = openProgressSocket(id);
    await waitForSocketOpen(socket);
    sendSocketFeatureFlags(socket);
    const queued = await comfy("/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, client_id: id, extra_data: { preview_method: "auto" } })
    });
    if (jobs.get(id)?.status === "canceling" || jobs.get(id)?.status === "canceled") {
      await comfy("/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ delete: [queued.prompt_id] })
      }).catch(() => null);
      updateGalleryJob(id, { status: "canceled" });
      setTerminalJob(id, { status: "canceled", promptId: queued.prompt_id });
      return;
    }
    jobs.set(id, { ...jobs.get(id), status: "running", promptId: queued.prompt_id });
    watchProgress(id, queued.prompt_id, socket);
    while (true) {
      if (jobs.get(id)?.status === "canceling" || jobs.get(id)?.status === "canceled") {
        updateGalleryJob(id, { status: "canceled" });
        setTerminalJob(id, { status: "canceled" });
        socket?.close();
        forgetHiddenRun(body, queued.prompt_id);
        return;
      }
      // The socket already recorded the failure; history would only add an empty result.
      if (jobs.get(id)?.status === "error") {
        socket?.close();
        forgetHiddenRun(body, queued.prompt_id);
        return;
      }
      const history = await comfy(`/history/${queued.prompt_id}`);
      const entry = history[queued.prompt_id];
      // A run that failed while the socket was down still says why in its history.
      if (entry?.status?.status_str === "error") {
        const failed = (entry.status.messages || []).find(([type]) => type === "execution_error")?.[1] || {};
        throw Object.assign(new Error(failed.exception_message || "ComfyUI execution failed"), { comfyFailure: failed });
      }
      if (entry) {
        const outputs = outputsFrom(history[queued.prompt_id]);
        // Replacing the placeholder with nothing would delete the tile; keep it as a failure that says why.
        if (!outputs.length) {
          throw Object.assign(new Error("ComfyUI finished the run but saved no image."), { noOutput: true });
        }
        if (body.privateVault) {
          const { items, leftBehind } = await storeHiddenOutputs(jobs.get(id)?.vaultKey, outputs, body, gallery.filter((item) => item.jobId === id));
          removeGalleryJob(id);
          // No thumbnail for the workflow card: that list is not encrypted.
          markWorkflowUsed(body.profileId || body.model || body.workflow || "", "");
          setTerminalJob(id, { status: "done", outputs: items, leftBehind });
          await forgetComfyRun({ promptIds: [queued.prompt_id], inputNames: body.stagedInputNames });
        } else {
          const completed = replaceGalleryJob(id, outputs, body, jobs);
          markWorkflowUsed(body.profileId || body.model || body.workflow || "", completed[0]?.url || "");
          setTerminalJob(id, { status: "done", outputs: completed });
          // A Hidden image used as the reference for a normal run: only its staged copy goes.
          if (body.hiddenInputNames?.length) await forgetComfyRun({ inputNames: body.hiddenInputNames });
        }
        socket?.close();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1600));
    }
  } catch (error) {
    // The socket may already have recorded the richer failure for this job.
    const known = jobs.get(id)?.failure;
    const learned = learnFromFailure(body, error.message);
    const from = error.comfyFailure || {};
    const failure = known || (error.noOutput ? describeFailure({ message: error.message, noOutput: true }) : null) || describeFailure({ message: learned ? error.message : normalizeComfyError(error.message), nodeType: from.node_type, nodeId: from.node_id, exceptionType: from.exception_type, traceback: from.traceback, learned });
    setTerminalJob(id, { status: "error", error: failure.summary, failure });
    updateGalleryJob(id, { status: "error", filename: failure.title, failure });
    socket?.close();
    forgetHiddenRun(body, jobs.get(id)?.promptId);
  } finally {
    // The progress socket can report an error a moment after this loop ends.
    setTimeout(() => jobBodies.delete(id), 60_000).unref?.();
  }
}

function hashString(str = "") {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

export function generateMockImageDataUrl(prompt = "", width = 1024, height = 1024, kind = "image") {
  const colorPalettes = [
    ["#1e1b4b", "#312e81", "#4338ca", "#6366f1", "#818cf8"],
    ["#0f172a", "#1e293b", "#334155", "#0284c7", "#38bdf8"],
    ["#14532d", "#166534", "#15803d", "#22c55e", "#4ade80"],
    ["#701a75", "#86198f", "#a21caf", "#c026d3", "#e879f9"],
    ["#7c2d12", "#9a3412", "#c2410c", "#ea580c", "#fb923c"],
  ];
  const palette = colorPalettes[Math.abs(hashString(prompt)) % colorPalettes.length];
  const title = (prompt || "Demo Generation").replace(/[<>&'"]/g, "").slice(0, 50);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${palette[0]}"/>
        <stop offset="40%" stop-color="${palette[1]}"/>
        <stop offset="80%" stop-color="${palette[2]}"/>
        <stop offset="100%" stop-color="${palette[3]}"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="40%" r="60%">
        <stop offset="0%" stop-color="${palette[4]}" stop-opacity="0.7"/>
        <stop offset="100%" stop-color="${palette[0]}" stop-opacity="0"/>
      </radialGradient>
      <filter id="blurFilter">
        <feGaussianBlur stdDeviation="40"/>
      </filter>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <circle cx="${width * 0.5}" cy="${height * 0.45}" r="${Math.min(width, height) * 0.45}" fill="url(#glow)"/>
    <rect x="5%" y="5%" width="90%" height="90%" rx="18" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2"/>
    <text x="50%" y="46%" font-family="system-ui, -apple-system, sans-serif" font-size="${Math.max(14, Math.min(26, width / 28))}" font-weight="600" fill="#ffffff" text-anchor="middle">${title}</text>
    <text x="50%" y="54%" font-family="system-ui, -apple-system, sans-serif" font-size="${Math.max(11, Math.min(15, width / 42))}" font-weight="500" fill="rgba(255,255,255,0.65)" text-anchor="middle">Demo Mode · ${width}×${height} · ${kind.toUpperCase()}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function runMockJob(id, body) {
  const isCanceled = () => {
    const status = jobs.get(id)?.status;
    return status === "canceling" || status === "canceled";
  };
  if (isCanceled()) {
    setTerminalJob(id, { status: "canceled" });
    updateGalleryJob(id, { status: "canceled" });
    return;
  }
  const steps = Number(body.steps || 4) || 4;
  const count = body.kind === "image" ? Math.max(1, Math.min(8, Number(body.count || 1))) : 1;
  let currentStep = 0;

  updateGalleryJob(id, { status: "running", progress: { step: 1, maxSteps: steps, nodeName: "KSampler" } }, { persist: false });

  const interval = setInterval(() => {
    if (isCanceled()) {
      clearInterval(interval);
      if (jobs.get(id)?.status === "canceling") setTerminalJob(id, { status: "canceled" });
      updateGalleryJob(id, { status: "canceled" });
      return;
    }
    currentStep += Math.max(1, Math.ceil(steps / 4));
    if (currentStep < steps) {
      updateGalleryJob(id, { progress: { step: currentStep, maxSteps: steps, nodeName: "KSampler" } }, { persist: false });
    } else {
      clearInterval(interval);
      updateGalleryJob(id, { progress: { step: steps, maxSteps: steps, nodeName: "VAEDecode" } }, { persist: false });

      setTimeout(() => {
        if (isCanceled()) {
          if (jobs.get(id)?.status === "canceling") setTerminalJob(id, { status: "canceled" });
          updateGalleryJob(id, { status: "canceled" });
          return;
        }
        const completedAt = new Date().toISOString();
        const outputs = Array.from({ length: count }, (_, index) => {
          const url = generateMockImageDataUrl(body.prompt + (count > 1 ? ` #${index + 1}` : ""), body.width, body.height, body.kind);
          return {
            id: `${id}-${index}`,
            jobId: id,
            index,
            url,
            filename: body.kind === "image" && count > 1 ? `${body.prompt} ${index + 1}` : body.prompt,
            type: body.kind === "video" ? "video" : "image",
            status: "done",
            completedAt,
            elapsedMs: 2100,
            width: Number(body.width || 1024),
            height: Number(body.height || 1024),
            model: body.model || "flux1-schnell.safetensors",
            prompt: body.prompt,
            negative: body.negative || ""
          };
        });

        if (body.privateVault) {
          storeHiddenOutputs(jobs.get(id)?.vaultKey, outputs, body, gallery.filter((item) => item.jobId === id))
            .then(({ items }) => {
              removeGalleryJob(id);
              setTerminalJob(id, { status: "done", outputs: items });
            })
            .catch((error) => {
              setTerminalJob(id, { status: "error", error: error.message });
              updateGalleryJob(id, { status: "error", filename: "Could not save to Hidden" });
            });
          return;
        }
        replaceGalleryJob(id, outputs, body, jobs);
        markWorkflowUsed(body.profileId || body.model || body.workflow || "", outputs[0]?.url || "");
        setTerminalJob(id, { status: "done", outputs });
      }, 400);
    }
  }, 350);
}

export { runJob };

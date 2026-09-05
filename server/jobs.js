import { comfy, comfyUrl, normalizeComfyError } from './comfy.js';
import { imageGraph, videoGraph } from './graphs.js';
import { gallery, outputsFrom, removeGalleryJob, replaceGalleryJob, updateGalleryJob, updateGalleryJobPreviews } from './gallery-store.js';
import { storePrivateOutputsWithKey } from './vault.js';
import { markWorkflowUsed } from './workflow-catalog.js';
import { bridgeGraph, markBridgePrompt, stageBridgeOutputs } from './bridge.js';

export const jobs = new Map();
const previewSlots = new Map();
const terminalCleanupTimers = new Map();
const previewIntervalMs = Math.max(100, Number(process.env.JAI_PREVIEW_INTERVAL_MS || 500));
const terminalJobTtlMs = Math.max(10_000, Number(process.env.JAI_TERMINAL_JOB_TTL_MS || 5 * 60 * 1000));

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
  if (current.privateVault || current.bridgeDeviceId) return true;
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
  if (current.privateVault || current.bridgeDeviceId) return true;
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
        const context = data.node_type ? ` (${data.node_type}${data.node_id ? `, node ${data.node_id}` : ""})` : "";
        const error = normalizeComfyError(`${data.exception_message || "ComfyUI execution failed"}${context}`);
        setTerminalJob(id, { status: "error", error });
        updateGalleryJob(id, { status: "error", filename: error });
      }
    } catch {
      // Ignore malformed websocket messages from Comfy extensions.
    }
  });
  return socket;
}

async function runJob(id, body) {
  let socket = null;
  try {
    const prompt = body.kind === "video" ? await videoGraph(body) : await imageGraph(body);
    if (body.bridgeDeviceId) bridgeGraph(prompt, id);
    socket = openProgressSocket(id);
    await waitForSocketOpen(socket);
    sendSocketFeatureFlags(socket);
    const queued = await comfy("/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, client_id: id, extra_data: { preview_method: body.bridgeDeviceId ? 'none' : "auto", ...(body.bridgeDeviceId ? { jai_bridge_id: id } : {}) } })
    });
    if (body.bridgeDeviceId) markBridgePrompt(id, queued.prompt_id);
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
        return;
      }
      const history = await comfy(`/history/${queued.prompt_id}`);
      if (history[queued.prompt_id]) {
        const outputs = outputsFrom(history[queued.prompt_id]);
        if (body.bridgeDeviceId) {
          stageBridgeOutputs(id, outputs);
          await comfy('/history', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delete: [queued.prompt_id] }) }).catch(() => null);
          setTerminalJob(id, { status: 'done', outputs: [], bridgePending: true });
          socket?.close();
          return;
        }
        const completed = body.privateVault
          ? storePrivateOutputsWithKey(outputs, body, gallery.filter((item) => item.jobId === id), jobs.get(id)?.vaultKey)
          : replaceGalleryJob(id, outputs, body, jobs);
        if (body.privateVault) removeGalleryJob(id);
        markWorkflowUsed(body.profileId || body.model || body.workflow || "", completed[0]?.url || "");
        setTerminalJob(id, { status: "done", outputs: completed });
        socket?.close();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1600));
    }
  } catch (error) {
    const message = normalizeComfyError(error.message);
    setTerminalJob(id, { status: "error", error: message });
    updateGalleryJob(id, { status: "error", filename: message });
    socket?.close();
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
  const steps = Number(body.steps || 4) || 4;
  const count = body.kind === "image" ? Math.max(1, Math.min(8, Number(body.count || 1))) : 1;
  let currentStep = 0;

  updateGalleryJob(id, { status: "running", progress: { step: 1, maxSteps: steps, nodeName: "KSampler" } }, { persist: false });

  const interval = setInterval(() => {
    currentStep += Math.max(1, Math.ceil(steps / 4));
    if (currentStep < steps) {
      updateGalleryJob(id, { progress: { step: currentStep, maxSteps: steps, nodeName: "KSampler" } }, { persist: false });
    } else {
      clearInterval(interval);
      updateGalleryJob(id, { progress: { step: steps, maxSteps: steps, nodeName: "VAEDecode" } }, { persist: false });

      setTimeout(() => {
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
          const completed = storePrivateOutputsWithKey(outputs, body, gallery.filter((item) => item.jobId === id), jobs.get(id)?.vaultKey);
          removeGalleryJob(id);
          setTerminalJob(id, { status: "done", outputs: completed });
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

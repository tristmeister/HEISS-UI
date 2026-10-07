import crypto from 'node:crypto';
import { comfy, comfyUrl, normalizeComfyError } from './comfy.js';
import { cancelPrompt, promptTracker } from './comfy-queue.js';
import { describeFailure } from './failures.js';
import { withFixes } from './failure-fixes.js';
import { nextProgress } from './progress-phase.js';
import { rememberMissingParts } from './model-families.js';
import { imageGraph, videoGraph } from './graphs.js';
import { gallery, hideGalleryItems, outputsFrom, removeGalleryJob, replaceGalleryJob, updateGalleryJob, updateGalleryJobPreviews } from './gallery-store.js';
import { forgetComfyRun } from './hidden-traces.js';
import { releaseHiddenRun, rememberHiddenRun } from './hidden-runs.js';
import { attachVaultUpscale, patchVaultItem, storeHiddenOutputs } from './vault.js';
import { keptMessage, missedUpscaleState, pairRunOutputs, runUpscaleState } from './run-upscale.js';
import { writeCivitaiParameters } from './civitai.js';
import { warmThumbnails } from './thumbnails.js';
import { markWorkflowUsed } from './workflow-catalog.js';
import { remainingMs, RunTimer, slowSteps } from './generation-timing.js';
import { generationEstimate, generationWarm, recordGeneration, recordUpscale, upscaleEstimate } from './timings.js';
import { upscaleLeftMs, upscaleWork } from './upscale-timing.js';

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

/**
 * Each generation's clock: what ComfyUI has reported of it so far, and what
 * it was expected to take. Progress then carries endsAt (server time) so every
 * tile can count down, and jobs waiting behind it know when their turn comes.
 */
const runTimings = new Map();

/**
 * How long is left of a job, or null when there is nothing honest to say: a
 * generation by its live steps and learned estimate, plus its Smart upscale
 * when it has one; an upscale by what SeedVR2 has taken here before
 * (upscale-timing.js). Once the upscale is running, its own clock is all that is left.
 */
function leftMsFor(timing, now = Date.now()) {
  const up = timing.upscale || null;
  if (up && !up.estimate?.trusted) return null;
  if (up?.startAt) return upscaleLeftMs(up.estimate, up.startAt, now);
  const upscaleMs = up ? up.estimate.totalMs : 0;
  if (timing.kind === "upscale") return upscaleMs;
  const generation = timing.timer && timing.timer.runAt !== null
    ? remainingMs(timing.timer, timing.estimate, now)
    : timing.estimate?.trusted ? timing.estimate.totalMs : null;
  return generation === null ? null : generation + upscaleMs;
}

/** When a job's run started in ComfyUI (its generation, or a lone upscale), or null while it waits. */
function startedAt(timing) {
  if (timing.timer && timing.timer.runAt !== null) return timing.timer.runAt;
  return timing.kind === "upscale" ? timing.upscale?.startAt || null : null;
}

/** Progress with when the job should end, or without when there is nothing honest to say. */
function withEta(id, progress, now = Date.now()) {
  const timing = runTimings.get(id);
  const { endsAt: _endsAt, runStartedAt: _runStartedAt, ...plain } = progress || {};
  // The picture is saved and Smart upscale is working on it.
  const upscaling = timing?.upscaling ? { upscaling: true } : {};
  if (!timing?.timer) return { ...plain, ...upscaling };
  const left = leftMsFor(timing, now);
  if (left === null) return { ...plain, ...upscaling };
  const started = startedAt(timing);
  return { ...plain, ...upscaling, endsAt: Math.round(now + left), ...(started !== null ? { runStartedAt: started } : {}) };
}

/**
 * When each job still waiting in ComfyUI's queue should be done: after the
 * ones ahead of it. The chain stops at the first job whose length is unknown
 * (a model or upscale without a trusted estimate), since everything behind it
 * would be a guess.
 */
function refreshQueueEstimates(now = Date.now(), { apply = true } = {}) {
  let cursor = now;
  let known = true;
  for (const [id, job] of jobs) {
    if (!["queued", "running", "canceling"].includes(job.status)) continue;
    const timing = runTimings.get(id);
    if (!timing) {
      known = false;
      continue;
    }
    const left = leftMsFor(timing, now);
    if (startedAt(timing) !== null || timing.upscale?.startAt) {
      if (left === null) known = false;
      else cursor = Math.max(cursor, now + left);
      if (apply && timing.kind === "upscale") timing.onEta?.(left === null ? null : Math.round(now + left));
      continue;
    }
    const endsAt = known && left !== null ? Math.round(cursor + left) : null;
    if (endsAt) cursor = endsAt;
    else known = false;
    if (!apply) continue;
    if (timing.kind === "upscale") {
      timing.onEta?.(endsAt);
      continue;
    }
    const previous = job.progress?.endsAt;
    if (endsAt ? previous && Math.abs(previous - endsAt) < 2000 : previous === undefined) continue;
    const { endsAt: _endsAt, ...rest } = job.progress || { value: 0, max: 0 };
    const progress = endsAt ? { ...rest, endsAt } : rest;
    jobs.set(id, { ...job, progress });
    updateGalleryJob(id, { progress }, { persist: false });
  }
  return known ? cursor : null;
}

/**
 * An upscale from the gallery's arrow joins the queue's clock: `onEta` hears
 * when it should be done (or null) whenever that moves by more than a moment.
 * Returns its clock: `start()` once ComfyUI starts it, `end()` when it is over.
 */
export function trackUpscale(jobId, estimate, onEta = () => {}) {
  let last;
  const timing = {
    kind: "upscale",
    upscale: { estimate, startAt: null },
    onEta(endsAt) {
      if (endsAt === last || (endsAt && last && Math.abs(endsAt - last) < 2000)) return;
      last = endsAt;
      onEta(endsAt ? { endsAt, ...(timing.upscale.startAt ? { runStartedAt: timing.upscale.startAt } : {}) } : {});
    }
  };
  runTimings.set(jobId, timing);
  refreshQueueEstimates();
  return {
    start(at = Date.now()) {
      if (timing.upscale.startAt) return;
      timing.upscale.startAt = at;
      last = undefined;
      refreshQueueEstimates();
    },
    /** The clock fields for a progress patch. */
    eta() {
      return last ? { endsAt: last, ...(timing.upscale.startAt ? { runStartedAt: timing.upscale.startAt } : {}) } : {};
    },
    startAt: () => timing.upscale.startAt,
    end() {
      runTimings.delete(jobId);
      refreshQueueEstimates();
    }
  };
}

/** When HEISS's own queue should be clear (now, when empty), or null when a job in it has no known length. */
export function queueClearsAt(now = Date.now()) {
  return refreshQueueEstimates(now, { apply: false });
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

/**
 * Listens from before the prompt is queued: on an idle ComfyUI the run starts
 * at once, and its start is what times the setup. The socket belongs to this
 * job alone; `run.promptId`, once known, only guards against strays.
 */
function watchProgress(id, run, socket = openProgressSocket(id), graph = {}) {
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
      if (data.prompt_id && run.promptId && data.prompt_id !== run.promptId) return;
      // Anything ComfyUI says on this socket shows it is still there.
      run.alive?.();
      // HEISS Rapid says what it did: the picture's settings record whether it really ran (docs/rapid.md).
      if (message.type === "heiss.rapid") {
        const body = jobBodies.get(id);
        if (body?.rapid) body.rapidReport = { active: Boolean(data.active), reason: String(data.reason || ""), smallSteps: Number(data.small_steps || 0), fullSteps: Number(data.full_steps || 0) };
        return;
      }
      const timing = runTimings.get(id);
      if (timing?.timer) {
        timing.timer.note(message);
        // Leaving the queue: whether the model is loaded is now known, and so is the wait behind.
        if (message.type === "execution_start") {
          const body = jobBodies.get(id);
          timing.warm = generationWarm(body);
          timing.estimate = generationEstimate(body, { warm: timing.warm });
        }
      }
      const current = jobs.get(id) || {};
      const next = nextProgress(graph, message, current.progress);
      if (next) {
        const progress = withEta(id, next);
        // A cancel asked for meanwhile stands; progress must not turn it back into running.
        jobs.set(id, { ...current, status: current.status === "canceling" || current.status === "canceled" ? current.status : "running", progress });
        updateGalleryJob(id, { status: "pending", progress }, { persist: false });
        refreshQueueEstimates();
      }
      if (message.type === "executed" && data.output) {
        applyExecutedOutputPreviews(id, data.output);
        // The picture is saved and Smart upscale takes over: from here a stop keeps the picture.
        if (run.pairs?.some((pair) => pair.base === String(data.node))) {
          run.saved.set(String(data.node), data.output);
          if (timing) {
            timing.upscaling = true;
            // The upscale's clock starts with the first picture it can work on.
            if (timing.upscale) timing.upscale.startAt ??= Date.now();
          }
          const job = jobs.get(id);
          if (job && !job.terminalAt) {
            const progress = withEta(id, job.progress);
            jobs.set(id, { ...job, keepsPicture: true, progress });
            updateGalleryJob(id, { progress }, { persist: false });
            refreshQueueEstimates();
          }
        }
      }
      // Finished: look for the images now rather than at the next poll.
      if (message.type === "execution_success" || (message.type === "executing" && (data.node === null || data.node === undefined))) {
        if (timing?.upscale?.startAt) timing.upscale.endAt ??= Date.now();
        wakeRun(run);
      }
      // Stopped or failed while upscaling: runJob delivers the saved picture instead.
      if ((message.type === "execution_interrupted" || message.type === "execution_error") && run.saved?.size) {
        run.missed = message.type === "execution_interrupted" ? { canceled: true } : { error: normalizeComfyError(data.exception_message || "") };
        wakeRun(run);
        return;
      }
      if (message.type === "execution_interrupted") {
        setTerminalJob(id, { status: "canceled" });
        updateGalleryJob(id, { status: "canceled" });
      }
      if (message.type === "execution_error") {
        const learned = learnFromFailure(jobBodies.get(id), data.exception_message);
        const failure = withFixes(describeFailure({ message: data.exception_message, nodeType: data.node_type, nodeId: data.node_id, exceptionType: data.exception_type, traceback: data.traceback, learned }), jobBodies.get(id));
        setTerminalJob(id, { status: "error", error: failure.summary, failure });
        updateGalleryJob(id, { status: "error", filename: failure.title, failure });
      }
    } catch {
      // Ignore malformed websocket messages from Comfy extensions.
    }
  });
  return socket;
}

/**
 * A normal run that used a Hidden image as its reference: the staged copy
 * goes. A Hidden run itself is finished by hidden-runs.js once ComfyUI lets
 * go of it (see the end of runJob).
 */
function forgetHiddenInputs(body) {
  if (!body?.privateVault && body?.hiddenInputNames?.length) forgetComfyRun({ inputNames: body.hiddenInputNames }).catch(() => null);
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
  return `This checkpoint has no ${part} built in, so it now uses a separate one. Rescan models, pick one in Advanced (or download it), and generate again.`;
}

/**
 * Waits before the next look at ComfyUI; a finished-run message on the socket
 * ends the wait early. ComfyUI says "finished" twice: once before it writes
 * the run's history and once after. The second often lands while the look
 * prompted by the first is still out, so a message with nobody waiting is
 * kept and the next pause returns at once instead of a full poll later.
 */
async function pause(run, ms) {
  if (run.woken) {
    run.woken = false;
    return;
  }
  await new Promise((resolve) => {
    run.wake = resolve;
    setTimeout(resolve, ms).unref?.();
  });
  run.wake = null;
  run.woken = false;
}

function wakeRun(run) {
  if (run.wake) run.wake();
  else run.woken = true;
}

/**
 * While ComfyUI is out of reach the tile says so instead of freezing on its
 * last step; the progress from before comes back with the connection (and the
 * socket's next message replaces it anyway).
 */
function showReconnecting(id, run, on) {
  const current = jobs.get(id);
  if (!current || current.status === "canceling" || current.status === "canceled") return;
  if (on === Boolean(current.progress?.reconnecting)) return;
  let progress;
  if (on) {
    run.progressBefore = current.progress || null;
    progress = { value: 0, max: 0, node: "", phase: "Reconnecting…", steps: false, reconnecting: true };
  } else {
    progress = run.progressBefore || { value: 0, max: 0 };
    run.progressBefore = null;
  }
  jobs.set(id, { ...current, progress });
  updateGalleryJob(id, { progress }, { persist: false });
}

/**
 * `prepare` may put more into the run's graph before ComfyUI gets it: Smart
 * upscale (run-upscale.js) returns the graph with its upscale and which save
 * node each upscale belongs to, or `{ skipped }` saying why there is none.
 */
async function runJob(id, body, { prepare = null } = {}) {
  jobBodies.set(id, body);
  const timing = { timer: null, estimate: generationEstimate(body), warm: false };
  runTimings.set(id, timing);
  refreshQueueEstimates();
  let socket = null;
  // A Hidden run is written down before ComfyUI has it, so it is finished
  // even when this job loses it; `hiddenDone` says how far this job got.
  let hiddenPromptId = "";
  let hiddenDone = {};
  try {
    let prompt = body.kind === "video" ? await videoGraph(body) : await imageGraph(body);
    const upscale = prepare ? await prepare(prompt) : null;
    const embed = upscale?.graph ? upscale : null;
    if (embed) prompt = embed.graph;
    const pairs = embed?.pairs || [];
    timing.timer = new RunTimer(prompt, { endNodes: pairs.map((pair) => pair.base) });
    if (embed) {
      // Its upscale is part of the run's time: learned from every SeedVR2 upscale here (upscale-timing.js).
      const work = upscaleWork({ width: embed.plan?.estimatedWidth, height: embed.plan?.estimatedHeight, count: (Number(body.count) || 1) * pairs.length });
      const learn = { quality: embed.quality, model: embed.plan?.model || "", faceDetail: Boolean(embed.faceDetail), work };
      timing.upscale = { estimate: upscaleEstimate(learn), learn, startAt: null, endAt: null };
    }
    socket = openProgressSocket(id);
    await waitForSocketOpen(socket);
    sendSocketFeatureFlags(socket);
    // `saved`: Smart upscale's source pictures, by save node, as ComfyUI reported them; `missed`: why their upscale did not finish.
    const run = { promptId: null, wake: null, woken: false, alive: null, pairs, saved: new Map(), missed: null };
    watchProgress(id, run, socket, prompt);
    if (body.privateVault) {
      hiddenPromptId = crypto.randomUUID();
      rememberHiddenRun(jobs.get(id)?.vaultKey, hiddenPromptId, { body, inputNames: body.stagedInputNames });
    }
    const queued = await comfy("/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // heiss_hidden stays with the run in ComfyUI's history, so no recovery ever takes it for a gallery image.
      body: JSON.stringify({ prompt, client_id: id, ...(hiddenPromptId ? { prompt_id: hiddenPromptId } : {}), extra_data: { preview_method: "auto", ...(hiddenPromptId ? { heiss_hidden: true } : {}) } })
    });
    // An older ComfyUI names the run itself.
    if (hiddenPromptId && queued.prompt_id && queued.prompt_id !== hiddenPromptId) {
      rememberHiddenRun(jobs.get(id)?.vaultKey, queued.prompt_id, { body, inputNames: body.stagedInputNames });
      releaseHiddenRun(hiddenPromptId, { clean: true });
      hiddenPromptId = queued.prompt_id;
    }
    if (jobs.get(id)?.status === "canceling" || jobs.get(id)?.status === "canceled") {
      // It may already have started on an idle ComfyUI; this stops it either way, and only it.
      await cancelPrompt(queued.prompt_id).catch(() => null);
      updateGalleryJob(id, { status: "canceled" });
      setTerminalJob(id, { status: "canceled", promptId: queued.prompt_id });
      return;
    }
    run.promptId = queued.prompt_id;
    jobs.set(id, { ...jobs.get(id), status: "running", promptId: queued.prompt_id });
    const tracker = promptTracker(queued.prompt_id);
    run.alive = tracker.alive;
    /**
     * Into the gallery (or Hidden): each picture with its upscale riding on it.
     * `missed` is set when the upscale stopped or failed after the pictures were
     * saved; they are kept at their generated size and the toast says so.
     */
    const deliver = async (results, missed = null) => {
      const upscaled = (result) => (result.upscale && !missed ? runUpscaleState(embed, result.upscale) : null);
      const missedState = (result) => (result.paired && (missed || !result.upscale) ? missedUpscaleState(embed, missed || { error: "The upscale ended without an image" }) : null);
      const outputs = results.map((result) => result.output);
      const kept = missed ? keptMessage({ canceled: Boolean(missed.canceled), count: outputs.length }) : "";
      const skipped = upscale?.skipped ? { status: "error", quality: upscale.quality, progress: null, error: upscale.skipped } : null;
      // Every upscale it made teaches the next estimate; a Hidden run never does.
      const clock = timing.upscale;
      if (clock?.startAt && !missed && !body.privateVault && results.some((result) => result.upscale)) {
        recordUpscale({ ...clock.learn, ms: (clock.endAt ?? Date.now()) - clock.startAt, predicted: clock.estimate });
      }
      if (body.privateVault) {
        const { items, leftBehind } = await storeHiddenOutputs(jobs.get(id)?.vaultKey, outputs, body, gallery.filter((item) => item.jobId === id));
        const key = jobs.get(id)?.vaultKey;
        for (const [index, result] of results.entries()) {
          const item = items[index];
          if (!item) continue;
          const done = upscaled(result);
          try {
            // Sealed into the item; ComfyUI's address for the file means nothing once it is gone.
            if (done) {
              const { url: _url, thumbnailUrl: _thumb, outputName: _name, ...state } = done;
              Object.assign(item, (await attachVaultUpscale(key, item.id, result.upscale, state)).item);
            }
            else if (missedState(result) || skipped) patchVaultItem(key, item.id, { upscale: missedState(result) || skipped });
          } catch { /* the picture is in Hidden; only its upscale is missing */ }
        }
        removeGalleryJob(id);
        // No thumbnail for the workflow card: that list is not encrypted.
        markWorkflowUsed(body.profileId || body.model || body.workflow || "", "");
        setTerminalJob(id, { status: "done", outputs: items, leftBehind, ...(kept ? { kept } : {}) });
        // A copy that could not be removed is marked, so no import of the output folder brings it in.
        if (leftBehind) hideGalleryItems(outputs);
        const historyGone = await forgetComfyRun({ promptIds: [queued.prompt_id], inputNames: body.stagedInputNames });
        hiddenDone = { stored: true, clean: historyGone };
      } else {
        // Before the gallery shows them, so no browser (or thumbnail, which is
        // keyed by the file's size and time) sees the file before it is final.
        await writeCivitaiParameters([...outputs, ...results.map((result) => result.upscale).filter(Boolean)], body);
        const withUpscales = results.map((result) => {
          const done = upscaled(result);
          if (done) return { ...result.output, upscale: done, upscaleActive: true };
          const state = missedState(result) || skipped;
          return state ? { ...result.output, upscale: state } : result.output;
        });
        const completed = replaceGalleryJob(id, withUpscales, body, jobs);
        markWorkflowUsed(body.profileId || body.model || body.workflow || "", completed[0]?.url || "");
        setTerminalJob(id, { status: "done", outputs: completed, ...(kept ? { kept } : {}) });
        // Made now, while the browser is still learning the run is done.
        warmThumbnails(completed);
        // A Hidden image used as the reference for a normal run: only its staged copy goes.
        if (body.hiddenInputNames?.length) await forgetComfyRun({ inputNames: body.hiddenInputNames });
      }
      socket?.close();
    };
    // The pictures Smart upscale was working on, from what ComfyUI said as each was saved.
    const savedResults = () => pairs.flatMap((pair) => {
      const output = run.saved.get(pair.base);
      return output ? pairRunOutputs({ [pair.base]: output }, [pair]) : [];
    });
    while (true) {
      if ((jobs.get(id)?.status === "canceling" || jobs.get(id)?.status === "canceled") && run.saved.size) {
        // Stopped while upscaling: the pictures are done, so they stay.
        await cancelPrompt(queued.prompt_id).catch(() => null);
        await deliver(savedResults(), { canceled: true });
        return;
      }
      if (run.missed && run.saved.size) {
        await deliver(savedResults(), run.missed);
        return;
      }
      if (jobs.get(id)?.status === "canceling" || jobs.get(id)?.status === "canceled") {
        // The cancel route already asked; asking again covers a ComfyUI that was out of reach then.
        await cancelPrompt(queued.prompt_id).catch(() => null);
        updateGalleryJob(id, { status: "canceled" });
        setTerminalJob(id, { status: "canceled" });
        socket?.close();
        forgetHiddenInputs(body);
        return;
      }
      // The socket already recorded the failure; history would only add an empty result.
      if (jobs.get(id)?.status === "error") {
        socket?.close();
        forgetHiddenInputs(body);
        return;
      }
      const checked = await tracker.check();
      if (checked.state === "reconnecting") {
        showReconnecting(id, run, true);
        await pause(run, checked.delayMs);
        continue;
      }
      if (checked.reconnected) {
        showReconnecting(id, run, false);
        // A socket that dropped with the connection gets a fresh one, so progress and previews come back.
        if (!socket || socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
          socket = openProgressSocket(id);
          await waitForSocketOpen(socket);
          sendSocketFeatureFlags(socket);
          watchProgress(id, run, socket, prompt);
        }
      }
      const entry = checked.state === "done" ? checked.entry : null;
      // Stopped or failed after its pictures were saved (and the socket missed it): keep them.
      if (entry?.status?.status_str === "error" && pairs.length) {
        const results = pairRunOutputs(entry.outputs, pairs).filter((result) => result.paired);
        if (results.length) {
          const messages = entry.status.messages || [];
          const interrupted = messages.some(([type]) => type === "execution_interrupted");
          const failed = messages.find(([type]) => type === "execution_error")?.[1] || {};
          await deliver(results, interrupted ? { canceled: true } : { error: normalizeComfyError(failed.exception_message || "") });
          return;
        }
      }
      // A run that failed while the socket was down still says why in its history.
      if (entry?.status?.status_str === "error") {
        const failed = (entry.status.messages || []).find(([type]) => type === "execution_error")?.[1] || {};
        throw Object.assign(new Error(failed.exception_message || "ComfyUI execution failed"), { comfyFailure: failed });
      }
      if (entry) {
        recordTiming(id, body, timing);
        const results = pairRunOutputs(entry.outputs, pairs);
        // Replacing the placeholder with nothing would delete the tile; keep it as a failure that says why.
        if (!results.length) {
          throw Object.assign(new Error("ComfyUI finished the run but saved no image."), { noOutput: true });
        }
        await deliver(results);
        return;
      }
      await pause(run, 1600);
    }
  } catch (error) {
    // The socket may already have recorded the richer failure for this job.
    const known = jobs.get(id)?.failure;
    // ComfyUI's own words stay in the detail (a missing module's name, say); the plain version leads.
    const raw = error.raw || error.message;
    const learned = learnFromFailure(body, raw);
    const friendly = learned ? "" : normalizeComfyError(raw);
    const from = error.comfyFailure || {};
    const failure = known || (error.noOutput ? describeFailure({ message: error.message, noOutput: true }) : null) || withFixes(describeFailure({ message: raw, friendly: friendly !== raw ? friendly : "", nodeType: from.node_type, nodeId: from.node_id, exceptionType: from.exception_type, traceback: from.traceback, learned }), body);
    setTerminalJob(id, { status: "error", error: failure.summary, failure });
    updateGalleryJob(id, { status: "error", filename: failure.title, failure });
    socket?.close();
    forgetHiddenInputs(body);
  } finally {
    // Anything short of sealed and cleaned up is finished later, from the list of Hidden runs.
    if (hiddenPromptId) releaseHiddenRun(hiddenPromptId, hiddenDone);
    // The progress socket can report an error a moment after this loop ends.
    setTimeout(() => jobBodies.delete(id), 60_000).unref?.();
    runTimings.delete(id);
    refreshQueueEstimates();
  }
}

/**
 * A finished run's timing: learned from (never for a Hidden run), and kept on
 * the job so its images say how long they took and whether steps were far
 * slower than usual. A run whose end the socket missed is not learned from,
 * since its tail would be off by a poll.
 */
function recordTiming(id, body, timing) {
  const result = timing.timer?.result();
  if (!result) return;
  if (!body.privateVault) recordGeneration({ body, result, predicted: timing.estimate, warm: timing.warm });
  const slow = slowSteps(result, timing.estimate);
  jobs.set(id, { ...jobs.get(id), timing: { runMs: Math.round(result.runMs), ...(result.stepMs ? { stepMs: Math.round(result.stepMs) } : {}), ...(slow ? { slow: true } : {}) } });
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
              updateGalleryJob(id, { status: "error", filename: "Couldn’t save to Hidden" });
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

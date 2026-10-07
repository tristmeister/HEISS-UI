import { normalizeComfyError } from "./comfy.js";
import { embedUpscale, faceDetailSource, normalizeQuality, upscaleStatus } from "./upscale.js";
import { generationSettings, outputsFrom } from "./gallery-store.js";

/**
 * Smart upscale as part of a run: the size menu's 2K and 4K. The upscale goes
 * into the run's own ComfyUI graph (upscale.js embedUpscale), so a run and its
 * upscale are one job: nothing queued behind it starts in between, and its
 * tile shows one picture, never an original and an upscale to flip between.
 */

const tierLabels = { balanced: "2K", high: "4K" };

/**
 * Whether a request's own 2K/4K pick should be dropped before it reaches a
 * run. Once a reference dictates the framing, or the run paints a mask, the
 * output's size is already decided by that reference or mask, not the pick,
 * so a stale one from before either was set must not sneak an upscale in.
 */
export function dropsAutoUpscale({ inpaint, referencesFamily, hasReference }) {
  return Boolean(inpaint || (referencesFamily && hasReference));
}

/**
 * The run's graph with its upscale in it, or `{ skipped }` saying why the run
 * goes ahead without one. The face pass is a nicety: without what it needs the
 * upscale still runs.
 */
export function planRunUpscale(graph, body, info, customWorkflow = null) {
  const quality = normalizeQuality(body.autoUpscale?.quality);
  const label = tierLabels[quality] || "";
  const status = upscaleStatus(info, quality);
  if (!status.ready) {
    return { skipped: status.nodesInstalled ? "Smart upscale’s SeedVR2 model isn’t installed yet" : "Smart upscale needs the SeedVR2 nodes in ComfyUI", quality };
  }
  const source = {
    quality,
    prompt: body.prompt || "",
    seed: body.seed,
    // An inpaint result is the whole original picture, whatever size the crop sampled at.
    width: Number(body.inpaint?.image?.width || body.width || 0),
    height: Number(body.inpaint?.image?.height || body.height || 0)
  };
  const phase = label ? `Upscaling to ${label}` : "Upscaling";
  const withFaces = Boolean(body.autoUpscale?.faceDetail && status.faceDetail?.nodesInstalled);
  const attempts = withFaces
    ? [{ ...source, faceDetail: true, ...faceDetailSource({ model: body.model, settings: generationSettings(body) }, customWorkflow) }, source]
    : [source];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const embedded = embedUpscale(graph, attempt, info, { phase });
      if (!embedded) return { skipped: "This workflow saves no image for Smart upscale to work on", quality };
      return { ...embedded, quality, label, faceDetail: Boolean(attempt.faceDetail) };
    } catch (error) {
      lastError = error;
    }
  }
  return { skipped: `Smart upscale couldn’t start: ${normalizeComfyError(lastError?.message || "")}`, quality };
}

/**
 * What a finished (or stopped) run made, in order: each saved picture, with
 * the upscale made from it when there is one. `pairs` says which save node
 * each upscale came from; the upscales themselves are not pictures of their own.
 */
export function pairRunOutputs(entryOutputs = {}, pairs = []) {
  const upscaleIds = new Set(pairs.map((pair) => pair.upscale));
  const results = [];
  for (const [nodeId, output] of Object.entries(entryOutputs || {})) {
    if (upscaleIds.has(nodeId)) continue;
    const pair = pairs.find((item) => item.base === nodeId);
    const upscales = pair ? outputsFrom({ outputs: { [pair.upscale]: entryOutputs[pair.upscale] || {} } }) : [];
    outputsFrom({ outputs: { [nodeId]: output } }).forEach((base, index) => {
      results.push({ output: base, upscale: pair ? upscales[index] || null : null, paired: Boolean(pair) });
    });
  }
  return results;
}

/** Said on a picture whose upscale did not happen; the tile's upscale arrow is back to try again. */
export function missedUpscaleState(embed, { canceled = false, error = "" } = {}) {
  return {
    status: canceled ? "canceled" : "error",
    quality: embed?.quality || "balanced",
    progress: null,
    kept: true,
    error: canceled ? "" : error || "Smart upscale failed"
  };
}

/** A done upscale, as the gallery item's `upscale` record. */
export function runUpscaleState(embed, upscale) {
  const plan = embed.plan || {};
  return {
    status: "done",
    withRun: true,
    quality: embed.quality,
    faceDetail: Boolean(embed.faceDetail),
    progress: null,
    url: upscale.url,
    thumbnailUrl: upscale.thumbnailUrl || "",
    outputName: upscale.filename,
    width: plan.estimatedWidth,
    height: plan.estimatedHeight,
    scale: plan.scale,
    completedAt: new Date().toISOString(),
    error: ""
  };
}

/** The toast for a run whose pictures were kept without their upscale. */
export function keptMessage({ canceled = false, count = 1 } = {}) {
  const what = count > 1 ? "The pictures are" : "The picture is";
  return canceled
    ? `Upscale stopped. ${what} kept at the generated size.`
    : `The upscale failed. ${what} kept at the generated size.`;
}

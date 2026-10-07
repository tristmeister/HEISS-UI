import path from "node:path";
import { dataDir } from "./gallery-store.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { addRestartSample, restartEstimate } from "./restart-insights.js";
import { addRun, estimateRun, isWarm, timingKey } from "./generation-timing.js";
import { addUpscale, estimateUpscale } from "./upscale-timing.js";

/**
 * How long things take on this machine, kept only for HEISS UI's own
 * estimates. Nothing here leaves the data folder, and Hidden runs never
 * enter it.
 */
export const timingsPath = path.join(dataDir, "timings.json");

let timings = null;

function load() {
  if (timings) return timings;
  try {
    const raw = readJsonFile(timingsPath);
    timings = { restarts: Array.isArray(raw?.restarts) ? raw.restarts : [], runs: Array.isArray(raw?.runs) ? raw.runs : [], upscales: Array.isArray(raw?.upscales) ? raw.upscales : [] };
  } catch {
    timings = { restarts: [], runs: [], upscales: [] };
  }
  return timings;
}

function save(label) {
  try {
    writeJsonFile(timingsPath, timings);
  } catch (error) {
    console.warn(`[HEISS] Could not save ${label} timing: ${error.message}`);
  }
}

/** How long a ComfyUI restart usually takes here, or null until restarts agree. */
export function comfyRestartEstimate() {
  return restartEstimate(load().restarts);
}

export function recordComfyRestart(ms, at = new Date().toISOString()) {
  const current = load();
  const restarts = addRestartSample(current.restarts, { at, ms });
  if (restarts === current.restarts) return;
  timings = { ...current, restarts };
  save("restart");
}

/** What a generation of `body` should take here; see estimateRun. `warm` overrides the guess. */
export function generationEstimate(body, options = {}) {
  return estimateRun(load().runs, body, options);
}

/** Whether a run of `body` starting now likely finds its model loaded. */
export function generationWarm(body, now = Date.now()) {
  return isWarm(load().runs, timingKey(body), now);
}

export function recordGeneration(entry) {
  const current = load();
  const runs = addRun(current.runs, entry);
  if (runs === current.runs) return;
  timings = { ...current, runs };
  save("generation");
}

/** What a SeedVR2 upscale should take here; see estimateUpscale. */
export function upscaleEstimate(params) {
  return estimateUpscale(load().upscales, params);
}

/** A finished upscale, from the gallery's arrow or inside a run. Never a Hidden one. */
export function recordUpscale(entry) {
  const current = load();
  const upscales = addUpscale(current.upscales, entry);
  if (upscales === current.upscales) return;
  timings = { ...current, upscales };
  save("upscale");
}

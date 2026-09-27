import path from "node:path";
import { dataDir } from "./gallery-store.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { addRestartSample, restartEstimate } from "./restart-insights.js";

/**
 * How long things take on this machine, kept only for HEISS UI's own
 * estimates. Nothing here leaves the data folder.
 */
export const timingsPath = path.join(dataDir, "timings.json");

let timings = null;

function load() {
  if (timings) return timings;
  try {
    const raw = readJsonFile(timingsPath);
    timings = { restarts: Array.isArray(raw?.restarts) ? raw.restarts : [] };
  } catch {
    timings = { restarts: [] };
  }
  return timings;
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
  try {
    writeJsonFile(timingsPath, timings);
  } catch (error) {
    console.warn(`[HEISS] Could not save restart timing: ${error.message}`);
  }
}

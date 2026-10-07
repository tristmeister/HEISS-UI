import React from 'react';
import { apiJson } from './api';

export type GenerationEstimate = { ms?: number; queueMs?: number };

type EstimateInput = {
  mode: string;
  model: string;
  profileId: string;
  /** The model's family, so a file without runs of its own can borrow a sibling's (an fp8 build's for the fp16 one). */
  family?: string;
  width: number;
  height: number;
  count: number;
  steps: number;
  frames: number;
  /** Separate runs for each variation, one after another. */
  runs: number;
  /** Changes when a run finishes, so the estimate learns from it and the queue shrinks. */
  revision: number;
  /** Smart upscale's effort when each image upscales as part of its run, so its time is in the estimate. */
  upscale?: string;
  upscaleFaceDetail?: boolean;
  /** HEISS Rapid's start and guidance on for this run: those runs are timed apart. */
  rapid?: boolean;
  guidance?: boolean;
};

/**
 * What a generation with the current settings should take here, asked for a
 * moment after the settings stop changing. Nothing until the server trusts
 * its estimate for this model.
 */
export function useGenerationEstimate(input: EstimateInput): GenerationEstimate | null {
  const [estimate, setEstimate] = React.useState<GenerationEstimate | null>(null);
  const { mode, model, profileId, family = '', width, height, count, steps, frames, runs, revision, upscale = '', upscaleFaceDetail = false, rapid = false, guidance = false } = input;
  React.useEffect(() => {
    if (!model || !width || !height) {
      setEstimate(null);
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ kind: mode, model, profileId, family, width: String(width), height: String(height), count: String(count), steps: String(steps), frames: String(frames), runs: String(runs), ...(upscale ? { upscale, faceDetail: upscaleFaceDetail ? '1' : '0' } : {}), ...(rapid ? { rapid: '1' } : {}), ...(guidance ? { guidance: '1' } : {}) });
      apiJson<GenerationEstimate>(`/api/estimate?${query}`)
        .then((data) => { if (current) setEstimate(data.ms || data.queueMs ? { ms: data.ms, queueMs: data.queueMs } : null); })
        .catch(() => { if (current) setEstimate(null); });
    }, 300);
    return () => { current = false; window.clearTimeout(timer); };
  }, [mode, model, profileId, family, width, height, count, steps, frames, runs, revision, upscale, upscaleFaceDetail, rapid, guidance]);
  return estimate;
}

/** "about 40 s" / "about 3 min", for a sentence. */
export function formatAbout(ms: number) {
  const seconds = ms / 1000;
  if (seconds < 10) return 'a few seconds';
  if (seconds < 60) return `about ${Math.round(seconds / 5) * 5} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `about ${minutes} min` : `about ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** The estimate as a phrase for the Generate button's tip: "about 40 s", "about 40 s after the queue". */
export function estimatePhrase(estimate: GenerationEstimate | null) {
  if (!estimate?.ms) return '';
  return estimate.queueMs && estimate.queueMs > 5000 ? `${formatAbout(estimate.ms)}, after ${formatAbout(estimate.queueMs)} of queue` : formatAbout(estimate.ms);
}

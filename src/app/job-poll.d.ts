import type { Job } from './types';

export const POLL_MS: { first: number; queued: number; running: number; closing: number; hidden: number; retry: number };

/** Milliseconds until the next ask about a job, from its last answer (null before the first). */
export function jobPollDelay(job: (Partial<Job> & { status?: string }) | null, options?: { hidden?: boolean; serverNow?: number; misses?: number }): number;

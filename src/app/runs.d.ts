import type { GalleryItem } from './types';

/** One stretch of time spent making things, newest first. */
export type Moment = {
  id: string;
  /** "This evening", "Monday night", "Sun, Sep 28". */
  title: string;
  /** For older dates only: "Evening". Empty when the title already says it. */
  part: string;
  start: number;
  end: number;
  items: GalleryItem[];
};

/** The takes and variations of one idea inside a moment. */
export type Run = {
  id: string;
  momentId: string;
  /** Newest first: finished, running and all. */
  items: GalleryItem[];
  /** Finished outputs. */
  count: number;
  /** Something in it is still generating. */
  live: boolean;
  cover: GalleryItem;
  /** How many different prompts it holds; 1 means takes of one prompt. */
  variations: number;
  model: string;
  type: string;
  start: number;
  /** When its newest output was made: the run is quiet from then on. */
  end: number;
};

export type GalleryGroups = { moments: Moment[]; runs: Run[]; runOf: Map<string, Run> };

export const MOMENT_GAP_MS: number;
export const RUN_GAP_MS: number;
export const RUN_THRESHOLD: number;
export const MIN_STACK: number;

export function promptWords(text: unknown): Set<string>;
export function wordWeights(items: GalleryItem[]): { weightOf: (word: string) => number };
export function promptSimilarity(a: Set<string>, b: Set<string>, weightOf?: (word: string) => number): number;
export function momentTitle(start: number, end: number, now?: number): { title: string; part: string };
export function groupGallery(items: GalleryItem[], options?: { now?: number; runs?: boolean }): GalleryGroups;
export function runTitle(run: Run): string;

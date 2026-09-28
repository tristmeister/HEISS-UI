/** Where one tile went: its column (the left one of two when it spans), its span and its place in the stacking order. */
export type MasonrySlot = { column: number; span: 1 | 2; order: number };

export type MasonryLayout = {
  column: Int32Array;
  span: Uint8Array;
  top: Float64Array;
  /** Tile heights, without the gap below each. */
  height: Float64Array;
  /** Each column's tiles top to bottom; a spanning tile is in both of its columns. */
  lists: number[][];
  /** The tallest column, gap below its last tile included. */
  total: number;
  /** By placement key, for the next layout to hold still against. */
  placement: Map<string, MasonrySlot>;
};

export const WIDE_RATIO: number;
export const SPAN_MIN_COLUMNS: number;
export const LEVEL_SHARE: number;
export const GAP_SHARE: number;
export const DROP_SHARE: number;
export const LOOK_AHEAD: number;

export function packMasonry(options: {
  count: number;
  columns: number;
  /** One column's width; the tolerances for spanning are shares of it. */
  columnWidth: number;
  /** Space below every tile. */
  gap: number;
  keyOf: (index: number) => string;
  /** The tile's height at one column's width or across two. */
  heightOf: (index: number, span: 1 | 2) => number;
  /** Whether the tile would like two columns. */
  wideOf: (index: number) => boolean;
  previous?: Map<string, MasonrySlot> | null;
  holding?: boolean;
}): MasonryLayout;

export function firstReaching(list: number[], top: Float64Array, height: Float64Array, y: number): number;

import { packMasonry, WIDE_RATIO, type MasonrySlot } from './masonry';
import { generationIdentity } from './GenerationPreview';
import type { GalleryGroups, Moment, Run } from './runs';
import type { GalleryItem } from './types';

/**
 * Where everything in the gallery goes once it is grouped. The grid is a
 * column of blocks: a moment's heading, then masonry, broken wherever a run is
 * open by its shelf. Each stretch of masonry is packed on its own
 * (masonry.js), so a shelf or a heading always starts on a clean line and the
 * tiles around it keep the rules they always had.
 *
 * An open run isn't masonry: it is a shelf, rows of its outputs at one height
 * each, read left to right in the order they were made, under a line naming
 * the run. Masonry has no reading order (each tile drops into the shortest
 * column), so a run opened inside it scatters across every column and has no
 * end to fold it from; rows do.
 */

export type LayoutEntry =
  | { kind: "tile"; key: string; item: GalleryItem; x: number; y: number; w: number; h: number; run?: Run }
  | { kind: "stack"; key: string; run: Run; x: number; y: number; w: number; h: number }
  | { kind: "moment"; key: string; moment: Moment; x: number; y: number; w: number; h: number; first: boolean }
  | { kind: "shelf"; key: string; run: Run; x: number; y: number; w: number; h: number };


export type GalleryLayout = {
  entries: LayoutEntry[];
  total: number;
  placements: Map<string, Map<string, MasonrySlot>>;
};

/** A moment's heading: the first sits closer to the top. */
export const MOMENT_HEAD = 66;
export const MOMENT_HEAD_FIRST = 50;
/**
 * How a folded run looks: like any other photo with two hairline edges under
 * it ("burst", as Photos shows a burst), or a cover flow inside one card ("flow").
 */
export type RunStackStyle = "burst" | "flow";
/** Room under a burst for the two edges showing beneath it. */
export const BURST_EDGE = 6;
/**
 * A cover-flow card takes its shape from its cover: wide enough for the front
 * face (about three fifths of the card) and the faces turned away beside it,
 * tall enough that the front face nearly fills it, within calm limits.
 */
export const FLOW_FACE_WIDTH = 0.6;
export const FLOW_FACE_HEIGHT = 0.86;
export const flowRatio = (item: GalleryItem) => Math.min(1.7, Math.max(0.8, ratioOf(item) * FLOW_FACE_HEIGHT / FLOW_FACE_WIDTH));
/** A shelf: the line naming the run above its rows, and the ledge under them. */
export const SHELF_HEAD = 44;
export const SHELF_FOOT = 14;

/** Which column a tile sits in, kept by run and position so a finished image keeps its pending tile's place. */
export const placementKey = (item: GalleryItem) => item.jobId && Number.isInteger(item.index) ? `${item.jobId}:${item.index}` : item.id;

export function itemKey(item: GalleryItem) {
  return generationIdentity(item) || item.url || item.outputName || item.filename || item.id;
}

function ratioOf(item: GalleryItem) {
  return Number(item.width || 1) / Math.max(1, Number(item.height || 1));
}

export function tileHeight(item: GalleryItem, width: number) {
  return Math.max(120, Math.round(width / Math.max(0.2, ratioOf(item))));
}

/** Column geometry for a stretch of grid `width` wide, the way the grid's tracks fall. */
export function gridGeometry(width: number, columns: number, spacing: number, gutter: number) {
  const safe = Math.max(1, columns);
  const columnWidth = width ? Math.floor((width - spacing * (safe - 1)) / safe) : 240;
  const track = width ? (width - gutter * (safe - 1)) / safe : columnWidth;
  return {
    columns: safe,
    columnWidth,
    wideWidth: Math.floor(track + gutter + columnWidth),
    left: (column: number) => Math.floor(column * track * 64) / 64 + column * gutter,
  };
}

type Piece = { kind: "item"; item: GalleryItem; run?: Run } | { kind: "stack"; run: Run };

export function layoutGallery({
  items,
  groups,
  moments,
  stackRuns,
  stackStyle = "burst",
  open: openRuns,
  width,
  columns,
  spacing,
  gutter,
  spanWide,
  previous,
  holding,
}: {
  items: GalleryItem[];
  groups: GalleryGroups | null;
  moments: boolean;
  stackRuns: boolean;
  stackStyle?: RunStackStyle;
  open: Set<string>;
  width: number;
  columns: number;
  spacing: number;
  gutter: number;
  spanWide: boolean;
  previous: Map<string, Map<string, MasonrySlot>>;
  holding: boolean;
}): GalleryLayout {
  const entries: LayoutEntry[] = [];
  const placements = new Map<string, Map<string, MasonrySlot>>();
  const outer = gridGeometry(width, columns, spacing, gutter);
  let y = 0;

  const pieceHeight = (piece: Piece, width: number) => piece.kind === "item" ? tileHeight(piece.item, width)
    : stackStyle === "burst" ? tileHeight(piece.run.cover, width) + BURST_EDGE
    : Math.round(width / flowRatio(piece.run.cover));

  /**
   * A run's outputs as justified rows: each full row as tall as makes its
   * images fill the width exactly, near a height a little over a column's
   * width. A run that doesn't fill a row grows a little toward it, then stops
   * where it ends, and the shelf ends with it. Returns how wide the rows are.
   */
  const rows = (run: Run) => {
    const target = Math.round(Math.min(380, Math.max(150, outer.columnWidth * 1.05)));
    let line: GalleryItem[] = [];
    let share = 0;
    let reach = 0;
    const flush = (last: boolean) => {
      if (!line.length) return;
      const room = width - spacing * (line.length - 1);
      const short = last && share * target < room;
      const height = Math.round(short ? Math.min(target * (y === rowsTop ? 1.3 : 1), room / share) : Math.min(target * 1.5, room / share));
      const fills = !short || share * height >= room - 1;
      let x = 0;
      line.forEach((item, index) => {
        // A full row's last image takes up any rounding, so the right edge stays straight.
        const w = index === line.length - 1 && fills ? width - x : Math.round(height * Math.max(0.2, ratioOf(item)));
        entries.push({ kind: "tile", key: itemKey(item), item, x, y, w, h: height, run });
        x += w + spacing;
      });
      reach = Math.max(reach, x - spacing);
      y += height + spacing;
      line = [];
      share = 0;
    };
    const rowsTop = y;
    for (const item of run.items) {
      line.push(item);
      share += Math.max(0.2, ratioOf(item));
      if (share * target + spacing * (line.length - 1) >= width) flush(false);
    }
    flush(true);
    return reach;
  };
  const pack = (pieces: Piece[], key: string, geometry: typeof outer, originX: number, run?: Run) => {
    if (!pieces.length) return;
    const isItem = (piece: Piece): piece is { kind: "item"; item: GalleryItem; run?: Run } => piece.kind === "item";
    const result = packMasonry({
      count: pieces.length,
      columns: geometry.columns,
      columnWidth: geometry.columnWidth,
      gap: spacing,
      keyOf: (index) => { const piece = pieces[index]; return isItem(piece) ? placementKey(piece.item) : piece.run.id; },
      heightOf: (index, span) => pieceHeight(pieces[index], span === 2 ? geometry.wideWidth : geometry.columnWidth),
      // A stack stays one column wide: its fanned cards need the room beside it.
      wideOf: (index) => { const piece = pieces[index]; return spanWide && isItem(piece) && ratioOf(piece.item) >= WIDE_RATIO; },
      previous: previous.get(key) || null,
      holding,
    });
    placements.set(key, result.placement);
    // Column by column, top to bottom, so Tab walks the masonry as it always has.
    result.lists.forEach((list, column) => {
      for (const index of list) {
        if (result.column[index] !== column) continue;
        const piece = pieces[index];
        const w = result.span[index] === 2 ? geometry.wideWidth : geometry.columnWidth;
        const x = originX + geometry.left(column);
        const top = y + result.top[index];
        const h = result.height[index];
        if (isItem(piece)) entries.push({ kind: "tile", key: itemKey(piece.item), item: piece.item, x, y: top, w, h, run: run || piece.run });
        else entries.push({ kind: "stack", key: piece.run.id, run: piece.run, x, y: top, w, h });
      }
    });
    y += result.total;
  };

  /**
   * Pulls tiles from the start of `next` into `pieces` while they fit in its
   * shortest column without reaching much past its tallest, the way masonry
   * would have placed them had the shelf come a little later.
   */
  const level = (pieces: Piece[], next: Piece[] | undefined, geometry: typeof outer) => {
    if (!next?.length || geometry.columns < 2) return;
    const heightOf = (piece: Piece) => pieceHeight(piece, geometry.columnWidth) + spacing;
    const bottoms = new Array(geometry.columns).fill(0);
    for (const piece of pieces) {
      const shortest = bottoms.indexOf(Math.min(...bottoms));
      bottoms[shortest] += heightOf(piece);
    }
    const slack = geometry.columnWidth * 0.3;
    for (let scanned = 0; scanned < geometry.columns * 2 && next.length;) {
      const tallest = Math.max(...bottoms);
      const shortest = bottoms.indexOf(Math.min(...bottoms));
      if (tallest - bottoms[shortest] < geometry.columnWidth * 0.25) break;
      const index = next.findIndex((piece, position) => position < geometry.columns * 2 - scanned && bottoms[shortest] + heightOf(piece) <= tallest + slack);
      if (index < 0) break;
      const [piece] = next.splice(index, 1);
      pieces.push(piece);
      bottoms[shortest] += heightOf(piece);
      scanned += index + 1;
    }
  };

  const sections: Array<Pick<Moment, "id"> & { moment?: Moment; items: GalleryItem[] }> = moments && groups
    ? groups.moments.map((moment) => ({ id: moment.id, moment, items: moment.items }))
    : [{ id: "all", items }];

  sections.forEach((section, sectionIndex) => {
    if (section.moment) {
      const h = sectionIndex === 0 ? MOMENT_HEAD_FIRST : MOMENT_HEAD;
      entries.push({ kind: "moment", key: section.id, moment: section.moment, x: 0, y, w: width, h, first: sectionIndex === 0 });
      y += h;
    }
    // The moment as stretches of masonry with open runs between them.
    const stretches: Piece[][] = [[]];
    const shelves: Run[] = [];
    const placed = new Set<string>();
    for (const item of section.items) {
      const run = stackRuns && groups ? groups.runOf.get(item.id) : undefined;
      if (!run) { stretches.at(-1)!.push({ kind: "item", item }); continue; }
      const open = openRuns.has(run.id);
      // Whatever is still generating stays in plain sight beside its stack.
      if (!open && item.status === "pending") { stretches.at(-1)!.push({ kind: "item", item }); continue; }
      if (placed.has(run.id)) continue;
      placed.add(run.id);
      if (!open) { stretches.at(-1)!.push({ kind: "stack", run }); continue; }
      shelves.push(run);
      stretches.push([]);
    }
    stretches.forEach((pieces, index) => {
      const shelf = shelves[index];
      // A shelf starts below the tallest column; the next few tiles fill the
      // shorter ones first, so opening a run doesn't leave a hole above it.
      if (shelf) level(pieces, stretches[index + 1], outer);
      pack(pieces, `${section.id}:${index}`, outer, 0);
      if (!shelf) return;
      const top = y;
      y += SHELF_HEAD;
      const reach = rows(shelf);
      y += SHELF_FOOT - spacing;
      // The shelf is as wide as its rows: a short run's line and ledge stop with it.
      entries.push({ kind: "shelf", key: `shelf:${shelf.id}`, run: shelf, x: 0, y: top, w: reach, h: y - top });
      y += spacing * 3;
    });
  });

  return { entries, total: y, placements };
}

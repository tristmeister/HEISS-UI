// Where every gallery tile goes: its column, whether it spans two, and its top.
// Plain JavaScript so `node --test` can check it without a build step; the
// types live beside it in masonry.d.ts.
//
// The grid is newest first, each tile in the shortest column (ties go left),
// so a reload gives the same layout and a tile that goes only moves the ones
// after it. With spanning on and three or more columns, a wide tile takes two
// neighbouring columns whose bottoms are level:
//
// - It may pull up to LOOK_AHEAD of the next narrow tiles in ahead of itself,
//   each onto the pair's shorter column, to even the pair out.
// - Failing that it waits while the next tiles fill the short columns, taking
//   the first pair that comes level, for at most LOOK_AHEAD more tiles.
// - After that it takes the best pair that leaves at most a column width times
//   GAP_SHARE empty under the shorter column; its own bottom is level, so the
//   wide tiles after it line up again. If no pair allows even that, it sits in
//   one column like any other tile.
//
// "Level" means within LEVEL_SHARE of a column's width, and a pair only counts
// while its top is within a column's width of the shortest column, so wide
// tiles can't pile up on one pair while the others fall behind.

/** Tiles at least this much wider than tall may take two columns. */
export const WIDE_RATIO = 1.4;
/** Spanning starts at three columns; at one or two a wide tile would fill the row. */
export const SPAN_MIN_COLUMNS = 3;
/** Two columns this close (a share of a column's width) count as level. */
export const LEVEL_SHARE = 0.1;
/** The most empty space a wide tile may ever leave under its shorter column, as a share of a column's width. */
export const GAP_SHARE = 0.25;
/** How far below the shortest column a pair's top may be, as a share of a column's width. */
export const DROP_SHARE = 1.5;
/** How many tiles a wide one may pull in ahead of itself, or wait for. */
export const LOOK_AHEAD = 4;
/** A pixel of empty space counts as much as landing this many pixels lower. */
const GAP_WEIGHT = 4;

/**
 * Lays out `count` tiles in list order (newest first).
 *
 * While `holding` (the pointer is over the grid) and the only change since
 * `previous` is tiles landing on top, the tiles already there keep their
 * column and span and the new ones take the top of whichever columns' top
 * tiles are oldest; anything else lays the grid out afresh.
 */
export function packMasonry({ count, columns, columnWidth, gap, keyOf, heightOf, wideOf, previous = null, holding = false }) {
  const columnCount = Math.max(1, columns);
  const spanning = columnCount >= SPAN_MIN_COLUMNS;
  const level = Math.round(columnWidth * LEVEL_SHARE);
  const maxGap = Math.round(columnWidth * GAP_SHARE);
  const maxDrop = Math.round(columnWidth * DROP_SHARE);
  const column = new Int32Array(count);
  const span = new Uint8Array(count);
  const top = new Float64Array(count);
  const height = new Float64Array(count);
  const bottoms = new Float64Array(columnCount);
  const lists = Array.from({ length: columnCount }, () => []);
  const slots = new Map();
  let placed = 0;

  const put = (index, target, width) => {
    const tileHeight = heightOf(index, width);
    const y = width === 2 ? Math.max(bottoms[target], bottoms[target + 1]) : bottoms[target];
    column[index] = target;
    span[index] = width;
    top[index] = y;
    height[index] = tileHeight;
    for (let current = target; current < target + width; current += 1) {
      bottoms[current] = y + tileHeight + gap;
      lists[current].push(index);
    }
    slots.set(keyOf(index), { column: target, span: width, order: placed });
    placed += 1;
  };
  const shortest = () => {
    let target = 0;
    for (let current = 1; current < columnCount; current += 1) if (bottoms[current] < bottoms[target]) target = current;
    return target;
  };

  const hold = holding && previous ? holdPlan(count, columnCount, spanning, keyOf, previous) : null;
  if (hold) {
    // Tiles already there keep their column and span. The new ones go oldest
    // first onto the column whose top tile is oldest (a wide one onto the pair
    // whose newer top tile is oldest), with the column that holds less
    // breaking a tie, the way results landed before the grid went greedy.
    const { firstKnown, known } = hold;
    const filled = new Float64Array(columnCount);
    const topOrder = new Float64Array(columnCount).fill(Infinity);
    for (const index of known) {
      const slot = previous.get(keyOf(index));
      const size = heightOf(index, slot.span) + gap;
      for (let current = slot.column; current < slot.column + slot.span; current += 1) {
        filled[current] += size;
        if (topOrder[current] === Infinity) topOrder[current] = slot.order;
      }
    }
    const landing = new Array(firstKnown);
    for (let index = firstKnown - 1; index >= 0; index -= 1) {
      const width = spanning && wideOf(index) ? 2 : 1;
      let target = 0;
      for (let current = 1; current + width <= columnCount; current += 1) {
        const age = width === 2 ? Math.min(topOrder[current], topOrder[current + 1]) : topOrder[current];
        const targetAge = width === 2 ? Math.min(topOrder[target], topOrder[target + 1]) : topOrder[target];
        const fill = width === 2 ? Math.max(filled[current], filled[current + 1]) : filled[current];
        const targetFill = width === 2 ? Math.max(filled[target], filled[target + 1]) : filled[target];
        if (age > targetAge || (age === targetAge && fill < targetFill)) target = current;
      }
      const size = heightOf(index, width) + gap;
      for (let current = target; current < target + width; current += 1) {
        filled[current] += size;
        topOrder[current] = index - firstKnown;
      }
      landing[index] = { column: target, span: width };
    }
    for (let index = 0; index < firstKnown; index += 1) put(index, landing[index].column, landing[index].span);
    for (const index of known) {
      const slot = previous.get(keyOf(index));
      put(index, slot.column, slot.span);
    }
  } else {
    const done = new Uint8Array(count);
    const waiting = [];
    const settle = (position) => {
      while (waiting.length) {
        const even = levelPair(bottoms, columnCount, [], level, maxDrop);
        if (even) {
          put(waiting.shift(), even.column, 2);
          continue;
        }
        if (position - waiting[0] < LOOK_AHEAD) break;
        const nearest = levelPair(bottoms, columnCount, [], maxGap, maxDrop);
        if (nearest) put(waiting.shift(), nearest.column, 2);
        else put(waiting.shift(), shortest(), 1);
      }
    };
    for (let index = 0; index < count; index += 1) {
      if (done[index]) continue;
      done[index] = 1;
      if (!spanning || !wideOf(index)) {
        put(index, shortest(), 1);
        settle(index);
        continue;
      }
      if (!waiting.length) {
        const ahead = [];
        for (let next = index + 1, seen = 0; next < count && seen < LOOK_AHEAD; next += 1) {
          if (done[next]) continue;
          seen += 1;
          if (!wideOf(next)) ahead.push(next);
        }
        const choice = levelPair(bottoms, columnCount, ahead.map((next) => heightOf(next, 1) + gap), level, maxDrop);
        if (choice) {
          for (const [position, target] of choice.pulls) {
            done[ahead[position]] = 1;
            put(ahead[position], target, 1);
          }
          put(index, choice.column, 2);
          continue;
        }
      }
      waiting.push(index);
      settle(index);
    }
    settle(Infinity);
  }

  let total = 0;
  for (let current = 0; current < columnCount; current += 1) total = Math.max(total, bottoms[current]);
  return { column, span, top, height, lists, total, placement: slots };
}

/**
 * Whether the grid can hold still: the tiles are the previous ones with new
 * ones only on top. Gives where the known tiles start and them in their old
 * stacking order.
 */
function holdPlan(count, columnCount, spanning, keyOf, previous) {
  let firstKnown = -1;
  let seen = 0;
  for (let index = 0; index < count; index += 1) {
    const slot = previous.get(keyOf(index));
    if (!slot) {
      if (firstKnown >= 0) return null;
      continue;
    }
    if (slot.column + slot.span > columnCount || (slot.span === 2 && !spanning)) return null;
    if (firstKnown < 0) firstKnown = index;
    seen += 1;
  }
  // Hold only for results landing on top of tiles that are all where they were.
  if (firstKnown <= 0 || seen < previous.size) return null;
  const known = [];
  for (let index = firstKnown; index < count; index += 1) known.push(index);
  known.sort((a, b) => previous.get(keyOf(a)).order - previous.get(keyOf(b)).order);
  return { firstKnown, known };
}

/**
 * The best neighbouring pair for a wide tile, given the column bottoms and the
 * heights of the narrow tiles it may pull in first (each onto the pair's
 * shorter column). Scores where the tile lands plus the space it leaves empty,
 * weighed heavier. Pairs leaving more than `tolerance` empty, or whose top sits
 * more than `maxDrop` below the shortest column, are out. Ties go to fewer
 * pulled tiles, then the leftmost pair.
 */
function levelPair(bottoms, columnCount, sizes, tolerance, maxDrop) {
  let best = null;
  const options = 1 << sizes.length;
  let lowest = bottoms[0];
  for (let current = 1; current < columnCount; current += 1) lowest = Math.min(lowest, bottoms[current]);
  for (let target = 0; target + 1 < columnCount; target += 1) {
    if (Math.max(bottoms[target], bottoms[target + 1]) - lowest > maxDrop) continue;
    for (let mask = 0; mask < options; mask += 1) {
      let left = bottoms[target];
      let right = bottoms[target + 1];
      let pulled = 0;
      for (let position = 0; position < sizes.length; position += 1) {
        if (!(mask & (1 << position))) continue;
        pulled += 1;
        if (left <= right) left += sizes[position];
        else right += sizes[position];
      }
      const empty = Math.abs(left - right);
      if (empty > tolerance) continue;
      const score = Math.max(left, right) + GAP_WEIGHT * empty;
      if (!best || score < best.score || (score === best.score && pulled < best.pulled)) best = { score, pulled, target, mask };
    }
  }
  if (!best) return null;
  const pulls = [];
  let left = bottoms[best.target];
  let right = bottoms[best.target + 1];
  for (let position = 0; position < sizes.length; position += 1) {
    if (!(best.mask & (1 << position))) continue;
    if (left <= right) {
      pulls.push([position, best.target]);
      left += sizes[position];
    } else {
      pulls.push([position, best.target + 1]);
      right += sizes[position];
    }
  }
  return { column: best.target, pulls };
}

/** Index of the first tile in a column's list whose bottom reaches `y`. */
export function firstReaching(list, top, height, y) {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const index = list[middle];
    if (top[index] + height[index] < y) low = middle + 1;
    else high = middle;
  }
  return low;
}

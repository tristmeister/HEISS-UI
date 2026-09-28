import assert from "node:assert/strict";
import test from "node:test";
import { GAP_SHARE, LEVEL_SHARE, LOOK_AHEAD, packMasonry } from "../src/app/masonry.js";

const GAP = 7;
const WIDTH = 1600;
const columnWidthFor = (columns) => Math.floor((WIDTH - GAP * (columns - 1)) / columns);
const wideWidthFor = (columns) => Math.floor(2 * ((WIDTH - GAP * (columns - 1)) / columns) + GAP);
const ratios = [9 / 16, 2 / 3, 3 / 4, 1, 4 / 3, 1216 / 832, 3 / 2, 16 / 9, 21 / 9];

function random(seed) {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
}

/** Tiles in runs of one to `run` images the same shape, as generations come. */
function tiles(count, seed = 1, run = 4) {
  const next = random(seed);
  const out = [];
  while (out.length < count) {
    const ratio = ratios[Math.floor(next() * ratios.length)];
    const length = 1 + Math.floor(next() * run);
    for (let step = 0; step < length && out.length < count; step += 1) out.push({ key: `t${out.length}`, ratio });
  }
  return out;
}

function pack(items, columns, extra = {}) {
  const columnWidth = columnWidthFor(columns);
  const wideWidth = wideWidthFor(columns);
  return packMasonry({
    count: items.length,
    columns,
    columnWidth,
    gap: GAP,
    keyOf: (index) => items[index].key,
    heightOf: (index, span) => Math.max(120, Math.round((span === 2 ? wideWidth : columnWidth) / items[index].ratio)),
    wideOf: (index) => items[index].ratio >= 1.4,
    ...extra,
  });
}

/** The gallery's layout before spanning, column choice and stacking as it was. */
function reference(items, columns, { previous = null, holding = false } = {}) {
  const width = columnWidthFor(columns);
  const size = (item) => Math.max(120, Math.round(width / item.ratio)) + GAP;
  const assigned = new Map();
  const heights = Array.from({ length: columns }, () => 0);
  const place = (item, column) => { assigned.set(item.key, column); heights[column] += size(item); };
  const shortest = () => {
    let target = 0;
    for (let column = 1; column < columns; column += 1) if (heights[column] < heights[target]) target = column;
    return target;
  };
  const present = new Set(items.map((item) => item.key));
  const removed = previous ? Array.from(previous.keys()).some((key) => !present.has(key)) : false;
  const known = (item) => previous?.get(item.key) !== undefined;
  const firstKnown = items.findIndex(known);
  const holdable = holding && previous && !removed && firstKnown > 0 && items.slice(firstKnown).every(known);
  if (!holdable) {
    for (const item of items) place(item, shortest());
  } else {
    for (const item of items.slice(firstKnown)) place(item, previous.get(item.key));
    const top = Array.from({ length: columns }, () => Infinity);
    items.forEach((item, index) => {
      const column = assigned.get(item.key);
      if (column !== undefined && top[column] === Infinity) top[column] = index;
    });
    for (let index = firstKnown - 1; index >= 0; index -= 1) {
      let target = 0;
      for (let column = 1; column < columns; column += 1) {
        if (top[column] > top[target] || (top[column] === top[target] && heights[column] < heights[target])) target = column;
      }
      place(items[index], target);
      top[target] = index;
    }
  }
  const bottoms = Array.from({ length: columns }, () => 0);
  const tops = items.map((item) => {
    const column = assigned.get(item.key);
    const y = bottoms[column];
    bottoms[column] += size(item);
    return y;
  });
  return { columns: items.map((item) => assigned.get(item.key)), tops, map: assigned };
}

/** Empty space above each tile in each of its columns. */
function gapsOf(layout) {
  const gaps = [];
  for (const list of layout.lists) {
    let bottom = 0;
    for (const index of list) {
      gaps.push({ index, gap: layout.top[index] - bottom });
      bottom = layout.top[index] + layout.height[index] + GAP;
    }
  }
  return gaps;
}

test("with spanning off, the layout matches the gallery's greedy newest-first one", () => {
  for (const columns of [1, 2, 3, 4, 6]) {
    const items = tiles(600, columns);
    const layout = pack(items, columns, { wideOf: () => false });
    const expected = reference(items, columns);
    assert.deepEqual(Array.from(layout.column), expected.columns);
    assert.deepEqual(Array.from(layout.top), expected.tops);
    assert.ok(layout.span.every((span) => span === 1));
  }
});

test("with spanning off, holding matches the gallery's old holding too", () => {
  const columns = 5;
  const before = tiles(80, 3);
  const first = pack(before, columns, { wideOf: () => false });
  const landed = [{ key: "new-a", ratio: 16 / 9 }, { key: "new-b", ratio: 2 / 3 }, { key: "new-c", ratio: 1 }];
  const items = [...landed, ...before];
  const layout = pack(items, columns, { wideOf: () => false, previous: first.placement, holding: true });
  const previous = new Map(Array.from(first.placement, ([key, slot]) => [key, slot.column]));
  const expected = reference(items, columns, { previous, holding: true });
  assert.deepEqual(Array.from(layout.column), expected.columns);
  assert.deepEqual(Array.from(layout.top), expected.tops);
});

test("nothing spans below three columns", () => {
  for (const columns of [1, 2]) {
    const items = tiles(300, 5).map((item) => ({ ...item, ratio: 16 / 9 }));
    const layout = pack(items, columns);
    assert.ok(layout.span.every((span) => span === 1));
    assert.deepEqual(Array.from(layout.column), reference(items, columns).columns);
  }
});

test("wide tiles span two columns from three up", () => {
  for (const columns of [3, 4, 6]) {
    const items = Array.from({ length: 30 }, (_, index) => ({ key: `w${index}`, ratio: 16 / 9 }));
    const layout = pack(items, columns);
    // Level columns take a run of landscapes two columns at a time.
    for (let index = 0; index < Math.floor(columns / 2); index += 1) {
      assert.equal(layout.span[index], 2);
      assert.equal(layout.top[index], 0);
      assert.equal(layout.column[index], index * 2);
    }
    const narrow = [{ key: "square", ratio: 1 }, { key: "portrait", ratio: 2 / 3 }, { key: "four-three", ratio: 4 / 3 }];
    assert.ok(pack(narrow, columns).span.every((span) => span === 1));
  }
});

test("a wide tile pulls a following narrow tile in to level its pair", () => {
  const columns = 3;
  const width = columnWidthFor(columns);
  // Column 0 twice as tall as column 1, column 2 empty: no pair is level.
  const items = [
    { key: "tall", ratio: width / (2 * width) },
    { key: "short", ratio: width / width },
    { key: "wide", ratio: 16 / 9 },
    { key: "fill", ratio: 1 },
  ];
  const layout = pack(items, columns);
  const wide = 2;
  const fill = 3;
  assert.equal(layout.span[wide], 2);
  assert.equal(layout.column[wide], 1);
  // The square went into the empty column first, so the pair came out level.
  assert.equal(layout.column[fill], 2);
  assert.equal(layout.top[fill], 0);
  assert.equal(layout.top[wide], layout.top[1] + layout.height[1] + GAP);
  assert.equal(layout.top[wide], layout.top[fill] + layout.height[fill] + GAP);
  assert.deepEqual(layout.lists[2], [fill, wide]);
});

test("empty space above a spanning tile stays within the gap tolerance, and narrow tiles never leave any", () => {
  for (const columns of [3, 4, 5, 6]) {
    const maxGap = Math.round(columnWidthFor(columns) * GAP_SHARE);
    for (const seed of [1, 2, 3]) {
      const layout = pack(tiles(4000, seed * 7 + columns, seed * 4), columns);
      for (const { index, gap } of gapsOf(layout)) {
        if (layout.span[index] === 1) assert.equal(gap, 0);
        else assert.ok(gap <= maxGap, `gap ${gap} over ${maxGap}`);
      }
    }
  }
});

test("most wide tiles span, and most of them sit level", () => {
  const columns = 6;
  const items = tiles(6000, 11);
  const layout = pack(items, columns);
  const wide = items.map((item, index) => index).filter((index) => items[index].ratio >= 1.4);
  const spanning = wide.filter((index) => layout.span[index] === 2);
  assert.ok(spanning.length / wide.length > 0.7, `only ${spanning.length} of ${wide.length} span`);
  const level = Math.round(columnWidthFor(columns) * LEVEL_SHARE);
  const uneven = gapsOf(layout).filter(({ gap }) => gap > level);
  assert.ok(uneven.length / items.length < 0.03, `${uneven.length} visible gaps`);
});

test("a tile moves at most a few places out of list order", () => {
  const columns = 4;
  const items = tiles(3000, 5);
  const layout = pack(items, columns);
  const byOrder = new Array(items.length);
  items.forEach((item, index) => { byOrder[layout.placement.get(item.key).order] = index; });
  byOrder.forEach((index, position) => assert.ok(Math.abs(index - position) <= LOOK_AHEAD * 2, `${index} placed ${position}th`));
});

test("a finished image keeps its pending tile's place", () => {
  const columns = 5;
  const before = tiles(200, 9);
  // Pending tiles are keyed by run and position and sized from the settings.
  const pending = [{ key: "job:0", ratio: 16 / 9, id: "pending-0" }, { key: "job:1", ratio: 16 / 9, id: "pending-1" }];
  const finished = pending.map((item) => ({ ...item, id: `output-${item.key}` }));
  const a = pack([...pending, ...before], columns);
  const b = pack([...finished, ...before], columns);
  assert.equal(a.span[0], 2);
  for (const layout of [a, b]) assert.ok(layout.span[0] === 2 && layout.span[1] === 2);
  assert.deepEqual(Array.from(a.column), Array.from(b.column));
  assert.deepEqual(Array.from(a.top), Array.from(b.top));
});

test("while holding, tiles already there stay put and new ones take the oldest tops", () => {
  const columns = 4;
  const before = tiles(60, 13);
  const first = pack(before, columns);
  const landed = [{ key: "new-wide", ratio: 16 / 9 }, { key: "new-square", ratio: 1 }];
  const items = [...landed, ...before];
  const held = pack(items, columns, { previous: first.placement, holding: true });
  for (let index = landed.length; index < items.length; index += 1) {
    const slot = first.placement.get(items[index].key);
    assert.equal(held.column[index], slot.column);
    assert.equal(held.span[index], slot.span);
  }
  // Each new tile sits on top of its column(s).
  for (let index = 0; index < landed.length; index += 1) {
    for (let column = held.column[index]; column < held.column[index] + held.span[index]; column += 1) {
      assert.ok(held.lists[column].indexOf(index) <= 1);
    }
  }
  assert.equal(held.span[0], 2);
  // The square is the older of the two, so it went first, onto the column whose top tile was oldest.
  const topOrder = (column) => first.placement.get(before[first.lists[column][0]].key).order;
  const oldest = Math.max(...[0, 1, 2, 3].map(topOrder));
  assert.equal(topOrder(held.column[1]), oldest);
  // Not holding, the new tiles lay the grid out afresh from the top left.
  const settled = pack(items, columns, { previous: first.placement, holding: false });
  assert.deepEqual(Array.from(settled.column), Array.from(pack(items, columns).column));
});

test("holding lets go when a tile is gone or one lands below", () => {
  const columns = 4;
  const before = tiles(40, 17);
  const first = pack(before, columns);
  const fresh = Array.from(pack([{ key: "x", ratio: 1 }, ...before.slice(1)], columns).column);
  const afterRemoval = pack([{ key: "x", ratio: 1 }, ...before.slice(1)], columns, { previous: first.placement, holding: true });
  assert.deepEqual(Array.from(afterRemoval.column), fresh);
  const below = [...before, { key: "older", ratio: 1 }];
  assert.deepEqual(Array.from(pack(below, columns, { previous: first.placement, holding: true }).column), Array.from(pack(below, columns).column));
});

test("the same tiles always give the same layout", () => {
  const items = tiles(2000, 21);
  const a = pack(items, 6);
  const b = pack(items.map((item) => ({ ...item })), 6);
  assert.deepEqual(Array.from(a.column), Array.from(b.column));
  assert.deepEqual(Array.from(a.span), Array.from(b.span));
  assert.deepEqual(Array.from(a.top), Array.from(b.top));
  assert.equal(a.total, b.total);
});

test("50,000 tiles lay out well within a frame budget", () => {
  const items = tiles(50000, 23);
  pack(items, 6);
  const started = performance.now();
  const layout = pack(items, 6);
  const elapsed = performance.now() - started;
  assert.equal(layout.placement.size, 50000);
  assert.ok(elapsed < 100, `took ${elapsed.toFixed(1)} ms`);
});

import test from "node:test";
import assert from "node:assert/strict";
import { galleryStats } from "./stats.js";

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
const done = (createdAt, extra = {}) => ({ status: "done", type: "image", createdAt, durationMs: 1000, width: 1000, height: 1000, ...extra });

test("counts outputs, render time and megapixels, ignoring unfinished items", () => {
  const stats = galleryStats([done(at(2026, 9, 1)), done(at(2026, 9, 1), { type: "video" }), { status: "error", createdAt: at(2026, 9, 1) }], new Date(2026, 8, 1));
  assert.equal(stats.outputs, 2);
  assert.equal(stats.images, 1);
  assert.equal(stats.videos, 1);
  assert.equal(stats.renderMs, 2000);
  assert.equal(stats.megapixels, 2);
});

test("streaks run over consecutive days, and the current one survives until tomorrow", () => {
  const items = [1, 2, 3, 7, 8, 9, 10, 20, 21].map((day) => done(at(2026, 9, day)));
  assert.equal(galleryStats(items, new Date(2026, 8, 21, 18)).currentStreak, 2);
  assert.equal(galleryStats(items, new Date(2026, 8, 22, 9)).currentStreak, 2);
  assert.equal(galleryStats(items, new Date(2026, 8, 23, 9)).currentStreak, 0);
  assert.equal(galleryStats(items, new Date(2026, 8, 21)).longestStreak, 4);
  assert.equal(galleryStats(items, new Date(2026, 8, 21)).activeDays, 9);
});

test("streaks cross month boundaries", () => {
  const items = [at(2026, 8, 30), at(2026, 8, 31), at(2026, 9, 1)].map((day) => done(day));
  assert.equal(galleryStats(items, new Date(2026, 8, 1)).longestStreak, 3);
});

test("reports the most used workflow and busiest day", () => {
  const items = [done(at(2026, 9, 2), { settings: { profileId: "a" } }), done(at(2026, 9, 2), { settings: { profileId: "b" } }), done(at(2026, 9, 3), { settings: { profileId: "a" } })];
  const stats = galleryStats(items, new Date(2026, 8, 3));
  assert.equal(stats.topWorkflow, "a");
  assert.equal(stats.topWorkflowCount, 2);
  assert.equal(stats.busiestCount, 2);
});

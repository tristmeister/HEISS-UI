import assert from "node:assert/strict";
import test from "node:test";
import { groupGallery, momentTitle, promptSimilarity, promptWords, runTitle } from "../src/app/runs.js";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
// Monday 6 October 2026, 21:00 local.
const NOW = new Date(2026, 9, 6, 21, 0).getTime();

let next = 0;
function item(minutesAgo, prompt, extra = {}) {
  next += 1;
  return { id: `i${next}`, status: "done", type: "image", prompt, model: "flux-dev", createdAt: new Date(NOW - minutesAgo * MINUTE).toISOString(), ...extra };
}
/** Newest first, as the gallery is. */
const newestFirst = (items) => items.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

const hermione = (film, place = "in the Hogwarts library") => `Hermione Granger reading old books ${place}, scene from Harry Potter and the ${film}, cinematic film still, 35mm, soft light`;

test("a tweaked prompt is still alike, a different idea is not", () => {
  const base = promptWords(hermione("Prisoner of Azkaban"));
  assert.ok(promptSimilarity(base, promptWords(hermione("Goblet of Fire"))) > 0.7);
  assert.ok(promptSimilarity(base, promptWords(hermione("Goblet of Fire", "on a sunny beach"))) > 0.6);
  assert.ok(promptSimilarity(base, promptWords("cyberpunk city street at night, neon rain, cinematic film still, 35mm")) < 0.35);
});

test("LoRA tags and weights don't count as words", () => {
  assert.deepEqual([...promptWords("(red fox:1.3), <lora:detail:0.8> forest")], ["red", "fox", "forest"]);
});

test("a prompt edited a little at a time stays one run", () => {
  const items = newestFirst([
    item(50, hermione("Prisoner of Azkaban")),
    item(48, hermione("Prisoner of Azkaban")),
    item(45, hermione("Goblet of Fire")),
    item(40, hermione("Goblet of Fire", "in the Gryffindor common room")),
    item(35, hermione("Half-Blood Prince", "in the Gryffindor common room")),
    item(30, "a watercolor fox sleeping in the snow"),
    item(25, "a watercolor fox sleeping in the snow"),
    item(20, "a watercolor fox sleeping in deep snow at dawn"),
  ]);
  const { runs, moments } = groupGallery(items, { now: NOW });
  assert.equal(moments.length, 1);
  assert.equal(runs.length, 2);
  const sizes = runs.map((run) => run.items.length).sort();
  assert.deepEqual(sizes, [3, 5]);
  const fox = runs.find((run) => run.items.length === 3);
  assert.equal(runTitle(fox), "A watercolor fox sleeping in deep snow at dawn");
  assert.equal(fox.variations, 2);
});

test("interleaved ideas still find their own runs", () => {
  const items = newestFirst([
    item(30, "portrait of an old fisherman, rembrandt lighting"),
    item(29, "isometric tiny island with a lighthouse, low poly"),
    item(28, "portrait of an old fisherman, rembrandt lighting, wool hat"),
    item(27, "isometric tiny island with a lighthouse, low poly, sunset"),
    item(26, "portrait of an old fisherman, rembrandt lighting, pipe"),
    item(25, "isometric tiny island with a lighthouse and boats, low poly"),
  ]);
  const { runs } = groupGallery(items, { now: NOW });
  assert.equal(runs.length, 2);
  for (const run of runs) assert.equal(run.items.length, 3);
});

test("one batch is a run even without a prompt in common", () => {
  const items = newestFirst([1, 2, 3].map((index) => item(10 - index, index === 2 ? "" : `x${index}`, { jobId: "job-1" })));
  assert.equal(groupGallery(items, { now: NOW }).runs.length, 1);
});

test("fewer than three outputs, a different type or failures don't stack", () => {
  const pair = newestFirst([item(5, "a red bicycle"), item(4, "a red bicycle")]);
  assert.equal(groupGallery(pair, { now: NOW }).runs.length, 0);
  const mixed = newestFirst([item(5, "a red bicycle"), item(4, "a red bicycle", { type: "video" }), item(3, "a red bicycle", { status: "error" })]);
  assert.equal(groupGallery(mixed, { now: NOW }).runs.length, 0);
});

test("a run with something still generating is live", () => {
  const items = newestFirst([item(3, "a red bicycle"), item(2, "a red bicycle"), item(1, "a red bicycle"), item(0, "a red bicycle", { status: "pending" })]);
  const [run] = groupGallery(items, { now: NOW }).runs;
  assert.equal(run.live, true);
  assert.equal(run.count, 3);
  assert.equal(run.items.length, 4);
});

test("an evening running into the night is one moment, a morning and an evening are two", () => {
  const evening = new Date(2026, 9, 5, 19, 0).getTime();
  const items = newestFirst([
    { ...item(0, "a"), createdAt: new Date(evening).toISOString() },
    { ...item(0, "b"), createdAt: new Date(evening + 2 * HOUR).toISOString() },
    { ...item(0, "c"), createdAt: new Date(evening + 4 * HOUR + 30 * MINUTE).toISOString() },
    { ...item(0, "d"), createdAt: new Date(2026, 9, 6, 7, 30).toISOString() },
    { ...item(0, "e"), createdAt: new Date(2026, 9, 6, 19, 30).toISOString() },
  ]);
  const { moments } = groupGallery(items, { now: NOW });
  assert.deepEqual(moments.map((moment) => moment.title), ["This evening", "This morning", "Yesterday evening"]);
  assert.equal(moments[2].items.length, 3);
});

test("moments are named the way you'd say them", () => {
  const at = (day, hour) => new Date(2026, 9, day, hour, 0).getTime();
  assert.equal(momentTitle(at(6, 14), at(6, 15), NOW).title, "This afternoon");
  assert.equal(momentTitle(at(6, 23), at(6, 23), at(7, 1)).title, "Tonight");
  // The small hours belong to the evening before.
  assert.equal(momentTitle(at(6, 2), at(6, 3), NOW).title, "Last night");
  assert.equal(momentTitle(at(5, 9), at(5, 19), NOW).title, "Yesterday");
  assert.match(momentTitle(at(2, 20), at(2, 21), NOW).title, /evening$/);
  const older = momentTitle(at(1, 9), at(1, 10), at(20, 12));
  assert.equal(older.part, "Morning");
});

test("the same prompt more than six hours later starts a new run, within six hours it doesn't", () => {
  const at = (minutesAgo) => item(minutesAgo, "a red lighthouse on a cliff at dusk");
  const apart = newestFirst([at(10), at(11), at(12), at(7 * 60), at(7 * 60 + 1), at(7 * 60 + 2)]);
  assert.equal(groupGallery(apart, { now: NOW }).runs.length, 2);
  // Five hours apart crosses a moment (three hours) but not a run.
  const close = newestFirst([at(10), at(11), at(12), at(5 * 60), at(5 * 60 + 1), at(5 * 60 + 2)]);
  const { runs, moments } = groupGallery(close, { now: NOW });
  assert.equal(moments.length, 2);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].items.length, 6);
});

test("a run is quiet from its newest output", () => {
  const items = newestFirst([item(30, "a blue vase"), item(20, "a blue vase"), item(9, "a blue vase")]);
  const [run] = groupGallery(items, { now: NOW }).runs;
  assert.equal(run.end, NOW - 9 * MINUTE);
});

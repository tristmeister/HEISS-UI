import test from "node:test";
import assert from "node:assert/strict";
import { cancelPrompt, cancelPrompts, isTransientComfyError, promptTracker, queuePlace } from "./comfy-queue.js";

/** A fake ComfyUI: answers by path from a table, records every call. */
function fakeComfy(routes) {
  const calls = [];
  const request = async (pathname, options = {}) => {
    calls.push({ pathname, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
    const route = routes[`${options.method || "GET"} ${pathname}`] ?? routes[pathname];
    if (typeof route === "function") return route(options);
    if (route instanceof Error) throw route;
    if (route === undefined) throw Object.assign(new Error("Comfy 404: Not Found"), { status: 404 });
    return route;
  };
  return { request, calls };
}

const entry = (id) => [1, id, {}, {}, []];
const refused = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });

test("queuePlace reads running and pending entries", () => {
  const queue = { queue_running: [entry("a")], queue_pending: [entry("b"), entry("c")] };
  assert.equal(queuePlace(queue, "a"), "running");
  assert.equal(queuePlace(queue, "c"), "pending");
  assert.equal(queuePlace(queue, "z"), "");
  assert.equal(queuePlace(null, "a"), "");
});

test("a current ComfyUI cancels through its atomic jobs route", async () => {
  const { request, calls } = fakeComfy({ "POST /api/jobs/p1/cancel": { cancelled: true } });
  assert.equal(await cancelPrompt("p1", request), "canceled");
  assert.deepEqual(calls.map((call) => call.pathname), ["/api/jobs/p1/cancel"]);
});

test("an older ComfyUI: a pending prompt is only dequeued, never interrupted", async () => {
  let deleted = false;
  const { request, calls } = fakeComfy({
    "GET /queue": () => ({ queue_running: [entry("other")], queue_pending: deleted ? [] : [entry("p1")] }),
    "POST /queue": () => { deleted = true; return {}; }
  });
  assert.equal(await cancelPrompt("p1", request), "pending");
  assert.ok(!calls.some((call) => call.pathname === "/interrupt"), "the other job keeps running");
  assert.deepEqual(calls.find((call) => call.method === "POST" && call.pathname === "/queue").body, { delete: ["p1"] });
});

test("an older ComfyUI: only the prompt that is running gets interrupted, by id", async () => {
  const { request, calls } = fakeComfy({
    "GET /queue": { queue_running: [entry("p1")], queue_pending: [] },
    "POST /interrupt": {}
  });
  assert.equal(await cancelPrompt("p1", request), "running");
  assert.deepEqual(calls.find((call) => call.pathname === "/interrupt").body, { prompt_id: "p1" });
});

test("a prompt that is neither queued nor running is left alone", async () => {
  const { request, calls } = fakeComfy({ "GET /queue": { queue_running: [entry("someone-else")], queue_pending: [] } });
  assert.equal(await cancelPrompt("gone", request), "");
  assert.ok(!calls.some((call) => call.pathname === "/interrupt" || (call.pathname === "/queue" && call.method === "POST")));
});

test("cancelPrompts never clears the whole queue and reports failures", async () => {
  const { request, calls } = fakeComfy({
    "POST /api/jobs/a/cancel": { cancelled: true },
    "POST /api/jobs/b/cancel": refused(),
    "GET /queue": refused()
  });
  assert.equal(await cancelPrompts(["a", "b", "a", ""], request), 1);
  assert.ok(!calls.some((call) => call.body?.clear), "no queue clear");
});

test("transient errors are network trouble and 5xx, not answers", () => {
  assert.equal(isTransientComfyError(refused()), true);
  assert.equal(isTransientComfyError(Object.assign(new Error("timed out"), { name: "TimeoutError" })), true);
  assert.equal(isTransientComfyError(Object.assign(new Error("Comfy 502"), { status: 502 })), true);
  assert.equal(isTransientComfyError(Object.assign(new Error("Comfy 400"), { status: 400 })), false);
  assert.equal(isTransientComfyError(new Error("something else")), false);
});

test("the tracker waits out a blip and then recovers the finished run", async () => {
  let clock = 0;
  let down = true;
  const { request } = fakeComfy({
    "/history/p1": () => { if (down) throw refused(); return { p1: { outputs: {} } }; },
    "/queue": { queue_running: [], queue_pending: [] }
  });
  const tracker = promptTracker("p1", { request, now: () => clock, lostAfterMs: 60_000 });
  const first = await tracker.check();
  assert.equal(first.state, "reconnecting");
  assert.equal(first.delayMs, 1000);
  clock += 20_000;
  const second = await tracker.check();
  assert.equal(second.state, "reconnecting");
  assert.equal(second.delayMs, 2000);
  down = false;
  const done = await tracker.check();
  assert.equal(done.state, "done");
  assert.equal(done.reconnected, true);
});

test("the tracker gives up after a minute without any sign of life", async () => {
  let clock = 0;
  const { request } = fakeComfy({ "/history/p1": () => { throw refused(); } });
  const tracker = promptTracker("p1", { request, now: () => clock, lostAfterMs: 60_000 });
  await tracker.check();
  clock = 30_000;
  // A progress message on the socket shows ComfyUI is busy, not gone.
  tracker.alive();
  clock = 80_000;
  assert.equal((await tracker.check()).state, "reconnecting");
  clock = 95_000;
  await assert.rejects(() => tracker.check(), (error) => error.lostConnection === true);
});

test("a prompt missing from queue and history after a reconnect fails as dropped", async () => {
  let clock = 0;
  let down = true;
  const { request } = fakeComfy({
    "/history/p1": () => { if (down) throw refused(); return {}; },
    "/queue": { queue_running: [], queue_pending: [] }
  });
  const tracker = promptTracker("p1", { request, now: () => clock });
  await tracker.check();
  down = false;
  clock = 5000;
  // The first miss could be ComfyUI's unlocked queue read; the second is not.
  assert.equal((await tracker.check()).state, "waiting");
  await assert.rejects(() => tracker.check(), (error) => error.droppedRun === true);
});

test("a queued prompt keeps waiting through the periodic check", async () => {
  const { request, calls } = fakeComfy({
    "/history/p1": {},
    "/queue": { queue_running: [entry("x")], queue_pending: [entry("p1")] }
  });
  const tracker = promptTracker("p1", { request, verifyEvery: 2 });
  assert.equal((await tracker.check()).state, "waiting");
  assert.equal((await tracker.check()).state, "waiting");
  assert.equal(calls.filter((call) => call.pathname === "/queue").length, 1);
});

test("a run that finishes between the history and queue reads is found, not dropped", async () => {
  let reads = 0;
  const { request } = fakeComfy({
    "/history/p1": () => (++reads >= 3 ? { p1: { outputs: {} } } : {}),
    "/queue": { queue_running: [], queue_pending: [] }
  });
  const tracker = promptTracker("p1", { request, verifyEvery: 2 });
  assert.equal((await tracker.check()).state, "waiting");
  assert.equal((await tracker.check()).state, "done");
});

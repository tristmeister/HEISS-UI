import assert from "node:assert/strict";
import test from "node:test";
import { jobPollDelay, POLL_MS } from "../src/app/job-poll.js";

const NOW = 1_000_000;
const at = (job, options = {}) => jobPollDelay(job, { serverNow: NOW, ...options });
const step = (value, max, extra = {}) => ({ status: "running", progress: { value, max, phase: "Step", steps: true, ...extra } });

test("the first ask comes quickly, waiting in the queue asks slowly", () => {
  assert.equal(at(null), POLL_MS.first);
  assert.equal(at({ status: "queued" }), POLL_MS.queued);
  assert.ok(POLL_MS.queued > POLL_MS.running);
});

test("mid-run asks every second, the last step and the save after it much more often", () => {
  assert.equal(at(step(3, 30)), POLL_MS.running);
  assert.equal(at(step(29, 30)), POLL_MS.closing);
  assert.equal(at(step(30, 30)), POLL_MS.closing);
  assert.equal(at({ status: "running", progress: { value: 0, max: 0, phase: "Decoding", steps: false } }), POLL_MS.closing);
  assert.equal(at({ status: "running", progress: { value: 0, max: 0, phase: "Saving", steps: false } }), POLL_MS.closing);
  assert.equal(at({ status: "running", progress: { value: 0, max: 0, phase: "Loading model", steps: false } }), POLL_MS.running);
  assert.ok(POLL_MS.closing < 500);
});

test("an honest estimate decides: its last seconds are the last stretch, a long decode is not", () => {
  assert.equal(at(step(10, 30, { endsAt: NOW + 1500 })), POLL_MS.closing);
  assert.equal(at({ status: "running", progress: { value: 0, max: 0, phase: "Decoding", steps: false, endsAt: NOW + 40_000 } }), POLL_MS.running);
  // A little over: still any moment now.
  assert.equal(at(step(10, 30, { endsAt: NOW - 3000 })), POLL_MS.closing);
  // Far over: the estimate is wrong, so the steps say it.
  assert.equal(at(step(10, 30, { endsAt: NOW - 60_000 })), POLL_MS.running);
});

test("Smart upscale's minutes after the picture are not the last moment unless its estimate says so", () => {
  assert.equal(at({ status: "running", progress: { value: 0, max: 0, phase: "Upscaling to 4K", steps: false, upscaling: true } }), POLL_MS.running);
  assert.equal(at({ status: "running", progress: { value: 0, max: 0, phase: "Upscaling to 4K", steps: false, upscaling: true, endsAt: NOW + 1000 } }), POLL_MS.closing);
});

test("a background tab, a lost connection and a reconnecting ComfyUI all ask slowly", () => {
  assert.equal(at(step(29, 30), { hidden: true }), POLL_MS.hidden);
  assert.equal(at(step(29, 30), { misses: 1 }), POLL_MS.retry * 2);
  assert.equal(at(step(29, 30), { misses: 40 }), POLL_MS.retry * 5);
  assert.equal(at({ status: "running", progress: { value: 0, max: 0, phase: "Reconnecting…", steps: false, reconnecting: true } }), POLL_MS.queued);
});

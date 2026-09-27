import test from "node:test";
import assert from "node:assert/strict";
import { beginComfyRestart, comfyRestarting, finishComfyRestart, lastComfyRestart, noteComfyRestart, resetComfyRestart, RESTART_WINDOW_MS } from "./comfy-restart.js";

test("a restart lasts until ComfyUI answers after going down, and is timed", () => {
  resetComfyRestart();
  beginComfyRestart(0, { packs: ["rgthree-comfy"] });
  assert.equal(noteComfyRestart(true, 500).phase, "restarting", "still the old process answering");
  assert.equal(noteComfyRestart(false, 2000).phase, "restarting");
  assert.equal(comfyRestarting(3000), true);
  assert.deepEqual(noteComfyRestart(true, 9000), { phase: "back", startedAt: 0, durationMs: 9000, packs: ["rgthree-comfy"] });
  assert.equal(noteComfyRestart(true, 9500), null, "reported once");
  assert.equal(comfyRestarting(9500), true, "still restarting while the checks after it run");
  finishComfyRestart({ durationMs: 9000, newPacks: [], failedPacks: [] }, 10_000);
  assert.equal(comfyRestarting(10_000), false);
  assert.deepEqual(lastComfyRestart(10_000), { startedAt: 0, endedAt: 10_000, outcome: "back", durationMs: 9000, newPacks: [], failedPacks: [] });
  assert.equal(lastComfyRestart(10_000 + 121_000), null, "forgotten after two minutes");
});

test("a restart too quick to see counts as back after a while, with no duration", () => {
  resetComfyRestart();
  beginComfyRestart(0);
  assert.equal(noteComfyRestart(true, 10_000).phase, "restarting");
  const back = noteComfyRestart(true, 16_000);
  assert.equal(back.phase, "back");
  assert.equal(back.durationMs, null);
});

test("a restart that never comes back fails, and the app reconnects as usual", () => {
  resetComfyRestart();
  beginComfyRestart(0);
  assert.equal(noteComfyRestart(false, 1000).phase, "restarting");
  assert.equal(noteComfyRestart(false, RESTART_WINDOW_MS + 1).phase, "failed");
  assert.equal(noteComfyRestart(false, RESTART_WINDOW_MS + 2), null);
  assert.equal(lastComfyRestart(RESTART_WINDOW_MS + 2).outcome, "failed");
});

import test from "node:test";
import assert from "node:assert/strict";
import { beginComfyRestart, comfyRestarting, noteComfyRestart, resetComfyRestart, RESTART_WINDOW_MS } from "./comfy-restart.js";

test("a restart lasts until ComfyUI answers after going down", () => {
  resetComfyRestart();
  beginComfyRestart(0);
  assert.equal(noteComfyRestart(true, 500).phase, "restarting", "still the old process answering");
  assert.equal(noteComfyRestart(false, 2000).phase, "restarting");
  assert.equal(comfyRestarting(3000), true);
  assert.equal(noteComfyRestart(true, 9000).phase, "back");
  assert.equal(noteComfyRestart(true, 9500), null, "reported once");
  assert.equal(comfyRestarting(9500), false);
});

test("a restart too quick to see counts as back after a while", () => {
  resetComfyRestart();
  beginComfyRestart(0);
  assert.equal(noteComfyRestart(true, 10_000).phase, "restarting");
  assert.equal(noteComfyRestart(true, 16_000).phase, "back");
});

test("a restart that never comes back fails, and the app reconnects as usual", () => {
  resetComfyRestart();
  beginComfyRestart(0);
  assert.equal(noteComfyRestart(false, 1000).phase, "restarting");
  assert.equal(noteComfyRestart(false, RESTART_WINDOW_MS + 1).phase, "failed");
  assert.equal(noteComfyRestart(false, RESTART_WINDOW_MS + 2), null);
});

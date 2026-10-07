import assert from "node:assert/strict";
import test from "node:test";
import { rapidLabel, rapidSeedFrom, rapidState } from "../src/app/rapid.js";

const ready = { capabilities: { rapid: true, rapidGuidance: true } };
const on = { rapid: true };

test("a random seed gets Rapid on a model that has it", () => {
  assert.deepEqual(rapidState(ready, on, "", "", { cfg: 4 }), { use: true, guidance: true, status: "on" });
  assert.deepEqual(rapidState(ready, {}, "", "", { cfg: 4 }), { use: true, guidance: true, status: "on" }, "on unless switched off");
});

test("a fixed seed goes without Rapid, unless it came from a Rapid picture", () => {
  assert.deepEqual(rapidState(ready, on, "1234", "", { cfg: 4 }), { use: false, guidance: false, status: "seed" });
  assert.deepEqual(rapidState(ready, on, "1234", "1234", { cfg: 4 }), { use: true, guidance: true, status: "on" });
  assert.deepEqual(rapidState(ready, on, "1235", "1234", { cfg: 4 }).status, "seed", "a changed seed is your own");
});

test("off where the model, the setup or the run can't use it", () => {
  assert.equal(rapidState(null, on, "", "").status, "model");
  assert.equal(rapidState({ capabilities: { rapid: false } }, on, "", "").status, "model");
  assert.equal(rapidState({ capabilities: { rapid: false, rapidInstall: true } }, on, "", "").status, "install");
  assert.equal(rapidState(ready, { rapidAll: false }, "", "").status, "off");
  assert.equal(rapidState(ready, { rapid: false, rapidGuidance: false }, "", "").status, "parts");
  assert.equal(rapidState(ready, { rapid: false }, "", "", { cfg: 1 }).status, "parts", "CFG 1 with the start switched off: the switch is the reason");
  assert.equal(rapidState(ready, on, "", "", { startImage: true, cfg: 1 }).status, "image");
  assert.equal(rapidState({ capabilities: { rapidGuidance: true } }, on, "", "", { cfg: 1 }).status, "idle");
  assert.equal(rapidState(ready, on, "", "", { kind: "video" }).status, "model");
  for (const status of ["on", "off", "parts", "seed", "image", "idle", "install", "model"]) assert.ok(rapidLabel(status));
});

test("the two parts switch on their own", () => {
  assert.deepEqual(rapidState(ready, { rapid: false }, "", "", { cfg: 4 }), { use: false, guidance: true, status: "on" });
  assert.deepEqual(rapidState(ready, { rapidGuidance: false }, "", "", { cfg: 4 }), { use: true, guidance: false, status: "on" });
  assert.deepEqual(rapidState(ready, on, "", "", { cfg: 1 }), { use: true, guidance: false, status: "on" }, "CFG 1: nothing for guidance to save");
  assert.deepEqual(rapidState(ready, on, "", "", { startImage: true, cfg: 5 }), { use: false, guidance: false, status: "image" }, "a start picture keeps its CFG whole");
});

test("Use settings remembers the seed of a Rapid picture only", () => {
  assert.equal(rapidSeedFrom({ rapid: true, seed: "77" }), "77");
  assert.equal(rapidSeedFrom({ seed: "77" }), "");
  assert.equal(rapidSeedFrom({ rapidGuidance: true, seed: "77" }), "77");
  assert.equal(rapidSeedFrom({ rapid: true, seed: "Random" }), "");
  assert.equal(rapidSeedFrom({ rapid: true, seed: "77" }, { vary: true }), "");
});

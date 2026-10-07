import assert from "node:assert/strict";
import test from "node:test";
import { rapidLabel, rapidSeedFrom, rapidState } from "../src/app/rapid.js";

const ready = { capabilities: { rapid: true } };
const on = { rapid: true };

test("a random seed gets Rapid on a model that has it", () => {
  assert.deepEqual(rapidState(ready, on, "", ""), { use: true, status: "on" });
  assert.deepEqual(rapidState(ready, {}, "", ""), { use: true, status: "on" }, "on unless switched off");
});

test("a fixed seed goes without Rapid, unless it came from a Rapid picture", () => {
  assert.deepEqual(rapidState(ready, on, "1234", ""), { use: false, status: "seed" });
  assert.deepEqual(rapidState(ready, on, "1234", "1234"), { use: true, status: "on" });
  assert.deepEqual(rapidState(ready, on, "1235", "1234"), { use: false, status: "seed" }, "a changed seed is your own");
});

test("off where the model, the setup or the run can't use it", () => {
  assert.equal(rapidState(null, on, "", "").status, "model");
  assert.equal(rapidState({ capabilities: { rapid: false } }, on, "", "").status, "model");
  assert.equal(rapidState({ capabilities: { rapid: false, rapidInstall: true } }, on, "", "").status, "install");
  assert.equal(rapidState(ready, { rapid: false }, "", "").status, "off");
  assert.equal(rapidState(ready, on, "", "", { startImage: true }).status, "image");
  assert.equal(rapidState(ready, on, "", "", { kind: "video" }).status, "model");
  for (const status of ["on", "off", "seed", "image", "install", "model"]) assert.ok(rapidLabel(status));
});

test("Use settings remembers the seed of a Rapid picture only", () => {
  assert.equal(rapidSeedFrom({ rapid: true, seed: "77" }), "77");
  assert.equal(rapidSeedFrom({ seed: "77" }), "");
  assert.equal(rapidSeedFrom({ rapid: true, seed: "Random" }), "");
  assert.equal(rapidSeedFrom({ rapid: true, seed: "77" }, { vary: true }), "");
});

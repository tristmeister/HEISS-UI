import assert from "node:assert/strict";
import test from "node:test";
import { arrangeReferences, withReference, withoutReferences } from "../src/app/referenceSlots.js";

// Flux.2-style slots, as server/family-profiles.js referenceSlots(3) builds them.
const three = [
  { id: "reference" },
  { id: "reference_2", follows: "reference" },
  { id: "reference_3", follows: "reference_2" }
];
const one = [{ id: "reference" }];
const asset = (id) => ({ id, name: `${id}.png` });
const ids = (list) => list.map((item) => `${item.slot}=${item.asset.id}`);

test("comes out in slot order, whatever order the picks came in", () => {
  const picked = [{ slot: "reference_2", asset: asset("b") }, { slot: "reference", asset: asset("a") }];
  assert.deepEqual(ids(arrangeReferences(picked, three)), ["reference=a", "reference_2=b"]);
});

test("a picture saved under a slot this model lacks takes the first empty slot, so it can be removed", () => {
  const saved = [{ slot: "image", asset: asset("old") }];
  const shown = arrangeReferences(saved, one);
  assert.deepEqual(ids(shown), ["reference=old"]);
  assert.deepEqual(withoutReferences(saved, one, ["reference"]), []);
});

test("removing the first reference moves the others up instead of leaving a ghost", () => {
  const picked = [{ slot: "reference", asset: asset("a") }, { slot: "reference_2", asset: asset("b") }, { slot: "reference_3", asset: asset("c") }];
  assert.deepEqual(ids(withoutReferences(picked, three, ["reference"])), ["reference=b", "reference_2=c"]);
  assert.deepEqual(ids(withoutReferences(picked, three, ["reference_2"])), ["reference=a", "reference_2=c"]);
  assert.deepEqual(withoutReferences(picked, three, ["reference", "reference_2", "reference_3"]), []);
});

test("every reference can be removed one at a time from the front", () => {
  let picked = [{ slot: "reference", asset: asset("a") }, { slot: "reference_2", asset: asset("b") }];
  picked = withoutReferences(picked, three, ["reference"]);
  picked = withoutReferences(picked, three, ["reference"]);
  assert.deepEqual(picked, []);
});

test("picking replaces the slot's picture and keeps the rest", () => {
  const picked = [{ slot: "reference", asset: asset("a") }, { slot: "reference_2", asset: asset("b") }];
  assert.deepEqual(ids(withReference(picked, three, "reference", asset("z"))), ["reference=z", "reference_2=b"]);
  assert.deepEqual(ids(withReference(picked, three, "reference_3", asset("c"))), ["reference=a", "reference_2=b", "reference_3=c"]);
  assert.deepEqual(ids(withReference(picked, three, "nope", asset("x"))), ["reference=a", "reference_2=b"]);
});

test("duplicates and empty entries are dropped; no slots keeps nothing", () => {
  const picked = [{ slot: "reference", asset: asset("a") }, { slot: "reference", asset: asset("b") }, { slot: "reference_2", asset: null }];
  assert.deepEqual(ids(arrangeReferences(picked, three)), ["reference=a"]);
  assert.deepEqual(arrangeReferences(picked, []), []);
  assert.deepEqual(arrangeReferences(undefined, three), []);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-loras-"));
process.env.HEISS_DATA_DIR = dir;
const { applyLoraOps, clearLoraState, loadLoraLibrary, loadLoraStack, saveLoraLibrary } = await import("./lora-stacks.js");
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const stack = (id, name, loras = [{ name: "a.safetensors", strength: 1 }]) => ({ id, name, loras });
const key = "family:krea";

test("two devices adding stacks both keep theirs", () => {
  clearLoraState();
  applyLoraOps([{ op: "stack.add", key, stack: stack("mac", "Krea") }]);
  const library = applyLoraOps([{ op: "stack.add", key, stack: stack("phone", "Portraits") }]);
  assert.deepEqual(library.snapshots[key].map((item) => item.id), ["mac", "phone"]);
});

test("replayed edits are harmless: no duplicate adds, deletes stay deleted", () => {
  clearLoraState();
  const add = { op: "stack.add", key, stack: stack("x", "Krea") };
  applyLoraOps([add, add]);
  applyLoraOps([{ op: "stack.delete", key, id: "x" }, { op: "stack.delete", key, id: "x" }]);
  assert.deepEqual(loadLoraLibrary().snapshots[key], []);
  applyLoraOps([{ op: "favorite", name: "a", on: true }, { op: "favorite", name: "a", on: true }]);
  assert.deepEqual(loadLoraLibrary().favorites, ["a"]);
});

test("a stale whole-library save merges instead of wiping newer stacks", () => {
  clearLoraState();
  applyLoraOps([{ op: "stack.add", key, stack: stack("new", "Saved on the Mac") }]);
  const library = saveLoraLibrary({ snapshots: { [key]: [stack("old", "From an old tab")] }, favorites: ["b"], strengths: {}, recents: [] });
  assert.deepEqual(library.snapshots[key].map((item) => item.name), ["Saved on the Mac", "From an old tab"]);
  assert.deepEqual(library.favorites, ["b"]);
});

test("rename, update, strengths, recents and the active stack all apply", () => {
  clearLoraState();
  applyLoraOps([
    { op: "stack.add", key, stack: stack("s", "Draft") },
    { op: "stack.rename", key, id: "s", name: "Krea" },
    { op: "stack.update", key, id: "s", loras: [{ name: "b.safetensors", strength: 0.9 }] },
    { op: "strengths", workflowId: "krea2", values: { "b.safetensors": 0.9 } },
    { op: "strengths", workflowId: "krea2", values: { "c.safetensors": 1.1 } },
    { op: "recents", names: ["b.safetensors"] },
    { op: "active", workflowId: "krea2", loras: [{ name: "b.safetensors", strength: 0.9 }] }
  ]);
  const library = loadLoraLibrary();
  assert.equal(library.snapshots[key][0].name, "Krea");
  assert.equal(library.snapshots[key][0].loras[0].name, "b.safetensors");
  assert.deepEqual(library.strengths.krea2, { "b.safetensors": 0.9, "c.safetensors": 1.1 });
  assert.deepEqual(library.recents, ["b.safetensors"]);
  assert.equal(loadLoraStack("krea2")[0].strength, 0.9);
});

test("stacks saved per workflow by older builds move to the family", () => {
  clearLoraState();
  applyLoraOps([{ op: "stack.add", key: "krea2-workflow", stack: stack("legacy", "Old") }, { op: "stack.move", key, from: "krea2-workflow" }]);
  const library = loadLoraLibrary();
  assert.equal(library.snapshots["krea2-workflow"], undefined);
  assert.equal(library.snapshots[key][0].id, "legacy");
});

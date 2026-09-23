import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readJsonFile, removeJsonFile, writeJsonFile } from "./json-store.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-json-"));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("writes land whole and keep the previous copy as a backup", () => {
  const file = path.join(dir, "state.json");
  writeJsonFile(file, { version: 1 });
  writeJsonFile(file, { version: 2 });
  assert.deepEqual(readJsonFile(file), { version: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, "utf8")), { version: 1 });
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.includes(".tmp-")), []);
});

test("a half-written file falls back to the backup and is set aside, not lost", () => {
  const file = path.join(dir, "torn.json");
  writeJsonFile(file, { stacks: ["a"] });
  writeJsonFile(file, { stacks: ["a", "b"] });
  fs.writeFileSync(file, '{"stacks": ["a", "b"');
  assert.deepEqual(readJsonFile(file), { stacks: ["a"] });
  assert.equal(fs.readdirSync(dir).some((name) => name.startsWith("torn.json.corrupt-")), true);
});

test("a crash between backup and rename still reads the backup", () => {
  const file = path.join(dir, "gone.json");
  writeJsonFile(file, { ok: true });
  writeJsonFile(file, { ok: "again" });
  fs.rmSync(file);
  assert.deepEqual(readJsonFile(file), { ok: true });
});

test("missing with no backup still throws, so callers use their defaults", () => {
  assert.throws(() => readJsonFile(path.join(dir, "never.json")), { code: "ENOENT" });
});

test("removing on purpose takes the backup too", () => {
  const file = path.join(dir, "removed.json");
  writeJsonFile(file, { a: 1 });
  writeJsonFile(file, { a: 2 });
  removeJsonFile(file);
  assert.throws(() => readJsonFile(file));
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyPending, confirmApplied, lockPackages, readPending, rollback, takeResult, updateDir, writePending } from "./release-swap.js";
import { isNewer, pickAsset } from "./updater.js";

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const read = (file) => fs.readFileSync(file, "utf8");

/** An installed release with user data next to it, and a newer one staged. */
function fixture({ lockChanges = false, stagedVersion = "0.4.0" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-swap-"));
  const release = (dir, version, extra = {}) => {
    write(path.join(dir, "release.json"), JSON.stringify({ version, files: ["dist", "server", "scripts", "package.json", "package-lock.json", "release.json", ...(extra.files || [])] }));
    write(path.join(dir, "package.json"), JSON.stringify({ version }));
    write(path.join(dir, "package-lock.json"), extra.lock || "lock-1");
    write(path.join(dir, "server", "index.js"), `// ${version}`);
    write(path.join(dir, "dist", "index.html"), version);
    write(path.join(dir, "scripts", "start.mjs"), "");
    for (const file of extra.only || []) write(path.join(dir, file), version);
  };
  release(root, "0.3.0", { only: ["old-only.txt"], files: ["old-only.txt"] });
  write(path.join(root, "data", "gallery.json"), "my gallery");
  write(path.join(root, ".env"), "PORT=9000");
  write(path.join(root, "node_modules", "express", "package.json"), "{}");
  const staged = path.join(updateDir(root), "staged", "heiss-ui-0.4.0");
  release(staged, stagedVersion, { lock: lockChanges ? "lock-2" : "lock-1", only: ["new-only.txt"], files: ["new-only.txt"] });
  writePending(root, { version: "0.4.0", dir: staged });
  return root;
}

test("an update swaps the app and leaves data, .env and node_modules alone", () => {
  const root = fixture({ lockChanges: true });
  const applied = applyPending(root);
  assert.equal(applied.to, "0.4.0");
  assert.equal(applied.lockChanged, true);
  assert.equal(read(path.join(root, "server", "index.js")), "// 0.4.0");
  assert.ok(fs.existsSync(path.join(root, "new-only.txt")));
  assert.ok(!fs.existsSync(path.join(root, "old-only.txt")), "files the new version dropped are gone");
  assert.equal(read(path.join(root, "data", "gallery.json")), "my gallery");
  assert.equal(read(path.join(root, ".env")), "PORT=9000");
  assert.ok(fs.existsSync(path.join(root, "node_modules", "express", "package.json")));
  assert.equal(read(path.join(updateDir(root), "backup", "server", "index.js")), "// 0.3.0");
  assert.equal(readPending(root), null, "nothing is pending afterwards");
  assert.equal(applyPending(root), null, "a second start does nothing");
});

test("a failed start puts the previous version back", () => {
  const root = fixture();
  applyPending(root);
  assert.equal(rollback(root, "it exited with code 1"), true);
  assert.equal(read(path.join(root, "server", "index.js")), "// 0.3.0");
  assert.ok(fs.existsSync(path.join(root, "old-only.txt")));
  assert.ok(!fs.existsSync(path.join(root, "new-only.txt")));
  assert.equal(read(path.join(root, "data", "gallery.json")), "my gallery");
  const result = takeResult(root);
  assert.equal(result.rolledBack, true);
  assert.equal(result.to, "0.4.0");
  assert.equal(takeResult(root), null, "the result is reported once");
  assert.equal(rollback(root, "again"), false, "nothing left to roll back");
});

test("a started update is confirmed and reported", () => {
  const root = fixture();
  applyPending(root);
  confirmApplied(root);
  assert.equal(rollback(root, "late crash"), false, "a confirmed update is not rolled back");
  assert.deepEqual({ ...takeResult(root), at: 0 }, { ok: true, from: "0.3.0", to: "0.4.0", at: 0 });
});

test("a staged copy that is not what was downloaded is never swapped in", () => {
  const root = fixture({ stagedVersion: "0.9.9" });
  assert.equal(applyPending(root), null);
  assert.equal(read(path.join(root, "server", "index.js")), "// 0.3.0");
  assert.match(takeResult(root).error, /0\.9\.9/);
});

test("pending entries outside .update/staged are ignored", () => {
  const root = fixture();
  write(path.join(updateDir(root), "pending.json"), JSON.stringify({ version: "0.4.0", dir: "../server" }));
  assert.equal(readPending(root), null);
});

test("versions compare by number and the release zip carries its checksum", () => {
  assert.equal(isNewer("0.10.0", "0.9.9"), true);
  assert.equal(isNewer("v0.3.0", "0.3.0"), false);
  assert.equal(isNewer("0.3.0", "0.3.1"), false);
  const digest = "a".repeat(64);
  const asset = pickAsset({ tag_name: "v0.4.0", assets: [
    { name: "heiss-ui-0.4.0.zip", browser_download_url: "https://x/zip", size: 10, digest: `sha256:${digest}` },
    { name: "heiss-ui-0.4.0.zip.sha256", browser_download_url: "https://x/sum" }
  ] });
  assert.deepEqual(asset, { version: "0.4.0", name: "heiss-ui-0.4.0.zip", url: "https://x/zip", size: 10, sha256: digest, sumUrl: "https://x/sum" });
  assert.equal(pickAsset({ tag_name: "v0.4.0", assets: [] }), null);
});

test("moves a rollback could not make are retried, and an update waits until they are done", () => {
  const root = fixture();
  write(path.join(updateDir(root), "backup", "kept.txt"), "old");
  write(path.join(updateDir(root), "backup", "stuck.txt"), "old");
  write(path.join(root, "blocker", "inside.txt"), "a folder where a file should go");
  write(path.join(updateDir(root), "leftovers.json"), JSON.stringify([{ from: ".update/backup/stuck.txt", to: "blocker" }, { from: ".update/backup/kept.txt", to: "kept.txt" }]));
  assert.equal(applyPending(root), null, "no update while files are still stuck");
  assert.equal(read(path.join(root, "kept.txt")), "old", "what can move is moved");
  assert.equal(read(path.join(updateDir(root), "backup", "stuck.txt")), "old", "the backup is not wiped");
  assert.match(takeResult(root).error, /stuck\.txt/);
  fs.rmSync(path.join(root, "blocker"), { recursive: true });
  const applied = applyPending(root);
  assert.equal(applied.to, "0.4.0");
  assert.equal(read(path.join(root, "blocker")), "old");
  assert.ok(!fs.existsSync(path.join(updateDir(root), "leftovers.json")));
});

test("a lockfile that only changed the app's version does not reinstall packages", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-lock-"));
  const lock = (version, sharp) => JSON.stringify({ name: "heiss-ui", version, packages: { "": { name: "heiss-ui", version }, "node_modules/sharp": { version: sharp } } }, null, 2);
  const file = path.join(dir, "package-lock.json");
  fs.writeFileSync(file, lock("0.5.1", "0.35.4"));
  const before = lockPackages(file);
  fs.writeFileSync(file, lock("0.5.2", "0.35.4"));
  assert.equal(lockPackages(file), before);
  fs.writeFileSync(file, lock("0.5.2", "0.36.0"));
  assert.notEqual(lockPackages(file), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

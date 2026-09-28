import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { desktopEntry, shellLauncher, windowsLauncher } from "./launchers.mjs";

const posix = process.platform !== "win32";

// A copy of a download with a fake Node that reports how it was started.
function download({ runtime = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heiss launcher & co-"));
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.writeFileSync(path.join(dir, "scripts", "start.mjs"), "");
  const launcher = path.join(dir, "Start HEISS UI.sh");
  fs.writeFileSync(launcher, shellLauncher(), { mode: 0o755 });
  if (runtime) {
    const bin = path.join(dir, "runtime", "node-v22.11.0-linux-x64", "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "node"), "#!/bin/sh\necho \"bundled node: $*\"\nexit 0\n", { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "runtime", "current.txt"), "node-v22.11.0-linux-x64");
  }
  return { dir, launcher };
}

test("the shell launcher is valid sh", { skip: !posix }, () => {
  const file = path.join(os.tmpdir(), `heiss-launcher-${process.pid}.sh`);
  fs.writeFileSync(file, shellLauncher());
  execFileSync("sh", ["-n", file]);
  fs.rmSync(file);
});

test("the shell launcher starts the download's own Node from any folder, with the flags it was given", { skip: !posix }, () => {
  const { dir, launcher } = download();
  // Started from elsewhere, as a double-click or a desktop entry does.
  const result = spawnSync("sh", [launcher, "--lan"], { cwd: os.tmpdir(), encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "bundled node: scripts/start.mjs --lan");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("without a bundled Node and none on PATH, the launcher says what to install", { skip: !posix }, () => {
  const { dir, launcher } = download({ runtime: false });
  const result = spawnSync("sh", [launcher], { cwd: dir, encoding: "utf8", env: { PATH: "/usr/bin:/bin".split(":").filter((entry) => !fs.existsSync(path.join(entry, "node"))).join(":") || "/nonexistent" } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /needs Node\.js 20\.9 or newer/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the desktop entry runs the .sh beside it in a terminal, quoted as the spec asks", () => {
  const entry = desktopEntry();
  assert.match(entry, /^\[Desktop Entry\]\n/);
  assert.match(entry, /\nTerminal=true\n/);
  const exec = entry.split("\n").find((line) => line.startsWith("Exec="));
  // Undo the two escaping levels the way a desktop environment does, then run the command.
  const value = exec.slice(5).replace(/\\\\/g, "\\");
  const args = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quoted && char === "\\") { current += value[++index]; continue; }
    if (char === "\"") { quoted = !quoted; continue; }
    if (char === " " && !quoted) { if (current) args.push(current); current = ""; continue; }
    current += char;
  }
  args.push(current);
  assert.deepEqual(args, ["sh", "-c", "cd \"$(dirname \"$1\")\" && exec ./\"Start HEISS UI.sh\"", "heiss-ui", "%k"]);
  if (!posix) return;
  const { dir } = download();
  const result = spawnSync(args[0], [...args.slice(1, -1), path.join(dir, "Start HEISS UI.desktop")], { cwd: os.tmpdir(), encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
  assert.equal(result.stdout.trim(), "bundled node: scripts/start.mjs");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the Windows launcher prefers the bundled node.exe and keeps its last line whole", () => {
  const lines = windowsLauncher().split("\r\n");
  assert.ok(lines.some((line) => line.includes("runtime\\%HEISS_RUNTIME%\\node.exe")));
  assert.equal(lines.at(-2), "(\"%HEISS_NODE%\" scripts\\start.mjs || pause) & exit /b");
});

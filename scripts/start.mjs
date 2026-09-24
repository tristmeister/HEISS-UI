// Starts a HEISS UI release (its `npm start`). It swaps in an update the app
// downloaded, makes sure the runtime packages are there, runs the server, and
// starts it again when the app asks for a restart. An update that will not
// start is rolled back to the version before it.
//
// Keep this small and stable: an installed copy keeps running its own copy
// of this file until the next start, while the rest of the app is replaced.
import { execFileSync, fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RESTART_CODE, applyPending, confirmApplied, rollback } from "../server/release-swap.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const log = (message) => console.log(`\n  ${message}\n`);

function prepare(reinstall) {
  // A release with a different lockfile may need different package versions.
  if (reinstall) {
    execFileSync(npm, ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  }
  execFileSync(process.execPath, [path.join(root, "scripts", "ensure-runtime-dependencies.mjs")], { cwd: root, stdio: "inherit" });
}

let child = null;
// Ctrl+C reaches the server too; wait for it instead of leaving it behind.
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { if (child) child.kill(signal); else process.exit(130); });

/** Runs the server until it exits; `ready` says whether it ever started listening. */
function runServer(onReady) {
  return new Promise((resolve) => {
    let ready = false;
    child = fork(path.join(root, "server", "index.js"), [], { cwd: root, stdio: "inherit" });
    child.on("message", (message) => {
      if (message?.type !== "ready" || ready) return;
      ready = true;
      onReady();
    });
    child.on("error", () => resolve({ code: 1, ready }));
    child.on("exit", (code, signal) => { child = null; resolve({ code, signal, ready }); });
  });
}

let trial = null;
let reinstall = false;
for (;;) {
  let applied = null;
  try {
    applied = applyPending(root, log);
  } catch (error) {
    log(`Could not install the update, staying on this version: ${error.message}`);
  }
  if (applied) trial = applied;

  try {
    prepare(reinstall || Boolean(applied?.lockChanged));
    reinstall = false;
  } catch (error) {
    if (trial && rollback(root, `its packages would not install: ${error.message}`, log)) { trial = null; reinstall = true; continue; }
    throw error;
  }

  // The new version counts as good once it is listening.
  const { code, signal, ready } = await runServer(() => { if (trial) { confirmApplied(root); trial = null; } });
  if (code === RESTART_CODE) continue;
  if (trial && !ready && !signal) {
    // Going back also means going back to the old version's packages.
    if (rollback(root, `it exited with code ${code}`, log)) { reinstall = Boolean(trial.lockChanged); trial = null; continue; }
  }
  process.exit(code ?? 0);
}

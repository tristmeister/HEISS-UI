// Starts a HEISS UI release (its `npm start`). It swaps in an update the app
// downloaded, makes sure the runtime packages are there, runs the server, and
// starts it again when the app asks for a restart. An update that will not
// start is rolled back to the version before it. The first time the server is
// ready it opens the studio in the browser (see server/launch.js).
//
// Keep this small and stable: an installed copy keeps running its own copy
// of this file until the next start, while the rest of the app is replaced.

// sharp and the server need Node 20.9 or newer; say so instead of failing on a
// syntax error or a missing built-in. Everything else is imported after this
// check, so an old Node gets this far.
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 20 || (nodeMajor === 20 && nodeMinor < 9)) {
  console.log(`\n  HEISS UI needs Node.js 20.9 or newer (22 LTS recommended); this is ${process.versions.node}. Get it from https://nodejs.org\n`);
  process.exit(1);
}

const { execFileSync, execSync, fork } = await import("node:child_process");
const { existsSync } = await import("node:fs");
const path = (await import("node:path")).default;
const { fileURLToPath } = await import("node:url");
const { PORT_IN_USE_CODE, RESTART_CODE, applyPending, confirmApplied, rollback } = await import("../server/release-swap.js");
const { pruneRuntimes } = await import("../server/node-runtime.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const log = (message) => console.log(`\n  ${message}\n`);

// OneDrive holds files open while it syncs, which breaks installs and updates.
const oneDrive = process.env.OneDrive || process.env.OneDriveConsumer || process.env.OneDriveCommercial;
if (process.platform === "win32" && oneDrive && root.toLowerCase().startsWith(oneDrive.toLowerCase())) {
  log("This copy is inside OneDrive, which can lock files during installs and updates. A folder like C:\\HEISS-UI works better.");
}

// npm's own script: the one `npm start` ran, else the npm that ships next to this
// node (Node's Windows zip, which a Windows download brings, and most installs).
function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")
  ];
  return candidates.find((file) => file && /npm-cli\.[cm]?js$/.test(file) && existsSync(file)) || "";
}

// npm is npm.cmd on Windows, which Node only runs through a shell. Under
// `npm start` npm's own script is known; the .bat launcher goes through the shell.
function runNpm(args) {
  const options = { cwd: root, stdio: "inherit" };
  const cli = npmCli();
  if (cli) return execFileSync(process.execPath, [cli, ...args], options);
  if (process.platform === "win32") return execSync(`npm ${args.join(" ")}`, options);
  return execFileSync("npm", args, options);
}

function prepare(reinstall) {
  // A release with a different lockfile may need different package versions.
  if (reinstall) {
    runNpm(["install", "--omit=dev", "--no-audit", "--no-fund"]);
  }
  execFileSync(process.execPath, [path.join(root, "scripts", "ensure-runtime-dependencies.mjs")], { cwd: root, stdio: "inherit" });
}

// Opening the browser: once per launch, never after a restart. Older copies of
// the server have no launch.js; they just do not open it.
let browser = { opened: false, allowed: false, open: () => false };
try {
  const { openBrowser, shouldOpenBrowser } = await import("../server/launch.js");
  const { readEnvFile } = await import("../server/lan.js");
  // .env is the server's to load; read it here only for the opt-out.
  const fileValues = readEnvFile(root).values;
  const env = { ...fileValues, ...process.env };
  browser = { opened: false, allowed: shouldOpenBrowser({ env, argv: process.argv }), open: openBrowser };
} catch {
  // Keep starting; the address is printed either way.
}
function openOnce(url) {
  if (browser.opened || !browser.allowed || !url) return;
  browser.opened = true;
  browser.open(url);
}

let child = null;
// Ctrl+C reaches the server too; wait for it instead of leaving it behind.
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { if (child) child.kill(signal); else process.exit(130); });

/** Runs the server until it exits; `ready` says whether it ever started listening. */
function runServer(onReady) {
  return new Promise((resolve) => {
    let ready = false;
    // Flags given to the launcher (npm start -- --lan) reach every server it starts.
    child = fork(path.join(root, "server", "index.js"), process.argv.slice(2), { cwd: root, stdio: "inherit" });
    child.on("message", (message) => {
      // Started twice: the first copy is still running, so show that one.
      if (message?.type === "already-running") openOnce(message.url);
      if (message?.type !== "ready" || ready) return;
      ready = true;
      onReady(message);
    });
    child.on("error", () => resolve({ code: 1, ready }));
    child.on("exit", (code, signal) => { child = null; resolve({ code, signal, ready }); });
  });
}

// Node.js runtimes an earlier update left behind (a download's own Node).
try { pruneRuntimes(root, log); } catch { /* best effort */ }

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
  const { code, signal, ready } = await runServer((message) => {
    if (trial) { confirmApplied(root); trial = null; }
    openOnce(message.url || `http://localhost:${process.env.PORT || 8787}`);
  });
  if (code === RESTART_CODE) continue;
  // A taken port (HEISS already running) says nothing about the update; keep it on trial.
  if (code === PORT_IN_USE_CODE) process.exit(code);
  if (trial && !ready && !signal) {
    // Going back also means going back to the old version's packages.
    if (rollback(root, `it exited with code ${code}`, log)) { reinstall = Boolean(trial.lockChanged); trial = null; continue; }
  }
  process.exit(code ?? 0);
}

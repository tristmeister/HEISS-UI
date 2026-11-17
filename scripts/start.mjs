// Starts a HEISS UI release (its `npm start`). It swaps in an update the app
// downloaded, makes sure the runtime packages are there, runs the server, and
// starts it again when the app asks for a restart. An update that will not
// start is rolled back to the version before it. The first time the server is
// ready it opens the studio in the browser (see server/launch.js).
//
// Keep this small and stable: an installed copy keeps running its own copy
// of this file until the next start, while the rest of the app is replaced.

// Building the app (Vite 8) needs Node 20.19 or newer; say so instead of failing on a
// syntax error or a missing built-in. Everything else is imported after this
// check, so an old Node gets this far.
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 20 || (nodeMajor === 20 && nodeMinor < 19)) {
  console.log(`\n  HEISS UI needs Node.js 20.19 or newer (22 LTS recommended); this is ${process.versions.node}. Get it from https://nodejs.org\n`);
  process.exit(1);
}

const { execFileSync, execSync, fork } = await import("node:child_process");
const { existsSync } = await import("node:fs");
const path = (await import("node:path")).default;
const { fileURLToPath } = await import("node:url");
const { CONSOLE_STOP_CODE = 0xC000013A, PORT_IN_USE_CODE, RESTART_CODE, applyPending, confirmApplied, consoleStopTracker, rollback } = await import("../server/release-swap.js");
const { pruneRuntimes } = await import("../server/node-runtime.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const log = (message) => console.log(`\n  ${message}\n`);

// OneDrive holds files open while it syncs, which breaks installs and updates.
const oneDrive = process.env.OneDrive || process.env.OneDriveConsumer || process.env.OneDriveCommercial;
if (process.platform === "win32" && oneDrive && root.toLowerCase().startsWith(oneDrive.toLowerCase())) {
  log("This copy is in OneDrive, which can lock files during installs and updates. A folder like C:\\HEISS-UI works better.");
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
// Why HEISS stopped, for its next start (server/exit-record.js). Optional: an older copy has none.
let exitRecord = { recordExit: () => {}, tailKeeper: () => ({ push() {}, text: () => "" }) };
try { exitRecord = await import("../server/exit-record.js"); } catch { /* keep starting */ }
const serverTail = exitRecord.tailKeeper();

// Ctrl+C reaches the server too; wait for it instead of leaving it behind. Each is a stop someone
// meant, written down first: on Windows, kill() ends the server before it can say so itself.
const meant = { SIGINT: "Stopped with Ctrl+C", SIGTERM: "Stopped", SIGHUP: "Its window was closed", SIGBREAK: "Stopped with Ctrl+Break" };
// Set on a stop someone meant: the server then ends on that signal (or, on Windows, by kill()), which is no crash.
let stopping = false;
for (const signal of process.platform === "win32" ? ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] : ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    exitRecord.recordExit({ who: "launcher", clean: true, signal, reason: meant[signal] });
    if (child) child.kill(signal === "SIGINT" ? "SIGINT" : "SIGTERM"); else process.exit(130);
  });
}

/** Runs the server until it exits; `ready` says whether it ever started listening. */
function runServer(onReady) {
  return new Promise((resolve) => {
    let ready = false;
    // Flags given to the launcher (npm start -- --lan) reach every server it starts.
    // The server never reads the console, so it gets none.
    child = fork(path.join(root, "server", "index.js"), process.argv.slice(2), { cwd: root, stdio: ["ignore", "inherit", "pipe", "ipc"] });
    // Shown as before, and its last lines kept for the exit record.
    child.stderr?.on("data", (chunk) => { serverTail.push(chunk); process.stderr.write(chunk); });
    child.on("message", (message) => {
      // Started twice: the first copy is still running, so show that one.
      if (message?.type === "already-running") openOnce(message.url);
      if (message?.type !== "ready" || ready) return;
      ready = true;
      onReady(message);
    });
    child.on("error", () => resolve({ code: 1, ready }));
    child.on("exit", (code, signal) => {
      child = null;
      // The server writes its own crash down; this catches what it couldn't (killed from outside).
      // A console stop is decided in the loop, once it is clear whether this launcher was stopped too.
      if (!stopping && code !== 0 && code !== RESTART_CODE && code !== PORT_IN_USE_CODE && code !== CONSOLE_STOP_CODE) {
        exitRecord.recordExit({ who: "server", code, signal, reason: signal ? `The server was ended (${signal})` : `The server stopped with exit code ${code}`, detail: serverTail.text() });
      }
      resolve({ code, signal, ready });
    });
  });
}

// Node.js runtimes an earlier update left behind (a download's own Node).
try { pruneRuntimes(root, log); } catch { /* best effort */ }

// An older release-swap.js has no tracker: a console stop then ends HEISS UI as before.
const strayConsoleStop = consoleStopTracker ? consoleStopTracker({ isStopping: () => stopping }) : async () => false;

let trial = null;
let reinstall = false;
for (;;) {
  let applied = null;
  try {
    applied = applyPending(root, log);
  } catch (error) {
    log(`Couldn't install the update, so this version keeps running: ${error.message}`);
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
  if (code === CONSOLE_STOP_CODE && !stopping) {
    if (await strayConsoleStop()) {
      log("The server was ended by a console event nobody sent to HEISS UI. Starting it again.");
      continue;
    }
    if (!stopping) exitRecord.recordExit({ who: "server", code, reason: "The server kept being ended by console events (Ctrl+C or a closed window) that HEISS UI didn't get itself", detail: serverTail.text() });
  }
  // A taken port (HEISS already running) says nothing about the update; keep it on trial.
  if (code === PORT_IN_USE_CODE) process.exit(code);
  if (trial && !ready && !signal) {
    // Going back also means going back to the old version's packages.
    if (rollback(root, `it exited with code ${code}`, log)) { reinstall = Boolean(trial.lockChanged); trial = null; continue; }
  }
  process.exit(code ?? 0);
}

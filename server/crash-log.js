import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What HEISS UI writes down when something goes wrong, so "the server is down"
 * turns into a reason: data/logs/heiss-YYYY-MM-DD.log, one line per event,
 * kept for a week.
 *
 * - A crash (an uncaught exception) is written with its stack and the last
 *   things that happened, synchronously, before the process exits.
 * - A promise rejection nobody handled is written and the server keeps going:
 *   Node would otherwise stop the whole studio for one failed side task.
 * - ComfyUI going away and coming back is written with what HEISS was doing
 *   at that moment (thumbnails building, requests waiting), so it can be told
 *   apart from HEISS itself going down.
 * - Every minute a heartbeat: memory and how late the event loop runs. A long
 *   stall or a memory climb shows up before the crash it leads to.
 *
 * Nothing about prompts, images or file names goes in: only what happened.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dataDir = process.env.HEISS_DATA_DIR || process.env.JAI_DATA_DIR ? path.resolve(process.env.HEISS_DATA_DIR || process.env.JAI_DATA_DIR) : path.join(root, "data");
export const logDir = path.join(dataDir, "logs");
const keepDays = 7;
const recent = [];
const recentLimit = 40;
const probes = new Map();
let installed = false;

function stamp() { return new Date().toISOString(); }
function fileFor(date = new Date()) { return path.join(logDir, `heiss-${date.toISOString().slice(0, 10)}.log`); }

function write(level, message, extra) {
  const line = `${stamp()} ${level.padEnd(5)} ${message}${extra ? ` ${JSON.stringify(extra)}` : ""}`;
  recent.push(line);
  if (recent.length > recentLimit) recent.shift();
  try {
    fs.mkdirSync(logDir, { recursive: true });
    // Synchronous on purpose: a crash line has to reach the disk before exit.
    fs.appendFileSync(fileFor(), `${line}\n`);
  } catch { /* logging must never be the thing that fails */ }
  return line;
}

/** Something worth knowing later; `extra` is a small object of numbers and flags. */
export function logEvent(message, extra) { return write("info", message, extra); }
export function logWarning(message, extra) { return write("warn", message, extra); }

/** A named reading added to every heartbeat and crash line, e.g. thumbnail builds in flight. */
export function addProbe(name, read) { probes.set(name, read); }

function readings() {
  const memory = process.memoryUsage();
  const out = { rssMb: Math.round(memory.rss / 1048576), heapMb: Math.round(memory.heapUsed / 1048576), uptimeS: Math.round(process.uptime()) };
  for (const [name, read] of probes) {
    try { out[name] = read(); } catch { out[name] = "?"; }
  }
  return out;
}

function describe(error) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: String(error.stack || "").split("\n").slice(0, 12).join(" | ") };
  return { message: String(error) };
}

function sweep() {
  try {
    const cutoff = Date.now() - keepDays * 86_400_000;
    for (const name of fs.readdirSync(logDir)) {
      if (!/^heiss-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
      const file = path.join(logDir, name);
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
    }
  } catch { /* no logs yet */ }
}

/** Installs the handlers and the heartbeat. Call once, as early as possible. */
export function installCrashLog({ heartbeatMs = 60_000, stallMs = 750 } = {}) {
  if (installed) return;
  installed = true;
  sweep();
  write("info", "HEISS UI started", { pid: process.pid, node: process.version, platform: `${process.platform}-${process.arch}` });

  process.on("uncaughtException", (error) => {
    write("fatal", "Crashed: uncaught exception", { ...describe(error), ...readings() });
    write("fatal", "Last events before the crash", { recent: recent.slice(-15, -1) });
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    // Kept running: one failed background task shouldn't stop the studio.
    write("error", "Unhandled promise rejection (kept running)", { ...describe(reason), ...readings() });
  });
  process.on("exit", (code) => { write(code ? "error" : "info", "HEISS UI exited", { code, ...readings() }); });
  // Only noted: gallery-store.js owns stopping (it saves the gallery first,
  // then raises the signal again for Node's default exit). Once, like that
  // one: a listener left behind would catch the raised signal and the server
  // would never stop (Ctrl+C, the launcher's stop, a test's SIGTERM).
  for (const signal of process.platform === "win32" ? ["SIGINT", "SIGTERM"] : ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(signal, () => { write("info", `Stopping on ${signal}`); });
  }

  // The event loop running late means the server can't answer: log stalls as
  // they happen, and a heartbeat with memory once a minute.
  let expected = Date.now() + 250;
  let worstLag = 0;
  const lagTimer = setInterval(() => {
    const now = Date.now();
    const lag = Math.max(0, now - expected);
    expected = now + 250;
    worstLag = Math.max(worstLag, lag);
    if (lag > stallMs) write("warn", "Event loop stalled", { lagMs: lag, ...readings() });
  }, 250);
  lagTimer.unref();
  const beat = setInterval(() => {
    write("info", "Heartbeat", { worstLagMs: worstLag, ...readings() });
    worstLag = 0;
  }, heartbeatMs);
  beat.unref();
}

let comfyDown = false;
let comfyDownSince = 0;
/** Called whenever a request to ComfyUI succeeds or fails: only changes are written. */
export function noteComfyState(reachable, error) {
  if (!reachable && !comfyDown) {
    comfyDown = true;
    comfyDownSince = Date.now();
    write("warn", "ComfyUI stopped answering", { ...describe(error), ...readings() });
  } else if (reachable && comfyDown) {
    comfyDown = false;
    write("info", "ComfyUI answering again", { downForS: Math.round((Date.now() - comfyDownSince) / 1000), ...readings() });
  }
}

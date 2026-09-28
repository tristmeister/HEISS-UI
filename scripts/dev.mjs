// `npm run dev`: Vite serves the page, the HEISS server answers the API.
//
// `npm run dev -- --lan` (or `npm run dev:lan`, or the switch in Settings ›
// Connection) opens both to the network. The server restarts itself when the
// app asks (Settings › General › Restart, the LAN switch), and Vite follows
// when the LAN choice changed, so the switch works in a checkout too.
import { fork, spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listensBeyondThisComputer, readEnvFile, resolveLan } from "../server/lan.js";
import { RESTART_CODE } from "../server/release-swap.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const shell = { ...process.env };
// Vite proxies the API, so to the server every request comes from 127.0.0.1.
// This token lets Vite say who is really asking (vite.config.ts), so a phone
// in dev LAN mode is another device, not this computer.
process.env.HEISS_DEV_PROXY_TOKEN = crypto.randomBytes(32).toString("base64url");

// Read .env fresh each time: the LAN switch writes to it between restarts.
function viteHost() {
  const file = readEnvFile(root);
  const fileKeys = new Set([...file.keys].filter((key) => !(key in shell)));
  const { host } = resolveLan({ argv: args, env: { ...file.values, ...shell }, fileKeys });
  return listensBeyondThisComputer(host) ? "0.0.0.0" : "127.0.0.1";
}

let vite = null;
let viteOn = "";
let server = null;
let stopping = false;

function startVite(host) {
  viteOn = host;
  const child = spawn(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "--host", host, "--port", "5173"], { cwd: root, stdio: "inherit" });
  vite = child;
  child.on("exit", (code) => {
    // Swapped out on purpose, or the whole thing is stopping.
    if (stopping || vite !== child) return;
    shutdown(code ?? 1);
  });
}

function stopVite() {
  if (!vite) return Promise.resolve();
  const child = vite;
  vite = null;
  return new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
  });
}

function runServer() {
  return new Promise((resolve) => {
    server = fork(path.join(root, "server", "index.js"), args, { cwd: root, stdio: "inherit" });
    server.on("error", () => resolve(1));
    server.on("exit", (code) => { server = null; resolve(code); });
  });
}

function shutdown(code = 0) {
  stopping = true;
  server?.kill("SIGTERM");
  vite?.kill("SIGTERM");
  process.exit(code);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown(130));

for (;;) {
  const host = viteHost();
  if (host !== viteOn) {
    await stopVite();
    startVite(host);
  }
  const code = await runServer();
  if (code === RESTART_CODE && !stopping) continue;
  shutdown(code ?? 0);
}

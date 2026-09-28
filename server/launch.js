/**
 * Starting up like an app: find a port, open the browser.
 *
 * - The port: when the one asked for is taken by another program, HEISS UI
 *   takes the next free one (8788, 8789, …) instead of stopping with a note
 *   to edit .env. When it is taken by HEISS UI itself, that copy is already
 *   running: say where, and open it, instead of starting a second one.
 * - The browser: the launcher (scripts/start.mjs) opens the studio once,
 *   the first time the server is ready. Not in dev, not in CI, not over SSH or
 *   on a Linux machine without a display, and never with HEISS_NO_BROWSER=1
 *   (in the shell or .env) or `--no-browser`.
 *
 * No dependencies beyond Node: scripts/start.mjs imports this too.
 */
import { spawn } from "node:child_process";
import http from "node:http";

const truthy = (value) => /^(1|true|yes|on)$/i.test(String(value || "").trim());

/** Whether the launcher should open the studio in the default browser. */
export function shouldOpenBrowser({ env = process.env, argv = process.argv, platform = process.platform } = {}) {
  if (truthy(env.HEISS_NO_BROWSER) || argv.includes("--no-browser")) return false;
  if (truthy(env.CI) || env.SSH_CONNECTION || env.SSH_TTY) return false;
  if (/^dev/.test(env.npm_lifecycle_event || "")) return false;
  // A Linux server without a desktop has nowhere to show a browser.
  if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
  return true;
}

/** Opens `url` in the default browser, detached. Failing quietly is fine: the address is printed too. */
export function openBrowser(url, { platform = process.platform, run = spawn } = {}) {
  if (!/^https?:\/\//.test(String(url || ""))) return false;
  const [command, args] = platform === "darwin" ? ["open", [url]]
    : platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : ["xdg-open", [url]];
  try {
    const child = run(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on?.("error", () => {});
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}

/** Whether a HEISS UI server answers on this port of this computer. */
export function heissAnswersAt(port, { timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/api/ping", timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { if (body.length < 4096) body += chunk; });
      response.on("end", () => {
        // Older versions have no /api/ping, but their unknown-route answer names HEISS UI.
        try {
          const data = JSON.parse(body);
          resolve(data?.app === "heiss-ui" || /HEISS UI/.test(String(data?.error || "")));
        } catch {
          resolve(false);
        }
      });
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

function listenOnce(handler, port, host) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

/**
 * Listens on `port`, or on the next free one when another program has it.
 * Resolves `{ server, port, moved }`. Rejects with the listen error; when
 * HEISS UI itself holds a port on the way, the error has `heissRunning` and
 * that `port`. `tries` ports are tried in all; `fallback: false` tries one;
 * `skip` names ports the fallback passes over.
 */
export async function listenWithFallback(handler, { port, host, tries = 10, fallback = true, skip = [], isHeiss = heissAnswersAt } = {}) {
  const first = Number(port);
  for (let offset = 0; ; offset += 1) {
    const candidate = first + offset;
    // A port kept for something else of ours (HTTPS for other devices) is passed over.
    if (offset > 0 && skip.includes(candidate)) continue;
    try {
      const server = await listenOnce(handler, candidate, host);
      // Port 0 asks the system for any free port; report the one it gave.
      return { server, port: server.address()?.port || candidate, moved: offset > 0 };
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
      if (await isHeiss(candidate)) {
        error.heissRunning = true;
        error.port = candidate;
        throw error;
      }
      if (!fallback || offset + 1 >= tries || candidate >= 65535) {
        error.port = first;
        throw error;
      }
    }
  }
}

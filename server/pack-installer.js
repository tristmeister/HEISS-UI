import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { comfy } from "./comfy.js";
import { comfyPython, comfyRootDir } from "./node-install.js";
import { nodePack } from "./node-packs.js";

/**
 * One-click installs of the node packs in node-packs.js, and only those: a
 * request names a pack id, never a URL or a path.
 *
 * Two routes, best first:
 *   manager - the pack is in ComfyUI-Manager's list and Manager answers: queue
 *             an install task there (Manager 4 cannot install by Git URL
 *             unless its legacy UI and a config flag are on, so unlisted
 *             packs never go this way).
 *   local   - ComfyUI sits on this machine: clone the pack into custom_nodes
 *             and install its requirements with ComfyUI's own Python.
 * Either way ComfyUI loads the nodes only after a restart.
 */

const installs = new Map();
const tailLimit = 4000;
const stepTimeoutMs = 15 * 60 * 1000;

function snapshot(state) {
  if (!state) return null;
  const { child, ...rest } = state;
  return rest;
}

export function packInstallState(id) {
  return snapshot(installs.get(id));
}

/** What an Install button can do for this pack right now, without asking Manager. */
export function packInstallRoutes(id, root = comfyRootDir()) {
  const pack = nodePack(id);
  return { manager: Boolean(pack.manager), local: Boolean(root && comfyPython(root)) };
}

async function managerAnswers() {
  try {
    await comfy("/v2/manager/version", { signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

function run(state, command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, windowsHide: true });
    state.child = child;
    const timer = setTimeout(() => child.kill(), stepTimeoutMs);
    const collect = (chunk) => { state.log = (state.log + chunk.toString()).slice(-tailLimit); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(error.code === "ENOENT" ? `${path.basename(command)} is not installed on this computer.` : error.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      state.child = null;
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} stopped with exit code ${code}.`));
    });
  });
}

async function installLocally(state, pack) {
  const root = comfyRootDir();
  const python = comfyPython(root);
  if (!root || !python) throw new Error("ComfyUI isn't on this computer. Use the terminal steps instead.");
  const customNodes = path.join(root, "custom_nodes");
  const target = path.join(customNodes, pack.folder);
  if (!fs.existsSync(target)) {
    state.step = "Downloading the nodes";
    await run(state, "git", ["clone", pack.repository, target], customNodes);
  }
  if (fs.existsSync(path.join(target, "requirements.txt"))) {
    state.step = "Installing what they need";
    await run(state, python, ["-m", "pip", "install", "-r", "requirements.txt"], target);
  }
}

async function installWithManager(state, pack) {
  const uiId = `heiss-${crypto.randomUUID()}`;
  state.step = "Queued in ComfyUI-Manager";
  await comfy("/v2/manager/queue/task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ui_id: uiId, client_id: "heiss-ui", kind: "install",
      params: { id: pack.manager, version: "latest", selected_version: "latest", mode: "remote", channel: "default" }
    })
  });
  await comfy("/v2/manager/queue/start", { method: "POST" }).catch(() => null);
  state.step = "ComfyUI-Manager is installing";
  const deadline = Date.now() + stepTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const answer = await comfy(`/v2/manager/queue/history?ui_id=${encodeURIComponent(uiId)}`).catch(() => null);
    const item = answer?.history?.[uiId] || (answer?.history?.ui_id === uiId ? answer.history : null);
    if (!item) continue;
    if (item.status?.status_str === "success" || item.result === "success") return;
    const message = [item.result, ...(item.status?.messages || [])].filter((text) => text && text !== "failed").join(" ");
    throw new Error(message || "ComfyUI-Manager could not install it. Its security level may be too strict.");
  }
  throw new Error("ComfyUI-Manager did not finish in time.");
}

/** Starts (or reports) the install of one pack; the caller polls packInstallState. */
export async function startPackInstall(id) {
  const pack = nodePack(id);
  const current = installs.get(id);
  if (current?.status === "running") return snapshot(current);
  const routes = packInstallRoutes(id);
  const viaManager = routes.manager && await managerAnswers();
  if (!viaManager && !routes.local) {
    throw new Error("ComfyUI runs on another computer and Manager cannot install this pack, so it needs the steps below.");
  }
  const state = { id, name: pack.name, route: viaManager ? "manager" : "local", status: "running", step: "Starting", log: "", error: "", startedAt: Date.now(), finishedAt: 0 };
  installs.set(id, state);
  (async () => {
    try {
      if (viaManager) {
        try {
          await installWithManager(state, pack);
        } catch (error) {
          // Manager refused (security level) or failed: do it ourselves when we can.
          if (!routes.local) throw error;
          state.route = "local";
          state.log = `${error.message}\n`;
          await installLocally(state, pack);
        }
      } else {
        await installLocally(state, pack);
      }
      Object.assign(state, { status: "done", step: "Installed. Restart ComfyUI to load it.", finishedAt: Date.now() });
    } catch (error) {
      Object.assign(state, { status: "error", error: error.message, step: "", finishedAt: Date.now() });
    }
  })();
  return snapshot(state);
}

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { comfy } from "./comfy.js";
import { StringDecoder } from "node:string_decoder";
import { comfyPython, comfyRootDir, pipArgs, pythonEnv } from "./node-install.js";
import { nodePack } from "./node-packs.js";

/**
 * One-click installs of the node packs in node-packs.js, and only those: a
 * request names a pack id, never a URL or a path.
 *
 * Two routes, best first:
 *   manager - the pack is in ComfyUI-Manager's list and Manager answers: queue
 *             an install task there, through Manager 4's /v2 queue or the
 *             Manager 3 custom node's (Manager cannot install by Git URL
 *             unless a config flag is on, so unlisted packs never go this way).
 *   local   - ComfyUI sits on this machine: clone the pack into custom_nodes
 *             at its reviewed commit (node-packs.js), and install its
 *             requirements with ComfyUI's own Python, holding torch,
 *             torchvision, torchaudio and numpy at the versions ComfyUI has,
 *             so a pack can never swap out the PyTorch that ComfyUI runs on.
 * Either way ComfyUI loads the nodes only after a restart.
 *
 * When ComfyUI-Manager refuses an install because of its security level,
 * HEISS stops and asks (status "blocked"): going around a setting the person
 * chose happens only when they say so.
 */

const installs = new Map();

// Replaces git, pip and Manager for the setup demo (scripts/setup-demo.mjs); null in real use.
let transport = null;
export function setPackInstallTransport(fn) {
  transport = fn;
}
const tailLimit = 4000;
const stepTimeoutMs = 15 * 60 * 1000;

// What to do about it, since Manager itself only says "not allowed" (docs/guides/TROUBLESHOOTING.md has the steps).
export const managerRefusedMessage = "ComfyUI-Manager’s security level blocks this install. Set security_level = normal in Manager’s config.ini (ComfyUI/user/__manager/config.ini, or user/default/ComfyUI-Manager/config.ini in older versions), restart ComfyUI and try again, or use the terminal command.";

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

/** Which ComfyUI-Manager answers: 4 (built into ComfyUI, /v2 routes), 3 (the custom node), or 0. */
async function managerGeneration() {
  for (const [route, generation] of [["/v2/manager/version", 4], ["/manager/version", 3]]) {
    try {
      await comfy(route, { signal: AbortSignal.timeout(5000) });
      return generation;
    } catch {
      // Try the next.
    }
  }
  return 0;
}

/** Runs one step, its output into the install log. Resolves to what it printed on stdout. */
function run(state, command, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    // UTF-8 output from Python whatever the Windows code page, so names in the log stay readable.
    const child = spawn(command, args, { cwd, env: { ...env, GIT_TERMINAL_PROMPT: "0", PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }, windowsHide: true });
    state.child = child;
    const timer = setTimeout(() => child.kill(), stepTimeoutMs);
    let stdout = "";
    // One decoder per stream, so a character split across two chunks is not garbled.
    const collector = (keep) => {
      const decoder = new StringDecoder("utf8");
      return (chunk) => {
        const text = decoder.write(chunk);
        if (keep) stdout = (stdout + text).slice(-256 * 1024);
        state.log = (state.log + text).slice(-tailLimit);
      };
    };
    child.stdout.on("data", collector(true));
    child.stderr.on("data", collector(false));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(error.code === "ENOENT" ? `${path.basename(command)} is not installed on this computer.` : error.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      state.child = null;
      if (code === 0) resolve(stdout);
      else reject(new Error(`${path.basename(command)} stopped with exit code ${code}.`));
    });
  });
}

/** The packages a node pack must never replace: what ComfyUI's PyTorch stands on. */
export const heldPackages = ["torch", "torchvision", "torchaudio", "numpy"];

/**
 * A pip constraints file pinning heldPackages at whatever ComfyUI's Python has
 * now. A requirement that wants another version then fails the install with
 * pip's own explanation, instead of quietly replacing CUDA PyTorch.
 */
export function constraintsFrom(freeze = "") {
  const wanted = new Set(heldPackages);
  return String(freeze).split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      const name = line.split(/[=<>!~ @]/)[0].toLowerCase().replace(/_/g, "-");
      return wanted.has(name) && /==/.test(line);
    })
    .join("\n");
}

async function installLocally(state, pack) {
  const root = comfyRootDir();
  const python = comfyPython(root);
  if (!root || !python) throw new Error("ComfyUI isn't on this computer. Use the terminal steps instead.");
  const customNodes = path.join(root, "custom_nodes");
  const target = path.join(customNodes, pack.folder);
  if (!fs.existsSync(target)) {
    state.step = "Downloading the nodes";
    try {
      // Exactly the reviewed commit, never whatever the branch says today.
      await run(state, "git", ["clone", "--no-checkout", pack.repository, target], customNodes);
      if (pack.commit) {
        await run(state, "git", ["-c", "advice.detachedHead=false", "checkout", "--detach", pack.commit], target);
        const head = (await run(state, "git", ["rev-parse", "HEAD"], target)).trim();
        if (head !== pack.commit) throw new Error("The download isn’t the reviewed version.");
      } else {
        await run(state, "git", ["checkout"], target);
      }
    } catch (error) {
      // Only what this install created goes; a folder that was already there is never touched.
      fs.rmSync(target, { recursive: true, force: true });
      throw new Error(/reviewed|did not match|reference is not a tree|pathspec/i.test(`${error.message}\n${state.log}`)
        ? `The reviewed version of ${pack.name} (${pack.ref || pack.commit}) is no longer on GitHub, so it wasn’t installed.`
        : error.message);
    }
  } else if (pack.update && pack.commit && fs.existsSync(path.join(target, ".git"))) {
    // HEISS's own pack moves with HEISS: an older checkout is brought to the reviewed commit, if nobody edited it.
    state.step = "Updating the nodes";
    const head = (await run(state, "git", ["rev-parse", "HEAD"], target)).trim();
    // Already there, or further along than the pin (someone updated it themselves): leave it.
    const ahead = head !== pack.commit && await run(state, "git", ["merge-base", "--is-ancestor", pack.commit, head], target).then(() => true, () => false);
    if (head !== pack.commit && !ahead) {
      if ((await run(state, "git", ["status", "--porcelain"], target)).trim()) throw new Error(`${pack.folder} has local changes, so HEISS left it alone. Update it yourself, or remove the folder and install again.`);
      const known = await run(state, "git", ["cat-file", "-e", `${pack.commit}^{commit}`], target).then(() => true, () => false);
      try {
        if (!known) await run(state, "git", ["fetch", "--quiet", "origin"], target);
        await run(state, "git", ["-c", "advice.detachedHead=false", "checkout", "--detach", pack.commit], target);
      } catch {
        throw new Error(`Couldn’t update ${pack.name} to its reviewed version. Check the internet connection, or remove its folder and install again.`);
      }
    }
  }
  if (fs.existsSync(path.join(target, "requirements.txt"))) {
    state.step = "Checking ComfyUI’s PyTorch";
    let freeze;
    try {
      freeze = await run(state, python, [...pipArgs(python), "list", "--format=freeze", "--disable-pip-version-check"], target, pythonEnv(python));
    } catch {
      throw new Error("Couldn’t check ComfyUI’s PyTorch version, so the pack’s packages weren’t installed. Use the terminal steps instead.");
    }
    const constraints = path.join(os.tmpdir(), `heiss-constraints-${crypto.randomUUID()}.txt`);
    fs.writeFileSync(constraints, `${constraintsFrom(freeze)}\n`);
    state.step = "Installing what they need";
    try {
      await run(state, python, [...pipArgs(python), "install", "-r", "requirements.txt", "-c", constraints, "--disable-pip-version-check"], target, pythonEnv(python));
    } catch (error) {
      if (/ResolutionImpossible|conflict/i.test(state.log)) throw new Error(`${pack.name} needs a different PyTorch or NumPy than ComfyUI has, so its packages weren’t installed. Check its page for a version that fits.`);
      throw error;
    } finally {
      fs.rmSync(constraints, { force: true });
    }
  }
}

/** A refusal because of ComfyUI-Manager's security level, as opposed to a failed install. */
function managerRefused(error) {
  const refused = new Error(error.message);
  refused.security = true;
  return refused;
}
const securityWords = /security|not allowed|forbidden|\b403\b|permission/i;

async function installWithManager(state, pack) {
  const uiId = `heiss-${crypto.randomUUID()}`;
  state.step = "Queued in ComfyUI-Manager";
  try {
    await comfy("/v2/manager/queue/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ui_id: uiId, client_id: "heiss-ui", kind: "install",
        params: { id: pack.manager, version: "latest", selected_version: "latest", mode: "remote", channel: "default" }
      })
    });
  } catch (error) {
    if (/\b403\b/.test(error.message) || securityWords.test(error.message)) throw managerRefused(new Error("ComfyUI-Manager’s security level blocks this install."));
    throw error;
  }
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
    if (!message || securityWords.test(message) || /not allowed/i.test(message)) throw managerRefused(new Error(managerRefusedMessage));
    throw new Error(message || "ComfyUI-Manager couldn’t install it.");
  }
  throw new Error("ComfyUI-Manager didn’t finish in time.");
}

/**
 * Manager 3 (the custom node) queues by registry id too, but reports results
 * only over its websocket and clears them when the queue ends. So HEISS waits
 * for the queue to stop and then checks the pack is among the installed ones.
 */
async function installWithManager3(state, pack) {
  state.step = "Queued in ComfyUI-Manager";
  try {
    await comfy("/manager/queue/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ui_id: `heiss-${crypto.randomUUID()}`, id: pack.manager, version: "latest", selected_version: "latest",
        mode: "remote", channel: "default", skip_post_install: false
      })
    });
  } catch (error) {
    if (/\b403\b/.test(error.message) || securityWords.test(error.message)) throw managerRefused(new Error(managerRefusedMessage));
    throw error;
  }
  // Bodyless POST: Manager rejects form content types here. Older versions took a GET.
  await comfy("/manager/queue/start", { method: "POST" }).catch(() => comfy("/manager/queue/start").catch(() => null));
  state.step = "ComfyUI-Manager is installing";
  const deadline = Date.now() + stepTimeoutMs;
  let quiet = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const status = await comfy("/manager/queue/status").catch(() => null);
    // Two idle answers in a row: the worker is done (or never had to start).
    quiet = status && !status.is_processing ? quiet + 1 : 0;
    if (quiet < 2) continue;
    const installed = await comfy("/customnode/installed").catch(() => null);
    const packs = Object.entries(installed || {});
    if (packs.some(([name, info]) => name === pack.manager || info?.cnr_id === pack.manager || info?.aux_id === pack.manager)) return;
    throw new Error("ComfyUI-Manager didn’t install it. The ComfyUI log shows why.");
  }
  throw new Error("ComfyUI-Manager didn’t finish in time.");
}

/**
 * Starts (or reports) the install of one pack; the caller polls packInstallState.
 * `overrideManager`: the person saw Manager's security refusal and chose to
 * install with ComfyUI's own Python anyway.
 */
export async function startPackInstall(id, { overrideManager = false } = {}) {
  const pack = nodePack(id);
  const current = installs.get(id);
  if (current?.status === "running") return snapshot(current);
  const routes = packInstallRoutes(id);
  if (overrideManager && !routes.local) throw new Error("ComfyUI isn't on this computer, so only ComfyUI-Manager can install this.");
  const generation = routes.manager && !overrideManager ? await managerGeneration() : 0;
  const viaManager = generation > 0;
  if (!viaManager && !routes.local) {
    throw new Error("ComfyUI runs on another computer and ComfyUI-Manager can’t install this pack. Use the steps below.");
  }
  const state = { id, name: pack.name, route: viaManager ? "manager" : "local", status: "running", step: "Starting", log: "", error: "", startedAt: Date.now(), finishedAt: 0 };
  installs.set(id, state);
  (async () => {
    try {
      if (transport) {
        await transport(state, pack);
      } else if (viaManager) {
        try {
          await (generation === 4 ? installWithManager(state, pack) : installWithManager3(state, pack));
        } catch (error) {
          // Refused on purpose (its security level): stop and ask, never go around it silently.
          if (error.security) {
            Object.assign(state, { status: "blocked", step: "", error: error.message, canOverride: routes.local, finishedAt: Date.now() });
            return;
          }
          // Failed for another reason: do it ourselves when we can.
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

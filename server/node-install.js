import fs from "node:fs";
import path from "node:path";
import { comfyModelsDir, missingNodes } from "./comfy.js";
import { nodePack } from "./node-packs.js";
import { packInstallRoutes } from "./pack-installer.js";

/**
 * How to add a custom node pack to ComfyUI when HEISS cannot do it itself:
 * ComfyUI-Manager's Git URL install, or one terminal command. Shared by smart
 * upscale (SeedVR2) and the model families that run on a pack (Sana).
 */

/** The ComfyUI folder itself, when it sits on this machine next to the models folder we found. */
export function comfyRootDir() {
  const models = comfyModelsDir();
  return models ? path.dirname(models) : "";
}

/**
 * The Python that ComfyUI runs with, so pip installs into the right place.
 * Covers a venv inside ComfyUI, the Desktop app's standalone env and the
 * Windows portable build; anything else falls back to a plain `python`.
 */
export function comfyPython(root, platform = process.platform) {
  if (!root) return "";
  const win = platform === "win32";
  const paths = win ? path.win32 : path.posix;
  const candidates = win
    ? [[".venv", "Scripts", "python.exe"], ["venv", "Scripts", "python.exe"], ["..", "python_embeded", "python.exe"], ["..", "python_embedded", "python.exe"]]
    : [[".venv", "bin", "python"], ["venv", "bin", "python"], ["..", "standalone-env", "bin", "python3"], ["..", ".venv", "bin", "python"]];
  const found = candidates.map((parts) => paths.join(root, ...parts)).find((file) => fs.existsSync(file));
  return found ? paths.resolve(found) : "";
}

/**
 * Setup without ComfyUI Manager: clone the pack into custom_nodes and install
 * its requirements with ComfyUI's own Python. On a machine we can see, the
 * paths are the real ones; if the pack folder is already there but the nodes
 * do not load, only the requirements are missing.
 *
 * Windows gets two spellings. Windows Terminal opens PowerShell 5.1, which
 * knows neither `cd /d` nor `&&` and will not run a quoted path without `&`;
 * `if ($?)` chains steps there the way `&&` does in cmd. Elsewhere a missing
 * environment falls back to `python3`, since many Linux systems have no `python`.
 *
 * pack: { repository, folder }
 */
export function packInstallPlan(pack, root = comfyRootDir(), platform = process.platform) {
  const win = platform === "win32";
  const paths = win ? path.win32 : path.posix;
  const customNodes = root ? paths.join(root, "custom_nodes") : "";
  const python = comfyPython(root, platform);
  const cloned = Boolean(customNodes) && fs.existsSync(paths.join(customNodes, pack.folder));
  const requirements = paths.join(pack.folder, "requirements.txt");
  const folder = customNodes || paths.join("ComfyUI", "custom_nodes");
  const clone = `git clone ${pack.repository}`;
  const commands = [];
  if (win) {
    const exe = python ? `"${python}"` : "python";
    const steps = [`Set-Location "${folder}"`, ...(cloned ? [] : [clone]), `${python ? "& " : ""}${exe} -m pip install -r ${requirements}`];
    commands.push({ shell: "powershell", label: "PowerShell", command: steps.map((step, i) => (i ? `if ($?) { ${step} }` : step)).join("; ") });
    commands.push({ shell: "cmd", label: "Command Prompt", command: [`cd /d "${folder}"`, ...(cloned ? [] : [clone]), `${exe} -m pip install -r ${requirements}`].join(" && ") });
  } else {
    const exe = python ? `"${python}"` : "python3";
    commands.push({ shell: "sh", label: "Terminal", command: [`cd "${folder}"`, ...(cloned ? [] : [clone]), `${exe} -m pip install -r ${requirements}`].join(" && ") });
  }
  return {
    exact: Boolean(customNodes && python),
    customNodesDir: customNodes,
    python,
    cloned,
    needsGit: !cloned,
    commands
  };
}

/**
 * One command that fetches a diffusers-format Hugging Face repo into
 * models/diffusers with ComfyUI's own Python (huggingface_hub ships with it).
 */
export function diffusersDownloadPlan(repo, root = comfyRootDir(), platform = process.platform) {
  const win = platform === "win32";
  const paths = win ? path.win32 : path.posix;
  const python = comfyPython(root, platform);
  const name = repo.split("/").pop();
  const target = root ? paths.join(root, "models", "diffusers", name) : paths.join("ComfyUI", "models", "diffusers", name);
  const code = `from huggingface_hub import snapshot_download; snapshot_download('${repo}', local_dir=r'${target}')`;
  const exe = python ? `"${python}"` : win ? "python" : "python3";
  const commands = win
    ? [
      { shell: "powershell", label: "PowerShell", command: `${python ? "& " : ""}${exe} -c "${code}"` },
      { shell: "cmd", label: "Command Prompt", command: `${exe} -c "${code}"` }
    ]
    : [{ shell: "sh", label: "Terminal", command: `${exe} -c "${code}"` }];
  return { exact: Boolean(root && python), target, commands };
}

/**
 * The "missing" entry for a node pack that is not loaded, or null when it is:
 * what setup panels render as the Manager/terminal install. `extra` names
 * nodes beyond the pack's usual set that this use needs.
 */
export function missingPackPart(info, packId, { detail = "", extra = [] } = {}) {
  const pack = nodePack(packId);
  const absent = missingNodes(info, [...pack.nodes, ...extra]);
  if (!absent.length) return null;
  return {
    part: "comfy", label: `${pack.name} nodes`,
    detail: detail || `ComfyUI needs the ${pack.name} custom nodes for this.`,
    downloads: [],
    missingNodes: absent,
    nodePack: { id: pack.id, name: pack.name, repository: pack.repository, folder: pack.folder, search: pack.search || "", note: pack.note || "" },
    install: packInstallPlan(pack),
    autoInstall: packInstallRoutes(pack.id)
  };
}

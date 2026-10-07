import { pipArgs } from "./node-install.js";

/**
 * Things about a user's ComfyUI setup worth one calm note above the prompt
 * bar, from what ComfyUI reports in /system_stats (docs/speed-research.md).
 * Only what is clearly worth acting on: the composer offers "Hide" (until the
 * page reloads) and "Don't show again".
 *
 * Each tip: { id, title, detail, command?, commandNote? }
 */
export function setupTips(stats = {}, { python = "", platform = process.platform } = {}) {
  const tips = [];
  const cuda = cuda13Tip(stats, { python, platform });
  if (cuda) tips.push(cuda);
  return tips;
}

/** "2.8.0+cu128" → 12.8; null without a CUDA build tag. */
export function torchCudaVersion(version = "") {
  const match = /\+cu(\d{2,3})\b/.exec(String(version));
  if (!match) return null;
  const digits = match[1];
  return Number(`${digits.slice(0, -1)}.${digits.slice(-1)}`);
}

/**
 * CUDA 13 drops Maxwell, Pascal and Volta (GTX 900/1000, Titan V): those
 * cards stay on CUDA 12, so they never get the tip. Turing (RTX 20, GTX 16)
 * and newer can move up.
 */
export function cuda13Capable(name = "") {
  const text = String(name);
  if (/\b(GTX\s*(9\d\d|10\d\d)|Titan\s*(X|Xp|V)\b|Tesla\s*[PKMV]\d+|Quadro\s*[PMK]\d+|\bP\d{2,3}\b|\bV100\b)/i.test(text)) return false;
  return /\b(RTX|GTX\s*16\d\d|MX\s*[45]\d\d|A\d{1,4}G?|L\d{1,2}S?|GH\d{2,3}|H\d{2,3}|B\d{2,3}|GB\d{2,3}|Quadro\s*RTX|T4|T\d{3,4})\b/i.test(text);
}

/**
 * ComfyUI's own fast kernels (comfy-kitchen: fp8, NVFP4, int8 matmuls and
 * fused ops) switch themselves off unless PyTorch is a CUDA 13 build. Users
 * report runs up to about twice as fast after moving to it.
 */
function cuda13Tip(stats, { python, platform }) {
  const device = Array.isArray(stats?.devices) ? stats.devices[0] : null;
  if (!device || device.type !== "cuda" || !/nvidia/i.test(String(device.name || ""))) return null;
  const cuda = torchCudaVersion(stats?.system?.pytorch_version);
  if (cuda === null || cuda >= 13 || !cuda13Capable(device.name)) return null;
  const win = platform === "win32";
  const exe = python ? (win ? `& "${python}"` : `"${python}"`) : (win ? "python" : "python3");
  const args = python ? pipArgs(python).join(" ") : "-m pip";
  return {
    id: "cuda13",
    title: "ComfyUI isn't using its fastest kernels",
    detail: `Your PyTorch is a CUDA ${cuda} build, and ComfyUI switches its fast kernels off below CUDA 13. Updating PyTorch to the CUDA 13 build often makes pictures noticeably faster on this card.`,
    command: `${exe} ${args} install --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130`,
    commandNote: `${python ? "This runs ComfyUI's own Python." : "Run it with the Python ComfyUI uses (its venv, or python_embeded on the portable build)."} Close ComfyUI first and start it again afterwards. It needs an NVIDIA driver from 2025 or later (580+). Add-ons built for your current PyTorch, such as xformers or SageAttention, need updating too.`
  };
}

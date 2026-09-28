import { execFile } from "node:child_process";
import os from "node:os";

/**
 * What ComfyUI runs on, in plain terms: the kind of GPU, its name, its memory
 * and the computer's RAM, plus one number the studio makes fit decisions with,
 * the memory "budget" in GB. ComfyUI's /system_stats is the source (it describes
 * the computer ComfyUI runs on, which may not be this one); this computer is
 * only asked when ComfyUI is on it and does not answer.
 *
 * Apple Silicon shares one pool of memory between CPU and GPU. ComfyUI reports
 * that pool as the "VRAM" of its mps device (psutil's total and available), but
 * macOS only lets the GPU wire part of it. See docs/hardware-notes.md.
 */

// Graphics memory is sold in binary gigabytes ("a 24 GB card" holds 24 GiB), so
// budgets count that way too; download sizes elsewhere stay decimal, like Finder's.
const GiB = 1024 ** 3;

/**
 * The share of a Mac's unified memory HEISS counts on for models when no GPU
 * limit is set. Metal's own recommendedMaxWorkingSetSize lands at about 74–78%
 * on recent Macs; a little under that leaves room for macOS and the apps around.
 */
export const APPLE_UNIFIED_SHARE = 0.7;

const gigabytes = (bytes) => Math.round((Number(bytes) || 0) / GiB * 10) / 10;

/** "cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync" → "NVIDIA GeForce RTX 4090". */
export function cleanDeviceName(name = "") {
  return String(name)
    .replace(/^CUDA\s+\S+:\s+/i, "")
    .replace(/^(cuda|xpu|npu|mlu)(:\d+)?\s+/i, "")
    .replace(/\s+:\s+\S*\s*$/, "")
    .trim();
}

/** nvidia, amd, intel, apple, cpu or other, from ComfyUI's device type and name. */
export function gpuKind(device = {}) {
  const type = String(device.type || "").toLowerCase();
  const name = String(device.name || "");
  if (type === "mps") return "apple";
  if (type === "cpu") return "cpu";
  if (/nvidia|geforce|quadro|tesla|rtx|gtx/i.test(name)) return "nvidia";
  // ROCm builds of PyTorch present AMD cards as "cuda" devices.
  if (/amd|radeon|instinct/i.test(name)) return "amd";
  if (type === "xpu" || /intel|arc\b/i.test(name)) return "intel";
  if (type === "cuda") return "nvidia";
  return "other";
}

/**
 * The hardware summary from ComfyUI's /system_stats. `local` adds what only
 * this computer can say (a Mac's GPU wired limit), when ComfyUI runs here.
 */
export function hardwareFromStats(stats = {}, local = {}) {
  return withSizes(readStats(stats, local));
}

/** GB figures for the UI to show as they are, next to the raw bytes. */
function withSizes(hardware) {
  return { ...hardware, vramGB: hardware.unified ? 0 : gigabytes(hardware.vramTotal), ramGB: gigabytes(hardware.ramTotal) };
}

function readStats(stats, local) {
  const device = Array.isArray(stats?.devices) ? stats.devices[0] : null;
  const system = stats?.system || {};
  const ramTotal = Number(system.ram_total) || 0;
  const ramFree = Number(system.ram_free) || 0;
  if (!device) return unknownHardware({ ramTotal, ramFree, os: String(system.os || "") });
  const kind = gpuKind(device);
  const unified = kind === "apple";
  const vramTotal = Number(device.vram_total) || 0;
  const vramFree = Number(device.vram_free) || 0;
  const name = unified ? "Apple Silicon" : kind === "cpu" ? "CPU" : cleanDeviceName(device.name);
  const base = { known: true, source: "comfyui", kind, name, unified, os: String(system.os || ""), vramTotal, vramFree, ramTotal, ramFree };
  if (unified) return { ...base, ...appleBudget(ramTotal || vramTotal, local.wiredLimitMb) };
  // DirectML reports a placeholder 1 GB; a CPU has no graphics memory to budget.
  if (kind === "cpu" || vramTotal <= 1.1 * 1024 ** 3) return { ...base, budgetGB: null, budgetSource: "" };
  return { ...base, budgetGB: gigabytes(vramTotal), budgetSource: "vram" };
}

/** A Mac's budget: the GPU wired limit when someone set one, else a share of its memory. */
export function appleBudget(ramBytes, wiredLimitMb = 0) {
  const limit = Number(wiredLimitMb) * 1024 * 1024;
  if (limit > 0 && ramBytes > 0) return { budgetGB: gigabytes(Math.min(limit, ramBytes)), budgetSource: "wired-limit" };
  if (limit > 0) return { budgetGB: gigabytes(limit), budgetSource: "wired-limit" };
  if (!ramBytes) return { budgetGB: null, budgetSource: "" };
  return { budgetGB: gigabytes(ramBytes * APPLE_UNIFIED_SHARE), budgetSource: "unified-share" };
}

function unknownHardware(extra = {}) {
  return { known: false, source: "", kind: "", name: "", unified: false, vramTotal: 0, vramFree: 0, ramTotal: 0, ramFree: 0, budgetGB: null, budgetSource: "", ...extra };
}

/**
 * This computer, for when ComfyUI does not answer but runs here: an Apple
 * Silicon Mac from its memory, an NVIDIA card from nvidia-smi, else only RAM.
 */
export async function localHardware({ platform = process.platform, arch = process.arch, run = runQuiet } = {}) {
  const ramTotal = os.totalmem();
  const ramFree = os.freemem();
  if (platform === "darwin" && arch === "arm64") {
    const wiredLimitMb = await macWiredLimitMb(run);
    return withSizes({ known: true, source: "this-computer", kind: "apple", name: "Apple Silicon", unified: true, os: platform, vramTotal: ramTotal, vramFree: ramFree, ramTotal, ramFree, ...appleBudget(ramTotal, wiredLimitMb) });
  }
  const smi = await run("nvidia-smi", ["--query-gpu=name,memory.total,memory.free", "--format=csv,noheader,nounits"]);
  const [name, total, free] = String(smi || "").split(/\r?\n/)[0].split(",").map((part) => part.trim());
  if (name && Number(total) > 0) {
    const vramTotal = Number(total) * 1024 * 1024;
    return withSizes({ known: true, source: "this-computer", kind: "nvidia", name, unified: false, os: platform, vramTotal, vramFree: Number(free) * 1024 * 1024 || 0, ramTotal, ramFree, budgetGB: gigabytes(vramTotal), budgetSource: "vram" });
  }
  return withSizes(unknownHardware({ source: "this-computer", os: platform, ramTotal, ramFree }));
}

/** `sysctl iogpu.wired_limit_mb`: 0 (the macOS default) unless someone raised the GPU's share. */
let wiredLimitCache = null;
export async function macWiredLimitMb(run = runQuiet) {
  if (process.platform !== "darwin") return 0;
  if (wiredLimitCache && Date.now() - wiredLimitCache.at < 60_000) return wiredLimitCache.value;
  const value = Number(String(await run("sysctl", ["-n", "iogpu.wired_limit_mb"]) || "").trim()) || 0;
  wiredLimitCache = { value, at: Date.now() };
  return value;
}

function runQuiet(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 2500, windowsHide: true }, (error, stdout) => resolve(error ? "" : String(stdout || "")));
  });
}

/** Whether an address points at this computer, so its own hardware can speak for ComfyUI. */
export function isThisComputer(url = "") {
  try {
    const { hostname } = new URL(url);
    return ["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0"].includes(hostname) || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

/**
 * The hardware ComfyUI runs on: from its /system_stats when it answers (with a
 * Mac's wired limit added when that Mac is this one), else this computer's own
 * view when ComfyUI is meant to run here, else unknown.
 */
export async function describeHardware({ stats = null, comfyUrl = "", platform = process.platform } = {}) {
  const here = isThisComputer(comfyUrl);
  if (stats?.devices?.length) {
    const apple = stats.devices[0]?.type === "mps";
    const wiredLimitMb = apple && here && platform === "darwin" ? await macWiredLimitMb() : 0;
    return hardwareFromStats(stats, { wiredLimitMb });
  }
  return here ? localHardware() : withSizes(unknownHardware());
}

/**
 * Whether a download needing `memoryGB` sits comfortably within `hardware`'s
 * budget (and `ramGB` of system memory, where it names one). Unknown when the
 * budget is: the studio then says nothing either way.
 */
export function fitsHardware(hardware, { memoryGB = 0, ramGB = 0 } = {}) {
  if (!hardware?.budgetGB) return null;
  // A card reports a little under its label (a "12 GB" card: 11.9); that still counts.
  if (memoryGB > hardware.budgetGB + 0.25) return false;
  if (ramGB && hardware.ramTotal && ramGB > gigabytes(hardware.ramTotal) + 0.25) return false;
  return true;
}

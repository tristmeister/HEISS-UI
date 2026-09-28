import fs from "node:fs";
import os from "node:os";

/**
 * What a bug report needs to know about this setup: HEISS UI, Node.js, the
 * system, ComfyUI and the GPU. Nothing personal: no prompts, images, file or
 * folder names, and no addresses (only whether ComfyUI runs on this computer).
 */

/** A readable name for this system, with its version where the system says it. */
export function systemName({ platform = process.platform, release = os.release(), version = typeof os.version === "function" ? os.version() : "", readFile = (file) => fs.readFileSync(file, "utf8") } = {}) {
  if (platform === "win32") return `${version || "Windows"} (${release})`;
  if (platform === "darwin") return `macOS (Darwin ${release})`;
  if (platform === "linux") {
    try {
      const pretty = readFile("/etc/os-release").match(/^PRETTY_NAME="?([^"\n]+)"?/m)?.[1];
      if (pretty) return `${pretty} (Linux ${release})`;
    } catch {
      // No os-release (a container, an unusual distribution).
    }
    return `Linux ${release}`;
  }
  return `${platform} ${release}`;
}

const gigabytes = (bytes) => (Number(bytes) > 0 ? `${(Number(bytes) / 1024 ** 3).toFixed(1)} GB` : "");

/**
 * The facts, as data. `stats` is ComfyUI's /system_stats, or null when it
 * did not answer.
 */
export function diagnostics({ version = "", install = "", stats = null, comfyLocal = true, platform = process.platform, arch = process.arch } = {}) {
  const system = stats?.system || {};
  const devices = Array.isArray(stats?.devices) ? stats.devices : [];
  return {
    heiss: { version, install },
    node: process.versions.node,
    system: { name: systemName({ platform }), platform, arch, memoryBytes: os.totalmem() },
    comfy: stats
      ? {
        reachable: true,
        local: Boolean(comfyLocal),
        version: String(system.comfyui_version || ""),
        python: String(system.python_version || "").split(" ")[0],
        pytorch: String(system.pytorch_version || ""),
        embeddedPython: Boolean(system.embedded_python),
        devices: devices.map((device) => ({
          name: String(device.name || ""),
          type: String(device.type || ""),
          vramBytes: Number(device.vram_total) || 0,
          vramFreeBytes: Number(device.vram_free) || 0
        }))
      }
      : { reachable: false, local: Boolean(comfyLocal) }
  };
}

/** The same facts as lines of text, ready to paste into an issue. */
export function diagnosticsText(report) {
  const { heiss, node, system, comfy } = report;
  const lines = [
    `HEISS UI ${heiss.version || "(unknown version)"}${heiss.install ? ` (${heiss.install})` : ""}`,
    `Node.js ${node}`,
    `System: ${system.name}, ${system.arch}${system.memoryBytes ? `, ${gigabytes(system.memoryBytes)} RAM` : ""}`
  ];
  if (!comfy.reachable) {
    lines.push(`ComfyUI: not answering (${comfy.local ? "on this computer" : "on another computer"})`);
    return lines.join("\n");
  }
  const runtime = [comfy.python && `Python ${comfy.python}`, comfy.pytorch && `PyTorch ${comfy.pytorch}`, comfy.embeddedPython && "portable"].filter(Boolean).join(", ");
  lines.push(`ComfyUI ${comfy.version || "(unknown version)"}, ${comfy.local ? "on this computer" : "on another computer"}${runtime ? `; ${runtime}` : ""}`);
  if (!comfy.devices.length) lines.push("GPU: none reported");
  for (const device of comfy.devices) {
    const memory = device.vramBytes ? `, ${gigabytes(device.vramBytes)} VRAM${device.vramFreeBytes ? ` (${gigabytes(device.vramFreeBytes)} free)` : ""}` : "";
    lines.push(`GPU: ${device.name || "unnamed"}${device.type ? ` [${device.type}]` : ""}${memory}`);
  }
  return lines.join("\n");
}

import { writeLocalEnvValue } from "./env.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

export const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(__dirname, "..");
export const comfyUrl = process.env.COMFY_URL || "http://127.0.0.1:8188";
export const host = process.env.HOST || "127.0.0.1";
export const port = Number(process.env.PORT || 8787);
const localComfyOutputDir = "C:\\CUVenv\\ComfyUI\\output";
export let comfyOutputDir = process.env.COMFY_OUTPUT_DIR || (fs.existsSync(localComfyOutputDir) ? localComfyOutputDir : "");

export function setComfyOutputDir(value = "") {
  const requested = String(value || "").trim();
  if (!requested) throw new Error("Choose an existing ComfyUI output folder.");
  const next = path.resolve(requested);
  if (!fs.existsSync(next) || !fs.statSync(next).isDirectory()) throw new Error("Choose an existing ComfyUI output folder.");
  writeLocalEnvValue("COMFY_OUTPUT_DIR", next);
  comfyOutputDir = next;
  return comfyOutputDir;
}
export const localHosts = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
export const allowLanActions = process.env.JAI_ALLOW_LAN === "1" || host === "0.0.0.0" || host === "::";

export function isTrustedClient(remote = "") {
  if (localHosts.has(remote)) return true;
  const address = String(remote || "").replace(/^::ffff:/, "");
  if (!allowLanActions) return false;
  if (/^10\./.test(address)) return true;
  if (/^192\.168\./.test(address)) return true;
  const match = address.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

export function isLocalClient(remote = "") {
  return localHosts.has(remote) || localHosts.has(String(remote || "").replace(/^::ffff:/, ""));
}

export async function comfy(pathname, options = {}) {
  const response = await fetch(`${comfyUrl}${pathname}`, options);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(normalizeComfyError(`Comfy ${response.status}: ${text || response.statusText}`));
  }
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response.arrayBuffer();
}

export function normalizeComfyError(message = "") {
  let text = String(message || "").trim();
  const jsonMatch = text.match(/\{[\s\S]*\}$/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const nodeErrors = parsed?.node_errors || {};
      const details = Object.entries(nodeErrors).flatMap(([nodeId, node]) =>
        (node?.errors || []).map((error) => {
          const name = error?.name || node?.class_type || `node ${nodeId}`;
          const detail = error?.message || error?.type || "invalid value";
          return `${name}: ${detail}`;
        })
      );
      text = details.length
        ? `${parsed?.error?.message || "Prompt validation failed"}: ${details.slice(0, 3).join("; ")}`
        : parsed?.error?.message || text;
    } catch {
      // Keep the original ComfyUI error text.
    }
  }
  if (/float4_e2m1fn_x2/i.test(text)) {
    return "This NVFP4 model needs a newer PyTorch build. Use a non-NVFP4 model or update ComfyUI's PyTorch.";
  }
  if (/out of memory|cuda.*memory|allocation/i.test(text)) {
    return "ComfyUI ran out of GPU memory. Try a smaller size, fewer steps, or a lighter model.";
  }
  if (/cannot import|no module named|module .* has no attribute|attributeerror/i.test(text)) {
    return "ComfyUI failed inside Python. Check that the selected model, custom nodes, and PyTorch version are compatible.";
  }
  return text || "ComfyUI request failed.";
}

export function optionsFor(info, node, key) {
  const value = info?.[node]?.input?.required?.[key]?.[0];
  if (Array.isArray(value)) return value;
  if (value?.options) return value.options;
  return [];
}

export function hasNode(info, node) {
  return Boolean(info?.[node]);
}

export function missingNodes(info, nodes = []) {
  return nodes.filter((node) => !hasNode(info, node));
}
export function nodeRange(info, node, key, fallback = {}) {
  const meta = info?.[node]?.input?.required?.[key]?.[1];
  return typeof meta === "object" && !Array.isArray(meta) ? { ...fallback, ...meta } : fallback;
}

export function textRange(info, node, key) {
  const meta = info?.[node]?.input?.required?.[key]?.[1];
  if (typeof meta !== "object" || Array.isArray(meta)) return {};
  const tooltip = String(meta.tooltip || "");
  const match = tooltip.match(/maximum(?: length)? (?:is |of )?([0-9,]+)\s*(?:characters|chars)?/i);
  const parsedMax = match ? Number(match[1].replace(/,/g, "")) : undefined;
  return {
    ...meta,
    max: Number(meta.max || meta.maxLength || meta.max_length || parsedMax || 0) || undefined
  };
}

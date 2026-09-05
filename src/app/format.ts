import type React from 'react';
import type { AspectPreset, GalleryItem, LoraSelection } from './types';

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function aspectIconStyle(option: AspectPreset): React.CSSProperties {
  const scale = Math.min(38 / option.w, 28 / option.h);
  return {
    width: Math.max(13, Math.round(option.w * scale)),
    height: Math.max(13, Math.round(option.h * scale))
  };
}

function textValue(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => (typeof item === "string" || typeof item === "number") ? String(item) : "").filter(Boolean).join(" ");
  if (typeof value === "number") return String(value);
  return "";
}

export function titleFromPrompt(text: unknown = "") {
  const compact = textValue(text).replace(/\s+/g, " ").trim();
  return compact.length > 76 ? `${compact.slice(0, 73)}...` : compact;
}

export function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}:${String(rest).padStart(2, "0")}` : `${rest}s`;
}

export function formatGeneratedAt(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function settingMax(meta?: { max?: number }) {
  return Number.isFinite(meta?.max) && Number(meta?.max) > 0 ? Number(meta?.max) : undefined;
}

export function textLength(text: string) {
  return Array.from(text).length;
}

export function characterMeta(text: string, limit?: number) {
  const length = textLength(text);
  if (!limit) return `${length.toLocaleString()} chars`;
  return `${length.toLocaleString()} / ${limit.toLocaleString()}`;
}

export function clampText(text: string, limit?: number) {
  return limit ? Array.from(text).slice(0, limit).join("") : text;
}

function activeLoras(value: unknown): LoraSelection[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item?.enabled !== false && item?.name);
}

function formatLoraStack(value: unknown) {
  return activeLoras(value).map((item) => `${item.name} (${Number(item.strength ?? 0.7).toFixed(2)})`).join(", ");
}

export function fullGenerationText(item: GalleryItem) {
  const settings = item.settings || {};
  const lines = [
    `Prompt: ${item.prompt || ""}`,
    `Negative prompt: ${item.negative || ""}`,
    `Model: ${item.model || ""}`,
    `Output: ${item.outputName || item.filename || ""}`,
    `Type: ${item.type}`,
    `Aspect: ${item.width || "?"}x${item.height || "?"}`,
    `Generated: ${formatGeneratedAt(item.createdAt)}`
  ];
  for (const [key, value] of Object.entries(settings)) {
    if (value !== "" && value !== undefined && value !== null && value !== 0) {
      lines.push(`${key}: ${key === "loras" ? formatLoraStack(value) : value}`);
    }
  }
  return lines.join("\n");
}

export function generationDetailEntries(item: GalleryItem) {
  const settings = item.settings || {};
  const rows: Array<[string, string]> = [];
  const add = (label: string, value: unknown) => {
    if (value === "" || value === undefined || value === null || value === 0 || value === false) return;
    rows.push([label, String(value)]);
  };
  add("Aspect", `${item.width || "?"}x${item.height || "?"}`);
  add("Model", item.model);
  add("Output", item.outputName || item.filename);
  add("Generated", formatGeneratedAt(item.createdAt));
  add("Time", item.durationMs ? formatElapsed(item.durationMs) : "");
  add("Type", item.type);
  add("Workflow", settings.workflow);
  add("Steps", settings.steps);
  add("CFG", settings.cfg);
  add("Sampler", settings.sampler);
  add("Scheduler", settings.scheduler);
  add("Seed", settings.seed);
  add("LoRAs", formatLoraStack(settings.loras));
  if (item.type === "image") {
    const count = Number(settings.count || 0);
    if (count > 1) add("Images", count);
    if (item.referenceImage || settings.referenceImageName) add("Reference", settings.referenceImageName || item.referenceImageName || "Selected");
    if (item.referenceImage || settings.referenceImageName) add("Denoise", settings.denoise);
  }
  if (item.type === "video") {
    add("Frames", settings.frames);
    add("FPS", settings.fps);
  }
  return rows;
}

// crypto.randomUUID is exposed only in secure contexts, so it is missing when the
// app is opened over plain HTTP on a LAN address. getRandomValues has no such
// restriction, so fall back to building a v4 UUID from it.
export function clientJobUuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

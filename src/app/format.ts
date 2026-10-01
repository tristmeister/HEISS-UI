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

/** The counter only earns its space near the limit; an unlimited prompt never shows one. */
export function nearTextLimit(text: string, limit?: number) {
  return Boolean(limit) && textLength(text) >= (limit as number) * 0.8;
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

function fileStem(name: unknown) {
  return String(name || "").split(/[\\/]/).pop()!.replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i, "");
}

/**
 * "Copy settings": the prompt and what made the picture, as plain text to
 * paste into a note, a chat or another tool. Only what matters, no internals.
 */
export function settingsText(item: GalleryItem) {
  const settings = item.settings || {};
  const lines = [String(item.prompt || "").trim()];
  if (String(item.negative || "").trim()) lines.push(`Negative prompt: ${String(item.negative).trim()}`);
  const model = settings.modelName || (String(item.model || "").startsWith("custom:") ? "" : item.model);
  const parts = [
    model ? `Model: ${fileStem(model)}` : "",
    Number(settings.steps) ? `Steps: ${settings.steps}` : "",
    Number(settings.cfg) ? `CFG: ${settings.cfg}` : "",
    settings.sampler ? `Sampler: ${settings.sampler}${settings.scheduler ? ` (${settings.scheduler})` : ""}` : "",
    /^\d+$/.test(String(settings.seed ?? "")) ? `Seed: ${settings.seed}` : "",
    item.width && item.height ? `Size: ${item.width}×${item.height}` : "",
    settings.denoise && (item.referenceImage || settings.referenceImageName) ? `Denoise: ${settings.denoise}` : ""
  ].filter(Boolean);
  if (parts.length) lines.push(parts.join(" · "));
  const loras = activeLoras(settings.loras);
  if (loras.length) lines.push(`LoRAs: ${loras.map((lora) => `${fileStem(lora.name)} ${Number(lora.strength ?? 0.7).toFixed(2)}`).join(", ")}`);
  return lines.filter(Boolean).join("\n");
}

export type GenerationDetailSection = { title: string; rows: Array<[string, string]> };

/**
 * The "Generation settings" panel, most useful first: what made the picture
 * (model, LoRAs), then how it was sampled, then the size, then file metadata.
 */
export function generationDetailEntries(item: GalleryItem): GenerationDetailSection[] {
  const settings = item.settings || {};
  const sections: GenerationDetailSection[] = [];
  const section = (title: string, build: (add: (label: string, value: unknown) => void) => void) => {
    const rows: Array<[string, string]> = [];
    build((label, value) => {
      if (value === "" || value === undefined || value === null || value === 0 || value === false) return;
      rows.push([label, String(value)]);
    });
    if (rows.length) sections.push({ title, rows });
  };
  const model = settings.modelName || (String(item.model || "").startsWith("custom:") ? "" : item.model);
  section("Model", (add) => {
    add("Model", model ? fileStem(model) : "");
    add("Workflow", settings.workflow);
    activeLoras(settings.loras).forEach((lora) => add("LoRA", `${fileStem(lora.name)} · ${Number(lora.strength ?? 0.7).toFixed(2)}`));
  });
  section("Sampling", (add) => {
    add("Steps", settings.steps);
    add("CFG", settings.cfg);
    add("Sampler", settings.sampler);
    add("Scheduler", settings.scheduler);
    add("Seed", settings.seed);
    if (item.type === "image" && (item.referenceImage || settings.referenceImageName)) add("Denoise", settings.denoise);
  });
  section(item.type === "video" ? "Video" : "Image", (add) => {
    add("Aspect", `${item.width || "?"}x${item.height || "?"}`);
    if (item.type === "image") {
      const count = Number(settings.count || 0);
      if (count > 1) add("Images", count);
      if (item.referenceImage || settings.referenceImageName) add("Reference", settings.referenceImageName || item.referenceImageName || "Selected");
    }
    if (item.type === "video") {
      add("Frames", settings.frames);
      add("FPS", settings.fps);
    }
  });
  section("File", (add) => {
    add("Output", item.outputName || item.filename);
    add("Generated", formatGeneratedAt(item.createdAt));
    add("Time", item.durationMs ? formatElapsed(item.durationMs) : "");
    add("Type", item.type);
  });
  return sections;
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

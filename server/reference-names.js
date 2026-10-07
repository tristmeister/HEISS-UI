import crypto from "node:crypto";

/**
 * The name an image gets in ComfyUI's input folder when a run uses it as a
 * reference (reference-assets.js). It is named by its content, so the same
 * picture is uploaded once, and so hiding a picture later can find the copy
 * an earlier run left there (vault.js).
 */
export function mimeExtension(mime = "") {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

function contentHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32);
}

export function referenceInputName(buffer, mime = "") {
  return `heiss-ui-reference-${contentHash(buffer)}.${mimeExtension(mime)}`;
}

/**
 * A copy resized for a run: named by the original and the size, so the next
 * run at that size uploads the same name and ComfyUI's cache still holds
 * everything made from it (a new name each run made Qwen-Image 2.1 edits
 * encode their prompt again every time). Hiding the original finds its copies
 * by the prefix (resizedInputPrefix).
 */
export function resizedInputName(original, { width, height, mime = "" }) {
  return `${resizedInputPrefix(original)}${Number(width)}x${Number(height)}.${mimeExtension(mime)}`;
}

export function resizedInputPrefix(original) {
  return `heiss-ui-reference-${contentHash(original)}-`;
}

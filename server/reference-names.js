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

export function referenceInputName(buffer, mime = "") {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  return `heiss-ui-reference-${hash}.${mimeExtension(mime)}`;
}

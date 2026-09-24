import fs from "node:fs";
import path from "node:path";
import { comfy, comfyInputDir } from "./comfy.js";

/**
 * ComfyUI keeps its own record of every run: the prompt graph in /history and
 * any image it was handed in its input folder. For a Hidden run both are
 * plaintext copies of something that now only exists encrypted, so they go as
 * soon as the run is done. Best effort: a ComfyUI that is gone or a file that
 * is locked must never fail the run itself.
 */
export async function forgetComfyRun({ promptIds = [], inputNames = [] } = {}) {
  const ids = [...new Set(promptIds.filter(Boolean).map(String))];
  if (ids.length) {
    await comfy("/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delete: ids })
    }).catch(() => null);
  }
  const inputDir = comfyInputDir();
  if (!inputDir) return;
  const base = path.resolve(inputDir);
  for (const name of new Set(inputNames.filter(Boolean).map(String))) {
    const file = path.resolve(base, name);
    if (!file.startsWith(`${base}${path.sep}`)) continue;
    try { fs.unlinkSync(file); } catch { /* already gone, or ComfyUI still holds it */ }
  }
}

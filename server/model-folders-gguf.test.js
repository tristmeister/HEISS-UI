import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// ComfyUI with ComfyUI-GGUF: its unet_gguf kind lists diffusion_models' folders,
// and a models/unet_gguf folder beside them holds GGUF files ComfyUI can't see.
const scratch = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "heiss-gguf-folders-")));
const comfyRoot = path.join(scratch, "ComfyUI");
const models = path.join(comfyRoot, "models");
const mk = (...parts) => { const dir = path.join(...parts); fs.mkdirSync(dir, { recursive: true }); return dir; };
for (const kind of ["checkpoints", "loras", "diffusion_models", "unet", "vae", "text_encoders"]) mk(models, kind);
mk(comfyRoot, "custom_nodes");
fs.writeFileSync(path.join(comfyRoot, "main.py"), "");
mk(models, "unet_gguf");
fs.writeFileSync(path.join(models, "unet_gguf", "wan-high.gguf"), "x");
fs.writeFileSync(path.join(models, "unet_gguf", "wan-low.gguf"), "x");
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const unetDirs = [path.join(models, "unet"), path.join(models, "diffusion_models")];
let extraDiffusion = [];
globalThis.fetch = async (url) => {
  const pathname = new URL(url).pathname;
  const folderPaths = {
    ...Object.fromEntries(["checkpoints", "loras", "vae", "text_encoders"].map((kind) => [kind, [[path.join(models, kind)], [".safetensors"]]])),
    diffusion_models: [[...unetDirs, ...extraDiffusion], [".safetensors"]],
    // What ComfyUI-GGUF does: unet_gguf is diffusion_models' folders, whatever the yaml said.
    unet_gguf: [[...unetDirs, ...extraDiffusion], [".gguf"]],
    custom_nodes: [[path.join(comfyRoot, "custom_nodes")], []]
  };
  const body = pathname === "/internal/folder_paths" ? folderPaths : pathname === "/system_stats" ? { system: { argv: ["main.py"] } } : null;
  return new Response(JSON.stringify(body), { status: body ? 200 : 404, headers: { "content-type": "application/json" } });
};

const { linkModelFolders, migrateDerivedKinds, modelFolderReport } = await import("./model-folders.js");
const scan = { home: scratch, drives: false };
const config = path.join(comfyRoot, "extra_model_paths.yaml");

test("GGUF files in models/unet_gguf are added as diffusion models, which ComfyUI-GGUF inherits", async () => {
  const report = await modelFolderReport({ scan });
  const folder = report.folders.find((item) => item.path === models);
  assert.ok(folder, "ComfyUI's own models folder is reported for its unread unet_gguf subfolder");
  assert.equal(folder.partlyRead, true);
  assert.deepEqual(folder.kinds.map((item) => [item.name, item.kind]), [["unet_gguf", "diffusion_models"]]);
  await linkModelFolders([models], { scan });
  const text = fs.readFileSync(config, "utf8");
  assert.match(text, /^    diffusion_models: 'unet_gguf'$/m);
  assert.doesNotMatch(text, /unet_gguf:/);
  // After the restart ComfyUI reads it, so it is no longer offered.
  extraDiffusion = [path.join(models, "unet_gguf")];
  const after = await modelFolderReport({ scan });
  assert.equal(after.folders.find((item) => item.path === models), undefined);
});

test("a section an older HEISS wrote under unet_gguf is rewritten; other lines are left alone", () => {
  const old = [
    "comfyui:",
    "    unet_gguf: somewhere/else",
    "# >>> Added by HEISS UI: D:\\ComfyUI\\models",
    "heiss_comfyui_models:",
    "    base_path: 'D:\\ComfyUI\\models'",
    "    unet_gguf: 'unet_gguf'",
    "    clip_gguf: 'clip_gguf'",
    "# <<< HEISS UI",
    ""
  ].join("\n");
  const { text, changed } = migrateDerivedKinds(old);
  assert.deepEqual(changed, ["D:\\ComfyUI\\models"]);
  assert.match(text, /^    unet_gguf: somewhere\/else$/m, "not HEISS's section, not touched");
  assert.match(text, /^    diffusion_models: 'unet_gguf'$/m);
  assert.match(text, /^    text_encoders: 'clip_gguf'$/m);
  assert.deepEqual(migrateDerivedKinds(text).changed, []);
});

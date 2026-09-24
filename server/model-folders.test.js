import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// A ComfyUI of our own, a home with a shared models folder in it, and ComfyUI's API answered by hand.
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "heiss-model-folders-")));
const comfyRoot = path.join(scratch, "ComfyUI");
const home = path.join(scratch, "home");
const shared = path.join(home, "AI", "ComfyUI-Shared", "models");
const mk = (...parts) => { const dir = path.join(...parts); fs.mkdirSync(dir, { recursive: true }); return dir; };
const touch = (file) => { mk(path.dirname(file)); fs.writeFileSync(file, "x".repeat(10)); };
for (const kind of ["checkpoints", "loras", "diffusion_models", "vae", "text_encoders"]) mk(comfyRoot, "models", kind);
mk(comfyRoot, "custom_nodes");
fs.writeFileSync(path.join(comfyRoot, "main.py"), "");
touch(path.join(shared, "diffusion_models", "krea2-finetune.safetensors"));
touch(path.join(shared, "unet", "old", "flux.gguf"));
touch(path.join(shared, "loras", "style.safetensors"));
mk(shared, "vae");
// Stability Matrix names its folders its own way.
touch(path.join(home, "StabilityMatrix", "Models", "StableDiffusion", "sdxl.safetensors"));
touch(path.join(home, "StabilityMatrix", "Models", "Lora", "detail.safetensors"));
// Not a models folder: one matching name is not enough.
touch(path.join(home, "Downloads", "loras", "stray.safetensors"));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

let folderPaths = {};
const resetFolderPaths = () => {
  folderPaths = Object.fromEntries(["checkpoints", "loras", "diffusion_models", "vae", "text_encoders", "controlnet", "upscale_models", "embeddings"]
    .map((kind) => [kind, [[path.join(comfyRoot, "models", kind)], [".safetensors"]]]));
  folderPaths.custom_nodes = [[path.join(comfyRoot, "custom_nodes")], []];
};
resetFolderPaths();
globalThis.fetch = async (url) => {
  const pathname = new URL(url).pathname;
  const body = pathname === "/internal/folder_paths" ? folderPaths : pathname === "/system_stats" ? { system: { argv: ["main.py", "--listen", "127.0.0.1"] } } : null;
  return new Response(JSON.stringify(body), { status: body ? 200 : 404, headers: { "content-type": "application/json" } });
};

const { heissSections, linkModelFolders, modelFolderReport, readLayout, sectionFor, unlinkModelFolder } = await import("./model-folders.js");
const scan = { home, drives: false };
const config = path.join(comfyRoot, "extra_model_paths.yaml");

test("a models folder is told by its shape, in ComfyUI's names or another app's", () => {
  const kinds = ["checkpoints", "loras", "diffusion_models", "vae", "text_encoders"];
  assert.equal(readLayout(shared, kinds).layout, "comfy");
  assert.deepEqual(readLayout(shared, kinds).map.find((item) => item.name === "unet"), { name: "unet", kind: "diffusion_models" });
  assert.equal(readLayout(path.join(home, "StabilityMatrix", "Models"), kinds).layout, "stability");
  assert.equal(readLayout(path.join(home, "Downloads"), kinds), null);
});

test("the report lists folders with models ComfyUI does not read, and only those", async () => {
  const report = await modelFolderReport({ scan });
  assert.equal(report.configPath, config);
  assert.deepEqual(report.folders.map((folder) => [folder.name, folder.count]).sort(), [["ComfyUI-Shared", 3], ["Stability Matrix", 2]]);
  const sharedFolder = report.folders.find((folder) => folder.name === "ComfyUI-Shared");
  assert.deepEqual(sharedFolder.kinds.map((item) => item.kind).sort(), ["diffusion_models", "diffusion_models", "loras"], "empty vae folder left out");
});

test("adding writes a marked, backed-up section ComfyUI can read, and removing takes exactly that out", async () => {
  fs.writeFileSync(config, "# mine\nother:\n    base_path: /elsewhere\n    loras: loras");
  await modelFolderReport({ scan });
  const result = await linkModelFolders([shared], { scan });
  assert.deepEqual(result.added, [shared]);
  assert.equal(fs.readFileSync(`${config}.heiss-backup`, "utf8").startsWith("# mine"), true);
  const text = fs.readFileSync(config, "utf8");
  assert.match(text, /^other:\n    base_path: \/elsewhere\n    loras: loras\n\n# >>> Added by HEISS UI: /m, "the person's own section stays as it was");
  assert.match(text, /    diffusion_models: \|\n        diffusion_models\n        unet\n/);
  assert.equal(heissSections(text).length, 1);

  // Once ComfyUI reads it, the folder is no longer reported, and shows as read.
  folderPaths.diffusion_models[0].push(path.join(shared, "diffusion_models"), path.join(shared, "unet"));
  folderPaths.loras[0].push(path.join(shared, "loras"));
  const after = await modelFolderReport({ scan });
  assert.equal(after.folders.some((folder) => folder.path === shared), false);
  assert.deepEqual(after.linked, [{ path: shared, label: shared, read: true }]);

  await unlinkModelFolder(shared);
  assert.equal(fs.readFileSync(config, "utf8").trim(), "# mine\nother:\n    base_path: /elsewhere\n    loras: loras");
  resetFolderPaths();
});

test("only folders the scan found, or a picked models folder, can be added", async () => {
  await modelFolderReport({ scan });
  await assert.rejects(() => linkModelFolders(["/etc"], { scan }), /Nothing to add/);
  await assert.rejects(() => linkModelFolders([], { picked: path.join(home, "Downloads"), scan }), /does not look like a models folder/);
  fs.rmSync(config, { force: true });
  const picked = await linkModelFolders([], { picked: path.join(home, "StabilityMatrix", "Models"), scan });
  assert.equal(picked.added.length, 1);
  assert.match(fs.readFileSync(config, "utf8"), /checkpoints: 'StableDiffusion'/);
  await unlinkModelFolder(picked.added[0]);
  assert.equal(fs.existsSync(config), false, "a file HEISS made and emptied goes away");
});

test("a section's quoting survives odd folder names", () => {
  const text = sectionFor("/Users/o'neil/models", [{ kind: "loras", name: "my loras" }]);
  assert.match(text, /base_path: '\/Users\/o''neil\/models'/);
  assert.match(text, /loras: 'my loras'/);
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { comfy } from "./comfy.js";

/**
 * Model folders ComfyUI is not reading, and the one-line fix for each.
 *
 * People keep models in a shared folder, in another ComfyUI install, in
 * Stability Matrix or A1111, or on an external drive, and then ComfyUI (so
 * HEISS) simply never lists them. This finds such folders on the machine
 * ComfyUI runs on, says what is in them, and adds them to ComfyUI's
 * extra_model_paths.yaml as a marked section HEISS can take out again.
 *
 * Only folder and file names are read, never file contents.
 */

const modelFile = /\.(safetensors|ckpt|pt|pth|gguf|sft|bin)$/i;
// Kinds that are not models, or not ones a person drops in by hand.
const skipKinds = new Set(["custom_nodes", "configs", "input", "output", "temp"]);
const legacy = { unet: "diffusion_models", clip: "text_encoders" };

// Other apps' model folders, by their own names, mapped to ComfyUI's kinds.
const layouts = {
  stability: {
    label: "Stability Matrix",
    folders: {
      StableDiffusion: "checkpoints", DiffusionModels: "diffusion_models", Unet: "diffusion_models", Lora: "loras", LyCORIS: "loras",
      VAE: "vae", TextEncoders: "text_encoders", CLIP: "text_encoders", ClipVision: "clip_vision", ControlNet: "controlnet",
      ESRGAN: "upscale_models", RealESRGAN: "upscale_models", SwinIR: "upscale_models", TextualInversion: "embeddings",
      Embeddings: "embeddings", Hypernetwork: "hypernetworks", GLIGEN: "gligen", ApproxVAE: "vae_approx"
    }
  },
  a1111: {
    label: "Stable Diffusion WebUI",
    folders: { "Stable-diffusion": "checkpoints", Lora: "loras", LyCORIS: "loras", VAE: "vae", ESRGAN: "upscale_models", RealESRGAN: "upscale_models", ControlNet: "controlnet", hypernetworks: "hypernetworks", "VAE-approx": "vae_approx" }
  }
};

/* ------------------------------------------------------------ helpers */

function realpath(dir) {
  try { return fs.realpathSync(dir); } catch { return path.resolve(dir); }
}

function isDir(dir) {
  try { return fs.statSync(dir).isDirectory(); } catch { return false; }
}

function subdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .filter((name) => isDir(path.join(dir, name)));
  } catch {
    return [];
  }
}

/** Model files in a folder and three levels below it (people sort into subfolders). */
function modelFiles(dir, limit = 400) {
  const found = [];
  let bytes = 0;
  const visit = (folder, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (found.length >= limit || entry.name.startsWith(".")) continue;
      const full = path.join(folder, entry.name);
      if (entry.isFile() && modelFile.test(entry.name) && !entry.name.endsWith(".part")) {
        found.push(path.relative(dir, full));
        try { bytes += fs.statSync(full).size; } catch { /* gone meanwhile */ }
      } else if (entry.isDirectory() && depth < 3) {
        visit(full, depth + 1);
      }
    }
  };
  visit(dir, 0);
  return { files: found, bytes };
}

export function tildePath(dir, home = os.homedir()) {
  return dir === home || dir.startsWith(home + path.sep) ? `~${dir.slice(home.length)}` : dir;
}

/* ------------------------------------------------------------ ComfyUI */

function flatten(value) {
  // Older ComfyUI answers [paths, extensions] per kind; newer ones just the paths.
  const list = Array.isArray(value?.[0]) ? value[0] : value;
  return Array.isArray(list) ? list.filter((item) => typeof item === "string") : [];
}

function argValues(argv, flag) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === flag && argv[index + 1]) values.push(String(argv[index + 1]));
    else if (arg.startsWith(`${flag}=`)) values.push(arg.slice(flag.length + 1));
  }
  return values;
}

/**
 * Where ComfyUI reads models from and which config file it would read a new
 * folder from: a file it was started with (the Desktop app does this), else
 * extra_model_paths.yaml in its own folder, which ComfyUI always loads.
 */
export async function comfyModelSetup() {
  const [folders, stats] = await Promise.all([
    comfy("/internal/folder_paths").catch(() => null),
    comfy("/system_stats").catch(() => null)
  ]);
  if (!folders) return null;
  const kinds = {};
  for (const [kind, value] of Object.entries(folders)) {
    if (!skipKinds.has(kind)) kinds[kind] = flatten(value).map(realpath);
  }
  const nodesDirs = flatten(folders.custom_nodes);
  const argv = Array.isArray(stats?.system?.argv) ? stats.system.argv : [];
  // ComfyUI's own folder: the one whose custom_nodes it loads and that holds main.py.
  const root = nodesDirs.map((dir) => path.dirname(dir)).find((dir) => fs.existsSync(path.join(dir, "main.py"))) || "";
  const baseDir = argValues(argv, "--base-directory")[0] || "";
  const configs = argValues(argv, "--extra-model-paths-config").map((file) => path.resolve(root || baseDir || ".", file));
  const rootConfig = root ? path.join(root, "extra_model_paths.yaml") : "";
  // Prefer a file ComfyUI was pointed at (the Desktop app's own), then its folder's, if we may write there.
  const configPath = [...configs, rootConfig].find((file) => file && canWrite(file)) || configs[0] || rootConfig;
  return { kinds, root, configPath, reachable: Boolean(root || configs.length) };
}

function canWrite(file) {
  try {
    if (fs.existsSync(file)) { fs.accessSync(file, fs.constants.W_OK); return true; }
    fs.accessSync(path.dirname(file), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ finding folders */

/**
 * How a folder maps onto ComfyUI's kinds, or null when it is not a models
 * folder: ComfyUI's own names (models/checkpoints, models/loras, ...), or
 * Stability Matrix's or A1111's.
 */
export function readLayout(dir, knownKinds) {
  const names = subdirs(dir);
  if (!names.length) return null;
  const valid = new Set(knownKinds);
  const comfyKinds = names
    .map((name) => ({ name, kind: legacy[name] || name }))
    .filter(({ kind }) => valid.has(kind));
  // Two of ComfyUI's model folder names, one of them a core one, is a models folder.
  const core = comfyKinds.some(({ kind }) => ["checkpoints", "diffusion_models", "loras", "vae", "text_encoders"].includes(kind));
  if (comfyKinds.length >= 2 && core) return { layout: "comfy", label: "", map: comfyKinds.map(({ name, kind }) => ({ name, kind })) };
  for (const [id, spec] of Object.entries(layouts)) {
    const map = names.filter((name) => spec.folders[name] && valid.has(spec.folders[name])).map((name) => ({ name, kind: spec.folders[name] }));
    if (map.length >= 2) return { layout: id, label: spec.label, map };
  }
  return null;
}

const skipNames = /^(Library|Applications|System|node_modules|Pictures|Music|Movies|Photos Library\.photoslibrary|AppData|\$Recycle\.Bin|Windows|Program Files.*|ProgramData|proc|sys|dev|snap|venv|\.venv|site-packages|__pycache__)$/i;

/** Folders worth a look: shared spots other apps use, then a shallow walk of home and the other drives. */
function candidateRoots(home, drivesToo = true) {
  const explicit = [];
  const add = (dir, source) => { if (dir) explicit.push({ dir, source }); };
  if (process.platform === "darwin") {
    const support = path.join(home, "Library", "Application Support");
    add(path.join(support, "StabilityMatrix", "Models"), "stability");
    add(path.join(support, "StabilityMatrix", "Data", "Models"), "stability");
    try {
      // The ComfyUI Desktop app keeps its models under a base_path of its own choosing.
      const text = fs.readFileSync(path.join(support, "ComfyUI", "extra_models_config.yaml"), "utf8");
      for (const match of text.matchAll(/^\s*base_path:\s*['"]?([^'"\n]+?)['"]?\s*$/gm)) add(path.join(match[1], "models"), "desktop");
    } catch { /* no Desktop app */ }
  } else if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    add(path.join(appData, "StabilityMatrix", "Models"), "stability");
    try {
      const text = fs.readFileSync(path.join(appData, "ComfyUI", "extra_models_config.yaml"), "utf8");
      for (const match of text.matchAll(/^\s*base_path:\s*['"]?([^'"\n]+?)['"]?\s*$/gm)) add(path.join(match[1], "models"), "desktop");
    } catch { /* no Desktop app */ }
  } else {
    add(path.join(home, ".config", "StabilityMatrix", "Models"), "stability");
  }
  const walkRoots = [{ dir: home, depth: 4, source: "home" }];
  const drives = !drivesToo ? "" : process.platform === "darwin" ? "/Volumes" : process.platform === "linux" ? path.join("/media", os.userInfo().username) : "";
  if (drives) {
    for (const name of subdirs(drives)) {
      const dir = path.join(drives, name);
      if (realpath(dir) !== "/") walkRoots.push({ dir, depth: 3, source: "drive" });
    }
  }
  if (process.platform === "win32" && drivesToo) {
    for (const letter of "DEFGHIJKLMNOPQRSTUVWXYZ") {
      const dir = `${letter}:\\`;
      if (isDir(dir)) walkRoots.push({ dir, depth: 3, source: "drive" });
    }
    walkRoots.push({ dir: "C:\\", depth: 2, source: "drive" });
  }
  return { explicit, walkRoots };
}

/**
 * Every models folder on this machine, found by shape: ComfyUI installs,
 * shared folders, other apps. Bounded so a huge disk cannot stall setup.
 */
export function findModelFolders(knownKinds, { home = os.homedir(), drives = true, budget = 6000, deadline = Date.now() + 4000 } = {}) {
  const { explicit, walkRoots } = candidateRoots(home, drives);
  const found = new Map();
  const consider = (dir, source) => {
    const real = realpath(dir);
    if (found.has(real)) return true;
    const layout = readLayout(dir, knownKinds);
    if (!layout) return false;
    found.set(real, { dir: real, source, ...layout });
    return true;
  };
  for (const { dir, source } of explicit) if (isDir(dir)) consider(dir, source);
  let visited = 0;
  for (const { dir: start, depth: maxDepth, source } of walkRoots) {
    const queue = [{ dir: start, depth: 0 }];
    while (queue.length && visited < budget && Date.now() < deadline) {
      const { dir, depth } = queue.shift();
      visited += 1;
      // A models folder is a leaf here: its own subfolders are its kinds.
      if (depth > 0 && consider(dir, source)) continue;
      if (depth >= maxDepth) continue;
      for (const name of subdirs(dir)) {
        if (skipNames.test(name)) continue;
        queue.push({ dir: path.join(dir, name), depth: depth + 1 });
      }
    }
  }
  return [...found.values()];
}

/* ------------------------------------------------------------ the config file */

const startMark = "# >>> Added by HEISS UI:";
const endMark = "# <<< HEISS UI";

/** Sections HEISS added before, by the folder they point at. */
export function heissSections(text = "") {
  const sections = [];
  const pattern = /^# >>> Added by HEISS UI: (.+)\n([\s\S]*?)^# <<< HEISS UI\s*$/gm;
  for (const match of text.matchAll(pattern)) sections.push({ path: match[1].trim(), block: match[0] });
  return sections;
}

function yamlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** The extra_model_paths.yaml section for one folder: its kinds, several folders per kind on their own lines. */
export function sectionFor(dir, kinds, existingText = "") {
  const byKind = new Map();
  for (const { kind, name } of kinds) byKind.set(kind, [...(byKind.get(kind) || []), name]);
  const slug = path.basename(path.dirname(dir)) + "_" + path.basename(dir);
  let key = `heiss_${slug.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "models"}`;
  for (let n = 2; new RegExp(`^${key}:`, "m").test(existingText); n += 1) key = `${key.replace(/_\d+$/, "")}_${n}`;
  const lines = [`${startMark} ${dir}`, `${key}:`, `    base_path: ${yamlString(dir)}`];
  for (const [kind, names] of byKind) {
    if (names.length === 1) lines.push(`    ${kind}: ${yamlString(names[0])}`);
    else lines.push(`    ${kind}: |`, ...names.map((name) => `        ${name}`));
  }
  lines.push(endMark);
  return lines.join("\n") + "\n";
}

/* ------------------------------------------------------------ report */

let lastReport = null;

/**
 * What a setup panel needs: every models folder with files ComfyUI is not
 * reading, what they hold, and the folders HEISS already added.
 */
export async function modelFolderReport({ local = true, scan = {} } = {}) {
  const setup = await comfyModelSetup();
  if (!setup) return { ok: false, offline: true, folders: [], linked: [] };
  if (!local || !setup.reachable) {
    return { ok: true, local: false, folders: [], linked: [], configPath: setup.configPath };
  }
  const knownKinds = Object.keys(setup.kinds);
  const read = new Set(Object.values(setup.kinds).flat());
  let configText = "";
  try { configText = fs.readFileSync(setup.configPath, "utf8"); } catch { /* not made yet */ }
  // `read`: ComfyUI has picked the folder up, which only happens once it restarted after HEISS added it.
  const readDirs = [...read];
  const linked = heissSections(configText).map((section) => {
    const base = realpath(section.path);
    return { path: section.path, label: tildePath(section.path), read: readDirs.some((dir) => dir === base || dir.startsWith(base + path.sep)) };
  });
  const folders = [];
  for (const folder of findModelFolders(knownKinds, scan)) {
    const kinds = [];
    for (const { name, kind } of folder.map) {
      const dir = realpath(path.join(folder.dir, name));
      if (read.has(dir)) continue;
      const { files, bytes } = modelFiles(dir);
      if (!files.length) continue;
      kinds.push({ kind, name, dir, count: files.length, bytes, examples: files.slice(0, 3).map((file) => path.basename(file)) });
    }
    if (!kinds.length) continue;
    const parent = path.basename(path.dirname(folder.dir));
    folders.push({
      path: folder.dir,
      label: tildePath(folder.dir),
      // "ComfyUI-Shared", or the app it belongs to.
      name: folder.label || (path.basename(folder.dir).toLowerCase() === "models" ? parent : path.basename(folder.dir)),
      layout: folder.layout,
      app: folder.label,
      source: folder.source,
      kinds,
      count: kinds.reduce((sum, item) => sum + item.count, 0),
      bytes: kinds.reduce((sum, item) => sum + item.bytes, 0)
    });
  }
  folders.sort((a, b) => b.count - a.count);
  lastReport = { ok: true, local: true, root: setup.root, configPath: setup.configPath, configLabel: tildePath(setup.configPath), writable: canWrite(setup.configPath), folders, linked, scannedAt: Date.now() };
  return lastReport;
}

/**
 * Adds folders to ComfyUI's model paths. Only folders the last scan found (or
 * one the person picked and that reads as a models folder) are accepted, and
 * only the kinds ComfyUI does not read yet. The file is backed up first.
 */
export async function linkModelFolders(paths = [], { picked = "", scan = {} } = {}) {
  const report = lastReport?.ok ? lastReport : await modelFolderReport({ scan });
  if (!report.local) throw new Error("ComfyUI runs on another computer, so HEISS cannot change its settings.");
  const chosen = [];
  for (const wanted of paths.map(String)) {
    const folder = report.folders.find((item) => item.path === wanted);
    if (folder) chosen.push(folder);
  }
  if (picked) {
    const setup = await comfyModelSetup();
    const dir = realpath(picked);
    const layout = readLayout(dir, Object.keys(setup?.kinds || {}));
    if (!layout) throw new Error("That folder does not look like a models folder. Pick the one that holds checkpoints, loras or diffusion_models.");
    chosen.push({ path: dir, kinds: layout.map.map(({ name, kind }) => ({ name, kind })) });
  }
  if (!chosen.length) throw new Error("Nothing to add. Scan again and pick a folder.");
  // An added folder is written under its real path, which is also how it is reported back.
  const file = report.configPath;
  if (!file) throw new Error("HEISS could not find where ComfyUI keeps its settings.");
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { /* a new file */ }
  const already = new Set(heissSections(text).map((section) => section.path));
  let backup = "";
  if (text) {
    backup = `${file}.heiss-backup`;
    fs.copyFileSync(file, backup);
  }
  let next = text && !text.endsWith("\n") ? `${text}\n` : text;
  const added = [];
  for (const folder of chosen) {
    if (already.has(folder.path)) continue;
    next += `${next ? "\n" : ""}${sectionFor(folder.path, folder.kinds, next)}`;
    added.push(folder.path);
  }
  if (!added.length) return { ok: true, added, configPath: file, backup };
  try {
    fs.writeFileSync(file, next);
  } catch (error) {
    throw new Error(`HEISS could not write ${tildePath(file)} (${error.code || error.message}).`);
  }
  lastReport = null;
  return { ok: true, added, configPath: file, backup };
}

/** Takes a folder HEISS added back out of ComfyUI's model paths. */
export async function unlinkModelFolder(dir) {
  const setup = await comfyModelSetup();
  if (!setup?.configPath) throw new Error("ComfyUI is not reachable.");
  const text = fs.readFileSync(setup.configPath, "utf8");
  const section = heissSections(text).find((item) => item.path === String(dir));
  if (!section) throw new Error("HEISS did not add that folder, so it leaves it alone.");
  let next = text.replace(section.block, "").replace(/\n{3,}/g, "\n\n");
  // ComfyUI's loader walks the file as a mapping and fails on one that is only
  // comments, so a file with nothing left in it goes, and a comments-only one gets `{}`.
  if (!next.trim()) fs.rmSync(setup.configPath);
  else fs.writeFileSync(setup.configPath, /^[^#\s]/m.test(next) ? next : `${next.trimEnd()}\n{}\n`);
  lastReport = null;
  return { ok: true, removed: section.path };
}


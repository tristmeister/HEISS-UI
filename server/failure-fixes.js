import { families } from './family-catalog.js';
import { catalogDownloadsForFile } from './family-profiles.js';
import { packInstallPlan } from './node-install.js';
import { nodePack, nodePacks } from './node-packs.js';
import { packInstallRoutes } from './pack-installer.js';

/**
 * What the viewer can offer as a button for a failure describeFailure
 * classified: the node pack that has a missing node, the catalog download that
 * replaces a damaged file, and whether a retry may decode in tiles. Only what
 * HEISS can actually do is attached; everything else stays a hint.
 */

// Which models folder a loader reads, so a damaged file is looked up where it lives.
const loaderFolders = [
  [/^VAELoader/i, "vae"],
  [/^(CLIPLoader|DualCLIPLoader|TripleCLIPLoader|QuadrupleCLIPLoader)/i, "text_encoders"],
  [/^(UNETLoader|UnetLoaderGGUF)/i, "diffusion_models"],
  [/^(CheckpointLoader|ImageOnlyCheckpointLoader)/i, "checkpoints"]
];

/** The known pack that brings a node class, or null. */
export function packForNode(classType = "") {
  const id = Object.keys(nodePacks).find((key) => nodePacks[key].nodes.includes(classType));
  return id ? nodePack(id) : null;
}

/** The catalog download for a damaged file a loader could not read, or null when HEISS cannot fetch it. */
export function redownloadFor(file = "", nodeType = "") {
  if (!file) return null;
  const folder = loaderFolders.find(([test]) => test.test(nodeType))?.[1];
  const folders = folder ? [folder] : ["vae", "text_encoders", "diffusion_models", "checkpoints"];
  for (const each of folders) {
    const [download] = catalogDownloadsForFile(file, each);
    if (download) {
      const { id, file: name, folder: where, label, bytes } = download;
      return { id, file: name, folder: where, label, ...(bytes ? { bytes } : {}) };
    }
  }
  return null;
}

/** Whether a built-in family's graph can swap its decode for a tiled one (the Sana packs decode themselves). */
export function canDecodeTiled(body = {}) {
  const family = families[body.family];
  return Boolean(family && family.sampling !== "sana" && String(body.workflow || "").startsWith("family:"));
}

/** The failure with the fixes HEISS can offer for it. */
export function withFixes(failure, body = {}) {
  if (!failure) return failure;
  const next = { ...failure };
  if (failure.fix === "node" && failure.missingNode) {
    const pack = packForNode(failure.missingNode);
    if (pack) {
      next.nodePack = { id: pack.id, name: pack.name, repository: pack.repository, folder: pack.folder, search: pack.search || "", note: pack.note || "" };
      next.install = packInstallPlan(pack);
      next.autoInstall = packInstallRoutes(pack.id);
    }
  }
  if (failure.fix === "redownload") {
    const download = redownloadFor(failure.file, failure.nodeType);
    if (download) next.redownload = download;
  }
  if (failure.fix === "memory") {
    next.retry = { smaller: true, ...(canDecodeTiled(body) && /VAEDecode/i.test(failure.nodeType || "") ? { tiledDecode: true } : {}) };
  }
  return next;
}

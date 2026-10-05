/**
 * Which node pack provides the nodes an imported workflow is missing.
 *
 * In order of certainty:
 *   1. The workflow says so. Recent ComfyUI stamps every node with the pack it
 *      came from: `cnr_id` + `ver` (a Comfy registry pack and its version) or
 *      `aux_id` (a GitHub repo, with a commit in `ver`).
 *   2. ComfyUI-Manager's public node map (extension-node-map.json): about
 *      5,700 packs and 44,000 node names. Some names are claimed by several
 *      packs; the pack covering the most of this workflow's missing nodes wins,
 *      then one that is in the registry.
 *
 * A pack counts as "registry" when the workflow stamped its cnr_id, or when
 * Manager's list gives it an id (Manager lists registry packs by their
 * registry id). Registry packs install without asking; anything else asks.
 * The map is downloaded once a day and kept, so it also works offline.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./gallery-store.js";
import { flattenVisual } from "./workflow-convert.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";

const mapUrl = "https://raw.githubusercontent.com/Comfy-Org/ComfyUI-Manager/main/extension-node-map.json";
const listUrl = "https://raw.githubusercontent.com/Comfy-Org/ComfyUI-Manager/main/custom-node-list.json";
const statsUrl = "https://raw.githubusercontent.com/Comfy-Org/ComfyUI-Manager/main/github-stats.json";
const cachePath = () => path.join(dataDir, "node-pack-map.json");
const refreshMs = 24 * 60 * 60 * 1000;

let memory = null;
let loading = null;

/** The node map and Manager's pack list, reduced to what resolution needs: { at, packs: { repo: { title, id, nodes, pattern } } }. */
export function reduceNodeMap(map = {}, list = {}, stats = {}) {
  const stars = new Map(Object.entries(stats || {}).map(([url, value]) => [url.replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase(), Number(value?.stars || 0)]));
  const ids = new Map();
  for (const entry of list?.custom_nodes || []) {
    const repo = String(entry?.reference || entry?.files?.[0] || "").replace(/\.git$/, "").replace(/\/+$/, "");
    if (repo && entry?.id) ids.set(repo.toLowerCase(), String(entry.id));
  }
  const packs = {};
  for (const [url, value] of Object.entries(map || {})) {
    if (!Array.isArray(value) || !Array.isArray(value[0])) continue;
    const repo = url.replace(/\.git$/, "").replace(/\/+$/, "");
    const meta = value[1] || {};
    packs[repo] = {
      title: String(meta.title_aux || meta.title || repo.split("/").pop()),
      id: ids.get(repo.toLowerCase()) || "",
      nodes: value[0].map(String),
      stars: stars.get(repo.toLowerCase()) || 0,
      ...(meta.nodename_pattern ? { pattern: String(meta.nodename_pattern) } : {})
    };
  }
  return { at: Date.now(), packs };
}

async function download() {
  const optional = (url) => fetch(url, { signal: AbortSignal.timeout(30_000) }).then((response) => response.ok ? response.json() : {}).catch(() => ({}));
  const [map, list, stats] = await Promise.all([
    fetch(mapUrl, { signal: AbortSignal.timeout(30_000) }).then((response) => { if (!response.ok) throw new Error(`node map ${response.status}`); return response.json(); }),
    optional(listUrl),
    optional(statsUrl)
  ]);
  const reduced = reduceNodeMap(map, list, stats);
  if (Object.keys(reduced.packs).length < 100) throw new Error("The node map came back nearly empty.");
  fs.mkdirSync(dataDir, { recursive: true });
  writeJsonFile(cachePath(), reduced);
  return reduced;
}

/** The node map: from memory, else the saved copy, refreshed in the background once it is a day old. */
export async function nodePackMap({ fresh = false } = {}) {
  if (!memory) {
    try {
      const saved = readJsonFile(cachePath());
      if (saved?.packs) memory = saved;
    } catch {
      // No copy yet.
    }
  }
  const stale = !memory || Date.now() - Number(memory.at || 0) > refreshMs;
  if (stale || fresh) {
    loading ||= download().then((value) => { memory = value; return value; }).finally(() => { loading = null; });
    // With a copy in hand, a refresh never holds up an import.
    if (!memory) {
      try {
        await loading;
      } catch {
        return { at: 0, packs: {} };
      }
    } else loading.catch(() => {});
  }
  return memory || { at: 0, packs: {} };
}

export function setNodePackMapForTests(value) {
  memory = value;
}

/** The pack stamps in a canvas workflow, by node type: { type: { cnrId, version, auxId } }. */
export function packStamps(visual) {
  const stamps = {};
  if (!visual) return stamps;
  let nodes = [];
  try {
    nodes = flattenVisual(visual).nodes;
  } catch {
    nodes = visual.nodes || [];
  }
  for (const node of nodes) {
    const props = node?.properties || {};
    const cnrId = typeof props.cnr_id === "string" ? props.cnr_id : "";
    const auxId = typeof props.aux_id === "string" ? props.aux_id : "";
    if (!node?.type || (!cnrId && !auxId) || cnrId === "comfy-core") continue;
    stamps[node.type] ||= { cnrId, auxId, version: typeof props.ver === "string" ? props.ver : "" };
  }
  return stamps;
}

function repoFolder(repo = "") {
  return repo.split("/").pop().replace(/\.git$/, "") || "custom-pack";
}

/**
 * The packs to install for these missing node types, and the types nothing
 * provides. Each pack: { key, name, repository, managerId, version, commit,
 * registry, nodes, source }.
 */
export function resolveMissingNodes(missing = [], { stamps = {}, map = { packs: {} } } = {}) {
  const wanted = [...new Set(missing.filter(Boolean))];
  const packs = new Map();
  const left = [];
  const repos = Object.entries(map.packs || {});
  // The workflow's own stamps first: exact pack, exact version.
  for (const type of wanted) {
    const stamp = stamps[type];
    if (stamp?.cnrId) {
      const key = `cnr:${stamp.cnrId}`;
      const known = repos.find(([, pack]) => pack.id === stamp.cnrId);
      const pack = packs.get(key) || { key, name: known?.[1].title || stamp.cnrId, repository: known?.[0] || "", managerId: stamp.cnrId, version: stamp.version || "latest", commit: "", registry: true, nodes: [], source: "stamp" };
      pack.nodes.push(type);
      packs.set(key, pack);
    } else if (stamp?.auxId && /^[\w.-]+\/[\w.-]+$/.test(stamp.auxId)) {
      const repository = `https://github.com/${stamp.auxId}`;
      const key = `repo:${repository.toLowerCase()}`;
      const known = repos.find(([repo]) => repo.toLowerCase() === repository.toLowerCase());
      const pack = packs.get(key) || { key, name: known?.[1].title || stamp.auxId.split("/").pop(), repository, managerId: known?.[1].id || "", version: "", commit: /^[0-9a-f]{40}$/i.test(stamp.version) ? stamp.version : "", registry: Boolean(known?.[1].id), nodes: [], source: "stamp" };
      pack.nodes.push(type);
      packs.set(key, pack);
    } else {
      left.push(type);
    }
  }
  // Then the node map: greedy cover, so one pack that provides five missing nodes beats five that provide one.
  const candidates = new Map();
  for (const type of left) {
    const providers = repos.filter(([, pack]) => pack.nodes.includes(type) || (pack.pattern && safeTest(pack.pattern, type)));
    candidates.set(type, providers);
  }
  let remaining = left.filter((type) => candidates.get(type)?.length);
  const unresolved = left.filter((type) => !candidates.get(type)?.length);
  while (remaining.length) {
    const tally = new Map();
    for (const type of remaining) {
      for (const [repo, pack] of candidates.get(type)) {
        const entry = tally.get(repo) || { repo, pack, covers: [] };
        entry.covers.push(type);
        tally.set(repo, entry);
      }
    }
    // Most of this workflow's nodes first. Then the original over forks and copies: a pack with
    // far more stars wins outright, otherwise one in the registry, then the most starred.
    const byOriginal = (a, b) => {
      const starsA = a.pack.stars || 0;
      const starsB = b.pack.stars || 0;
      if (Math.max(starsA, starsB) > 5 * (Math.min(starsA, starsB) + 1)) return starsB - starsA;
      return Number(Boolean(b.pack.id)) - Number(Boolean(a.pack.id)) || starsB - starsA || a.pack.nodes.length - b.pack.nodes.length;
    };
    const best = [...tally.values()].sort((a, b) => b.covers.length - a.covers.length || byOriginal(a, b))[0];
    const key = best.pack.id ? `cnr:${best.pack.id}` : `repo:${best.repo.toLowerCase()}`;
    const pack = packs.get(key) || { key, name: best.pack.title, repository: best.repo, managerId: best.pack.id, version: best.pack.id ? "latest" : "", commit: "", registry: Boolean(best.pack.id), nodes: [], source: "map" };
    pack.nodes.push(...best.covers);
    pack.folder = repoFolder(best.repo);
    packs.set(key, pack);
    remaining = remaining.filter((type) => !best.covers.includes(type));
  }
  for (const pack of packs.values()) pack.folder ||= repoFolder(pack.repository || pack.managerId);
  return { packs: [...packs.values()], unresolved };
}

function safeTest(pattern, value) {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

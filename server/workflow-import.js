/**
 * The import pipeline, from wherever a workflow comes from to a preview the
 * import screen shows:
 *
 *   source → runnable graph → what a person changes → what it still needs
 *
 * Getting a runnable graph, best first:
 *   1. The prompt ComfyUI already ran (history, image metadata): no conversion.
 *   2. ComfyUI's own converter in a headless page, when Playwright is here.
 *   3. HEISS's converter (workflow-convert.js).
 */
import { previewWorkflowImport } from "./workflow-catalog.js";
import { convertVisualWorkflow, visualTitles } from "./workflow-convert.js";
import { importFromHistory, unwrapWorkflow, workflowFromMedia } from "./workflow-sources.js";
import { nodePackMap, packStamps, resolveMissingNodes } from "./workflow-packs.js";

/** The prompt without keys ComfyUI's validator doesn't expect. */
function cleanPrompt(api) {
  const graph = {};
  for (const [id, node] of Object.entries(api || {})) {
    if (!node?.class_type) continue;
    graph[String(id)] = { class_type: node.class_type, inputs: { ...(node.inputs || {}) }, ...(node._meta?.title ? { _meta: { title: String(node._meta.title) } } : {}) };
  }
  return graph;
}

/**
 * A graph for { visual, api }: the stored prompt when there is one, else a
 * conversion. Returns { graph, conversion, warnings }.
 */
export async function runnableGraph({ visual, api }, { info = {}, pageConvert = null } = {}) {
  if (api) return { graph: cleanPrompt(api), conversion: "stored", warnings: [] };
  if (!visual) throw new Error("This isn’t a ComfyUI workflow. Use one saved from ComfyUI, an image ComfyUI made, or pick a recent run.");
  if (pageConvert) {
    const output = await pageConvert(visual).catch(() => null);
    if (output) return { graph: cleanPrompt(output), conversion: "comfy-page", warnings: [] };
  }
  try {
    const { graph, warnings } = convertVisualWorkflow(visual, info);
    return { graph, conversion: "heiss", warnings };
  } catch (error) {
    throw new Error(`HEISS couldn’t read this workflow (${error.message}). Run it once in ComfyUI, then pick it from Recent.`);
  }
}

/**
 * Reads a request into { visual, api, name, thumbnail, variants, source }.
 * `request`: { source: "file" | "history" | "saved" | "media", workflow,
 * filename, promptId, path, media (base64), name }.
 * `fetchers`: { history(), saved(path) }, so tests can stand in for ComfyUI.
 */
export async function readImportSource(request = {}, fetchers = {}) {
  const source = request.source || (request.media ? "media" : "file");
  if (source === "history") {
    const history = await fetchers.history();
    return { ...importFromHistory(history, String(request.promptId || "")), source };
  }
  if (source === "saved") {
    const raw = await fetchers.saved(String(request.path || ""));
    const found = unwrapWorkflow(raw);
    return { ...found, name: String(request.path || "").split("/").pop().replace(/\.json$/i, ""), source, variants: [] };
  }
  if (source === "media") {
    const buffer = Buffer.from(String(request.media || "").replace(/^data:[^,]*,/, ""), "base64");
    const found = workflowFromMedia(buffer);
    if (!found.visual && !found.api) throw new Error("This file has no ComfyUI workflow in it. Images ComfyUI saves carry one; screenshots and edited copies don’t.");
    return { ...found, name: String(request.filename || "").replace(/\.[^.]+$/, ""), source, variants: [] };
  }
  const found = unwrapWorkflow(request.workflow);
  return { ...found, raw: request.workflow, name: String(request.filename || "").replace(/\.json$/i, ""), source: "file", variants: [] };
}

/** The packs that provide the node types this workflow is missing, and the ones nothing provides. */
export async function packPlan(missingNodes = [], visual = null, { map = null } = {}) {
  if (!missingNodes.length) return { packs: [], unresolved: [] };
  const packMap = map || await nodePackMap().catch(() => ({ packs: {} }));
  return resolveMissingNodes(missingNodes, { stamps: packStamps(visual), map: packMap });
}

/** The whole preview for one import. */
export async function prepareImport(request, { info = {}, fetchers = {}, pageConvert = null, map = null } = {}) {
  const read = await readImportSource(request, fetchers);
  const { graph, conversion, warnings } = await runnableGraph(read, { info, pageConvert });
  const titles = read.visual ? visualTitles(read.visual) : {};
  // The file route keeps the original file for its heissUi block; other sources have none.
  const raw = read.raw && typeof read.raw === "object" ? read.raw : { graph };
  const preview = previewWorkflowImport(raw?.graph ? raw : { ...raw, graph }, request.filename || "", info, { graph, titles, variants: read.variants || [], name: read.name });
  const packs = await packPlan(preview.validation.missingNodes || [], read.visual, { map });
  return {
    ...preview,
    source: read.source,
    thumbnail: read.thumbnail || "",
    conversion,
    warnings,
    packs
  };
}

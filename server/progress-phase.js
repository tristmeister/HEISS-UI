/**
 * ComfyUI reports progress for any node that has a progress bar: sampler
 * steps, but also tiles of a tiled VAE encode or an upscale. Only a sampler's
 * count is steps; everything else is named for what it is doing, so 357 tiles
 * never read as 357 steps.
 */

const samplerPattern = /sampler/i;
const notSamplerPattern = /select|scheduler|loader|sigmas/i;

export function isSampler(classType = "") {
  return samplerPattern.test(classType) && !notSamplerPattern.test(classType);
}

const phases = [
  [/LoadImage|ImageLoad/i, "Reading image"],
  [/Loader|^Load/i, "Loading model"],
  [/VAEEncode|InpaintModelConditioning/i, "Encoding image"],
  [/VAEDecode/i, "Decoding"],
  [/TextEncode|CLIPText|Conditioning|Prompt/i, "Reading prompt"],
  [/Upscale/i, "Upscaling"],
  [/Scale|Resize|Crop/i, "Resizing"],
  [/Face|Detailer/i, "Fixing faces"],
  [/Save|Preview/i, "Saving"]
];

/** What a node is doing, in a word or two. */
export function phaseOf(classType = "") {
  if (isSampler(classType)) return "Loading model";
  return phases.find(([test]) => test.test(classType))?.[1] || "Working";
}

/** A node id as ComfyUI reports it, back to the graph node it came from (expanded nodes add suffixes). */
function classOf(graph, node) {
  const id = String(node ?? "");
  if (!id) return "";
  const own = graph?.[id]?.class_type;
  if (own) return own;
  const base = id.split(/[.:]/)[0];
  return graph?.[base]?.class_type || "";
}

/** A phase the graph names for its node itself (Smart upscale's "Upscaling to 2K"), if any. */
function namedPhase(graph, node) {
  const id = String(node ?? "");
  const meta = graph?.[id]?._meta || graph?.[id.split(/[.:]/)[0]]?._meta;
  return typeof meta?.heissPhase === "string" && meta.heissPhase ? meta.heissPhase : "";
}

/**
 * The job's progress after one ComfyUI message, or null when the message
 * changes nothing. `current` is the progress so far.
 */
export function nextProgress(graph, message, current = null) {
  const data = message?.data || {};
  if (message?.type === "execution_start") return { value: 0, max: 0, node: "", phase: "Starting", steps: false };
  if (message?.type === "executing") {
    const node = data.display_node ?? data.node;
    if (node === null || node === undefined) return null;
    const named = namedPhase(graph, node);
    if (named) return { value: 0, max: 0, node: String(node), phase: named, steps: false };
    const classType = classOf(graph, node);
    // A sampler loads its model before the first step; keep a count it already has.
    if (isSampler(classType) && current?.steps && current.node === String(node)) return null;
    return { value: 0, max: 0, node: String(node), phase: classType ? phaseOf(classType) : "Working", steps: false };
  }
  if (message?.type === "progress") {
    const node = String(data.node ?? "");
    const classType = classOf(graph, node);
    const value = Number(data.value || 0);
    const max = Number(data.max || 0);
    const named = namedPhase(graph, node);
    if (named) return { value, max, node, phase: named, steps: false };
    // A node the graph does not know (a custom node's inner graph) keeps the old reading.
    if (!classType || isSampler(classType)) return { value, max, node, phase: "Step", steps: true };
    return { value, max, node, phase: phaseOf(classType), steps: false };
  }
  return null;
}

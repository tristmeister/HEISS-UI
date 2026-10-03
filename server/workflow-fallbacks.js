/**
 * What an imported workflow runs with in place of files it names but this
 * ComfyUI doesn't have, decided at import (workflow-models.js):
 *   fileSwaps       a local file standing in (same file elsewhere, or a
 *                   same-family substitute the person was told about)
 *   skippedLoras    LoRA loader nodes wired around
 *   loraEntriesOff  entries of an rgthree Power Lora Loader switched off
 */

/** Takes a LoRA loader out of the graph: whatever read its outputs reads its model and clip inputs instead. */
export function bypassLoraNode(graph, id) {
  const node = graph[id];
  if (!node) return graph;
  const passthrough = [node.inputs?.model, node.inputs?.clip];
  for (const other of Object.values(graph)) {
    for (const [name, value] of Object.entries(other.inputs || {})) {
      if (Array.isArray(value) && String(value[0]) === id) {
        const source = passthrough[Number(value[1])] || passthrough[0];
        if (Array.isArray(source)) other.inputs[name] = source;
      }
    }
  }
  delete graph[id];
  return graph;
}

/** Applies the import's fallbacks to a graph, in place. */
export function applyFileFallbacks(graph, workflow = {}) {
  for (const swap of workflow.fileSwaps || []) {
    if (graph[swap.node]?.inputs) graph[swap.node].inputs[swap.input] = swap.file;
  }
  for (const entry of workflow.loraEntriesOff || []) {
    const value = graph[entry.node]?.inputs?.[entry.key];
    if (value && typeof value === "object") graph[entry.node].inputs[entry.key] = { ...value, on: false };
  }
  for (const id of workflow.skippedLoras || []) bypassLoraNode(graph, String(id));
  return graph;
}

/** A copy of the workflow's graph as it will run. */
export function effectiveGraph(workflow = {}) {
  const graph = JSON.parse(JSON.stringify(workflow.graph || {}));
  return applyFileFallbacks(graph, workflow);
}

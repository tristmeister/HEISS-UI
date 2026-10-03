/**
 * ComfyUI's visual workflow (the canvas JSON) to the API prompt it runs.
 *
 * ComfyUI's own front end does this in `app.graphToPrompt()`. This is the
 * server-side stand-in for when that is not available: it expands subgraphs,
 * drops muted nodes, wires bypassed nodes through, resolves canvas-only nodes
 * (Reroute, PrimitiveNode, KJNodes Set/Get, notes) and names widget values
 * from ComfyUI's /object_info schema, or from the widget names the canvas saved.
 *
 * Node ids inside a subgraph become "<instance>:<inner>", the same ids
 * ComfyUI's front end gives them, so history from either path lines up.
 */

const MODE_MUTED = 2;
const MODE_BYPASS = 4;
const SUBGRAPH_INPUT = -10;
const SUBGRAPH_OUTPUT = -20;

// Nodes that only organize the canvas: they never reach ComfyUI.
const noteTypes = new Set(["Note", "NoteNode", "MarkdownNote", "Label (rgthree)", "Fast Groups Bypasser (rgthree)", "Fast Groups Muter (rgthree)", "Bookmark (rgthree)"]);
const rerouteTypes = new Set(["Reroute", "Reroute (rgthree)"]);
const controlValues = new Set(["fixed", "increment", "decrement", "randomize"]);
const uploadValues = new Set(["image", "video", "audio", "file"]);

function normalizeLink(link) {
  if (Array.isArray(link)) {
    const [id, from, fromSlot, to, toSlot, type] = link;
    return { id: String(id), from: String(from), fromSlot: Number(fromSlot || 0), to: String(to), toSlot: Number(toSlot || 0), type: type ?? "*" };
  }
  if (link && typeof link === "object") {
    return {
      id: String(link.id),
      from: String(link.origin_id),
      fromSlot: Number(link.origin_slot || 0),
      to: String(link.target_id),
      toSlot: Number(link.target_slot || 0),
      type: link.type ?? "*"
    };
  }
  return null;
}

function copyNode(node, id) {
  return {
    ...node,
    id: String(id),
    inputs: (node.inputs || []).map((input) => ({ ...input })),
    outputs: (node.outputs || []).map((output) => ({ ...output, links: [...(output.links || [])] }))
  };
}

/** The visual root of anything ComfyUI hands out: a bare workflow, or one wrapped in { workflow }. */
export function visualRoot(raw) {
  if (Array.isArray(raw?.nodes)) return raw;
  if (Array.isArray(raw?.workflow?.nodes)) return raw.workflow;
  return null;
}

/**
 * Expands every subgraph instance into its inner nodes, as many levels deep as
 * the file nests them, and returns plain { nodes, links } with links as objects.
 */
export function flattenVisual(raw) {
  const root = visualRoot(raw);
  if (!root) throw new Error("This isn’t a visual ComfyUI workflow.");
  const definitions = new Map();
  for (const subgraph of root.definitions?.subgraphs || []) {
    if (subgraph?.id) definitions.set(String(subgraph.id), subgraph);
  }
  let nodes = (root.nodes || []).map((node) => copyNode(node, node.id));
  const links = new Map();
  for (const link of (root.links || []).map(normalizeLink).filter(Boolean)) links.set(link.id, link);

  for (let pass = 0; pass < 64; pass += 1) {
    const instance = nodes.find((node) => definitions.has(String(node.type)));
    if (!instance) break;
    const definition = definitions.get(String(instance.type));
    const prefix = `${instance.id}:`;
    const innerNodes = (definition.nodes || []).map((node) => copyNode(node, `${prefix}${node.id}`));
    const innerLinks = (definition.links || []).map(normalizeLink).filter(Boolean).map((link) => ({
      ...link,
      id: `${prefix}${link.id}`,
      from: Number(link.from) === SUBGRAPH_INPUT ? String(SUBGRAPH_INPUT) : `${prefix}${link.from}`,
      to: Number(link.to) === SUBGRAPH_OUTPUT ? String(SUBGRAPH_OUTPUT) : `${prefix}${link.to}`
    }));
    // Inner links leave from the subgraph's input slots: connect them to whatever feeds the instance there.
    const feeding = new Map();
    for (const link of links.values()) if (link.to === instance.id) feeding.set(link.toSlot, link);
    const draining = [...links.values()].filter((link) => link.from === instance.id);
    for (const link of [...links.values()]) if (link.to === instance.id || link.from === instance.id) links.delete(link.id);
    for (const link of innerLinks) {
      if (link.from === String(SUBGRAPH_INPUT)) {
        const outer = feeding.get(link.fromSlot);
        if (!outer) continue;
        links.set(link.id, { ...link, from: outer.from, fromSlot: outer.fromSlot });
      } else if (link.to === String(SUBGRAPH_OUTPUT)) {
        for (const outer of draining.filter((item) => item.fromSlot === link.toSlot)) {
          links.set(`${link.id}>${outer.id}`, { ...outer, id: `${link.id}>${outer.id}`, from: link.from, fromSlot: link.fromSlot });
        }
      } else {
        links.set(link.id, link);
      }
    }
    // Promoted widgets: a value set on the instance overrides the inner widget it shows.
    const promoted = Array.isArray(instance.properties?.proxyWidgets) ? instance.properties.proxyWidgets : [];
    const instanceValues = Array.isArray(instance.widgets_values) ? instance.widgets_values : [];
    promoted.forEach((entry, index) => {
      if (!Array.isArray(entry) || index >= instanceValues.length) return;
      const [innerId, widgetName] = entry;
      const target = innerNodes.find((node) => node.id === `${prefix}${innerId}`);
      if (target) (target.promotedValues ||= {})[widgetName] = instanceValues[index];
    });
    // A muted or bypassed instance mutes or bypasses everything inside it.
    if (instance.mode === MODE_MUTED || instance.mode === MODE_BYPASS) for (const node of innerNodes) node.mode = instance.mode;
    nodes = [...nodes.filter((node) => node !== instance), ...innerNodes];
  }
  if (nodes.some((node) => definitions.has(String(node.type)))) throw new Error("This workflow nests its subgraphs too deeply to read.");
  return { nodes, links: [...links.values()] };
}

function schemaFor(info, classType) {
  const input = info?.[classType]?.input;
  if (!input) return null;
  return [...Object.entries(input.required || {}), ...Object.entries(input.optional || {})];
}

function isWidgetSpec(spec) {
  const [type, options] = Array.isArray(spec) ? spec : [];
  if (Array.isArray(type)) return true;
  if (type === "COMBO") return true;
  if (["INT", "FLOAT", "STRING", "BOOLEAN"].includes(type)) return !options?.forceInput;
  return false;
}

function hasControlAfterGenerate(name, spec) {
  const [type, options] = Array.isArray(spec) ? spec : [];
  if (options?.control_after_generate) return true;
  return type === "INT" && /^(noise_)?seed$/i.test(name);
}

function hasUploadWidget(spec) {
  const options = Array.isArray(spec) ? spec[1] : null;
  return Boolean(options?.image_upload || options?.video_upload || options?.audio_upload || options?.upload);
}

/**
 * Widget values in order, as { name: value }. The schema says which inputs are
 * widgets; the canvas adds "control after generate" values after seeds and an
 * upload button value after file pickers, which are skipped.
 */
function namedWidgets(node, info) {
  const values = node.widgets_values;
  const out = {};
  if (values && typeof values === "object" && !Array.isArray(values)) {
    // VideoHelperSuite and some others save widgets by name already.
    for (const [key, value] of Object.entries(values)) if (key !== "videopreview") out[key] = value;
    return out;
  }
  const list = Array.isArray(values) ? values : [];
  const schema = schemaFor(info, node.type);
  if (schema) {
    let cursor = 0;
    for (const [name, spec] of schema) {
      if (!isWidgetSpec(spec)) continue;
      if (cursor >= list.length) break;
      out[name] = list[cursor];
      cursor += 1;
      if (hasControlAfterGenerate(name, spec) && controlValues.has(list[cursor])) cursor += 1;
      if (hasUploadWidget(spec) && uploadValues.has(list[cursor])) cursor += 1;
    }
    return out;
  }
  // No schema (ComfyUI offline, or a node it doesn't have): newer canvases list
  // every widget as an input with `widget.name`, in widget order.
  const names = (node.inputs || []).filter((input) => input?.widget?.name).map((input) => input.widget.name);
  let cursor = 0;
  for (const name of names) {
    if (cursor >= list.length) break;
    out[name] = list[cursor];
    cursor += 1;
    if (/^(noise_)?seed$/i.test(name) && controlValues.has(list[cursor])) cursor += 1;
    if (name === "image" && uploadValues.has(list[cursor])) cursor += 1;
  }
  return out;
}

/**
 * Converts a visual workflow. Returns { graph, warnings }. `info` is ComfyUI's
 * /object_info; without it, widget names come from the canvas when it saved them.
 */
export function convertVisualWorkflow(raw, info = {}) {
  const { nodes, links } = flattenVisual(raw);
  const warnings = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map();
  for (const link of links) incoming.set(`${link.to}#${link.toSlot}`, link);
  // Every link knows the node and slot it enters, which survives subgraph rewiring.
  const linkFor = (node, slot) => incoming.get(`${node.id}#${slot}`) || null;

  // KJNodes Set/Get: a Get node reads whatever feeds the Set node of the same name.
  const setNodes = new Map();
  for (const node of nodes) {
    if (node.type === "SetNode" && node.mode !== MODE_MUTED) {
      const name = Array.isArray(node.widgets_values) ? node.widgets_values[0] : node.title;
      if (name != null) setNodes.set(String(name), node);
    }
  }

  /** Follows canvas-only and bypassed nodes back to the real output feeding a link: [nodeId, slot], a literal { value }, or null. */
  const resolve = (link, wantType, seen = new Set()) => {
    if (!link) return null;
    const node = byId.get(link.from);
    if (!node || seen.has(node.id)) return null;
    seen.add(node.id);
    if (node.mode === MODE_MUTED) return null;
    const type = String(node.type);
    if (rerouteTypes.has(type)) return resolve(linkFor(node, 0), wantType, seen);
    if (type === "PrimitiveNode") {
      const values = Array.isArray(node.widgets_values) ? node.widgets_values : [];
      return { value: values[0] };
    }
    if (type === "GetNode") {
      const name = Array.isArray(node.widgets_values) ? node.widgets_values[0] : node.title;
      const setter = setNodes.get(String(name));
      return setter ? resolve(linkFor(setter, 0), wantType, seen) : null;
    }
    if (type === "SetNode") return resolve(linkFor(node, 0), wantType, seen);
    if (node.mode === MODE_BYPASS) {
      // A bypassed node hands an input of the same type straight through: the
      // same slot when it matches, else the first input of that type.
      const outType = node.outputs?.[link.fromSlot]?.type ?? link.type;
      const inputs = node.inputs || [];
      const matches = (input) => input && (input.type === outType || outType === "*" || input.type === "*");
      const sameSlot = matches(inputs[link.fromSlot]) && linkFor(node, link.fromSlot) ? link.fromSlot : -1;
      const slot = sameSlot >= 0 ? sameSlot : inputs.findIndex((input, index) => matches(input) && linkFor(node, index));
      return slot >= 0 ? resolve(linkFor(node, slot), wantType, seen) : null;
    }
    return [node.id, link.fromSlot];
  };

  const graph = {};
  const skipped = new Set([...noteTypes, ...rerouteTypes, "PrimitiveNode", "SetNode", "GetNode"]);
  for (const node of nodes) {
    const type = String(node.type || "");
    if (!type) throw new Error(`Visual workflow node ${node.id} is missing a type.`);
    if (skipped.has(type) || node.mode === MODE_MUTED || node.mode === MODE_BYPASS) continue;
    if (/^Anything Everywhere/i.test(type)) {
      warnings.push(`${type} sends values without wires, which only ComfyUI’s own page can follow.`);
      continue;
    }
    const inputs = { ...namedWidgets(node, info), ...(node.promotedValues || {}) };
    (node.inputs || []).forEach((input, slot) => {
      const link = linkFor(node, slot);
      if (!link) return;
      const resolved = resolve(link, input.type);
      const name = input.widget?.name || input.name;
      if (Array.isArray(resolved)) inputs[name] = resolved;
      else if (resolved && "value" in resolved) inputs[name] = resolved.value;
      // A link that resolves to nothing (muted source) leaves the widget value, if any.
    });
    const title = node.title && node.title !== type ? String(node.title) : "";
    graph[node.id] = { class_type: type, inputs, ...(title ? { _meta: { title } } : {}) };
  }

  // Inputs pointing at nodes that never made it into the prompt (notes, muted) are dropped.
  for (const node of Object.values(graph)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && typeof value[0] === "string" && value.length === 2 && !graph[value[0]]) delete node.inputs[key];
    }
  }
  return { graph, warnings };
}

/**
 * The UI-level facts the API prompt loses: node titles, groups, and which
 * nodes sit together. Phase D reads titles from here when the prompt has none.
 */
export function visualTitles(raw) {
  try {
    const { nodes } = flattenVisual(raw);
    return Object.fromEntries(nodes.filter((node) => node.title).map((node) => [node.id, String(node.title)]));
  } catch {
    return {};
  }
}

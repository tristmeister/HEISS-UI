/**
 * What a person would change between runs of an imported workflow, read from
 * its API graph: the text they typed, the seed, the size, the images they feed
 * it, and the rest of the knobs. It never tries to understand the whole graph.
 *
 * The prompt is found by walking upstream from each sampler along the
 * conditioning and text wires until a literal: text nobody wired in, so text a
 * person typed. Prompt helpers (LLM rewriters, concatenation) are walked
 * through to their own typed text; their system or instruction text is told
 * apart by input name, wording, and, when earlier runs are known, by whether
 * it changed between runs.
 *
 * Every answer comes with a confidence. When the prompt is unclear the result
 * carries a question with the candidate texts, to show as they are.
 */

const linkTypes = new Set(["MODEL", "CLIP", "VAE", "LATENT", "IMAGE", "MASK", "NOISE", "SIGMAS", "SAMPLER", "GUIDER", "CONTROL_NET", "UPSCALE_MODEL", "CLIP_VISION", "CLIP_VISION_OUTPUT", "STYLE_MODEL", "GLIGEN", "AUDIO", "VIDEO"]);
// Inputs never walked when tracing text: they lead to models, pictures and other samplers.
const stopInputs = new Set(["model", "clip", "vae", "latent_image", "latent", "samples", "image", "images", "pixels", "mask", "noise", "sigmas", "sampler", "guider", "control_net", "upscale_model", "clip_vision", "clip_vision_output", "style_model", "audio", "video", "start_image", "end_image", "reference_image", "ref_image"]);
const instructionWords = /^(\s*)(you are|you're|act as|your (task|job|role)|rewrite|describe the|instructions?:|system:)|\b(the user'?s?|output only|respond (only )?with|do not (include|add|output)|as an ai|you will (receive|be given)|expand the (following|prompt))\b/i;
const fileLike = /\.(safetensors|ckpt|pt|pth|bin|gguf|sft|onnx|png|jpe?g|webp|mp4|webm|json|yaml|txt)$/i;
const outputClass = /^(SaveImage|PreviewImage|SaveAnimated|SaveVideo|SaveWEBM|VHS_VideoCombine|CreateVideo|SaveAudio|Image Save)|Save|Preview|VideoCombine/i;
const videoOutputClass = /Video|VHS_|WEBM|Animated|CreateVideo/i;
const samplerClass = /Sampler|Guider/i;
const settingTypes = new Set(["INT", "FLOAT", "BOOLEAN", "COMBO", "STRING"]);
const maxSettings = 48;

export function isLink(value) {
  return Array.isArray(value) && value.length === 2 && (typeof value[0] === "string" || typeof value[0] === "number") && Number.isInteger(value[1]);
}

function specFor(info, classType, name) {
  const input = info?.[classType]?.input;
  return input?.required?.[name] || input?.optional?.[name] || null;
}

/** The widget type of an input: INT, FLOAT, BOOLEAN, STRING, COMBO, or a link type, or "" when ComfyUI can't say. */
function inputType(info, classType, name, value) {
  const spec = specFor(info, classType, name);
  if (spec) {
    const [type] = spec;
    if (Array.isArray(type) || type === "COMBO") return "COMBO";
    return String(type || "");
  }
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "number") return Number.isInteger(value) ? "INT" : "FLOAT";
  if (typeof value === "string") return fileLike.test(value) ? "COMBO" : "STRING";
  return "";
}

function comboOptions(info, classType, name) {
  const spec = specFor(info, classType, name);
  if (!spec) return null;
  if (Array.isArray(spec[0])) return spec[0];
  if (Array.isArray(spec[1]?.options)) return spec[1].options;
  return null;
}

function numberLimits(info, classType, name) {
  const options = specFor(info, classType, name)?.[1] || {};
  const limits = {};
  for (const key of ["min", "max", "step"]) if (Number.isFinite(options[key])) limits[key] = options[key];
  return limits;
}

function isFreeText(info, classType, name, value) {
  if (typeof value !== "string") return false;
  // Joiners (", ", "\n") and separators aren't text anyone types a prompt into.
  if (/delimiter|separator|joiner|join_with/i.test(name)) return false;
  if (value.trim() && !/\p{L}/u.test(value)) return false;
  const spec = specFor(info, classType, name);
  if (spec) return spec[0] === "STRING";
  if (fileLike.test(value)) return false;
  return /text|prompt|string|value|positive|caption|instruction|system/i.test(name);
}

function humanize(name = "") {
  const text = String(name).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : name;
}

function titleOf(graph, titles, id) {
  return String(graph[id]?._meta?.title || titles?.[id] || "");
}

function snippet(text = "", max = 220) {
  const one = String(text).replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Which nodes feed an output node, directly or not: the part of the graph that matters. */
function reachingOutputs(graph, info) {
  let outputs = Object.entries(graph).filter(([, node]) => info?.[node.class_type]?.output_node || outputClass.test(node.class_type || "")).map(([id]) => id);
  if (!outputs.length) {
    // No save node (some shared workflows end in a decode): whatever nothing else reads is the end.
    const used = new Set(Object.values(graph).flatMap((node) => Object.values(node.inputs || {}).filter(isLink).map((value) => String(value[0]))));
    outputs = Object.keys(graph).filter((id) => !used.has(id));
  }
  const seen = new Set();
  const stack = [...outputs];
  while (stack.length) {
    const id = String(stack.pop());
    if (seen.has(id) || !graph[id]) continue;
    seen.add(id);
    for (const value of Object.values(graph[id].inputs || {})) if (isLink(value)) stack.push(String(value[0]));
  }
  return { reach: seen, outputs };
}

function outputNameOf(info, classType, slot) {
  const names = info?.[classType]?.output_name || info?.[classType]?.output || [];
  return String(names[slot] || "").toLowerCase();
}

/**
 * Every literal text upstream of a conditioning link, with its distance.
 * `polarity` keeps a trace from crossing to the other side in nodes that carry
 * both (ControlNet apply, InstructPix2Pix): positive follows positive.
 */
function textLiterals(graph, info, start, polarity) {
  const found = [];
  const seen = new Set();
  const queue = [{ link: start, depth: 1 }];
  while (queue.length) {
    const { link, depth } = queue.shift();
    const id = String(link[0]);
    const slot = link[1];
    const key = `${id}#${slot}`;
    if (seen.has(key) || depth > 30) continue;
    seen.add(key);
    const node = graph[id];
    if (!node) continue;
    // A zeroed or empty conditioning carries no text, whatever feeds it.
    if (/ZeroOut|EmptyConditioning|ConditioningSetTimestepRange.*Zero/i.test(node.class_type || "")) continue;
    const inputs = node.inputs || {};
    const hasBoth = "positive" in inputs && "negative" in inputs;
    const slotSide = hasBoth ? (outputNameOf(info, node.class_type, slot).includes("neg") || slot === 1 ? "negative" : "positive") : null;
    for (const [name, value] of Object.entries(inputs)) {
      if (isLink(value)) {
        if (stopInputs.has(name.toLowerCase())) continue;
        const type = inputType(info, node.class_type, name, value);
        if (linkTypes.has(type)) continue;
        if (hasBoth && (name === "positive" || name === "negative") && name !== slotSide) continue;
        queue.push({ link: value, depth: depth + 1 });
      } else if (isFreeText(info, node.class_type, name, value)) {
        found.push({ node: id, input: name, value, depth, classType: node.class_type });
      }
    }
  }
  return found;
}

/** Sampler-like nodes that use conditioning, in the part of the graph that reaches an output. */
function samplers(graph, reach) {
  return Object.entries(graph)
    .filter(([id, node]) => reach.has(id) && samplerClass.test(node.class_type || "") && Object.entries(node.inputs || {}).some(([name, value]) => isLink(value) && /^(positive|negative|conditioning|text_embeds|cond)$/.test(name)))
    .map(([id]) => id);
}

/** Nodes that turn noise into a latent: where size, steps and the main model are read from. */
function latentSamplers(graph, reach) {
  return Object.entries(graph)
    .filter(([id, node]) => reach.has(id) && /Sampler/i.test(node.class_type || "") && ["latent_image", "latent", "samples"].some((name) => isLink(node.inputs?.[name])))
    .map(([id]) => id);
}

const sdxlPair = new Set(["text_g", "text_l", "clip_l", "t5xxl"]);

function scoreCandidate(candidate, side, variants, graph, titles) {
  const name = candidate.input.toLowerCase();
  const title = titleOf(graph, titles, candidate.node).toLowerCase();
  const text = String(candidate.value || "");
  let score = 0;
  const reasons = [];
  if (/system|instruction|template|preset|role|format|guide|style_?prompt|rules/.test(name)) { score -= 6; reasons.push("instruction-input"); }
  if (side === "positive" && /neg/.test(name)) score -= 8;
  if (side === "negative" && /neg/.test(name)) score += 4;
  if (/^(text|prompt|positive|positive_prompt|user|user_prompt|string|value|text_g|text_l|t5xxl|clip_l|caption)$/.test(name)) score += 2;
  if (instructionWords.test(text)) { score -= 4; reasons.push("reads-like-instructions"); }
  if (side === "positive" && /positive|prompt/.test(title) && !/neg|system/.test(title)) score += 2;
  if (side === "positive" && /neg/.test(title)) score -= 6;
  if (side === "negative" && /neg/.test(title)) score += 3;
  if (/system|instruction/.test(title)) score -= 4;
  if (!text.trim()) score -= 1;
  if (/TextEncode/i.test(candidate.classType)) score += 1;
  if (variants.length) {
    const values = variants.map((graphVariant) => graphVariant?.[candidate.node]?.inputs?.[candidate.input]).filter((value) => typeof value === "string");
    if (values.some((value) => value !== text)) { score += 6; reasons.push("changes-between-runs"); }
    else if (values.length >= 2) { score -= 2; reasons.push("same-every-run"); }
  }
  return { ...candidate, score, reasons };
}

function rank(candidates, side, variants, graph, titles) {
  const unique = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.node}.${candidate.input}`;
    const current = unique.get(key);
    if (!current || candidate.depth < current.depth) unique.set(key, candidate);
  }
  return [...unique.values()].map((candidate) => scoreCandidate(candidate, side, variants, graph, titles)).sort((a, b) => b.score - a.score || a.depth - b.depth);
}

/** The top text, its partner fields on the same node (SDXL's text_g/text_l, Flux's clip_l/t5xxl), as mappings. */
function withPartners(top, ranked) {
  const mappings = [{ node: top.node, input: top.input }];
  if (sdxlPair.has(top.input)) {
    for (const other of ranked) {
      if (other.node === top.node && other.input !== top.input && sdxlPair.has(other.input)) mappings.push({ node: other.node, input: other.input });
    }
  }
  return mappings;
}

function findPrompt(graph, info, reach, titles, variants) {
  const sinks = samplers(graph, reach);
  const perSink = [];
  const negatives = [];
  for (const id of sinks) {
    const inputs = graph[id].inputs || {};
    const positive = inputs.positive || inputs.conditioning || inputs.text_embeds || inputs.cond;
    const positiveFound = isLink(positive) ? textLiterals(graph, info, positive, "positive") : [];
    // WanVideoWrapper-style encoders hold positive and negative text on one node.
    const split = positiveFound.filter((item) => /neg/i.test(item.input));
    perSink.push(positiveFound.filter((item) => !/neg/i.test(item.input)));
    negatives.push(...split);
    if (isLink(inputs.negative)) negatives.push(...textLiterals(graph, info, inputs.negative, "negative"));
  }
  // No sampler with conditioning (custom samplers that take text directly): every text input that reaches an output.
  if (!sinks.length) {
    const loose = [];
    for (const id of reach) {
      for (const [name, value] of Object.entries(graph[id].inputs || {})) {
        if (isFreeText(info, graph[id].class_type, name, value)) loose.push({ node: id, input: name, value, depth: 1, classType: graph[id].class_type });
      }
    }
    perSink.push(loose.filter((item) => !/neg/i.test(item.input)));
    negatives.push(...loose.filter((item) => /neg/i.test(item.input)));
  }

  const ranked = rank(perSink.flat(), "positive", variants, graph, titles);
  const result = { prompt: null, negative: null, question: null, confidence: "none", extraPrompts: [] };
  if (ranked.length) {
    // Each sampler's own best text. Base + refiner usually means two boxes with one intent: both get the prompt.
    const tops = [];
    for (const list of perSink) {
      const sinkRanked = rank(list, "positive", variants, graph, titles);
      if (sinkRanked[0] && !tops.some((item) => item.node === sinkRanked[0].node && item.input === sinkRanked[0].input)) tops.push(sinkRanked[0]);
    }
    const best = ranked[0];
    // The best other box: not the winner, and not its own SDXL/Flux partner field.
    const rival = ranked.find((item) => item !== best && !(item.node === best.node && sdxlPair.has(item.input) && sdxlPair.has(best.input))) || null;
    const clear = !rival || best.score - rival.score >= 3 || best.reasons.includes("changes-between-runs") && !rival.reasons.includes("changes-between-runs");
    // Separate samplers whose best boxes hold the same text are one prompt, written to each.
    const sameText = tops.filter((item) => item.value === best.value && item.score >= best.score - 2);
    const mappings = [];
    for (const item of sameText.length ? sameText : [best]) mappings.push(...withPartners(item, ranked));
    if (clear) {
      result.prompt = mappings.length === 1 ? mappings[0] : mappings;
      result.confidence = "high";
    } else {
      const candidates = ranked.filter((item) => item.score > best.score - 6).slice(0, 4);
      result.question = {
        kind: "prompt",
        text: "Which of these is your prompt?",
        candidates: candidates.map((item) => ({
          id: `${item.node}.${item.input}`,
          node: item.node,
          input: item.input,
          title: titleOf(graph, titles, item.node) || humanize(item.classType),
          text: snippet(item.value),
          mappings: withPartners(item, ranked)
        }))
      };
      // Until answered, the strongest guess stands in, so the card works right away.
      result.prompt = mappings.length === 1 ? mappings[0] : mappings;
      result.confidence = "asked";
    }
    const used = new Set([].concat(result.prompt).map((item) => `${item.node}.${item.input}`));
    // Other boxes a person writes in (regional prompts, a second character) stay editable under More settings.
    result.extraPrompts = ranked.filter((item) => !used.has(`${item.node}.${item.input}`) && item.score >= 0 && !item.reasons.includes("instruction-input")).map((item) => ({ node: item.node, input: item.input }));
  }
  const promptKeys = new Set([].concat(result.prompt || []).map((item) => `${item.node}.${item.input}`));
  const negativeRanked = rank(negatives.filter((item) => !promptKeys.has(`${item.node}.${item.input}`)), "negative", variants, graph, titles);
  if (negativeRanked[0]) result.negative = withPartners(negativeRanked[0], negativeRanked).length > 1 ? withPartners(negativeRanked[0], negativeRanked) : { node: negativeRanked[0].node, input: negativeRanked[0].input };
  return { ...result, sinks };
}

const primitiveClass = /Primitive|^Int$|^Float$|Number|Seed|Value|Constant|INTConstant|FloatConstant/i;

/** A primitive-like node's own number: { node, input } or null. */
function primitiveNumber(graph, id) {
  const node = graph[id];
  if (!node || !primitiveClass.test(node.class_type || "")) return null;
  const entries = Object.entries(node.inputs || {});
  if (entries.length > 3 || entries.some(([, value]) => isLink(value))) return null;
  const literal = entries.find(([, value]) => typeof value === "number");
  return literal ? { node: id, input: literal[0] } : null;
}

/**
 * The node and input holding a number. A wire is followed up to a few steps
 * (through math or a resize) to the one primitive it comes from; two sources
 * (a switch, a product) mean no single knob, so null.
 */
function numberSource(graph, id, input) {
  const value = graph[id]?.inputs?.[input];
  if (typeof value === "number") return { node: id, input };
  if (!isLink(value)) return null;
  const sources = new Map();
  const stack = [{ id: String(value[0]), depth: 0 }];
  const seen = new Set();
  while (stack.length) {
    const { id: current, depth } = stack.pop();
    if (seen.has(current) || depth > 4) continue;
    seen.add(current);
    const primitive = primitiveNumber(graph, current);
    if (primitive) { sources.set(`${primitive.node}.${primitive.input}`, primitive); continue; }
    const node = graph[current];
    if (!node || /Switch/i.test(node.class_type || "")) return null;
    for (const inner of Object.values(node.inputs || {})) if (isLink(inner)) stack.push({ id: String(inner[0]), depth: depth + 1 });
  }
  return sources.size === 1 ? [...sources.values()][0] : null;
}

/** Number knobs the author put on the canvas as titled primitives ("Width", "Steps", "FPS"). */
function titledPrimitive(graph, reach, titles, pattern) {
  const matches = [...reach].filter((id) => primitiveNumber(graph, id) && pattern.test(titleOf(graph, titles, id).trim()));
  return matches.length === 1 ? primitiveNumber(graph, matches[0]) : null;
}

function upstream(graph, id, names, depth = 0, seen = new Set()) {
  if (depth > 12 || seen.has(id) || !graph[id]) return [];
  seen.add(id);
  const result = [id];
  for (const [name, value] of Object.entries(graph[id].inputs || {})) {
    if (isLink(value) && names.test(name)) result.push(...upstream(graph, String(value[0]), names, depth + 1, seen));
  }
  return result;
}

function findSize(graph, sinks, reach) {
  for (const id of [...latentSamplers(graph, reach), ...sinks]) {
    const inputs = graph[id].inputs || {};
    const latent = inputs.latent_image || inputs.latent || inputs.samples || inputs.image_embeds;
    if (!isLink(latent)) continue;
    const chain = upstream(graph, String(latent[0]), /^(latent|latent_image|samples|samples_to|positive)$/);
    const fromImage = chain.some((node) => /VAEEncode|InpaintModelConditioning|ImageToVideo|EncodeImage/i.test(graph[node]?.class_type || "") && !("width" in (graph[node]?.inputs || {})));
    const sized = chain.find((node) => "width" in (graph[node]?.inputs || {}) && "height" in (graph[node]?.inputs || {}));
    if (sized) {
      const width = numberSource(graph, sized, "width");
      const height = numberSource(graph, sized, "height");
      if (width && height) return { width, height, latentNode: sized, fromImage: false };
      return { latentNode: sized, fromImage: true };
    }
    if (fromImage) return { fromImage: true, latentNode: chain[0] };
  }
  const loose = [...reach].find((id) => /Latent|Video|Resolution/i.test(graph[id]?.class_type || "") && typeof graph[id]?.inputs?.width === "number" && typeof graph[id]?.inputs?.height === "number");
  return loose ? { width: { node: loose, input: "width" }, height: { node: loose, input: "height" }, latentNode: loose, fromImage: false } : {};
}

function findSamplerSettings(graph, sinks, reach) {
  sinks = [...latentSamplers(graph, reach), ...sinks.filter((id) => !latentSamplers(graph, reach).includes(id))];
  const controls = {};
  const primary = sinks.find((id) => Number(graph[id].inputs?.denoise ?? 1) >= 1) || sinks[0];
  if (!primary) return controls;
  const node = graph[primary];
  const take = (key, id, input) => {
    if (controls[key] || !graph[id]) return;
    const value = graph[id].inputs?.[input];
    if (value === undefined) return;
    if (typeof value === "number" || typeof value === "string") controls[key] = { node: id, input };
    else if (isLink(value)) { const source = numberSource(graph, id, input); if (source) controls[key] = source; }
  };
  take("steps", primary, "steps");
  take("cfg", primary, "cfg");
  take("sampler", primary, "sampler_name");
  take("scheduler", primary, "scheduler");
  take("denoise", primary, "denoise");
  // Custom sampling: the knobs live on the guider, sampler and scheduler nodes it is wired to.
  const linked = (name) => isLink(node.inputs?.[name]) ? String(node.inputs[name][0]) : null;
  const guider = linked("guider");
  if (guider) take("cfg", guider, "cfg");
  const samplerNode = linked("sampler");
  if (samplerNode) take("sampler", samplerNode, "sampler_name");
  const sigmas = linked("sigmas");
  if (sigmas) {
    take("steps", sigmas, "steps");
    take("scheduler", sigmas, "scheduler");
    take("denoise", sigmas, "denoise");
  }
  return controls;
}

function findSeeds(graph, reach) {
  const seeds = [];
  const seen = new Set();
  for (const id of reach) {
    for (const name of ["seed", "noise_seed"]) {
      if (!(name in (graph[id].inputs || {}))) continue;
      const source = numberSource(graph, id, name);
      if (!source) continue;
      const key = `${source.node}.${source.input}`;
      if (!seen.has(key)) { seen.add(key); seeds.push(source); }
    }
  }
  return seeds;
}

function findMainModel(graph, sinks, reach) {
  for (const id of [...latentSamplers(graph, reach), ...sinks]) {
    const model = graph[id].inputs?.model;
    const start = isLink(model) ? String(model[0]) : isLink(graph[id].inputs?.guider) ? String(graph[id].inputs.guider[0]) : null;
    if (!start) continue;
    const chain = upstream(graph, start, /^(model|on_true|on_false|model1|base_model)$/);
    const loader = chain.find((node) => /Loader/i.test(graph[node]?.class_type || "") && ["ckpt_name", "unet_name", "model_name", "gguf_name"].some((key) => typeof graph[node]?.inputs?.[key] === "string") && !/Lora/i.test(graph[node]?.class_type || ""));
    if (loader) {
      const input = ["ckpt_name", "unet_name", "model_name", "gguf_name"].find((key) => typeof graph[loader].inputs[key] === "string");
      return { node: loader, input };
    }
  }
  return null;
}

function findImages(graph, info, reach, titles, sinks) {
  const loaders = [...reach].filter((id) => {
    const node = graph[id];
    if (!node) return false;
    if (/^LoadImage(?!Mask)/.test(node.class_type) || /LoadImage$/i.test(node.class_type)) return typeof node.inputs?.image === "string";
    const spec = specFor(info, node.class_type, "image");
    return Boolean(spec?.[1]?.image_upload) && typeof node.inputs?.image === "string";
  });
  const sinkLatents = new Set(sinks.flatMap((id) => {
    const latent = graph[id].inputs?.latent_image || graph[id].inputs?.latent;
    return isLink(latent) ? upstream(graph, String(latent[0]), /.*/) : [];
  }));
  return loaders.map((id, index) => {
    const startsLatent = sinkLatents.has(id);
    const title = titleOf(graph, titles, id);
    return {
      id: `image-${id}`.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase(),
      kind: "image",
      label: title && !/^load image$/i.test(title) ? title : loaders.length > 1 ? `Image ${index + 1}` : startsLatent ? "Start image" : "Reference image",
      required: false,
      min: 0,
      max: 1,
      control: { node: id, input: "image" },
      role: startsLatent ? "start" : "reference"
    };
  });
}

function findLoraStack(graph, reach) {
  for (const id of reach) {
    const node = graph[id];
    if (node?.class_type === "Power Lora Loader (rgthree)") {
      // Attaching the studio's LoRA picker replaces the loader's own list, so only an empty loader gets it.
      const active = Object.entries(node.inputs || {}).some(([key, value]) => /^lora_\d+$/i.test(key) && value?.on && value?.lora && value.lora !== "None");
      return active ? null : { adapter: "rgthree-power-v1", node: id, max: 8 };
    }
    if (node?.class_type === "Lora Loader Stack (rgthree)") {
      const active = Object.entries(node.inputs || {}).some(([key, value]) => /^lora_\d+$/.test(key) && value && value !== "None");
      return active ? null : { adapter: "rgthree-stack-v1", node: id, max: 4 };
    }
  }
  return null;
}

function findVideo(graph, reach, latentNode) {
  const controls = {};
  const latent = latentNode ? graph[latentNode] : null;
  for (const name of ["length", "num_frames", "frames", "video_length", "frame_count"]) {
    const source = latent && name in (latent.inputs || {}) ? numberSource(graph, latentNode, name) : null;
    if (source) { controls.frames = source; break; }
  }
  if (!controls.frames) {
    for (const id of reach) {
      const name = ["length", "num_frames", "video_length"].find((key) => typeof graph[id].inputs?.[key] === "number");
      if (name && /Video|Latent|Wan|LTX|Hunyuan/i.test(graph[id].class_type)) { controls.frames = { node: id, input: name }; break; }
    }
  }
  for (const id of reach) {
    if (!(outputClass.test(graph[id].class_type) || /CreateVideo/i.test(graph[id].class_type))) continue;
    const name = ["frame_rate", "fps"].find((key) => key in (graph[id].inputs || {}));
    const source = name ? numberSource(graph, id, name) : null;
    if (source) { controls.fps = source; break; }
  }
  return controls;
}

function keysOf(mapping) {
  return [].concat(mapping || []).filter(Boolean).map((item) => `${item.node}.${item.input}`);
}

/** Every other knob that changes the result, grouped by the node it sits on. */
function findSettings(graph, info, reach, titles, taken) {
  const settings = [];
  for (const id of reach) {
    const node = graph[id];
    if (!node || /Loader/i.test(node.class_type) && !/Lora/i.test(node.class_type)) continue;
    if (outputClass.test(node.class_type) && !/VideoCombine|CreateVideo/i.test(node.class_type)) continue;
    for (const [name, value] of Object.entries(node.inputs || {})) {
      if (isLink(value) || value === null || typeof value === "object") continue;
      const key = `${id}.${name}`;
      if (taken.has(key) || /^(filename_prefix|control_after_generate|unique_id|upload|image|video|audio)$/.test(name)) continue;
      const type = inputType(info, node.class_type, name, value);
      if (!settingTypes.has(type)) continue;
      if (type === "STRING" && typeof value === "string" && value.length > 400) continue;
      if (type === "COMBO" && typeof value === "string" && fileLike.test(value) && !/Lora/i.test(node.class_type)) continue;
      const options = type === "COMBO" ? comboOptions(info, node.class_type, name) : null;
      settings.push({
        key,
        node: id,
        input: name,
        label: humanize(name),
        group: titleOf(graph, titles, id) || humanize(node.class_type),
        type,
        default: value,
        ...(options ? { options: options.slice(0, 200).map(String) } : {}),
        ...(type === "INT" || type === "FLOAT" ? numberLimits(info, node.class_type, name) : {})
      });
      if (settings.length >= maxSettings) return settings;
    }
  }
  return settings;
}

/**
 * Reads an API graph. `titles` maps node ids to canvas titles when the prompt
 * lacks them; `variants` are other runs of the same workflow (from history),
 * which tell typed text from fixed text.
 */
export function understandWorkflow(graph, { info = {}, titles = {}, variants = [] } = {}) {
  const { reach } = reachingOutputs(graph, info);
  const prompt = findPrompt(graph, info, reach, titles, variants);
  const size = findSize(graph, prompt.sinks, reach);
  const controls = {};
  if (prompt.prompt) controls.prompt = prompt.prompt;
  if (prompt.negative) controls.negative = prompt.negative;
  const seeds = findSeeds(graph, reach);
  if (seeds.length) controls.seed = seeds.length === 1 ? seeds[0] : seeds;
  if (size.width && size.height) {
    controls.width = size.width;
    controls.height = size.height;
  }
  if (size.latentNode && typeof graph[size.latentNode]?.inputs?.batch_size === "number") controls.count = { node: size.latentNode, input: "batch_size" };
  Object.assign(controls, findSamplerSettings(graph, prompt.sinks, reach));
  for (const [key, value] of Object.entries(findVideo(graph, reach, size.latentNode))) controls[key] ||= value;
  // Knobs the author exposed as titled primitives, for whatever the wires didn't settle.
  const titled = { width: /^width$/i, height: /^height$/i, steps: /^steps$/i, cfg: /^(cfg|guidance)$/i, fps: /^(fps|frame ?rate)$/i, frames: /^(frames|length|frame count|num frames)$/i };
  for (const [key, pattern] of Object.entries(titled)) {
    if (controls[key]) continue;
    if ((key === "width" || key === "height") && size.fromImage) continue;
    const found = titledPrimitive(graph, reach, titles, pattern);
    if (found) controls[key] = found;
  }
  if (!controls.width !== !controls.height) { delete controls.width; delete controls.height; }
  const model = findMainModel(graph, prompt.sinks, reach);
  if (model) controls.model = model;
  const mediaInputs = findImages(graph, info, reach, titles, prompt.sinks);
  const loraStack = findLoraStack(graph, reach);
  const taken = new Set([...Object.values(controls).flatMap(keysOf), ...mediaInputs.map((item) => `${item.control.node}.${item.control.input}`)]);
  const extra = prompt.extraPrompts.map((item) => ({
    key: `${item.node}.${item.input}`,
    node: item.node,
    input: item.input,
    label: titleOf(graph, titles, item.node) || "Prompt",
    group: "Prompts",
    type: "STRING",
    multiline: true,
    default: graph[item.node]?.inputs?.[item.input] ?? ""
  }));
  for (const item of extra) taken.add(item.key);
  const settings = [...extra, ...findSettings(graph, info, reach, titles, taken)];
  const isVideo = [...reach].some((id) => videoOutputClass.test(graph[id]?.class_type || "")) || Boolean(controls.frames);
  return {
    controls,
    mediaInputs,
    loraStack,
    settings,
    kind: isVideo ? "video" : "image",
    aspectPolicy: size.fromImage ? "reference" : "manual",
    capabilities: {
      ...(mediaInputs.some((item) => item.role === "start") ? { imageToImage: true } : {}),
      ...(mediaInputs.length ? { startImage: true } : {})
    },
    confidence: { prompt: prompt.confidence },
    question: prompt.question,
    hasOutput: reach.size > 0
  };
}

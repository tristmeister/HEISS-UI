import fs from "node:fs";
import path from "node:path";
import { comfy, modelFolders } from './comfy.js';
import { families } from './family-catalog.js';
import { readSafetensorsHeader } from './model-families.js';

/**
 * What a LoRA was trained for and how to trigger it, read the same way model
 * files are: the safetensors header first (its key names and shapes give the
 * architecture away), then its metadata (kohya's ss_base_model_version,
 * modelspec), and never the file name alone. Nothing is guessed: a LoRA that
 * says nothing clear stays "unknown" and is never marked as not fitting.
 *
 * families: the model families it fits (a Wan 14B LoRA fits Wan 2.1 and 2.2
 * 14B alike); empty when unknown. triggers: its trigger words. about: its own
 * title, for telling a speed LoRA from a style one.
 */

// file:size:mtime -> info for LoRAs on this computer; name -> info for a remote ComfyUI's.
const cache = new Map();
const remoteCache = new Map();
// name -> the latest info either way, for lookups that must not read a file.
const lastKnown = new Map();

/* ------------------------------------------------------------ Metadata */

// Ordered: the more specific names first ("flux 2" before "flux", "wan 2.2 5b" before "wan").
const metadataFamilies = [
  [/flux[-_. ]?2[-_. ]?klein[-_. ]?9b|klein[-_. ]?9b/, ["flux2_klein_9b"]],
  [/flux[-_. ]?2[-_. ]?klein|klein[-_. ]?4b/, ["flux2_klein_4b"]],
  [/flux[-_. ]?2/, ["flux2_dev", "flux2_klein_4b", "flux2_klein_9b"]],
  [/chroma/, ["chroma"]],
  [/flux/, ["flux1"]],
  [/z[-_ ]?image/, ["zimage"]],
  [/qwen[-_ ]?image[-_ ]?2[._]?1/, ["qwen_image_21"]],
  [/qwen[-_ ]?image/, ["qwen_image"]],
  [/wan[-_ ]?2[._]?2.*5b|ti2v/, ["wan22_5b"]],
  [/wan/, ["wan21", "wan22_14b"]],
  [/hunyuan[-_ ]?video[-_ ]?1[._]?5|hunyuan15/, ["hunyuan15"]],
  [/hidream/, ["hidream"]],
  [/lumina|neta/, ["lumina2"]],
  [/krea[-_ ]?2/, ["krea2"]],
  [/anima/, ["anima"]],
  [/auraflow|pony[-_ ]?v7/, ["auraflow"]],
  [/sd[-_ ]?3|stable-diffusion-v3|stable-diffusion-3/, ["sd3"]],
  [/sdxl|stable-diffusion-xl|xl[-_]base|pony|illustrious|noob/, ["sdxl"]],
  [/sd[-_ ]?v?2|stable-diffusion-v2/, ["sd2"]],
  [/sd[-_ ]?v?1|stable-diffusion-v1|sd[-_ ]?1\.5/, ["sd15"]]
];

/** Families from what a LoRA's metadata says it was trained on, or []. */
export function familiesFromMetadata(metadata = {}) {
  const text = ["modelspec.architecture", "ss_base_model_version", "ss_architecture", "base_model", "modelspec.base_model"]
    .map((key) => metadata?.[key]).filter((value) => typeof value === "string").join(" ").toLowerCase();
  if (!text) return [];
  return metadataFamilies.find(([test]) => test.test(text))?.[1] || [];
}

const parseJson = (value) => {
  if (typeof value !== "string") return value && typeof value === "object" ? value : null;
  try { return JSON.parse(value); } catch { return null; }
};

/**
 * Trigger words: what the trainer wrote down (modelspec's trigger phrase,
 * ai-toolkit's trigger word), else the tags kohya saw on every training image.
 */
export function triggersFromMetadata(metadata = {}) {
  const explicit = [metadata?.["modelspec.trigger_phrase"], metadata?.trigger_phrase, metadata?.trigger_word, metadata?.trigger_words, metadata?.["ss_trigger_words"]]
    .filter((value) => typeof value === "string" && value.trim());
  if (explicit.length) {
    return [...new Set(explicit.flatMap((value) => value.split(/[,\n]/)).map((word) => word.trim()).filter(Boolean))].slice(0, 6);
  }
  const frequency = parseJson(metadata?.ss_tag_frequency);
  if (!frequency || typeof frequency !== "object") return [];
  const counts = new Map();
  let images = 0;
  for (const tags of Object.values(frequency)) {
    if (!tags || typeof tags !== "object") continue;
    for (const [tag, count] of Object.entries(tags)) {
      const word = String(tag).trim();
      if (!word || !Number.isFinite(Number(count))) continue;
      counts.set(word, (counts.get(word) || 0) + Number(count));
    }
  }
  // Datasets that give their image count; otherwise the most frequent tag stands in for it.
  const datasets = parseJson(metadata?.ss_dataset_dirs);
  if (datasets && typeof datasets === "object") images = Object.values(datasets).reduce((sum, item) => sum + (Number(item?.img_count) || 0), 0);
  const top = Math.max(0, ...counts.values());
  const every = images || top;
  if (!every) return [];
  return [...counts.entries()]
    .filter(([, count]) => count >= every * 0.9)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag)
    // A caption-long "tag" is a whole sentence, not something to type.
    .filter((tag) => tag.length <= 48)
    .slice(0, 5);
}

/* ------------------------------------------------------------ Tensor keys */

// Weight suffixes the LoRA formats add to a module's name.
const loraSuffix = /\.(lora_down|lora_up|lora_A|lora_B|lora_mid|down|up)(\.default)?\.weight$|\.(alpha|dora_scale|diff|diff_b)$|\.(hada|lokr)_\w+$/;
const kind = (key) => (/lora_(up|B)\.|\.up\.weight$/.test(key) ? "up" : /lora_(down|A)\.|\.down\.weight$/.test(key) ? "down" : "");

/** Every down-projection's input width and up-projection's output width, by module path. */
function shapes(header) {
  const found = [];
  for (const [key, value] of Object.entries(header || {})) {
    if (key === "__metadata__" || !Array.isArray(value?.shape)) continue;
    const role = kind(key);
    if (!role) continue;
    const module = key.replace(loraSuffix, "");
    found.push({ module, role, width: role === "down" ? Number(value.shape[1]) : Number(value.shape[0]) });
  }
  return found;
}

function widthOf(list, pattern, role) {
  return list.find((item) => item.role === role && pattern.test(item.module))?.width || 0;
}

function blockCount(keys, pattern) {
  let most = -1;
  for (const key of keys) {
    const match = pattern.exec(key);
    if (match) most = Math.max(most, Number(match[1]));
  }
  return most + 1;
}

/**
 * Families from the tensor keys and shapes, mirroring what the model
 * detection reads: SD's UNet blocks and cross-attention width, Flux-style
 * double/single blocks (and how wide they are, which tells Flux.1 from the
 * Flux.2 sizes), Wan's self/cross attention, Qwen-Image's split MLPs, the
 * Lumina/Z-Image layers. [] when the layout says nothing clear.
 */
export function familiesFromKeys(header) {
  const keys = Object.keys(header || {}).filter((key) => key !== "__metadata__");
  if (!keys.length) return [];
  const list = shapes(header);
  const has = (pattern) => keys.some((key) => pattern.test(key));

  if (has(/(^|[._])(input_blocks|output_blocks|middle_block|down_blocks|up_blocks|mid_block)[._]\d/)) {
    const context = widthOf(list, /attn2[._]to_k/, "down");
    if (context === 2048 || has(/^lora_te2_/)) return ["sdxl"];
    if (context === 768) return ["sd15"];
    if (context === 1024) return ["sd2"];
    return [];
  }
  if (has(/joint_blocks[._]\d/)) return ["sd3"];
  if (has(/double_layers[._]\d|single_layers[._]\d/)) return ["auraflow"];
  if (has(/double_stream_blocks[._]\d|single_stream_blocks[._]\d/)) return ["hidream"];
  if (has(/(^|[._])blocks[._]\d+[._](self_attn|cross_attn|ffn)[._]/)) {
    const width = widthOf(list, /blocks[._]\d+[._]self_attn[._]q$/, "down");
    if (width === 3072) return ["wan22_5b"];
    if (width === 5120 || width === 1536) return ["wan21", "wan22_14b"];
    return ["wan21", "wan22_14b", "wan22_5b"];
  }
  if (has(/transformer_blocks[._]\d+[._](img_mlp|txt_mlp|img_mod|txt_mod)[._]/)) {
    return has(/img_mlp[._](gate_up|proj)$/) ? ["qwen_image_21"] : ["qwen_image"];
  }
  if (has(/(^|[._])layers[._]\d+[._](attention|feed_forward)[._]/)) {
    const width = widthOf(list, /layers[._]\d+[._]attention[._](qkv|to_q)$/, "down");
    if (width === 3840) return ["zimage"];
    if (width === 2304) return ["lumina2"];
    return ["zimage", "lumina2"];
  }
  const doubles = blockCount(keys, /double_blocks[._](\d+)[._]/);
  const diffusersFlux = has(/single_transformer_blocks[._]\d/);
  if (doubles || diffusersFlux) {
    // HunyuanVideo shares Flux's block names; its 20 double blocks (1.0) or 2048 width (1.5) give it away.
    const hidden = widthOf(list, /double_blocks[._]\d+[._]img_attn[._]qkv$|transformer_blocks[._]\d+[._]attn[._]to_q$/, "down");
    if (hidden === 2048) return ["hunyuan15"];
    if (doubles === 20) return [];
    const linear1 = widthOf(list, /single_blocks[._]\d+[._]linear1$/, "up");
    if (linear1 === 27648) return ["flux2_klein_4b"];
    if (linear1 === 36864) return ["flux2_klein_9b"];
    if (linear1 === 55296 || hidden === 6144) return ["flux2_dev"];
    if (hidden === 4096) return ["flux2_klein_9b"];
    // Per-block modulation is Flux.1's own; Flux.2 modulates once for all blocks.
    if (has(/img_mod[._]lin|norm1[._]linear/) || linear1 === 21504) return ["flux1", "chroma"];
    return ["flux1", "chroma", "flux2_klein_4b"];
  }
  return [];
}

/* ------------------------------------------------------------ Files */

function localLoraFile(name) {
  const parts = String(name).split(/[\\/]/).filter(Boolean);
  if (!parts.length || parts.some((part) => part === "..") || !/\.safetensors$/i.test(name)) return "";
  for (const dir of modelFolders("loras", ["loras"])) {
    const file = path.join(dir, ...parts);
    try { if (fs.statSync(file).isFile()) return file; } catch { /* next folder */ }
  }
  return "";
}

const label = (ids) => [...new Set(ids.map((id) => families[id]?.label).filter(Boolean))].join(" / ");

function describe(header, metadata) {
  const fromKeys = familiesFromKeys(header);
  const fromMeta = familiesFromMetadata(metadata);
  // The keys are the stronger witness; metadata narrows a key reading that fits several.
  const narrowed = fromKeys.length && fromMeta.length ? fromKeys.filter((id) => fromMeta.includes(id)) : [];
  const ids = narrowed.length ? narrowed : fromKeys.length ? fromKeys : fromMeta;
  const about = ["modelspec.title", "ss_output_name", "name"].map((key) => metadata?.[key]).filter((value) => typeof value === "string").join(" ");
  return { families: ids, base: label(ids), triggers: triggersFromMetadata(metadata || {}), ...(about ? { about: about.slice(0, 200) } : {}) };
}

/** What one LoRA file on this computer is, cached by size and date; null when out of reach. */
export function loraInfo(name) {
  const file = localLoraFile(name);
  if (!file) return remoteCache.get(name) || null;
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  const key = `${file}:${stat.size}:${stat.mtimeMs}`;
  if (!cache.has(key)) {
    let header = null;
    try { header = readSafetensorsHeader(file); } catch { header = null; }
    cache.set(key, header ? describe(header, header.__metadata__ || {}) : null);
  }
  const info = cache.get(key);
  if (info) lastKnown.set(name, info);
  return info;
}

/** Only what is known already, without touching the disk: for hot paths such as every Generate. */
export function cachedLoraAbout(name) {
  return lastKnown.get(name)?.about || "";
}

/**
 * Every listed LoRA's info. A ComfyUI on another computer only hands out the
 * metadata block (no tensor names) through /view_metadata, so those are read
 * from metadata alone, a few at a time, and remembered.
 */
export async function loraInfos(names = [], { concurrency = 6 } = {}) {
  const result = {};
  const remote = [];
  for (const name of names) {
    const info = loraInfo(name);
    if (info) result[name] = info;
    else if (/\.safetensors$/i.test(name) && !remoteCache.has(name) && !localLoraFile(name)) remote.push(name);
  }
  async function worker() {
    while (remote.length) {
      const name = remote.shift();
      try {
        const metadata = await comfy(`/view_metadata/loras?filename=${encodeURIComponent(name)}`, { timeout: 10_000 });
        remoteCache.set(name, describe(null, metadata && typeof metadata === "object" ? metadata : {}));
      } catch (error) {
        // No metadata block is an answer worth keeping; anything else is tried again next time.
        if (Number(error?.status) === 404) remoteCache.set(name, describe(null, {}));
      }
      if (remoteCache.has(name)) {
        result[name] = remoteCache.get(name);
        lastKnown.set(name, result[name]);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return result;
}

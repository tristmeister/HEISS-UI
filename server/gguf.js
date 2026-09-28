import fs from "node:fs";
import path from "node:path";
import { hasNode, modelFolders, optionsFor } from './comfy.js';

/**
 * GGUF model files, the way ComfyUI-GGUF (city96) loads them.
 *
 * Headers are read into the same shape as a safetensors header
 * ({ name: { dtype, shape }, __metadata__ }) so every detector that reads
 * tensor names and shapes works on GGUF unchanged: shapes in PyTorch order
 * (GGUF stores them innermost first), the original shape where the converter
 * flattened a tensor (comfy.gguf.orig_shape.*), and text encoders under the
 * key names ComfyUI-GGUF renames llama.cpp's to before ComfyUI sees them.
 *
 * In a graph, a core loader handed a .gguf file becomes its ComfyUI-GGUF twin.
 * Spec: https://github.com/ggml-org/ggml/blob/master/docs/gguf.md
 */

export const isGguf = (name = "") => /\.gguf$/i.test(String(name));

/* ------------------------------------------------------------ Header */

// ggml_type ids (ggml.h) for the dtype column; unknown ids stay numeric.
const ggmlTypes = {
  0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1", 6: "Q5_0", 7: "Q5_1", 8: "Q8_0", 9: "Q8_1",
  10: "Q2_K", 11: "Q3_K", 12: "Q4_K", 13: "Q5_K", 14: "Q6_K", 15: "Q8_K",
  16: "IQ2_XXS", 17: "IQ2_XS", 18: "IQ3_XXS", 19: "IQ1_S", 20: "IQ4_NL", 21: "IQ3_S", 22: "IQ2_S", 23: "IQ4_XS",
  24: "I8", 25: "I16", 26: "I32", 27: "I64", 28: "F64", 29: "IQ1_M", 30: "BF16", 34: "TQ1_0", 35: "TQ2_0", 39: "MXFP4"
};

// gguf_type: byte size of each fixed-size value; 8 is a string, 9 an array.
const valueSizes = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };

// Tokenizer vocabularies make up most of a text encoder's header: a few MB, never 64.
const maxHeaderBytes = 64 * 1024 * 1024;
const chunkBytes = 1024 * 1024;
// Arrays this short are kept (shapes); longer ones (vocabularies) are skipped.
const keptArrayLength = 16;

function cursor(fd, limit) {
  let buffer = Buffer.alloc(0);
  let start = 0;
  let pos = 0;
  const take = (count) => {
    if (count < 0 || pos + count > limit) throw new Error("GGUF header too large.");
    if (pos < start || pos + count > start + buffer.length) {
      const next = Buffer.alloc(Math.max(count, chunkBytes));
      const read = fs.readSync(fd, next, 0, next.length, pos);
      if (read < count) throw new Error("GGUF header is truncated.");
      buffer = next.subarray(0, read);
      start = pos;
    }
    const at = pos - start;
    pos += count;
    return buffer.subarray(at, at + count);
  };
  const u64 = () => Number(take(8).readBigUInt64LE(0));
  return {
    take,
    u32: () => take(4).readUInt32LE(0),
    u64,
    string: () => take(u64()).toString("utf8"),
    skip: (count) => {
      if (count < 0 || pos + count > limit) throw new Error("GGUF header too large.");
      pos += count;
    }
  };
}

function readScalar(r, type) {
  const bytes = r.take(valueSizes[type]);
  switch (type) {
    case 0: return bytes.readUInt8(0);
    case 1: return bytes.readInt8(0);
    case 2: return bytes.readUInt16LE(0);
    case 3: return bytes.readInt16LE(0);
    case 4: return bytes.readUInt32LE(0);
    case 5: return bytes.readInt32LE(0);
    case 6: return bytes.readFloatLE(0);
    case 7: return bytes[0] !== 0;
    case 10: return Number(bytes.readBigUInt64LE(0));
    case 11: return Number(bytes.readBigInt64LE(0));
    default: return bytes.readDoubleLE(0);
  }
}

/** One metadata value; long arrays are skipped (undefined). */
function readValue(r, type) {
  if (type === 8) return r.string();
  if (type === 9) {
    const itemType = r.u32();
    const count = r.u64();
    if (count <= keptArrayLength) return Array.from({ length: count }, () => readValue(r, itemType));
    if (valueSizes[itemType]) r.skip(count * valueSizes[itemType]);
    else for (let index = 0; index < count; index += 1) readValue(r, itemType);
    return undefined;
  }
  if (!valueSizes[type]) throw new Error(`Unknown GGUF value type ${type}.`);
  return readScalar(r, type);
}

/**
 * A GGUF file's tensor names and shapes plus its scalar metadata, as a
 * safetensors-style header. Throws on anything that is not GGUF v2/v3.
 */
export function readGgufHeader(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const r = cursor(fd, Math.min(size, maxHeaderBytes));
    if (r.take(4).toString("latin1") !== "GGUF") throw new Error("Not a GGUF file.");
    const version = r.u32();
    // v1 used 32-bit counts; a byte-swapped version is a big-endian file.
    if (version !== 2 && version !== 3) throw new Error(`Unsupported GGUF version ${version}.`);
    const tensorCount = r.u64();
    const kvCount = r.u64();
    const metadata = {};
    const origShapes = {};
    for (let index = 0; index < kvCount; index += 1) {
      const key = r.string();
      const value = readValue(r, r.u32());
      if (key.startsWith("comfy.gguf.orig_shape.")) origShapes[key.slice(22)] = value;
      else if (value !== undefined && !Array.isArray(value)) metadata[key] = value;
    }
    const tensors = [];
    for (let index = 0; index < tensorCount; index += 1) {
      const name = r.string();
      const dims = r.u32();
      if (dims > 8) throw new Error("Malformed GGUF tensor info.");
      const shape = Array.from({ length: dims }, () => r.u64()).reverse();
      const type = r.u32();
      r.skip(8); // offset into the data section
      tensors.push([name, { dtype: ggmlTypes[type] || String(type), shape: Array.isArray(origShapes[name]) ? origShapes[name] : shape }]);
    }
    const renamed = textEncoderKeys(metadata["general.architecture"], tensors);
    return { __metadata__: { ...metadata, format: "gguf" }, ...Object.fromEntries(renamed) };
  } finally {
    fs.closeSync(fd);
  }
}

/* ------------------------------------------------------------ Text encoders */

// ComfyUI-GGUF's loader.py maps llama.cpp names back to the originals before
// ComfyUI detects the encoder; replacements run in order, like its dicts.
const t5Keys = [
  ["enc.", "encoder."], [".blk.", ".block."], ["token_embd", "shared"], ["output_norm", "final_layer_norm"],
  ["attn_q", "layer.0.SelfAttention.q"], ["attn_k", "layer.0.SelfAttention.k"], ["attn_v", "layer.0.SelfAttention.v"],
  ["attn_o", "layer.0.SelfAttention.o"], ["attn_norm", "layer.0.layer_norm"], ["attn_rel_b", "layer.0.SelfAttention.relative_attention_bias"],
  ["ffn_up", "layer.1.DenseReluDense.wi_1"], ["ffn_down", "layer.1.DenseReluDense.wo"], ["ffn_gate", "layer.1.DenseReluDense.wi_0"],
  ["ffn_norm", "layer.1.layer_norm"]
];
const llamaKeys = [
  ["blk.", "model.layers."], ["attn_norm", "input_layernorm"], ["attn_q_norm.", "self_attn.q_norm."], ["attn_k_norm.", "self_attn.k_norm."],
  ["attn_v_norm.", "self_attn.v_norm."], ["attn_q", "self_attn.q_proj"], ["attn_k", "self_attn.k_proj"], ["attn_v", "self_attn.v_proj"],
  ["attn_output", "self_attn.o_proj"], ["ffn_up", "mlp.up_proj"], ["ffn_down", "mlp.down_proj"], ["ffn_gate", "mlp.gate_proj"],
  ["ffn_norm", "post_attention_layernorm"], ["token_embd", "model.embed_tokens"], ["output_norm", "model.norm"], ["output.weight", "lm_head.weight"]
];
const gemma3Keys = [
  ...llamaKeys.map(([from, to]) => [from, from === "ffn_norm" ? "pre_feedforward_layernorm" : to]),
  ["post_ffw_norm", "post_feedforward_layernorm"], ["post_attention_norm", "post_attention_layernorm"]
];
// loader.py TXT_ARCH_LIST: what CLIPLoaderGGUF accepts, and how it renames each.
export const ggufTextArchitectures = { t5: t5Keys, t5encoder: t5Keys, llama: llamaKeys, qwen2vl: llamaKeys, qwen3: llamaKeys, qwen3vl: llamaKeys, gemma3: gemma3Keys };

function textEncoderKeys(arch, tensors) {
  const map = ggufTextArchitectures[arch];
  if (!map) return tensors;
  return tensors.map(([name, info]) => [map.reduce((key, [from, to]) => key.replaceAll(from, to), name), info]);
}

/* ------------------------------------------------------------ Model lists */

/**
 * GGUF diffusion models ComfyUI can load through ComfyUI-GGUF. Without the
 * pack ComfyUI lists none of them, so a local ComfyUI's model folders are
 * searched instead: those files show up needing the pack, not missing.
 */
export function ggufModelNames(info) {
  if (hasNode(info, "UnetLoaderGGUF")) return optionsFor(info, "UnetLoaderGGUF", "unet_name").filter(isGguf);
  const found = new Set();
  const walk = (dir, prefix, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const name = prefix ? path.join(prefix, entry.name) : entry.name;
      if (entry.isDirectory() && depth < 3 && !entry.name.startsWith(".")) walk(path.join(dir, entry.name), name, depth + 1);
      else if (entry.isFile() && isGguf(entry.name)) found.add(name);
    }
  };
  for (const dir of modelFolders("diffusion_models", ["diffusion_models", "unet"])) walk(dir, "", 0);
  return [...found].sort();
}

/** GGUF text encoders CLIPLoaderGGUF lists (it lists the safetensors ones too; CLIPLoader has those). */
export function ggufEncoderNames(info) {
  return optionsFor(info, "CLIPLoaderGGUF", "clip_name").filter(isGguf);
}

/* ------------------------------------------------------------ Graph */

// Each core loader's ComfyUI-GGUF twin and the inputs the twin does not take.
export const ggufLoaders = {
  UNETLoader: { node: "UnetLoaderGGUF", files: ["unet_name"], drop: ["weight_dtype"] },
  CLIPLoader: { node: "CLIPLoaderGGUF", files: ["clip_name"], drop: ["device"] },
  DualCLIPLoader: { node: "DualCLIPLoaderGGUF", files: ["clip_name1", "clip_name2"], drop: ["device"] },
  TripleCLIPLoader: { node: "TripleCLIPLoaderGGUF", files: ["clip_name1", "clip_name2", "clip_name3"], drop: [] },
  QuadrupleCLIPLoader: { node: "QuadrupleCLIPLoaderGGUF", files: ["clip_name1", "clip_name2", "clip_name3", "clip_name4"], drop: [] }
};

/**
 * Swaps every core loader that was handed a .gguf file for its ComfyUI-GGUF
 * twin (whose CLIP loaders also read safetensors, so mixed slots work). Other
 * nodes are left as they are.
 */
export function withGgufLoaders(graph) {
  for (const node of Object.values(graph || {})) {
    const twin = ggufLoaders[node?.class_type];
    if (!twin || !twin.files.some((key) => isGguf(node.inputs?.[key]))) continue;
    node.class_type = twin.node;
    for (const key of twin.drop) delete node.inputs[key];
  }
  return graph;
}

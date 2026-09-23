import fs from "node:fs";
import path from "node:path";
import { modelFolders } from './comfy.js';
import { readSafetensorsHeader } from './model-families.js';

/**
 * Text encoders and VAEs, recognised the way ComfyUI recognises them: by tensor
 * names and shapes in the safetensors header (comfy/sd.py detect_te_model and
 * VAE.__init__). A remote ComfyUI only gives us file names, so each kind also
 * carries a filename pattern as the fallback.
 */

/* ------------------------------------------------------------ Kinds */

// Text encoder kinds. `name` is the filename fallback; order matters where
// patterns overlap (Qwen3-VL before Qwen3, UMT5 before T5).
export const encoderKinds = {
  clip_l: { label: "CLIP-L", name: /clip[-_ ]?l(?![a-z])|clip_l|vit[-_]?l/i },
  clip_g: { label: "CLIP-G", name: /clip[-_ ]?g(?![a-z])|clip_g|bigg/i },
  clip_h: { label: "CLIP-H", name: /clip[-_ ]?h(?![a-z])|vit[-_]?h/i },
  umt5xxl: { label: "UMT5-XXL", name: /umt5/i },
  t5xl: { label: "T5-XL (Pile)", name: /t5[-_ ]?xl(?!l)|pile[-_ ]?t5|pony[-_ ]?v7.*t5/i },
  t5xxl: { label: "T5-XXL", name: /t5[-_ ]?(v1_1[-_ ]?)?xxl|t5xxl/i },
  byt5_glyph: { label: "ByT5 Glyph", name: /byt5/i },
  qwen3vl_32b: { label: "Qwen3-VL 32B", name: /qwen[-_ ]?3[-_ ]?vl.*32b/i },
  qwen3vl_8b: { label: "Qwen3-VL 8B", name: /qwen[-_ ]?3[-_ ]?vl.*8b/i },
  qwen3vl_4b: { label: "Qwen3-VL 4B", name: /qwen[-_ ]?3[-_ ]?vl.*4b|qwen[-_ ]?3[-_ ]?vl(?!.*\d+b)/i },
  qwen25vl_7b: { label: "Qwen2.5-VL 7B", name: /qwen[-_ ]?2[._]?5[-_ ]?vl/i },
  qwen3_8b: { label: "Qwen3 8B", name: /qwen[-_ ]?3(?![-_ .]?vl)(?![-_ .]?5)[-_ .]*8b/i },
  qwen3_4b: { label: "Qwen3 4B", name: /qwen[-_ ]?3(?![-_ .]?vl)(?![-_ .]?5)[-_ .]*4b/i },
  qwen3_06b: { label: "Qwen3 0.6B", name: /qwen[-_ ]?3(?![-_ .]?vl)[-_ .]*0[._]?6b/i },
  mistral3_24b: { label: "Mistral 3 Small 24B", name: /mistral[-_ ]?3|mistral.*small|mistral.*24b/i },
  ministral3_3b: { label: "Ministral 3 3B", name: /ministral/i },
  gemma3_12b: { label: "Gemma 3 12B", name: /gemma[-_ ]?3.*12b/i },
  gemma2_2b: { label: "Gemma 2 2B", name: /gemma[-_ ]?2.*2b/i },
  llama31_8b: { label: "Llama 3.1 8B", name: /llama/i }
};

// VAE layouts are what the header can prove; `hint` is what only a name can add
// (an SD1.5 and an SDXL VAE, a Flux and an SD3 VAE, or a Wan 2.1 and a Qwen-Image
// VAE share their shapes exactly).
export const vaeKinds = {
  sd15: { label: "SD 1.5 VAE", layout: "kl4" },
  sdxl: { label: "SDXL VAE", layout: "kl4" },
  aura: { label: "Pony V7 VAE", layout: "kl4" },
  flux1: { label: "Flux VAE (ae)", layout: "kl16" },
  sd3: { label: "SD3 VAE", layout: "kl16" },
  flux2: { label: "Flux.2 VAE", layout: "flux2" },
  wan21: { label: "Wan 2.1 VAE", layout: "wan16" },
  qwen_image: { label: "Qwen-Image VAE", layout: "wan16" },
  // Not in this ComfyUI's detection yet, so its layout is unknown: trust the name.
  qwen_image_21: { label: "Qwen-Image 2.1 VAE", layout: "unknown" },
  wan22: { label: "Wan 2.2 VAE", layout: "wan48" },
  hunyuan15: { label: "HunyuanVideo 1.5 VAE", layout: "hv15" },
  hunyuan_video: { label: "HunyuanVideo VAE", layout: "hv1" },
  ltx_video: { label: "LTX video VAE", layout: "ltx" },
  h3_video: { label: "MiniMax H3 video VAE", layout: "h3v" },
  h3_audio: { label: "MiniMax H3 audio VAE", layout: "h3a" }
};

/* ------------------------------------------------------------ Headers */

function keySet(header) {
  return new Set(Object.keys(header || {}).filter((key) => key !== "__metadata__"));
}

function shape(header, key) {
  return Array.isArray(header?.[key]?.shape) ? header[key].shape : [];
}

/** comfy/sd.py detect_te_model, reduced to the kinds HEISS uses, plus UMT5. */
export function encoderKindFromHeader(header) {
  const keys = keySet(header);
  if (!keys.size) return "";
  if (keys.has("text_model.encoder.layers.30.mlp.fc1.weight")) return "clip_g";
  if (keys.has("text_model.encoder.layers.22.mlp.fc1.weight")) return "clip_h";
  if (keys.has("text_model.encoder.layers.0.mlp.fc1.weight")) return "clip_l";
  if (keys.has("encoder.block.23.layer.1.DenseReluDense.wi_1.weight")) {
    const width = shape(header, "encoder.block.23.layer.1.DenseReluDense.wi_1.weight")[0];
    if (width === 5120) return "t5xl";
    if (width !== 10240) return "other";
    // UMT5 keeps a relative position bias in every block and a 256k vocabulary.
    const umt5 = keys.has("encoder.block.1.layer.0.SelfAttention.relative_attention_bias.weight") || shape(header, "shared.weight")[0] > 200000;
    return umt5 ? "umt5xxl" : "t5xxl";
  }
  if (keys.has("encoder.block.0.layer.0.SelfAttention.k.weight")) {
    return shape(header, "encoder.block.0.layer.0.SelfAttention.k.weight")[0] === 384 ? "byt5_glyph" : "other";
  }
  if (keys.has("model.layers.0.post_feedforward_layernorm.weight")) {
    if (keys.has("model.layers.59.self_attn.q_norm.weight")) return "other";
    if (keys.has("model.layers.47.self_attn.q_norm.weight") && keys.has("model.layers.5.self_attn.v_proj.weight")) return "gemma3_12b";
    if (!keys.has("model.layers.0.self_attn.q_norm.weight")) return "gemma2_2b";
    return "other";
  }
  if (keys.has("model.layers.0.self_attn.k_proj.bias")) {
    return shape(header, "model.layers.0.self_attn.k_proj.bias")[0] === 512 ? "qwen25vl_7b" : "other";
  }
  if (keys.has("model.visual.deepstack_merger_list.0.norm.weight")) {
    return shape(header, "model.visual.merger.linear_fc2.weight")[0] === 2560 ? "qwen3vl_4b" : "qwen3vl_8b";
  }
  if (keys.has("visual.deepstack_merger_list.0.norm.weight") && keys.has("model.layers.49.self_attn.q_proj.weight")) return "qwen3vl_32b";
  if (keys.has("model.layers.0.post_attention_layernorm.weight")) {
    const width = shape(header, "model.layers.0.post_attention_layernorm.weight")[0];
    if (keys.has("model.layers.0.self_attn.q_norm.weight")) {
      return { 2560: "qwen3_4b", 4096: "qwen3_8b", 1024: "qwen3_06b" }[width] || "other";
    }
    if (width === 5120) return "mistral3_24b";
    if (width === 3072) return "ministral3_3b";
    return "llama31_8b";
  }
  return "other";
}

/** comfy/sd.py VAE.__init__, reduced to a layout plus whatever the shapes pin down. */
export function vaeLayoutFromHeader(header) {
  const keys = keySet(header);
  if (!keys.size) return "";
  if (keys.has("decoder.middle.0.residual.0.gamma")) {
    return keys.has("decoder.upsamples.0.upsamples.0.residual.2.weight") ? "wan48" : "wan16";
  }
  if (keys.has("decoder.transformer_blocks.0.scale1") && keys.has("encoder.down.5.block.0.conv1.weight")) return "h3v";
  if (keys.has("pre_block.attn.zero_k_bias")) return "h3a";
  if (keys.has("decoder.up_blocks.0.res_blocks.0.conv1.conv.weight")) return "ltx";
  if (keys.has("decoder.conv_in.conv.weight")) {
    return shape(header, "decoder.conv_in.conv.weight")[1] === 32 ? "hv15" : "hv1";
  }
  const convIn = keys.has("decoder.conv_in.weight") ? "decoder.conv_in.weight" : "";
  if (convIn) {
    const channels = shape(header, convIn)[1];
    if (channels === 32 && keys.has("bn.running_mean")) return "flux2";
    if (channels === 4) return "kl4";
    if (channels === 16) return "kl16";
  }
  if (keys.has("taesd_decoder.1.weight") || keys.has("decoder.22.bias")) return "preview";
  return "other";
}

/* ------------------------------------------------------------ Files */

const headerCache = new Map();

function localFile(kind, subfolders, name) {
  if (!/\.safetensors$/i.test(name)) return "";
  const parts = String(name).split(/[\\/]/).filter(Boolean);
  if (parts.some((part) => part === "..")) return "";
  for (const dir of modelFolders(kind, subfolders)) {
    const file = path.join(dir, ...parts);
    try { if (fs.statSync(file).isFile()) return file; } catch { /* next folder */ }
  }
  return "";
}

function cachedHeader(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  const key = `${file}:${stat.size}:${stat.mtimeMs}`;
  if (!headerCache.has(key)) {
    let header = null;
    try { header = readSafetensorsHeader(file); } catch { header = null; }
    headerCache.set(key, header);
  }
  return headerCache.get(key);
}

export function isAbliterated(name = "") {
  return /abliterat|uncensor|heretic/i.test(String(name));
}

function encoderKindFromName(name = "") {
  const base = String(name).split(/[\\/]/).pop() || "";
  for (const [kind, spec] of Object.entries(encoderKinds)) {
    if (spec.name.test(base)) return kind;
  }
  return "";
}

/** What one text encoder file is, and how sure we are ("file" beats "name"). */
export function classifyEncoder(name) {
  const file = localFile("text_encoders", ["text_encoders", "clip"], name);
  const header = file ? cachedHeader(file) : null;
  const fromHeader = header ? encoderKindFromHeader(header) : "";
  if (fromHeader && fromHeader !== "other") return { name, kind: fromHeader, via: "file" };
  const fromName = encoderKindFromName(name);
  if (fromName) return { name, kind: fromName, via: "name" };
  return { name, kind: fromHeader === "other" ? "other" : "", via: fromHeader ? "file" : "" };
}

const vaeNameHints = [
  ["qwen_image_21", /qwen[-_ ]?image[-_ ]?2[._]?1/i],
  ["qwen_image", /qwen/i],
  ["wan22", /wan[-_ ]?2[._]?2/i],
  ["wan21", /wan/i],
  ["flux2", /flux[-_ ]?2|full_encoder_small_decoder/i],
  ["sd3", /sd[-_ ]?3/i],
  ["flux1", /\bae\b|^ae[._]|flux|lumina|z[-_ ]?image|chroma|hidream/i],
  ["aura", /pony[-_ ]?v7|aura/i],
  ["sdxl", /xl/i],
  ["hunyuan15", /hunyuan[-_ ]?video[-_ ]?1[._]?5|hunyuanvideo15/i],
  ["hunyuan_video", /hunyuan/i],
  ["h3_audio", /h3.*audio/i],
  ["h3_video", /h3/i],
  ["ltx_video", /ltx/i],
  ["sd15", /sd[-_ ]?1|vae[-_]ft|mse|ema/i]
];

function vaeKindsForLayout(layout) {
  return Object.entries(vaeKinds).filter(([, spec]) => spec.layout === layout).map(([kind]) => kind);
}

/**
 * What one VAE file is. With a header we know its layout and only let the name
 * choose within it; without one the name decides alone.
 */
export function classifyVae(name) {
  const base = String(name).split(/[\\/]/).pop() || "";
  const file = localFile("vae", ["vae"], name);
  const header = file ? cachedHeader(file) : null;
  const layout = header ? vaeLayoutFromHeader(header) : "";
  const hinted = vaeNameHints.filter(([, pattern]) => pattern.test(base)).map(([kind]) => kind);
  if (layout && layout !== "other" && layout !== "preview") {
    const within = vaeKindsForLayout(layout);
    const kind = hinted.find((hint) => within.includes(hint) || vaeKinds[hint].layout === "unknown") || "";
    // Shapes alone cannot split these pairs, so an unnamed file fits either.
    return { name, layout, kind, kinds: kind ? [kind] : within, via: "file" };
  }
  if (layout === "preview") return { name, layout, kind: "", kinds: [], via: "file" };
  const kind = hinted[0] || "";
  return { name, layout: kind ? vaeKinds[kind].layout : "", kind, kinds: kind ? [kind] : [], via: kind ? "name" : "" };
}

/* ------------------------------------------------------------ Matching */

/**
 * Installed encoders that fit a slot, best first: abliterated files lead (the
 * user prefers them), then files whose name the family prefers, then the order
 * ComfyUI lists them in. Never "official first".
 */
export function rankEncoders(encoders, slot) {
  const kinds = new Set(slot.kinds);
  return encoders
    .map((item, index) => ({ ...item, index }))
    .filter((item) => kinds.has(item.kind))
    .sort((a, b) => (isAbliterated(b.name) - isAbliterated(a.name))
      || (Number(Boolean(slot.prefer?.test(b.name))) - Number(Boolean(slot.prefer?.test(a.name))))
      || (Number(Boolean(slot.avoid?.test(a.name))) - Number(Boolean(slot.avoid?.test(b.name))))
      || (a.index - b.index))
    .map((item) => item.name);
}

/** VAEs that fit, best first: an exact kind before a same-shaped unnamed one. */
export function rankVaes(vaes, want) {
  const wanted = new Set(want);
  return vaes
    .map((item, index) => ({ ...item, index }))
    .filter((item) => item.kinds.some((kind) => wanted.has(kind)))
    .sort((a, b) => (Number(wanted.has(b.kind)) - Number(wanted.has(a.kind))) || (a.index - b.index))
    .map((item) => item.name);
}

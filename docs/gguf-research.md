# GGUF model support: research and plan

Research date: 2026-09-28. Local reference: ComfyUI v0.34.1 (2026-08-26) at
`~/ComfyUI-Installs/Comfy/ComfyUI`, which does not have ComfyUI-GGUF installed.
Upstream sources were read through the GitHub API and the Hugging Face API.

## Summary

- ComfyUI still cannot load GGUF by itself. All GGUF loading goes through
  [city96/ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) (Apache-2.0).
  Its last commit was on 2026-01-12 (registry 1.1.10). Support for the 2026
  architectures sits in unmerged PRs.
- GGUF files made for ComfyUI keep ComfyUI's original tensor names. HEISS's
  existing detectors (`familyFromHeader`, `encoderKindFromHeader`) therefore
  work on GGUF unchanged, as long as the header is read into the same shape as a
  safetensors header. I checked this against real headers from 22 published
  files (table below): every file was detected correctly.
- The graph change is mechanical: each core loader has a GGUF twin that takes
  the same inputs minus one (`weight_dtype` or `device`).
- **Implemented** in this branch: one new module (`server/gguf.js`), a node-pack
  entry, and small edits in five files. Details under "Implementation".

## 1. ComfyUI-GGUF today

**Nodes** ([nodes.py](https://github.com/city96/ComfyUI-GGUF/blob/main/nodes.py)):

| Node | Required inputs | Differs from core |
| --- | --- | --- |
| `UnetLoaderGGUF` | `unet_name` (list of `unet_gguf` files, `.gguf` only) | no `weight_dtype` |
| `UnetLoaderGGUFAdvanced` | `unet_name`, `dequant_dtype`, `patch_dtype` (default/target/float32/float16/bfloat16), `patch_on_device` (BOOLEAN) | tuning only |
| `CLIPLoaderGGUF` | `clip_name`, `type` (copied from core `CLIPLoader`) | no `device` |
| `DualCLIPLoaderGGUF` | `clip_name1`, `clip_name2`, `type` (copied from core `DualCLIPLoader`) | no `device` |
| `TripleCLIPLoaderGGUF` | `clip_name1..3` | none (type fixed to sd3) |
| `QuadrupleCLIPLoaderGGUF` | `clip_name1..4` | none |

- **Folder kinds.** At import time the pack sets `unet_gguf` to the
  `diffusion_models` folders (`{".gguf"}` only) and `clip_gguf` to the
  `text_encoders` folders. Whatever `extra_model_paths.yaml` gave those kinds is
  replaced; `server/model-folders.js` already handles this.
- **What the loaders list.** `UnetLoaderGGUF` lists only `.gguf` files. Core
  `UNETLoader` never lists `.gguf` because `supported_pt_extensions` leaves it
  out, so the two lists never overlap. The CLIP loaders list `clip` and
  `clip_gguf` files together, so they read safetensors and GGUF alike, and mixed
  slots work. There is one exception: scaled-fp8 safetensors raise
  `NotImplementedError`.
- **`/object_info`.** The shape is standard: `input.required.unet_name[0]` is
  the file list, and `clip_name[0]` likewise.
- **Image architectures it loads.** Set by `IMG_ARCH_LIST` in
  [loader.py](https://github.com/city96/ComfyUI-GGUF/blob/main/loader.py):
  `flux, sd1, sdxl, sd3, aura, hidream, cosmos, ltxv, hyvid, wan, lumina2, qwen_image`.
  - A file with no `general.architecture` (stable-diffusion.cpp exports) loads
    in "compat mode". The key sets in
    [tools/convert.py](https://github.com/city96/ComfyUI-GGUF/blob/main/tools/convert.py)
    `detect_arch` then decide.
  - ComfyUI itself works out the real model from the keys, so `flux` covers
    Flux.1 (dev, schnell, Krea-dev, Kontext), Flux.2 dev and Klein, and Chroma.
    `lumina2` covers Z-Image, and `hyvid` covers HunyuanVideo 1.5.
- **Text architectures it loads.** Set by `TXT_ARCH_LIST`:
  `t5, t5encoder, llama, qwen2vl, qwen3, qwen3vl, gemma3`. Names are mapped from
  llama.cpp's scheme back to the originals (`T5_SD_MAP`, `LLAMA_SD_MAP`,
  `GEMMA3_SD_MAP`), and the tokenizer is rebuilt from the GGUF metadata.
  - `qwen2vl` looks for a matching `*mmproj*.gguf` next to the file for the
    vision tower. Without one, Qwen-Image-Edit breaks.
- **Not in main.** These have open PRs or issues but no merge:
  - Krea 2 ([#464](https://github.com/city96/ComfyUI-GGUF/issues/464)): its
    files declare arch `krea2`, which main rejects.
  - Ideogram 4 ([#455](https://github.com/city96/ComfyUI-GGUF/pull/455), [#460](https://github.com/city96/ComfyUI-GGUF/pull/460)).
  - MiniMax H3 ([#476](https://github.com/city96/ComfyUI-GGUF/pull/476), [#480](https://github.com/city96/ComfyUI-GGUF/pull/480), [#481](https://github.com/city96/ComfyUI-GGUF/pull/481)).
  - Qwen-Image 2.1 ([#483](https://github.com/city96/ComfyUI-GGUF/pull/483), [#485](https://github.com/city96/ComfyUI-GGUF/pull/485)).
  - LTX 2.5 BF16 parameters ([#477](https://github.com/city96/ComfyUI-GGUF/issues/477)).
  - Qwen3-VL vision towers ([#478](https://github.com/city96/ComfyUI-GGUF/pull/478)). Without it a Qwen3-VL GGUF loads as plain Qwen3, so Krea 2 and Qwen-Image 2.1 get the wrong encoder.
  - Ministral 3 (mistral3) and Gemma 4.
  The m8rr fork's [Dynamic-VRAM branch](https://github.com/m8rr/ComfyUI-GGUF/tree/Dynamic-VRAM) carries several of these.
- **Maintenance.**
  - Last commit 2026-01-12 ([commits](https://github.com/city96/ComfyUI-GGUF/commits/main)).
  - About 247 open issues and PRs, 4.1k stars, and 2.6M registry downloads ([api.comfy.org/nodes/ComfyUI-GGUF](https://api.comfy.org/nodes/ComfyUI-GGUF)).
  - Comfy's own developer opened a PR to make it work with core's dynamic VRAM
    ([#427](https://github.com/city96/ComfyUI-GGUF/pull/427), still open).
- **Core ComfyUI.** Upstream `main` on 2026-09-27 has no GGUF loader.
  `folder_paths.supported_pt_extensions` has no `.gguf`, and
  [PR #10024](https://github.com/Comfy-Org/ComfyUI/pull/10024) "Add GGUF to
  supported_pt_extensions" has been open since 2025-09.
  - Core leans away from GGUF. When `--disable-dynamic-vram` is set,
    [main.py](https://github.com/Comfy-Org/ComfyUI/blob/master/main.py) warns:
    "If you use gguf we recommend keeping dynamic vram enabled and using native
    ComfyUI model formats instead" (fp8, int8, w4a8).
  - The community disagrees on quality and on low-RAM machines
    ([#463](https://github.com/city96/ComfyUI-GGUF/issues/463)).
  - GGUF text encoders are still the practical option for small VRAM.
- **Other known issues.**
  - LoRA support is "experimental" (README).
  - macOS/MPS needed specific torch versions in the past ([#107](https://github.com/city96/ComfyUI-GGUF/issues/107)).
  - Reading the tokenizer arrays is slow for large vocabularies: about 20 s for Gemma, per #463.

## 2. The GGUF file format

The spec is [ggml/docs/gguf.md](https://github.com/ggml-org/ggml/blob/master/docs/gguf.md).
All values are little-endian, and v2 and v3 share the same layout:

```
"GGUF" | u32 version | u64 tensor_count | u64 kv_count
kv_count x  { string key | u32 type | value }        string = u64 len + UTF-8
tensor_count x { string name | u32 n_dims | u64 dims[n_dims] | u32 ggml_type | u64 offset }
(padding to general.alignment, default 32) | tensor data
```

- **Value types.** 0 u8, 1 i8, 2 u16, 3 i16, 4 u32, 5 i32, 6 f32, 7 bool,
  8 string, 9 array (`u32 item_type, u64 count, items`), 10 u64, 11 i64,
  12 f64.
- **Dimensions** are stored innermost first, so PyTorch order is `dims.reverse()`.
  Dims are logical element counts whatever the quant type. Q4_K and similar
  change only the byte packing.
- **Flattened tensors.** ComfyUI-GGUF's converter reshapes some SD1/SDXL tensors
  to `(n/256, 256)` and records the original shape in
  `comfy.gguf.orig_shape.<name>` (an INT32 array). Wan and HunyuanVideo 5D
  `patch_embedding` tensors are appended with 5 dims by `fix_5d_tensors.py`.
- **Architecture metadata.** `general.architecture` is `flux`, `wan`, `t5encoder`,
  `qwen3` and so on. `general.file_type` is the llama.cpp file type (14 =
  Q4_K_S, 15 = Q4_K_M), and `<arch>.embedding_length` and `<arch>.block_count`
  are set on LLM encoders. Unsloth and stable-diffusion.cpp diffusion exports
  often carry **no metadata at all** and keep a `model.diffusion_model.` prefix.
  HEISS's `diffusionKeys()` already strips that prefix.
- **Key names.** Diffusion GGUFs use ComfyUI's original key names: `convert.py`
  writes `new_name = key`. Text encoder GGUFs from llama.cpp use its names
  (`blk.N.attn_q`, `enc.blk.N.ffn_up`, `token_embd`); ComfyUI-GGUF maps them
  back before detection.
- **Header size.** Diffusion model headers stay well under 1 MB.
  LLM encoders carry their vocabulary in the header: 150k to 262k token strings
  plus scores, which is 5 to 10 MB. Reading one in Node takes about 110 ms once
  (then cached by size and mtime). Arrays longer than 16 items are skipped
  without being materialised.

**Verification.** I fetched the first 4 to 24 MB of each file with an HTTP
Range request and read it with `readGgufHeader`. The results went through
HEISS's unchanged detectors:

| File | general.architecture | HEISS detection |
| --- | --- | --- |
| city96 flux1-dev-Q4_K_S | flux | flux1 (dev) |
| city96 flux2-dev-Q4_K_M | flux | flux2_dev |
| unsloth flux-2-klein-9b-Q4_K_M | flux | flux2_klein_9b |
| silveroxides Chroma1-HD-Q4_K_M | flux | chroma |
| unsloth z-image-turbo-Q4_K_M | lumina2 | zimage |
| leejet z_image_turbo-Q4_0 (sd.cpp) | (none) | zimage |
| city96 qwen-image-Q4_K_M | qwen_image | qwen_image |
| unsloth qwen-image-2.1-Q4_K_M | (none, prefixed) | qwen_image_21 |
| realrebelai Krea-2-Turbo-Q4_K_M | krea2 | krea2 |
| molbal ideogram4-transformer-q8_0 | (none) | ideogram4 |
| unsloth minimax_h3_fl2va_pruned-Q6_K | (none) | minimax_h3 |
| QuantStack Wan2.2-TI2V-5B-Q4_K_M | wan | wan22_5b (5D patch_embedding read correctly) |
| QuantStack Wan2.2-T2V-A14B-HighNoise-Q4_K_M | wan | wan21, then wan22_14b by name |
| jayn7 hunyuanvideo1.5_720p_t2v-Q4_K_M | hyvid | hunyuan15 |
| QuantStack LTX-2.3-dev-Q4_K_M | ltxv | ltx |
| city96 sd3.5_large-Q4_0 | sd3 | sd3 |
| city96 t5-v1_1-xxl-encoder-Q4_K_M | t5encoder | encoder t5xxl |
| city96 umt5-xxl-encoder-Q4_K_M | t5encoder | encoder umt5xxl |
| unsloth Qwen2.5-VL-7B-Instruct-Q4_K_M | qwen2vl | encoder qwen25vl_7b |
| unsloth Qwen3-4B-Q4_K_M | qwen3 | encoder qwen3_4b |
| unsloth gemma-3-12b-it-Q4_K_M | gemma3 | encoder gemma3_12b |
| unsloth Qwen3-VL-4B-Instruct-Q4_K_M | qwen3vl | encoder qwen3_4b (matches what ComfyUI-GGUF main hands ComfyUI, see #478) |

HEISS recognises Krea 2, Ideogram 4, MiniMax H3 and Qwen-Image 2.1 GGUFs
correctly, but ComfyUI-GGUF main would refuse them at run time (section 1).

## 3. Text encoders as GGUF

`CLIPLoaderGGUF` calls `gguf_clip_loader`. It renames the tensors, rebuilds the
tokenizer where ComfyUI needs one (T5/UMT5 sentencepiece, Mistral tekken, Gemma
3 spm), dequantizes the token embedding to avoid OOM, and then calls ComfyUI's
own `load_text_encoder_state_dicts`. ComfyUI's `detect_te_model` therefore sees
original key names. HEISS does the same: `readGgufHeader` applies the same
ordered replacements for the architectures in `TXT_ARCH_LIST`, and
`encoderKindFromHeader` runs unchanged.

| GGUF arch | HEISS kind |
| --- | --- |
| t5, t5encoder | t5xxl, or umt5xxl when the vocabulary is 256k or there is a per-block relative bias |
| qwen2vl | qwen25vl_7b (the `k_proj.bias` width is 512) |
| qwen3 | qwen3_4b, qwen3_8b or qwen3_06b by width |
| qwen3vl | qwen3_* (the vision tower is in a separate mmproj that main does not load; honest until #478 or #485 lands) |
| gemma3 | gemma3_12b |
| llama | llama31_8b, or mistral3_24b at width 5120 |

## 4. Graph changes

| Core node | GGUF twin | Drop |
| --- | --- | --- |
| UNETLoader | UnetLoaderGGUF | `weight_dtype` |
| CLIPLoader | CLIPLoaderGGUF | `device` |
| DualCLIPLoader | DualCLIPLoaderGGUF | `device` |
| TripleCLIPLoader | TripleCLIPLoaderGGUF | (none) |
| QuadrupleCLIPLoader | QuadrupleCLIPLoaderGGUF | (none) |

- The swap applies whenever any file input of the node is a `.gguf`. The CLIP
  twins read safetensors too, so a mixed Flux pair (CLIP-L safetensors plus T5
  GGUF) becomes one `DualCLIPLoaderGGUF`.
- Nothing downstream changes: LoRAs, ModelSampling patches and samplers are
  untouched.
- Wan 2.2's low-noise partner goes through the same swap.
- There are no GGUF checkpoints: GGUF is diffusion model or encoder only.

## 5. The node pack

| Field | Value |
| --- | --- |
| Repository | `https://github.com/city96/ComfyUI-GGUF.git` |
| Folder | `ComfyUI-GGUF` |
| ComfyUI-Manager id | `comfyui-gguf` (from [custom-node-list.json](https://github.com/Comfy-Org/ComfyUI-Manager/blob/main/custom-node-list.json)) |
| Registry id | `ComfyUI-GGUF` |
| Requirements | `gguf>=0.13.0`; `sentencepiece` and `protobuf` are needed for GGUF text encoders |

- Both install routes work with the existing `pack-installer.js`: Manager
  queue, or a local clone plus pip with ComfyUI's Python.
- Installing needs a ComfyUI restart. Until then the `.gguf` files are
  invisible to `/object_info` (core loaders do not list them). HEISS therefore
  lists local `.gguf` diffusion models from disk and marks them "Needs
  ComfyUI-GGUF nodes", with the Install button.
- A remote ComfyUI without the pack shows nothing, since there is no way to
  see its files.

## 6. Where GGUFs come from, with typical sizes

Sizes in GB, from the Hugging Face API:

| Family | Repo | Q4_K_M | Q5_K_M | Q8_0 |
| --- | --- | --- | --- | --- |
| Flux.1 dev | [city96/FLUX.1-dev-gguf](https://huggingface.co/city96/FLUX.1-dev-gguf) | 6.8 (Q4_K_S) | n/a | 12.7 |
| Flux.2 dev | [city96/FLUX.2-dev-gguf](https://huggingface.co/city96/FLUX.2-dev-gguf) | 20.1 | 24.1 | 35.0 |
| Flux.2 Klein 9B | [unsloth/FLUX.2-klein-9B-GGUF](https://huggingface.co/unsloth/FLUX.2-klein-9B-GGUF) | 5.9 | 7.0 | 10.0 |
| Qwen-Image | [city96/Qwen-Image-gguf](https://huggingface.co/city96/Qwen-Image-gguf) | 13.1 | 14.9 | 21.8 |
| Qwen-Image 2.1 | [unsloth/Qwen-Image-2.1-GGUF](https://huggingface.co/unsloth/Qwen-Image-2.1-GGUF) | 4.2 | 5.4 | 7.6 |
| Z-Image Turbo | [unsloth/Z-Image-Turbo-GGUF](https://huggingface.co/unsloth/Z-Image-Turbo-GGUF) | 5.0 | 5.6 | 7.2 |
| Krea 2 Turbo | [realrebelai/KREA-2_GGUFs](https://huggingface.co/realrebelai/KREA-2_GGUFs) | 7.2 | n/a | 13.6 |
| Chroma1-HD | [silveroxides/Chroma1-HD-GGUF](https://huggingface.co/silveroxides/Chroma1-HD-GGUF) | 5.6 | 6.7 | 9.7 |
| Wan 2.2 T2V A14B (each half) | [QuantStack/Wan2.2-T2V-A14B-GGUF](https://huggingface.co/QuantStack/Wan2.2-T2V-A14B-GGUF) | 9.7 | 10.8 | 15.4 |
| Wan 2.2 TI2V 5B | [QuantStack/Wan2.2-TI2V-5B-GGUF](https://huggingface.co/QuantStack/Wan2.2-TI2V-5B-GGUF) | 3.4 | 3.8 | 5.4 |
| HunyuanVideo 1.5 720p | [jayn7/HunyuanVideo-1.5_T2V_720p-GGUF](https://huggingface.co/jayn7/HunyuanVideo-1.5_T2V_720p-GGUF) | 5.1 | 6.1 | 9.0 |
| LTX-2.3 dev | [QuantStack/LTX-2.3-GGUF](https://huggingface.co/QuantStack/LTX-2.3-GGUF) | 17.8 | 19.4 | 25.5 |
| MiniMax H3 | [unsloth/MiniMax-H3-GGUF](https://huggingface.co/unsloth/MiniMax-H3-GGUF) | n/a | n/a | 21.4 (Q6_K 16.6) |
| Ideogram 4 | [molbal/ideogram-4-gguf](https://huggingface.co/molbal/ideogram-4-gguf) | n/a | n/a | 10.1 |
| T5-XXL encoder | [city96/t5-v1_1-xxl-encoder-gguf](https://huggingface.co/city96/t5-v1_1-xxl-encoder-gguf) | 2.9 | 3.4 | 5.1 |
| UMT5-XXL encoder | [city96/umt5-xxl-encoder-gguf](https://huggingface.co/city96/umt5-xxl-encoder-gguf) | 3.7 | 4.2 | 6.0 |
| Qwen2.5-VL 7B | [unsloth/Qwen2.5-VL-7B-Instruct-GGUF](https://huggingface.co/unsloth/Qwen2.5-VL-7B-Instruct-GGUF) (abliterated: [mradermacher](https://huggingface.co/mradermacher/Qwen2.5-VL-7B-Instruct-abliterated-GGUF)) | 4.7 | 5.4 | 8.1 |
| Qwen3 4B | [unsloth/Qwen3-4B-GGUF](https://huggingface.co/unsloth/Qwen3-4B-GGUF) | 2.5 | 2.9 | 4.3 |

- As a rule of thumb, Q8_0 is about 53% of BF16, Q5_K_M about 36% and Q4_K_M
  about 30%.
- Community practice treats Q8_0 as close to lossless, Q5_K_M/Q6_K as the
  quality sweet spot, and Q4_K_M as the smallest broadly acceptable quant.
- The big uploaders are city96, QuantStack (Wan, Qwen-Image-Edit, LTX, Flux
  Kontext/Krea), unsloth (Flux.2, Z-Image, Qwen-Image 2.1, H3), jayn7
  (HunyuanVideo 1.5), and leejet (stable-diffusion.cpp exports with no
  metadata).
- Many 2026 uploads target stable-diffusion.cpp or Unsloth Desktop rather than
  ComfyUI-GGUF, so a download offer should only list families the pack can
  load.

## 7. Implementation (this branch) and next steps

**Done.** About 225 lines plus tests:

- `server/gguf.js` (new):
  - `readGgufHeader`: a chunked v2/v3 reader. It returns a safetensors-style
    header with PyTorch shapes, `orig_shape`, quant dtypes, scalar metadata and
    text encoder renames.
  - `ggufModelNames(info)`: `UnetLoaderGGUF`'s options, or, without the pack,
    `.gguf` files found in the local `diffusion_models`/`unet` folders.
  - `ggufEncoderNames(info)`.
  - The `ggufLoaders` table and `withGgufLoaders(graph)`.
- `server/model-families.js`, `server/model-components.js`: local headers are
  read for `.gguf` too (dispatch on the extension).
- `server/family-profiles.js`: GGUF models and encoders join the lists. A
  `.gguf` model lists `missingPackPart(info, "gguf")` when the pack is absent,
  and the `weightDtype` control is hidden for GGUF.
- `server/graphs.js`: `withGgufLoaders(familyGraph(...))`.
  `family-graph.js` itself is untouched.
- `server/node-packs.js`: the `gguf` entry. `server/models.js`: `.gguf` is
  stripped from display names.
- `server/gguf.test.js`: reader, encoder renames, fallbacks, profile, graph
  swap, and the pack-missing listing, all on tiny synthetic GGUF files.

**Not verified end-to-end.** The local ComfyUI has no ComfyUI-GGUF, and
installing it there was out of scope. `docs/guides/MODELS.md` step 10 (queue once on
`/prompt`) is still open.

**Next steps, in order of value:**

1. **Know what the pack can load.** Mirror `IMG_ARCH_LIST` and `detect_arch`'s
   key sets as data. A Krea 2, Ideogram 4, MiniMax H3 or Qwen-Image 2.1 GGUF
   would then get a clear "ComfyUI-GGUF can't load this architecture yet"
   instead of a run-time error. This is left out on purpose so far: forks and
   future releases load more, and `/object_info` cannot tell which build is
   installed. Decide whether to block or only warn.
2. **"Download a smaller version".** Add GGUF entries to `modelDownloads` (and
   GGUF encoders to `encoderDownloads`) per family, prefer Q8_0 or Q5_K_M and
   show the size, and add the pack as a prerequisite of the download.
3. **Qwen2.5-VL GGUF for Qwen-Image-Edit.** Needs the matching `mmproj` file
   beside the encoder. Name it in the encoder's `missing` entry when it is
   absent.
4. **Remote ComfyUI.** `/view_metadata` reads safetensors only, so remote GGUFs
   are placed by filename only (`familyFromName` already ignores the
   extension).

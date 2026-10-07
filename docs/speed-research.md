# Speed research (2026-10-07)

This combines three research passes:
- **Runtime:** ComfyUI launch flags and libraries.
- **Sampling and models:** what goes into the graph or the model choice.
- **HEISS pipeline:** what HEISS itself does between Generate and the gallery.

Gains are what users and vendors report: signals, not lab results. Rapid itself is covered in docs/rapid.md.

## Ranked plan

| # | What | Layer | Expected gain | Effort | Where it applies |
|---|---|---|---|---|---|
| 1 | **Content-named resized references.** `server/reference-assets.js` uploads a resized reference under a new random name on every run when ComfyUI is local, which defeats ComfyUI's cache (verified). On Qwen-Image 2.1 edits the 7B encoder then runs again every time. | HEISS | 0.3–1 s per Klein edit, likely 5–10 s per Qwen 2.1 edit on 8 GB | S | Edit and img2img runs with auto-resize |
| 2 | **cu130 health check.** ComfyUI turns off comfy-kitchen's CUDA kernels when PyTorch is older than CUDA 13. `/system_stats` gives `pytorch_version`. Show a fix when it's older. | Setup | Reported 1.8–2.9× (5090, H3); also gates NVFP4 and int8 | S | NVIDIA |
| 3 | **"Fast" distill variants per family:** a LoRA plus preset steps, CFG and sampler, through the existing download machinery. Qwen Lightning 8-step, Flux.2 Dev Turbo, Krea 2 Turbo 4-step, Z-Image Fun-Distill, Chroma Flash, DMD2 (non-commercial licence), Wan lightx2v, HunyuanVideo 1.5 step-distill. Rapid off or reduced on these. | Catalog | 3–10× | M | Most families |
| 4 | **Late-step CFG cutoff guider** (`HeissScheduledCFG` in our node pack): real CFG for the first ~60% of steps, CFG 1 after. Stacks with Rapid. | Graph | ~1.2–1.5× on models that use real CFG | S | Raw/Base variants, SDXL, Chroma, Anima, Qwen base |
| 5 | **Flag linter on `/system_stats` `argv`.** Warn about:<br>• `--highvram` / `--gpu-only`: they disable dynamic VRAM<br>• `--lowvram`: does nothing now<br>• Sage + Qwen/Z-Image: black images<br>• `--fast` + Z-Image<br>• `--reserve-vram` (suggest `--vram-headroom`)<br>• models on an HDD | Setup | Avoids slowdowns and breakage | S | Everyone |
| 6 | **Precision-aware downloads per GPU:** NVFP4 on RTX 50, fp8 on 40-series, int8 ConvRot on 20/30-series, GGUF or fp16 on Mac, and on 8 GB a quant that fits fully | Catalog | ~1.5–2.5× on the matching card | M | Downloads |
| 7 | **EasyCache (core) as a generic switch** on runs of 12+ steps. It survives Rapid's size change by resetting. Benchmark it together with Rapid. | Graph | Est. 1.3–1.8× | S | Longer runs |
| 8 | **One-click Kitchen attention** (`--use-ck-attention`, or the core Model Attention Backend node per workflow). Sage-class speed without wheel trouble. | Setup/graph | ~20–35% where attention dominates | S–M | NVIDIA 20-series+ |
| 9 | **Mac profile:** `--use-pytorch-cross-attention`, `--fp16-unet` on M1–M3 (Qwen Edit M1 Max 3:59 → 2:33). Never fp8. | Setup | ~1.5× reported | S | Apple Silicon |
| 10 | **Faster result delivery:** shorter poll or SSE instead of the 1.6 s poll, async PNG metadata write, first thumbnail built at delivery | HEISS | ~1 s per run | S–M | Everyone |
| 11 | **Non-blocking ComfyUI info cache on Generate** (`server/index.js:110`) | HEISS | 0.2–3 s on the first click after idle | S | Everyone |
| 12 | **Smart upscale memory:** `cache_model` by VRAM tier, one upscale per batch of separate variants | HEISS | 1–3 s per run, fewer cold runs | S–M | Smart upscale |
| 13 | **Where to encode prompts:** learn per machine whether CPU or GPU encoding is faster (from cold/warm timings), or suggest an encoder quant that fits next to the model. Later: speculative encoding while the user types. | HEISS | Up to the 5–10 s cold penalty on 8 GB | M–L | Low VRAM |

## Not worth it (for now)

- **FlashAttention / xformers:** PyTorch SDPA already covers them.
- **torch.compile:** turns off dynamic VRAM and recompiles on prompt or LoRA changes.
- **TeaCache / First Block Cache:** superseded by EasyCache and CacheDiT.
- **TaylorSeer:** needs 2–6 GB of extra VRAM.
- **Token merging for SDXL:** DMD2 already gets SDXL to 4–8 steps.
- **MLX backends.**
- **Live preview:** costs nothing measurable (latent2rgb).
- **Calling `/free` between runs:** would make every run cold.

## Opt-in or docs only

- **CacheDiT** (third-party): Klein, Qwen, H3, Wan, LTX at 1.4–2×.
- **Nunchaku int4:** 30-series.
- **SageAttention:** power users; can cause black images on Qwen and Z-Image.
- **`--fast fp16_accumulation`:** 10–33% on 3090+, but can break Z-Image and Qwen.
- **`--disable-dynamic-vram`:** to test if models reload on every prompt (ComfyUI issue #14276).
- **Spectrum + SPEED** (sorryhyun): about 2× reported on Anima; a candidate for a future HeissRapid option.

## Sources

The three agent reports cite these. Key ones:
- [ComfyUI cli_args.py](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/cli_args.py), [changelog](https://docs.comfy.org/changelog), [comfy-kitchen](https://github.com/Comfy-Org/comfy-kitchen)
- [Dynamic VRAM discussion #12699](https://github.com/Comfy-Org/ComfyUI/discussions/12699), [ComfyUI #14276](https://github.com/Comfy-Org/ComfyUI/issues/14276), [Sage black images #9184](https://github.com/Comfy-Org/ComfyUI/issues/9184)
- [Precision comparison (Gözükara)](https://github.com/FurkanGozukara/Stable-Diffusion/wiki/BF16-vs-GGUF-FP8-Scaled-NVFP4-Speed-and-Quality-Compared-ComfyUI-CUDA-13-Gains-FLUX-2-Klein-9B), [NVIDIA NVFP4](https://blogs.nvidia.com/blog/rtx-ai-garage-nemotron-ltx-video-comfyui), [INT8 speed](https://github.com/BobJohnson24/ComfyUI-INT8-Fast/blob/main/Speed.md)
- [Mac BF16 slowdown](https://lilting.ch/en/articles/comfyui-qwen-mps-bf16-slowdown), [PR #14770](https://github.com/Comfy-Org/ComfyUI/pull/14770) (Mac text encoders on CPU)
- [Krea 2 4-step LoRA](https://huggingface.co/lvladikov/Krea2-Turbo-Distill-4step-LoRA), [Qwen Lightning](https://sbcode.net/genai/qwen-lighting-lora), [FLUX.2-dev-Turbo](https://huggingface.co/fal/FLUX.2-dev-Turbo), [Z-Image Fun-Distill](https://huggingface.co/alibaba-pai/Z-Image-Fun-Lora-Distill), [Wan lightx2v](https://huggingface.co/lightx2v/Wan2.2-Distill-Loras), [CacheDiT](https://github.com/Jasonzzt/ComfyUI-CacheDiT), [Spectrum](https://github.com/sorryhyun/ComfyUI-Spectrum-KSampler)

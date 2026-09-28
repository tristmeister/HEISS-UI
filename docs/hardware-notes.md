# Hardware notes

How HEISS UI reads the computer ComfyUI runs on, and the one number it makes
fit decisions with: the memory **budget**, in GB. The code is
`server/hardware.js`; `/api/hardware` returns it.

## Where the numbers come from

ComfyUI's `/system_stats` describes the machine ComfyUI runs on (which may not
be the one running HEISS UI). For its first device it reports `name`, `type`,
`vram_total` and `vram_free`; `system` adds `ram_total` and `ram_free`
([`server.py`](https://github.com/comfyanonymous/ComfyUI/blob/master/server.py),
`/system_stats`).

| GPU | What ComfyUI reports | HEISS budget |
| --- | --- | --- |
| NVIDIA | `type: "cuda"`, name like `cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync`, `vram_total` from `torch.cuda.mem_get_info` | `vram_total` |
| AMD (ROCm) | Also `type: "cuda"`; the name says `AMD Radeon …` | `vram_total` |
| Intel Arc | `type: "xpu"` | `vram_total` |
| Apple Silicon | `type: "mps"`, name `mps`, and **all of the unified memory** as VRAM | see below |
| DirectML | a placeholder 1 GB (`#TODO` in ComfyUI) | none |
| CPU | `type: "cpu"` | none |

Budgets count in binary gigabytes, the way graphics cards are sold (a "24 GB"
card reports 24 GiB). Download sizes stay decimal, like Finder and Explorer.

When ComfyUI does not answer but its address is on this computer, HEISS asks
the computer itself: an Apple Silicon Mac from `os.totalmem()` (which reads
`hw.memsize`), an NVIDIA card from `nvidia-smi`, otherwise only RAM is known
and no budget is given.

## Apple Silicon

- **ComfyUI on MPS reports the whole memory.** `get_total_memory()` and
  `get_free_memory()` return psutil's `virtual_memory().total` and
  `.available` for `mps` devices, the same as for the CPU
  (`comfy/model_management.py`). So `vram_total` on a 24 GB Mac is 24 GB.
- **The GPU gets part of it.** Metal's `recommendedMaxWorkingSetSize` is
  "an approximation of how much memory, in bytes, this GPU device can allocate
  without affecting its runtime performance"
  ([Apple](https://developer.apple.com/documentation/metal/mtldevice/recommendedmaxworkingsetsize)).
  Apple publishes no ratio. Measured: an M4 Pro with 24 GiB reports 19.07 GB
  (74%); reports elsewhere give about 75% on 128 GB and 78% on a 32 GB M2 Max
  ([llama.cpp #2182](https://github.com/ggml-org/llama.cpp/discussions/2182),
  [Apple forums](https://developer.apple.com/forums/thread/732035)). The often
  quoted "2/3 up to 36 GB, 3/4 above" comes from
  [one blog post](https://techobsessed.net/2023/12/increasing-ram-available-to-gpu-on-apple-silicon-macs-for-running-large-language-models/)
  and does not match these readings.
- **`sysctl iogpu.wired_limit_mb`** (macOS 14+; `debug.iogpu.wired_limit` in
  bytes before) sets how much the GPU may wire. `0` is the default split. It
  resets on reboot unless set in `/etc/sysctl.conf`, and raising it raises
  `recommendedMaxWorkingSetSize` too. MLX tells people to raise it for large
  models ([mlx-lm](https://pypi.org/project/mlx-lm/)).
- **PyTorch may go past Metal's number.** `PYTORCH_MPS_HIGH_WATERMARK_RATIO`
  (default 1.7) and `PYTORCH_MPS_LOW_WATERMARK_RATIO` (1.4 on unified memory)
  multiply `recommendedMaxWorkingSetSize`
  ([PyTorch](https://docs.pytorch.org/docs/stable/mps_environment_variables.html)).
  Past the recommended size it still runs, but macOS starts swapping.
- **fp8 files do not save memory on a Mac.** MPS cannot compute in float8
  (converting a `float8_e4m3fn` tensor on MPS fails, checked with PyTorch
  2.12), and ComfyUI's `unet_dtype()` loads fp8 weights as fp16/bf16 when they
  fit. An fp8 download is half the disk space, but it takes as much memory as
  the full-precision file once loaded.

**Policy.** On a Mac the budget is:

1. `iogpu.wired_limit_mb`, when someone set it (only read when ComfyUI runs on
   this Mac), capped at the memory itself;
2. otherwise **70% of the unified memory** (`APPLE_UNIFIED_SHARE`), a little
   under what Metal itself recommends, so macOS and the apps around keep room.

Starter models give an fp8 version a Mac-specific memory figure (the size of
its full-precision equivalent), so a Mac is never pointed at an fp8 file it
would have to expand anyway. Budgets are only ever used to highlight what fits;
nothing is hidden, blocked or warned about.

The Metal number itself is not readable from Node without native code, and
ComfyUI does not report `torch.mps.recommended_max_memory()`. If it ever does,
it should replace the 70% share.

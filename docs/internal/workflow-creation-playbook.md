# Personalized Workflow Creation Playbook

This playbook is for this specific HEISS UI + ComfyUI setup: local Windows PC, RTX 3070-class VRAM constraints, Z-Image-first image generation, HEISS UI as the simple front end, and ComfyUI as the graph engine.

## North Star

Build workflows that feel fast enough to explore with, pretty enough to keep using, and simple enough that HEISS UI can expose only the controls that matter.

The preferred workflow style is:

- prompt-first
- image-first
- Z-Image-first
- fast iteration over giant graph maximalism
- fixed graph polish for grain/sharpness
- LoRAs as optional creative seasoning, not a reason to make every run fragile

Avoid workflows that turn every image into a full production pipeline by default. Face detailers, video upscalers, and multi-stage repair graphs are allowed, but they should be separate "heavy" workflows, not the everyday preset.

## Current PC Bias

Treat the GPU as an 8 GB-class local card. The observed ComfyUI log showed partial loading/offloading, CUDA device pressure, BF16/FP16/FP8 model behavior, and low usable VRAM during Z-Image runs.

Practical implications:

- Prefer FP8 or otherwise memory-light model variants when quality is acceptable.
- Keep everyday image workflows around 8-12 sampling steps.
- Avoid default face detailer passes unless the image really needs it.
- Avoid SeedVR/video upscalers on the main generation path; they can run out of memory and take too long.
- Prefer one good latent resolution over generate-then-upscale when iterating.
- Use tiled VAE decode if VAE decode becomes the memory spike.
- Keep batch size at 1 unless intentionally testing throughput.
- If a graph uses custom cleanup or GPU cache nodes, make sure their required passthrough inputs are wired.

## Preferred Image Recipe

The current best local recipe is `Z Image Hyper Fast Sharp Grain` in:

`data/workflows/z-image-hyperfast-sharp-grain.json`

Shape:

- `CheckpointLoaderSimple`: `moodyPornMix_zitV6FP8.safetensors`
- `CLIPLoader`: `Z-Image_qwen_3_4b.safetensors`
- `VAELoader`: `ae.safetensors`
- `ModelSamplingAuraFlow`: shift `3`
- sampler: `KSampler`
- steps: `8`
- CFG: `1`
- sampler: `euler`
- scheduler: `beta`
- latent size: `896 x 1344`
- post polish: `FastLaplacianSharpen` then `FastFilmGrain`
- output prefix: `Z_Image_HyperFast_SharpGrain`

This is the daily-driver shape: it keeps the sharpness and grain you liked without the cost of FaceDetailer.

## Available Local Flows

### Z Image Hyper Fast Sharp Grain

Use for normal image generation.

Why it exists:

- Fast.
- Keeps a high-fidelity vertical output size.
- Includes the grain/sharpness look you liked from the bigger workflow.
- Has a disabled core `LoraLoader` node for compatibility with LoRA graph paths.

Known key nodes:

- `204`: prompt text
- `201`: width value
- `202`: height value
- `217`: seed
- `218`: sampler
- `230`: Z-Image model sampling
- `240`: positive text encode
- `215` + `224`: negative path via zeroed conditioning
- `241`: fast sharpen
- `242`: fast film grain
- `243`: LoRA support node

### Z Image 1

Use only as a simple fallback or reference.

It maps prompt, sampler, scheduler, CFG, steps, and seed, but its current `heissUi.controls` block does not expose width/height. That is exactly the kind of omission that makes the front end fall back to weird size choices.

If reviving it, map:

```json
"width": { "node": "7", "input": "width" },
"height": { "node": "7", "input": "height" }
```

### Face Detailer / Ultra Comprehensive Flow

Use as a parts bin, not as the default.

Keep from it:

- useful prompt structure
- grain/sharpen finishing
- good group organization
- LoRA loader patterns

Avoid by default:

- FaceDetailer passes
- extra detector/model loads
- required passthrough cleanup nodes without wiring
- extra VAE/video stages

### Video / SeedVR Upscale

Treat as a separate heavy mode. The error `Allocation on device` means the GPU ran out of memory. Do not attach SeedVR2VideoUpscaler to the default image workflow.

## HEISS UI Workflow Rules

HEISS UI loads ComfyUI API workflow JSON. A workflow becomes friendly only when it has a top-level `heissUi` block.

Minimum shape:

```json
{
  "heissUi": {
    "id": "z-image-my-workflow",
    "name": "Z Image My Workflow",
    "kind": "image",
    "controls": {
      "prompt": { "node": "204", "input": "text" },
      "width": { "node": "201", "input": "value" },
      "height": { "node": "202", "input": "value" },
      "steps": { "node": "218", "input": "steps" },
      "cfg": { "node": "218", "input": "cfg" },
      "sampler": { "node": "218", "input": "sampler_name" },
      "scheduler": { "node": "218", "input": "scheduler" },
      "seed": { "node": "217", "input": "seed" }
    }
  }
}
```

Only mapped controls are changed by HEISS UI. Everything else stays as exported from ComfyUI.

Workflow authoring rule: if you expect to control it from the app, map it. If it should stay part of the preset identity, leave it unmapped.

## Size Mapping Rule

Always map image size explicitly.

For direct latent nodes:

```json
"width": { "node": "7", "input": "width" },
"height": { "node": "7", "input": "height" }
```

For integer helper nodes:

```json
"width": { "node": "201", "input": "value" },
"height": { "node": "202", "input": "value" }
```

If size is not mapped, the UI may show strange defaults like `520x520` or fail to represent the intended high-fidelity preset.

## Negative Prompt Rule

Z-Image-style workflows often do not use negative prompts in the normal SDXL way. The local hyperfast graph uses a negative encode plus `ConditioningZeroOut`, so negative text is structurally present but intentionally neutralized.

Preferred UI behavior:

- If a workflow has no useful negative control, show the negative field as unavailable.
- Use the pretty disabled state rather than exposing a fake control.
- Do not force negative prompt mapping into workflows where it harms the model behavior.

## VAE Rule

Prefer `ae.safetensors` for the local Z-Image flows because it exists in this ComfyUI setup and fixed the earlier missing VAE issue.

The earlier broken workflow referenced:

```text
zImage_vae.safetensors
```

ComfyUI reported that file was not in the VAE list. When a workflow fails with `Value not in list: vae_name`, search the API workflow JSON for `VAELoader` and replace the missing `vae_name` with an installed VAE.

Known installed VAE options from the error included:

- `ae.safetensors`
- `qwen_image_vae.safetensors`
- `wan_2.1_vae.safetensors`
- `pixel_space`

Use `ae.safetensors` first for the Z-Image image path.

## LoRA Rule

For HEISS UI built-in image workflows, use core ComfyUI `LoraLoader` for API reliability.

Core loader shape:

- inputs: `model`, `clip`, `lora_name`, `strength_model`, `strength_clip`
- outputs: patched `MODEL`, patched `CLIP`
- chain multiple LoRAs in UI order
- use one visible strength in HEISS UI v1 and apply it to both model and CLIP strength

Starting strength:

- `0.7` for normal style/character LoRAs
- `0.3-0.55` if the LoRA overpowers faces, composition, or texture
- `0` for a placeholder node that exists only to keep graph paths stable

For custom workflows, LoRA support is still intentionally conservative. Fixed LoRA nodes can live inside the graph, but HEISS UI v1 does not mutate arbitrary custom workflow LoRA stacks unless explicit metadata support is added later.

## Power LoRA Loader Rule

Use Power LoRA Loader in hand-authored ComfyUI workflows when it improves graph ergonomics, especially for stack management. For HEISS UI API execution, prefer core `LoraLoader` unless the custom workflow is known to validate reliably through ComfyUI's API.

Reason:

- core `LoraLoader` is stable and easy to validate from object info
- custom Power LoRA nodes may require extra inputs, stack objects, or specific CLIP wiring
- API failures are harder to understand when custom stack nodes hide model/CLIP routing

Best compromise:

- use Power LoRA Loader while designing in ComfyUI
- export a simpler API workflow path for HEISS UI when reliability matters

## Fast Polish Stack

The grain and sharpness you liked should be its own lightweight finish, not tied to FaceDetailer.

Current local finish:

- `FastLaplacianSharpen`
  - strength: `0.22`
  - `use_gpu`: `false`
- `FastFilmGrain`
  - grain intensity: `0.01`
  - saturation mix: `0.28`
  - batch size: `4`

Keep these subtle. The goal is a premium finishing texture, not crunchy sharpening.

## Grouping And Visual Hierarchy

When creating or cleaning ComfyUI graphs, preserve visual hierarchy even if HEISS UI only needs API JSON.

Preferred group layout:

1. Model Load
2. Text Encode
3. Latent Size
4. Sampling
5. Decode
6. Fast Polish
7. Save
8. Optional LoRA
9. Optional Heavy Repair

Keep everyday graphs compact. Put heavy branches off to the side. Do not mix "fast default" and "experimental repair lab" into one unreadable graph unless the graph is explicitly a master template.

## Validation Checklist

Before importing or saving a workflow for HEISS UI:

- Export as ComfyUI API workflow JSON.
- Confirm the final output is `SaveImage` or another API-visible save/output node.
- Add or verify `heissUi.id`, `name`, and `kind`.
- Map prompt.
- Map width and height.
- Map seed, steps, CFG, sampler, and scheduler where available.
- Do not map controls that the graph cannot safely support.
- Search for missing local file references:
  - `vae_name`
  - `ckpt_name`
  - `clip_name`
  - `lora_name`
- Check custom node class names against the local ComfyUI install.
- Remove or wire nodes with required passthrough inputs like `anything`.
- Generate once in ComfyUI.
- Import into HEISS UI.
- Revalidate in the Workflow Gallery.
- Generate once from HEISS UI.

## Error Decoder

### `VAELoader: Value not in list`

The workflow references a VAE file that is not installed. Find `VAELoader` in the JSON and change `vae_name` to an installed VAE. For this PC, prefer `ae.safetensors` for Z-Image.

### `Required input is missing: anything`

A utility node, often cleanup/cache-related, expects a passthrough input. Either wire it in the graph or remove the node from the API path.

### `No VAE weights detected`

The selected checkpoint probably does not contain VAE weights. Use an explicit `VAELoader`.

### `no CLIP/text encoder weights in checkpoint`

The checkpoint does not include a text encoder. Use an explicit `CLIPLoader`, such as the local Z-Image Qwen text encoder.

### `Allocation on device`

GPU VRAM ran out. Lower resolution, remove heavy post-processing, avoid video upscalers, reduce batch size, use tiled decode, or split into multiple workflows.

### Weird front-end sizes

Width and height are not mapped correctly in `heissUi.controls`, or they point to the wrong node/input.

## Workflow Gallery Preferences

Use the Workflow Gallery as the management surface:

- favorite the daily-driver hyperfast workflow
- keep broken workflows visible for diagnosis
- delete imported experiments from the gallery when they are no longer useful
- use details to inspect mappings and validation state
- treat thumbnails as memory anchors for which preset created which look

Main picker philosophy:

- favorite daily workflows first
- recent experiments second
- built-in/profile-backed options third
- imported custom workflows clearly labeled as workflows

## When To Web Search

Use web search as a real workflow-building skill, not as procrastination.

Search when:

- a node name is unfamiliar
- a custom node validation error names a class you do not recognize
- a Z-Image workflow suddenly depends on a new VAE, sampler, or model variant
- LoRA behavior differs between ComfyUI and AI Toolkit
- an RTX 3070 memory error appears after a ComfyUI update
- a workflow comes from RunComfy/Civitai/Reddit and may assume cloud VRAM
- ComfyUI object info changed after an update

Search patterns:

```text
ComfyUI <node class> required inputs
ComfyUI Z-Image RTX 3070 workflow optimization
ComfyUI Z-Image LoRA LoraLoader model only
ComfyUI VAE Decode tiled low VRAM
ComfyUI API workflow missing input anything
ComfyUI <exact error text>
```

Evaluate sources in this order:

1. Official ComfyUI docs or source
2. Node author's GitHub repository
3. Workflow author's page
4. Recent issue threads
5. Reddit/community posts as clues, not law

Useful current references:

- ComfyUI `LoraLoader` docs confirm `strength_model` and `strength_clip` as separate float inputs.
- ComfyUI memory guides consistently recommend tiled VAE decode and offloading strategies for 8 GB cards.
- Recent Z-Image workflow notes mention that LoRA-heavy Z-Image paths can slow down or fail around VAE decode, so keep the default path lean.

## New Workflow Template

Use this shape for the next fast Z-Image workflow:

1. Load checkpoint.
2. Load Qwen/Lumina-compatible text encoder.
3. Load `ae.safetensors`.
4. Apply model sampling shift.
5. Optional core `LoraLoader` chain, default disabled or zero strength.
6. Encode positive prompt.
7. Use zeroed negative conditioning unless the model/workflow genuinely benefits from negative text.
8. Create latent at `896 x 1344` or a nearby high-fidelity size that fits VRAM.
9. Sample with `euler`, `beta`, `8-10` steps, CFG `1`.
10. Decode.
11. Apply subtle sharpen.
12. Apply subtle film grain.
13. Save image.
14. Add `heissUi.controls`.
15. Import and validate through Workflow Gallery.

## Personal Defaults

Use these unless there is a specific reason not to:

- kind: `image`
- batch: `1`
- aspect: vertical portrait first
- width/height: `896 x 1344` for the hyperfast preset
- steps: `8`
- CFG: `1`
- sampler: `euler`
- scheduler: `beta`
- VAE: `ae.safetensors`
- LoRA default strength: `0.7`
- LoRA max stack in app: `4`
- FaceDetailer: off by default
- SeedVR/video upscaler: separate heavy workflow only
- polish: subtle sharpen + subtle grain

## Definition Of Done

A workflow is ready for HEISS UI when:

- it runs in ComfyUI
- it imports into HEISS UI
- it appears in Workflow Gallery
- the size controls are correct
- unsupported controls look unavailable rather than broken
- generation works from the app
- gallery details can explain what happened
- the workflow still feels fast enough to use repeatedly

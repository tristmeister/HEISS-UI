# Architecture Notes

## Runtime Shape

J AI Studio is a React/Vite frontend with an Express server. The server talks to a local ComfyUI instance over HTTP and WebSocket.

Primary paths:

- Frontend entry: `src/main.tsx`
- Main view: `src/app/StudioView.tsx`
- Sidebar controls: `src/app/SidebarControls.tsx`
- Shared app components: `src/app/components.tsx`
- Generation actions: `src/app/useGenerationActions.ts`
- Server entry: `server/index.js`
- Graph builders: `server/graphs.js`
- Model/profile inference: `server/models.js`
- Custom workflow loader: `server/custom-workflows.js`
- ComfyUI adapter: `server/comfy.js`
- Job execution and previews: `server/jobs.js`
- Gallery persistence: `server/gallery-store.js`

## Data Flow

1. Frontend loads health, paths, models/profiles, preferences, and gallery.
2. `server/models.js` reads ComfyUI `/object_info` and `/system_stats`.
3. Profiles are inferred for built-in workflows and imported custom workflows.
4. User submits generation from `useGenerationActions.ts`.
5. Server validates request in `server/validation.js`.
6. Server builds a ComfyUI API graph in `server/graphs.js`.
7. Server queues the graph through ComfyUI `/prompt`.
8. `server/jobs.js` listens to ComfyUI WebSocket previews and progress.
9. Completed outputs are read from ComfyUI history and stored in the local gallery.

## Built-In Workflow Model

Built-in workflows are selected by profile family:

- `unet-image`
- `checkpoint-image`
- `wan-video`

Profile generation in `server/models.js` determines:

- default model controls
- default dimensions
- sampler/scheduler options
- text encoder/VAE options
- capability flags
- aspect presets
- constraints

Graph generation in `server/graphs.js` creates ComfyUI API graph objects directly.

## Custom Workflow Model

Custom workflows are ComfyUI API graphs with a top-level `jAiStudio` metadata block.

The loader:

- removes `jAiStudio` from the graph before execution
- stores `controls`
- derives defaults from mapped controls
- infers required node classes from graph classes unless overridden
- skips workflows whose required nodes are missing

Only mapped controls are mutated by J AI Studio. Unmapped graph inputs stay as saved.

Current mapped control keys are:

- `prompt`
- `negative`
- `model`
- `textEncoder`
- `vae`
- `clipType`
- `weightDtype`
- `width`
- `height`
- `steps`
- `cfg`
- `denoise`
- `sampler`
- `scheduler`
- `seed`
- `count`
- `frames`
- `fps`
- `startImage`

## Reference Media And Image Editing

Image-to-image workflows use `capabilities.imageToImage` plus a `mediaInputs`
array. Each media slot declares its stable id, whether it is required, its
cardinality, and the graph node/input that receives the ComfyUI upload name.
`controls.startImage` remains a backwards-compatible single-image alias.

`server/reference-assets.js` owns uploaded reference images and exposes
paginated upload/generation sources. Uploads are decoded with Sharp, bounded by
file size and pixel count, indexed by content hash, and served through thumbnail
and media URLs. Gallery and unlocked-vault items are logical reference assets;
the server resolves them and stages their bytes directly into ComfyUI before a
job is queued.

Workflow `promptComposition` keeps the user's edit separate from a workflow's
versioned prefix/suffix policy. The gallery persists the user prompt and policy
identifier, while `server/graphs.js` composes the effective prompt only when it
binds the graph.

There is no current custom control mechanism for arbitrary node inputs.

## Current LoRA State

The app can run a LoRA only if the graph already contains a LoRA node wired into the model/CLIP path. For custom workflows, this means a fixed LoRA can be saved inside the API graph.

The app cannot currently:

- list installed LoRAs in the UI
- select LoRAs from the UI
- map LoRA node inputs through `jAiStudio.controls`
- save LoRA settings in gallery metadata
- restore LoRA settings from "Copy All Settings"

## Likely LoRA Integration Points

### Server Metadata

Use ComfyUI object info:

- `LoraLoader`
- `LoraLoaderModelOnly`
- other loader names only after explicit support

Read options from `LoraLoader.input.required.lora_name`.

### Profile Capabilities

Add fields such as:

- `lora`
- `loraStack`

Profiles should expose LoRA controls only when the selected graph has a known LoRA application path.

### Request Body

Add structured LoRA fields:

```json
{
  "loras": [
    {
      "name": "folder/example.safetensors",
      "enabled": true,
      "strengthModel": 0.7,
      "strengthClip": 0.7
    }
  ]
}
```

### Graph Builders

Built-in image workflows can insert `LoraLoader` between:

- model loader and sampler
- CLIP loader and text encoders

Custom workflows can support LoRA through explicit mappings or a new `jAiStudio.loras` metadata block.

### Gallery Metadata

Store LoRA settings in each gallery item's `settings` object. Include readable detail entries in `src/app/format.ts`.

## Implementation Constraints

- Do not require rgthree Power Lora Loader for API execution.
- Prefer core `LoraLoader` for API stability.
- Multi-LoRA should chain core `LoraLoader` nodes in order.
- Preserve no-LoRA behavior exactly when no LoRA is selected.
- Validate selected LoRA names against ComfyUI options.
- Keep graph mutation deterministic so "Copy All Settings" can reproduce outputs.

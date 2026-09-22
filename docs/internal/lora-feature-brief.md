# LoRA Feature Brief

## Goal

Add first-class LoRA support to HEISS UI so users can select installed LoRAs, tune strengths, generate with them, and reproduce or reuse LoRA settings from gallery outputs.

## Non-Goals For First Pass

- No LoRA downloading.
- No LoRA training.
- No model compatibility database.
- No visual graph editing.
- No dependency on rgthree Power Lora Loader for API execution.

## Current Limitation

Custom API workflows can contain fixed `LoraLoader` nodes, but HEISS UI has no LoRA-specific frontend state, payload fields, metadata support, or graph mutation.

## MVP Scope

### Supported Workflow Types

Support LoRA on image generation first:

- built-in UNET/Z-Image image workflow
- built-in checkpoint image workflow, if the core `LoraLoader` node is present
- custom API workflows that explicitly expose a LoRA loader mapping

Video can come later.

### User Controls

Add a LoRA section in the sidebar:

- enable toggle
- LoRA select
- model strength
- CLIP strength

Use a compact summary in the prompt bar when active:

- `LoRA off`
- `1 LoRA`
- later: `3 LoRAs`

### State

Add frontend state:

- `loras`
- persist in local draft
- include in generation request body
- restore from gallery "Copy All Settings"

### Server

Add validation:

- selected LoRA exists in `LoraLoader` options
- strengths are numeric and clamped
- ignore disabled entries

Add graph building:

- no selected LoRA: current graph unchanged
- one selected LoRA: insert one `LoraLoader`
- multiple selected LoRAs: chain `LoraLoader` nodes in array order

### Custom Workflow Metadata

Recommended metadata shape:

```json
{
  "heissUi": {
    "controls": {
      "prompt": { "node": "4", "input": "text" }
    },
    "loras": {
      "mode": "loader",
      "node": "243",
      "nameInput": "lora_name",
      "modelStrengthInput": "strength_model",
      "clipStrengthInput": "strength_clip"
    }
  }
}
```

For multi-LoRA custom workflows, prefer a future stack format:

```json
{
  "heissUi": {
    "loras": {
      "mode": "chain",
      "insertAfter": {
        "model": { "node": "230", "output": 0 },
        "clip": { "node": "189", "output": 0 }
      },
      "insertBefore": {
        "model": [{ "node": "218", "input": "model" }],
        "clip": [
          { "node": "240", "input": "clip" },
          { "node": "215", "input": "clip" }
        ]
      }
    }
  }
}
```

Do not overload existing `controls` with arbitrary LoRA keys unless the app supports generic custom controls.

## UX Details

### Sidebar Section

Place LoRA controls below model setup and before sampler controls.

Suggested layout:

- Section title: `LoRA`
- Toggle row: `Use LoRA`
- Select: `LoRA`
- NumberPicker: `Model`
- NumberPicker: `CLIP`

For the first pass, one LoRA is enough. The UI should be shaped so an "Add LoRA" row can be introduced later.

### Defaults

- enabled: `false`
- name: first available LoRA or empty
- model strength: `0.7`
- CLIP strength: `0.7`

When disabled, do not insert LoRA nodes or mutate graph paths.

### Gallery Details

Show active LoRAs in generation details:

- `LoRA: folder/example.safetensors`
- `LoRA model strength: 0.7`
- `LoRA CLIP strength: 0.7`

## Engineering Tasks

1. Extend types and local draft shape for `loras`.
2. Add LoRA options to `Models` or profile options from ComfyUI object info.
3. Add profile capability `lora`.
4. Add sidebar controls.
5. Include LoRA state in generation payload.
6. Validate LoRA request fields server-side.
7. Insert core `LoraLoader` nodes in built-in image graphs.
8. Add custom workflow metadata support.
9. Store LoRA settings in gallery metadata.
10. Restore LoRA settings in `useViewerControls`.
11. Document workflow authoring.
12. Build and manually test against ComfyUI with at least one installed LoRA.

## Risks

- LoRA compatibility varies by model family.
- Some ComfyUI installs use custom LoRA nodes instead of core `LoraLoader`.
- Large LoRA lists need search; a basic select may become unwieldy.
- Multi-LoRA ordering affects output and must be preserved.
- Custom workflow insertion can break graphs if metadata is ambiguous.

## Recommended First Implementation

Start with core `LoraLoader` for built-in image workflows only. That gives a stable first feature with minimal graph complexity. Then add custom workflow metadata once the state, validation, and gallery restore paths are proven.

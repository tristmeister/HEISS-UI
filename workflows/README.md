# Custom Workflows

HEISS UI can load ComfyUI API workflow templates from this folder or from the app data workflow folder shown in Settings.

Use ComfyUI's API workflow JSON format, then add a `heissUi` block that tells the simple UI which node inputs map to common controls.

```json
{
  "heissUi": {
    "id": "my-workflow",
    "name": "My Workflow",
    "kind": "image",
    "controls": {
      "prompt": { "node": "4", "input": "text" },
      "negative": { "node": "5", "input": "text" },
      "width": { "node": "6", "input": "width" },
      "height": { "node": "6", "input": "height" },
      "steps": { "node": "7", "input": "steps" },
      "cfg": { "node": "7", "input": "cfg" },
      "sampler": { "node": "7", "input": "sampler_name" },
      "scheduler": { "node": "7", "input": "scheduler" },
      "seed": { "node": "7", "input": "seed" }
    }
  },
  "4": {
    "class_type": "CLIPTextEncode",
    "inputs": {}
  }
}
```

Only mapped controls are changed by HEISS UI. Everything else stays exactly as it was in the exported ComfyUI API workflow.

The controls it can map are `prompt`, `negative`, `seed`, `steps`, `cfg`, `sampler`, `scheduler`, `denoise`, `width`, `height`, `count` (batch size), `frames`, `fps` and `startImage`, plus the loader choices `model`, `textEncoder`, `vae`, `clipType` and `weightDtype`. Each points at one input on one node. A second sampler or prompt encoder keeps its saved values unless you feed both from one node (a core `PrimitiveInt` or `PrimitiveString`) and map that.

Importing without a `heissUi` block works too: HEISS UI guesses the mapping from node types and order (the first text encoder is the prompt, the second the negative, the first sampler gets seed and steps). The import review marks those guesses and lists what follows the studio and what stays as saved. Its **Copy for an agent** button copies a prompt, with the workflow, that asks an AI agent to write the `heissUi` block for you; the prompt lives in `src/app/workflowAgentGuide.ts`.

## Image-to-image inputs

Declare image editing explicitly rather than relying only on a `LoadImage`
node:

```json
{
  "heissUi": {
    "capabilities": { "imageToImage": true },
    "mediaInputs": [{
      "id": "reference",
      "kind": "image",
      "label": "Reference image",
      "required": true,
      "min": 1,
      "max": 1,
      "control": { "node": "369", "input": "image" }
    }],
    "promptComposition": {
      "prefix": "Edit: ",
      "suffix": "Keep everything else the same.",
      "policy": "preserve-source-v1",
      "version": 1
    }
  }
}
```

The user prompt stays unchanged in gallery history. Prefix and suffix text are
applied only to the graph input. Existing workflows with `controls.startImage`
are automatically exposed as an optional single-image media input.

Visual workflow imports prefer ComfyUI's `widgets_values_named` map when it is
available. This avoids positional drift from UI-only widget values such as
`control_after_generate` and upload controls.

## Power LoRA Loader

An API workflow can opt in to HEISS UI's LoRA picker with an existing rgthree Power LoRA Loader:

```json
{
  "heissUi": {
    "capabilities": { "lora": true },
    "loraStack": {
      "adapter": "rgthree-power-v1",
      "node": "4",
      "max": 8
    }
  }
}
```

The referenced node must be `Power Lora Loader (rgthree)` and already have its model and CLIP wiring connected. HEISS UI replaces only its `lora_` inputs using the selected LoRAs, in sidebar order.

The simpler rgthree stack used by the bundled Flux 2 edit workflow is also
supported:

```json
{
  "heissUi": {
    "capabilities": { "lora": true },
    "loraStack": {
      "adapter": "rgthree-stack-v1",
      "node": "374",
      "max": 4
    }
  }
}
```

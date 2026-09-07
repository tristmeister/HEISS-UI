# Custom Workflows

J AI Studio can load ComfyUI API workflow templates from this folder or from the app data workflow folder shown in Settings.

Use ComfyUI's API workflow JSON format, then add a `jAiStudio` block that tells the simple UI which node inputs map to common controls.

```json
{
  "jAiStudio": {
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

Only mapped controls are changed by J AI Studio. Everything else stays exactly as it was in the exported ComfyUI API workflow.

## Image-to-image inputs

Declare image editing explicitly rather than relying only on a `LoadImage`
node:

```json
{
  "jAiStudio": {
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

An API workflow can opt in to J AI Studio's LoRA picker with an existing rgthree Power LoRA Loader:

```json
{
  "jAiStudio": {
    "capabilities": { "lora": true },
    "loraStack": {
      "adapter": "rgthree-power-v1",
      "node": "4",
      "max": 8
    }
  }
}
```

The referenced node must be `Power Lora Loader (rgthree)` and already have its model and CLIP wiring connected. J AI Studio replaces only its `lora_` inputs using the selected LoRAs, in sidebar order.

The simpler rgthree stack used by the bundled Flux 2 edit workflow is also
supported:

```json
{
  "jAiStudio": {
    "capabilities": { "lora": true },
    "loraStack": {
      "adapter": "rgthree-stack-v1",
      "node": "374",
      "max": 4
    }
  }
}
```

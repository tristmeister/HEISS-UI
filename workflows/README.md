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

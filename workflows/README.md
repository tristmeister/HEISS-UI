# Custom Workflows

Most people never need this page. In the app, **Workflows › Import** opens on
your recent runs from ComfyUI's history and the workflows saved in ComfyUI;
pick one, or drop a workflow file or an image ComfyUI made. HEISS reads what
you'd change between runs (the text you typed, seed, size, images, the rest as
More settings), gets the add-ons it needs, and adds it as a model. See
[docs/workflow-import-plan.md](../docs/workflow-import-plan.md) for how.

This folder is for bundled templates and for power users who want to declare
the mapping themselves. HEISS UI loads ComfyUI API workflow templates from here
or from the app data workflow folder shown in Settings. A `heissUi` block tells
the simple UI which node inputs map to common controls; what it declares wins
over what HEISS finds.

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

The controls it can map are `prompt`, `negative`, `seed`, `steps`, `cfg`, `sampler`, `scheduler`, `denoise`, `width`, `height`, `count` (batch size), `frames`, `fps` and `startImage`, plus the loader choices `model`, `textEncoder`, `vae`, `clipType` and `weightDtype`. Each points at one input on one node, or at a list of them (`[{ "node": "4", "input": "text" }, { "node": "15", "input": "text" }]`) to write the same value to several, such as a base and a refiner prompt.

`settings` lists other inputs to offer under More settings: `{ "node": "6", "input": "b1", "label": "B1", "group": "FreeU", "type": "FLOAT", "default": 1.3 }` (types `INT`, `FLOAT`, `BOOLEAN`, `COMBO` with `options`, `STRING`).

Importing without a `heissUi` block is the normal case: HEISS UI finds the mapping by following the wires from each sampler back to the text a person typed (server/workflow-understand.js). When two texts are equally likely it asks which one is the prompt, showing the texts. The mapping table and **Copy for an agent** are under Advanced in the import review.

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

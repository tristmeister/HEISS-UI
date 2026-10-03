# Workflow import corpus

Real ComfyUI workflows the import pipeline is checked against
(`server/workflow-import.test.js`). `expected.json` records, per file, which
inputs a person changes between runs: the prompt box(es), negative, seeds,
size, images, and whether size comes from an input image.

Sources:
- Official ComfyUI templates from
  [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates)
  (MIT License, Copyright (c) 2023-present Comfy Org). They cover subgraphs,
  muted nodes, titled Primitive knobs, custom sampling, Wan, LTX, Qwen, Chroma.
- `comfyport_art.json` and `comfyport_user.json` from the test resources of
  [ComfyPort](https://github.com/NicolasCampailla/ComfyPort) (MIT License): a
  Reroute-heavy workflow without a save node, and a GGUF inpainting workflow
  with custom nodes and subgraphs.

Add messy community workflows here as they turn up, with their expected
answers, so each detection change is measured against all of them.

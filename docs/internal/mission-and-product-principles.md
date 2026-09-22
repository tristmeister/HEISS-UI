# Mission And Product Principles

## Mission

HEISS UI is a local-first creative surface for ComfyUI. It turns graph-based image and video generation into a prompt-first studio that is fast enough for repeated exploration, clear enough for non-graph workflows, and respectful of the user's existing local ComfyUI setup.

The app should feel like a quiet production tool: immediate, visual, inspectable, and private. ComfyUI remains the engine and source of truth. HEISS UI is the ergonomic layer for choosing a model, prompting, generating, reviewing, reusing, and iterating.

## Product Promise

- Make local generation approachable without hiding what matters.
- Preserve user control over model files, workflows, outputs, and ComfyUI.
- Keep the main creative loop short: prompt, adjust a few controls, generate, inspect, reuse.
- Make advanced options available without making the default surface feel like a graph editor.
- Treat custom workflows as first-class templates when built-in inference is not enough.

## Audience

Primary users are local AI image/video users who already have ComfyUI, models, and custom nodes installed, but do not want to operate the graph editor for every generation.

Secondary users are workflow builders who want to package a known ComfyUI API graph behind a simpler interface for repeated use.

## Current Product Shape

HEISS UI currently provides:

- Prompt-first image and video generation.
- A gallery-oriented output view with live progress and previews.
- Zen mode for fullscreen prompt and review.
- Model-aware controls based on ComfyUI node metadata.
- Start image reuse when a workflow exposes that path.
- Settings for connection, workflows, update, gallery, and maintenance.
- Custom API workflow import with `heissUi.controls` metadata.

## What The App Is Not

- It is not a ComfyUI replacement.
- It is not a model downloader or model manager.
- It is not a graph editor.
- It should not mutate the user's ComfyUI installation.
- It should not expose network access by default.

## Feature Decision Principles

- Default to local-only behavior.
- Prefer ComfyUI metadata over hardcoded assumptions.
- Keep generated media and local user data out of git.
- Add advanced controls only when they directly support generation quality, repeatability, or workflow portability.
- When a feature needs custom ComfyUI nodes, show it only when those nodes are present.
- Avoid one-off UI for one workflow when a metadata-driven capability can serve many workflows.

## LoRA Direction

LoRA support should become a first-class generation capability, not a hidden fixed node in a workflow. The user should be able to pick one or more installed LoRAs, set strengths, and understand whether the current workflow supports applying them.

LoRA support should preserve the existing app philosophy:

- Simple by default: no LoRA selected means the current generation path is unchanged.
- Progressive: one LoRA should be easy; multi-LoRA stacks can be added without overwhelming the main prompt surface.
- ComfyUI-native: available LoRAs and node constraints come from ComfyUI object info.
- Workflow-aware: built-in workflows and custom workflows can expose different LoRA insertion points.

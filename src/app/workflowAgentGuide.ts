import type { WorkflowImportPreview } from './types';

/**
 * What HEISS UI can connect in an imported workflow, by the key in its
 * `heissUi.controls` block. The import review and the AI agent prompt both
 * read this, so they never disagree. Keep it in step with applyMappedInputs
 * in server/graphs.js.
 */
export const workflowControls: Array<{ key: string; label: string; hint: string; editable?: boolean }> = [
  { key: "prompt", label: "Prompt", hint: "the positive prompt text, e.g. CLIPTextEncode.text", editable: true },
  { key: "negative", label: "Negative prompt", hint: "the negative prompt text", editable: true },
  { key: "seed", label: "Seed", hint: "the sampler's seed (or noise_seed)", editable: true },
  { key: "steps", label: "Steps", hint: "the sampler's steps", editable: true },
  { key: "cfg", label: "CFG", hint: "the sampler's cfg", editable: true },
  { key: "sampler", label: "Sampler", hint: "the sampler's sampler_name", editable: true },
  { key: "scheduler", label: "Scheduler", hint: "the sampler's scheduler", editable: true },
  { key: "denoise", label: "Denoise", hint: "the sampler's denoise, for image-to-image", editable: true },
  { key: "width", label: "Width", hint: "the empty latent (or video latent) width", editable: true },
  { key: "height", label: "Height", hint: "the empty latent (or video latent) height", editable: true },
  { key: "count", label: "Variants", hint: "batch_size, for several images per run (image workflows)", editable: true },
  { key: "frames", label: "Frames", hint: "the video length in frames", editable: true },
  { key: "fps", label: "FPS", hint: "the video frame rate", editable: true },
  { key: "startImage", label: "Reference image", hint: "a LoadImage.image input for one reference image (mediaInputs is the fuller form)", editable: true },
  { key: "model", label: "Model file", hint: "the model loader's file name, so the user can switch files" },
  { key: "textEncoder", label: "Text encoder", hint: "the text encoder loader's file name" },
  { key: "vae", label: "VAE", hint: "the VAE loader's file name" },
  { key: "clipType", label: "CLIP type", hint: "the CLIP loader's type option" },
  { key: "weightDtype", label: "Weight type", hint: "the model loader's weight_dtype option" }
];

export const controlLabel = (key: string) => workflowControls.find((item) => item.key === key)?.label || key;

/** The LoRA picker drives exactly these nodes. */
export const loraNodes = { "rgthree-power-v1": "Power Lora Loader (rgthree)", "rgthree-stack-v1": "Lora Loader Stack (rgthree)" } as const;

const promptHead = `I use HEISS UI, a local studio that runs ComfyUI workflows behind a simple prompt box. Help me prepare a ComfyUI workflow for it.

HEISS UI runs a workflow as saved, except for the node inputs it is connected to. The connections live in a "heissUi" block at the top level of the workflow JSON, in ComfyUI's API format (the object whose keys are node ids, each with "class_type" and "inputs").

Your task:
1. Read the workflow. If it is in ComfyUI's visual format (it has "nodes" and "links"), ask me to export it again with ComfyUI's "Export (API)", unless you are certain of every widget value.
2. Add or fix the "heissUi" block so each control below points at the right node input. Leave the graph as it is, unless a connection can't work without a change (see "Changing the graph").
3. Reply with the complete JSON, ready to paste into HEISS UI's import. After it, list briefly: what is connected, what stays as saved, and anything you were unsure about.

The heissUi block (every field but "controls" is optional):
{
  "heissUi": {
    "id": "short-kebab-case-id",
    "name": "Readable name",
    "description": "One sentence about what it makes.",
    "kind": "image" or "video",
    "family": "model family, e.g. sdxl, flux, wan",
    "controls": { "<control>": { "node": "<node id>", "input": "<input name>" } },
    "defaults": { "<control>": <starting value> },
    "capabilities": { "imageToImage": true, "lora": true },
    "mediaInputs": [ ...reference images, see below... ],
    "loraStack": { ...the LoRA picker, see below... },
    "promptComposition": { "prefix": "", "suffix": "" },
    "aspectRatios": [["16:9", 16, 9], ["1:1", 1, 1]],
    "aspectPolicy": "manual" or "reference"
  }
}

Controls HEISS UI can connect. Each points at exactly one input, and that input must already exist on the node:
${workflowControls.map((item) => `- ${item.key}: ${item.hint}`).join("\n")}

Reference images ("mediaInputs"), each a LoadImage "image" input:
[{ "id": "reference", "kind": "image", "label": "Reference image", "required": true, "min": 1, "max": 1, "control": { "node": "<LoadImage id>", "input": "image" } }]
Set capabilities.imageToImage to true when the workflow edits an image. "aspectPolicy": "reference" makes the output size follow the reference image.

The LoRA picker ("loraStack") works only with these nodes, already wired to the model and CLIP:
- { "adapter": "rgthree-power-v1", "node": "<id of a ${loraNodes["rgthree-power-v1"]}>", "max": 8 }
- { "adapter": "rgthree-stack-v1", "node": "<id of a ${loraNodes["rgthree-stack-v1"]}>", "max": 4 }
Set capabilities.lora to true with it. HEISS UI replaces only that node's LoRA slots.

"promptComposition" wraps the user's prompt in fixed text before it reaches the prompt input (for example an edit instruction). The gallery keeps the user's own words.

What HEISS UI cannot connect (these keep the value saved in the workflow):
- Any input not listed above: ControlNet strength, upscale factors, extra text fields, custom sliders.
- One control on several nodes. With two samplers (a refiner or hires pass) or two prompt encoders, only the connected one follows the studio.
- Masks, videos or audio as inputs. Reference inputs are images only.
- LoRA loaders other than the two rgthree nodes above.
- Picking one output. Everything the save nodes write (images, and videos from nodes that report "videos") goes to the gallery.

Changing the graph (only when needed, and tell me what you changed):
- If one value has to reach several nodes (one seed for two samplers, one prompt for two encoders), feed them from a single core node (PrimitiveInt, PrimitiveString) and connect that node's "value".
- The workflow needs a save node (SaveImage, or a video save node), or nothing reaches the gallery.
- Don't invent node types. Use nodes already in the workflow or core ComfyUI nodes, and name any custom node packs it needs.`;

/** The prompt on its own, for a workflow the agent will be given separately. */
export function agentPrompt() {
  return `${promptHead}

My workflow JSON follows after this message.`;
}

/** The prompt with one workflow and how HEISS UI read it, ready to paste into an agent. */
export function agentPromptFor(item: { filename?: string; raw: unknown; preview: WorkflowImportPreview; metadata: WorkflowImportPreview["detected"] }) {
  const { controls, guessed = [] } = item.metadata;
  const read = Object.entries(controls || {}).map(([key, mapping]) => `- ${key} → node ${mapping.node}.${mapping.input}${guessed.includes(key) ? " (guessed, check it)" : ""}`);
  const problems = [...(item.preview.validation.issues || []), ...(item.preview.validation.warnings || [])].map((issue) => `- ${issue}`);
  return `${promptHead}

How HEISS UI read it on import${item.filename ? ` (${item.filename})` : ""}:
${read.length ? read.join("\n") : "- Nothing connected yet."}
${problems.length ? `\nWhat HEISS UI reported:\n${problems.join("\n")}\n` : ""}
The workflow JSON:
${JSON.stringify(item.raw, null, 2)}`;
}

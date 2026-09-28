/**
 * Turns a ComfyUI failure into something a person can act on: a short
 * headline, a plain hint for the errors people actually hit, and the full
 * detail (node, exception, traceback) kept for copying into a bug report.
 */

const hints = [
  {
    test: /header is too large|incomplete metadata|MetadataIncompleteBuffer|invalid header|Error while deserializing header/i,
    title: "A model file is damaged or incomplete",
    hint: "This usually means a download stopped early, or a web page was saved under a model's name. Delete the file and download it again.",
    fix: "redownload"
  },
  {
    test: /out of memory|OutOfMemoryError|Allocation on device/i,
    title: "The GPU ran out of memory",
    hint: "Free the memory ComfyUI still holds and try again, or try a smaller size, fewer images per run, or a lighter model.",
    fix: "memory"
  },
  {
    test: /Value not in list/i,
    title: "ComfyUI does not have a file this run asked for",
    hint: "A model, LoRA, text encoder or VAE picked here is not in ComfyUI's folders (anymore). Rescan models, or pick another one.",
    fix: "rescan"
  },
  {
    test: /mat1 and mat2 shapes cannot be multiplied|size mismatch|shape .* is invalid for input|Error\(s\) in loading state_dict/i,
    title: "Parts that do not fit together",
    hint: "The text encoder, VAE or a LoRA does not match this model's family. Check the picks in Advanced and the active LoRAs."
  },
  {
    test: /No such file or directory|FileNotFoundError|could not find/i,
    title: "A file went missing",
    hint: "Something this run needs was moved or deleted after ComfyUI listed it. Rescan models and try again.",
    fix: "rescan"
  },
  {
    // ComfyUI-GGUF refuses architectures it doesn't know yet (Krea 2, Ideogram 4, MiniMax H3, Qwen-Image 2.1 in Sept 2026).
    test: /Unexpected (?:text model )?architecture type in GGUF file|This model is not currently supported/i,
    title: "ComfyUI-GGUF can't load this model yet",
    hint: "HEISS UI knows this GGUF file, but the installed ComfyUI-GGUF doesn't support its model type yet. Update ComfyUI-GGUF, or use the model's safetensors version."
  },
  {
    test: /Node .* does not exist|missing_node_type|Cannot execute because a node is missing|The custom node may not be installed/i,
    title: "A node is missing in ComfyUI",
    hint: "The workflow uses a custom node ComfyUI does not have. Install it, restart ComfyUI, and try again.",
    fix: "node"
  },
  {
    test: /no longer has this run/i,
    title: "ComfyUI dropped this run",
    hint: "It is neither queued nor finished in ComfyUI anymore, so nothing will come of it. Generate again once ComfyUI is running.",
    fix: "retry"
  },
  {
    test: /ECONNREFUSED|fetch failed|socket hang up|ETIMEDOUT|TimeoutError|aborted due to timeout|stopped answering/i,
    title: "Lost the connection to ComfyUI",
    hint: "ComfyUI stopped answering mid-run. Check that it is still running, then try again.",
    fix: "retry"
  }
];

const noOutputTitle = "No image was saved";
const learnedTitle = "Needs a separate part";
const genericTitle = "Generation failed";

/** Every headline a failure can have, each a section of TROUBLESHOOTING.md. */
export const failureTitles = [...hints.map((item) => item.title), noOutputTitle, learnedTitle, genericTitle];

/** The TROUBLESHOOTING.md anchor for a headline, the way GitHub makes it from the heading. */
export function troubleshootingAnchor(title = "") {
  return String(title).trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
}

/** Which part a loader node reads, so a broken file can be named by what it is. */
const parts = [
  [/^VAELoader/i, "VAE"],
  [/^(CLIPLoader|DualCLIPLoader|TripleCLIPLoader|QuadrupleCLIPLoader|CLIPVisionLoader)/i, "text encoder"],
  [/^Lora/i, "LoRA"],
  [/^(UNETLoader|UnetLoaderGGUF|DiffusionModelLoader)/i, "model"],
  [/^(CheckpointLoader|ImageOnlyCheckpointLoader)/i, "checkpoint"],
  [/^UpscaleModelLoader/i, "upscale model"],
  [/^ControlNetLoader/i, "ControlNet"]
];

function partOf(nodeType) {
  return parts.find(([test]) => test.test(nodeType))?.[1] || "";
}

/** The model file an error names, as just its file name. */
function fileIn(text) {
  const match = String(text || "").match(/([^\\/\s"'`:]+\.(?:safetensors|sft|ckpt|pt|pth|bin|gguf))\b/i);
  return match ? match[1] : "";
}

/** The node class a "missing node" error names, from ComfyUI's validation answer or its message. */
function missingNodeIn(text) {
  const value = String(text || "");
  const match = value.match(/"class_type":\s*"([^"]+)"/) || value.match(/Node '([^']+)' not found/) || value.match(/Node (?:type )?'?([\w.-]+)'? does not exist/);
  return match ? match[1] : "";
}

/** The first line that says something, without Python's "Exception:" noise. */
function headline(text) {
  const line = String(text || "").split(/\r?\n/).map((item) => item.trim()).find(Boolean) || "";
  return line.replace(/^(\w+(Error|Exception)):\s*/, "").slice(0, 240);
}

/**
 * `message` is ComfyUI's own text, kept whole as `detail`; `friendly`, when
 * given, is the plain version shown instead of its first line. `fix` names
 * the one-click way out the viewer offers (memory, redownload, rescan, node,
 * retry), and `missingNode` the class a missing-node error is about.
 */
export function describeFailure({ message = "", friendly = "", nodeType = "", nodeId = "", exceptionType = "", traceback = [], learned = "", noOutput = false } = {}) {
  const raw = String(message || "ComfyUI execution failed");
  if (noOutput) {
    return {
      title: noOutputTitle,
      help: troubleshootingAnchor(noOutputTitle),
      summary: raw,
      hint: "The run ended without an image HEISS UI can show. The workflow may end in a preview node instead of Save Image, or ComfyUI skipped a step. Check the workflow's output, or run it once in ComfyUI to see what it does.",
      nodeType: "", nodeId: "", exceptionType: "", detail: raw, traceback: "", at: Date.now()
    };
  }
  const match = hints.find((item) => item.test.test(`${exceptionType} ${raw}`));
  const trace = (Array.isArray(traceback) ? traceback.join("") : String(traceback || "")).split(/\r?\n/).filter(Boolean).slice(-40).join("\n");
  const damaged = !learned && match === hints[0];
  const part = partOf(nodeType);
  const file = fileIn(`${raw}\n${trace}`);
  return {
    title: learned ? learnedTitle : damaged && part ? `The ${part} file is damaged` : match?.title || genericTitle,
    // "The VAE file is damaged" is explained under the general damaged-file heading.
    help: troubleshootingAnchor(learned ? learnedTitle : match?.title || genericTitle),
    summary: learned || (damaged ? `${file || "A model file"} could not be read. It may not have finished downloading.` : headline(friendly || raw)) || "ComfyUI execution failed",
    hint: learned ? "" : match?.hint || "",
    fix: learned ? "rescan" : match?.fix || "",
    ...(match?.fix === "node" && missingNodeIn(raw) ? { missingNode: missingNodeIn(raw) } : {}),
    nodeType: String(nodeType || ""),
    nodeId: String(nodeId || ""),
    file,
    exceptionType: String(exceptionType || ""),
    detail: raw.slice(0, 4000),
    traceback: trace.slice(0, 8000),
    at: Date.now()
  };
}

/**
 * Turns a ComfyUI failure into something a person can act on: a short
 * headline, a plain hint for the errors people actually hit, and the full
 * detail (node, exception, traceback) kept for copying into a bug report.
 */

const hints = [
  {
    test: /header is too large|incomplete metadata|MetadataIncompleteBuffer|invalid header|Error while deserializing header/i,
    title: "A model file is damaged or incomplete",
    hint: "ComfyUI could not read a .safetensors file. It is usually a download that stopped early, or a web page saved under a model's name. Delete that file and download it again."
  },
  {
    test: /out of memory|CUDA error: out of memory|OutOfMemoryError|MPS backend out of memory|Allocation on device/i,
    title: "The GPU ran out of memory",
    hint: "Try a smaller size, fewer images per run, or a lighter model. Clear cache in Settings frees what ComfyUI still holds."
  },
  {
    test: /Value not in list/i,
    title: "ComfyUI does not have a file this run asked for",
    hint: "A model, LoRA, text encoder or VAE picked here is not in ComfyUI's folders (anymore). Rescan models, or pick another one."
  },
  {
    test: /mat1 and mat2 shapes cannot be multiplied|size mismatch|shape .* is invalid for input|Error\(s\) in loading state_dict/i,
    title: "Parts that do not fit together",
    hint: "The text encoder, VAE or a LoRA does not match this model's family. Check the picks in Advanced and the active LoRAs."
  },
  {
    test: /No such file or directory|FileNotFoundError|could not find/i,
    title: "A file went missing",
    hint: "Something this run needs was moved or deleted after ComfyUI listed it. Rescan models and try again."
  },
  {
    test: /Node .* does not exist|missing_node_type|Cannot execute because a node is missing/i,
    title: "A node is missing in ComfyUI",
    hint: "The workflow uses a custom node ComfyUI does not have. Install it, restart ComfyUI, and try again."
  },
  {
    test: /ECONNREFUSED|fetch failed|socket hang up|ETIMEDOUT/i,
    title: "Lost the connection to ComfyUI",
    hint: "ComfyUI stopped answering mid-run. Check that it is still running, then try again."
  }
];

/** The first line that says something, without Python's "Exception:" noise. */
function headline(text) {
  const line = String(text || "").split(/\r?\n/).map((item) => item.trim()).find(Boolean) || "";
  return line.replace(/^(\w+(Error|Exception)):\s*/, "").slice(0, 240);
}

export function describeFailure({ message = "", nodeType = "", nodeId = "", exceptionType = "", traceback = [], learned = "" } = {}) {
  const raw = String(message || "ComfyUI execution failed");
  const match = hints.find((item) => item.test.test(`${exceptionType} ${raw}`));
  const trace = (Array.isArray(traceback) ? traceback.join("") : String(traceback || "")).split(/\r?\n/).filter(Boolean).slice(-40).join("\n");
  return {
    title: learned ? "Needs a separate part" : match?.title || "Generation failed",
    summary: learned || headline(raw) || "ComfyUI execution failed",
    hint: learned ? "" : match?.hint || "",
    nodeType: String(nodeType || ""),
    nodeId: String(nodeId || ""),
    exceptionType: String(exceptionType || ""),
    detail: raw.slice(0, 4000),
    traceback: trace.slice(0, 8000),
    at: Date.now()
  };
}

/**
 * What an imported workflow can do besides make pictures. A workflow runs
 * every node in it with ComfyUI's rights, and some custom nodes run Python,
 * shell commands, read or write any file, or reach the internet. The import
 * review says so, node by node, before anything is saved.
 *
 * Two kinds of evidence: node classes known to do this (by name, and a few
 * name patterns), and inputs that hold a path outside ComfyUI's own folders
 * whatever the node is. It is a warning, not a verdict: an unknown node that
 * does something harmful quietly is not caught, which the review also says.
 */

// Known node classes, by what they can do.
const known = {
  code: [
    "Evaluate Integers", "Evaluate Floats", "Evaluate Strings", "Eval", "EvalNode", "Exec", "ExecNode",
    "Exec Python Code Script", "ExecutePython", "Execute Python", "PythonExec", "Python Exec", "RunPython", "PythonScript",
    "Python Script", "PythonCode", "Python Code", "PythonCodeNode", "CodeNode", "ExecuteCode", "Code Runner",
    "AnyNode", "AnyNodeLocal", "AnyNodeGemini", "AnyNodeOpenAI", "AnyNodeShowCode", "Shell", "ShellCommand",
    "RunCommand", "Run Command", "ExecuteCommand", "Terminal", "Subprocess"
  ],
  files: [
    "Load Text File", "Save Text File", "Text Load Line From File", "Text File History", "Image Save", "Image Load",
    "Load Image Batch", "Load Cache", "Cache Node", "Export API", "Create Video from Path", "Video Dump Frames",
    "Write to Video", "Write to GIF", "LoadImageFromPath", "Load Image From Path", "Load Image (Path)", "LoadImageFromDir",
    "LoadImagesFromDir", "LoadImagesFromDirectory", "VHS_LoadVideoPath", "VHS_LoadImagePath", "VHS_LoadImagesPath",
    "VHS_LoadAudio", "SaveTextFile", "SaveText", "Save Text", "SaveText|pysssss", "LoadText|pysssss", "Save Image w/Metadata",
    "SaveImageExtended", "Delete File", "DeleteFile", "Move File", "Copy File"
  ],
  network: [
    "HTTP Request", "HttpRequest", "LoadImageFromUrl", "LoadImageFromURL", "Load Image From URL", "Image From URL",
    "Webhook", "SendWebhook", "Discord Webhook", "Send To Discord", "Upload to S3", "Telegram Send"
  ]
};
const knownByName = new Map(Object.entries(known).flatMap(([kind, names]) => names.map((name) => [name.toLowerCase(), kind])));

// Names that give it away for classes not on the list.
const namePatterns = [
  { kind: "code", pattern: /(^|[\s_|-])(exec(ute)?|eval(uate)?|python|shell|subprocess)([\s_|-]|$)|execcode|pythoncode|runpython/i },
  { kind: "network", pattern: /(^|[\s_|-])(http|webhook|url)([\s_|-]|$)|fromurl|fromweb/i }
];

// Inputs that name a place on disk, and values that point outside ComfyUI's folders.
const pathInput = /(^|_)(path|dir|directory|folder|file|filepath|file_path|filename_path|output_path|save_path|image_path|video_path|audio_path)$/i;
const outsidePath = /^(\/|~[\\/]|[a-z]:[\\/]|\\\\)|(^|[\\/])\.\.([\\/]|$)/i;
const codeInput = /^(code|python_code|script|python|command|cmd|expression|expr)$/i;

const reasons = {
  code: "runs code on this computer",
  files: "reads or writes files outside ComfyUI’s own folders",
  network: "reaches the internet"
};

/**
 * The nodes of an API-format graph that can do more than make images:
 * [{ node, classType, title, kind, reason }], one per node, most serious first.
 */
export function workflowRisks(graph = {}) {
  const found = [];
  for (const [id, node] of Object.entries(graph || {})) {
    const classType = String(node?.class_type || "");
    if (!classType) continue;
    const title = String(node?._meta?.title || "");
    let kind = knownByName.get(classType.toLowerCase()) || "";
    let detail = "";
    if (!kind) kind = namePatterns.find(({ pattern }) => pattern.test(classType))?.kind || "";
    for (const [input, value] of Object.entries(node?.inputs || {})) {
      if (typeof value !== "string" || !value.trim()) continue;
      if (codeInput.test(input) && kind === "code") { detail = "its code is in the workflow"; break; }
      if (pathInput.test(input) && outsidePath.test(value.trim())) {
        if (!kind || kind === "network") kind = "files";
        detail = `${input}: ${value.trim().slice(0, 120)}`;
      }
    }
    if (!kind) continue;
    found.push({ node: String(id), classType, title: title && title !== classType ? title : "", kind, reason: reasons[kind], ...(detail ? { detail } : {}) });
  }
  const order = { code: 0, files: 1, network: 2 };
  return found.sort((a, b) => order[a.kind] - order[b.kind] || Number(a.node) - Number(b.node));
}

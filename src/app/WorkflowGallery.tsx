import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bot, Check, ClipboardPaste, Clock, FileJson, Film, Heart, Minus, Package, RefreshCw, Search, ShieldAlert, Trash2, Undo2, Upload, Wand2, X } from 'lucide-react';
import { Modal } from './Modal';
import type { ConfirmAction } from './useConfirmation';
import { apiJson, copyText } from './api';
import { cn } from './format';
import { BetaTag, Field, StudioSelect as Select } from './components';
import { Segmented } from './SettingsDialog';
import { workflowState } from './workflowStatus';
import { ModelSetup } from './ModelSetup';
import { ComfyRestart, useComfyRestarting } from './ComfyRestart';
import { scrollSideways, useWheelRef } from './wheel';
import type { ControlMapping, FileSwap, ImportSourceItem, Mode, Profile, SavedWorkflowItem, WorkflowImportPreview, WorkflowPreferences, WorkflowRisk, WorkflowSetupState, WorkflowSummary } from './types';
import { useThisComputer } from './device';
import type { ShowToast } from './toast';
import { CopyIcon, useCopyFeedback } from "./CopyFeedback";
import { agentPrompt, agentPromptFor, controlLabel, loraNodes, workflowControls } from "./workflowAgentGuide";

type ImportDraft = { raw: unknown; filename: string; preview: WorkflowImportPreview; metadata: WorkflowImportPreview["detected"]; approved: string[]; fileChoices: Record<string, boolean> };
type ImportRequest = { source: "file" | "history" | "saved" | "media"; workflow?: unknown; filename?: string; promptId?: string; path?: string; media?: string };

/** A control's first mapping: one prompt can go to several boxes, the first names it. */
function firstMapping(mapping?: ControlMapping | ControlMapping[]) {
  return Array.isArray(mapping) ? mapping[0] : mapping;
}

const controlNames: Record<string, string> = { prompt: "Prompt", negative: "Negative prompt", seed: "Seed", width: "Size", steps: "Steps", cfg: "Prompt strength", sampler: "Sampler", frames: "Frames", fps: "FPS", count: "Batch", model: "Model" };

/** What an import gives the studio, in a line: the controls found, images, LoRAs, the rest. */
function foundSummary(metadata: ImportDraft["metadata"]) {
  const parts = Object.keys(controlNames).filter((key) => metadata.controls[key]).map((key) => controlNames[key]);
  const images = metadata.mediaInputs?.length || 0;
  if (images) parts.push(images === 1 ? "an image input" : `${images} image inputs`);
  if (metadata.loraStack?.node) parts.push("LoRAs");
  const more = metadata.settings?.length || 0;
  return { parts, more };
}

function relativeTime(value = "") {
  const time = Date.parse(value);
  if (!time) return "";
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(time).toLocaleDateString([], { month: "short", day: "numeric" });
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Couldn’t read the file."));
    reader.readAsDataURL(file);
  });
}

const importableFile = (file: File) => /\.(json|png|webp|mp4|webm|mov)$/i.test(file.name) || /json|png|webp|video/i.test(file.type);
type Filter = "all" | "favorites" | "attention";

/** The file lines the setup panel already shows as rows (see custom-workflows.js workflowOptionIssues). */
const missingFileIssue = /^Missing (diffusion model|checkpoint|text encoder|VAE|upscale model|file):/;


function timeLabel(value = "") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function selectedNodeValue(value?: ControlMapping | ControlMapping[]) {
  const mapping = firstMapping(value);
  return mapping?.node && mapping?.input ? `${mapping.node}.${mapping.input}` : "__none";
}

/** A node as people know it: its canvas title, else its type, with the id to find it. */
function nodeName(nodes: ImportDraft["metadata"]["nodes"], id: string) {
  const node = nodes.find((item) => item.id === id);
  return node ? `${node.title || node.classType} #${id}` : `#${id}`;
}

/**
 * The honest summary of an import: which studio controls reach the workflow,
 * which don't (and so keep their saved values), and what was only guessed.
 */
function ImportFit({ item }: { item: ImportDraft }) {
  const { controls, guessed = [], nodes, kind, loraStack } = item.metadata;
  const relevant = workflowControls.filter((control) => control.editable && !(kind === "image" && (control.key === "frames" || control.key === "fps")) && !(kind === "video" && control.key === "count"));
  const connected = workflowControls.filter((control) => controls[control.key]);
  const unconnected = relevant.filter((control) => !controls[control.key] && !(control.key === "startImage" && item.metadata.mediaInputs?.length));
  const samplers = nodes.filter((node) => /Sampler/i.test(node.classType) && node.inputs.includes("steps"));
  const encoders = nodes.filter((node) => /TextEncode/i.test(node.classType) && (node.inputs.includes("text") || node.inputs.includes("prompt")));
  const loraLoaders = nodes.filter((node) => /lora/i.test(node.classType));
  const rgthree = nodes.find((node) => (Object.values(loraNodes) as string[]).includes(node.classType));
  const samplerNode = firstMapping(controls.seed)?.node || firstMapping(controls.steps)?.node;

  const notes: React.ReactNode[] = [];
  if (encoders.length > 2) notes.push(`${encoders.length} prompt nodes. Only the connected ones get your text; the others keep their saved text.`);
  if (samplers.length > 1 && samplerNode) notes.push(`${samplers.length} samplers. Only ${nodeName(nodes, samplerNode)} follows seed, steps and CFG; the others keep their saved values.`);
  if (loraStack?.node) notes.push(`LoRA picker connected to ${nodeName(nodes, loraStack.node)}.`);
  else if (rgthree) notes.push(`${rgthree.classType} found, but not connected to the LoRA picker. An AI agent can connect it (see below).`);
  else if (loraLoaders.length) notes.push("The LoRA picker only works with rgthree LoRA loaders. This workflow’s LoRAs stay as saved.");
  else notes.push("No LoRA picker. It needs an rgthree Power Lora Loader or Lora Loader Stack in the workflow.");

  return (
    <section className="wf-fit" aria-label="Connected controls">
      <div className="wf-fit-cols">
        <div>
          <h5>Follows the studio</h5>
          {connected.length ? (
            <ul>
              {connected.map((control) => (
                <li key={control.key}>
                  <Check size={12} aria-hidden="true" />
                  <strong>{control.label}</strong>
                  <span>{nodeName(nodes, firstMapping(controls[control.key])?.node || "")}{guessed.includes(control.key) ? " · found" : ""}</span>
                </li>
              ))}
            </ul>
          ) : <p>Nothing connected. It runs as saved, whatever you type.</p>}
        </div>
        <div>
          <h5>Stays as saved</h5>
          {unconnected.length ? (
            <ul className="is-off">
              {unconnected.map((control) => <li key={control.key}><Minus size={12} aria-hidden="true" /><strong>{control.label}</strong></li>)}
            </ul>
          ) : <p>Every studio control is connected.</p>}
        </div>
      </div>
      <ul className="wf-fit-notes">
        {notes.map((note, index) => <li key={index}>{note}</li>)}
        <li>Everything else runs as saved.</li>
      </ul>
    </section>
  );
}

/**
 * Nodes in an imported workflow that do more than make images: they run code,
 * read or write files outside ComfyUI's folders, or go online. Said plainly,
 * node by node, before the workflow is saved.
 */
function ImportRisks({ risks }: { risks: WorkflowRisk[] }) {
  return (
    <div className="wf-caution" role="note">
      <strong><ShieldAlert size={14} aria-hidden="true" /> This workflow can do more than make images</strong>
      <ul>
        {risks.map((risk) => (
          <li key={risk.node}>
            <code>{risk.title || risk.classType}</code> {risk.reason}{risk.detail ? <span> ({risk.detail})</span> : null}.
          </li>
        ))}
      </ul>
      <p>Its nodes run with the same access to this computer as ComfyUI. Import it only if you trust the source.</p>
    </div>
  );
}

/** Hands the job of fitting a workflow to an AI agent: a prompt that says what HEISS UI can and can't connect. */
function AgentGuide({ onCopy, copied, forWorkflow }: { onCopy: () => void; copied: boolean; forWorkflow?: boolean }) {
  return (
    <div className="wf-agent">
      <span className="wf-agent-icon" aria-hidden="true"><Bot size={16} /></span>
      <div className="wf-agent-text">
        <strong>{forWorkflow ? "Let an AI agent fix the connections" : "Prepare a workflow with an AI agent"}</strong>
        <span>{forWorkflow
          ? "Copies a prompt with this workflow and its connections. Paste it into Claude, ChatGPT or another agent, then import the JSON it returns."
          : "Copies a prompt that explains what can be connected. Paste it into Claude, ChatGPT or another agent with your workflow JSON, then import what it returns."}</span>
      </div>
      <button type="button" className="btn" onClick={onCopy}><CopyIcon copied={copied} size={13} /> {copied ? "Copied" : forWorkflow ? "Copy for an agent" : "Copy prompt"}</button>
    </div>
  );
}

function WorkflowThumbnail({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed
    ? <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
    : <span className="wf-thumb-empty" aria-hidden="true"><i /><i /><i /><i /><Wand2 size={18} /></span>;
}

function StatusBadge({ validation }: { validation: WorkflowSummary["validation"] }) {
  const comfyRestarting = useComfyRestarting();
  const status = workflowState(validation, comfyRestarting);
  return <span className={cn("wf-status", `is-${status.state}`)}><i aria-hidden="true" />{status.label}</span>;
}

/** The one question an import may ask: which text is the prompt, shown as the texts themselves. */
function PromptChoice({ item, onPick }: { item: ImportDraft; onPick: (mappings: ControlMapping[]) => void }) {
  const question = item.metadata.question;
  if (!question) return null;
  const current = selectedNodeValue(item.metadata.controls.prompt);
  return (
    <section className="wf-question" aria-label={question.text}>
      <h5>{question.text}</h5>
      <div className="wf-question-options" role="radiogroup">
        {question.candidates.map((candidate) => {
          const picked = current === `${candidate.node}.${candidate.input}`;
          return (
            <button key={candidate.id} type="button" role="radio" aria-checked={picked} className={cn("wf-question-option", picked && "active")} onClick={() => onPick(candidate.mappings)}>
              <span className="wf-question-title">{candidate.title}</span>
              <span className="wf-question-text">{candidate.text || <em>empty</em>}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The add-ons an import needs. Registry packs are just listed: they install on
 * their own. A pack from outside the registry gets a checkbox, off until ticked.
 */
function ImportAddOns({ item, onApprove }: { item: ImportDraft; onApprove: (key: string, on: boolean) => void }) {
  const packs = item.preview.packs?.packs || [];
  const unresolved = item.preview.packs?.unresolved || [];
  if (!packs.length && !unresolved.length) return null;
  const registry = packs.filter((pack) => pack.registry);
  const outside = packs.filter((pack) => !pack.registry);
  return (
    <section className="wf-addons" aria-label="Add-ons">
      {registry.length ? (
        <p className="wf-addons-line"><Package size={13} aria-hidden="true" /> Gets {registry.map((pack) => pack.name).join(", ")} from the ComfyUI registry when you import.</p>
      ) : null}
      {outside.map((pack) => (
        <label key={pack.key} className="wf-addons-outside">
          <input type="checkbox" checked={item.approved.includes(pack.key)} onChange={(event) => onApprove(pack.key, event.target.checked)} />
          <span>
            <strong>Also install {pack.name}?</strong>
            <span>It isn’t in the ComfyUI registry; it comes straight from {pack.repository.replace(/^https:\/\//, "")}.</span>
          </span>
        </label>
      ))}
      {unresolved.length ? (
        <p className="wf-addons-line is-quiet">Nobody publishes {unresolved.length === 1 ? "a node" : "nodes"} it uses ({unresolved.slice(0, 4).join(", ")}{unresolved.length > 4 ? "…" : ""}). It may still run if you have them in ComfyUI.</p>
      ) : null}
    </section>
  );
}

const fileName = (file = "") => file.split(/[\\/]/).pop() || file;
const swapKey = (swap: { node: string; input: string }) => `${swap.node}.${swap.input}`;

/** What an import does about model files ComfyUI doesn't list: the file stand-ins and downloads it will use, in plain lines. */
export function importFileDecisions(item: ImportDraft) {
  const plan = item.preview.models;
  if (!plan) return { fileSwaps: [] as FileSwap[], skippedLoras: [] as string[], loraEntriesOff: [] as ModelPlanEntryOff[], downloads: [] as string[] };
  const chosen = (swap: FileSwap, fallback: boolean) => item.fileChoices[swapKey(swap)] ?? fallback;
  const fileSwaps = [
    ...plan.swaps,
    ...plan.suggestions.filter((swap) => chosen(swap, false)),
    ...plan.substitutes.filter((swap) => chosen(swap, true)),
    // A download lands as its plain name; a workflow that named a subfolder is pointed at it.
    ...plan.downloads.map((download) => ({ node: download.node, input: download.input, file: download.file, wanted: "", reason: "download" }))
      .filter((swap) => {
        const current = (item.preview.graph as Record<string, { inputs?: Record<string, unknown> }> | undefined)?.[swap.node]?.inputs?.[swap.input];
        return typeof current === "string" && current !== swap.file;
      })
  ];
  return { fileSwaps, skippedLoras: plan.skippedLoras.map((entry) => entry.node), loraEntriesOff: plan.loraEntriesOff, downloads: plan.downloads.map((download) => download.id) };
}
type ModelPlanEntryOff = { node: string; key: string; lora: string };

/**
 * Model files, said quietly: what's used from this computer, what downloads
 * with the import, what runs without. Only a near-name file asks, and a
 * stand-in model can be switched off.
 */
function ImportFiles({ item, onChoose }: { item: ImportDraft; onChoose: (key: string, on: boolean) => void }) {
  const plan = item.preview.models;
  if (!plan) return null;
  const lines: React.ReactNode[] = [];
  if (plan.swaps.length) lines.push(<p key="swaps" className="wf-found is-quiet">Uses your own {plan.swaps.length === 1 ? `copy of ${fileName(plan.swaps[0].wanted)}` : `copies of ${plan.swaps.length} files`}, filed in another folder.</p>);
  if (plan.downloads.length) lines.push(<p key="downloads" className="wf-found is-quiet">Downloads {plan.downloads.map((download) => `${fileName(download.file)}${download.size ? ` (${download.size})` : ""}`).join(", ")} from Hugging Face when you import.</p>);
  if (plan.skippedLoras.length || plan.loraEntriesOff.length) {
    const names = [...plan.skippedLoras.map((entry) => entry.file), ...plan.loraEntriesOff.map((entry) => entry.lora)].map(fileName);
    lines.push(<p key="loras" className="wf-found is-quiet">Runs without {names.join(", ")}: {names.length === 1 ? "that LoRA isn’t" : "those LoRAs aren’t"} on this computer.</p>);
  }
  return (
    <>
      {lines}
      {[...plan.substitutes.map((swap) => ({ swap, fallback: true, text: <>Use your <strong>{fileName(swap.file)}</strong> in place of {fileName(swap.wanted)}, which isn’t here</> })),
        ...plan.suggestions.map((swap) => ({ swap, fallback: false, text: <>Use your <strong>{fileName(swap.file)}</strong> for {fileName(swap.wanted)}? The names are close.</> }))].map(({ swap, fallback, text }) => (
        <label key={swapKey(swap)} className="wf-addons-outside">
          <input type="checkbox" checked={item.fileChoices[swapKey(swap)] ?? fallback} onChange={(event) => onChoose(swapKey(swap), event.target.checked)} />
          <span>{text}</span>
        </label>
      ))}
      {plan.unresolved.length ? <p className="wf-found is-quiet">Still needs {plan.unresolved.map((entry) => `${fileName(entry.file)} (models/${entry.folder})`).join(", ")}. HEISS couldn’t find {plan.unresolved.length === 1 ? "it" : "them"} to download.</p> : null}
    </>
  );
}

/**
 * Add-on installs in the background: one quiet line while it works, nothing
 * once it's done, and an offer to undo only when something broke.
 */
function SetupStrip({ setup, onUndo, onDismiss, busy }: { setup: WorkflowSetupState; onUndo: () => void; onDismiss: () => void; busy: boolean }) {
  if (setup.status === "running") {
    return <div className="wf-setup" role="status"><RefreshCw size={13} className="spin" aria-hidden="true" /><span>{setup.step || "Setting up"}…</span></div>;
  }
  if (setup.status === "regressed") {
    const broke = setup.health?.broke?.length ? setup.health.broke.join(", ") : "other nodes";
    return (
      <div className="wf-setup is-attention" role="alert">
        <span>Installing {setup.packs.map((pack) => pack.name).join(", ")} stopped {broke} from loading.</span>
        <div className="wf-setup-actions">
          <button type="button" className="btn" disabled={busy} onClick={onUndo}><Undo2 size={13} /> Undo the install</button>
          <button type="button" className="btn is-ghost" disabled={busy} onClick={onDismiss}>Keep it anyway</button>
        </div>
      </div>
    );
  }
  if (setup.status === "rolled-back" || setup.status === "error" || setup.status === "needs-restart") {
    return (
      <div className={cn("wf-setup", setup.status !== "needs-restart" && "is-attention")} role="status">
        <span>{setup.message}</span>
        {setup.status === "needs-restart" ? <ComfyRestart compact className="wf-restart" /> : null}
        <button type="button" className="btn is-ghost" onClick={onDismiss}>OK</button>
      </div>
    );
  }
  return null;
}

/** Recent runs from ComfyUI's history: the workflow behind a picture you made, one tap away. */
function RecentRuns({ items, onPick, disabled }: { items: ImportSourceItem[]; onPick: (item: ImportSourceItem) => void; disabled: boolean }) {
  return (
    <div className="wf-recent">
      {items.map((item) => (
        <button key={item.id} type="button" className="wf-recent-tile" disabled={disabled} onClick={() => onPick(item)} title={`${item.name}${item.runs > 1 ? `, run ${item.runs} times` : ""}`}>
          <span className="wf-recent-thumb">
            {item.thumbnail && !item.video ? <img src={item.thumbnail} alt="" loading="lazy" draggable={false} /> : <span aria-hidden="true">{item.video ? <Film size={18} /> : <Wand2 size={18} />}</span>}
          </span>
          <span className="wf-recent-copy">
            <strong>{item.name}</strong>
            <span><Clock size={10} aria-hidden="true" /> {relativeTime(item.at) || "earlier"}{item.runs > 1 ? ` · ${item.runs} runs` : ""}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function WorkflowGallery({ view }: { view: any }) {
  const comfyRestarting = useComfyRestarting();
  // Importing and deleting workflow files happens at the computer running HEISS UI.
  const thisComputer = useThisComputer();
  const {
    confirmAction, mode, onClose, refreshModels, refreshWorkflows, selectWorkflow, setWorkflowPreferences,
    showToast, workflowPreferences, workflows, setWorkflows, model, chooseModel, models
  } = view as {
    confirmAction: ConfirmAction;
    mode: Mode;
    onClose: () => void;
    refreshModels: (notify?: boolean) => void;
    refreshWorkflows: () => void;
    selectWorkflow: (id: string) => void;
    setWorkflowPreferences: (prefs: WorkflowPreferences) => void;
    showToast: ShowToast;
    workflowPreferences: WorkflowPreferences;
    workflows: WorkflowSummary[];
    setWorkflows: (value: WorkflowSummary[] | ((current: WorkflowSummary[]) => WorkflowSummary[])) => void;
    model: string;
    chooseModel: (id: string) => void;
    models: { profiles: Profile[] } | null;
  };
  const [kind, setKind] = useState<Mode>(mode);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(model || workflows.find((item) => item.kind === mode)?.id || "");
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<"choose" | "review">("choose");
  const [pasteJson, setPasteJson] = useState("");
  const [imports, setImports] = useState<ImportDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // The filter pills scroll sideways with a plain wheel; their scrollbar is hidden.
  const filtersWheelRef = useWheelRef<HTMLDivElement>(scrollSideways);

  const ofKind = useMemo(() => workflows.filter((item) => item.kind === kind), [kind, workflows]);
  const attentionCount = ofKind.filter((item) => !item.validation.ok).length;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ofKind.filter((item) => {
      if (filter === "favorites" && !item.favorite) return false;
      if (filter === "attention" && item.validation.ok) return false;
      if (!q) return true;
      return [item.name, item.description, item.family, ...(item.tags || [])].join(" ").toLowerCase().includes(q);
    });
  }, [filter, ofKind, query]);
  const selected = filtered.find((item) => item.id === selectedId) || filtered[0] || null;
  const selectedStatus = selected ? workflowState(selected.validation, comfyRestarting) : null;
  // An import's family, from the ones installed here: it shares their LoRA stacks. "Its own" keeps it apart.
  const familyOptions = (current = "") => {
    const known = new Map<string, string>();
    for (const profile of models?.profiles || []) {
      if (profile.family && profile.family !== "custom" && !profile.id.startsWith("custom:")) known.set(profile.family, profile.familyName || profile.family);
    }
    if (current && current !== "custom" && !known.has(current)) known.set(current, current);
    return [{ label: "Its own", value: "custom" }, ...[...known].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ label, value }))];
  };
  // The same setup panel as the sidebar, for the model this workflow runs.
  const selectedProfile = selected ? models?.profiles.find((profile) => profile.id === selected.profileId) : undefined;
  // What the setup panel is about: the model's profile, or an imported workflow and the files its loaders name.
  const setupSubject = selectedProfile || (selected ? { id: selected.id, displayName: selected.name, missing: selected.validation.missingParts || [] } : undefined);
  const settingUp = Boolean(setupSubject?.missing?.length);

  const openImport = () => { setImportStep(imports.length ? "review" : "choose"); setImportOpen(true); };
  const closeImport = () => { setImportOpen(false); setImports([]); setImportStep("choose"); setPasteJson(""); };
  const checkAgain = async () => {
    setChecking(true);
    try { refreshModels(false); await Promise.resolve(refreshWorkflows()); } finally { window.setTimeout(() => setChecking(false), 600); }
  };
  const nodesCopy = useCopyFeedback();
  const agentCopy = useCopyFeedback();
  const copyAgent = (text: string, key: string) => agentCopy.copyWith(async () => {
    const ok = await copyText(text);
    if (!ok) showToast("Copy failed", "error");
    return ok;
  }, key);
  const copyMissing = (nodes: string[]) => nodesCopy.copyWith(async () => {
    const ok = await copyText(nodes.join("\n"));
    if (!ok) showToast("Copy failed", "error");
    return ok;
  });

  const updateFavorites = async (id: string) => {
    const favorites = workflowPreferences.favorites.includes(id)
      ? workflowPreferences.favorites.filter((item) => item !== id)
      : [...workflowPreferences.favorites, id];
    const data = await apiJson<{ preferences: WorkflowPreferences }>("/api/workflows/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorites })
    });
    setWorkflowPreferences(data.preferences);
    refreshWorkflows();
  };

  const useWorkflow = (workflow: WorkflowSummary) => {
    // A built-in model that only lacks parts can be picked: its setup panel then sits in the sidebar.
    const settingUp = models?.profiles.some((profile) => profile.id === workflow.profileId && profile.missing?.length);
    if (!workflow.validation.ok && !settingUp) {
      showToast("This workflow needs setup first", "error");
      return;
    }
    selectWorkflow(workflow.profileId);
    onClose();
  };

  const deleteWorkflow = async (workflow: WorkflowSummary) => {
    if (!workflow.deleteId) return;
    if (!await confirmAction({ title: `Delete ${workflow.name}?`, description: "To get it back, import its JSON again.", action: "Delete", destructive: true })) return;
    setBusy(true);
    try {
      await apiJson(`/api/workflows/${encodeURIComponent(workflow.deleteId)}`, { method: "DELETE" });
      setWorkflows((current) => current.filter((item) => item.id !== workflow.id && item.profileId !== workflow.profileId));
      if (selectedId === workflow.id) {
        const fallback = workflows.find((item) => item.id !== workflow.id && item.kind === mode && item.validation.ok);
        setSelectedId(fallback?.id || "");
      }
      if (model === workflow.profileId) {
        const fallbackProfile = models?.profiles.find((profile) => profile.id !== workflow.profileId && profile.kind === mode);
        if (fallbackProfile) chooseModel(fallbackProfile.id);
      }
      showToast("Workflow deleted", "removed");
      refreshModels(false);
      refreshWorkflows();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn’t delete the workflow", "error");
    } finally {
      setBusy(false);
    }
  };

  const [sources, setSources] = useState<{ loading: boolean; comfy: boolean; recent: ImportSourceItem[]; saved: SavedWorkflowItem[] }>({ loading: false, comfy: true, recent: [], saved: [] });
  const [showAllSaved, setShowAllSaved] = useState(false);
  const [setup, setSetup] = useState<WorkflowSetupState | null>(null);

  // The picker opens on what ComfyUI already has: recent runs and saved workflows.
  useEffect(() => {
    if (!importOpen || importStep !== "choose") return;
    let alive = true;
    setSources((current) => ({ ...current, loading: true }));
    apiJson<{ comfy: boolean; recent: ImportSourceItem[]; saved: SavedWorkflowItem[] }>("/api/workflows/sources")
      .then((data) => { if (alive) setSources({ loading: false, comfy: data.comfy, recent: data.recent || [], saved: data.saved || [] }); })
      .catch(() => { if (alive) setSources({ loading: false, comfy: false, recent: [], saved: [] }); });
    return () => { alive = false; };
  }, [importOpen, importStep]);

  // A setup started earlier (or in another tab) is picked up, and followed while it runs.
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const poll = async () => {
      const data = await apiJson<{ setup: WorkflowSetupState | null }>("/api/workflows/setup").catch(() => null);
      if (!alive) return;
      const next = data?.setup || null;
      setSetup((current) => {
        if (current?.status === "running" && next && next.status === "done") {
          showToast(`${next.workflowName || "Workflow"} is ready`, "success");
          refreshModels(false);
          refreshWorkflows();
        }
        // A finished setup from before this window opened isn't news.
        return current || next?.status === "running" ? next : null;
      });
      if (next?.status === "running") timer = window.setTimeout(poll, 1500);
    };
    if (thisComputer && (setup?.status === "running" || !setup)) poll();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [setup?.status, setup?.id, thisComputer]);

  const previewRequest = async (request: ImportRequest, raw: unknown = null) => {
    const data = await apiJson<{ preview: WorkflowImportPreview }>("/api/workflows/import/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request)
    });
    setImports((current) => [...current, { raw, filename: request.filename || data.preview.detected.name, preview: data.preview, metadata: data.preview.detected, approved: [], fileChoices: {} }]);
  };

  const pickSource = async (request: ImportRequest) => {
    setBusy(true);
    try {
      await previewRequest(request);
      setImportStep("review");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn’t read the workflow", "error");
    } finally {
      setBusy(false);
    }
  };

  const readFiles = async (files: FileList | File[]) => {
    setBusy(true);
    try {
      for (const file of Array.from(files).filter(importableFile)) {
        if (/\.json$/i.test(file.name) || /json/i.test(file.type)) {
          const raw = JSON.parse(await file.text());
          await previewRequest({ source: "file", workflow: raw, filename: file.name }, raw);
        } else {
          // An image or video ComfyUI made: the workflow rides along inside it.
          await previewRequest({ source: "media", media: await readAsDataUrl(file), filename: file.name });
        }
      }
      setImportOpen(true);
      setImportStep("review");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn’t read the workflow", "error");
    } finally {
      setBusy(false);
    }
  };

  const previewPaste = async () => {
    if (!pasteJson.trim()) return;
    setBusy(true);
    try {
      const raw = JSON.parse(pasteJson);
      await previewRequest({ source: "file", workflow: raw, filename: "pasted-workflow.json" }, raw);
      setPasteJson("");
      setImportStep("review");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "That isn’t valid workflow JSON", "error");
    } finally {
      setBusy(false);
    }
  };

  const saveImports = async () => {
    setBusy(true);
    try {
      const packs = new Map<string, NonNullable<WorkflowImportPreview["packs"]>["packs"][number]>();
      for (const item of imports) {
        const { nodes: _nodes, guessed: _guessed, question: _question, confidence: _confidence, ...metadata } = item.metadata;
        const files = importFileDecisions(item);
        await apiJson("/api/workflows/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ graph: item.preview.graph, filename: item.filename, metadata: { ...metadata, source: item.preview.source || "file", fileSwaps: files.fileSwaps, skippedLoras: files.skippedLoras, loraEntriesOff: files.loraEntriesOff } })
        });
        // Its model files download in the background, in the usual downloads list.
        for (const id of files.downloads) {
          await apiJson("/api/models/downloads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }).catch((error) => showToast(error instanceof Error ? error.message : "Couldn’t start a download", "error"));
        }
        for (const pack of item.preview.packs?.packs || []) {
          if (pack.registry || item.approved.includes(pack.key)) packs.set(pack.key, pack);
        }
      }
      const count = imports.length;
      const names = imports.map((item) => item.metadata.name);
      const approved = imports.flatMap((item) => item.approved);
      setImports([]);
      setImportOpen(false);
      refreshModels(false);
      refreshWorkflows();
      if (packs.size) {
        // Add-ons install in the background; the line at the top follows it.
        const data = await apiJson<{ setup: WorkflowSetupState }>("/api/workflows/setup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ packs: [...packs.values()], approved, workflowName: names.join(", ") })
        });
        setSetup(data.setup);
        showToast(count === 1 ? "Workflow imported. Getting its add-ons…" : `${count} workflows imported. Getting their add-ons…`, "success");
      } else {
        showToast(count === 1 ? "Workflow imported" : `${count} workflows imported`, "success");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn’t import the workflow", "error");
    } finally {
      setBusy(false);
    }
  };

  const undoSetup = async () => {
    if (!setup?.snapshotId) return;
    setBusy(true);
    try {
      await apiJson("/api/workflows/setup/undo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ snapshotId: setup.snapshotId }) });
      setSetup(null);
      showToast("Undone. ComfyUI is restarting with what it had before.", "success");
      refreshModels(false);
      refreshWorkflows();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn’t undo the install", "error");
    } finally {
      setBusy(false);
    }
  };

  const answerPrompt = (index: number, mappings: ControlMapping[]) => {
    setImports((current) => current.map((item, itemIndex) => itemIndex === index ? {
      ...item,
      metadata: { ...item.metadata, controls: { ...item.metadata.controls, prompt: mappings.length === 1 ? mappings[0] : mappings }, confidence: { prompt: "high" } }
    } : item));
  };

  const chooseFile = (index: number, key: string, on: boolean) => {
    setImports((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, fileChoices: { ...item.fileChoices, [key]: on } } : item));
  };

  const approvePack = (index: number, key: string, on: boolean) => {
    setImports((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, approved: on ? [...new Set([...item.approved, key])] : item.approved.filter((entry) => entry !== key) } : item));
  };

  const updateImport = (index: number, patch: Partial<WorkflowImportPreview["detected"]>) => {
    setImports((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, metadata: { ...item.metadata, ...patch } } : item));
  };

  const updateImportControl = (index: number, key: string, value: string) => {
    const [node, input] = value.split(".");
    setImports((current) => current.map((item, itemIndex) => itemIndex === index ? {
      ...item,
      metadata: (() => {
        const controls = { ...item.metadata.controls };
        if (node && input) controls[key] = { node, input };
        else delete controls[key];
        const guessed = (item.metadata.guessed || []).filter((entry) => entry !== key);
        const mediaInputs = key === "startImage"
          ? node && input
            ? [{ ...(item.metadata.mediaInputs?.[0] || { id: "reference", kind: "image" as const, label: "Reference image", required: false, min: 0, max: 1 }), control: { node, input } }, ...(item.metadata.mediaInputs || []).slice(1)]
            : []
          : item.metadata.mediaInputs;
        return { ...item.metadata, controls, guessed, mediaInputs };
      })()
    } : item));
  };

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      size="wide"
      busy={busy}
      className="workflow-gallery"
      bodyClassName="wf-layout"
      title="Workflows"
      description="Choose what the next generation runs on, or import a ComfyUI workflow."
      headerActions={thisComputer ? <button className="btn is-primary" onClick={openImport}><Upload size={15} /><span>Import</span></button> : undefined}
      contentProps={{
        onDragEnter: (event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } },
        onDragOver: (event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); },
        onDragLeave: (event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); },
        onDrop: (event) => { event.preventDefault(); setDragging(false); const files = Array.from(event.dataTransfer.files).filter(importableFile); if (files.length && thisComputer) readFiles(files); }
      }}
    >
      <section className={cn("wf-browse", mobileDetailsOpen && "is-hidden-mobile")}>
        {setup ? <SetupStrip setup={setup} busy={busy} onUndo={undoSetup} onDismiss={() => setSetup(null)} /> : null}
        <div className="wf-toolbar">
          <label className="wf-search">
            <Search size={14} />
            <input className="is-framed" aria-label="Search workflows" value={query} placeholder="Search workflows" onChange={(event) => setQuery(event.target.value)} />
            {query ? <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={13} /></button> : null}
          </label>
          <Segmented label="Kind" value={kind} onChange={(next) => { setKind(next); setFilter("all"); }} options={[{ value: "image", label: "Image" }, { value: "video", label: <>Video<BetaTag /></> }]} />
        </div>
        <div ref={filtersWheelRef} className="wf-filters" role="radiogroup" aria-label="Filter workflows">
          {([["all", `All ${ofKind.length}`], ["favorites", "Favorites"], ...(attentionCount ? [["attention", `Needs attention ${attentionCount}`]] : [])] as Array<[Filter, string]>).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={filter === value} className={cn(filter === value && "active")} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </div>
        {filtered.length ? (
          <div className="wf-grid">
            {filtered.map((workflow) => (
              <button
                key={workflow.id}
                type="button"
                aria-pressed={workflow.id === selected?.id}
                className={cn("wf-card", workflow.id === selected?.id && "active")}
                onClick={() => { setSelectedId(workflow.id); setMobileDetailsOpen(true); }}
                onDoubleClick={() => useWorkflow(workflow)}
              >
                <span className="wf-thumb"><WorkflowThumbnail key={workflow.thumbnail} src={workflow.thumbnail} /></span>
                {workflow.favorite ? <span className="wf-fav" aria-label="Favorite"><Heart size={12} fill="currentColor" /></span> : null}
                {workflow.profileId === model ? <span className="wf-current">In use</span> : null}
                <span className="wf-card-copy">
                  <strong>{workflow.name}</strong>
                  <span><em className={cn("wf-origin", workflow.source === "builtin" && "is-builtin")}>{workflow.source === "builtin" ? "Built in" : "Imported"}</em>{workflow.familyName || workflow.family}</span>
                </span>
                {workflow.validation.ok && !workflow.validation.unverified ? null : <StatusBadge validation={workflow.validation} />}
              </button>
            ))}
          </div>
        ) : (
          <div className="wf-empty">
            <Search size={20} />
            <h3>{query ? "Nothing matches" : filter === "favorites" ? "No favorites yet" : `No ${kind} workflows yet`}</h3>
            <p>{query ? "Try another name or clear the search." : filter === "favorites" ? "Tap the heart on a workflow to add it here." : "Import a ComfyUI workflow."}</p>
            {query ? <button className="btn" onClick={() => setQuery("")}>Clear search</button> : filter === "favorites" ? <button className="btn" onClick={() => setFilter("all")}>Show all</button> : thisComputer ? <button className="btn is-primary" onClick={openImport}><Upload size={14} /> Import workflow</button> : null}
          </div>
        )}
      </section>

      <aside className={cn("wf-detail", mobileDetailsOpen && "is-open-mobile")}>
        {selected && selectedStatus ? (
          <>
            <button type="button" className="btn is-ghost wf-back" onClick={() => setMobileDetailsOpen(false)}><ArrowLeft size={15} /> All workflows</button>
            <div className="wf-detail-thumb"><WorkflowThumbnail key={selected.thumbnail} src={selected.thumbnail} /></div>
            <div className="wf-detail-head">
              <h3>{selected.name}</h3>
              <button type="button" className={cn("wf-heart", selected.favorite && "active")} aria-pressed={Boolean(selected.favorite)} aria-label={selected.favorite ? "Remove from favorites" : "Add to favorites"} disabled={busy} onClick={() => updateFavorites(selected.id).catch((error) => showToast(error instanceof Error ? error.message : "Couldn’t update favorites", "error"))}>
                <Heart size={16} fill={selected.favorite ? "currentColor" : "none"} />
              </button>
            </div>
            {selected.description ? <p className="wf-detail-desc">{selected.description}</p> : null}

            <div className={cn("wf-health", `is-${selectedStatus.state}`)}>
              <StatusBadge validation={selected.validation} />
              {/* With the setup panel below, its rows say it; the summary and issue lines would repeat them. */}
              {settingUp ? null : <p>{selectedStatus.detail}</p>}
              {setupSubject ? (
                <ModelSetup key={setupSubject.id} variant="gallery" profile={setupSubject} alsoNeedsNodes={Boolean(!selectedProfile && selected.validation.missingNodes?.length)} showToast={showToast} onInstalled={() => { refreshModels(false); refreshWorkflows(); }} />
              ) : null}
              {selected.validation.missingNodes?.length ? (
                <div className="wf-missing">
                  <ul>{selected.validation.missingNodes.map((node) => <li key={node}><code>{node}</code></li>)}</ul>
                  <button className="btn is-ghost" onClick={() => copyMissing(selected.validation.missingNodes || [])}><CopyIcon copied={Boolean(nodesCopy.copied)} size={13} /> {nodesCopy.copied ? "Copied" : "Copy names"}</button>
                </div>
              ) : null}
              {[...(selectedProfile?.missing?.length ? [] : selected.validation.issues.filter((issue) => !(selected.validation.missingNodes?.length && issue.startsWith("Missing node class:")) && !(settingUp && missingFileIssue.test(issue)))), ...(selected.validation.warnings || [])].map((issue) => <p className="wf-issue" key={issue}>{issue}</p>)}
              {selected.validation.missingNodes?.length ? <ComfyRestart compact className="wf-restart" onBack={checkAgain} /> : null}
              {selectedStatus.state !== "ready" && !settingUp ? <button className="btn is-ghost" onClick={checkAgain} disabled={checking}><RefreshCw size={13} className={cn(checking && "spin")} /> Check again</button> : null}
            </div>

            <div className="wf-detail-actions">
              <button className="btn is-primary" onClick={() => useWorkflow(selected)} disabled={busy || (!selected.validation.ok && !selectedProfile?.missing?.length) || selected.profileId === model}>
                {selected.profileId === model ? <><Check size={15} /> In use</> : "Use workflow"}
              </button>
              {selected.deleteId && thisComputer ? <button className="btn is-ghost is-danger-text" disabled={busy} onClick={() => deleteWorkflow(selected)}><Trash2 size={14} /> Delete</button> : null}
            </div>

            <dl className="wf-facts">
              <dt>Source</dt><dd>{selected.source === "builtin" ? "Built in" : "Imported"}</dd>
              <dt>Family</dt><dd>{selected.familyName || selected.family || "Unknown"}</dd>
              <dt>Last used</dt><dd>{timeLabel(selected.lastUsedAt) || "Never"}</dd>
              {selected.controls?.length ? <><dt>Controls</dt><dd>{selected.controls.map(controlLabel).join(", ")}</dd></> : null}
              {selected.mediaInputs?.length ? <><dt>Inputs</dt><dd>{selected.mediaInputs.map((input) => input.label || "Reference image").join(", ")}</dd></> : null}
            </dl>
          </>
        ) : (
          <div className="wf-empty"><Wand2 size={22} /><h3>No workflow selected</h3><p>Choose one to see its details.</p></div>
        )}
      </aside>

      {dragging ? <div className="wf-drop"><FileJson size={24} /><strong>Drop to import</strong><span>A ComfyUI workflow, or an image or video ComfyUI made</span></div> : null}

      <Modal
        open={importOpen}
        onOpenChange={(open) => { if (!open) closeImport(); }}
        size="form"
        busy={busy}
        className="wf-import"
        title={<>{importStep === "choose" ? "Import a workflow" : imports.length > 1 ? `Ready to import ${imports.length} workflows` : "Ready to import"}</>}
        description={importStep === "choose"
          ? "Pick something you ran in ComfyUI, or drop a workflow or an image ComfyUI made."
          : "It runs the way you made it in ComfyUI. Your prompt and the usual controls go in from here."}
        footer={importStep === "choose" ? (
          <button className="btn" disabled={busy} onClick={closeImport}>Cancel</button>
        ) : (
          <>
            <button className="btn" disabled={busy} onClick={() => setImportStep("choose")}><ArrowLeft size={14} /> Add more</button>
            <button className="btn is-primary" onClick={saveImports} disabled={busy || !imports.length}>{busy ? "Importing…" : imports.length > 1 ? `Import ${imports.length} workflows` : "Import"}</button>
          </>
        )}
      >
        {importStep === "choose" ? (
          <div className="wf-pick">
            <section className="wf-pick-section" aria-label="Recent in ComfyUI">
              <h4>Recent in ComfyUI</h4>
              {sources.loading && !sources.recent.length ? <p className="wf-pick-hint">Looking at what ComfyUI ran…</p>
                : sources.recent.length ? <RecentRuns items={sources.recent} disabled={busy} onPick={(item) => pickSource({ source: "history", promptId: item.id, filename: item.name })} />
                : <p className="wf-pick-hint">{sources.comfy ? "Run a workflow in ComfyUI and it shows up here." : "Start ComfyUI to pick from what you ran there."}</p>}
            </section>
            {sources.saved.length ? (
              <section className="wf-pick-section" aria-label="Saved in ComfyUI">
                <h4>Saved in ComfyUI</h4>
                <ul className="wf-saved">
                  {(showAllSaved ? sources.saved : sources.saved.slice(0, 6)).map((item) => (
                    <li key={item.path}>
                      <button type="button" disabled={busy} onClick={() => pickSource({ source: "saved", path: item.path, filename: item.name })}>
                        <FileJson size={13} aria-hidden="true" /><span>{item.path.replace(/\.json$/i, "")}</span><em>{relativeTime(item.modified)}</em>
                      </button>
                    </li>
                  ))}
                </ul>
                {sources.saved.length > 6 && !showAllSaved ? <button type="button" className="btn is-ghost" onClick={() => setShowAllSaved(true)}>Show all {sources.saved.length}</button> : null}
              </section>
            ) : null}
            <button type="button" className="wf-dropzone" onClick={() => fileInput.current?.click()} disabled={busy}>
              <Upload size={20} />
              <strong>{busy ? "Reading…" : "Choose a file"}</strong>
              <span>A workflow (.json), or an image or video ComfyUI made. Or drop it anywhere here.</span>
            </button>
            <input ref={fileInput} hidden type="file" accept="application/json,.json,image/png,image/webp,video/mp4,video/webm,.png,.webp,.mp4,.webm" multiple onChange={(event) => { if (event.target.files?.length) readFiles(event.target.files); event.currentTarget.value = ""; }} />
            <details className="wf-mapping">
              <summary>More ways</summary>
              <Field label={<><ClipboardPaste size={13} /> Paste the JSON</>}>
                <textarea className="wf-paste" value={pasteJson} onChange={(event) => setPasteJson(event.target.value)} placeholder="{ … }" spellCheck={false} />
              </Field>
              <button className="btn" onClick={previewPaste} disabled={busy || !pasteJson.trim()}>Read it</button>
              <AgentGuide onCopy={() => copyAgent(agentPrompt(), "guide")} copied={agentCopy.copied === "guide"} />
            </details>
          </div>
        ) : (
          <div className="wf-review">
            {imports.map((item, index) => {
              const status = workflowState(item.preview.validation, comfyRestarting);
              const { parts, more } = foundSummary(item.metadata);
              const missingFiles = item.preview.validation.missingParts || [];
              const packsCover = new Set((item.preview.packs?.packs || []).flatMap((pack) => pack.nodes));
              return (
                <div className="wf-review-card" key={`${item.filename}-${index}`}>
                  <div className="wf-review-head">
                    {item.preview.thumbnail ? <span className="wf-review-thumb"><img src={item.preview.thumbnail} alt="" draggable={false} /></span> : null}
                    <input className="modal-input wf-review-name" aria-label="Name" value={item.metadata.name} onChange={(event) => updateImport(index, { name: event.target.value })} />
                    {imports.length > 1 ? <button type="button" className="modal-close" aria-label="Remove from import" onClick={() => setImports((current) => current.filter((_, i) => i !== index))}><X size={14} /></button> : null}
                  </div>
                  <PromptChoice item={item} onPick={(mappings) => answerPrompt(index, mappings)} />
                  <p className="wf-found">
                    {parts.length ? <>Follows your {parts.join(", ").replace(/, ([^,]*)$/, " and $1")}{more ? <>, with {more} more setting{more === 1 ? "" : "s"} in Advanced</> : null}.</> : "Runs as saved: nothing in it takes your prompt."}
                  </p>
                  <ImportAddOns item={item} onApprove={(key, on) => approvePack(index, key, on)} />
                  {item.preview.models ? <ImportFiles item={item} onChoose={(key, on) => chooseFile(index, key, on)} /> : missingFiles.length ? (
                    <p className="wf-found is-quiet">Needs {missingFiles.length === 1 ? "a model file" : `${missingFiles.length} model files`} ComfyUI doesn’t have yet: {missingFiles.map((part) => part.label).slice(0, 3).join(", ")}{missingFiles.length > 3 ? "…" : ""}. Its card says where each one goes.</p>
                  ) : null}
                  {status.state === "missing-nodes" && item.preview.validation.missingNodes?.some((node) => !packsCover.has(node)) && !item.preview.packs?.unresolved?.length ? <p className="wf-found is-quiet">Won’t run until ComfyUI has: {item.preview.validation.missingNodes.filter((node) => !packsCover.has(node)).join(", ")}</p> : null}
                  {item.preview.warnings?.length ? <p className="wf-found is-quiet">{item.preview.warnings.join(" ")}</p> : null}
                  {item.preview.risks?.length ? <ImportRisks risks={item.preview.risks} /> : null}
                  <details className="wf-mapping">
                    <summary>Advanced</summary>
                    <div className="wf-review-row">
                      <div className="field"><span>Kind</span><Segmented label="Kind" value={item.metadata.kind} onChange={(next) => updateImport(index, { kind: next })} options={[{ value: "image", label: "Image" }, { value: "video", label: "Video" }]} /></div>
                      <Field label="Family"><Select value={item.metadata.family || "custom"} onChange={(value) => updateImport(index, { family: value })} options={familyOptions(item.metadata.family)} /></Field>
                    </div>
                    <ImportFit item={item} />
                    <div className="wf-map-grid">
                      {workflowControls.filter((control) => control.editable).map(({ key, label }) => (
                        <Field key={key} label={label}>
                          <Select
                            value={selectedNodeValue(item.metadata.controls[key])}
                            onChange={(value) => updateImportControl(index, key, value === "__none" ? "" : value)}
                            options={[
                              { label: "Stays as saved", value: "__none" },
                              ...item.metadata.nodes.flatMap((node) => node.inputs.map((input) => ({ label: `${node.title || node.classType} #${node.id} · ${input}`, value: `${node.id}.${input}` })))
                            ]}
                          />
                        </Field>
                      ))}
                    </div>
                    <AgentGuide forWorkflow onCopy={() => copyAgent(agentPromptFor(item), `item-${index}`)} copied={agentCopy.copied === `item-${index}`} />
                  </details>
                </div>
              );
            })}
            {!imports.length ? <div className="wf-empty"><FileJson size={20} /><h3>Nothing to import</h3><p>Pick a run, or add a file.</p></div> : null}
          </div>
        )}
      </Modal>
    </Modal>
  );
}

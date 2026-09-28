import React, { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bot, Check, ClipboardPaste, FileJson, Heart, Minus, RefreshCw, Search, ShieldAlert, Trash2, Upload, Wand2, X } from 'lucide-react';
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
import type { Mode, Profile, WorkflowImportPreview, WorkflowPreferences, WorkflowRisk, WorkflowSummary } from './types';
import { useThisComputer } from './device';
import type { ShowToast } from './toast';
import { CopyIcon, useCopyFeedback } from "./CopyFeedback";
import { agentPrompt, agentPromptFor, controlLabel, loraNodes, workflowControls } from "./workflowAgentGuide";

type ImportDraft = { raw: unknown; filename: string; preview: WorkflowImportPreview; metadata: WorkflowImportPreview["detected"] };
type Filter = "all" | "favorites" | "attention";

/** The file lines the setup panel already shows as rows (see custom-workflows.js workflowOptionIssues). */
const missingFileIssue = /^Missing (diffusion model|checkpoint|text encoder|VAE|upscale model|file):/;


function timeLabel(value = "") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function selectedNodeValue(mapping?: { node: string; input: string }) {
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
  const samplerNode = controls.seed?.node || controls.steps?.node;

  const notes: React.ReactNode[] = [];
  const guessedPrompt = guessed.filter((key) => key === "prompt" || key === "negative");
  if (guessedPrompt.length) notes.push(guessedPrompt.length === 2
    ? "Prompt and negative were picked by order: the first text node gets your prompt, the second the negative. Check they’re the right way round."
    : `The ${guessedPrompt[0] === "prompt" ? "prompt" : "negative"} was picked by node order. Check it’s the right one.`);
  if (encoders.length > 2) notes.push(`${encoders.length} prompt nodes: only the connected ones get your text, the others keep what’s saved.`);
  if (samplers.length > 1 && samplerNode) notes.push(`${samplers.length} samplers: only ${nodeName(nodes, samplerNode)} follows seed, steps and CFG. The others keep their saved values.`);
  if (loraStack?.node) notes.push(`LoRA picker: connected to ${nodeName(nodes, loraStack.node)}.`);
  else if (rgthree) notes.push(`${rgthree.classType} found, but not connected to the LoRA picker. An AI agent can connect it (see below).`);
  else if (loraLoaders.length) notes.push("The LoRA picker only drives rgthree LoRA loaders. This workflow’s own LoRAs stay as saved.");
  else notes.push("No LoRA picker: it needs an rgthree Power Lora Loader or Lora Loader Stack in the workflow.");

  return (
    <section className="wf-fit" aria-label="What HEISS UI can change">
      <div className="wf-fit-cols">
        <div>
          <h5>Follows the studio</h5>
          {connected.length ? (
            <ul>
              {connected.map((control) => (
                <li key={control.key}>
                  <Check size={12} aria-hidden="true" />
                  <strong>{control.label}</strong>
                  <span>{nodeName(nodes, controls[control.key].node)}{guessed.includes(control.key) ? " · guessed" : ""}</span>
                </li>
              ))}
            </ul>
          ) : <p>Nothing yet. It runs exactly as saved, whatever you type.</p>}
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
        <li>Everything else in the workflow runs exactly as saved.</li>
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
      <p>A workflow runs every node in it, with the same access to this computer as ComfyUI. Import it only if you trust where it came from.</p>
    </div>
  );
}

/** Hands the job of fitting a workflow to an AI agent: a prompt that says what HEISS UI can and can't connect. */
function AgentGuide({ onCopy, copied, forWorkflow }: { onCopy: () => void; copied: boolean; forWorkflow?: boolean }) {
  return (
    <div className="wf-agent">
      <span className="wf-agent-icon" aria-hidden="true"><Bot size={16} /></span>
      <div className="wf-agent-text">
        <strong>{forWorkflow ? "Let an AI agent fix the connections" : "Make a workflow fit with an AI agent"}</strong>
        <span>{forWorkflow
          ? "Copies a prompt with this workflow and what HEISS UI found. Paste it into Claude, ChatGPT or another agent, then import the JSON it gives back."
          : "Copies a prompt that tells an agent what HEISS UI can connect. Paste it into Claude, ChatGPT or another agent with your workflow JSON, then import what it gives back."}</span>
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
      showToast("This workflow needs setup before it can run", "error");
      return;
    }
    selectWorkflow(workflow.profileId);
    onClose();
  };

  const deleteWorkflow = async (workflow: WorkflowSummary) => {
    if (!workflow.deleteId) return;
    if (!await confirmAction({ title: `Delete ${workflow.name}?`, description: "This removes the workflow from your library. Import its JSON again to restore it.", action: "Delete workflow", destructive: true })) return;
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
      showToast(error instanceof Error ? error.message : "Workflow deletion failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const previewRaw = async (raw: unknown, filename = "") => {
    const data = await apiJson<{ preview: WorkflowImportPreview }>("/api/workflows/import/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workflow: raw, filename })
    });
    setImports((current) => [...current, { raw, filename, preview: data.preview, metadata: data.preview.detected }]);
  };

  const readFiles = async (files: FileList | File[]) => {
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const text = await file.text();
        await previewRaw(JSON.parse(text), file.name);
      }
      setImportOpen(true);
      setImportStep("review");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Workflow import preview failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const previewPaste = async () => {
    if (!pasteJson.trim()) return;
    setBusy(true);
    try {
      await previewRaw(JSON.parse(pasteJson), "pasted-workflow.json");
      setPasteJson("");
      setImportStep("review");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Paste is not valid workflow JSON", "error");
    } finally {
      setBusy(false);
    }
  };

  const saveImports = async () => {
    setBusy(true);
    try {
      for (const item of imports) {
        await apiJson("/api/workflows/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workflow: item.raw, filename: item.filename, metadata: (({ nodes: _nodes, guessed: _guessed, ...metadata }) => metadata)(item.metadata) })
        });
      }
      const count = imports.length;
      setImports([]);
      setImportOpen(false);
      refreshModels(false);
      refreshWorkflows();
      showToast(count === 1 ? "Workflow imported" : `${count} workflows imported`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Workflow import failed", "error");
    } finally {
      setBusy(false);
    }
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
      description="Pick what your next generation runs on, or bring your own ComfyUI workflow."
      headerActions={thisComputer ? <button className="btn is-primary" onClick={openImport}><Upload size={15} /><span>Import</span><BetaTag /></button> : undefined}
      contentProps={{
        onDragEnter: (event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } },
        onDragOver: (event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); },
        onDragLeave: (event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); },
        onDrop: (event) => { event.preventDefault(); setDragging(false); const files = Array.from(event.dataTransfer.files).filter((file) => /json$/i.test(file.type) || /\.json$/i.test(file.name)); if (files.length) readFiles(files); }
      }}
    >
      <section className={cn("wf-browse", mobileDetailsOpen && "is-hidden-mobile")}>
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
            <p>{query ? "Try another name or clear the search." : filter === "favorites" ? "Heart a workflow to keep it at hand." : "Import a ComfyUI workflow to get started."}</p>
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
              <button type="button" className={cn("wf-heart", selected.favorite && "active")} aria-pressed={Boolean(selected.favorite)} aria-label={selected.favorite ? "Remove from favorites" : "Add to favorites"} disabled={busy} onClick={() => updateFavorites(selected.id).catch((error) => showToast(error instanceof Error ? error.message : "Could not update favorites", "error"))}>
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
          <div className="wf-empty"><Wand2 size={22} /><h3>No workflow selected</h3><p>Pick one on the left to see what it needs.</p></div>
        )}
      </aside>

      {dragging ? <div className="wf-drop"><FileJson size={24} /><strong>Drop to import</strong><span>ComfyUI workflow JSON, API or visual format</span></div> : null}

      <Modal
        open={importOpen}
        onOpenChange={(open) => { if (!open) closeImport(); }}
        size="form"
        busy={busy}
        className="wf-import"
        title={<>{importStep === "choose" ? "Import workflows" : `Review ${imports.length} workflow${imports.length === 1 ? "" : "s"}`}<BetaTag /></>}
        description={importStep === "choose"
          ? "HEISS UI runs a workflow as saved and changes only the inputs it’s connected to. ComfyUI’s Export (API) JSON reads most reliably; the visual format works too."
          : "Check what follows the studio. Anything that stays as saved keeps the workflow’s own value on every run."}
        footer={importStep === "choose" ? (
          <>
            <button className="btn" disabled={busy} onClick={closeImport}>Cancel</button>
            <button className="btn is-primary" onClick={previewPaste} disabled={busy || !pasteJson.trim()}>{busy ? "Reading…" : "Review paste"}</button>
          </>
        ) : (
          <>
            <button className="btn" disabled={busy} onClick={() => setImportStep("choose")}><ArrowLeft size={14} /> Add more</button>
            <button className="btn is-primary" onClick={saveImports} disabled={busy || !imports.length}>{busy ? "Importing…" : `Import ${imports.length === 1 ? "workflow" : `${imports.length} workflows`}`}</button>
          </>
        )}
      >
        {importStep === "choose" ? (
          <>
            <button type="button" className="wf-dropzone" onClick={() => fileInput.current?.click()} disabled={busy}>
              <FileJson size={22} />
              <strong>Choose JSON files</strong>
              <span>or drop them anywhere on the workflow gallery</span>
            </button>
            <input ref={fileInput} hidden type="file" accept="application/json,.json" multiple onChange={(event) => { if (event.target.files?.length) readFiles(event.target.files); event.currentTarget.value = ""; }} />
            <Field label={<><ClipboardPaste size={13} /> Or paste the JSON</>}>
              <textarea className="wf-paste" value={pasteJson} onChange={(event) => setPasteJson(event.target.value)} placeholder="{ … }" spellCheck={false} />
            </Field>
            <AgentGuide onCopy={() => copyAgent(agentPrompt(), "guide")} copied={agentCopy.copied === "guide"} />
          </>
        ) : (
          <div className="wf-review">
            {imports.map((item, index) => {
              const status = workflowState(item.preview.validation, comfyRestarting);
              return (
                <div className="wf-review-card" key={`${item.filename}-${index}`}>
                  <div className="wf-review-head">
                    <span className="wf-review-file"><FileJson size={14} /> {item.filename || "Pasted workflow"}</span>
                    <span className={cn("wf-status", `is-${status.state}`)}><i aria-hidden="true" />{status.label}</span>
                    <button type="button" className="modal-close" aria-label="Remove from import" onClick={() => setImports((current) => current.filter((_, i) => i !== index))}><X size={14} /></button>
                  </div>
                  {status.state === "missing-nodes" ? <p className="wf-issue">Imports fine, but it won't run until ComfyUI has: {item.preview.validation.missingNodes?.join(", ")}</p> : null}
                  {item.preview.risks?.length ? <ImportRisks risks={item.preview.risks} /> : null}
                  <Field label="Name"><input className="modal-input" value={item.metadata.name} onChange={(event) => updateImport(index, { name: event.target.value })} /></Field>
                  <div className="wf-review-row">
                    <div className="field"><span>Kind</span><Segmented label="Kind" value={item.metadata.kind} onChange={(next) => updateImport(index, { kind: next })} options={[{ value: "image", label: "Image" }, { value: "video", label: "Video" }]} /></div>
                    <Field label="Family"><input className="modal-input" value={item.metadata.family} onChange={(event) => updateImport(index, { family: event.target.value })} /></Field>
                  </div>
                  <ImportFit item={item} />
                  <details className="wf-mapping">
                    <summary>Change connections</summary>
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
                  </details>
                  <AgentGuide forWorkflow onCopy={() => copyAgent(agentPromptFor(item), `item-${index}`)} copied={agentCopy.copied === `item-${index}`} />
                </div>
              );
            })}
            {!imports.length ? <div className="wf-empty"><FileJson size={20} /><h3>Nothing to import</h3><p>Go back and add a file or paste some JSON.</p></div> : null}
          </div>
        )}
      </Modal>
    </Modal>
  );
}

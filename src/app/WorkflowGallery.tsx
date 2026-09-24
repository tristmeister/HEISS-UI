import React, { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ClipboardPaste, Copy, FileJson, Heart, RefreshCw, Search, Trash2, Upload, Wand2, X } from 'lucide-react';
import { Modal } from './Modal';
import type { ConfirmAction } from './useConfirmation';
import { apiJson, copyText } from './api';
import { cn } from './format';
import { Field, StudioSelect as Select } from './components';
import { Segmented } from './SettingsDialog';
import { workflowState } from './workflowStatus';
import { ModelSetup } from './ModelSetup';
import { ComfyRestart, useComfyRestarting } from './ComfyRestart';
import { scrollSideways, useWheelRef } from './wheel';
import type { Mode, Profile, WorkflowImportPreview, WorkflowPreferences, WorkflowSummary } from './types';

type ImportDraft = { raw: unknown; filename: string; preview: WorkflowImportPreview; metadata: WorkflowImportPreview["detected"] };
type Filter = "all" | "favorites" | "attention";

const controlLabels: Record<string, string> = {
  prompt: "Prompt",
  negative: "Negative",
  width: "Width",
  height: "Height",
  count: "Count",
  seed: "Seed",
  steps: "Steps",
  cfg: "CFG",
  sampler: "Sampler",
  scheduler: "Scheduler",
  denoise: "Denoise",
  startImage: "Reference image",
  frames: "Frames",
  fps: "FPS"
};

function timeLabel(value = "") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function selectedNodeValue(mapping?: { node: string; input: string }) {
  return mapping?.node && mapping?.input ? `${mapping.node}.${mapping.input}` : "__none";
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
    showToast: (message: string, tone?: "default" | "success" | "error") => void;
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

  const openImport = () => { setImportStep(imports.length ? "review" : "choose"); setImportOpen(true); };
  const closeImport = () => { setImportOpen(false); setImports([]); setImportStep("choose"); setPasteJson(""); };
  const checkAgain = async () => {
    setChecking(true);
    try { refreshModels(false); await Promise.resolve(refreshWorkflows()); } finally { window.setTimeout(() => setChecking(false), 600); }
  };
  const copyMissing = async (nodes: string[]) => {
    const ok = await copyText(nodes.join("\n"));
    showToast(ok ? "Node names copied" : "Copy failed", ok ? "success" : "error");
  };

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
    if (!workflow.validation.ok) {
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
      showToast("Workflow deleted", "success");
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
          body: JSON.stringify({ workflow: item.raw, filename: item.filename, metadata: item.metadata })
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
        const mediaInputs = key === "startImage"
          ? node && input
            ? [{ ...(item.metadata.mediaInputs?.[0] || { id: "reference", kind: "image" as const, label: "Reference image", required: false, min: 0, max: 1 }), control: { node, input } }, ...(item.metadata.mediaInputs || []).slice(1)]
            : []
          : item.metadata.mediaInputs;
        return { ...item.metadata, controls, mediaInputs };
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
      headerActions={<button className="btn is-primary" onClick={openImport}><Upload size={15} /><span>Import</span></button>}
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
            <input aria-label="Search workflows" value={query} placeholder="Search workflows" onChange={(event) => setQuery(event.target.value)} />
            {query ? <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={13} /></button> : null}
          </label>
          <Segmented label="Kind" value={kind} onChange={(next) => { setKind(next); setFilter("all"); }} options={[{ value: "image", label: "Image" }, { value: "video", label: "Video" }]} />
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
                  <span>{workflow.family}{workflow.source === "custom" ? " · Imported" : ""}</span>
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
            {query ? <button className="btn" onClick={() => setQuery("")}>Clear search</button> : filter === "favorites" ? <button className="btn" onClick={() => setFilter("all")}>Show all</button> : <button className="btn is-primary" onClick={openImport}><Upload size={14} /> Import workflow</button>}
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
              <p>{selectedStatus.detail}</p>
              {selectedProfile?.missing?.length ? (
                <ModelSetup variant="gallery" profile={selectedProfile} showToast={showToast} onInstalled={() => { refreshModels(false); refreshWorkflows(); }} />
              ) : null}
              {selected.validation.missingNodes?.length ? (
                <div className="wf-missing">
                  <ul>{selected.validation.missingNodes.map((node) => <li key={node}><code>{node}</code></li>)}</ul>
                  <button className="btn is-ghost" onClick={() => copyMissing(selected.validation.missingNodes || [])}><Copy size={13} /> Copy names</button>
                </div>
              ) : null}
              {[...(selected.validation.missingNodes?.length ? selected.validation.issues.filter((issue) => !issue.startsWith("Missing node class:")) : selected.validation.issues), ...(selected.validation.warnings || [])].map((issue) => <p className="wf-issue" key={issue}>{issue}</p>)}
              {selected.validation.missingNodes?.length ? <ComfyRestart compact className="wf-restart" onBack={checkAgain} /> : null}
              {selectedStatus.state !== "ready" && !selectedProfile?.missing?.length ? <button className="btn is-ghost" onClick={checkAgain} disabled={checking}><RefreshCw size={13} className={cn(checking && "spin")} /> Check again</button> : null}
            </div>

            <div className="wf-detail-actions">
              <button className="btn is-primary" onClick={() => useWorkflow(selected)} disabled={busy || !selected.validation.ok || selected.profileId === model}>
                {selected.profileId === model ? <><Check size={15} /> In use</> : "Use workflow"}
              </button>
              {selected.deleteId ? <button className="btn is-ghost is-danger-text" disabled={busy} onClick={() => deleteWorkflow(selected)}><Trash2 size={14} /> Delete</button> : null}
            </div>

            <dl className="wf-facts">
              <dt>Source</dt><dd>{selected.source === "builtin" ? "Built in" : "Imported"}</dd>
              <dt>Family</dt><dd>{selected.family || "Unknown"}</dd>
              <dt>Last used</dt><dd>{timeLabel(selected.lastUsedAt) || "Never"}</dd>
              {selected.controls?.length ? <><dt>Controls</dt><dd>{selected.controls.map((key) => controlLabels[key] || key).join(", ")}</dd></> : null}
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
        title={importStep === "choose" ? "Import workflows" : `Review ${imports.length} workflow${imports.length === 1 ? "" : "s"}`}
        description={importStep === "choose" ? "API and visual ComfyUI JSON both work." : "Check the name and kind. Adjust the controls only if something looks off."}
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
              <textarea className="wf-paste" value={pasteJson} onChange={(event) => setPasteJson(event.target.value)} placeholder="{ ... }" spellCheck={false} />
            </Field>
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
                  <Field label="Name"><input className="modal-input" value={item.metadata.name} onChange={(event) => updateImport(index, { name: event.target.value })} /></Field>
                  <div className="wf-review-row">
                    <div className="field"><span>Kind</span><Segmented label="Kind" value={item.metadata.kind} onChange={(next) => updateImport(index, { kind: next })} options={[{ value: "image", label: "Image" }, { value: "video", label: "Video" }]} /></div>
                    <Field label="Family"><input className="modal-input" value={item.metadata.family} onChange={(event) => updateImport(index, { family: event.target.value })} /></Field>
                  </div>
                  <details className="wf-mapping">
                    <summary>Control mapping <span>{Object.keys(item.metadata.controls || {}).length} detected</span></summary>
                    <div className="wf-map-grid">
                      {Object.keys(controlLabels).map((key) => (
                        <Field key={key} label={controlLabels[key]}>
                          <Select
                            value={selectedNodeValue(item.metadata.controls[key])}
                            onChange={(value) => updateImportControl(index, key, value === "__none" ? "" : value)}
                            options={[
                              { label: "Not mapped", value: "__none" },
                              ...item.metadata.nodes.flatMap((node) => node.inputs.map((input) => ({ label: `${node.id} · ${node.classType}.${input}`, value: `${node.id}.${input}` })))
                            ]}
                          />
                        </Field>
                      ))}
                    </div>
                  </details>
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

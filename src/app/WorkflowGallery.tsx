import React, { useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, FileJson, Heart, Search, Trash2, Upload, Wand2, XCircle } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import type { ConfirmAction } from './useConfirmation';
import { apiJson } from './api';
import { cn } from './format';
import { Field, StudioSelect as Select, Tip } from './components';
import type { Mode, WorkflowImportPreview, WorkflowPreferences, WorkflowSummary } from './types';

type ImportDraft = { raw: unknown; filename: string; preview: WorkflowImportPreview; metadata: WorkflowImportPreview["detected"] };

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
  frames: "Frames",
  fps: "FPS"
};

function workflowStatus(workflow: WorkflowSummary) {
  return workflow.validation?.ok ? "Ready" : "Needs setup";
}

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
  return src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : <Wand2 size={22} />;
}

export function WorkflowGallery({ view }: { view: any }) {
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
    models: { profiles: Array<{ id: string; kind: Mode }> } | null;
  };
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(workflows.find((item) => item.kind === mode)?.id || workflows[0]?.id || "");
  const [importOpen, setImportOpen] = useState(false);
  const [pasteJson, setPasteJson] = useState("");
  const [imports, setImports] = useState<ImportDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workflows.filter((item) => {
      if (item.kind !== mode) return false;
      if (!q) return true;
      return [item.name, item.description, item.family, item.source, ...(item.tags || [])].join(" ").toLowerCase().includes(q);
    });
  }, [mode, query, workflows]);
  const selected = filtered.find((item) => item.id === selectedId) || filtered[0] || null;
  const grouped = useMemo(() => {
    const favorites = filtered.filter((item) => item.favorite);
    const recent = filtered.filter((item) => !item.favorite && item.lastUsedAt);
    const ready = filtered.filter((item) => !item.favorite && !item.lastUsedAt && item.validation.ok);
    const broken = filtered.filter((item) => !item.favorite && !item.lastUsedAt && !item.validation.ok);
    return [
      ["Favorites", favorites],
      ["Recent", recent],
      ["Ready", ready],
      ["Needs setup", broken]
    ].filter(([, items]) => (items as WorkflowSummary[]).length) as Array<[string, WorkflowSummary[]]>;
  }, [filtered]);

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
          body: JSON.stringify({ workflow: item.raw, metadata: item.metadata })
        });
      }
      setImports([]);
      setImportOpen(false);
      refreshModels(false);
      refreshWorkflows();
      showToast("Workflow imported", "success");
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
        return { ...item.metadata, controls };
      })()
    } : item));
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><Dialog.Portal>
      <Dialog.Overlay className="scrim modal-scrim workflow-overlay" />
      <Dialog.Content data-open-surface className="workflow-gallery" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}>
        <header className="workflow-gallery-head">
          <div>
            <Dialog.Title>Workflows</Dialog.Title>
            <Dialog.Description>Choose a workflow for your next {mode === "video" ? "video" : "image"}.</Dialog.Description>
          </div>
          <div className="workflow-head-actions">
            <button className="workflow-import-button" onClick={() => setImportOpen(true)}><Upload size={15} /><span>Import workflow</span></button>
            <Tip content="Close"><button className="icon-button" aria-label="Close workflows" onClick={onClose}>×</button></Tip>
          </div>
        </header>
        <div className={cn("workflow-gallery-body", mobileDetailsOpen && "is-detail-open")}>
          <aside className="workflow-gallery-list">
            <div className="workflow-search">
              <Search size={14} />
              <input aria-label="Search workflows" value={query} placeholder="Search workflows" onChange={(event) => setQuery(event.target.value)} />
            </div>
            {!filtered.length ? <div className="workflow-empty"><Search size={22} /><h3>{query ? "No matching workflows" : "No workflows yet"}</h3><p>{query ? "Try a different name or clear your search." : "Import a workflow to get started."}</p><button onClick={() => query ? setQuery("") : setImportOpen(true)}>{query ? "Clear search" : "Import workflow"}</button></div> : null}
            {grouped.map(([label, items]) => (
              <section key={label} className="workflow-group">
                <h3>{label}<span>{items.length}</span></h3>
                <div className="workflow-tile-grid">
                  {items.map((workflow) => (
                    <button key={workflow.id} aria-pressed={workflow.id === selected?.id} className={cn("workflow-tile", workflow.id === selected?.id && "active", !workflow.validation.ok && "is-broken")} onClick={() => { setSelectedId(workflow.id); setMobileDetailsOpen(true); }}>
                      <div className="workflow-thumb">
                        <WorkflowThumbnail key={workflow.thumbnail} src={workflow.thumbnail} />
                      </div>
                      <div className="workflow-tile-copy">
                        <strong>{workflow.name}</strong>
                        <span>{workflow.source === "builtin" ? "Built-in" : "Custom"} · {workflow.family}</span>
                      </div>
                      <em className={workflow.validation.ok ? "is-ready" : "needs-setup"}>{workflow.validation.ok ? <CheckCircle2 size={13} /> : "Setup"}</em>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </aside>
          <section className="workflow-details">
            <button type="button" className="workflow-mobile-back" onClick={() => setMobileDetailsOpen(false)}>
              <ArrowLeft size={15} /> All workflows
            </button>
            {selected ? (
              <>
                <div className="workflow-detail-hero">
                  <div className="workflow-detail-thumb">
                    <WorkflowThumbnail key={selected.thumbnail} src={selected.thumbnail} />
                  </div>
                  <div>
                    <h3>{selected.name}</h3>
                    {selected.description ? <p>{selected.description}</p> : null}
                    <div className="workflow-tags">{(selected.tags || []).slice(0, 7).map((tag) => <span key={tag}>{tag}</span>)}</div>
                  </div>
                </div>
                <div className="workflow-actions">
                  <button onClick={() => useWorkflow(selected)} className="workflow-use" disabled={busy || !selected.validation.ok}><CheckCircle2 size={15} /> Use workflow</button>
                  <button disabled={busy} onClick={() => updateFavorites(selected.id).catch((error) => showToast(error instanceof Error ? error.message : "Could not update favorites", "error"))}><Heart size={15} fill={selected.favorite ? "currentColor" : "none"} /> {selected.favorite ? "Favorited" : "Favorite"}</button>
                  {selected.deleteId ? <button className="subtle-danger" disabled={busy} onClick={() => deleteWorkflow(selected)}><Trash2 size={15} /> Delete</button> : null}
                  <button disabled={busy} onClick={() => refreshWorkflows()}>Check status</button>
                </div>
                <div className="workflow-detail-grid">
                  <span>Status</span><strong>{workflowStatus(selected)}</strong>
                  <span>Kind</span><strong>{selected.kind}</strong>
                  <span>Source</span><strong>{selected.source}</strong>
                  <span>Last used</span><strong>{timeLabel(selected.lastUsedAt) || "Never"}</strong>
                  <span>Controls</span><strong>{selected.controls?.length ? selected.controls.map((key) => controlLabels[key] || key).join(", ") : "Detected from profile"}</strong>

                </div>
                {!selected.validation.ok || selected.validation.warnings?.length ? (
                  <div className="workflow-issues">
                    <h4>{selected.validation.ok ? "Warnings" : "Needs setup"}</h4>
                    {[...(selected.validation.issues || []), ...(selected.validation.warnings || [])].map((issue) => <p key={issue}>{issue}</p>)}
                  </div>
                ) : null}
              </>
            ) : <div className="workflow-empty"><Wand2 size={24} /><h3>Your workflow library</h3><p>Choose a workflow to see its details.</p></div>}
          </section>
        </div>
        <Dialog.Root open={importOpen} onOpenChange={(open) => { if (!busy) setImportOpen(open); }}><Dialog.Portal><Dialog.Overlay className="workflow-import-overlay" /><Dialog.Content className="workflow-import-panel open" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}>
          <div className="workflow-import-head">
            <div><Dialog.Title>Import workflow</Dialog.Title><Dialog.Description>Choose a ComfyUI JSON file or paste its contents.</Dialog.Description></div>
            <button className="icon-button" aria-label="Close import" disabled={busy} onClick={() => setImportOpen(false)}><XCircle size={15} /></button>
          </div>
          <Field label="Paste workflow JSON">
            <textarea className="short" value={pasteJson} onChange={(event) => setPasteJson(event.target.value)} placeholder="{ ... }" />
          </Field>
          <div className="setting-actions">
            <button onClick={previewPaste} disabled={busy || !pasteJson.trim()}>Preview Paste</button>
            <label className="wide-button">
              Choose JSON
              <input type="file" accept="application/json,.json" multiple onChange={(event) => { if (event.target.files) readFiles(event.target.files); event.currentTarget.value = ""; }} />
            </label>
          </div>
          <div className="workflow-import-list">
            {imports.map((item, index) => (
              <div className="workflow-import-card" key={`${item.filename}-${index}`}>
                <div className="workflow-import-format"><FileJson size={14} /> {item.preview.format === "comfyui-visual" ? "Visual workflow normalized via ComfyUI schema" : item.preview.format === "comfyui-api-wrapper" ? "API workflow wrapper detected" : "ComfyUI API workflow detected"}</div>
                <Field label="Name"><input value={item.metadata.name} onChange={(event) => updateImport(index, { name: event.target.value })} /></Field>
                <div className="split">
                  <Field label="Kind"><Select value={item.metadata.kind} onChange={(value) => updateImport(index, { kind: value === "video" ? "video" : "image" })} options={["image", "video"]} /></Field>
                  <Field label="Family"><input value={item.metadata.family} onChange={(event) => updateImport(index, { family: event.target.value })} /></Field>
                </div>
                <details className="workflow-mapping"><summary>Advanced control mapping</summary><div className="workflow-map-grid">
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
                </div></details>
              </div>
            ))}
          </div>
          <div className="workflow-import-actions">
            <button disabled={busy} onClick={() => { setImports([]); setImportOpen(false); }}>Cancel</button>
            <button onClick={saveImports} disabled={busy || !imports.length}>{busy ? "Working…" : `Import${imports.length ? ` ${imports.length}` : ""} workflow${imports.length === 1 ? "" : "s"}`}</button>
          </div>
        </Dialog.Content></Dialog.Portal></Dialog.Root>
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>
  );
}

import React, { useMemo, useState } from 'react';
import { CheckCircle2, FileJson, Heart, Search, Trash2, Upload, Wand2, XCircle } from 'lucide-react';
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
  return workflow.validation?.ok ? "Ready" : "Broken";
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

export function WorkflowGallery({ view }: { view: any }) {
  const {
    confirmAction, mode, onClose, refreshModels, refreshWorkflows, selectWorkflow, setWorkflowPreferences,
    showToast, workflowPreferences, workflows, setWorkflows, model, chooseModel, models
  } = view as {
    confirmAction: (message: string) => boolean;
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
  const selected = workflows.find((item) => item.id === selectedId) || workflows[0] || null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workflows.filter((item) => {
      if (item.kind !== mode) return false;
      if (!q) return true;
      return [item.name, item.description, item.family, item.source, ...(item.tags || [])].join(" ").toLowerCase().includes(q);
    });
  }, [mode, query, workflows]);
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
    const where = workflow.path ? `\n${workflow.path}` : "";
    if (!confirmAction(`Delete workflow "${workflow.name}"?${where}`)) return;
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
    <div className="scrim modal-scrim" onClick={onClose}>
      <div data-open-surface className="workflow-gallery" onClick={(event) => event.stopPropagation()}>
        <header className="workflow-gallery-head">
          <div>
            <h2>Workflow Gallery</h2>
            <p>Browse, favorite, import, and diagnose workflows.</p>
          </div>
          <div className="workflow-head-actions">
            <label className="workflow-import-button" onClick={() => setImportOpen(true)}>
              <Upload size={15} />
              Import
              <input type="file" accept="application/json,.json" multiple onChange={(event) => { if (event.target.files) readFiles(event.target.files); event.currentTarget.value = ""; }} />
            </label>
            <Tip content="Close"><button className="icon-button" aria-label="Close workflows" onClick={onClose}>×</button></Tip>
          </div>
        </header>
        <div className="workflow-gallery-body">
          <aside className="workflow-gallery-list">
            <div className="workflow-search">
              <Search size={14} />
              <input value={query} placeholder="Search workflows" onChange={(event) => setQuery(event.target.value)} />
            </div>
            <div className="workflow-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.files.length) readFiles(event.dataTransfer.files); }}>
              <FileJson size={17} />
              Drop workflow JSON
            </div>
            {grouped.map(([label, items]) => (
              <section key={label} className="workflow-group">
                <h3>{label}</h3>
                <div className="workflow-tile-grid">
                  {items.map((workflow) => (
                    <button key={workflow.id} className={cn("workflow-tile", workflow.id === selected?.id && "active", !workflow.validation.ok && "is-broken")} onClick={() => setSelectedId(workflow.id)}>
                      <div className="workflow-thumb">
                        {workflow.thumbnail ? <img src={workflow.thumbnail} alt="" /> : <Wand2 size={22} />}
                      </div>
                      <div className="workflow-tile-copy">
                        <strong>{workflow.name}</strong>
                        <span>{workflow.source === "builtin" ? "Built-in" : "Custom"} · {workflow.family}</span>
                      </div>
                      <em>{workflowStatus(workflow)}</em>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </aside>
          <section className="workflow-details">
            {selected ? (
              <>
                <div className="workflow-detail-hero">
                  <div className="workflow-detail-thumb">
                    {selected.thumbnail ? <img src={selected.thumbnail} alt="" /> : <Wand2 size={32} />}
                  </div>
                  <div>
                    <h3>{selected.name}</h3>
                    <p>{selected.description || "No description recorded."}</p>
                    <div className="workflow-tags">{(selected.tags || []).slice(0, 7).map((tag) => <span key={tag}>{tag}</span>)}</div>
                  </div>
                </div>
                <div className="workflow-actions">
                  <button onClick={() => useWorkflow(selected)} disabled={!selected.validation.ok}><CheckCircle2 size={15} /> Use Workflow</button>
                  <button onClick={() => updateFavorites(selected.id)}><Heart size={15} fill={selected.favorite ? "currentColor" : "none"} /> {selected.favorite ? "Unfavorite" : "Favorite"}</button>
                  {selected.deleteId ? <button className="subtle-danger" onClick={() => deleteWorkflow(selected)}><Trash2 size={15} /> Delete</button> : null}
                  <button onClick={refreshWorkflows}>Revalidate</button>
                </div>
                <div className="workflow-detail-grid">
                  <span>Status</span><strong>{workflowStatus(selected)}</strong>
                  <span>Kind</span><strong>{selected.kind}</strong>
                  <span>Source</span><strong>{selected.source}</strong>
                  <span>Last used</span><strong>{timeLabel(selected.lastUsedAt) || "Never"}</strong>
                  <span>Controls</span><strong>{selected.controls?.length ? selected.controls.map((key) => controlLabels[key] || key).join(", ") : "Detected from profile"}</strong>
                  {selected.path ? <><span>Path</span><strong>{selected.path}</strong></> : null}
                </div>
                {!selected.validation.ok || selected.validation.warnings?.length ? (
                  <div className="workflow-issues">
                    <h4>{selected.validation.ok ? "Warnings" : "Needs setup"}</h4>
                    {[...(selected.validation.issues || []), ...(selected.validation.warnings || [])].map((issue) => <p key={issue}>{issue}</p>)}
                  </div>
                ) : null}
              </>
            ) : <div className="workflow-empty">No workflows found.</div>}
          </section>
        </div>
        <div className={cn("workflow-import-panel", importOpen && "open")}>
          <div className="workflow-import-head">
            <h3>Import Workflows</h3>
            <button className="icon-button" onClick={() => setImportOpen(false)}><XCircle size={15} /></button>
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
                <div className="workflow-map-grid">
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
              </div>
            ))}
          </div>
          <div className="workflow-import-actions">
            <button onClick={() => { setImports([]); setImportOpen(false); }}>Cancel</button>
            <button onClick={saveImports} disabled={busy || !imports.length}>Save {imports.length || ""} Workflow{imports.length === 1 ? "" : "s"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

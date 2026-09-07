import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, GalleryHorizontalEnd, Minus, Pencil, Plus, Save, Search, Trash2, Wand2 } from 'lucide-react';
import { fallbackSamplers, fallbackSchedulers } from './constants';
import { cn } from './format';
import { defaultLoraStrength, loraGroups, maxLoras, rankedLoras, recommendedLoras } from './loras';
import { Field, NumberPicker, Skeleton, StudioSelect as Select, Tip } from './components';
import type { LoraSelection, Profile, WorkflowSummary } from './types';
import type { LoraSnapshot } from './lora-storage';

const LORA_COLORS = [
  "hsl(280 60% 60%)",
  "hsl(45 80% 55%)",
  "hsl(190 70% 50%)",
  "hsl(0 70% 55%)",
  "hsl(150 60% 50%)",
  "hsl(30 80% 55%)",
  "hsl(220 70% 60%)",
  "hsl(340 65% 55%)",
];

function LoraSelect({
  value,
  options,
  profile,
  onChange
}: {
  value: string;
  options: string[];
  profile: Profile | null;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recommended = useMemo(() => recommendedLoras(options, profile, query).slice(0, 8), [options, profile, query]);
  const groups = useMemo(() => loraGroups(options, profile, query), [options, profile, query]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const choose = (name: string) => {
    onChange(name);
    setQuery("");
    setOpen(false);
  };

  const toggleGroup = (id: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const displayName = (name: string) => {
    const parts = name.split(/[\\/]/);
    return parts[parts.length - 1] || name;
  };

  return (
    <div className="lora-select" ref={containerRef} data-open-surface={open || undefined}>
      <button type="button" className="lora-select-trigger" onClick={() => { setOpen(!open); if (!open) setTimeout(() => inputRef.current?.focus(), 0); }}>
        <span className={cn(!value && "placeholder")}>{value ? displayName(value) : "Choose LoRA"}</span>
      </button>
      {open ? (
        <div className="lora-select-dropdown">
          <div className="lora-select-search">
            <Search size={13} />
            <input ref={inputRef} value={query} placeholder="Search LoRAs..." onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="lora-select-list">
            {recommended.length ? (
              <div className="lora-select-group">
                <span title="LoRAs ranked by filename matches to the active model">Matches this model</span>
                {recommended.map((name) => (
                  <button key={`r-${name}`} type="button" className={cn(name === value && "active")} onClick={() => choose(name)}>
                    {displayName(name)}
                  </button>
                ))}
              </div>
            ) : null}
            {groups.map((group) => {
              const collapsed = collapsedGroups.has(group.id);
              return (
                <div className="lora-select-group" key={group.id}>
                  <button
                    type="button"
                    className="lora-select-group-heading"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={!collapsed}
                  >
                    <span>{group.label}</span>
                    <ChevronDown size={12} className={cn(collapsed && "is-collapsed")} />
                  </button>
                  {!collapsed ? group.loras.map((name) => (
                    <button key={`a-${name}`} type="button" className={cn("lora-select-option", name === value && "active")} onClick={() => choose(name)}>
                      {displayName(name)}
                    </button>
                  )) : null}
                </div>
              );
            })}
            {!groups.length ? <div className="lora-select-empty">No LoRAs match "{query}"</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WorkflowPreviewCard({ workflow, onOpen }: { workflow: WorkflowSummary | null; onOpen: () => void }) {
  if (!workflow) return (
    <button type="button" className="workflow-card" onClick={onOpen}>
      <div className="workflow-card-thumb"><GalleryHorizontalEnd size={18} /></div>
      <div className="workflow-card-info">
        <strong>No workflow selected</strong>
        <span>Browse workflows</span>
      </div>
      <ChevronRight size={15} className="workflow-card-arrow" />
    </button>
  );

  const status = workflow.validation?.ok ? "Ready" : "Issues";
  return (
    <button type="button" className={cn("workflow-card", !workflow.validation?.ok && "has-issues")} onClick={onOpen}>
      <div className="workflow-card-thumb">
        {workflow.thumbnail ? <img src={workflow.thumbnail} alt="" /> : <Wand2 size={18} />}
      </div>
      <div className="workflow-card-info">
        <strong>{workflow.name}</strong>
        <span>{workflow.source === "builtin" ? "Built-in" : "Custom"} workflow</span>
      </div>
      <div className="workflow-card-status">
        <span className={cn("workflow-status-dot", workflow.validation?.ok ? "is-ok" : "is-warn")} />
        {status}
      </div>
      <ChevronRight size={15} className="workflow-card-arrow" />
    </button>
  );
}

function LoraSnapshots({ snapshots, onLoad, onSave, onRename, onDelete }: {
  snapshots: LoraSnapshot[];
  onLoad: (snapshot: LoraSnapshot) => void;
  onSave: () => void;
  onRename: (snapshot: LoraSnapshot) => void;
  onDelete: (snapshot: LoraSnapshot) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div className="lora-snapshots" ref={containerRef} data-open-surface={open || undefined}>
      <button type="button" className="lora-snapshot-save" onClick={onSave}><Save size={13} /> Save snapshot</button>
      <button type="button" className="lora-snapshot-trigger" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        Load snapshot <ChevronDown size={13} />
      </button>
      {open ? <div className="lora-snapshot-menu">
        {snapshots.length ? snapshots.map((snapshot) => (
          <div className="lora-snapshot-row" key={snapshot.id}>
            <button type="button" className="lora-snapshot-load" onClick={() => { onLoad(snapshot); setOpen(false); }}>
              <span>{snapshot.name}</span><small>{snapshot.loras.length} LoRA{snapshot.loras.length === 1 ? '' : 's'}</small>
            </button>
            <Tip content="Rename snapshot"><button type="button" className="lora-snapshot-action" onClick={() => onRename(snapshot)}><Pencil size={12} /></button></Tip>
            <Tip content="Delete snapshot"><button type="button" className="lora-snapshot-action danger" onClick={() => onDelete(snapshot)}><Trash2 size={12} /></button></Tip>
          </div>
        )) : <div className="lora-snapshot-empty">No snapshots for this workflow</div>}
      </div> : null}
    </div>
  );
}

type SidebarTab = "basics" | "advanced" | "loras";

export function SidebarControls({ view }: { view: any }) {
  const {
    canUseStartImage, cfg, cfgMeta, changeMode, count, countMeta, currentProfile, currentWorkflow,
    customSize, denoise, denoiseMeta, fps, fpsMeta, frameMeta, frames, height, heightMeta, loras,
    loraActiveCount, mode, models, profileOptions, readStartImage, sampler, scheduler, seed,
    setCfg, setCount, setDenoise, setFps, setFrames, setHeight, setLoras, setSampler,
    setScheduler, setSeed, setStartImage, setStartImageId, setStartImageName, setSteps, setTextEncoder, setVae,
    setWeightDtype, setWidth, startImageName, steps, stepsMeta, textEncoder, vae, weightDtype,
    width, widthMeta, confirmAction, setWorkflowGalleryOpen, loraSnapshots, loadLoraSnapshot,
    saveLoraSnapshot, renameLoraSnapshot, deleteLoraSnapshot, rememberedLoraStrength
  } = view;

  const [tab, setTab] = useState<SidebarTab>("basics");

  const loraOptions = profileOptions.loras || models?.loras || [];
  const canUseLora = mode === "image" && Boolean(currentProfile?.capabilities.lora) && loraOptions.length > 0;

  useEffect(() => {
    if (!canUseLora && tab === "loras") setTab("basics");
  }, [canUseLora, tab]);

  const updateLora = (index: number, patch: Partial<LoraSelection>) => {
    setLoras((current: LoraSelection[]) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };
  const removeLora = (index: number) => setLoras((current: LoraSelection[]) => current.filter((_, itemIndex) => itemIndex !== index));
  const addLora = () => {
    setLoras((current: LoraSelection[]) => {
      if (current.length >= maxLoras) return current;
      const first = recommendedLoras(loraOptions, currentProfile)[0] || rankedLoras(loraOptions, currentProfile)[0] || "";
      return [...current, { name: first, enabled: true, strength: rememberedLoraStrength(first, defaultLoraStrength) }];
    });
  };

  return (
    <>
      <div className="mode-tabs" role="tablist" aria-label="Generation mode">
        <Tip content="Image generation"><button className={cn(mode === "image" && "active")} onClick={() => changeMode("image")}>Image</button></Tip>
        <Tip content="Video generation"><button className={cn(mode === "video" && "active")} onClick={() => changeMode("video")}>Video</button></Tip>
      </div>

      <WorkflowPreviewCard workflow={currentWorkflow} onOpen={() => setWorkflowGalleryOpen(true)} />

      <div className="sidebar-subtabs">
        <button className={cn("sidebar-subtab", tab === "basics" && "active")} onClick={() => setTab("basics")}>Basics</button>
        <button className={cn("sidebar-subtab", tab === "advanced" && "active")} onClick={() => setTab("advanced")}>Advanced</button>
        {canUseLora ? (
          <button className={cn("sidebar-subtab", tab === "loras" && "active")} onClick={() => setTab("loras")}>
            LoRAs
            {loraActiveCount > 0 ? <span className="sidebar-subtab-count">{loraActiveCount}</span> : null}
          </button>
        ) : null}
      </div>

      <div className="sidebar-body">
        {tab === "basics" ? (
          <>
            {mode === "video" ? (
              <div className="number-row">
                <NumberPicker label="Frames" value={frames} onChange={setFrames} min={frameMeta.min || 1} max={frameMeta.max ?? 240} step={frameMeta.step || 4} fill />
                <NumberPicker label="FPS" value={fps} onChange={setFps} min={fpsMeta.min || 1} max={fpsMeta.max ?? 60} step={fpsMeta.step || 1} fill />
              </div>
            ) : null}
            <div className="number-row">
              <NumberPicker label="Steps" value={steps} onChange={setSteps} min={stepsMeta.min || 1} max={stepsMeta.max ?? 150} step={stepsMeta.step || 1} fill />
              {mode === "image" ? (
                <NumberPicker label="Variants" value={count} onChange={setCount} min={countMeta.min || 1} max={countMeta.max ?? 8} step={countMeta.step || 1} fill />
              ) : null}
            </div>
            <Field label="Seed"><input value={seed} placeholder="Random" onChange={(event) => setSeed(event.target.value)} /></Field>
            {customSize ? (
              <div className="number-row">
                <NumberPicker label="Width" value={width} onChange={setWidth} min={widthMeta.min ?? 64} max={widthMeta.max ?? 4096} step={widthMeta.step || (mode === "video" ? 32 : 64)} fill />
                <NumberPicker label="Height" value={height} onChange={setHeight} min={heightMeta.min ?? 64} max={heightMeta.max ?? 4096} step={heightMeta.step || (mode === "video" ? 32 : 64)} fill />
              </div>
            ) : null}
            <Field label="Sampler"><Select value={sampler} onChange={setSampler} options={profileOptions.samplers?.length ? profileOptions.samplers : models?.samplers?.length ? models.samplers : fallbackSamplers} /></Field>
            <Field label="Scheduler"><Select value={scheduler} onChange={setScheduler} options={profileOptions.schedulers?.length ? profileOptions.schedulers : models?.schedulers?.length ? models.schedulers : fallbackSchedulers} /></Field>
          </>
        ) : null}

        {tab === "advanced" ? (
          <>
            <div className="advanced-grid">
              {!models ? (
                <>
                  <Skeleton className="skeleton-control" />
                  <Skeleton className="skeleton-control" />
                </>
              ) : null}
              {currentProfile?.capabilities.textEncoder ? <Field label="Text encoder"><Select value={textEncoder} onChange={setTextEncoder} options={profileOptions.textEncoders || models?.textEncoders || []} /></Field> : null}
              {currentProfile?.capabilities.vae ? <Field label="VAE"><Select value={vae} onChange={setVae} options={profileOptions.vaes || models?.vaes || []} /></Field> : null}
              {currentProfile?.capabilities.weightDtype ? <Field label="Weight dtype"><Select value={weightDtype} onChange={setWeightDtype} options={profileOptions.weightDtypes || models?.weightDtypes || []} /></Field> : null}
              <NumberPicker label="CFG" value={cfg} onChange={setCfg} min={cfgMeta.min ?? 0} max={cfgMeta.max ?? 30} step={cfgMeta.step || 0.5} precision={1} fill />
            </div>
            {canUseStartImage && currentProfile?.capabilities.denoise ? (
              <NumberPicker label="Denoise" value={denoise} onChange={setDenoise} min={denoiseMeta.min ?? 0} max={denoiseMeta.max ?? 1} step={denoiseMeta.step || 0.05} precision={2} fill />
            ) : null}
          </>
        ) : null}

        {tab === "loras" && canUseLora ? (
          <div className="lora-tab">
            <LoraSnapshots snapshots={loraSnapshots} onLoad={loadLoraSnapshot} onSave={saveLoraSnapshot} onRename={renameLoraSnapshot} onDelete={deleteLoraSnapshot} />
            <div className="lora-list">
              {loras.length ? loras.map((item: LoraSelection, index: number) => (
                <div className={cn("lora-card", !item.enabled && "is-disabled")} key={index}>
                  <div className="lora-card-header">
                    <div className="lora-swatch" style={{ background: LORA_COLORS[index % LORA_COLORS.length] }} />
                    <button
                      type="button"
                      className={cn("lora-check", item.enabled && "on")}
                      onClick={() => updateLora(index, { enabled: !item.enabled })}
                      aria-label={item.enabled ? "Disable LoRA" : "Enable LoRA"}
                    />
                    <div className="lora-card-weight">
                      <button type="button" onClick={() => updateLora(index, { strength: Math.round((item.strength - 0.05) * 100) / 100 })}><Minus size={11} /></button>
                      <span>{item.strength.toFixed(2)}</span>
                      <button type="button" onClick={() => updateLora(index, { strength: Math.round((item.strength + 0.05) * 100) / 100 })}><Plus size={11} /></button>
                    </div>
                    <Tip content="Remove LoRA"><button type="button" className="lora-del" onClick={() => removeLora(index)}><Trash2 size={12} /></button></Tip>
                  </div>
                  <LoraSelect value={item.name} options={loraOptions} profile={currentProfile} onChange={(name) => updateLora(index, { name, strength: rememberedLoraStrength(name, item.strength) })} />
                </div>
              )) : (
                <div className="lora-list-empty">No LoRAs added yet</div>
              )}
            </div>
            <Tip content={loras.length >= maxLoras ? `Up to ${maxLoras} LoRAs` : "Add LoRA"}>
              <button type="button" className="lora-add-btn" onClick={addLora} disabled={loras.length >= maxLoras}>
                <Plus size={14} />
                Add LoRA
              </button>
            </Tip>
          </div>
        ) : null}
      </div>
    </>
  );
}

import { ChevronRight, GalleryHorizontalEnd, Wand2 } from 'lucide-react';
import { fallbackSamplers, fallbackSchedulers } from './constants';
import { cn } from './format';
import { maxLoras } from './loras';
import { Field, NumberPicker, Skeleton, StudioSelect as Select, Tip } from './components';
import { LoraPanel } from './LoraPanel';
import { ModelSetup } from './ModelSetup';
import { workflowState } from './workflowStatus';
import type { WorkflowSummary } from './types';
import { SafeImg } from './SafeImg';

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

  const status = workflowState(workflow.validation);
  return (
    <Tip content="Change workflow">
      <button type="button" className={cn("workflow-card", status.state !== "ready" && "has-issues")} onClick={onOpen}>
        <div className="workflow-card-thumb">
          <SafeImg src={workflow.thumbnail} fallback={<Wand2 size={18} />} />
        </div>
        <div className="workflow-card-info">
          <strong>{workflow.name}</strong>
          {status.state === "ready"
            ? <span>{workflow.family || (workflow.source === "builtin" ? "Built in" : "Imported")}</span>
            : <span className={cn("wf-status", `is-${status.state}`)}><i aria-hidden="true" />{status.label}</span>}
        </div>
        <ChevronRight size={15} className="workflow-card-arrow" />
      </button>
    </Tip>
  );
}

export type SidebarTab = "basics" | "advanced" | "loras";

export function SidebarControls({ view }: { view: any }) {
  const {
    canUseStartImage, cfg, cfgMeta, changeMode, count, countMeta, currentProfile, currentWorkflow,
    customSize, aspectLocked, denoise, denoiseMeta, fps, fpsMeta, frameMeta, frames, height, heightMeta, loras,
    loraActiveCount, mode, models, profileOptions, sampler, scheduler, seed,
    setCfg, setCount, setDenoise, setFps, setFrames, setHeight, setLoras, setSampler,
    setScheduler, setSeed, setSteps, setTextEncoder, setVae,
    setWeightDtype, setWidth, steps, stepsMeta, textEncoder, vae, weightDtype,
    width, widthMeta, setWorkflowGalleryOpen, loraLibrary, rememberedLoraStrength,
    textEncoders, setTextEncoders, refreshModels, refreshWorkflows, showToast,
    sidebarTab: tab, setSidebarTab: setTab
  } = view as Record<string, any> & { sidebarTab: SidebarTab; setSidebarTab: (tab: SidebarTab) => void };

  // Always file names; tolerate {name} entries so an odd server can't crash the picker.
  const loraOptions: string[] = (profileOptions.loras || models?.loras || [])
    .map((option: unknown) => typeof option === "string" ? option : String((option as { name?: string })?.name || ""))
    .filter(Boolean);
  const loraLimit = Math.min(maxLoras, currentProfile?.maxLoras || maxLoras);
  const loraUnavailable = currentProfile && !currentProfile.capabilities.lora && mode !== "image"
    ? "This video workflow has no LoRA loader. Built-in video models take LoRAs."
    : currentProfile && !currentProfile.capabilities.lora
      ? "This workflow has no LoRA loader, so it can't take LoRAs. Pick one that does in the workflow gallery."
      : !loraOptions.length
        ? "No LoRAs found. Put .safetensors files in ComfyUI's models/loras folder, then rescan in Settings › Connection."
        : "";

  return (
    <>
      <div className="mode-tabs" role="tablist" aria-label="Generation mode">
        <Tip content="Image generation"><button className={cn(mode === "image" && "active")} onClick={() => changeMode("image")}>Image</button></Tip>
        <Tip content="Video generation"><button className={cn(mode === "video" && "active")} onClick={() => changeMode("video")}>Video</button></Tip>
      </div>

      <WorkflowPreviewCard workflow={currentWorkflow} onOpen={() => setWorkflowGalleryOpen(true)} />

      {currentProfile?.missing?.length ? (
        <ModelSetup profile={currentProfile} showToast={showToast} onInstalled={() => { refreshModels(false); refreshWorkflows(); }} />
      ) : null}

      <div className="sidebar-subtabs" role="tablist" aria-label="Sidebar sections">
        {(["basics", "advanced", "loras"] as SidebarTab[]).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={cn("sidebar-subtab", tab === id && "active")} onClick={() => setTab(id)}>
            {id === "basics" ? "Basics" : id === "advanced" ? "Advanced" : "LoRAs"}
            {id === "loras" && loraActiveCount > 0 ? <span className="sidebar-subtab-count">{loraActiveCount}</span> : null}
          </button>
        ))}
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
            {customSize && !aspectLocked ? (
              <div className="number-row">
                <NumberPicker label="Width" value={width} onChange={setWidth} min={widthMeta.min ?? 64} max={widthMeta.max ?? 4096} step={widthMeta.step || (mode === "video" ? 32 : 64)} fill />
                <NumberPicker label="Height" value={height} onChange={setHeight} min={heightMeta.min ?? 64} max={heightMeta.max ?? 4096} step={heightMeta.step || (mode === "video" ? 32 : 64)} fill />
              </div>
            ) : null}
            {aspectLocked ? (
              <p className="sidebar-hint">Output size follows the reference image ({width}&times;{height}).</p>
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
              {currentProfile?.encoderSlots
                ? currentProfile.encoderSlots.filter((slot: { options: string[] }) => slot.options.length).map((slot: { slot: string; label: string; options: string[]; default: string }, index: number) => (
                  <Field key={slot.slot} label={currentProfile.encoderSlots.length > 1 ? slot.label : "Text encoder"}>
                    <Select value={textEncoders?.[index] || slot.default} onChange={(value: string) => setTextEncoders((current: string[]) => {
                      const next = [...(current || [])];
                      next[index] = value;
                      return next;
                    })} options={slot.options} />
                  </Field>
                ))
                : currentProfile?.capabilities.textEncoder ? <Field label="Text encoder"><Select value={textEncoder} onChange={setTextEncoder} options={profileOptions.textEncoders || models?.textEncoders || []} /></Field> : null}
              {currentProfile?.encoderBuiltIn ? <Field label="Text encoder"><span className="encoder-slot-builtin">Built into the checkpoint</span></Field> : null}
              {currentProfile?.capabilities.vae && (currentProfile.vaeBuiltIn || (profileOptions.vaes || []).length) ? (
                <Field label="VAE">
                  <Select
                    value={vae || (currentProfile.vaeBuiltIn ? "__builtin" : "")}
                    onChange={(value: string) => setVae(value === "__builtin" ? "" : value)}
                    options={[...(currentProfile.vaeBuiltIn ? [{ label: "Built into the checkpoint", value: "__builtin" }] : []), ...(profileOptions.vaes || models?.vaes || [])]}
                  />
                </Field>
              ) : null}
              {currentProfile?.capabilities.weightDtype ? <Field label="Weight dtype"><Select value={weightDtype} onChange={setWeightDtype} options={profileOptions.weightDtypes || models?.weightDtypes || []} /></Field> : null}
              <NumberPicker label="CFG" value={cfg} onChange={setCfg} min={cfgMeta.min ?? 0} max={cfgMeta.max ?? 30} step={cfgMeta.step || 0.5} precision={1} fill />
            </div>
            {canUseStartImage && currentProfile?.capabilities.denoise ? (
              <NumberPicker label="Denoise" value={denoise} onChange={setDenoise} min={denoiseMeta.min ?? 0} max={denoiseMeta.max ?? 1} step={denoiseMeta.step || 0.05} precision={2} fill />
            ) : null}
          </>
        ) : null}

        {tab === "loras" ? (
          <LoraPanel
            loras={loras}
            setLoras={setLoras}
            options={loraOptions}
            profile={currentProfile}
            limit={loraLimit}
            library={loraLibrary}
            rememberedStrength={rememberedLoraStrength}
            unavailableReason={loraUnavailable}
          />
        ) : null}
      </div>
    </>
  );
}

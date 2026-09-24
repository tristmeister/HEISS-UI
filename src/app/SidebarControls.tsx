import { ChevronRight, GalleryHorizontalEnd, Wand2 } from 'lucide-react';
import { fallbackSamplers, fallbackSchedulers } from './constants';
import { cn } from './format';
import { maxLoras } from './loras';
import { Field, NumberPicker, Skeleton, StudioSelect as Select, Tip } from './components';
import { LoraPanel } from './LoraPanel';
import { ModelSetup } from './ModelSetup';
import { ModelFoldersNotice } from './ModelFoldersNotice';
import { workflowState } from './workflowStatus';
import { useComfyRestarting } from './ComfyRestart';
import type { WorkflowSummary } from './types';
import { SafeImg } from './SafeImg';
import { PhoneSelect, PhoneSlider } from './phoneControls';

function WorkflowPreviewCard({ workflow, onOpen }: { workflow: WorkflowSummary | null; onOpen: () => void }) {
  const comfyRestarting = useComfyRestarting();
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

  const status = workflowState(workflow.validation, comfyRestarting);
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

/** What LoRAs the current workflow can take, shared by the sidebar and the phone's Advanced sheet. */
function loraSetup(view: any) {
  const { currentProfile, mode, models, profileOptions } = view;
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
        ? "No LoRAs found. Put .safetensors files in ComfyUI's models/loras folder, then rescan in Settings › Models."
        : "";
  return { loraOptions, loraLimit, loraUnavailable };
}

/**
 * The phone's Advanced sheet: the same settings as the sidebar, as big rows,
 * native pickers and sliders in plain groups. Steps and images stay on the
 * create sheet; this is everything behind them.
 */
export function PhoneAdvancedControls({ view }: { view: any }) {
  const {
    canUseStartImage, cfg, cfgMeta, changeMode, currentProfile, customSize, aspectLocked, denoise, denoiseMeta,
    fps, fpsMeta, frameMeta, frames, height, heightMeta, loras, mode, models, profileOptions, sampler, scheduler, seed,
    setCfg, setDenoise, setFps, setFrames, setHeight, setLoras, setSampler, setScheduler, setSeed, setTextEncoder, setVae,
    setWeightDtype, setWidth, textEncoder, vae, weightDtype, width, widthMeta, loraLibrary, rememberedLoraStrength,
    textEncoders, setTextEncoders, refreshModels, refreshWorkflows, showToast
  } = view;
  const { loraOptions, loraLimit, loraUnavailable } = loraSetup(view);
  const samplers = profileOptions.samplers?.length ? profileOptions.samplers : models?.samplers?.length ? models.samplers : fallbackSamplers;
  const schedulers = profileOptions.schedulers?.length ? profileOptions.schedulers : models?.schedulers?.length ? models.schedulers : fallbackSchedulers;
  const sizeStep = widthMeta.step || (mode === "video" ? 32 : 64);
  const sizeMax = (meta: { max?: number }) => Math.min(meta.max ?? 4096, 2048);
  const encoderSlots = (currentProfile?.encoderSlots || []).filter((slot: { options: string[] }) => slot.options.length);
  const showVae = currentProfile?.capabilities.vae && (currentProfile.vaeBuiltIn || (profileOptions.vaes || []).length);
  const parts = encoderSlots.length || currentProfile?.capabilities.textEncoder || showVae || currentProfile?.capabilities.weightDtype;
  return (
    <div className="phone-advanced-controls">
      <div className="phone-seg phone-mode" role="radiogroup" aria-label="Make">
        {(["image", "video"] as const).map((value) => (
          <button key={value} type="button" role="radio" aria-checked={mode === value} className={cn(mode === value && "active")} onClick={() => changeMode(value)}>{value === "image" ? "Image" : "Video"}</button>
        ))}
      </div>

      {currentProfile?.missing?.length ? <ModelSetup profile={currentProfile} showToast={showToast} onInstalled={() => { refreshModels(false); refreshWorkflows(); }} /> : null}

      <h3 className="phone-section">Sampling</h3>
      <div className="phone-group">
        <PhoneSelect label="Sampler" value={sampler} options={samplers} onChange={setSampler} />
        <PhoneSelect label="Scheduler" value={scheduler} options={schedulers} onChange={setScheduler} />
      </div>
      <PhoneSlider label="Prompt strength (CFG)" value={cfg} min={cfgMeta.min ?? 0} max={Math.min(cfgMeta.max ?? 30, 20)} step={cfgMeta.step || 0.5} onChange={setCfg} format={(value) => value.toFixed(1)} hint={<><span>Looser</span><span>Follows the prompt closely</span></>} />
      {canUseStartImage && currentProfile?.capabilities.denoise ? (
        <PhoneSlider label="Change from the reference" value={denoise} min={denoiseMeta.min ?? 0} max={denoiseMeta.max ?? 1} step={denoiseMeta.step || 0.05} onChange={setDenoise} format={(value) => `${Math.round(value * 100)}%`} hint={<><span>Keep it close</span><span>Change a lot</span></>} />
      ) : null}

      <h3 className="phone-section">Seed</h3>
      <div className="phone-group phone-seed-field">
        <label className="phone-row">
          <span>Seed<small>{String(seed || "").trim() ? "The same picture every time" : "A new picture every time"}</small></span>
          <input inputMode="numeric" pattern="[0-9]*" value={seed} placeholder="Random" aria-label="Seed" onChange={(event) => setSeed(event.target.value.replace(/[^0-9]/g, ""))} />
        </label>
        {String(seed || "").trim() ? <button type="button" className="phone-row" onClick={() => setSeed("")}><span>Back to random</span></button> : null}
      </div>

      {customSize && !aspectLocked ? (
        <>
          <h3 className="phone-section">Size</h3>
          <PhoneSlider label="Width" value={width} min={Math.max(widthMeta.min ?? 64, 256)} max={sizeMax(widthMeta)} step={sizeStep} onChange={setWidth} format={(value) => `${value}px`} />
          <PhoneSlider label="Height" value={height} min={Math.max(heightMeta.min ?? 64, 256)} max={sizeMax(heightMeta)} step={heightMeta.step || sizeStep} onChange={setHeight} format={(value) => `${value}px`} />
        </>
      ) : aspectLocked ? <p className="phone-note">The size follows the reference image ({width}×{height}).</p> : null}

      {mode === "video" ? (
        <>
          <h3 className="phone-section">Video</h3>
          <PhoneSlider label="Frames" value={frames} min={frameMeta.min || 1} max={Math.min(frameMeta.max ?? 240, 240)} step={frameMeta.step || 4} onChange={setFrames} />
          <PhoneSlider label="Frames per second" value={fps} min={fpsMeta.min || 1} max={Math.min(fpsMeta.max ?? 60, 60)} step={fpsMeta.step || 1} onChange={setFps} />
        </>
      ) : null}

      {parts ? (
        <>
          <h3 className="phone-section">Model parts</h3>
          <div className="phone-group">
            {encoderSlots.length
              ? encoderSlots.map((slot: { slot: string; label: string; options: string[]; default: string }, index: number) => (
                <PhoneSelect key={slot.slot} label={encoderSlots.length > 1 ? slot.label : "Text encoder"} value={textEncoders?.[index] || slot.default} options={slot.options} onChange={(value) => setTextEncoders((current: string[]) => { const next = [...(current || [])]; next[index] = value; return next; })} />
              ))
              : currentProfile?.capabilities.textEncoder ? <PhoneSelect label="Text encoder" value={textEncoder} options={profileOptions.textEncoders || models?.textEncoders || []} onChange={setTextEncoder} /> : null}
            {showVae ? (
              <PhoneSelect label="VAE" value={vae || (currentProfile.vaeBuiltIn ? "__builtin" : "")} options={[...(currentProfile.vaeBuiltIn ? [{ label: "Built into the checkpoint", value: "__builtin" }] : []), ...(profileOptions.vaes || models?.vaes || [])]} onChange={(value) => setVae(value === "__builtin" ? "" : value)} />
            ) : null}
            {currentProfile?.capabilities.weightDtype ? <PhoneSelect label="Weight type" value={weightDtype} options={profileOptions.weightDtypes || models?.weightDtypes || []} onChange={setWeightDtype} /> : null}
          </div>
        </>
      ) : null}

      <h3 className="phone-section">LoRAs</h3>
      <div className="phone-loras">
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
      </div>
    </div>
  );
}

export function SidebarControls({ view }: { view: any }) {
  const {
    canUseStartImage, cfg, cfgMeta, changeMode, count, countMeta, currentProfile, currentWorkflow,
    customSize, aspectLocked, denoise, denoiseMeta, fps, fpsMeta, frameMeta, frames, height, heightMeta, loras,
    loraActiveCount, mode, models, profileOptions, sampler, scheduler, seed,
    setCfg, setCount, setDenoise, setFps, setFrames, setHeight, setLoras, setSampler,
    setScheduler, setSeed, setSteps, setTextEncoder, setVae,
    setWeightDtype, setWidth, steps, stepsMeta, textEncoder, vae, weightDtype,
    width, widthMeta, setWorkflowGalleryOpen, loraLibrary, rememberedLoraStrength,
    textEncoders, setTextEncoders, refreshModels, refreshWorkflows, showToast, modelFolders,
    sidebarTab: tab, setSidebarTab: setTab
  } = view as Record<string, any> & { sidebarTab: SidebarTab; setSidebarTab: (tab: SidebarTab) => void };

  const { loraOptions, loraLimit, loraUnavailable } = loraSetup(view);

  return (
    <>
      <div className="mode-tabs" role="tablist" aria-label="Generation mode">
        <Tip content="Image generation"><button type="button" role="tab" aria-selected={mode === "image"} className={cn(mode === "image" && "active")} onClick={() => changeMode("image")}>Image</button></Tip>
        <Tip content="Video generation"><button type="button" role="tab" aria-selected={mode === "video"} className={cn(mode === "video" && "active")} onClick={() => changeMode("video")}>Video</button></Tip>
      </div>

      <WorkflowPreviewCard workflow={currentWorkflow} onOpen={() => setWorkflowGalleryOpen(true)} />

      {modelFolders ? <ModelFoldersNotice folders={modelFolders} /> : null}

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

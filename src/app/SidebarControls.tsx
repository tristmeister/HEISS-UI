import { t } from '../i18n/core.js';
import { useLanguage } from '../i18n/react';
import { ChevronRight, GalleryHorizontalEnd, RotateCcw, Wand2, X } from 'lucide-react';
import { fallbackSamplers, fallbackSchedulers } from './constants';
import { cn } from './format';
import { maxLoras } from './loras';
import { BetaTag, Field, NumberPicker, Skeleton, StudioSelect as Select, Tip } from './components';
import { LoraPanel } from './LoraPanel';
import { ModelSetup } from './ModelSetup';
import { ModelFoldersNotice } from './ModelFoldersNotice';
import { workflowState } from './workflowStatus';
import { useComfyRestarting } from './ComfyRestart';
import type { WorkflowSummary } from './types';
import { SafeImg } from './SafeImg';
import { referenceName } from './ReferenceMediaPicker';
import { PhoneSelect, PhoneSlider } from './phoneControls';
import { Switch } from './SettingsDialog';

function WorkflowPreviewCard({ workflow, onOpen }: { workflow: WorkflowSummary | null; onOpen: () => void }) {
  useLanguage();
  const comfyRestarting = useComfyRestarting();
  if (!workflow) return (
    <button type="button" className="workflow-card" onClick={onOpen}>
      <div className="workflow-card-thumb"><GalleryHorizontalEnd size={18} /></div>
      <div className="workflow-card-info">
        <strong>{t("No model selected")}</strong>
        <span>{t("Browse models")}</span>
      </div>
      <ChevronRight size={15} className="workflow-card-arrow" />
    </button>
  );

  const status = workflowState(workflow.validation, comfyRestarting);
  return (
    <Tip content={t("Change model")}>
      <button type="button" className={cn("workflow-card", status.state !== "ready" && "has-issues")} onClick={onOpen}>
        <div className="workflow-card-thumb">
          <SafeImg src={workflow.thumbnail} fallback={<Wand2 size={18} />} />
        </div>
        <div className="workflow-card-info">
          <strong>{workflow.name}</strong>
          {status.state === "ready"
            ? <span>{workflow.family || (workflow.source === "builtin" ? t("Built in") : t("Imported"))}</span>
            : <span className={cn("wf-status", `is-${status.state}`)}><i aria-hidden="true" />{status.label}</span>}
        </div>
        <ChevronRight size={15} className="workflow-card-arrow" />
      </button>
    </Tip>
  );
}

export type SidebarTab = "basics" | "loras" | "advanced";

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
      ? "This workflow has no LoRA loader, so it can’t use LoRAs."
      : !loraOptions.length
        ? "No LoRAs found. Put .safetensors files in ComfyUI’s models/loras folder, then rescan in Settings › Models."
        : "";
  return { loraOptions, loraLimit, loraUnavailable };
}

/**
 * The phone's Advanced sheet: the same settings as the sidebar, as big rows,
 * native pickers and sliders in plain groups. Steps and images stay on the
 * create sheet; this is everything behind them.
 */
export function PhoneAdvancedControls({ view }: { view: any }) {
  useLanguage();
  const {
    canUseStartImage, cfg, cfgMeta, changeMode, currentProfile, customSize, aspectLocked, denoise, denoiseMeta,
    fps, fpsMeta, frameMeta, frames, height, heightMeta, loras, mode, models, profileOptions, sampler, scheduler, seed,
    setCfg, setDenoise, setFps, setFrames, setHeight, setLoras, setSampler, setScheduler, setSeed, setTextEncoder, setVae,
    setWeightDtype, setWidth, textEncoder, vae, weightDtype, width, widthMeta, loraLibrary, rememberedLoraStrength,
    textEncoders, setTextEncoders, refreshModels, refreshWorkflows, showToast,
    inpaintActive, inpaintStrength, setInpaintStrength, inpaintFeather, setInpaintFeather
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
      <div className="phone-seg phone-mode" role="radiogroup" aria-label={t("Make")}>
        {(["image", "video"] as const).map((value) => (
          <button key={value} type="button" role="radio" aria-checked={mode === value} className={cn(mode === value && "active")} onClick={() => changeMode(value)}>{value === "image" ? <span>{t("Image")}</span> : <span>{t("Video")}<BetaTag /></span>}</button>
        ))}
      </div>

      {currentProfile ? <ModelSetup key={currentProfile.id} profile={currentProfile} showToast={showToast} onInstalled={() => { refreshModels(false); refreshWorkflows(); }} /> : null}

      <h3 className="phone-section">{t("LoRAs")}</h3>
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

      <h3 className="phone-section">{t("Sampling")}</h3>
      <div className="phone-group">
        <PhoneSelect label={t("Sampler")} value={sampler} options={samplers} onChange={setSampler} />
        <PhoneSelect label={t("Scheduler")} value={scheduler} options={schedulers} onChange={setScheduler} />
      </div>
      <PhoneSlider label={t("Prompt strength (CFG)")} value={cfg} min={cfgMeta.min ?? 0} max={Math.min(cfgMeta.max ?? 30, 20)} step={cfgMeta.step || 0.5} onChange={setCfg} format={(value) => value.toFixed(1)} hint={<><span>{t("Looser")}</span><span>{t("Follows the prompt closely")}</span></>} />
      {inpaintActive ? (
        <>
          {currentProfile?.capabilities.denoise ? <PhoneSlider label={t("Inpaint strength")} value={inpaintStrength} min={0.05} max={1} step={0.05} onChange={setInpaintStrength} format={(value) => `${Math.round(value * 100)}%`} hint={<><span>{t("Touch it up")}</span><span>{t("Paint it anew")}</span></>} /> : null}
          <PhoneSlider label={t("Edge softness")} value={inpaintFeather} min={0} max={1} step={0.05} onChange={setInpaintFeather} format={(value) => `${Math.round(value * 100)}%`} hint={<><span>{t("Crisp")}</span><span>{t("Soft")}</span></>} />
        </>
      ) : canUseStartImage && currentProfile?.capabilities.denoise ? (
        <PhoneSlider label={t("Change from the reference")} value={denoise} min={denoiseMeta.min ?? 0} max={denoiseMeta.max ?? 1} step={denoiseMeta.step || 0.05} onChange={setDenoise} format={(value) => `${Math.round(value * 100)}%`} hint={<><span>{t("Keep it close")}</span><span>{t("Change a lot")}</span></>} />
      ) : null}

      <h3 className="phone-section">{t("Seed")}</h3>
      <div className="phone-group phone-seed-field">
        <label className="phone-row">
          <span>{t("Seed")}<small>{String(seed || "").trim() ? t("The same picture every time") : t("A new picture every time")}</small></span>
          <input inputMode="numeric" pattern="[0-9]*" value={seed} placeholder={t("Random")} aria-label={t("Seed")} onChange={(event) => setSeed(event.target.value.replace(/[^0-9]/g, ""))} />
        </label>
        {String(seed || "").trim() ? <button type="button" className="phone-row" onClick={() => setSeed("")}><span>{t("Back to random")}</span></button> : null}
      </div>

      {customSize && !aspectLocked ? (
        <>
          <h3 className="phone-section">{t("Size")}</h3>
          <PhoneSlider label={t("Width")} value={width} min={Math.max(widthMeta.min ?? 64, 256)} max={sizeMax(widthMeta)} step={sizeStep} onChange={setWidth} format={(value) => `${value}px`} />
          <PhoneSlider label={t("Height")} value={height} min={Math.max(heightMeta.min ?? 64, 256)} max={sizeMax(heightMeta)} step={heightMeta.step || sizeStep} onChange={setHeight} format={(value) => `${value}px`} />
        </>
      ) : aspectLocked ? <p className="phone-note">{t("The size follows the image being edited (")}{width}×{height}).</p> : null}

      {mode === "video" ? (
        <>
          <h3 className="phone-section">{t("Video")}</h3>
          <PhoneSlider label={t("Frames")} value={frames} min={frameMeta.min || 1} max={Math.min(frameMeta.max ?? 240, 240)} step={frameMeta.step || 4} onChange={setFrames} />
          <PhoneSlider label={t("Frames per second")} value={fps} min={fpsMeta.min || 1} max={Math.min(fpsMeta.max ?? 60, 60)} step={fpsMeta.step || 1} onChange={setFps} />
        </>
      ) : null}

      {parts ? (
        <>
          <h3 className="phone-section">{t("Model parts")}</h3>
          <div className="phone-group">
            {encoderSlots.length
              ? encoderSlots.map((slot: { slot: string; label: string; options: string[]; default: string }, index: number) => (
                <PhoneSelect key={slot.slot} label={encoderSlots.length > 1 ? slot.label : t("Text encoder")} value={textEncoders?.[index] || slot.default} options={slot.options} onChange={(value) => setTextEncoders((current: string[]) => { const next = [...(current || [])]; next[index] = value; return next; })} />
              ))
              : currentProfile?.capabilities.textEncoder ? <PhoneSelect label={t("Text encoder")} value={textEncoder} options={profileOptions.textEncoders || models?.textEncoders || []} onChange={setTextEncoder} /> : null}
            {showVae ? (
              <PhoneSelect label={t("VAE")} value={vae || (currentProfile.vaeBuiltIn ? "__builtin" : "")} options={[...(currentProfile.vaeBuiltIn ? [{ label: t("Built into the checkpoint"), value: "__builtin" }] : []), ...(profileOptions.vaes || models?.vaes || [])]} onChange={(value) => setVae(value === "__builtin" ? "" : value)} />
            ) : null}
            {currentProfile?.capabilities.weightDtype ? <PhoneSelect label={t("Weight type")} value={weightDtype} options={profileOptions.weightDtypes || models?.weightDtypes || []} onChange={setWeightDtype} /> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function SidebarControls({ view }: { view: any }) {
  useLanguage();
  const {
    canUseStartImage, cfg, cfgMeta, changeMode, count, countMeta, currentProfile, currentWorkflow,
    customSize, aspectLocked, denoise, denoiseMeta, fps, fpsMeta, frameMeta, frames, height, heightMeta, loras,
    loraActiveCount, mode, models, profileOptions, sampler, scheduler, seed,
    setCfg, setCount, setDenoise, setFps, setFrames, setHeight, setLoras, setSampler,
    setScheduler, setSeed, setSteps, setTextEncoder, setVae,
    setWeightDtype, setWidth, steps, stepsMeta, textEncoder, vae, weightDtype,
    width, widthMeta, setWorkflowGalleryOpen, loraLibrary, rememberedLoraStrength,
    textEncoders, setTextEncoders, refreshModels, refreshWorkflows, showToast, modelFolders,
    sidebarTab: tab, setSidebarTab: setTab, recommended, sidebarReference,
    inpaintActive, inpaintStrength, setInpaintStrength, inpaintFeather, setInpaintFeather
  } = view as Record<string, any> & { sidebarTab: SidebarTab; setSidebarTab: (tab: SidebarTab) => void; recommended?: { differs: boolean; restore: () => void; family: string } };

  const { loraOptions, loraLimit, loraUnavailable } = loraSetup(view);
  // What the model's makers ship, one tap away once anything has moved from it.
  const backToRecommended = recommended?.differs ? (
    <button type="button" className="btn is-ghost sidebar-recommended" onClick={recommended.restore} title={t("The steps, prompt strength, sampler and scheduler recommended for {0}", { "0": (recommended.family || "this model") })}>
      <RotateCcw size={13} /> <span>{t("Back to recommended")}</span>
    </button>
  ) : null;

  return (
    <>
      <div className="mode-tabs" role="tablist" aria-label={t("Generation mode")}>
        <Tip content={t("Image generation")}><button type="button" role="tab" aria-selected={mode === "image"} className={cn(mode === "image" && "active")} onClick={() => changeMode("image")}>{t("Image")}</button></Tip>
        <Tip content={t("Video generation (beta)")}><button type="button" role="tab" aria-selected={mode === "video"} className={cn(mode === "video" && "active")} onClick={() => changeMode("video")}>{t("Video")}<BetaTag /></button></Tip>
      </div>

      <WorkflowPreviewCard workflow={currentWorkflow} onOpen={() => setWorkflowGalleryOpen(true)} />

      {modelFolders ? <ModelFoldersNotice folders={modelFolders} /> : null}

      {/* Always mounted: it shows what is missing, and a moment of "ready" when the last part lands. */}
      {currentProfile ? (
        <ModelSetup key={currentProfile.id} profile={currentProfile} showToast={showToast} onInstalled={() => { refreshModels(false); refreshWorkflows(); }} />
      ) : null}

      <div className="sidebar-subtabs" role="tablist" aria-label={t("Sidebar sections")}>
        {(["basics", "loras", "advanced"] as SidebarTab[]).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={cn("sidebar-subtab", tab === id && "active")} onClick={() => setTab(id)}>
            <span>{id === "basics" ? t("Basics") : id === "advanced" ? t("Advanced") : t("LoRAs")}</span>
            {id === "loras" && loraActiveCount > 0 ? <span className="sidebar-subtab-count">{loraActiveCount}</span> : null}
          </button>
        ))}
      </div>

      <div className="sidebar-body">
        {tab === "basics" ? (
          <>
            {sidebarReference ? (
              <section className="sidebar-reference" aria-label={sidebarReference.label}>
                <div className="sidebar-reference-row">
                  <span className="sidebar-reference-thumb"><SafeImg src={sidebarReference.asset.thumbnailUrl || sidebarReference.asset.url || ""} alt="" /></span>
                  <span className="sidebar-reference-copy">
                    <strong>{sidebarReference.label}</strong>
                    <small>{referenceName(sidebarReference.asset.name)}</small>
                  </span>
                  <Tip content={t("Remove {0}", { "0": (sidebarReference.label.toLowerCase()) })}>
                    <button type="button" className="icon-button sidebar-reference-remove" aria-label={t("Remove {0}", { "0": (sidebarReference.label.toLowerCase()) })} onClick={sidebarReference.remove}><X size={14} /></button>
                  </Tip>
                </div>
                {inpaintActive ? (
                  <>
                    {/* Edit models edit the crop whole, so only image-to-image models have a strength here. */}
                    {currentProfile?.capabilities.denoise ? (
                      <>
                        <NumberPicker label={t("Inpaint strength")} value={inpaintStrength} onChange={setInpaintStrength} min={0.05} max={1} step={0.05} precision={2} fill />
                        <div className="sidebar-scale-hint" aria-hidden="true"><span>{t("Touch it up")}</span><span>{t("Paint it anew")}</span></div>
                      </>
                    ) : null}
                    <NumberPicker label={t("Edge softness")} value={inpaintFeather} onChange={setInpaintFeather} min={0} max={1} step={0.05} precision={2} fill />
                    <div className="sidebar-scale-hint" aria-hidden="true"><span>{t("Crisp")}</span><span>{t("Soft")}</span></div>
                  </>
                ) : canUseStartImage && currentProfile?.capabilities.denoise ? (
                  <>
                    <NumberPicker label={t("Change from the reference")} value={denoise} onChange={setDenoise} min={denoiseMeta.min ?? 0} max={denoiseMeta.max ?? 1} step={denoiseMeta.step || 0.05} precision={2} fill />
                    <div className="sidebar-scale-hint" aria-hidden="true"><span>{t("Keep it close")}</span><span>{t("Change a lot")}</span></div>
                  </>
                ) : null}
              </section>
            ) : null}
            {currentProfile?.capabilities?.promptUpsampler ? (
              // The model's prompt enhancer (FLUX.3's upsampler), on by default; remembered on this device.
              <div className="sidebar-switch-row">
                <span>
                  <strong>Prompt enhancer</strong>
                  <small>{view.prefs?.promptEnhancer !== false ? `Expands your prompt into the detailed description ${currentProfile.familyName || "the model"} works best with.` : "Your prompt goes in exactly as written."}</small>
                </span>
                <Switch label="Prompt enhancer" size="sm" checked={view.prefs?.promptEnhancer !== false} onChange={(next) => view.setPrefs({ promptEnhancer: next })} />
              </div>
            ) : null}
            {mode === "video" ? (
              <div className="number-row">
                <NumberPicker label={t("Frames")} value={frames} onChange={setFrames} min={frameMeta.min || 1} max={frameMeta.max ?? 240} step={frameMeta.step || 4} fill />
                <NumberPicker label={t("FPS")} value={fps} onChange={setFps} min={fpsMeta.min || 1} max={fpsMeta.max ?? 60} step={fpsMeta.step || 1} fill />
              </div>
            ) : null}
            <div className="number-row">
              <NumberPicker label={t("Steps")} value={steps} onChange={setSteps} min={stepsMeta.min || 1} max={stepsMeta.max ?? 150} step={stepsMeta.step || 1} fill />
              {mode === "image" ? (
                <NumberPicker label={t("Images")} value={count} onChange={setCount} min={countMeta.min || 1} max={countMeta.max ?? 8} step={countMeta.step || 1} fill />
              ) : null}
            </div>
            <Field label={t("Seed")}><input inputMode="numeric" value={seed} placeholder={t("Random")} onChange={(event) => setSeed(event.target.value.replace(/[^0-9]/g, ""))} /></Field>
            <p className="sidebar-hint">{String(seed || "").trim() ? t("The same picture every time.") : t("A new picture every time.")}</p>
            {customSize && !aspectLocked ? (
              <div className="number-row">
                <NumberPicker label={t("Width")} value={width} onChange={setWidth} min={widthMeta.min ?? 64} max={widthMeta.max ?? 4096} step={widthMeta.step || (mode === "video" ? 32 : 64)} fill />
                <NumberPicker label={t("Height")} value={height} onChange={setHeight} min={heightMeta.min ?? 64} max={heightMeta.max ?? 4096} step={heightMeta.step || (mode === "video" ? 32 : 64)} fill />
              </div>
            ) : null}
            {aspectLocked ? (
              <p className="sidebar-hint">{t("Output size follows the image being edited (")}{width}{t("&times;")}{height}).</p>
            ) : null}
            {backToRecommended}
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
                  <Field key={slot.slot} label={currentProfile.encoderSlots.length > 1 ? slot.label : t("Text encoder")}>
                    <Select value={textEncoders?.[index] || slot.default} onChange={(value: string) => setTextEncoders((current: string[]) => {
                      const next = [...(current || [])];
                      next[index] = value;
                      return next;
                    })} options={slot.options} />
                  </Field>
                ))
                : currentProfile?.capabilities.textEncoder ? <Field label={t("Text encoder")}><Select value={textEncoder} onChange={setTextEncoder} options={profileOptions.textEncoders || models?.textEncoders || []} /></Field> : null}
              {currentProfile?.encoderBuiltIn ? <Field label={t("Text encoder")}><span className="encoder-slot-builtin">{t("Built into the checkpoint")}</span></Field> : null}
              {currentProfile?.capabilities.vae && (currentProfile.vaeBuiltIn || (profileOptions.vaes || []).length) ? (
                <Field label={t("VAE")}>
                  <Select
                    value={vae || (currentProfile.vaeBuiltIn ? "__builtin" : "")}
                    onChange={(value: string) => setVae(value === "__builtin" ? "" : value)}
                    options={[...(currentProfile.vaeBuiltIn ? [{ label: t("Built into the checkpoint"), value: "__builtin" }] : []), ...(profileOptions.vaes || models?.vaes || [])]}
                  />
                </Field>
              ) : null}
              {currentProfile?.capabilities.weightDtype ? <Field label={t("Weight type")}><Select value={weightDtype} onChange={setWeightDtype} options={profileOptions.weightDtypes || models?.weightDtypes || []} /></Field> : null}
            </div>
            <NumberPicker label={t("Prompt strength (CFG)")} value={cfg} onChange={setCfg} min={cfgMeta.min ?? 0} max={cfgMeta.max ?? 30} step={cfgMeta.step || 0.5} precision={1} fill />
            <div className="sidebar-scale-hint" aria-hidden="true"><span>{t("Looser")}</span><span>{t("Follows the prompt closely")}</span></div>
            {currentProfile?.capabilities.sampler !== false ? (
              <div className="advanced-grid">
                <Field label={t("Sampler")}><Select value={sampler} onChange={setSampler} options={profileOptions.samplers?.length ? profileOptions.samplers : models?.samplers?.length ? models.samplers : fallbackSamplers} /></Field>
                <Field label={t("Scheduler")}><Select value={scheduler} onChange={setScheduler} options={profileOptions.schedulers?.length ? profileOptions.schedulers : models?.schedulers?.length ? models.schedulers : fallbackSchedulers} /></Field>
              </div>
            ) : null}
            {backToRecommended}
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

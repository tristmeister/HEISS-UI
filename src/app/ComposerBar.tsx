import { t } from '../i18n/core.js';
import { useLanguage } from '../i18n/react';
import React from 'react';
import { ArrowUp, Dices, EyeOff, ChevronUp, CircleDotDashed, History, Images, Layers, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LoraMismatchChip, type LoraMismatch } from './LoraMismatchChip';
import { cn } from './format';
import { AspectPicker, ModelPicker, NumberPicker, Skeleton, Tip, type ControlDensity, type ModelMenuState } from './components';
import { AnimatedNumber } from './AnimatedNumber';
import { ReferenceSlots } from './ReferenceMediaPicker';
import type { AspectPreset, MediaInput, Profile, SavedSize, ReferenceAsset, ReferenceInpaint, ReferenceRoleControl, SelectedReferenceAsset } from './types';
import { estimatePhrase, formatAbout, type GenerationEstimate } from './useGenerationEstimate';
import type { MegapixelControl, SizeTier } from './SizeMenu';
import type { SideLimits } from './sizing';

/* ---------------------------------------------------------------------------
   The density ladder

   The composer bar always shows every control as large as it fits. When the
   row runs out of room we walk down a fixed ladder of single-notch demotions,
   cheapest control first, so the important ones keep their labels longest.
   Priority (largest kept longest): model > private > aspect > images > steps.
--------------------------------------------------------------------------- */

type ControlId = "workflow" | "private" | "negative" | "aspect" | "steps" | "variants" | "lora";
type Demotion = ControlDensity | "drawer";

const LADDER: Array<[ControlId, Demotion]> = [
  ["lora", "compact"],
  ["steps", "compact"],
  ["variants", "compact"],
  ["negative", "compact"],
  ["aspect", "compact"],
  ["steps", "mini"],
  ["variants", "mini"],
  ["aspect", "mini"],
  ["private", "compact"],
  ["workflow", "compact"],
  ["steps", "drawer"],
  ["lora", "drawer"],
  ["variants", "drawer"],
  ["aspect", "drawer"],
  ["workflow", "mini"],
];
/* Note: workflow and private never reach the drawer - they are the top of the
   hierarchy, and an icon-only pair plus a mini workflow chip still fits a
   320px screen. */

type Plan = Record<ControlId, { density: ControlDensity; drawer: boolean }>;

function planForLevel(level: number): Plan {
  const plan = {} as Plan;
  (["workflow", "private", "negative", "aspect", "steps", "variants", "lora"] as ControlId[])
    .forEach((id) => { plan[id] = { density: "full", drawer: false }; });
  for (let index = 0; index < Math.min(level, LADDER.length); index += 1) {
    const [id, to] = LADDER[index];
    if (to === "drawer") plan[id].drawer = true;
    else plan[id].density = to;
  }
  return plan;
}

/** Natural (unshrunk) width of a row, expanding the groups that get clipped by their grid track. */
function measureNaturalWidth(row: HTMLElement) {
  const gap = parseFloat(window.getComputedStyle(row).columnGap) || 0;
  const children = Array.from(row.children) as HTMLElement[];
  let total = 0;
  let counted = 0;
  for (const child of children) {
    if (child.dataset.fluidSkip !== undefined) continue;
    counted += 1;
    total += child.dataset.fluidGroup !== undefined ? measureGroupWidth(child) : child.offsetWidth;
  }
  return total + Math.max(0, counted - 1) * gap;
}

function measureGroupWidth(group: HTMLElement) {
  const gap = parseFloat(window.getComputedStyle(group).columnGap) || 0;
  const children = Array.from(group.children) as HTMLElement[];
  const width = children.reduce((sum, child) => sum + child.offsetWidth, 0);
  return width + Math.max(0, children.length - 1) * gap;
}

/**
 * Fits the bar to its container by walking the ladder. We remember what the bar
 * naturally needed at each level, so we only climb back up once that much room
 * is genuinely back — which is what keeps it from oscillating on a slow resize.
 */
function useDensityLevel(contentKey: string) {
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const [level, setLevel] = React.useState(0);
  const needsRef = React.useRef<number[]>([]);
  const levelRef = React.useRef(0);
  levelRef.current = level;

  const check = React.useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const available = row.clientWidth;
    if (!available) return;
    const needed = measureNaturalWidth(row);
    const current = levelRef.current;
    if (needed > available + 0.5) {
      if (current < LADDER.length) {
        needsRef.current[current] = needed;
        setLevel(current + 1);
      }
      return;
    }
    if (current > 0) {
      const neededOnePrevious = needsRef.current[current - 1];
      if (!neededOnePrevious || neededOnePrevious + 4 <= available) setLevel(current - 1);
    }
  }, []);

  const checkRef = React.useRef(check);
  checkRef.current = check;

  React.useLayoutEffect(() => { checkRef.current(); }, [level, contentKey]);
  React.useEffect(() => { needsRef.current = []; }, [contentKey]);
  React.useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => checkRef.current());
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  return { rowRef, plan: planForLevel(level), level };
}

/**
 * The zoom dock, the controls button and the gallery padding all sit above the
 * composer, and the composer's height now depends on how the ladder folded it.
 * Publishing the measured height as --zen-prompt-h keeps them from colliding.
 */
function useComposerHeightVar(rowRef: React.RefObject<HTMLDivElement | null>) {
  React.useEffect(() => {
    const composer = rowRef.current?.closest(".zen-prompt") as HTMLElement | null;
    const shell = rowRef.current?.closest(".zen-shell, .app-shell") as HTMLElement | null;
    if (!composer || !shell || typeof ResizeObserver === "undefined") return;
    const publish = () => shell.style.setProperty("--zen-prompt-h", `${Math.round(composer.offsetHeight)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(composer);
    return () => {
      observer.disconnect();
      shell.style.removeProperty("--zen-prompt-h");
    };
  }, []);
}

const generateButtonSpring = { type: "spring" as const, stiffness: 520, damping: 32, mass: 0.68 };

/**
 * `blocked` looks disabled but stays focusable and clickable, so a press (or a
 * tap on a phone, where there is no tooltip) explains why nothing can run yet.
 * `disabled` is only for a genuinely busy button.
 * The rest (ref, pointer and focus handlers, aria-describedby) is what the
 * wrapping Tip hangs on its trigger; without it the tooltip never opens.
 */
type GenerateButtonPassthrough = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className" | "disabled" | "onClick" | "aria-label" | "type" | "style" | "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd">;
function GenerateButton({ children, className, disabled, blocked, busy, onClick, "aria-label": ariaLabel, ref, ...rest }: GenerateButtonPassthrough & { children: React.ReactNode; className?: string; disabled?: boolean; blocked?: boolean; busy?: boolean; onClick?: React.MouseEventHandler<HTMLButtonElement>; "aria-label"?: string; ref?: React.Ref<HTMLButtonElement> }) {
  useLanguage();
  const prefersReducedMotion = useReducedMotion();
  const inert = disabled || blocked;
  return (
    <motion.button
      {...rest}
      ref={ref}
      type="button"
      className={className}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={blocked || undefined}
      aria-busy={busy || undefined}
      aria-label={ariaLabel}
      whileHover={prefersReducedMotion || inert ? undefined : { y: -1 }}
      whileTap={prefersReducedMotion || inert ? undefined : { y: 0, scale: 0.965 }}
      transition={generateButtonSpring}
    >
      {children}
    </motion.button>
  );
}

/** Where this generation lands, shown only in Hidden: a quiet ember chip, not a switch. */
function HiddenChip({ density = "full" }: { density?: ControlDensity }) {
  useLanguage();
  return (
    <Tip content={t("New images go into Hidden")}>
      <span className={cn("hidden-chip", density !== "full" && `is-density-${density}`)} role="status" aria-label={t("Generating into Hidden")}>
        {/* Eye-off, as on Hide: "this lands out of sight". The dock's lock is the place itself. */}
        <EyeOff size={12} strokeWidth={2.2} aria-hidden="true" />
        {density === "full" ? <span>{t("Hidden")}</span> : null}
      </span>
    </Tip>
  );
}

export type ComposerBarProps = {
  models: unknown;
  model: string;
  modelProfiles: Profile[];
  /** Whether the model menu marks models that can inpaint (off when inpainting is switched off). */
  showInpaint?: boolean;
  profileBadges: Record<string, string>;
  chooseModel: (value: string) => void;
  modelMenu?: ModelMenuState;
  currentProfile: Profile | null;
  comfyOffline: boolean;
  /** Down on purpose: the button says "Restarting…" and waits instead of offering a retry. */
  comfyRestarting?: boolean;
  onFindModels?: () => void;
  /** Opens "Get a model": the starter models, from the model menu. */
  onGetModels?: () => void;
  strayModelCount?: number;
  mode: string;
  aspectPickerValue: string;
  aspectOptions: AspectPreset[];
  aspectValue: string;
  defaultAspectSize: string;
  applyAspect: (value: string) => void;
  /** The size menu's tab (Default · 2K · Custom), and what Custom may be. */
  sizeTier?: SizeTier;
  /** The tabs on offer: 2K, or Megapixels in its place (Settings › Generation). */
  sizeTiers?: SizeTier[];
  sizeArea?: number;
  megapixelControl?: MegapixelControl | null;
  sizeMax?: number;
  customLimits?: { width: SideLimits; height: SideLimits };
  chooseSizeTier?: (tier: SizeTier) => void;
  applyCustomRatio?: (ratio: number) => void;
  setCustomDimensions?: (size: { width: number; height: number }) => void;
  savedSizes?: SavedSize[];
  saveCustomSize?: () => void;
  renameSavedSize?: (id: string, name: string) => void;
  removeSavedSize?: (id: string) => void;
  pickSavedSize?: (saved: SavedSize) => void;
  customSize: boolean;
  aspectLocked?: boolean;
  width: number;
  widthMeta: Record<string, number>;
  setWidth: (value: number) => void;
  height: number;
  heightMeta: Record<string, number>;
  setHeight: (value: number) => void;
  steps: number;
  stepsMeta: Record<string, number>;
  setSteps: (value: number) => void;
  count: number;
  countMeta: Record<string, number>;
  setCount: (value: number) => void;
  loraActiveCount: number;
  hiddenSpace: boolean;
  onOpenLoras?: () => void;
  showNegativePrompt: boolean;
  setShowNegativePrompt: (updater: (value: boolean) => boolean) => void;
  canUseNegativePrompt: boolean;
  runningCount: number;
  generateDisabled: boolean;
  generateDisabledReason?: string;
  generate: () => void;
  refreshComfyStatus: () => void;
  comfyRetrying?: boolean;
  referenceInputs?: MediaInput[];
  referenceInpaint?: ReferenceInpaint | null;
  referenceRole?: ReferenceRoleControl | null;
  loraMismatch?: LoraMismatch | null;
  onDismissLoraMismatch?: (key: string) => void;
  referenceAssets?: SelectedReferenceAsset[];
  onReferenceSelect: (slot: string, asset: ReferenceAsset) => void;
  onReferenceRemove: (slots: string | string[]) => void;
  onReferenceDeleteRequest: (asset: ReferenceAsset) => Promise<boolean>;
  onReferenceError: (message: string) => void;
  /** A fixed seed makes every run the same picture, so it is always on show. */
  pinnedSeed?: string;
  /** What Generate would take here, once the server trusts its estimate for this model. */
  generationEstimate?: GenerationEstimate | null;
  onRandomSeed?: () => void;
  /** The key that sends the prompt, shown in Generate's tooltip. */
  generateKey?: string;
  /** Recent prompts: the clock beside Negative, shown once there is a history. */
  onToggleHistory?: () => void;
  historyOpen?: boolean;
};

export function ComposerBar(props: ComposerBarProps) {
  useLanguage();
  const {
    models, model, modelProfiles, showInpaint = true, profileBadges, chooseModel, modelMenu, currentProfile, comfyOffline, comfyRestarting = false, onFindModels, onGetModels, strayModelCount, mode,
    aspectPickerValue, aspectOptions, aspectValue, defaultAspectSize, applyAspect, sizeTier = "none", sizeTiers, sizeArea = 0, megapixelControl = null, sizeMax, customLimits, chooseSizeTier, applyCustomRatio, setCustomDimensions, savedSizes, saveCustomSize, renameSavedSize, removeSavedSize, pickSavedSize,
    customSize, aspectLocked = false, width, widthMeta, setWidth, height, heightMeta, setHeight,
    steps, stepsMeta, setSteps, count, countMeta, setCount, loraActiveCount,
    hiddenSpace, onOpenLoras,
    showNegativePrompt, setShowNegativePrompt, canUseNegativePrompt,
    runningCount, generateDisabled, generateDisabledReason, generate, refreshComfyStatus, comfyRetrying,
    referenceInputs = [], referenceInpaint = null, referenceRole = null, loraMismatch = null, onDismissLoraMismatch, referenceAssets = [], onReferenceSelect, onReferenceRemove, onReferenceDeleteRequest, onReferenceError,
    pinnedSeed = "", onRandomSeed, generationEstimate = null, generateKey = "", onToggleHistory, historyOpen = false
  } = props;

  const showVariants = mode === "image" && currentProfile?.capabilities.variations !== false;
  const displayCount = showVariants ? count : 1;
  const workflowName = currentProfile?.displayName || currentProfile?.label || "";
  const contentKey = [workflowName, mode, customSize ? "custom" : "preset", aspectLocked ? "locked" : "free", loraActiveCount, hiddenSpace, canUseNegativePrompt, Boolean(models), pinnedSeed.trim(), Boolean(onToggleHistory)].join("|");
  const { rowRef, plan, level } = useDensityLevel(contentKey);
  useComposerHeightVar(rowRef);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  /* Every control is a function of its density, so the drawer can render the
     same control at full size while the bar shows a demoted copy. */
  const workflowPicker = (density: ControlDensity) => models
    ? <ModelPicker value={model} profiles={modelProfiles} showInpaint={showInpaint} onChange={chooseModel} menu={modelMenu} compact badges={profileBadges} density={density} onFindModels={comfyOffline ? undefined : onFindModels} onGetModels={comfyOffline ? undefined : onGetModels} strayCount={strayModelCount} emptyHint={comfyOffline ? "Start ComfyUI to see your models." : strayModelCount ? "Some models are in a folder ComfyUI doesn’t read." : "No usable models in ComfyUI yet. Add one to its models folder, or find yours."} />
    : comfyOffline ? null : <Skeleton className="composer-skeleton" />;

  const aspectPicker = (density: ControlDensity) => aspectLocked ? null : (
    <AspectPicker
      value={aspectPickerValue}
      onChange={(value) => applyAspect(value)}
      options={aspectOptions}
      currentSize={aspectValue}
      defaultSize={defaultAspectSize}
      density={density}
      tier={sizeTier}
      tiers={sizeTiers || (mode === "image" ? ["none", "2k", "custom"] : ["none", "custom"])}
      targetArea={sizeArea}
      megapixel={megapixelControl}
      native={currentProfile?.native}
      sizeMax={sizeMax}
      limits={customLimits}
      onTierChange={chooseSizeTier}
      onCustomRatio={applyCustomRatio}
      onCustomSize={setCustomDimensions}
      savedSizes={savedSizes}
      onSaveSize={saveCustomSize}
      onRenameSize={renameSavedSize}
      onRemoveSize={removeSavedSize}
      onPickSaved={pickSavedSize}
    />
  );

  const stepsPicker = (density: ControlDensity) => (
    <NumberPicker label={t("Steps")} icon={<CircleDotDashed size={14} />} density={density} value={steps} onChange={setSteps} min={stepsMeta.min || 1} max={stepsMeta.max || 150} step={stepsMeta.step || 1} size="sm" />
  );

  const variantsPicker = (density: ControlDensity) => showVariants ? (
    <NumberPicker label={t("Images")} icon={<Images size={14} />} density={density} value={count} onChange={setCount} min={countMeta.min || 1} max={countMeta.max ?? 8} step={countMeta.step || 1} size="sm" />
  ) : null;

  const loraPill = (density: ControlDensity) => loraActiveCount ? (
    <Tip content={t("{0} LoRA{1} active. Click to edit", { "0": (loraActiveCount), "1": (loraActiveCount === 1 ? t("") : t("s")) })}>
      <button type="button" className={cn("lora-pill", density !== "full" && `is-density-${density}`)} onClick={onOpenLoras} aria-label={t("{0} LoRA{1} active, edit LoRAs", { "0": (loraActiveCount), "1": (loraActiveCount === 1 ? t("") : t("s")) })}>
        {/* "2 LoRAs" where there's room; the icon and the count where there isn't. */}
        {density === "full" ? null : <Layers size={13} />}
        <AnimatedNumber value={loraActiveCount} />
        {density === "full" ? <span className="lora-pill-word">{loraActiveCount === 1 ? t("LoRA") : t("LoRAs")}</span> : null}
      </button>
    </Tip>
  ) : null;

  const privateToggle = (density: ControlDensity) => hiddenSpace ? <HiddenChip density={density} /> : null;

  const CONTROLS: Array<[ControlId, string, (density: ControlDensity) => React.ReactNode]> = [
    ["workflow", "Model", workflowPicker],
    ["private", "Hidden", privateToggle],
    ["aspect", "Aspect ratio", aspectPicker],
    ["steps", "Steps", stepsPicker],
    ["variants", "Images", variantsPicker],
    ["lora", "LoRA", loraPill]
  ];

  /** Controls the ladder has pushed out of the bar, in reading order for the drawer. */
  const tucked = CONTROLS.filter(([id, , render]) => plan[id].drawer && render("full"));

  React.useEffect(() => { if (!tucked.length) setDrawerOpen(false); }, [tucked.length]);

  const inline = (id: ControlId, render: (density: ControlDensity) => React.ReactNode) => (plan[id].drawer ? null : render(plan[id].density));

  return (
    <>
      <LoraMismatchChip mismatch={loraMismatch} onOpenLoras={onOpenLoras} onDismiss={(key) => onDismissLoraMismatch?.(key)} />
      <ReferenceSlots inputs={referenceInputs} inpaint={referenceInpaint} role={referenceRole} selected={referenceAssets} onSelect={onReferenceSelect} onRemove={onReferenceRemove} confirmDelete={onReferenceDeleteRequest} onError={onReferenceError} />
      <AnimatePresence initial={false}>
        {drawerOpen && tucked.length ? (
        <motion.div
          data-open-surface
          className="composer-drawer"
          initial={{ opacity: 0, y: 8, filter: "blur(3px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: 6, filter: "blur(2px)" }}
          transition={{ type: "spring", duration: 0.3, bounce: 0 }}
        >
          <header>
            <span>{t("Settings")}</span>
            <Tip content={t("Close")}><button type="button" className="icon-button" aria-label={t("Close settings")} onClick={() => setDrawerOpen(false)}><X size={14} /></button></Tip>
          </header>
          {tucked.map(([id, label, render]) => (
            <div className="composer-drawer-row" key={id}>
              <span>{label}</span>
              <div>{render("full")}</div>
            </div>
          ))}
        </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="zen-prompt-actions" ref={rowRef} data-density-level={level}>
        <div className="prompt-left-actions" data-fluid-group>
          <Tip content={!canUseNegativePrompt ? t("This model doesn’t use a negative prompt") : showNegativePrompt ? t("Hide negative prompt") : t("Show negative prompt")}>
            <button
              data-open-trigger
              type="button"
              className={cn("negative-toggle", showNegativePrompt && "active", !canUseNegativePrompt && "is-unavailable", plan.negative.density !== "full" && `is-density-${plan.negative.density}`)}
              aria-label={!canUseNegativePrompt ? t("Negative prompt unavailable for this model") : showNegativePrompt ? t("Hide negative prompt") : t("Show negative prompt")}
              aria-disabled={!canUseNegativePrompt || undefined}
              onClick={() => { if (canUseNegativePrompt) setShowNegativePrompt((value: boolean) => !value); }}
            >
              <ChevronUp size={13} className={cn(!showNegativePrompt && "flip")} />
              {plan.negative.density === "full" ? t("Negative") : null}
            </button>
          </Tip>
          {onToggleHistory ? (
            // Styled as the Negative toggle at its icon-only size: one family of composer controls.
            <Tip content={t("Recent prompts (↑ in an empty prompt)")}>
              <button
                data-history-trigger
                type="button"
                className={cn("negative-toggle is-density-mini history-toggle", historyOpen && "active")}
                aria-label={t("Recent prompts")}
                aria-expanded={historyOpen}
                aria-haspopup="dialog"
                onClick={onToggleHistory}
              >
                <History size={14} />
              </button>
            </Tip>
          ) : null}
          {inline("private", privateToggle)}
          {pinnedSeed.trim() && onRandomSeed ? (
            <Tip content={t("Every run uses seed {0}. Click for a random seed.", { "0": (pinnedSeed.trim()) })}>
              <button type="button" className="seed-chip" aria-label={t("Seed {0} is fixed. Use a random seed", { "0": (pinnedSeed.trim()) })} onClick={onRandomSeed}>
                <Dices size={14} />
                <span>{pinnedSeed.trim()}</span>
              </button>
            </Tip>
          ) : null}
          {/* A video takes minutes; once this machine has run one like it, say how long, before it starts. */}
          {mode === "video" && generationEstimate?.ms && generationEstimate.ms >= 60_000 ? (
            <Tip content={t("From your last runs of this model at this size{0}", { "0": (generationEstimate.queueMs && generationEstimate.queueMs > 5000 ? `, after ${formatAbout(generationEstimate.queueMs)} of queue` : t("")) })}>
              <span className="composer-estimate">{t("Usually")}{" "}{formatAbout(generationEstimate.ms)}{t("here")}</span>
            </Tip>
          ) : null}
        </div>
        <div className="zen-inline-settings" data-fluid-group>
          {inline("workflow", workflowPicker)}
          {inline("aspect", aspectPicker)}
          {inline("steps", stepsPicker)}
          {inline("variants", variantsPicker)}
          {inline("lora", loraPill)}
          {tucked.length ? (
            <Tip content={t("More settings")}>
              <button
                type="button"
                data-open-trigger
                className={cn("composer-more", drawerOpen && "active")}
                aria-label={t("More settings")}
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen((value) => !value)}
              >
                <SlidersHorizontal size={15} />
                <i>{tucked.length}</i>
              </button>
            </Tip>
          ) : null}
        </div>
        <Tip content={comfyRestarting ? t("ComfyUI is restarting. Back in a few seconds.") : comfyOffline ? t("ComfyUI is offline. Click to check again.") : generateDisabledReason || `${mode === "image" ? `Generate ${displayCount} image${displayCount === 1 ? "" : "s"}` : "Generate video"}${estimatePhrase(generationEstimate) ? ` · ${estimatePhrase(generationEstimate)}` : ""}${generateKey ? ` · ${generateKey}` : ""}`}>
          <GenerateButton
            className={cn("generate", Boolean(runningCount) && !comfyOffline && !comfyRestarting && "is-working", comfyRestarting ? "is-restarting" : comfyOffline && "is-offline")}
            onClick={comfyRestarting ? undefined : comfyOffline ? refreshComfyStatus : generate}
            disabled={comfyRestarting || (comfyOffline ? comfyRetrying : false)}
            blocked={!comfyOffline && !comfyRestarting && generateDisabled}
            busy={comfyRestarting || (comfyOffline && comfyRetrying) || undefined}
            aria-label={comfyRestarting ? t("ComfyUI is restarting") : comfyOffline ? (comfyRetrying ? t("Checking ComfyUI") : t("ComfyUI offline, check again")) : generateDisabledReason || t("Generate")}
          >
            {comfyRestarting
              ? <><RefreshCw size={14} className="spin" /><span>{t("Restarting…")}</span></>
              : comfyOffline ? <><RefreshCw size={14} className={cn(comfyRetrying && "spin")} /><span>{comfyRetrying ? t("Checking…") : t("ComfyUI offline")}</span></> : <ArrowUp size={18} strokeWidth={2.4} />}
          </GenerateButton>
        </Tip>
      </div>
    </>
  );
}

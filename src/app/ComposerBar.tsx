import React from 'react';
import { ArrowUp, Dices, EyeOff, ChevronUp, CircleDotDashed, Images, Layers, MoveHorizontal, MoveVertical, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from './format';
import { AspectPicker, ModelPicker, NumberPicker, Skeleton, Tip, type ControlDensity, type ModelMenuState } from './components';
import { AnimatedNumber } from './AnimatedNumber';
import { ReferenceSlots, type ReferenceStrength } from './ReferenceMediaPicker';
import type { AspectPreset, MediaInput, Profile, ReferenceAsset, SelectedReferenceAsset } from './types';

/* ---------------------------------------------------------------------------
   The density ladder

   The composer bar always shows every control as large as it fits. When the
   row runs out of room we walk down a fixed ladder of single-notch demotions,
   cheapest control first, so the important ones keep their labels longest.
   Priority (largest kept longest): workflow > private > aspect > variants > steps.
--------------------------------------------------------------------------- */

type ControlId = "workflow" | "private" | "negative" | "aspect" | "size" | "steps" | "variants" | "lora";
type Demotion = ControlDensity | "drawer";

const LADDER: Array<[ControlId, Demotion]> = [
  ["lora", "compact"],
  ["steps", "compact"],
  ["variants", "compact"],
  ["size", "compact"],
  ["negative", "compact"],
  ["aspect", "compact"],
  ["steps", "mini"],
  ["variants", "mini"],
  ["size", "mini"],
  ["aspect", "mini"],
  ["private", "compact"],
  ["workflow", "compact"],
  ["steps", "drawer"],
  ["lora", "drawer"],
  ["size", "drawer"],
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
  (["workflow", "private", "negative", "aspect", "size", "steps", "variants", "lora"] as ControlId[])
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
 */
function GenerateButton({ children, className, disabled, blocked, busy, onClick, "aria-label": ariaLabel }: { children: React.ReactNode; className?: string; disabled?: boolean; blocked?: boolean; busy?: boolean; onClick?: React.MouseEventHandler<HTMLButtonElement>; "aria-label"?: string }) {
  const prefersReducedMotion = useReducedMotion();
  const inert = disabled || blocked;
  return (
    <motion.button
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
  return (
    <Tip content="New images go into Hidden">
      <span className={cn("hidden-chip", density !== "full" && `is-density-${density}`)} role="status" aria-label="Generating into Hidden">
        {/* Eye-off, as on Hide: "this lands out of sight". The dock's lock is the place itself. */}
        <EyeOff size={12} strokeWidth={2.2} aria-hidden="true" />
        {density === "full" ? <span>Hidden</span> : null}
      </span>
    </Tip>
  );
}

export type ComposerBarProps = {
  models: unknown;
  model: string;
  modelProfiles: Profile[];
  profileBadges: Record<string, string>;
  chooseModel: (value: string) => void;
  modelMenu?: ModelMenuState;
  currentProfile: Profile | null;
  comfyOffline: boolean;
  /** Down on purpose: the button says "Restarting…" and waits instead of offering a retry. */
  comfyRestarting?: boolean;
  onFindModels?: () => void;
  strayModelCount?: number;
  mode: string;
  aspectPickerValue: string;
  aspectOptions: AspectPreset[];
  aspectValue: string;
  defaultAspectSize: string;
  applyAspect: (value: string) => void;
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
  referenceStrength?: ReferenceStrength | null;
  referenceAssets?: SelectedReferenceAsset[];
  onReferenceSelect: (slot: string, asset: ReferenceAsset) => void;
  onReferenceRemove: (slot: string) => void;
  onReferenceDeleteRequest: (asset: ReferenceAsset) => Promise<boolean>;
  onReferenceError: (message: string) => void;
  /** A fixed seed makes every run the same picture, so it is always on show. */
  pinnedSeed?: string;
  onRandomSeed?: () => void;
};

export function ComposerBar(props: ComposerBarProps) {
  const {
    models, model, modelProfiles, profileBadges, chooseModel, modelMenu, currentProfile, comfyOffline, comfyRestarting = false, onFindModels, strayModelCount, mode,
    aspectPickerValue, aspectOptions, aspectValue, defaultAspectSize, applyAspect,
    customSize, aspectLocked = false, width, widthMeta, setWidth, height, heightMeta, setHeight,
    steps, stepsMeta, setSteps, count, countMeta, setCount, loraActiveCount,
    hiddenSpace, onOpenLoras,
    showNegativePrompt, setShowNegativePrompt, canUseNegativePrompt,
    runningCount, generateDisabled, generateDisabledReason, generate, refreshComfyStatus, comfyRetrying,
    referenceInputs = [], referenceStrength = null, referenceAssets = [], onReferenceSelect, onReferenceRemove, onReferenceDeleteRequest, onReferenceError,
    pinnedSeed = "", onRandomSeed
  } = props;

  const showVariants = mode === "image" && currentProfile?.capabilities.variations !== false;
  const displayCount = showVariants ? count : 1;
  const workflowName = currentProfile?.displayName || currentProfile?.label || "";
  const contentKey = [workflowName, mode, customSize ? "custom" : "preset", aspectLocked ? "locked" : "free", loraActiveCount, hiddenSpace, canUseNegativePrompt, Boolean(models), pinnedSeed.trim()].join("|");
  const { rowRef, plan, level } = useDensityLevel(contentKey);
  useComposerHeightVar(rowRef);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  /* Every control is a function of its density, so the drawer can render the
     same control at full size while the bar shows a demoted copy. */
  const workflowPicker = (density: ControlDensity) => models
    ? <ModelPicker value={model} profiles={modelProfiles} onChange={chooseModel} menu={modelMenu} compact badges={profileBadges} density={density} onFindModels={comfyOffline ? undefined : onFindModels} strayCount={strayModelCount} emptyHint={comfyOffline ? "ComfyUI isn't reachable. Start it and your models show up here." : strayModelCount ? "Your models are in a folder ComfyUI doesn’t read." : "ComfyUI has no model HEISS UI can run yet. Add one to its models folder, or search for yours."} />
    : comfyOffline ? null : <Skeleton className="composer-skeleton" />;

  const aspectPicker = (density: ControlDensity) => aspectLocked ? null : (
    <AspectPicker
      value={aspectPickerValue}
      onChange={(value) => applyAspect(value)}
      options={aspectOptions}
      currentSize={aspectValue}
      defaultSize={defaultAspectSize}
      density={density}
    />
  );

  const sizePickers = (density: ControlDensity) => customSize && !aspectLocked ? (
    <>
      <NumberPicker label="Width" icon={<MoveHorizontal size={13} />} density={density} value={width} onChange={setWidth} min={widthMeta.min ?? 64} max={widthMeta.max ?? 4096} step={widthMeta.step || (mode === "video" ? 32 : 64)} size="sm" />
      <NumberPicker label="Height" icon={<MoveVertical size={13} />} density={density} value={height} onChange={setHeight} min={heightMeta.min ?? 64} max={heightMeta.max ?? 4096} step={heightMeta.step || (mode === "video" ? 32 : 64)} size="sm" />
    </>
  ) : null;

  const stepsPicker = (density: ControlDensity) => (
    <NumberPicker label="Steps" icon={<CircleDotDashed size={14} />} density={density} value={steps} onChange={setSteps} min={stepsMeta.min || 1} max={stepsMeta.max || 150} step={stepsMeta.step || 1} size="sm" />
  );

  const variantsPicker = (density: ControlDensity) => showVariants ? (
    <NumberPicker label="Variants" icon={<Images size={14} />} density={density} value={count} onChange={setCount} min={countMeta.min || 1} max={countMeta.max ?? 8} step={countMeta.step || 1} size="sm" />
  ) : null;

  const loraPill = (density: ControlDensity) => loraActiveCount ? (
    <Tip content={`${loraActiveCount} LoRA${loraActiveCount === 1 ? "" : "s"} active. Click to edit`}>
      <button type="button" className={cn("lora-pill", density !== "full" && `is-density-${density}`)} onClick={onOpenLoras} aria-label={`${loraActiveCount} LoRA${loraActiveCount === 1 ? "" : "s"} active, edit LoRAs`}>
        {density === "full" ? "LoRA" : <Layers size={13} />}
        <AnimatedNumber value={loraActiveCount} />
      </button>
    </Tip>
  ) : null;

  const privateToggle = (density: ControlDensity) => hiddenSpace ? <HiddenChip density={density} /> : null;

  const CONTROLS: Array<[ControlId, string, (density: ControlDensity) => React.ReactNode]> = [
    ["workflow", "Workflow", workflowPicker],
    ["private", "Hidden", privateToggle],
    ["aspect", "Aspect ratio", aspectPicker],
    ["size", "Size", sizePickers],
    ["variants", "Variants", variantsPicker],
    ["steps", "Steps", stepsPicker],
    ["lora", "LoRA", loraPill]
  ];

  /** Controls the ladder has pushed out of the bar, in reading order for the drawer. */
  const tucked = CONTROLS.filter(([id, , render]) => plan[id].drawer && render("full"));

  React.useEffect(() => { if (!tucked.length) setDrawerOpen(false); }, [tucked.length]);

  const inline = (id: ControlId, render: (density: ControlDensity) => React.ReactNode) => (plan[id].drawer ? null : render(plan[id].density));

  return (
    <>
      <ReferenceSlots inputs={referenceInputs} strength={referenceStrength} selected={referenceAssets} onSelect={onReferenceSelect} onRemove={onReferenceRemove} confirmDelete={onReferenceDeleteRequest} onError={onReferenceError} />
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
            <span>Settings</span>
            <Tip content="Close"><button type="button" className="icon-button" aria-label="Close settings" onClick={() => setDrawerOpen(false)}><X size={14} /></button></Tip>
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
          <Tip content={!canUseNegativePrompt ? "Negative prompt is unavailable for this workflow" : showNegativePrompt ? "Hide negative prompt" : "Show negative prompt"}>
            <button
              data-open-trigger
              type="button"
              className={cn("negative-toggle", showNegativePrompt && "active", !canUseNegativePrompt && "is-unavailable", plan.negative.density !== "full" && `is-density-${plan.negative.density}`)}
              aria-label={!canUseNegativePrompt ? "Negative prompt unavailable for this workflow" : showNegativePrompt ? "Hide negative prompt" : "Show negative prompt"}
              aria-disabled={!canUseNegativePrompt || undefined}
              onClick={() => { if (canUseNegativePrompt) setShowNegativePrompt((value: boolean) => !value); }}
            >
              <ChevronUp size={13} className={cn(!showNegativePrompt && "flip")} />
              {plan.negative.density === "full" ? "Negative" : null}
            </button>
          </Tip>
          {inline("private", privateToggle)}
          {pinnedSeed.trim() && onRandomSeed ? (
            <Tip content={`Every run uses seed ${pinnedSeed.trim()}. Tap for a random seed.`}>
              <button type="button" className="seed-chip" aria-label={`Seed ${pinnedSeed.trim()} is fixed. Use a random seed`} onClick={onRandomSeed}>
                <Dices size={14} />
                <span>{pinnedSeed.trim()}</span>
              </button>
            </Tip>
          ) : null}
        </div>
        <div className="zen-inline-settings" data-fluid-group>
          {inline("workflow", workflowPicker)}
          {inline("aspect", aspectPicker)}
          {inline("size", sizePickers)}
          {inline("steps", stepsPicker)}
          {inline("variants", variantsPicker)}
          {inline("lora", loraPill)}
          {tucked.length ? (
            <Tip content="More settings">
              <button
                type="button"
                data-open-trigger
                className={cn("composer-more", drawerOpen && "active")}
                aria-label="More settings"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen((value) => !value)}
              >
                <SlidersHorizontal size={15} />
                <i>{tucked.length}</i>
              </button>
            </Tip>
          ) : null}
        </div>
        <Tip content={comfyRestarting ? "ComfyUI is restarting. Generate is back in a few seconds." : comfyOffline ? "ComfyUI isn't reachable. Click to try again." : generateDisabledReason || (mode === "image" ? `Generate ${displayCount} image${displayCount === 1 ? "" : "s"}` : "Generate video")}>
          <GenerateButton
            className={cn("generate", Boolean(runningCount) && !comfyOffline && !comfyRestarting && "is-working", comfyRestarting ? "is-restarting" : comfyOffline && "is-offline")}
            onClick={comfyRestarting ? undefined : comfyOffline ? refreshComfyStatus : generate}
            disabled={comfyRestarting || (comfyOffline ? comfyRetrying : false)}
            blocked={!comfyOffline && !comfyRestarting && generateDisabled}
            busy={comfyRestarting || (comfyOffline && comfyRetrying) || undefined}
            aria-label={comfyRestarting ? "ComfyUI is restarting" : comfyOffline ? (comfyRetrying ? "Checking ComfyUI" : "ComfyUI offline, retry connection") : generateDisabledReason || "Generate"}
          >
            {comfyRestarting
              ? <><RefreshCw size={14} className="spin" /><span>Restarting…</span></>
              : comfyOffline ? <><RefreshCw size={14} className={cn(comfyRetrying && "spin")} /><span>{comfyRetrying ? "Checking…" : "ComfyUI offline"}</span></> : <ArrowUp size={18} strokeWidth={2.4} />}
          </GenerateButton>
        </Tip>
      </div>
    </>
  );
}

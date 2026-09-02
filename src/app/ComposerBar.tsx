import React from 'react';
import { ArrowUp, ChevronUp, CircleDotDashed, Images, Layers, LockKeyhole, MoveHorizontal, MoveVertical, SlidersHorizontal, WifiOff, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from './format';
import { AspectPicker, ModelPicker, NumberPicker, Skeleton, Tip, type ControlDensity } from './components';
import { AnimatedNumber } from './AnimatedNumber';
import type { AspectPreset, Profile } from './types';

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

function GenerateButton({ children, className, disabled, onClick, "aria-label": ariaLabel }: { children: React.ReactNode; className?: string; disabled?: boolean; onClick?: React.MouseEventHandler<HTMLButtonElement>; "aria-label"?: string }) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <motion.button
      type="button"
      className={className}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      whileHover={prefersReducedMotion || disabled ? undefined : { y: -1 }}
      whileTap={prefersReducedMotion || disabled ? undefined : { y: 0, scale: 0.965 }}
      transition={generateButtonSpring}
    >
      {children}
    </motion.button>
  );
}

function PrivateToggle({ active, enabled, onChange, density = "full" }: { active: boolean; enabled: boolean; onChange: () => void; density?: ControlDensity }) {
  const isActive = active && enabled;
  const label = isActive ? "Private mode on" : "Private mode off";
  return (
    <Tip content={enabled ? active ? "This generation will be encrypted in Private Vault" : "Store this generation normally" : "Set a privacy password in Settings to enable Private Vault"}>
      <button
        type="button"
        className={cn("private-toggle", isActive && "is-private", density !== "full" && `is-density-${density}`)}
        aria-label={label}
        aria-pressed={isActive}
        disabled={!enabled}
        onClick={onChange}
      >
        <span className="private-toggle-indicator" aria-hidden="true">
          <LockKeyhole size={13} strokeWidth={2} />
          <span className="private-toggle-slash" />
        </span>
        {density === "full" ? <span>Private</span> : null}
      </button>
    </Tip>
  );
}

export type ComposerBarProps = {
  models: unknown;
  model: string;
  modelProfiles: Profile[];
  profileBadges: Record<string, string>;
  chooseModel: (value: string) => void;
  currentProfile: Profile | null;
  comfyOffline: boolean;
  mode: string;
  aspectPickerValue: string;
  aspectOptions: AspectPreset[];
  aspectValue: string;
  defaultAspectSize: string;
  applyAspect: (value: string) => void;
  customSize: boolean;
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
  privateGeneration: boolean;
  privacyEnabled: boolean;
  setPrivateGeneration: (updater: (value: boolean) => boolean) => void;
  showNegativePrompt: boolean;
  setShowNegativePrompt: (updater: (value: boolean) => boolean) => void;
  canUseNegativePrompt: boolean;
  runningCount: number;
  generate: () => void;
  refreshComfyStatus: () => void;
};

export function ComposerBar(props: ComposerBarProps) {
  const {
    models, model, modelProfiles, profileBadges, chooseModel, currentProfile, comfyOffline, mode,
    aspectPickerValue, aspectOptions, aspectValue, defaultAspectSize, applyAspect,
    customSize, width, widthMeta, setWidth, height, heightMeta, setHeight,
    steps, stepsMeta, setSteps, count, countMeta, setCount, loraActiveCount,
    privateGeneration, privacyEnabled, setPrivateGeneration,
    showNegativePrompt, setShowNegativePrompt, canUseNegativePrompt,
    runningCount, generate, refreshComfyStatus
  } = props;

  const showVariants = mode === "image";
  const workflowName = currentProfile?.displayName || currentProfile?.label || "";
  const contentKey = [workflowName, mode, customSize ? "custom" : "preset", loraActiveCount, privacyEnabled, canUseNegativePrompt, Boolean(models)].join("|");
  const { rowRef, plan, level } = useDensityLevel(contentKey);
  useComposerHeightVar(rowRef);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  /* Every control is a function of its density, so the drawer can render the
     same control at full size while the bar shows a demoted copy. */
  const workflowPicker = (density: ControlDensity) => models
    ? <ModelPicker value={model} profiles={modelProfiles} onChange={chooseModel} compact badges={profileBadges} density={density} />
    : comfyOffline ? null : <Skeleton className="skeleton-control" />;

  const aspectPicker = (density: ControlDensity) => (
    <AspectPicker
      value={aspectPickerValue}
      onChange={(value) => applyAspect(value)}
      options={aspectOptions}
      currentSize={aspectValue}
      defaultSize={defaultAspectSize}
      density={density}
    />
  );

  const sizePickers = (density: ControlDensity) => customSize ? (
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
    <Tip content={`${loraActiveCount} LoRA${loraActiveCount === 1 ? "" : "s"} active`}>
      <span className={cn("lora-pill", density !== "full" && `is-density-${density}`)}>
        {density === "full" ? "LoRA" : <Layers size={13} />}
        <AnimatedNumber value={loraActiveCount} />
      </span>
    </Tip>
  ) : null;

  const privateToggle = (density: ControlDensity) => (
    <PrivateToggle
      active={privateGeneration}
      enabled={privacyEnabled}
      onChange={() => setPrivateGeneration((value: boolean) => !value)}
      density={density}
    />
  );

  const CONTROLS: Array<[ControlId, string, (density: ControlDensity) => React.ReactNode]> = [
    ["workflow", "Workflow", workflowPicker],
    ["private", "Private", privateToggle],
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
              aria-label={showNegativePrompt ? "Hide negative prompt" : "Show negative prompt"}
              onClick={() => setShowNegativePrompt((value: boolean) => !value)}
            >
              <ChevronUp size={13} className={cn(!showNegativePrompt && "flip")} />
              {plan.negative.density === "full" ? "Negative" : null}
            </button>
          </Tip>
          {inline("private", privateToggle)}
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
        <Tip content={comfyOffline ? "ComfyUI is offline" : mode === "image" ? `Generate ${count} image${count === 1 ? "" : "s"}` : "Generate video"}>
          <GenerateButton
            className={cn("generate", Boolean(runningCount) && !comfyOffline && "is-working", comfyOffline && "is-offline")}
            onClick={comfyOffline ? refreshComfyStatus : generate}
            disabled={!currentProfile && !comfyOffline}
            aria-label={comfyOffline ? "ComfyUI is offline" : "Generate"}
          >
            {comfyOffline ? <WifiOff size={16} /> : <ArrowUp size={18} strokeWidth={2.4} />}
          </GenerateButton>
        </Tip>
      </div>
    </>
  );
}

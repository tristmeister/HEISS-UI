import { t } from '../i18n/core.js';
import { useLanguage } from '../i18n/react';
import React, { lazy, Suspense, memo, useCallback, useEffect, useRef, useState } from 'react';
import { VideoPreview } from './VideoPreview';
import { mediaUrl } from './mediaUrl';
import { useDismiss } from './useDismiss';
import { Brush, ChevronDown, ImagePlus, Info, Minus, Plus, Search, Star, X } from 'lucide-react';
import { Select as FluidSelect, SelectContent as FluidSelectContent, SelectItem as FluidSelectItem, SelectTrigger as FluidSelectTrigger } from '@/components/ui/select';
import { Tooltip as FluidTooltip } from '@/components/ui/tooltip';
import { AnimatedNumber } from './AnimatedNumber';
import type { AspectPreset, NativeSupport, Output, Profile, SavedSize } from './types';
import { MEGAPIXEL, presetRatio, type SideLimits } from './sizing';
import { LinkedSizeFields, MegapixelField, SavedSizeRow, SizePreview, SizeTabs, sizeMenuModel, type MegapixelControl, type SizeRow, type SizeTier } from './SizeMenu';
import { usePresence } from './usePresence';
import { AnimatePresence, motion } from 'framer-motion';
import { aspectIconStyle, cn, titleFromPrompt } from './format';
import { wheelPixels } from './wheel';
import { formatDownload, modelFits, useHardware } from './hardware';

/** How much room a composer control gets: full label, icon-only, or bare essentials. */
export type ControlDensity = "full" | "compact" | "mini";
const VideoViewer = lazy(() => import('./VideoViewer'));

export function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  useLanguage();
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function MediaComponent({ item, muted = false }: { item: Output & { thumbnailUrl?: string }; muted?: boolean }) {
  useLanguage();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [useFullImage, setUseFullImage] = useState(false);
  const rafRef = useRef(0);
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    setUseFullImage(false);
  }, [item.url, item.thumbnailUrl]);
  // Reveal on the next frame so the blurred/faded start state always paints
  // once before the "unblur" transition runs — even for cache-hot images.
  const reveal = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => setLoaded(true));
    });
  };
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);
  const isThumbnail = muted && Boolean(item.thumbnailUrl) && !useFullImage;
  const source = mediaUrl(isThumbnail ? item.thumbnailUrl : item.url, item as { id?: string; createdAt?: string });
  if (!source || failed) return <div className="media-fallback"><span>{titleFromPrompt(item.prompt || item.filename) || t("Output unavailable")}</span></div>;
  if (item.type === "video") {
    return muted ? <VideoPreview key={source} source={source} /> : (
      <Suspense fallback={<div className="video-viewer-loading" role="status">{t("Loading video…")}</div>}>
        <VideoViewer key={item.url} item={item} />
      </Suspense>
    );
  }
  return (
    <img
      className={cn(!loaded && "media-loading")}
      src={source}
      alt={item.filename}
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={reveal}
      onError={() => isThumbnail ? setUseFullImage(true) : setFailed(true)}
      onDragStart={(event) => event.preventDefault()}
    />
  );
}

export const Media = memo(MediaComponent, (previous, next) => previous.item === next.item && previous.muted === next.muted);

export function Skeleton({ className = "" }: { className?: string }) {
  useLanguage();
  return <span className={cn("skeleton", className)} aria-hidden="true" />;
}

export function GallerySkeleton({ columns }: { columns: number }) {
  const ratios = [1.32, 0.76, 1, 1.48, 0.66, 1.18, 0.9, 1.6, 0.72, 1.08, 1.34, 0.82];
  const items = ratios.map((ratio, index) => ({ id: index, width: Math.round(ratio * 100), height: 100 }));
  const skeletonColumns = Array.from({ length: Math.max(1, columns) }, () => [] as typeof items);
  items.forEach((item, index) => skeletonColumns[index % skeletonColumns.length].push(item));
  return skeletonColumns.map((column, columnIndex) => (
    <div className="gallery-column" key={`skeleton-column-${columnIndex}`}>
      {column.map((item) => (
        <div key={item.id} className="tile skeleton-tile" style={{ "--tile-ratio": `${item.width || 1} / ${item.height || 1}`, animationDelay: `${item.id * 40}ms` } as React.CSSProperties}>
          <Skeleton className="skeleton-media" />
        </div>
      ))}
    </div>
  ));
}

export function StudioSelect({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: Array<string | { label: string; value: string }>; label?: string }) {
  useLanguage();
  const normalized = options.map((option) => typeof option === "string" ? { label: option, value: option } : option);
  return (
    <FluidSelect value={value} onValueChange={onChange}>
      <FluidSelectTrigger className="fluid-select-trigger" placeholder={t("Select")} aria-label={label} />
      <FluidSelectContent className="fluid-select-content">
        {normalized.map((item, index) => (
          <FluidSelectItem key={item.value} index={index} value={item.value}>
            {item.label}
          </FluidSelectItem>
        ))}
      </FluidSelectContent>
    </FluidSelect>
  );
}

export function Tip({ content, side = "bottom", forceOpen, children }: { content: React.ReactNode; side?: "top" | "right" | "bottom" | "left"; /** false keeps it shut, e.g. while a tooltip inside it speaks instead. */ forceOpen?: boolean; children: React.ReactElement }) {
  useLanguage();
  return (
    <FluidTooltip content={content} side={side} sideOffset={10} forceOpen={forceOpen} className="heiss-tooltip bg-transparent text-foreground px-2.5 py-1.5 rounded-[12px]">
      {children}
    </FluidTooltip>
  );
}

/**
 * Marks something that works but isn't finished: rough edges, and it may
 * still change. Sits after a label, inside the same line.
 */
export function BetaTag({ className }: { className?: string }) {
  useLanguage();
  // The hidden comma keeps a screen reader from reading "VideoBeta" as one word.
  return <span className={cn("beta-tag", className)}><span className="sr-only">, </span>{t("Beta")}</span>;
}

/** Small "i" affordance for the one explanation a control genuinely needs. */
export function InfoTip({ content, side = "top" }: { content: React.ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  useLanguage();
  return (
    <Tip content={content} side={side}>
      <button type="button" className="info-tip" aria-label={t("More information")}>
        <Info size={12} strokeWidth={2.6} />
      </button>
    </Tip>
  );
}

export function NumberPicker({
  label,
  value,
  onChange,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  precision,
  size = "md",
  fill = false,
  density = "full",
  icon
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  size?: "sm" | "md";
  fill?: boolean;
  /** full = text label + steppers, compact = icon + steppers, mini = icon + value only. */
  density?: ControlDensity;
  icon?: React.ReactNode;
}) {
  useLanguage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const valueRef = useRef(value);
  const holdRef = useRef<{ timer: number | null; interval: number | null }>({ timer: null, interval: null });

  const decimals = precision ?? (Number.isInteger(step) ? 0 : Math.min(4, (String(step).split(".")[1] || "").length));
  const formatValue = (n: number) => decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));

  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { if (!editing) setDraft(formatValue(value)); }, [value, editing, decimals]);

  const clamp = (n: number) => {
    const bounded = Math.max(min, Math.min(max, n));
    if (decimals === 0) return Math.round(bounded);
    const factor = Math.pow(10, decimals);
    return Math.round(bounded * factor) / factor;
  };
  const stepBy = (direction: number) => {
    const next = clamp(valueRef.current + direction * step);
    if (next !== valueRef.current) onChange(next);
  };

  const clearHold = () => {
    if (holdRef.current.timer) window.clearTimeout(holdRef.current.timer);
    if (holdRef.current.interval) window.clearInterval(holdRef.current.interval);
    holdRef.current = { timer: null, interval: null };
  };

  const startHold = (direction: number) => {
    stepBy(direction);
    holdRef.current.timer = window.setTimeout(() => {
      holdRef.current.interval = window.setInterval(() => stepBy(direction), 55);
    }, 320);
  };

  useEffect(() => () => clearHold(), []);

  // Native and non-passive: React's onWheel can't preventDefault. The wheel
  // only steps while the picker has focus, so scrolling a panel past it
  // scrolls the panel instead of silently changing the value.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stepByRef = useRef(stepBy);
  stepByRef.current = stepBy;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let accumulated = 0;
    const onWheel = (event: WheelEvent) => {
      if (!root.contains(document.activeElement)) { accumulated = 0; return; }
      const { y } = wheelPixels(event, root.clientHeight);
      if (y === 0) return;
      event.preventDefault();
      if (Math.sign(y) !== Math.sign(accumulated)) accumulated = 0;
      accumulated += y;
      while (Math.abs(accumulated) >= 100) {
        stepByRef.current(accumulated < 0 ? 1 : -1);
        accumulated -= Math.sign(accumulated) * 100;
      }
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, []);

  const beginEdit = () => {
    setDraft(formatValue(value));
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const commitEdit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) onChange(clamp(parsed));
    setEditing(false);
  };

  const labelLower = label.toLowerCase();
  const showSteppers = density !== "mini";
  return (
    <div
      ref={rootRef}
      className={cn("number-picker", size === "sm" && "is-sm", fill && "is-fill", density !== "full" && `is-density-${density}`)}
    >
      {density === "full" || !icon ? (
        <span className="number-picker-label">{label}</span>
      ) : (
        <Tip content={label}><span className="number-picker-icon" aria-hidden="true">{icon}</span></Tip>
      )}
      {showSteppers ? <Tip content={t("Decrease {0}", { "0": (labelLower) })}><button
        type="button"
        className="number-picker-btn"
        aria-label={t("Decrease {0}", { "0": (labelLower) })}
        disabled={value <= min}
        onPointerDown={(event) => { event.preventDefault(); startHold(-1); }}
        // Enter or Space from the keyboard: a click with no pointer behind it (detail 0).
        onClick={(event) => { if (event.detail === 0) stepBy(-1); }}
        onPointerUp={clearHold}
        onPointerLeave={clearHold}
        onPointerCancel={clearHold}
      ><Minus size={12} /></button></Tip> : null}
      {editing ? (
        <input
          ref={inputRef}
          className="number-picker-input"
          type="number"
          min={min}
          max={Number.isFinite(max) ? max : undefined}
          step={step}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitEdit}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); commitEdit(); }
            else if (event.key === "Escape") { setDraft(formatValue(value)); setEditing(false); }
            else if (event.key === "ArrowUp") { event.preventDefault(); stepBy(1); }
            else if (event.key === "ArrowDown") { event.preventDefault(); stepBy(-1); }
          }}
        />
      ) : density === "full" ? (
        <button type="button" className="number-picker-value" onClick={beginEdit} aria-label={t("{0}: {1}, click to edit", { "0": (label), "1": (formatValue(value)) })}><AnimatedNumber value={formatValue(value)} /></button>
      ) : (
        <Tip content={t("{0}: {1} - click to edit", { "0": (label), "1": (formatValue(value)) })}><button type="button" className="number-picker-value" onClick={beginEdit} aria-label={t("{0}: {1}, click to edit", { "0": (label), "1": (formatValue(value)) })}><AnimatedNumber value={formatValue(value)} /></button></Tip>
      )}
      {showSteppers ? <Tip content={t("Increase {0}", { "0": (labelLower) })}><button
        type="button"
        className="number-picker-btn"
        aria-label={t("Increase {0}", { "0": (labelLower) })}
        disabled={value >= max}
        onPointerDown={(event) => { event.preventDefault(); startHold(1); }}
        // Enter or Space from the keyboard: a click with no pointer behind it (detail 0).
        onClick={(event) => { if (event.detail === 0) stepBy(1); }}
        onPointerUp={clearHold}
        onPointerLeave={clearHold}
        onPointerCancel={clearHold}
      ><Plus size={12} /></button></Tip> : null}
    </div>
  );
}

/** The trigger's shape: a ratio fitted to an 18 × 14 box, never thinner than 5px a side. */
function triggerShapeStyle(width: number, height: number): React.CSSProperties {
  const scale = Math.min(18 / Math.max(1, width), 14 / Math.max(1, height));
  return { width: Math.max(5, Math.round(width * scale)), height: Math.max(5, Math.round(height * scale)) };
}

/**
 * The size menu. A live frame on the left shows the shape and size a picture
 * will come out at (the row under the pointer while one is); beside it,
 * Default · 2K · Custom, Custom's linked width and height, and the shapes.
 *
 * Default and 2K use the model's preset shapes, 2K drawn with the long side
 * at 2048. Custom is any width and height; a shape row there keeps the area
 * and changes the shape. The trigger draws the real shape and says the ratio,
 * with a tag for 2K ("2K") and Custom ("C").
 */
export function AspectPicker({ value, options, onChange, currentSize, defaultSize, density = "full", tier = "none", tiers = ["none", "custom"], native, sizeMax = 8192, limits, onTierChange, onCustomRatio, onCustomSize, savedSizes = [], onSaveSize, onRenameSize, onRemoveSize, onPickSaved, targetArea = 0, megapixel = null }: {
  value: string;
  options: AspectPreset[];
  onChange: (value: string) => void;
  currentSize: string;
  defaultSize: string;
  density?: ControlDensity;
  tier?: SizeTier;
  /** Which tabs this mode offers: 2K is for images only. */
  tiers?: SizeTier[];
  native?: NativeSupport;
  sizeMax?: number;
  limits?: { width: SideLimits; height: SideLimits };
  onTierChange?: (tier: SizeTier) => void;
  onCustomRatio?: (ratio: number) => void;
  onCustomSize?: (size: { width: number; height: number }) => void;
  /** Custom sizes kept with "Save size", listed under the shapes on every tab. */
  savedSizes?: SavedSize[];
  onSaveSize?: () => void;
  onRenameSize?: (id: string, name: string) => void;
  onRemoveSize?: (id: string) => void;
  onPickSaved?: (saved: SavedSize) => void;
  /** Megapixels in 2K's place (Settings › Generation): Default draws every shape at this area. */
  targetArea?: number;
  megapixel?: MegapixelControl | null;
}) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const presence = usePresence(open);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(pickerRef, open, close);
  const [hovered, setHovered] = useState<SizeRow | null>(null);
  // The preview window opens the first time the menu is hovered or worked from the keyboard,
  // then stays like the menu itself: it goes when the menu closes (picking a size closes it).
  const [peek, setPeek] = useState(false);
  useEffect(() => { if (!open) { setHovered(null); setPeek(false); } }, [open]);

  const { custom, picked, shown, rows, savedMatch, ownSize, isActive, savedRow, label, badge, what, captionFor, note } = sizeMenuModel({ value, options, currentSize, defaultSize, tier, native, sizeMax, limits, savedSizes, targetArea, offerTwoK: tiers.includes("2k") });
  const previewRow = hovered;
  const previewSize = previewRow ? previewRow.size : shown;
  const previewLabel = captionFor(previewRow);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // While the menu is open the trigger keeps the width it opened at: its label changes as you
  // type a size ("1:1" → "1.6:1"), and a wider button would shift the bar, and the menu with it.
  const [heldWidth, setHeldWidth] = useState<number | null>(null);
  React.useLayoutEffect(() => {
    // The exact width, rounded up: offsetWidth rounds down, and a label a fraction too wide would show "…".
    if (open) setHeldWidth((held) => held ?? (triggerRef.current ? Math.ceil(triggerRef.current.getBoundingClientRect().width) : null));
    else if (!presence.mounted) setHeldWidth(null);
  }, [open, presence.mounted, heldWidth]);
  // What the button shows is held too while the menu is open: a tag coming or going (2K, MP, C)
  // or a new ratio would change its width and move the menu under the pointer. It catches up
  // once the menu has closed.
  const [heldFace, setHeldFace] = useState<{ label: string; badge: string; width: number; height: number } | null>(null);
  React.useLayoutEffect(() => {
    if (open) setHeldFace((held) => held ?? { label, badge, width: shown.width, height: shown.height });
    else if (!presence.mounted) setHeldFace(null);
  }, [open, presence.mounted, label, badge, shown.width, shown.height]);
  const face = heldFace || { label, badge, width: shown.width, height: shown.height };
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) {
      const current = document.activeElement;
      if (!current || current === document.body || pickerRef.current?.contains(current)) triggerRef.current?.focus({ preventScroll: true });
    }
    // Opening puts focus on the chosen shape, so the arrow keys work at once.
    if (open && !wasOpen.current) requestAnimationFrame(() => (listRef.current?.querySelector<HTMLButtonElement>("button.aspect-option.active") || listRef.current?.querySelector<HTMLButtonElement>("button.aspect-option"))?.focus({ preventScroll: true }));
    wasOpen.current = open;
  }, [open]);

  const pick = (row: SizeRow) => {
    if (custom && onCustomRatio) { onCustomRatio(presetRatio(row.shape)); return; }
    onChange(row.value);
    setOpen(false);
  };

  return (
    <div className={cn("aspect-picker", density !== "full" && `is-density-${density}`)} ref={pickerRef} data-open-surface={open || undefined}>
      <Tip content={density === "full" ? t("Size: {0}", { "0": (what) }) : t("Size: {0}", { "0": (what) })}><button ref={triggerRef} type="button" data-open-trigger className={cn("aspect-trigger", heldWidth !== null && "is-held")} style={heldWidth ? { width: heldWidth } : undefined} aria-label={t("Size: {0}", { "0": (what) })} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((next) => !next)}>
          {/* The shape drawn to fit an 18 × 14 box, so every ratio sits in the same slot. */}
          <span className="aspect-shape-slot">
            <span className="aspect-shape" style={triggerShapeStyle(face.width, face.height)} />
            {face.badge && density !== "full" ? <b className="aspect-tag is-corner" aria-hidden="true">{face.badge}</b> : null}
          </span>
          {density === "full" ? <span className="aspect-trigger-label">{face.label}</span> : null}
          {/* 2K or Custom: a small tag after the ratio; with no label to follow (narrow bars), on the shape's corner. */}
          {face.badge && density === "full" ? <b className="aspect-tag" aria-hidden="true">{face.badge}</b> : null}
          {density === "mini" ? null : <ChevronDown size={14} className={cn(open && "flip")} />}
        </button></Tip>
      {presence.mounted ? (
        <div
          className={cn("aspect-menu size-menu", presence.closing && "is-closing")}
          data-open-surface
          role="dialog"
          aria-label={t("Size")}
          onPointerEnter={(event) => { if (event.pointerType !== "touch") setPeek(true); }}
          onFocusCapture={(event) => { if ((event.target as HTMLElement).matches(":focus-visible, input")) setPeek(true); }}
        >
          <SizePreview size={previewSize} label={previewLabel} sub={`${previewSize.width} × ${previewSize.height}`} accent={!previewRow && (tier !== "none" || targetArea > 0)} shown={peek} />
          <div className="size-menu-side">
            <div className="aspect-upscale">
              <div className="aspect-upscale-head">
                <span>{t("Resolution")}</span>
              </div>
              {onTierChange ? <SizeTabs tiers={tiers} value={tier} onChange={onTierChange} /> : null}
              {/* Its space above is its own padding, so it folds with it and closing ends without a jump. */}
              <AnimatePresence initial={false}>
                {custom && limits && onCustomSize ? (
                  <motion.div key="custom" className="size-custom" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}>
                    <LinkedSizeFields size={picked} limits={limits} onChange={onCustomSize} onSave={ownSize || savedMatch ? onSaveSize : undefined} saved={Boolean(savedMatch)} />
                  </motion.div>
                ) : null}
              </AnimatePresence>
              {note ? <p className="size-menu-note">{note}</p> : null}
            </div>
            <div ref={listRef} className="aspect-list" role="listbox" aria-label={custom ? t("Shape, at this size") : t("Shape")} onPointerLeave={() => setHovered(null)} onKeyDown={(event) => {
              // Up and down move between shapes, previewing each on the way.
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button.aspect-option"));
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
            }}>
              {rows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  className={cn("aspect-option", isActive(row) && "active")}
                  role="option"
                  aria-selected={isActive(row)}
                  onPointerEnter={(event) => { if (event.pointerType !== "touch") setHovered(row); }}
                  onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) setHovered(row); }}
                  // Only its own preview: pressing another row moves focus there, and the row that
                  // had it (the chosen one, focused on open) mustn't snap the frame back mid-press.
                  onBlur={() => setHovered((current) => current?.key === row.key ? null : current)}
                  onClick={() => pick(row)}
                >
                  <span className="aspect-shape" style={aspectIconStyle(row.shape)} />
                  <span>{row.label}{row.small ? <small>{row.small}</small> : null}</span>
                  <em>{row.size.width}×{row.size.height}</em>
                </button>
              ))}
              <AnimatePresence initial={false}>
                {onPickSaved ? savedSizes.map((item) => (
                  <SavedSizeRow
                    key={item.id}
                    saved={item}
                    active={savedMatch?.id === item.id}
                    // From Default or 2K it switches to Custom and closes, like any pick there; in Custom it stays open.
                    onPick={() => { onPickSaved(item); if (!custom) setOpen(false); }}
                    onRename={(name) => onRenameSize?.(item.id, name)}
                    onRemove={() => { setHovered(null); onRemoveSize?.(item.id); }}
                    onPreview={(on) => setHovered((current) => on ? savedRow(item) : current?.key === savedRow(item).key ? null : current)}
                  />
                )) : null}
              </AnimatePresence>
            </div>
            {/* Under every shape: how big they're all drawn. */}
            {megapixel ? <MegapixelField current={(shown.width * shown.height) / MEGAPIXEL} control={megapixel} custom={custom} /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function familyLabel(profile: Profile | null) {
  if (!profile) return "";
  if (profile.familyName) return profile.familyName;
  if (profile.family === "z-image") return "Z image";
  if (profile.family === "checkpoint") return "Checkpoint";
  if (profile.family === "wan") return "Wan video";
  if (profile.family === "custom") return "Workflow";
  return profile.family;
}

/** What an unready model still lacks, in the words the gallery badges use; "" when it can run. */
export function setupNote(profile: Profile | null) {
  const missing = profile?.missing || [];
  if (!missing.length) return "";
  if (missing.some((item) => item.part === "comfy" && !item.nodePack)) return "Needs a newer ComfyUI";
  if (missing.some((item) => item.nodePack)) return "Needs ComfyUI nodes";
  return `Needs ${missing.length} file${missing.length === 1 ? "" : "s"}`;
}

/** Favorites and recents for the model menu, and how to change them. */
export type ModelMenuState = {
  favorites: string[];
  /** Profile ids, most recently used first. */
  recents: string[];
  toggleFavorite: (id: string) => void;
};

const menuSearchFrom = 9;
const menuRecentLimit = 4;

function profileText(profile: Profile) {
  return `${profile.displayName || ""} ${profile.label || ""} ${profile.description || ""} ${familyLabel(profile)}`.toLowerCase();
}

/** The model file's size, quietly, and whether it fits the memory ComfyUI has (never a warning). */
function sizeNote(profile: Profile, hardware: ReturnType<typeof useHardware>) {
  const bytes = Number(profile.weightBytes) || 0;
  return { size: formatDownload(bytes), fits: modelFits(hardware, bytes, profile.model) };
}

/**
 * The model menu. With a handful of models it is a plain list; past that it
 * gets a search field, and it always splits into Favorites (starred), Recent,
 * the rest by family and, last, "Your workflows" (imported graphs), scrolling
 * inside a capped height with "Find models" pinned below. With no model at
 * all it offers "Get a model" instead. Arrow keys move, Enter picks, typing
 * searches.
 */
/**
 * What a model can do with a picture, as two small plain icons before its
 * family badge: edits from reference images, and inpainting (paint over part
 * of a reference to change only that).
 */
function ModelAbilities({ profile, showInpaint = true, onHover }: { profile: Profile; showInpaint?: boolean; onHover?: (hovering: boolean) => void }) {
  useLanguage();
  // An edit model takes references without a start-image strength; img2img models have one.
  const edits = Boolean(profile.mediaInputs?.length && !profile.capabilities.denoise);
  const inpaints = showInpaint && Boolean(profile.capabilities.inpaint);
  if (!edits && !inpaints) return null;
  return (
    // While one of these speaks, the row's own name tooltip stays shut.
    <span className="model-abilities" onPointerEnter={() => onHover?.(true)} onPointerLeave={() => onHover?.(false)}>
      {edits ? <Tip content={t("Edits from reference images")} side="top"><span className="model-ability" aria-label={t("Edits from reference images")}><ImagePlus size={13} strokeWidth={1.75} /></span></Tip> : null}
      {inpaints ? <Tip content={t("Inpainting: paint over part of an image to change only that")} side="top"><span className="model-ability" aria-label={t("Inpainting")}><Brush size={13} strokeWidth={1.75} /></span></Tip> : null}
    </span>
  );
}

export function ModelPicker({ value, profiles, showInpaint = true, onChange, compact = false, badges = {}, density = "full", emptyHint = "", onFindModels, onGetModels, strayCount = 0, menu }: { value: string; profiles: Profile[]; showInpaint?: boolean; onChange: (value: string) => void; compact?: boolean; badges?: Record<string, string>; density?: ControlDensity; emptyHint?: string; onFindModels?: () => void; onGetModels?: () => void; strayCount?: number; menu?: ModelMenuState }) {
  useLanguage();
  const hardware = useHardware();
  const [abilityRow, setAbilityRow] = React.useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(-1);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const selected = profiles.find((profile) => profile.id === value) || profiles[0] || null;
  // The search clears once the menu has finished closing, so its list doesn't jump on the way out.
  const close = useCallback(() => setOpen(false), []);
  const presence = usePresence(open);
  useEffect(() => { if (!presence.mounted) { setQuery(""); setCursor(-1); } }, [presence.mounted]);
  useDismiss(pickerRef, open, close);
  const searchable = profiles.length >= menuSearchFrom;
  const menuId = React.useId();

  const sections = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle) {
      const words = needle.split(/\s+/);
      return [{ id: "results", label: "", rows: profiles.filter((profile) => words.every((word) => profileText(profile).includes(word))) }];
    }
    if (!menu) return [{ id: "all", label: "", rows: profiles }];
    const favorites = new Set(menu.favorites);
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));
    const starred = profiles.filter((profile) => favorites.has(profile.id));
    const recent = menu.recents.filter((id) => !favorites.has(id)).map((id) => byId.get(id)).filter((profile): profile is Profile => Boolean(profile)).slice(0, menuRecentLimit);
    const shown = new Set([...starred, ...recent].map((profile) => profile.id));
    // The rest by family, so seven Sana variants sit together instead of scattering.
    const rest = profiles.filter((profile) => !shown.has(profile.id)).sort((a, b) =>
      familyLabel(a).localeCompare(familyLabel(b)) || (a.displayName || a.label).localeCompare(b.displayName || b.label));
    // Imported graphs are workflows, not models: they get their own group at the end.
    const models = rest.filter((profile) => !profile.id.startsWith("custom:"));
    const workflows = rest.filter((profile) => profile.id.startsWith("custom:"));
    return [
      { id: "favorites", label: t("Favorites"), rows: starred },
      { id: "recent", label: t("Recent"), rows: recent },
      { id: "all", label: starred.length || recent.length ? "All models" : "", rows: models },
      { id: "workflows", label: t("Your workflows"), rows: workflows }
    ].filter((section) => section.rows.length);
  }, [menu, profiles, query]);
  const flat = React.useMemo(() => sections.flatMap((section) => section.rows), [sections]);

  // Opening scrolls the current model into view; a search starts on its first hit.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      // Without a search field, focus the list itself so the arrow keys work.
      (searchRef.current || listRef.current)?.focus({ preventScroll: true });
      listRef.current?.querySelector<HTMLElement>(".model-option.active")?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  // Closing hands focus back to the trigger, unless it already went somewhere else.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) {
      const current = document.activeElement;
      if (!current || current === document.body || pickerRef.current?.contains(current)) triggerRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);
  useEffect(() => { setCursor(query ? 0 : -1); }, [query]);
  useEffect(() => {
    if (cursor < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const pick = (id: string) => { onChange(id); close(); };
  const onMenuKey = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!flat.length) return;
      const from = cursor < 0 ? Math.max(0, flat.findIndex((profile) => profile.id === value)) - (event.key === "ArrowDown" ? 1 : 0) : cursor;
      setCursor((from + (event.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length);
    } else if (event.key === "Enter" && cursor >= 0 && flat[cursor]) {
      event.preventDefault();
      pick(flat[cursor].id);
    } else if (searchable && event.key.length === 1 && !event.metaKey && !event.ctrlKey && document.activeElement !== searchRef.current) {
      // Typing anywhere in the menu goes to the search field.
      searchRef.current?.focus();
    }
  };

  const favorites = new Set(menu?.favorites || []);
  let rowIndex = -1;
  return (
    <div className={cn("model-picker", compact && "is-compact", density !== "full" && `is-density-${density}`)} ref={pickerRef} data-open-surface={open || undefined}>
      <Tip content={selected ? t("{0}{1} · choose a model", { "0": (selected.displayName || selected.label), "1": (setupNote(selected) ? ` · ${setupNote(selected)}` : t("")) }) : t("Choose a model")}><button ref={triggerRef} type="button" data-open-trigger className={cn("model-trigger", setupNote(selected) && "needs-setup")} aria-haspopup="listbox" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
          {setupNote(selected) ? <span className="model-setup-flag" aria-label={setupNote(selected)} /> : null}
          {compact ? (
            <span className="model-copy"><strong>{selected?.displayName || selected?.label || t("No model")}</strong></span>
          ) : (
            <span className="model-copy">
              <strong>{selected?.displayName || selected?.label || t("No model")}</strong>
              <em>{selected ? familyLabel(selected) : t("No model yet")}</em>
            </span>
          )}
          <ChevronDown size={14} className={cn(open && "flip")} />
        </button></Tip>
      {presence.mounted ? (
        <div className={cn("model-menu", searchable && "has-search", presence.closing && "is-closing")} data-open-surface onKeyDown={onMenuKey}>
          {profiles.length ? null : (
            <div className="model-menu-empty">
              <strong>{t("No models yet")}</strong>
              <span>{emptyHint || t("No usable models in ComfyUI yet.")}</span>
              {onGetModels && !strayCount ? <button type="button" className="btn is-primary model-menu-find-cta" onClick={() => { close(); onGetModels(); }}>{t("Get a model")}</button>
                : onFindModels ? <button type="button" className="btn is-primary model-menu-find-cta" onClick={() => { close(); onFindModels(); }}>{strayCount ? t("Add {0} model{1}", { "0": (strayCount), "1": (strayCount === 1 ? t("") : t("s")) }) : t("Find models")}</button> : null}
            </div>
          )}
          {searchable ? (
            <label className="model-menu-search">
              <Search size={14} aria-hidden="true" />
              <input ref={searchRef} className="is-framed" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search {0} models", { "0": (profiles.length) })} aria-label={t("Search models")} aria-activedescendant={cursor >= 0 ? `${menuId}-row-${cursor}` : undefined} spellCheck={false} autoComplete="off" />
              {query ? <button type="button" className="model-menu-clear" aria-label={t("Clear search")} onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X size={12} /></button> : null}
            </label>
          ) : null}
          {profiles.length ? (
            <div className="model-menu-list" ref={listRef} role="listbox" aria-label={t("Models")} tabIndex={-1} aria-activedescendant={cursor >= 0 ? `${menuId}-row-${cursor}` : undefined}>
              {sections.map((section) => (
                <div key={section.id} className="model-menu-section" role="group" aria-label={section.label || undefined}>
                  {section.label ? <div className="model-menu-label">{section.label}</div> : null}
                  {section.rows.map((profile) => {
                    rowIndex += 1;
                    const starred = favorites.has(profile.id);
                    // Without a menu (favorites and recents as sections), its Favorite / Recent / Workflow word stays as a pill.
                    const badge = menu ? "" : badges[profile.id] || "";
                    const { size, fits } = sizeNote(profile, hardware);
                    return (
                      <div key={`${section.id}:${profile.id}`} className={cn("model-row", starred && "is-starred")}>
                        <Tip content={`${profile.displayName || profile.label}${fits ? " · fits this computer" : ""}`} forceOpen={abilityRow === `${section.id}:${profile.id}` ? false : undefined}><button
                            type="button"
                            role="option"
                            aria-selected={profile.id === value}
                            data-row={rowIndex}
                            id={`${menuId}-row-${rowIndex}`}
                            className={cn("model-option", profile.id === value && "active", rowIndex === cursor && "is-cursor")}
                            onClick={() => pick(profile.id)}
                          >
                            <span className="model-copy">
                              <strong>{profile.displayName || profile.label}</strong>
                              {setupNote(profile) ? <em className="is-setup">{setupNote(profile)}</em> : (
                                // The family once, under the name, instead of a pill beside a line that said it too.
                                <em>{profile.description || familyLabel(profile)}{size ? <span className="model-size"> · {size}</span> : null}</em>
                              )}
                            </span>
                            <span className="model-tags"><ModelAbilities profile={profile} showInpaint={showInpaint} onHover={(hovering) => setAbilityRow(hovering ? `${section.id}:${profile.id}` : "")} />{badge ? <span className="model-badge">{badge}</span> : null}</span>
                          </button></Tip>
                        {menu ? (
                          <button type="button" className="model-star" aria-pressed={starred} aria-label={starred ? t("Remove {0} from favorites", { "0": (profile.displayName || profile.label) }) : t("Add {0} to favorites", { "0": (profile.displayName || profile.label) })} onClick={() => menu.toggleFavorite(profile.id)}>
                            <Star size={13} fill={starred ? "currentColor" : "none"} />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
              {query && !flat.length ? <div className="model-menu-none">{t("Nothing matches “")}{query.trim()}”.</div> : null}
            </div>
          ) : null}
          {onFindModels && profiles.length ? (
            // Always one tap from where people notice a model is missing.
            <button type="button" className={cn("model-menu-find", strayCount > 0 && "has-found")} onClick={() => { close(); onFindModels(); }}>
              <span>{strayCount ? t("{0} model{1} found", { "0": (strayCount), "1": (strayCount === 1 ? t("") : t("s")) }) : t("Find more models")}</span>
              <em>{strayCount ? t("Add") : t("Search")}</em>
            </button>
          ) : null}

        </div>
      ) : null}
    </div>
  );
}

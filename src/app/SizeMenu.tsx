import { t } from '../i18n/core.js';
import { useLanguage } from '../i18n/react';
import React from 'react';
import { Check, Link2, Pencil, Trash2, Unlink2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { aspectIconStyle, cn } from './format';
import { Tip } from './components';
import { fitRatio, formatMp, MEGAPIXEL, megapixels, parseSize, presetRatio, ratioName, sameRatio, snapSide, type SideLimits, type Size } from './sizing';
import { sizePlan } from './useUpscale';
import type { AspectPreset, NativeSupport, SavedSize } from './types';

/* ---------------------------------------------------------------------------
   The size menu's parts (components.tsx AspectPicker puts them together):

   - SizePreview: a window of its own beside the menu, there from the first
     hover until the menu closes, with the frame the picture will fill gliding between shapes:
     the size chosen, or the row under the pointer while one is.
   - SizeTabs: Default · 2K · Custom, one sliding thumb.
   - LinkedSizeFields: Custom's width and height. Linked they read as one
     field and keep the shape; the link in the middle splits them. Each takes
     typing, arrow keys, or a drag on its W/H label, like a design tool.
--------------------------------------------------------------------------- */

export type SizeTier = "none" | "2k" | "custom";

export type SizeRow = { key: string; value: string; label: string; small?: string; shape: AspectPreset; size: Size };

/**
 * What the size menu shows, worked out once for the desktop menu and the
 * phone's size sheet: the rows and the size each makes on this tab, which
 * one is chosen, and how the choice reads (label, tag, caption, note).
 *
 * Default and 2K use the model's preset shapes, 2K drawn with the long side
 * at 2048. Custom is any width and height; a shape row there keeps the area
 * and changes the shape.
 */
export function sizeMenuModel({ value, options, currentSize, defaultSize, tier, native: modelNative, sizeMax = 8192, limits, savedSizes = [], targetArea = 0, offerTwoK = true }: {
  value: string;
  options: AspectPreset[];
  currentSize: string;
  defaultSize: string;
  tier: SizeTier;
  native?: NativeSupport;
  sizeMax?: number;
  limits?: { width: SideLimits; height: SideLimits };
  savedSizes?: SavedSize[];
  /** Megapixels in 2K's place: Default draws each shape at this many pixels (0: as the model has it). */
  targetArea?: number;
  /** 2K is a tab here (not with Megapixels, nor for video): its sizes are already a click away. */
  offerTwoK?: boolean;
}) {
  const custom = tier === "custom";
  // No model picked (ComfyUI off, or none listed): sizes still work, but there is no model to warn about.
  const native = modelNative || {};
  const picked = parseSize(currentSize);
  const plan = sizePlan(tier === "2k" ? "2k" : "none", picked.width, picked.height, native, sizeMax, custom ? 0 : targetArea, limits?.width.step);
  const shown = custom ? picked : plan.final;
  const selected = options.find((item) => item.value === value);
  const isDefault = value === "default";
  // The ratio the default size already is: one row ("Default 1:1"), not two with the same size.
  const defaultOption = options.find((item) => item.value === defaultSize);
  const listed = defaultOption ? options.filter((item) => item !== defaultOption) : options;
  const defaultShape = parseSize(defaultSize);
  const area = picked.width * picked.height;
  // What each row makes on this tab: the preset, the preset at 2K, or its shape at Custom's area.
  const rowSize = (shape: AspectPreset) => custom && limits
    ? fitRatio(presetRatio(shape), area, limits.width, limits.height, 16)
    : tier === "2k" ? sizePlan("2k", shape.w, shape.h, native, sizeMax).final
    : targetArea > 0 ? sizePlan("none", shape.w, shape.h, native, sizeMax, targetArea, limits?.width.step).final : { width: shape.w, height: shape.h };
  const defaultPreset: AspectPreset = defaultOption || { label: ratioName(defaultShape.width, defaultShape.height), value: defaultSize, w: defaultShape.width, h: defaultShape.height };
  const rows: SizeRow[] = [
    { key: "default", value: "default", label: t("Default"), small: defaultPreset.label, shape: defaultPreset, size: rowSize(defaultPreset) },
    ...listed.map((option) => ({ key: option.value, value: option.value, label: option.label, shape: option, size: rowSize(option) }))
  ];
  // In Custom a saved size that is exactly this one is the pick, rather than the shape it shares.
  const savedMatch = custom ? savedSizes.find((item) => item.width === picked.width && item.height === picked.height) : undefined;
  const isActive = (row: SizeRow) => custom ? !savedMatch && sameRatio(row.size, shown) : row.value === value;
  // "Save size" is for a size of your own: any shape at any size, except one Default or 2K already
  // gives (a preset row at either tier, within a snap step a side), which is a click away as it is.
  const offered = custom ? rows.flatMap((row) => [{ width: row.shape.w, height: row.shape.h }, ...(offerTwoK ? [sizePlan("2k", row.shape.w, row.shape.h, native, sizeMax).final] : [])]) : [];
  const near = (a: Size, b: Size) => Math.abs(a.width - b.width) <= 16 && Math.abs(a.height - b.height) <= 16;
  const ownSize = custom && !offered.some((size) => near(size, picked));
  const savedRow = (item: SavedSize): SizeRow => ({ key: item.id, value: "", label: item.name, small: ratioName(item.width, item.height), shape: { label: "", value: "", w: item.width, h: item.height }, size: { width: item.width, height: item.height } });
  const ratio = ratioName(shown.width, shown.height);
  const label = custom ? ratio : selected ? selected.label : isDefault ? t('Default') : ratio;
  // Megapixels: an MP tag, the way 2K says its size. The count is in the menu, its preview and the
  // tip: as a tag it would change width with every step of a drag, under a button held at its width.
  const mpTag = !custom && targetArea > 0 ? "MP" : "";
  const badge = tier === "2k" ? "2K" : custom ? "C" : mpTag;
  const what = `${label}, ${shown.width} × ${shown.height}${tier === "2k" ? ", 2K" : custom ? ", custom size" : mpTag ? `, ${formatMp(targetArea / MEGAPIXEL)} megapixels` : ""}`;
  /** The preview's caption for a row, or for the size chosen: "Name · ratio" where the name isn't the ratio itself. */
  const captionFor = (row: SizeRow | null) => row
    ? (row.small ? `${row.label} · ${row.small}` : row.label)
    : custom ? `${savedMatch ? savedMatch.name : t('Custom')} · ${ratio}` : isDefault ? `${t('Default')} · ${defaultOption?.label || ratio}` : label;
  const note = !modelNative ? ""
    : (tier === "2k" || targetArea > 0) && plan.capped ? `This model goes up to ${plan.maxSide} px a side.`
    : tier === "2k" && plan.untested ? "This model isn’t known for 2K. Some pictures may repeat or warp."
    : targetArea > 0 && plan.untested ? "This model isn’t known for sizes this large. Some pictures may repeat or warp."
    : "";
  return { custom, picked, shown, rows, savedMatch, ownSize, isActive, savedRow, label, badge, what, captionFor, note };
}

const tierLabels: Record<SizeTier, string> = { none: "Default", "2k": "2K", custom: "Custom" };

/**
 * The frame on its own window beside the menu. The window is the stage: the
 * frame sits in it at the shape it stands for, and lines from its edges run
 * across the whole window, so a change of shape reads as the lines sliding.
 * The window's size comes from the menu it sits beside, so it is measured.
 */
export function SizePreview({ size, label, sub, accent = false, shown = true, inset = 26, className }: {
  size: Size;
  label: string;
  sub: string;
  accent?: boolean;
  shown?: boolean;
  /** The frame's margin inside the window: the phone's shorter stage keeps less. */
  inset?: number;
  className?: string;
}) {
  useLanguage();
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = React.useState({ width: 0, height: 0 });
  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setStage({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // Room for the frame: an inset all round, and the caption's line at the bottom.
  const caption = 30;
  const roomW = Math.max(1, stage.width - inset * 2);
  const roomH = Math.max(1, stage.height - inset * 2 - caption);
  const scale = Math.min(roomW / Math.max(1, size.width), roomH / Math.max(1, size.height));
  const width = Math.max(3, size.width * scale);
  const height = Math.max(3, size.height * scale);
  const left = (stage.width - width) / 2;
  const top = inset + (roomH - height) / 2;
  const px = (value: number) => `${Math.round(value * 10) / 10}px`;
  return (
    <div ref={ref} className={cn("size-peek", className, shown && "is-on", accent && "is-accent", stage.width > 0 && "is-measured")} aria-hidden="true">
      {/* Lines from the frame's edges across the window: they glide with it. */}
      <i className="size-guide is-x" style={{ top: px(top) }} />
      <i className="size-guide is-x" style={{ top: px(top + height) }} />
      <i className="size-guide is-y" style={{ left: px(left) }} />
      <i className="size-guide is-y" style={{ left: px(left + width) }} />
      <div className="size-frame" style={{ left: px(left), top: px(top), width: px(width), height: px(height) }} />
      <p className="size-peek-caption"><strong>{label}</strong><span>{sub}</span></p>
    </div>
  );
}

export function SizeTabs({ tiers, value, onChange }: { tiers: SizeTier[]; value: SizeTier; onChange: (tier: SizeTier) => void }) {
  useLanguage();
  const index = Math.max(0, tiers.indexOf(value));
  return (
    <div className="aspect-upscale-tabs" role="radiogroup" aria-label={t("Size")} style={{ "--tab-index": index, "--tab-count": tiers.length } as React.CSSProperties} onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      const next = tiers[(index + (event.key === "ArrowRight" ? 1 : -1) + tiers.length) % tiers.length];
      onChange(next);
      requestAnimationFrame(() => event.currentTarget.querySelector<HTMLButtonElement>(`[data-tier="${next}"]`)?.focus());
    }}>
      <i aria-hidden="true" />
      {tiers.map((tier) => (
        <button
          key={tier}
          type="button"
          role="radio"
          data-tier={tier}
          aria-checked={tier === value}
          tabIndex={tier === value ? 0 : -1}
          className={cn(tier === value && "is-active")}
          onClick={() => onChange(tier)}
        >{t(tierLabels[tier])}</button>
      ))}
    </div>
  );
}

/**
 * A label you drag sideways to change a number (W, H, MP), like a design tool. The drag
 * changes the value and lets go: releasing doesn't put you in the field. A press that
 * doesn't move is a click, which does. The drag ends however the pointer goes (up, cancel,
 * capture lost, unmount), so the scrub cursor can't outlive it.
 */
function useScrub({ onStart, onScrub, input }: {
  onStart: () => void;
  /** Steps from where the drag began, one per 3px (Shift: four times as fast). */
  onScrub: (steps: number) => void;
  input: React.RefObject<HTMLInputElement | null>;
}) {
  const [dragging, setDragging] = React.useState(false);
  const drag = React.useRef<{ x: number; moved: boolean } | null>(null);
  const stopScrub = () => document.documentElement.classList.remove("is-size-scrubbing");
  React.useEffect(() => () => { if (drag.current) stopScrub(); }, []);
  const end = (click: boolean) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setDragging(false);
    stopScrub();
    if (click && !current.moved) input.current?.focus();
  };
  const handlers = {
    onPointerDown: (event: React.PointerEvent<HTMLSpanElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      // A field being typed in settles first, so the drag starts from what it shows.
      if (document.activeElement instanceof HTMLElement && document.activeElement.closest(".size-fields, .size-mp")) document.activeElement.blur();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, moved: false };
      onStart();
    },
    onPointerMove: (event: React.PointerEvent<HTMLSpanElement>) => {
      const current = drag.current;
      if (!current) return;
      // A few pixels of wobble is still a click.
      if (!current.moved) {
        if (Math.abs(event.clientX - current.x) < 3) return;
        current.moved = true;
        setDragging(true);
        document.documentElement.classList.add("is-size-scrubbing");
      }
      onScrub(Math.round((event.clientX - current.x) / 3) * (event.shiftKey ? 4 : 1));
    },
    onPointerUp: () => end(true),
    onPointerCancel: () => end(false),
    onLostPointerCapture: () => end(false)
  };
  return { dragging, handlers };
}

/** One side's field: type, arrow keys, or drag its label sideways. */
function SizeField({ axis, value, limits, onStart, onChange }: {
  axis: "W" | "H";
  value: number;
  limits: SideLimits;
  /** A change begins (focus, a drag): the linked shape is taken from here. */
  onStart: () => void;
  onChange: (value: number) => void;
}) {
  useLanguage();
  const [draft, setDraft] = React.useState(String(value));
  const [editing, setEditing] = React.useState(false);
  React.useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);
  const step = limits.step || 16;
  const snap = (next: number) => snapSide(next, limits, step);
  const commit = () => {
    const typed = Number(draft);
    const next = typed > 0 ? snap(typed) : value;
    if (next !== value) onChange(next);
    setDraft(String(next));
  };

  const input = React.useRef<HTMLInputElement>(null);
  const from = React.useRef(value);
  const { dragging, handlers } = useScrub({
    input,
    onStart: () => { from.current = value; onStart(); },
    onScrub: (steps) => { const next = snap(from.current + steps * step); if (next !== value) onChange(next); }
  });

  const label = axis === "W" ? "Width" : "Height";
  return (
    // Not a <label>: a label's click would focus the field at the end of every drag.
    <div className={cn("size-field", dragging && "is-dragging")} onClick={(event) => { if (event.target === event.currentTarget) input.current?.focus(); }}>
      <Tip content={t("Drag to change the {0}", { "0": (label.toLowerCase()) })}>
        <span className="size-field-key" {...handlers} aria-hidden="true">{axis}</span>
      </Tip>
      <input
        ref={input}
        inputMode="numeric"
        aria-label={t("{0} in pixels", { "0": (label) })}
        value={draft}
        onFocus={(event) => { setEditing(true); onStart(); event.currentTarget.select(); }}
        onBlur={() => { setEditing(false); commit(); }}
        onChange={(event) => {
          const digits = event.target.value.replace(/[^0-9]/g, "").slice(0, 5);
          setDraft(digits);
          // The frame follows the typing; the value settles on its step when you're done.
          const typed = Number(digits);
          if (typed >= (limits.min ?? 64) && typed <= (limits.max ?? 4096)) onChange(snap(typed));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); commit(); event.currentTarget.select(); }
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            onStart();
            const next = snap(value + (event.key === "ArrowUp" ? 1 : -1) * step * (event.shiftKey ? 10 : 1));
            setDraft(String(next));
            if (next !== value) onChange(next);
          }
        }}
      />
    </div>
  );
}

/** Megapixels in the size menu (Settings › Generation): the target, its limit, and how to change or clear it. */
export type MegapixelControl = {
  /** The count Default draws every shape at; null leaves each model at its own size. */
  target: number | null;
  max: number;
  onChange: (value: number) => void;
  onReset: () => void;
};
const MIN_MP = 0.25;

/**
 * The size menu's Megapixels, under the shapes: how big every shape is drawn. Type it, step
 * it with the arrow keys (Shift: whole megapixels) or drag its MP label. In Default it scales
 * every shape; in Custom, the size you have, keeping its shape. Reset hands each model back
 * its own size.
 */
export function MegapixelField({ current, control, custom }: {
  /** The megapixels of the size on screen. */
  current: number;
  control: MegapixelControl;
  custom: boolean;
}) {
  useLanguage();
  const set = !custom && control.target !== null;
  const value = set ? control.target! : current;
  const clamp = (next: number) => Math.min(control.max, Math.max(MIN_MP, Math.round(next * 20) / 20));
  const [draft, setDraft] = React.useState(formatMp(value));
  const [editing, setEditing] = React.useState(false);
  React.useEffect(() => { if (!editing) setDraft(formatMp(value)); }, [value, editing]);
  // What the field showed when focused: leaving it unchanged sets nothing (the rounded "0.98" of
  // a 0.984 MP shape would otherwise become a 1 MP target nobody typed).
  const shownAtFocus = React.useRef("");
  const typedValue = () => {
    const typed = Number(draft.replace(",", "."));
    return draft !== shownAtFocus.current && typed > 0 ? clamp(typed) : null;
  };
  const commit = () => {
    const next = typedValue();
    if (next !== null && next !== value) control.onChange(next);
    setDraft(formatMp(next ?? value));
    shownAtFocus.current = formatMp(next ?? value);
  };
  const input = React.useRef<HTMLInputElement>(null);
  const from = React.useRef(value);
  const { dragging, handlers } = useScrub({
    input,
    // From what's typed, if anything: the drag's press commits it, but this render's value is from before.
    onStart: () => { from.current = (editing ? typedValue() : null) ?? value; },
    // A twentieth of a megapixel a step.
    onScrub: (steps) => { const next = clamp(from.current + steps * 0.05); if (next !== value) control.onChange(next); }
  });
  return (
    <div className="size-mp">
      <span className="size-mp-label">{t("Megapixels")}{set ? <button type="button" className="size-mp-reset" onClick={control.onReset}>{t("Reset")}</button> : <small>{custom ? t("this size") : t("as the model draws")}</small>}
      </span>
      <div className={cn("size-field size-mp-field", dragging && "is-dragging")} onClick={(event) => { if (event.target === event.currentTarget) input.current?.focus(); }}>
        <input
          ref={input}
          inputMode="decimal"
          aria-label={t("Megapixels")}
          value={draft}
          onFocus={(event) => { shownAtFocus.current = draft; setEditing(true); event.currentTarget.select(); }}
          onBlur={() => { setEditing(false); commit(); }}
          onChange={(event) => setDraft(event.target.value.replace(/[^0-9.,]/g, "").slice(0, 5))}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); commit(); event.currentTarget.select(); }
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              const next = clamp(value + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 1 : 0.1));
              setDraft(formatMp(next));
              if (next !== value) control.onChange(next);
            }
          }}
        />
        <Tip content={t("Drag to change the megapixels")}>
          <span className="size-field-key" {...handlers} aria-hidden="true">{t("MP")}</span>
        </Tip>
      </div>
    </div>
  );
}

/**
 * Custom's width and height. Linked, a change to one carries the other along
 * at the shape it had when the change began (so snapping never drifts it);
 * a side that would pass its limit holds the pair at the limit instead.
 */
export function LinkedSizeFields({ size, limits, onChange, onSave, saved = false }: {
  size: Size;
  limits: { width: SideLimits; height: SideLimits };
  onChange: (size: Size) => void;
  /** "Save size": keep this size in the menu's list. Left out where there's no list to keep it in. */
  onSave?: () => void;
  /** This exact size is saved already. */
  saved?: boolean;
}) {
  useLanguage();
  const [linked, setLinked] = React.useState(true);
  // Just clicked: the hover lean waits until the pointer leaves the link, so the click's move plays in full.
  const [fresh, setFresh] = React.useState(false);
  const shape = React.useRef(size.width / size.height);
  const begin = () => { shape.current = size.width / size.height; };
  const maxW = limits.width.max ?? 4096;
  const maxH = limits.height.max ?? 4096;
  const setWidth = (width: number) => {
    if (!linked) return onChange({ width, height: size.height });
    let height = snapSide(width / shape.current, limits.height);
    if (width / shape.current > maxH) { height = maxH; width = snapSide(maxH * shape.current, limits.width); }
    onChange({ width, height });
  };
  const setHeight = (height: number) => {
    if (!linked) return onChange({ width: size.width, height });
    let width = snapSide(height * shape.current, limits.width);
    if (height * shape.current > maxW) { width = maxW; height = snapSide(maxW / shape.current, limits.height); }
    onChange({ width, height });
  };
  const atLimit = size.width >= maxW || size.height >= maxH;
  return (
    <div className="size-custom-body">
      <div className={cn("size-fields", linked && "is-linked", fresh && "is-fresh")}>
        <SizeField axis="W" value={size.width} limits={limits.width} onStart={begin} onChange={setWidth} />
        <Tip content={linked ? t("Linked: the shape stays as you resize. Click to unlink") : t("Unlinked: width and height change on their own. Click to link")}>
          <button type="button" className="size-link" aria-pressed={linked} aria-label={linked ? t("Unlink width and height") : t("Link width and height")} onClick={() => { begin(); setFresh(true); setLinked((value) => !value); }} onPointerLeave={() => setFresh(false)}>
            {/* Keyed, so each change plays the icon's turn (37-size-menu.css). */}
            <span key={linked ? "linked" : "apart"} className="size-link-icon">{linked ? <Link2 size={14} strokeWidth={2.2} /> : <Unlink2 size={14} strokeWidth={2.2} />}</span>
          </button>
        </Tip>
        <SizeField axis="H" value={size.height} limits={limits.height} onStart={begin} onChange={setHeight} />
      </div>
      <div className="size-custom-note">
        <span>{megapixels(size)} · {ratioName(size.width, size.height)}{atLimit ? <span className="is-limit">{t("· up to")}{" "}{Math.min(maxW, maxH)}{t("px")}</span> : null}</span>
        {onSave ? (
          <button type="button" className={cn("size-save", saved && "is-saved")} disabled={saved} onClick={onSave}>
            {/* Keyed, so the word changes with a small lift rather than a jump. */}
            <span key={saved ? "saved" : "save"}>{saved ? <><Check size={12} strokeWidth={2.6} />{t("Saved")}</> : t("Save size")}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A saved size in the shape list. It reads like any other row: its name with
 * its ratio beside it, its size on the right. Hovered (or focused), the size
 * steps left for Rename and Remove; renaming edits the name in place, Enter
 * or leaving keeps it, Escape puts it back without closing the menu.
 */
export function SavedSizeRow({ saved, active, onPick, onRename, onRemove, onPreview }: {
  saved: SavedSize;
  active: boolean;
  onPick: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  /** The row is under the pointer or focused (true), or not any more (false). */
  onPreview: (on: boolean) => void;
}) {
  useLanguage();
  const [renaming, setRenaming] = React.useState(false);
  const [draft, setDraft] = React.useState(saved.name);
  const ratio = ratioName(saved.width, saved.height);
  const shape = { label: ratio, value: `${saved.width}x${saved.height}`, w: saved.width, h: saved.height };
  const finish = (keep: boolean) => {
    const name = draft.trim();
    if (keep && name && name !== saved.name) onRename(name);
    setRenaming(false);
  };
  return (
    <motion.div
      className="size-saved"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className={cn("size-saved-row", renaming && "is-renaming")} onPointerEnter={(event) => { if (event.pointerType !== "touch") onPreview(true); }}>
        {renaming ? (
          <div className={cn("aspect-option is-saved", active && "active")}>
            <span className="aspect-shape" style={aspectIconStyle(shape)} />
            <input
              className="size-saved-name"
              data-own-escape
              autoFocus
              value={draft}
              maxLength={32}
              aria-label={t("Name of this size")}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => finish(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); finish(true); }
                if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
              }}
            />
            <em>{saved.width}×{saved.height}</em>
          </div>
        ) : (
          <button
            type="button"
            className={cn("aspect-option is-saved", active && "active")}
            role="option"
            aria-selected={active}
            onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) onPreview(true); }}
            onBlur={() => onPreview(false)}
            onClick={onPick}
          >
            <span className="aspect-shape" style={aspectIconStyle(shape)} />
            {/* The name gives way ("…"), the ratio stays: a long name never runs under the size. */}
            <span className="size-saved-label" title={saved.name}><span>{saved.name}</span><small>{ratio}</small></span>
            <em>{saved.width}×{saved.height}</em>
          </button>
        )}
        {renaming ? null : (
          <span className="size-saved-actions">
            <Tip content={t("Rename")}><button type="button" aria-label={t("Rename {0}", { "0": (saved.name) })} onClick={() => { setDraft(saved.name); setRenaming(true); }}><Pencil size={13} /></button></Tip>
            <Tip content={t("Remove")}><button type="button" className="is-remove" aria-label={t("Remove {0}", { "0": (saved.name) })} onClick={onRemove}><Trash2 size={13} /></button></Tip>
          </span>
        )}
      </div>
    </motion.div>
  );
}

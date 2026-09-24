import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useDismiss } from './useDismiss';
import { ChevronDown, Info, Minus, Plus, Search, Star, X } from 'lucide-react';
import { Select as FluidSelect, SelectContent as FluidSelectContent, SelectItem as FluidSelectItem, SelectTrigger as FluidSelectTrigger } from '@/components/ui/select';
import { Tooltip as FluidTooltip } from '@/components/ui/tooltip';
import { AnimatedNumber } from './AnimatedNumber';
import type { AspectPreset, Output, Profile } from './types';
import { aspectIconStyle, cn, titleFromPrompt } from './format';
import { wheelPixels } from './wheel';

/** How much room a composer control gets: full label, icon-only, or bare essentials. */
export type ControlDensity = "full" | "compact" | "mini";

export function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function MediaComponent({ item, muted = false }: { item: Output & { thumbnailUrl?: string }; muted?: boolean }) {
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
  const source = isThumbnail ? item.thumbnailUrl : item.url;
  if (!source || failed) return <div className="media-fallback"><span>{titleFromPrompt(item.prompt || item.filename) || "Output unavailable"}</span></div>;
  if (item.type === "video") {
    return (
      <video
        className={cn(!loaded && "media-loading")}
        src={source}
        controls={!muted}
        muted={muted}
        loop
        autoPlay={muted}
        preload="metadata"
        draggable={false}
        onLoadedData={reveal}
        onError={() => isThumbnail ? setUseFullImage(true) : setFailed(true)}
      />
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

export function StudioSelect({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<string | { label: string; value: string }> }) {
  const normalized = options.map((option) => typeof option === "string" ? { label: option, value: option } : option);
  return (
    <FluidSelect value={value} onValueChange={onChange}>
      <FluidSelectTrigger className="fluid-select-trigger" placeholder="Select" />
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

export function Tip({ content, side = "bottom", children }: { content: React.ReactNode; side?: "top" | "right" | "bottom" | "left"; children: React.ReactElement }) {
  return (
    <FluidTooltip content={content} side={side} sideOffset={10} delayDuration={220} className="heiss-tooltip bg-transparent text-foreground px-2.5 py-1.5 rounded-[12px]">
      {children}
    </FluidTooltip>
  );
}

/** Small "i" affordance for the one explanation a control genuinely needs. */
export function InfoTip({ content, side = "top" }: { content: React.ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <Tip content={content} side={side}>
      <button type="button" className="info-tip" aria-label="More information">
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
      {showSteppers ? <Tip content={`Decrease ${labelLower}`}><button
        type="button"
        className="number-picker-btn"
        aria-label={`Decrease ${labelLower}`}
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
        <button type="button" className="number-picker-value" onClick={beginEdit} aria-label={`${label}: ${formatValue(value)}, click to edit`}><AnimatedNumber value={formatValue(value)} /></button>
      ) : (
        <Tip content={`${label}: ${formatValue(value)} - click to edit`}><button type="button" className="number-picker-value" onClick={beginEdit} aria-label={`${label}: ${formatValue(value)}, click to edit`}><AnimatedNumber value={formatValue(value)} /></button></Tip>
      )}
      {showSteppers ? <Tip content={`Increase ${labelLower}`}><button
        type="button"
        className="number-picker-btn"
        aria-label={`Increase ${labelLower}`}
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

export function AspectPicker({ value, options, onChange, currentSize, defaultSize, density = "full" }: { value: string; options: AspectPreset[]; onChange: (value: string) => void; currentSize: string; defaultSize: string; density?: ControlDensity }) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((item) => item.value === value);
  const isDefault = value === "default";
  const close = useCallback(() => setOpen(false), []);
  useDismiss(pickerRef, open, close);
  const label = selected ? selected.label : isDefault ? "Default" : "Free";
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) {
      const current = document.activeElement;
      if (!current || current === document.body || pickerRef.current?.contains(current)) triggerRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);
  return (
    <div className={cn("aspect-picker", density !== "full" && `is-density-${density}`)} ref={pickerRef} data-open-surface={open || undefined}>
      <Tip content={density === "full" ? "Aspect ratio" : `Aspect ratio: ${label}`}><button ref={triggerRef} type="button" data-open-trigger className="aspect-trigger" aria-label={`Aspect ratio: ${label}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((next) => !next)}>
          {selected ? <span className="aspect-shape" style={aspectIconStyle(selected)} /> : <span className={cn("aspect-shape", isDefault ? "default" : "custom")} />}
          {density === "full" ? <span>{label}</span> : null}
          {density === "mini" ? null : <ChevronDown size={14} className={cn(open && "flip")} />}
        </button></Tip>
      {open ? (
        <div className="aspect-menu" data-open-surface role="listbox" aria-label="Aspect ratio" onKeyDown={(event) => {
          // Up and down move between options; the menu opens with focus on the chosen one.
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button.aspect-option"));
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
        }} ref={(node) => { if (node && !node.contains(document.activeElement)) (node.querySelector<HTMLButtonElement>("button.aspect-option.active") || node.querySelector<HTMLButtonElement>("button.aspect-option"))?.focus({ preventScroll: true }); }}>
          <Tip content="Use the model's detected default size"><button
              type="button"
              className={cn("aspect-option", value === "default" && "active")}
              role="option"
              aria-selected={value === "default"}
              onClick={() => {
                onChange("default");
                setOpen(false);
              }}
            >
              <span className="aspect-shape default" />
              <span>Default</span>
              <em>{defaultSize}</em>
            </button></Tip>
          {options.map((option) => (
            <Tip key={option.value} content={`${option.label} ${option.value}`}><button
                type="button"
                className={cn("aspect-option", option.value === value && "active")}
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="aspect-shape" style={aspectIconStyle(option)} />
                <span>{option.label}</span>
                <em>{option.value}</em>
              </button></Tip>
          ))}
          {value === "free" ? <div className="aspect-option active is-readonly"><span className="aspect-shape custom" /><span>Free</span><em>{currentSize}</em></div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function familyLabel(profile: Profile | null) {
  if (!profile) return "";
  if (profile.family === "z-image") return "Z image";
  if (profile.family === "checkpoint") return "Checkpoint";
  if (profile.family === "wan") return "Wan video";
  if (profile.family === "custom") return "Workflow";
  return profile.family;
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

/**
 * The model menu. With a handful of models it is a plain list; past that it
 * gets a search field, and it always splits into Favorites (starred), Recent
 * and the rest by family, scrolling inside a capped height with "Find more
 * models" pinned below. Arrow keys move, Enter picks, typing searches.
 */
export function ModelPicker({ value, profiles, onChange, compact = false, badges = {}, density = "full", emptyHint = "", onFindModels, strayCount = 0, menu }: { value: string; profiles: Profile[]; onChange: (value: string) => void; compact?: boolean; badges?: Record<string, string>; density?: ControlDensity; emptyHint?: string; onFindModels?: () => void; strayCount?: number; menu?: ModelMenuState }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(-1);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const selected = profiles.find((profile) => profile.id === value) || profiles[0] || null;
  const close = useCallback(() => { setOpen(false); setQuery(""); setCursor(-1); }, []);
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
    return [
      { id: "favorites", label: "Favorites", rows: starred },
      { id: "recent", label: "Recent", rows: recent },
      { id: "all", label: starred.length || recent.length ? "All models" : "", rows: rest }
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
      <Tip content={selected ? `${selected.displayName || selected.label} - choose workflow` : "Choose model"}><button ref={triggerRef} type="button" data-open-trigger className="model-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
          {compact ? (
            <span className="model-copy"><strong>{selected?.displayName || selected?.label || "No model"}</strong></span>
          ) : (
            <span className="model-copy">
              <strong>{selected?.displayName || selected?.label || "No model"}</strong>
              <em>{selected ? familyLabel(selected) : "No supported workflow"}</em>
            </span>
          )}
          <ChevronDown size={14} className={cn(open && "flip")} />
        </button></Tip>
      {open ? (
        <div className={cn("model-menu", searchable && "has-search")} data-open-surface onKeyDown={onMenuKey}>
          {profiles.length ? null : (
            <div className="model-menu-empty">
              <strong>No models to choose from</strong>
              <span>{emptyHint || "ComfyUI has no model HEISS UI can run yet."}</span>
              {onFindModels ? <button type="button" className="btn is-primary model-menu-find-cta" onClick={() => { close(); onFindModels(); }}>{strayCount ? `Add ${strayCount} model${strayCount === 1 ? "" : "s"}` : "Find models"}</button> : null}
            </div>
          )}
          {searchable ? (
            <label className="model-menu-search">
              <Search size={14} aria-hidden="true" />
              <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${profiles.length} models`} aria-label="Search models" aria-activedescendant={cursor >= 0 ? `${menuId}-row-${cursor}` : undefined} spellCheck={false} autoComplete="off" />
              {query ? <button type="button" className="model-menu-clear" aria-label="Clear search" onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X size={12} /></button> : null}
            </label>
          ) : null}
          {profiles.length ? (
            <div className="model-menu-list" ref={listRef} role="listbox" aria-label="Models" tabIndex={-1} aria-activedescendant={cursor >= 0 ? `${menuId}-row-${cursor}` : undefined}>
              {sections.map((section) => (
                <div key={section.id} className="model-menu-section" role="group" aria-label={section.label || undefined}>
                  {section.label ? <div className="model-menu-label">{section.label}</div> : null}
                  {section.rows.map((profile) => {
                    rowIndex += 1;
                    const starred = favorites.has(profile.id);
                    const badge = menu ? familyLabel(profile) : badges[profile.id] || familyLabel(profile);
                    return (
                      <div key={`${section.id}:${profile.id}`} className={cn("model-row", starred && "is-starred")}>
                        <Tip content={profile.displayName || profile.label}><button
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
                              <em>{profile.description || familyLabel(profile)}</em>
                            </span>
                            {badge ? <span className="model-badge">{badge}</span> : null}
                          </button></Tip>
                        {menu ? (
                          <button type="button" className="model-star" aria-pressed={starred} aria-label={starred ? `Remove ${profile.displayName || profile.label} from favorites` : `Add ${profile.displayName || profile.label} to favorites`} onClick={() => menu.toggleFavorite(profile.id)}>
                            <Star size={13} fill={starred ? "currentColor" : "none"} />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
              {query && !flat.length ? <div className="model-menu-none">No model matches “{query.trim()}”.</div> : null}
            </div>
          ) : null}
          {onFindModels && profiles.length ? (
            // Always one tap from where people notice a model is missing.
            <button type="button" className={cn("model-menu-find", strayCount > 0 && "has-found")} onClick={() => { close(); onFindModels(); }}>
              <span>{strayCount ? `${strayCount} model${strayCount === 1 ? "" : "s"} found` : "Find more models"}</span>
              <em>{strayCount ? "Add" : "Search"}</em>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

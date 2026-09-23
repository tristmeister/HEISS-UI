import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, GripVertical, Layers, Plus, RotateCcw, Save, Search, Star, X } from 'lucide-react';
import { cn } from './format';
import { defaultLoraStrength, loraGroups, maxLoras, recommendedLoras, rankedLoras } from './loras';
import { Switch } from './SettingsDialog';
import { Tip } from './components';
import type { LoraSnapshot } from './lora-storage';
import type { LoraSelection, Profile } from './types';

export type LoraLibraryApi = {
  familyLabel: string;
  stacks: LoraSnapshot[];
  favorites: string[];
  recents: string[];
  loadStack: (stack: LoraSnapshot) => void;
  saveStack: (name: string) => LoraSnapshot;
  updateStack: (id: string) => void;
  renameStack: (id: string, name: string) => void;
  deleteStack: (stack: LoraSnapshot) => Promise<boolean>;
  toggleFavorite: (name: string) => void;
  recordRecents: (names: string[]) => void;
};

const strengthMin = 0;
const strengthMax = 2;

function fileName(name: string) {
  const parts = name.split(/[\\/]/);
  return (parts[parts.length - 1] || name).replace(/\.(safetensors|ckpt|pt|bin)$/i, '');
}

function folderOf(name: string) {
  const parts = name.split(/[\\/]/).filter(Boolean);
  return parts.slice(0, -1).join(' / ');
}

function sameStack(a: LoraSelection[], b: LoraSelection[]) {
  return a.length === b.length && a.every((item, index) => item.name === b[index].name && item.enabled === b[index].enabled && Math.abs(item.strength - b[index].strength) < 0.001);
}

const round = (value: number) => Math.round(value * 100) / 100;

/* ------------------------------------------------------------------ Card */

function StrengthControl({ value, onChange, disabled, label }: { value: number; onChange: (next: number) => void; disabled?: boolean; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const fill = Math.max(0, Math.min(1, (value - strengthMin) / (strengthMax - strengthMin)));
  const commit = () => {
    if (draft === null) return;
    const next = Number(draft.replace(',', '.'));
    if (Number.isFinite(next)) onChange(round(Math.max(-4, Math.min(4, next))));
    setDraft(null);
  };
  return (
    <div className={cn('lora-strength', disabled && 'is-disabled')}>
      <input
        type="range"
        aria-label={`${label} strength`}
        min={strengthMin}
        max={strengthMax}
        step={0.05}
        value={Math.max(strengthMin, Math.min(strengthMax, value))}
        style={{ '--fill': `${fill * 100}%` } as React.CSSProperties}
        onChange={(event) => onChange(round(Number(event.target.value)))}
        onDoubleClick={() => onChange(defaultLoraStrength)}
      />
      <Tip content="Type a value. Arrow keys nudge by 0.01, Shift by 0.1">
        <input
          className="lora-strength-value is-bare"
          aria-label={`${label} strength value`}
          inputMode="decimal"
          value={draft ?? value.toFixed(2)}
          onFocus={(event) => { setDraft(value.toFixed(2)); requestAnimationFrame(() => event.target.select()); }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); commit(); (event.target as HTMLInputElement).blur(); }
            if (event.key === 'Escape') { event.stopPropagation(); setDraft(null); (event.target as HTMLInputElement).blur(); }
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              const step = event.shiftKey ? 0.1 : 0.01;
              const next = round(value + (event.key === 'ArrowUp' ? step : -step));
              onChange(next);
              setDraft(next.toFixed(2));
            }
          }}
        />
      </Tip>
    </div>
  );
}

/**
 * One LoRA: name and its on/off switch on top, strength underneath, all on
 * one left edge. The grip and remove button stay out of the way until the
 * card is hovered or focused.
 */
function LoraCard({ item, index, count, missing, overLimit, onChange, onRemove, onSwap, onMove }: {
  item: LoraSelection;
  index: number;
  count: number;
  missing: boolean;
  overLimit: boolean;
  onChange: (patch: Partial<LoraSelection>) => void;
  onRemove: () => void;
  onSwap: () => void;
  onMove: (to: number) => void;
}) {
  const controls = useDragControls();
  const folder = folderOf(item.name);
  const label = fileName(item.name);
  return (
    <Reorder.Item as="div" value={item} dragListener={false} dragControls={controls} style={{ position: 'relative' }} whileDrag={{ scale: 1.02, zIndex: 5, boxShadow: '0 12px 32px rgb(0 0 0 / 0.45), inset 0 0 0 1px rgb(255 255 255 / 0.14)' }} className={cn('lora-card', !item.enabled && 'is-off', (missing || overLimit) && 'has-warning')}>
      {count > 1 ? (
        <button
          type="button"
          className="lora-grip"
          aria-label={`Reorder ${label}. Use the arrow keys to move it.`}
          onPointerDown={(event) => controls.start(event)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' && index > 0) { event.preventDefault(); onMove(index - 1); }
            if (event.key === 'ArrowDown' && index < count - 1) { event.preventDefault(); onMove(index + 1); }
          }}
        >
          <GripVertical size={13} />
        </button>
      ) : null}
      <div className="lora-card-top">
        <Tip content={folder ? `${folder} · click to swap` : 'Click to swap for another LoRA'}>
          <button type="button" className="lora-name" onClick={onSwap}>{label}</button>
        </Tip>
        <Tip content="Remove"><button type="button" className="lora-remove" aria-label={`Remove ${label}`} onClick={onRemove}><X size={13} /></button></Tip>
        <Switch size="sm" label={item.enabled ? `Turn off ${label}` : `Turn on ${label}`} checked={item.enabled} onChange={(enabled) => onChange({ enabled })} />
      </div>
      <StrengthControl label={label} value={item.strength} disabled={!item.enabled} onChange={(strength) => onChange({ strength })} />
      {missing ? <p className="lora-warning"><AlertTriangle size={12} /> Not found in ComfyUI's LoRA folder</p> : null}
      {!missing && overLimit ? <p className="lora-warning"><AlertTriangle size={12} /> Over this workflow's limit, so it won't be used</p> : null}
    </Reorder.Item>
  );
}

/* ---------------------------------------------------------------- Picker */

type PickerRow = { key: string; name: string };
type PickerSection = { id: string; label: string; rows: PickerRow[]; collapsible?: boolean };

function LoraPicker({ options, profile, current, favorites, recents, remaining, swapping, onToggleFavorite, onAdd, onSwap, onClose }: {
  options: string[];
  profile: Profile | null;
  current: string[];
  favorites: string[];
  recents: string[];
  remaining: number;
  swapping: string | null;
  onToggleFavorite: (name: string) => void;
  onAdd: (names: string[]) => void;
  onSwap: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const available = useMemo(() => new Set(options), [options]);
  const sections = useMemo<PickerSection[]>(() => {
    const q = query.trim().toLowerCase();
    if (q) return [{ id: 'results', label: 'Results', rows: rankedLoras(options, profile, q).map((name) => ({ key: `q:${name}`, name })) }];
    const out: PickerSection[] = [];
    const fav = favorites.filter((name) => available.has(name));
    const rec = recents.filter((name) => available.has(name) && !fav.includes(name)).slice(0, 5);
    const suggested = recommendedLoras(options, profile).filter((name) => !fav.includes(name) && !rec.includes(name)).slice(0, 6);
    if (fav.length) out.push({ id: 'favorites', label: 'Favorites', rows: fav.map((name) => ({ key: `f:${name}`, name })) });
    if (rec.length) out.push({ id: 'recents', label: 'Recent', rows: rec.map((name) => ({ key: `r:${name}`, name })) });
    if (suggested.length) out.push({ id: 'suggested', label: profile?.family ? `Suggested for ${profile.family}` : 'Suggested', rows: suggested.map((name) => ({ key: `s:${name}`, name })) });
    for (const group of loraGroups(options, profile)) {
      out.push({ id: group.id, label: group.label, collapsible: true, rows: group.loras.map((name) => ({ key: `${group.id}:${name}`, name })) });
    }
    return out;
  }, [available, favorites, options, profile, query, recents]);

  const visibleRows = useMemo(() => sections.flatMap((section) => collapsed.has(section.id) ? [] : section.rows), [collapsed, sections]);
  useEffect(() => { setHighlight(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector('[data-highlight="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const multi = !swapping;
  const isAdded = (name: string) => current.includes(name) && name !== swapping;
  const full = selected.length >= remaining;
  const choose = (name: string) => {
    if (isAdded(name)) return;
    if (!multi) { onSwap(name); return; }
    setSelected((list) => list.includes(name) ? list.filter((item) => item !== name) : list.length >= remaining ? list : [...list, name]);
  };

  let rowIndex = -1;
  return (
    <div className="lora-picker" role="dialog" aria-label={swapping ? 'Replace LoRA' : 'Add LoRAs'}>
      <div className="lora-picker-head">
        <button type="button" className="btn is-ghost lora-picker-back" onClick={onClose}><ArrowLeft size={14} /> Back</button>
        <span>{swapping ? <>Replace <strong>{fileName(swapping)}</strong></> : remaining > 0 ? `Add up to ${remaining}` : 'Stack is full'}</span>
      </div>
      <label className="lora-picker-search">
        <Search size={14} />
        <input
          ref={inputRef}
          className="is-bare"
          value={query}
          placeholder={`Search ${options.length} LoRAs`}
          aria-label="Search LoRAs"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight((value) => Math.min(visibleRows.length - 1, value + 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight((value) => Math.max(0, value - 1)); }
            if (event.key === 'Enter') {
              event.preventDefault();
              if ((event.metaKey || event.ctrlKey) && selected.length) { onAdd(selected); return; }
              const row = visibleRows[highlight];
              if (row) choose(row.name);
            }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (query) setQuery(''); else onClose(); }
          }}
        />
        {query ? <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); inputRef.current?.focus(); }}><X size={13} /></button> : null}
      </label>
      <div className="lora-picker-list" ref={listRef} role="listbox" aria-multiselectable={multi}>
        {sections.map((section) => {
          const isCollapsed = collapsed.has(section.id);
          return (
            <div className="lora-picker-section" key={section.id}>
              {section.collapsible ? (
                <button type="button" className="lora-picker-heading" aria-expanded={!isCollapsed} onClick={() => setCollapsed((set) => { const next = new Set(set); if (next.has(section.id)) next.delete(section.id); else next.add(section.id); return next; })}>
                  <span>{section.label}</span><em>{section.rows.length}</em><ChevronDown size={12} className={cn(isCollapsed && 'is-collapsed')} />
                </button>
              ) : <div className="lora-picker-heading is-static"><span>{section.label}</span></div>}
              {!isCollapsed ? section.rows.map((row) => {
                rowIndex += 1;
                const index = rowIndex;
                const added = isAdded(row.name);
                const checked = selected.includes(row.name);
                const favorite = favorites.includes(row.name);
                return (
                  <div
                    key={row.key}
                    role="option"
                    aria-selected={checked}
                    aria-disabled={added || (multi && full && !checked) || undefined}
                    data-highlight={index === highlight}
                    className={cn('lora-option', checked && 'is-selected', added && 'is-added', index === highlight && 'is-highlight')}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(row.name)}
                  >
                    {multi ? <span className="lora-option-check" aria-hidden="true">{checked || added ? <Check size={11} strokeWidth={3} /> : null}</span> : null}
                    <span className="lora-option-copy">
                      <strong>{fileName(row.name)}</strong>
                      {folderOf(row.name) && (query || !section.collapsible) ? <span>{folderOf(row.name)}</span> : null}
                    </span>
                    {added ? <em>Added</em> : null}
                    <button
                      type="button"
                      className={cn('lora-option-star', favorite && 'active')}
                      aria-label={favorite ? `Unfavorite ${fileName(row.name)}` : `Favorite ${fileName(row.name)}`}
                      onClick={(event) => { event.stopPropagation(); onToggleFavorite(row.name); }}
                    >
                      <Star size={13} fill={favorite ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                );
              }) : null}
            </div>
          );
        })}
        {!visibleRows.length && query ? <div className="lora-empty"><p>No LoRAs match "{query}".</p></div> : null}
      </div>
      {multi ? (
        <div className="lora-picker-foot">
          <span>{full && remaining > 0 ? `This workflow takes ${remaining} more` : selected.length ? `${selected.length} selected` : 'Click to select, Enter to toggle'}</span>
          <button type="button" className="btn is-primary" disabled={!selected.length} onClick={() => onAdd(selected)}>
            <Plus size={14} /> Add{selected.length > 1 ? ` ${selected.length}` : ''}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Stacks */

/** A short default name from the LoRAs themselves: "Anime Watercolor +1". */
function suggestStackName(loras: LoraSelection[], taken: string[]) {
  const pretty = (item: LoraSelection) => fileName(item.name)
    .replace(/[-_.]+/g, ' ')
    .replace(/\b(v\d+(\.\d+)*|lora|loha|lycoris|epoch\s*\d+|e\d+|\d{3,})\b/gi, '')
    .replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const enabled = loras.filter((item) => item.enabled);
  const lead = [...(enabled.length ? enabled : loras)].sort((x, y) => y.strength - x.strength)[0];
  let name = lead ? pretty(lead) : '';
  if (!name) name = 'My stack';
  if (name.length > 22) name = `${name.slice(0, 21).trim()}…`;
  if (loras.length > 1) name += ` +${loras.length - 1}`;
  let unique = name;
  for (let n = 2; taken.includes(unique); n++) unique = `${name} (${n})`;
  return unique;
}

function NameField({ initial, action, onSave, onCancel }: { initial: string; action: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const save = () => { const name = value.trim(); if (name) onSave(name); else onCancel(); };
  return (
    <form className="lora-name-field" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <input
        autoFocus
        className="is-bare"
        aria-label="Stack name"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } }}
      />
      <button type="submit" className="lora-chip-action is-primary" disabled={!value.trim()}>{action}</button>
      <button type="button" className="lora-chip-action" aria-label="Cancel" onClick={onCancel}><X size={13} /></button>
    </form>
  );
}

/**
 * Stacks live in plain sight as chips: one click loads one, the active one is
 * lit, and saving only appears when there is something new to save.
 */
function Stacks({ library, loras, activeId, setActiveId, onLoad }: {
  library: LoraLibraryApi;
  loras: LoraSelection[];
  activeId: string;
  setActiveId: (id: string) => void;
  onLoad: (stack: LoraSnapshot) => void;
}) {
  const [naming, setNaming] = useState<null | { mode: 'new' } | { mode: 'rename'; id: string }>(null);
  // The stack you're working from: the one you loaded, an exact match, or one with
  // the same LoRAs (so nudging a strength reads as "changed", not "unsaved").
  const sameSet = (stack: LoraSnapshot) => stack.loras.length === loras.length && stack.loras.every((item) => loras.some((current) => current.name === item.name));
  const active = library.stacks.find((stack) => stack.id === activeId)
    || library.stacks.find((stack) => sameStack(stack.loras, loras))
    || (loras.length ? library.stacks.find(sameSet) : null)
    || null;
  const modified = Boolean(active && loras.length && !sameStack(active.loras, loras));
  const matchesSaved = library.stacks.some((stack) => sameStack(stack.loras, loras));
  const canSaveNew = loras.length > 0 && !matchesSaved && !modified;
  const family = library.familyLabel || 'this model';

  if (!library.stacks.length && !loras.length) return null;
  const remove = async (stack: LoraSnapshot) => { if (await library.deleteStack(stack) && stack.id === activeId) setActiveId(''); };

  return (
    <section className="lora-stacks" aria-label={`Saved stacks for ${family}`}>
      {library.stacks.length ? (
        <div className="lora-chips">
          {library.stacks.map((stack) => {
            const isActive = stack.id === active?.id;
            if (naming?.mode === 'rename' && naming.id === stack.id) {
              return <NameField key={stack.id} initial={stack.name} action="Rename" onSave={(name) => { library.renameStack(stack.id, name); setNaming(null); }} onCancel={() => setNaming(null)} />;
            }
            return (
              <Tip key={stack.id} content={<>{stack.loras.map((item) => fileName(item.name)).join(', ') || 'Empty'}<br /><span className="lora-tip-hint">Double-click to rename</span></>}>
                <span className={cn('lora-chip', isActive && 'is-active', isActive && modified && 'is-modified')}>
                  <button
                    type="button"
                    className="lora-chip-load"
                    aria-pressed={isActive}
                    onClick={() => { if (!isActive || modified) onLoad(stack); setActiveId(stack.id); }}
                    onDoubleClick={() => setNaming({ mode: 'rename', id: stack.id })}
                    onKeyDown={(event) => {
                      if (event.key === 'F2') { event.preventDefault(); setNaming({ mode: 'rename', id: stack.id }); }
                      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(stack); }
                    }}
                  >
                    <span className="lora-chip-name">{stack.name}</span>
                    <em>{stack.loras.length}</em>
                  </button>
                  <button type="button" className="lora-chip-remove" aria-label={`Delete stack ${stack.name}`} onClick={() => remove(stack)}><X size={11} /></button>
                </span>
              </Tip>
            );
          })}
        </div>
      ) : null}

      {naming?.mode === 'new' ? (
        <NameField
          initial={suggestStackName(loras, library.stacks.map((stack) => stack.name))}
          action="Save"
          onSave={(name) => { const stack = library.saveStack(name); setActiveId(stack.id); setNaming(null); }}
          onCancel={() => setNaming(null)}
        />
      ) : modified && active ? (
        <div className="lora-stack-changes">
          <span><i aria-hidden="true" />Unsaved changes</span>
          <Tip content={`Save these LoRAs into ${active.name}`}><button type="button" className="lora-text-action is-strong" onClick={() => library.updateStack(active.id)}>Update</button></Tip>
          <button type="button" className="lora-text-action" onClick={() => setNaming({ mode: 'new' })}>Save as new</button>
        </div>
      ) : canSaveNew ? (
        <button type="button" className="lora-save-chip" onClick={() => setNaming({ mode: 'new' })}>
          <Save size={12} /> Save as stack{library.stacks.length ? '' : <span> for every {family} workflow</span>}
        </button>
      ) : null}
    </section>
  );
}

/* ----------------------------------------------------------------- Panel */

type Undo = { label: string; restore: LoraSelection[] };

export function LoraPanel({ loras, setLoras, options, profile, limit, library, rememberedStrength, unavailableReason }: {
  loras: LoraSelection[];
  setLoras: (update: LoraSelection[] | ((current: LoraSelection[]) => LoraSelection[])) => void;
  options: string[];
  profile: Profile | null;
  limit: number;
  library: LoraLibraryApi;
  rememberedStrength: (name: string, fallback: number) => number;
  unavailableReason: string;
}) {
  const [picker, setPicker] = useState<{ swap: string | null } | null>(null);
  const [activeStackId, setActiveStackId] = useState('');
  const [undo, setUndo] = useState<Undo | null>(null);
  const undoTimer = useRef<number | null>(null);
  useEffect(() => () => { if (undoTimer.current) window.clearTimeout(undoTimer.current); }, []);
  useEffect(() => { setActiveStackId(''); }, [library.familyLabel]);

  const available = useMemo(() => new Set(options), [options]);
  const cap = Math.min(maxLoras, limit);
  const activeCount = loras.filter((item) => item.enabled).length;

  if (unavailableReason) {
    return (
      <div className="lora-panel">
        <div className="lora-empty is-unavailable"><Layers size={18} /><p>{unavailableReason}</p></div>
      </div>
    );
  }

  /** Every change that drops LoRAs can be taken back for a few seconds. */
  const withUndo = (label: string, next: LoraSelection[]) => {
    const before = loras;
    setLoras(next);
    setUndo({ label, restore: before });
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 6000);
  };
  const update = (index: number, patch: Partial<LoraSelection>) => setLoras((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  const remove = (index: number) => withUndo(`Removed ${fileName(loras[index].name)}`, loras.filter((_, i) => i !== index));
  const clearAll = () => { withUndo(`Cleared ${loras.length} LoRA${loras.length === 1 ? '' : 's'}`, []); setActiveStackId(''); };
  const loadStack = (stack: LoraSnapshot) => {
    const unsaved = loras.length > 0 && !library.stacks.some((item) => sameStack(item.loras, loras));
    if (unsaved) withUndo(`Loaded ${stack.name}`, stack.loras);
    else library.loadStack(stack);
  };
  const allOff = loras.length > 0 && loras.every((item) => !item.enabled);
  const move = (from: number, to: number) => setLoras((current) => { const next = [...current]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; });
  const add = (names: string[]) => {
    const fresh = names.filter((name) => !loras.some((item) => item.name === name)).slice(0, Math.max(0, cap - loras.length));
    setLoras((current) => [...current, ...fresh.map((name) => ({ name, enabled: true, strength: rememberedStrength(name, defaultLoraStrength) }))]);
    library.recordRecents(fresh);
    setPicker(null);
  };
  // Swapping keeps the card's strength; only a newly added LoRA picks up its remembered one.
  const swap = (from: string, to: string) => {
    setLoras((current) => current.map((item) => item.name === from ? { ...item, name: to } : item));
    library.recordRecents([to]);
    setPicker(null);
  };

  if (picker) {
    return (
      <div className="lora-panel">
        <LoraPicker
          options={options}
          profile={profile}
          current={loras.map((item) => item.name)}
          favorites={library.favorites}
          recents={library.recents}
          remaining={Math.max(0, cap - loras.length)}
          swapping={picker.swap}
          onToggleFavorite={library.toggleFavorite}
          onAdd={add}
          onSwap={(name) => picker.swap && swap(picker.swap, name)}
          onClose={() => setPicker(null)}
        />
      </div>
    );
  }

  return (
    <div className="lora-panel">
      <header className="lora-head">
        <span className="lora-count">{loras.length ? <>{activeCount} active <em>· {loras.length}/{cap}</em></> : `Up to ${cap} LoRAs`}</span>
        {loras.length ? (
          <>
            <Tip content={allOff ? 'Turn every LoRA back on' : 'Turn every LoRA off, keep the stack'}>
              <button type="button" className="lora-head-action" onClick={() => setLoras((current) => current.map((item) => ({ ...item, enabled: allOff })))}>{allOff ? 'All on' : 'All off'}</button>
            </Tip>
            <Tip content="Remove every LoRA (you can undo)">
              <button type="button" className="lora-head-action" onClick={clearAll}>Clear</button>
            </Tip>
          </>
        ) : null}
      </header>

      <Stacks library={library} loras={loras} activeId={activeStackId} setActiveId={setActiveStackId} onLoad={loadStack} />

      {loras.length ? (
        <Reorder.Group as="div" axis="y" values={loras} onReorder={(next) => setLoras(next)} className="lora-list">
          {loras.map((item, index) => (
            <LoraCard
              key={item.name}
              item={item}
              index={index}
              count={loras.length}
              missing={!available.has(item.name)}
              overLimit={index >= cap}
              onChange={(patch) => update(index, patch)}
              onRemove={() => remove(index)}
              onSwap={() => setPicker({ swap: item.name })}
              onMove={(to) => move(index, to)}
            />
          ))}
        </Reorder.Group>
      ) : (
        <div className="lora-empty">
          <p>LoRAs steer style, characters or detail on top of the model.{library.stacks.length ? ' Load a saved stack above, or add one.' : ' Add one to start.'}</p>
        </div>
      )}

      {undo ? (
        <div className="lora-undo" role="status">
          <span>{undo.label}</span>
          <button type="button" onClick={() => { setLoras(undo.restore); setUndo(null); }}><RotateCcw size={12} /> Undo</button>
        </div>
      ) : null}

      <button type="button" className="btn lora-add" onClick={() => setPicker({ swap: null })} disabled={loras.length >= cap}>
        <Plus size={14} /> {loras.length >= cap ? `This workflow takes ${cap}` : 'Add LoRA'}
      </button>
    </div>
  );
}

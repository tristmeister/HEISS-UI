import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, GripVertical, Layers, Pencil, Plus, RotateCcw, Save, Search, Star, Trash2, X } from 'lucide-react';
import { cn } from './format';
import { defaultLoraStrength, loraGroups, maxLoras, recommendedLoras, rankedLoras } from './loras';
import { Switch } from './SettingsDialog';
import { Tip } from './components';
import { useDismiss } from './useDismiss';
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

function StrengthControl({ value, onChange, disabled }: { value: number; onChange: (next: number) => void; disabled?: boolean }) {
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
        aria-label="Strength"
        min={strengthMin}
        max={strengthMax}
        step={0.05}
        value={Math.max(strengthMin, Math.min(strengthMax, value))}
        style={{ '--fill': `${fill * 100}%` } as React.CSSProperties}
        onChange={(event) => onChange(round(Number(event.target.value)))}
        onDoubleClick={() => onChange(defaultLoraStrength)}
      />
      <input
        className="lora-strength-value is-bare"
        aria-label="Strength value"
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
    </div>
  );
}

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
  return (
    <Reorder.Item as="div" value={item} dragListener={false} dragControls={controls} className={cn('lora-card', !item.enabled && 'is-off', (missing || overLimit) && 'has-warning')}>
      <div className="lora-card-top">
        <button
          type="button"
          className="lora-grip"
          aria-label={`Reorder ${fileName(item.name)}. Use the arrow keys to move it.`}
          onPointerDown={(event) => controls.start(event)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' && index > 0) { event.preventDefault(); onMove(index - 1); }
            if (event.key === 'ArrowDown' && index < count - 1) { event.preventDefault(); onMove(index + 1); }
          }}
        >
          <GripVertical size={14} />
        </button>
        <Tip content="Choose a different LoRA">
          <button type="button" className="lora-name" onClick={onSwap}>
            <strong>{fileName(item.name)}</strong>
            {folder ? <span>{folder}</span> : null}
          </button>
        </Tip>
        <Switch label={item.enabled ? `Turn off ${fileName(item.name)}` : `Turn on ${fileName(item.name)}`} checked={item.enabled} onChange={(enabled) => onChange({ enabled })} />
        <Tip content="Remove"><button type="button" className="lora-remove" aria-label={`Remove ${fileName(item.name)}`} onClick={onRemove}><X size={14} /></button></Tip>
      </div>
      <StrengthControl value={item.strength} disabled={!item.enabled} onChange={(strength) => onChange({ strength })} />
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

function StackBar({ library, loras, activeId, setActiveId }: { library: LoraLibraryApi; loras: LoraSelection[]; activeId: string; setActiveId: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState<{ id: string; value: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => { setOpen(false); setNaming(null); }, []);
  useDismiss(ref, open, close);

  const active = library.stacks.find((stack) => stack.id === activeId) || library.stacks.find((stack) => sameStack(stack.loras, loras)) || null;
  const modified = Boolean(active && !sameStack(active.loras, loras));
  const commitName = () => {
    if (!naming) return;
    const value = naming.value.trim();
    if (!value) { setNaming(null); return; }
    if (naming.id === 'new') { const stack = library.saveStack(value); setActiveId(stack.id); }
    else library.renameStack(naming.id, value);
    setNaming(null);
  };
  const nameInput = (
    <input
      autoFocus
      className="lora-stack-input is-bare"
      aria-label="Stack name"
      value={naming?.value || ''}
      placeholder="Stack name"
      onChange={(event) => setNaming((current) => current && { ...current, value: event.target.value })}
      onFocus={(event) => event.target.select()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); commitName(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setNaming(null); }
      }}
      onBlur={commitName}
    />
  );

  return (
    <div className="lora-stackbar" ref={ref} data-open-surface={open || undefined}>
      <button type="button" className="lora-stack-trigger" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Layers size={14} />
        <span className="lora-stack-name">{active ? active.name : loras.length ? 'Unsaved stack' : 'Stacks'}</span>
        {modified ? <em className="lora-stack-modified">Modified</em> : null}
        <ChevronDown size={13} className="lora-stack-chevron" />
      </button>
      {modified && active ? <Tip content={`Save changes to ${active.name}`}><button type="button" className="btn is-ghost lora-stack-update" onClick={() => library.updateStack(active.id)}><Save size={13} /> Update</button></Tip> : null}
      {open ? (
        <div className="lora-stack-menu">
          <div className="lora-stack-menu-head">Stacks for {library.familyLabel || 'this model'}</div>
          {library.stacks.length ? library.stacks.map((stack) => (
            <div className={cn('lora-stack-row', stack.id === active?.id && 'active')} key={stack.id}>
              {naming?.id === stack.id ? nameInput : (
                <button type="button" className="lora-stack-load" onClick={() => { library.loadStack(stack); setActiveId(stack.id); setOpen(false); }}>
                  <span>{stack.name}</span>
                  <small>{stack.loras.length} LoRA{stack.loras.length === 1 ? '' : 's'}</small>
                </button>
              )}
              {naming?.id === stack.id ? null : (
                <>
                  <Tip content="Rename"><button type="button" className="lora-stack-action" aria-label={`Rename ${stack.name}`} onClick={() => setNaming({ id: stack.id, value: stack.name })}><Pencil size={12} /></button></Tip>
                  <Tip content="Delete"><button type="button" className="lora-stack-action is-danger" aria-label={`Delete ${stack.name}`} onClick={async () => { if (await library.deleteStack(stack) && stack.id === activeId) setActiveId(''); }}><Trash2 size={12} /></button></Tip>
                </>
              )}
            </div>
          )) : <p className="lora-stack-empty">Save the LoRAs you use together as a stack. Every {library.familyLabel || 'model'} workflow can load it.</p>}
          <div className="lora-stack-foot">
            {naming?.id === 'new' ? nameInput : (
              <button type="button" className="btn is-ghost" disabled={!loras.length} onClick={() => setNaming({ id: 'new', value: `Stack ${library.stacks.length + 1}` })}>
                <Plus size={13} /> Save current as new stack
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- Panel */

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
  const [removed, setRemoved] = useState<{ item: LoraSelection; index: number } | null>(null);
  const removedTimer = useRef<number | null>(null);
  useEffect(() => () => { if (removedTimer.current) window.clearTimeout(removedTimer.current); }, []);
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

  const update = (index: number, patch: Partial<LoraSelection>) => setLoras((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  const remove = (index: number) => {
    const item = loras[index];
    setLoras((current) => current.filter((_, i) => i !== index));
    setRemoved({ item, index });
    if (removedTimer.current) window.clearTimeout(removedTimer.current);
    removedTimer.current = window.setTimeout(() => setRemoved(null), 6000);
  };
  const undoRemove = () => {
    if (!removed) return;
    setLoras((current) => { const next = [...current]; next.splice(Math.min(removed.index, next.length), 0, removed.item); return next; });
    setRemoved(null);
  };
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
      <StackBar library={library} loras={loras} activeId={activeStackId} setActiveId={setActiveStackId} />

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
          <p>LoRAs steer style, characters or detail on top of the model. Add one to start a stack.</p>
        </div>
      )}

      {removed ? (
        <div className="lora-undo" role="status">
          <span>Removed {fileName(removed.item.name)}</span>
          <button type="button" onClick={undoRemove}><RotateCcw size={12} /> Undo</button>
        </div>
      ) : null}

      <div className="lora-foot">
        <button type="button" className="btn lora-add" onClick={() => setPicker({ swap: null })} disabled={loras.length >= cap}>
          <Plus size={14} /> Add LoRA
        </button>
        <span className="lora-count">{activeCount} active · {loras.length}/{cap}</span>
      </div>
    </div>
  );
}

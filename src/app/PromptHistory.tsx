import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Search, Star, X } from 'lucide-react';
import { cn } from './format';
import { Sheet } from './PhoneStudio';
import { haptic } from './phoneControls';
import { forgetPrompt, matchPrompt, pinPrompt, usePromptHistory, whenUsed, type PromptEntry } from './recentPrompts';

/* ---------------------------------------------------------------------------
   Recent prompts

   Out of sight until wanted: ↑ in an empty prompt, or the clock beside
   Negative, opens a small list above the composer. Typing searches it, the
   arrow keys move, Enter puts the prompt in the composer. A star keeps a
   prompt for good; × forgets one. On a phone the same list is a sheet.
--------------------------------------------------------------------------- */

type Row = { entry: PromptEntry; ranges: Array<[number, number]> };
type Section = { id: string; label: string; rows: Row[] };

const recentLimit = 60;

function sectionsFor(prompts: PromptEntry[], query: string): Section[] {
  if (query.trim()) {
    const hits = prompts.flatMap((entry) => {
      const match = matchPrompt(entry.text, query);
      return match ? [{ entry, ranges: match.ranges, score: match.score + (entry.pinned ? 1 : 0) }] : [];
    });
    // Better matches first; among equals, the one used last.
    hits.sort((a, b) => b.score - a.score || Date.parse(b.entry.at) - Date.parse(a.entry.at));
    return [{ id: 'results', label: '', rows: hits.slice(0, recentLimit) }];
  }
  const pinned = prompts.filter((entry) => entry.pinned).map((entry) => ({ entry, ranges: [] }));
  const recent = prompts.filter((entry) => !entry.pinned).slice(0, recentLimit).map((entry) => ({ entry, ranges: [] }));
  return [
    { id: 'pinned', label: 'Starred', rows: pinned },
    { id: 'recent', label: pinned.length ? 'Recent' : '', rows: recent }
  ].filter((section) => section.rows.length);
}

function Highlighted({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  if (!ranges.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end], index) => {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={index}>{text.slice(start, end)}</mark>);
    at = end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

function meta(entry: PromptEntry) {
  return [whenUsed(entry.at), entry.uses > 1 ? `${entry.uses}×` : ''].filter(Boolean).join(' · ');
}

/** Pin and forget, told plainly when the server says no. */
function useRowActions(onError: (message: string) => void) {
  const pin = (entry: PromptEntry) => pinPrompt(entry.text, !entry.pinned).catch((error) => onError(error instanceof Error ? error.message : 'Couldn’t save that'));
  const forget = (entry: PromptEntry) => forgetPrompt(entry.text).catch((error) => onError(error instanceof Error ? error.message : 'Couldn’t remove that prompt'));
  return { pin, forget };
}

/* ------------------------------------------------------------ Desktop */

export function PromptHistoryPopover({ open, onClose, onPick, hiddenSpace = false, onError }: {
  open: boolean;
  /** "escape" hands the keyboard back to the prompt; a click elsewhere leaves focus where it went. */
  onClose: (reason: 'escape' | 'outside') => void;
  onPick: (text: string) => void;
  hiddenSpace?: boolean;
  onError: (message: string) => void;
}) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="history"
          className="prompt-history"
          data-open-surface
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.985 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.99 }}
          transition={{ type: 'spring', duration: 0.28, bounce: 0 }}
        >
          <HistoryPanel onClose={onClose} onPick={onPick} hiddenSpace={hiddenSpace} onError={onError} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function HistoryPanel({ onClose, onPick, hiddenSpace, onError }: { onClose: (reason: 'escape' | 'outside') => void; onPick: (text: string) => void; hiddenSpace: boolean; onError: (message: string) => void }) {
  const { prompts, ready } = usePromptHistory(true);
  const [query, setQuery] = React.useState('');
  const sections = React.useMemo(() => sectionsFor(prompts, query), [prompts, query]);
  const flat = React.useMemo(() => sections.flatMap((section) => section.rows), [sections]);
  // Opening lands on the newest prompt, so ↑ then Enter is "the last one again".
  const firstRecent = sections.find((section) => section.id === 'recent')?.rows[0];
  const [cursor, setCursor] = React.useState(-1);
  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const id = React.useId();
  const { pin, forget } = useRowActions(onError);

  React.useEffect(() => { searchRef.current?.focus({ preventScroll: true }); }, []);
  React.useEffect(() => {
    if (query) { setCursor(flat.length ? 0 : -1); return; }
    setCursor((current) => (current >= 0 && current < flat.length ? current : firstRecent ? flat.indexOf(firstRecent) : flat.length ? 0 : -1));
  }, [query, flat, firstRecent]);
  React.useEffect(() => {
    if (cursor < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);
  // A click anywhere else closes it; the composer's own clock button toggles it instead.
  React.useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || panelRef.current?.contains(target) || target.closest('[data-history-trigger]')) return;
      onClose('outside');
    };
    window.addEventListener('pointerdown', onPointer, true);
    return () => window.removeEventListener('pointerdown', onPointer, true);
  }, [onClose]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose('escape');
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!flat.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setCursor((current) => (current < 0 ? 0 : (current + step + flat.length) % flat.length));
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      const row = flat[cursor] || flat[0];
      if (!row) return;
      event.preventDefault();
      onPick(row.entry.text);
      return;
    }
    // ⌘/Ctrl+S stars the highlighted prompt; ⌘/Ctrl+Backspace forgets it.
    const row = flat[cursor];
    if (row && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); pin(row.entry); }
    if (row && (event.metaKey || event.ctrlKey) && event.key === 'Backspace' && !query) { event.preventDefault(); forget(row.entry); }
  };

  let rowIndex = -1;
  return (
    <div ref={panelRef} className="prompt-history-panel" role="dialog" aria-label="Recent prompts" onKeyDown={onKeyDown}>
      <label className="model-menu-search">
        <Search size={14} aria-hidden="true" />
        <input
          ref={searchRef}
          className="is-framed"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={prompts.length ? `Search ${prompts.length === 1 ? '1 prompt' : `${prompts.length} prompts`}` : 'Recent prompts'}
          aria-label="Search recent prompts"
          aria-controls={`${id}-list`}
          aria-activedescendant={cursor >= 0 ? `${id}-row-${cursor}` : undefined}
          spellCheck={false}
          autoComplete="off"
        />
        {query ? <button type="button" className="model-menu-clear" aria-label="Clear search" onClick={() => { setQuery(''); searchRef.current?.focus(); }}><X size={12} /></button> : null}
      </label>
      <div ref={listRef} id={`${id}-list`} className="prompt-history-list" role="listbox" aria-label="Recent prompts">
        {sections.map((section) => (
          <div key={section.id} className="prompt-history-section" role="group" aria-label={section.label || undefined}>
            {section.label ? <div className="prompt-history-label">{section.label}</div> : null}
            {section.rows.map((row) => {
              rowIndex += 1;
              const index = rowIndex;
              return (
                <div key={`${section.id}:${row.entry.text}`} className={cn('prompt-history-row', index === cursor && 'is-cursor', row.entry.pinned && 'is-pinned')} onPointerMove={() => { if (cursor !== index) setCursor(index); }}>
                  <button type="button" role="option" id={`${id}-row-${index}`} data-row={index} aria-selected={index === cursor} className="prompt-history-use" tabIndex={-1} onClick={() => onPick(row.entry.text)}>
                    <span className="prompt-history-text"><Highlighted text={row.entry.text} ranges={row.ranges} /></span>
                    <span className="prompt-history-meta">{meta(row.entry)}</span>
                  </button>
                  <button type="button" className="prompt-history-icon is-pin" tabIndex={-1} aria-pressed={Boolean(row.entry.pinned)} aria-label={row.entry.pinned ? 'Unstar this prompt' : 'Star this prompt to keep it'} title={row.entry.pinned ? 'Unstar' : 'Star to keep'} onClick={() => pin(row.entry)}>
                    <Star size={13} fill={row.entry.pinned ? 'currentColor' : 'none'} />
                  </button>
                  <button type="button" className="prompt-history-icon is-forget" tabIndex={-1} aria-label="Remove this prompt" title="Remove" onClick={() => forget(row.entry)}>
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
        {!flat.length && ready ? (
          <p className="prompt-history-empty">
            {query.trim() ? <>No prompt matches “{query.trim()}”.</> : <>Prompts you generate with show up here.</>}
          </p>
        ) : null}
      </div>
      <footer className="prompt-history-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> choose</span>
        <span><kbd>↵</kbd> use</span>
        <span><kbd>esc</kbd> close</span>
        {hiddenSpace ? <em>From the gallery. Prompts from Hidden aren’t saved.</em> : null}
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------ Phone */

export function PromptHistorySheet({ open, onClose, onPick, onError }: { open: boolean; onClose: () => void; onPick: (text: string) => void; onError: (message: string) => void }) {
  const { prompts, ready } = usePromptHistory(open);
  const [query, setQuery] = React.useState('');
  React.useEffect(() => { if (!open) setQuery(''); }, [open]);
  const sections = React.useMemo(() => sectionsFor(prompts, query), [prompts, query]);
  const count = sections.reduce((sum, section) => sum + section.rows.length, 0);
  const { pin, forget } = useRowActions(onError);
  return (
    <Sheet open={open} onClose={onClose} title="Recent prompts" full className="phone-prompt-history">
      {prompts.length > 6 ? (
        <label className="phone-search">
          <Search size={17} aria-hidden="true" />
          <input className="is-framed" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${prompts.length} prompts`} aria-label="Search recent prompts" spellCheck={false} autoComplete="off" />
        </label>
      ) : null}
      {sections.map((section) => (
        <React.Fragment key={section.id}>
          {section.label ? <h3 className="phone-section">{section.label}</h3> : null}
          <div className="phone-group">
            {section.rows.map((row) => (
              <div key={row.entry.text} className="phone-row-wrap phone-history-row">
                <button type="button" className="phone-row" onClick={() => { haptic('tap'); onPick(row.entry.text); }}>
                  <span><span className="phone-history-text"><Highlighted text={row.entry.text} ranges={row.ranges} /></span><small>{meta(row.entry)}</small></span>
                </button>
                <button type="button" className={cn('phone-icon', row.entry.pinned && 'is-on')} aria-pressed={Boolean(row.entry.pinned)} aria-label={row.entry.pinned ? 'Unstar this prompt' : 'Star this prompt to keep it'} onClick={() => { haptic('tap'); pin(row.entry); }}>
                  <Star size={18} fill={row.entry.pinned ? 'currentColor' : 'none'} />
                </button>
                <button type="button" className="phone-icon" aria-label="Remove this prompt" onClick={() => forget(row.entry)}>
                  <X size={18} />
                </button>
              </div>
            ))}
          </div>
        </React.Fragment>
      ))}
      {!count && ready ? <p className="phone-empty">{query.trim() ? `No prompt matches “${query.trim()}”.` : 'Prompts you generate with show up here.'}</p> : null}
    </Sheet>
  );
}

import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Search, Star, X } from 'lucide-react';
import { cn } from './format';
import { Tip } from './components';
import { AnimatedNumber } from './AnimatedNumber';
import { emptySearch, searchActive, type GallerySearch } from './favorites';
import { haptic } from './phoneControls';
import { SearchMark } from './SearchMark';

/* ---------------------------------------------------------------------------
   Gallery search

   One slim field over the gallery: words look through prompts, models and
   LoRAs, the star shows only favourites. `/` or ⌘F opens it, the magnifier
   beside Controls too; Esc clears it and puts everything back. It stays up
   while it filters, so a narrowed gallery never passes for the whole one.
   The gallery is searched on the server; Hidden only in this page's memory.
--------------------------------------------------------------------------- */

// A dialog on top owns the keyboard (the viewer counts: it is a dialog too).
const OPEN_DIALOG = '[role="dialog"], [role="alertdialog"]';

export function useGallerySearchKeys(enabled: boolean, open: () => void) {
  const openRef = React.useRef(open);
  openRef.current = open;
  React.useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || document.querySelector(OPEN_DIALOG)) return;
      const findKey = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f';
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
      const slash = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !typing;
      if (!findKey && !slash) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openRef.current();
    };
    // Capture, so it runs before "typing anywhere goes to the prompt".
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [enabled]);
}

type SearchProps = {
  search: GallerySearch;
  setSearch: (next: GallerySearch) => void;
  /** How many match, when that is known. */
  count?: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  hiddenSpace?: boolean;
};

/** The magnifier beside Controls, lit while a search filters the gallery. */
export function GallerySearchButton({ search, open, setOpen }: Pick<SearchProps, 'search' | 'open' | 'setOpen'>) {
  const on = open || searchActive(search);
  return (
    <Tip content="Search the gallery (/)">
      <button
        type="button"
        className={cn('zen-control-button gallery-search-button', on && 'is-on')}
        aria-label="Search the gallery"
        aria-expanded={on}
        // The field keeps its focus, so this click toggles instead of racing the field's blur.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen(!open)}
      >
        <Search size={16} />
      </button>
    </Tip>
  );
}

export function GallerySearchBar({ search, setSearch, count, open, setOpen, hiddenSpace = false, islandsHeight = 0 }: SearchProps & {
  /** The activity pills own the top centre; the field waits under them while they show. */
  islandsHeight?: number;
}) {
  const reduced = useReducedMotion();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const active = searchActive(search);
  const shown = open || active;
  React.useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => { inputRef.current?.focus({ preventScroll: true }); inputRef.current?.select(); });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const close = () => { setSearch(emptySearch); setOpen(false); };
  return (
    <AnimatePresence>
      {shown ? (
        <motion.div
          key="gallery-search"
          className={cn('gallery-search', active && 'is-active', hiddenSpace && 'is-hidden-space')}
          role="search"
          data-open-surface
          style={{ '--islands-h': `${islandsHeight ? islandsHeight + 8 : 0}px` } as React.CSSProperties}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.97 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.97 }}
          transition={{ type: 'spring', duration: 0.34, bounce: 0.08 }}
        >
          <Search size={15} className="gallery-search-glyph" aria-hidden="true" />
          <input
            ref={inputRef}
            value={search.q}
            onChange={(event) => setSearch({ ...search, q: event.target.value.slice(0, 200) })}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); event.currentTarget.blur(); }
              // Enter keeps the results and hands the keyboard back to the gallery.
              if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
            }}
            onBlur={() => { if (!active) setOpen(false); }}
            placeholder={hiddenSpace ? 'Search Hidden' : 'Search prompts and models'}
            aria-label={hiddenSpace ? 'Search Hidden' : 'Search the gallery'}
            spellCheck={false}
            autoComplete="off"
            enterKeyHint="search"
          />
          {active && typeof count === 'number' ? (
            <span className="gallery-search-count" aria-live="polite" aria-label={`${count} ${count === 1 ? 'match' : 'matches'}`}>
              <AnimatedNumber value={count} />
            </span>
          ) : null}
          <Tip content={search.favorites ? 'Show everything' : 'Only favorites'}>
            <button
              type="button"
              className={cn('gallery-search-fav', search.favorites && 'is-on')}
              aria-pressed={search.favorites}
              aria-label="Only favorites"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setSearch({ ...search, favorites: !search.favorites })}
            >
              <Star size={14} fill={search.favorites ? 'currentColor' : 'none'} />
              <span>Favorites</span>
            </button>
          </Tip>
          <Tip content={active ? 'Clear search (Esc)' : 'Close (Esc)'}>
            <button type="button" className="gallery-search-close" aria-label={active ? 'Clear search' : 'Close search'} onMouseDown={(event) => event.preventDefault()} onClick={close}>
              <X size={15} />
            </button>
          </Tip>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** What an empty result says, and the one way back. */
export function SearchEmpty({ search, onClear, hiddenSpace = false }: { search: GallerySearch; onClear: () => void; hiddenSpace?: boolean }) {
  const words = search.q.trim();
  const onlyStars = search.favorites && !words;
  return (
    <section className="gallery">
      <div className="empty stage-empty search-empty" aria-live="polite">
        <div className="stage-mark"><SearchMark className="stage-layer" star={onlyStars} /></div>
        <div className="stage-copy">
          <h2>{onlyStars ? 'No favorites yet' : <>Nothing matches “{words}”{search.favorites ? ' in favorites' : ''}</>}</h2>
          <p>{onlyStars
            ? `Star an image${hiddenSpace ? ' in Hidden' : ''} and it shows up here.`
            : 'Search covers prompts, models and LoRAs. Try fewer words.'}</p>
          <div className="empty-actions">
            <button type="button" className="reconnect-btn primary" onClick={onClear}><X size={13} /> {onlyStars ? 'Show everything' : 'Clear search'}</button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ Phone */

/** Under the phone's top bar: the field, a Favourites pill and Cancel. */
export function PhoneSearchBar({ search, setSearch, open, setOpen, hiddenSpace = false }: Omit<SearchProps, 'count'>) {
  const shown = open || searchActive(search);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => { if (open) inputRef.current?.focus({ preventScroll: true }); }, [open]);
  if (!shown) return null;
  return (
    <div className="phone-searchbar" role="search">
      <label className="phone-search">
        <Search size={17} aria-hidden="true" />
        <input
          ref={inputRef}
          className="is-framed"
          value={search.q}
          onChange={(event) => setSearch({ ...search, q: event.target.value.slice(0, 200) })}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
          placeholder={hiddenSpace ? 'Search Hidden' : 'Search prompts and models'}
          aria-label={hiddenSpace ? 'Search Hidden' : 'Search the gallery'}
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="search"
        />
      </label>
      <button type="button" className={cn('phone-icon phone-search-fav', search.favorites && 'is-on')} aria-pressed={search.favorites} aria-label="Only favorites" onClick={() => { haptic('tap'); setSearch({ ...search, favorites: !search.favorites }); }}>
        <Star size={20} fill={search.favorites ? 'currentColor' : 'none'} />
      </button>
      <button type="button" className="phone-pill" onClick={() => { setSearch(emptySearch); setOpen(false); }}>Cancel</button>
    </div>
  );
}

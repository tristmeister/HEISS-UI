import { t } from '../i18n/core.js';
import { useLanguage } from '../i18n/react';
import React from 'react';
import { GridAutoplayButton } from './GridAutoplayButton';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowUp, Check, CheckCircle2, ChevronRight, Columns2, CircleStop, Dices, Download, Eye, EyeOff, History, ImagePlus, Info, LockKeyhole, MoreHorizontal, RefreshCw, Search, Share, SlidersHorizontal, Square, Star, Trash2, Wand2, X } from 'lucide-react';
import { cn, aspectIconStyle } from './format';
import { familyLabel, setupNote } from './components';
import { downloadUrl } from './GalleryTile';
import { canUpscaleItem, shortLeft, upscaledWithRun, upscaleLeftLine, upscaleTooltip, useUpscaleClock } from './useUpscale';
import { UpscaleArrow } from './UpscaleArrow';
import { ReferenceSlots } from './ReferenceMediaPicker';
import { haptic, HapticTarget } from './phoneControls';
import { Media } from './components';
import { useFocusTrap } from './useFocusTrap';
import { useHistoryDismiss } from './useHistoryDismiss';
import { progressLine, progressReading, RunLeft } from './GenerationProgress';
import { RestartEtaText } from './ComfyRestart';
import { estimatePhrase } from './useGenerationEstimate';
import type { GalleryItem, Profile, SavedSize } from './types';
import { LinkedSizeFields, MegapixelField, SizePreview, SizeTabs, sizeMenuModel, type SizeRow, type SizeTier } from './SizeMenu';
import { MEGAPIXEL, presetRatio, ratioName } from './sizing';
import type { ShowToast } from './toast';
import { PromptHistorySheet } from './PromptHistory';
import { PhoneSearchBar } from './GallerySearch';
import { StackRunsButton } from './StackRunsButton';
import { canStar, emptySearch, searchActive, type GallerySearch } from './favorites';
import { usePromptHistory } from './recentPrompts';

/* ---------------------------------------------------------------------------
   The phone studio

   A phone is a second screen for the computer that runs ComfyUI: it is for
   making, browsing and sharing images, not for looking after that computer.
   Everything here is thumb-first: one "Describe…" pill at the bottom opens a
   full-height create sheet, pickers are bottom sheets with 56px rows, tiles
   open on tap and show their actions on a long press, and the viewer has a
   labelled action bar. Advanced settings stay one link away.

   The state and logic are the studio's own (main.tsx); this file only lays
   them out for a phone. StudioView renders it in place of the desktop shells
   and keeps the shared overlays (viewer, dialogs, toasts).
--------------------------------------------------------------------------- */


/* ------------------------------------------------------------------ Sheet */

/**
 * A bottom sheet: grab handle, swipe down (or Back, or Escape, or a tap on the
 * dimmed page) to close, focus kept inside while open.
 */
export function Sheet({ open, onClose, title, children, footer, full = false, className, headerAction }: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  full?: boolean;
  className?: string;
  headerAction?: React.ReactNode;
}) {
  useLanguage();
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const drag = useDragControls();
  const reduced = useReducedMotion();
  useFocusTrap(panelRef, open);
  useHistoryDismiss(open, onClose);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // A sheet opened on top of this one closes first.
      const sheets = document.querySelectorAll('.phone-sheet');
      if (sheets[sheets.length - 1] !== panelRef.current) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open ? (
        <React.Fragment key="sheet">
          <motion.button
            type="button"
            className="phone-sheet-backdrop"
            aria-label={t("Close")}
            tabIndex={-1}
            onClick={onClose}
            // The colour fades, not opacity: Safari runs framer's opacity fades as
            // hardware animations and shows the wrong end state for a frame when
            // one finishes, so the whole page behind would flash.
            initial={{ backgroundColor: 'rgba(0, 0, 0, 0)' }}
            animate={{ backgroundColor: 'rgba(0, 0, 0, 0.55)' }}
            exit={{ backgroundColor: 'rgba(0, 0, 0, 0)' }}
            transition={{ duration: 0.2 }}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            tabIndex={-1}
            className={cn('phone-sheet', full && 'is-full', className)}
            initial={reduced ? { opacity: 0 } : { y: '100%' }}
            animate={reduced ? { opacity: 1 } : { y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            drag={reduced ? false : 'y'}
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_event, info) => { if (info.offset.y > 110 || info.velocity.y > 600) onClose(); }}
          >
            <div className="phone-sheet-grab" onPointerDown={(event) => drag.start(event)}>
              <div className="phone-sheet-handle" aria-hidden="true" />
              <header className="phone-sheet-head">
                <h2>{title}</h2>
                {headerAction}
                <button type="button" className="phone-icon" aria-label={t("Close")} onClick={onClose}><X size={20} /></button>
              </header>
            </div>
            <div className="phone-sheet-body">{children}</div>
            {footer ? <div className="phone-sheet-foot">{footer}</div> : null}
          </motion.div>
        </React.Fragment>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

/* ------------------------------------------------------------------ Share */

// The file is fetched when the actions open, so the share itself runs inside the
// tap: iOS only allows the share sheet straight from a user gesture.
const shareBlobs = new Map<string, Promise<Blob>>();

/** Web Share with files needs a secure page; over plain http on the LAN it is not there. */
export const canShareFiles = typeof navigator !== 'undefined' && typeof window !== 'undefined' && window.isSecureContext && 'share' in navigator;

export function prefetchShare(item: GalleryItem | null, includeVideo = false) {
  if (!item?.url || !canShareFiles) return;
  // Opening a video must not also fetch a second full copy into a share Blob.
  if (item.type === 'video' && !includeVideo) return;
  const url = downloadUrl(item);
  if (!shareBlobs.has(url)) shareBlobs.set(url, fetch(url).then((response) => response.ok ? response.blob() : Promise.reject(new Error("fetch failed"))));
}

function fileNameFor(item: GalleryItem, type = '') {
  const base = String(item.outputName || item.filename || 'heiss').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'heiss';
  if (/\.\w{2,4}$/.test(base)) return base;
  return `${base}.${type.includes('webp') ? 'webp' : type.includes('jpeg') ? 'jpg' : item.type === 'video' ? 'mp4' : 'png'}`;
}

/** Share where the phone can (Photos, Messages, AirDrop…), otherwise save the file. */
export async function shareItem(item: GalleryItem, showToast: ShowToast) {
  const url = downloadUrl(item);
  if (canShareFiles) {
    try {
      prefetchShare(item, true);
      const blob = await shareBlobs.get(url)!;
      const file = new File([blob], fileNameFor(item, blob.type), { type: blob.type || 'image/png' });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  const link = document.createElement('a');
  link.href = url;
  link.download = fileNameFor(item);
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (!canShareFiles) showToast(t("Saved to downloads"), 'success');
}

/** Several files: one share sheet where possible, otherwise one download after another. */
export async function shareItems(items: GalleryItem[], showToast: ShowToast) {
  const ready = items.filter((item) => item.status === 'done' && item.url);
  if (!ready.length) return;
  if (ready.length === 1) return shareItem(ready[0], showToast);
  if (canShareFiles) {
    try {
      ready.forEach((item) => prefetchShare(item, true));
      const files = await Promise.all(ready.map(async (item) => {
        const blob = await shareBlobs.get(downloadUrl(item))!;
        return new File([blob], fileNameFor(item, blob.type), { type: blob.type || 'image/png' });
      }));
      if (!navigator.canShare || navigator.canShare({ files })) {
        await navigator.share({ files });
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  for (const item of ready) {
    const link = document.createElement('a');
    link.href = downloadUrl(item);
    link.download = fileNameFor(item);
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Browsers drop downloads fired in one burst.
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  showToast(t("Saved {0} images to downloads", { "0": (ready.length) }), 'success');
}

/* ------------------------------------------------------------ Item actions */

export type PhoneItemActions = {
  showToast: ShowToast;
  smartUpscale: boolean;
  upscaleBusy: (item: GalleryItem) => boolean;
  upscale: (item: GalleryItem) => void;
  cancelUpscale: (item: GalleryItem) => void;
  reuse: (item: GalleryItem) => void;
  useAsReference?: (item: GalleryItem) => void;
  hide: (item: GalleryItem) => void;
  unhide: (item: GalleryItem) => void;
  remove: (item: GalleryItem) => void;
  star: (item: GalleryItem) => void;
};

function upscaleLabel(item: GalleryItem) {
  if (item.upscale?.status === 'running') return 'Stop upscale';
  if (item.upscale?.url) return item.upscaleActive ? 'Show original' : 'Show upscale';
  return 'Upscale';
}

/** The sheet's upscale row; a running upscale says how long is left under its label. Its own component, so the clock re-renders it alone. */
function UpscaleSheetRow({ item, actions, run }: { item: GalleryItem; actions: PhoneItemActions; run: (action: () => void) => void }) {
  useLanguage();
  const running = item.upscale?.status === 'running';
  const clock = useUpscaleClock(item);
  return (
    <button type="button" className="phone-row" disabled={actions.upscaleBusy(item)} onClick={() => run(() => (running ? actions.cancelUpscale(item) : actions.upscale(item)))}>
      {running ? <Square size={16} fill="currentColor" strokeWidth={0} /> : <UpscaleArrow size={20} />}
      <span>{upscaleLabel(item)}{running && clock.leftMs !== null ? <small>{upscaleLeftLine(item, clock.leftMs)}</small> : null}</span>
    </button>
  );
}

/** The viewer bar's upscale button: while running, its label is the time left (the stop square says what a tap does). */
function UpscaleBarButton({ item, actions }: { item: GalleryItem; actions: PhoneItemActions }) {
  useLanguage();
  const running = item.upscale?.status === 'running';
  const clock = useUpscaleClock(item);
  // The ring, as on a desktop tile: the learned time when there is one, else the step count, else a spinning arc.
  const stepRatio = item.upscale?.progress?.max ? Math.min(1, Math.max(0, item.upscale.progress.value / item.upscale.progress.max)) : 0;
  const ratio = clock.ratio ?? (clock.leftMs !== null ? 0 : stepRatio);
  const label = running
    ? clock.leftMs === null ? 'Stop' : clock.leftMs <= 1500 ? 'Almost' : shortLeft(clock.leftMs)
    : item.upscale?.url ? (item.upscaleActive ? 'Original' : 'Upscale') : 'Upscale';
  return (
    <button type="button" className={cn(item.upscaleActive && item.upscale?.url && 'is-on')} aria-label={running ? upscaleTooltip(item, clock.leftMs) : undefined} disabled={actions.upscaleBusy(item)} onClick={() => (running ? actions.cancelUpscale(item) : actions.upscale(item))}>
      <i className={cn('viewer-phone-upscale', running && 'is-running', running && !ratio && 'is-indeterminate', running && clock.ratio !== null && 'is-timed')}>
        {actions.upscaleBusy(item) ? <RefreshCw size={18} className="spin" /> : running ? <Square size={11} fill="currentColor" strokeWidth={0} /> : <UpscaleArrow size={19} />}
        {running ? (
          <svg className="viewer-phone-upscale-ring" viewBox="0 0 30 30" aria-hidden="true" focusable="false">
            <circle className="is-track" cx="15" cy="15" r="14" />
            <circle cx="15" cy="15" r="14" pathLength={100} strokeDasharray={ratio ? `${ratio * 100} 100` : '25 75'} />
          </svg>
        ) : null}
      </i>
      <span className={cn(running && clock.leftMs !== null && 'is-count')}>{label}</span>
    </button>
  );
}

/** What a long press on a tile offers, as one sheet of big labelled rows. */
export function ItemActionSheet({ item, onClose, actions, onSelect }: { item: GalleryItem | null; onClose: () => void; actions: PhoneItemActions; onSelect?: (item: GalleryItem) => void }) {
  useLanguage();
  React.useEffect(() => { prefetchShare(item); }, [item]);
  const done = item?.status === 'done' && Boolean(item?.url);
  const run = (action: () => void) => { onClose(); action(); };
  return (
    <Sheet open={Boolean(item)} onClose={onClose} title={item?.prompt ? truncate(item.prompt, 60) : t("Image")}>
      {item ? (
        <div className="phone-group">
          {done ? (
            <button type="button" className="phone-row" onClick={() => run(() => shareItem(item, actions.showToast))}>
              {canShareFiles ? <Share size={20} /> : <Download size={20} />}<span>{canShareFiles ? t("Share or save") : t("Save")}</span>
            </button>
          ) : null}
          {actions.smartUpscale && canUpscaleItem(item) ? <UpscaleSheetRow item={item} actions={actions} run={run} /> : null}
          {canStar(item) ? (
            <button type="button" className={cn('phone-row', item.favorite && 'is-starred')} onClick={() => run(() => { haptic('tap'); actions.star(item); })}>
              <Star size={20} fill={item.favorite ? 'currentColor' : 'none'} /><span>{item.favorite ? t("Unstar") : t("Star")}</span><HapticTarget />
            </button>
          ) : null}
          {item.prompt ? <button type="button" className="phone-row" onClick={() => run(() => actions.reuse(item))}><Wand2 size={20} /><span>{t("Use these settings")}</span></button> : null}
          {done && actions.useAsReference && item.type === 'image' && !item.vaultLocked && !item.library ? <button type="button" className="phone-row" onClick={() => run(() => actions.useAsReference!(item))}><ImagePlus size={20} /><span>{t("Use as reference")}</span></button> : null}
          {done && !item.library ? (
            item.privateVault
              ? <button type="button" className="phone-row" onClick={() => run(() => actions.unhide(item))}><Eye size={20} /><span>{t("Move to gallery")}</span></button>
              : <button type="button" className="phone-row" onClick={() => run(() => actions.hide(item))}><EyeOff size={20} /><span>{t("Move to Hidden")}</span></button>
          ) : null}
          {onSelect && (item.status === 'done' || item.status === 'error') ? <button type="button" className="phone-row" onClick={() => run(() => onSelect(item))}><CheckCircle2 size={20} /><span>{t("Select several")}<small>{t("Then save, hide or delete them together")}</small></span><HapticTarget /></button> : null}
          <button type="button" className="phone-row is-danger" onClick={() => run(() => { haptic('warning'); actions.remove(item); })}><Trash2 size={20} /><span>{t("Delete")}</span><HapticTarget /></button>
        </div>
      ) : null}
    </Sheet>
  );
}

/** The viewer's bottom bar on a phone: five big labelled actions and Info. */
export function PhoneViewerBar({ item, actions, showDetails, onToggleDetails, compareOpen, onToggleCompare }: { item: GalleryItem; actions: PhoneItemActions; showDetails: boolean; onToggleDetails: () => void; compareOpen: boolean; onToggleCompare: () => void }) {
  useLanguage();
  React.useEffect(() => { prefetchShare(item); }, [item]);
  const done = item.status === 'done' && Boolean(item.url);
  return (
    <nav className="viewer-phone-bar" aria-label={t("Image actions")}>
      {done ? <button type="button" onClick={() => shareItem(item, actions.showToast)}>{canShareFiles ? <Share size={21} /> : <Download size={21} />}<span>{canShareFiles ? t("Share") : t("Save")}</span></button> : null}
      {actions.smartUpscale && canUpscaleItem(item) ? <UpscaleBarButton item={item} actions={actions} /> : null}
      {item.upscale?.url && !upscaledWithRun(item) ? <button type="button" className={cn(compareOpen && 'is-on')} aria-pressed={compareOpen} onClick={() => { haptic('tap'); onToggleCompare(); }}><Columns2 size={21} /><span>{t("Compare")}</span><HapticTarget /></button> : null}
      {item.prompt ? <button type="button" onClick={() => actions.reuse(item)}><Wand2 size={21} /><span>{t("Reuse")}</span></button> : null}
      {canStar(item) ? (
        <button type="button" className={cn(item.favorite && 'is-starred')} aria-pressed={Boolean(item.favorite)} onClick={() => { haptic('tap'); actions.star(item); }}>
          <Star size={21} fill={item.favorite ? 'currentColor' : 'none'} /><span>{item.favorite ? t("Starred") : t("Star")}</span><HapticTarget />
        </button>
      ) : null}
      {done && !item.library ? (
        item.privateVault
          ? <button type="button" onClick={() => actions.unhide(item)}><Eye size={21} /><span>{t("Unhide")}</span></button>
          : <button type="button" onClick={() => actions.hide(item)}><EyeOff size={21} /><span>{t("Hide")}</span></button>
      ) : null}
      <button type="button" className="is-danger" onClick={() => { haptic('warning'); actions.remove(item); }}><Trash2 size={21} /><span>{t("Delete")}</span><HapticTarget /></button>
      {/* Info sits in the top corner, opposite Close, so the bar keeps room for actions. */}
      <button type="button" className={cn('viewer-phone-info', showDetails && 'is-on')} aria-pressed={showDetails} aria-label={t("Details")} onClick={onToggleDetails}><Info size={20} /></button>
    </nav>
  );
}

function truncate(text: string, length: number) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > length ? `${clean.slice(0, length - 1)}…` : clean;
}

/* ------------------------------------------------------------ The shell */

export function PhoneShell({ view, galleryBody, canUseNegativePrompt, comfyOffline, hiddenLocked, toggleHiddenSpace, createOpen, setCreateOpen, itemActions, actionsFor, setActionsFor, selection, setSelection }: {
  view: Record<string, any>;
  galleryBody: React.ReactNode;
  canUseNegativePrompt: boolean;
  comfyOffline: boolean;
  hiddenLocked: boolean;
  toggleHiddenSpace: () => void;
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
  itemActions: PhoneItemActions;
  actionsFor: GalleryItem | null;
  setActionsFor: (item: GalleryItem | null) => void;
  selection: Set<string> | null;
  setSelection: (selection: Set<string> | null) => void;
}) {
  useLanguage();
  const {
    prompt, currentProfile, hiddenSpace, hidden, runningCount, cancelQueue, comfyStatus, retryComfyStatus,
    galleryStageRef, onGalleryScroll, generate, generateDisabled, visibleGallery, openItem, active, deleteItems, hideItems, unhideItems, showToast
  } = view;
  const gallery = (visibleGallery || []) as GalleryItem[];
  const selecting = Boolean(selection);
  const selectedItems = selecting ? gallery.filter((item) => selection!.has(item.id)) : [];
  const selectable = gallery.filter((item) => item.status === 'done' || item.status === 'error');
  const endSelection = () => setSelection(null);

  // Progress of what is running, for the ring on the pill and its second line.
  const pending = gallery.filter((item) => item.status === 'pending');
  const readings = pending.map((item) => progressReading(item.progress));
  const withSteps = readings.flatMap((reading) => reading.kind === 'steps' ? [reading.ratio] : []);
  const progress = withSteps.length ? withSteps.reduce((sum, ratio) => sum + ratio, 0) / withSteps.length : 0;
  // The top bar names what is running: an upscale (on its own, or the end of a run) is not a generation.
  const upscalingCount = gallery.filter((item) => item.upscale?.status === 'running' || (item.status === 'pending' && item.progress?.upscaling)).length;
  const generatingCount = Math.max(0, runningCount - upscalingCount);
  const runningLabel = !upscalingCount
    ? generatingCount === 1 ? 'Generating 1 image' : `Generating ${generatingCount}`
    : !generatingCount
      ? upscalingCount === 1 ? 'Upscaling 1 image' : `Upscaling ${upscalingCount}`
      : `Generating ${generatingCount} · upscaling ${upscalingCount}`;
  const stepLine = pending.length === 1 ? progressLine(pending[0].progress) : withSteps.length ? `${Math.round(progress * 100)}%` : '';

  // A finished run shows itself: a small card slides up, tap to open.
  const [peek, setPeek] = React.useState<GalleryItem | null>(null);
  const pendingJobs = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    const nowPending = new Set(pending.map((item) => item.jobId || item.id));
    const landed = gallery.find((item) => item.status === 'done' && pendingJobs.current.has(item.jobId || item.id) && !nowPending.has(item.jobId || item.id));
    pendingJobs.current = nowPending;
    if (!landed) return;
    haptic('success');
    if (!createOpen && !active) setPeek(landed);
  }, [gallery]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!peek) return;
    const timer = window.setTimeout(() => setPeek(null), 5500);
    return () => window.clearTimeout(timer);
  }, [peek]);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const gallerySearch = (view.gallerySearch || emptySearch) as GallerySearch;
  const setGallerySearch = view.setGallerySearch as (next: GallerySearch) => void;
  const [searchOpen, setSearchOpen] = React.useState(false);
  const restarting = Boolean(comfyStatus?.restarting);
  const connected = Boolean(comfyStatus?.connected);
  const statusText = restarting ? t('ComfyUI is restarting') : comfyStatus?.busy ? t('ComfyUI is busy') : connected ? `${t('ComfyUI connected')}${comfyStatus?.device ? ` · ${comfyStatus.device}` : ''}` : comfyStatus?.checked ? t('ComfyUI is offline') : t('Checking ComfyUI…');
  const workflowName = currentProfile?.displayName || currentProfile?.label || 'Choose a model';
  const quickGo = Boolean(prompt.trim()) && !generateDisabled && !comfyOffline && !restarting;

  return (
    <>
      {selecting ? (
        <header className="phone-bar is-selecting">
          <button type="button" className="phone-icon" aria-label={t("Stop selecting")} onClick={endSelection}><X size={22} /></button>
          <div className="phone-title"><span>{selectedItems.length ? t("{0} selected", { "0": (selectedItems.length) }) : t("Select images")}</span></div>
          <button type="button" className="phone-pill" onClick={() => { haptic('tap'); setSelection(new Set(selectedItems.length === selectable.length ? [] : selectable.map((item) => item.id))); }}>
            {selectedItems.length === selectable.length && selectable.length ? t("None") : t("All")}
            <HapticTarget />
          </button>
        </header>
      ) : null}
      <header className={cn('phone-bar', selecting && 'is-behind')}>
        <button type="button" className={cn('phone-status', restarting ? 'is-restarting' : connected ? 'is-connected' : comfyStatus?.checked ? 'is-offline' : 'is-checking')} aria-label={t("{0}. Check again", { "0": (statusText) })} onClick={retryComfyStatus}>
          <span />
        </button>
        <div className="phone-title">
          {hiddenSpace ? <><button type="button" className="phone-icon" aria-label={t("Back to the gallery")} onClick={toggleHiddenSpace}><ArrowLeft size={20} /></button><LockKeyhole size={16} className="phone-ember" /><span>{t("Hidden")}</span></> : <span>{t("Gallery")}</span>}
        </div>
        {!hiddenLocked ? (
          <button type="button" className={cn('phone-icon', searchActive(gallerySearch) && 'is-on')} aria-label={t("Search")} aria-expanded={searchOpen || searchActive(gallerySearch)} onClick={() => { if (searchOpen || searchActive(gallerySearch)) { setGallerySearch(emptySearch); setSearchOpen(false); } else setSearchOpen(true); }}><Search size={21} /></button>
        ) : null}
        {!hiddenLocked && gallery.some((item) => item.type === 'video') ? (
          <GridAutoplayButton phone />
        ) : null}
        {!hiddenLocked && !selecting ? (
          <StackRunsButton phone on={Boolean(view.prefs.stackRuns)} disabled={searchActive(gallerySearch)} onToggle={() => { haptic('tap'); view.setPrefs({ stackRuns: !view.prefs.stackRuns }); }} />
        ) : null}
        {!hiddenSpace ? (
          <button type="button" className={cn('phone-icon', hidden.enabled && hidden.unlocked && 'has-dot')} aria-label={hidden.enabled && hidden.unlocked ? t("Open Hidden, unlocked") : t("Open Hidden")} onClick={toggleHiddenSpace}><LockKeyhole size={20} /></button>
        ) : hidden.unlocked ? (
          <button type="button" className="phone-pill" onClick={() => hidden.lock()}><LockKeyhole size={15} />{t("Lock")}</button>
        ) : null}
        <button type="button" className="phone-icon" aria-label={t("More")} onClick={() => setMoreOpen(true)}><MoreHorizontal size={22} /></button>
      </header>
      {!hiddenLocked && !selecting ? <PhoneSearchBar search={gallerySearch} setSearch={setGallerySearch} open={searchOpen} setOpen={setSearchOpen} hiddenSpace={Boolean(hiddenSpace)} /> : null}

      {runningCount ? (
        <div className="phone-running" role="status">
          <RefreshCw size={14} className="spin" />
          <span>{runningLabel}</span>
          <button type="button" className="phone-pill" onClick={cancelQueue}><CircleStop size={15} />{t("Stop all")}</button>
        </div>
      ) : null}

      <main ref={galleryStageRef} className="phone-gallery" onScroll={onGalleryScroll}>
        {galleryBody}
      </main>

      {selecting ? (
        <nav className="phone-select-bar" aria-label={t("Selected images")}>
          <button type="button" disabled={!selectedItems.length} onClick={() => shareItems(selectedItems, showToast)}>{canShareFiles ? <Share size={21} /> : <Download size={21} />}<span>{canShareFiles ? t("Share") : t("Save")}</span></button>
          {hiddenSpace
            ? <button type="button" disabled={!selectedItems.length} onClick={() => { unhideItems(selectedItems.filter((item) => item.status === 'done')); endSelection(); }}><Eye size={21} /><span>{t("Unhide")}</span></button>
            : <button type="button" disabled={!selectedItems.length} onClick={() => { hideItems(selectedItems.filter((item) => item.status === 'done')); endSelection(); }}><EyeOff size={21} /><span>{t("Hide")}</span></button>}
          <button type="button" className="is-danger" disabled={!selectedItems.length} onClick={async () => { haptic('warning'); await deleteItems(selectedItems); endSelection(); }}><Trash2 size={21} /><span>{t("Delete")}</span><HapticTarget /></button>
        </nav>
      ) : null}

      {!hiddenLocked && !selecting ? (
        <div className={cn('phone-create-pill', hiddenSpace && 'is-hidden')}>
          <button type="button" className="phone-create-open" onClick={() => setCreateOpen(true)}>
            <strong className={cn(!prompt.trim() && 'is-placeholder')}>{prompt.trim() ? truncate(prompt, 90) : view.referenceInpaint?.mask ? t("Describe what the painted part becomes…") : hiddenSpace ? t("Describe what to make, privately…") : t("Describe what to make…")}</strong>
            <small>{stepLine ? <span className="phone-step-line">{pending.length > 1 ? t("Generating {0} · ", { "0": (pending.length) }) : t("Generating · ")}{stepLine}{pending.length === 1 && pending[0].progress?.endsAt ? <> · <RunLeft progress={pending[0].progress} /></> : null}</span> : workflowName}</small>
          </button>
          <button
            type="button"
            className={cn('phone-go', pending.length > 0 && 'is-working')}
            style={{ '--progress': progress } as React.CSSProperties}
            aria-label={quickGo ? t("Generate") : t("Open the composer")}
            onClick={() => { haptic('tap'); if (quickGo) generate(); else setCreateOpen(true); }}
          >
            {restarting ? <RefreshCw size={20} className="spin" /> : <ArrowUp size={22} strokeWidth={2.4} />}
            <HapticTarget />
          </button>
        </div>
      ) : null}

      <AnimatePresence>
        {peek && !selecting ? (
          <motion.button
            key={peek.id}
            type="button"
            className="phone-peek"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            onClick={() => { setPeek(null); openItem(peek); }}
            aria-label={t("Image ready. Open it")}
          >
            <span className="phone-peek-thumb"><Media item={peek} muted /></span>
            <span className="phone-peek-text"><strong>{t("Ready")}</strong><small>{t("Tap to open")}</small></span>
            <ChevronRight size={18} />
          </motion.button>
        ) : null}
      </AnimatePresence>

      <CreateSheet view={view} open={createOpen} onClose={() => setCreateOpen(false)} canUseNegativePrompt={canUseNegativePrompt} comfyOffline={comfyOffline} />
      <MoreSheet view={view} open={moreOpen} onClose={() => setMoreOpen(false)} statusText={statusText} />
      <ItemActionSheet item={actionsFor} onClose={() => setActionsFor(null)} actions={itemActions} onSelect={(item) => { haptic('press'); setSelection(new Set([item.id])); }} />
    </>
  );
}

/* ------------------------------------------------------------ Create */

/**
 * A slider range worth having. A workflow's own limit is usually ComfyUI's
 * technical maximum (10000), which makes the slider useless; the range here
 * is built around the workflow's default instead: a turbo model at 4 steps
 * gets 1-24, one at 20 gets 1-60. It still reaches whatever is set now, and
 * never goes past the workflow's real limit.
 */
function practicalStepRange(profile: Profile | null | undefined, meta: { min?: number; max?: number; default?: number } | undefined, current: number) {
  const hardMin = Math.max(1, Number(meta?.min || 1));
  const hardMax = Math.max(hardMin, Number(meta?.max || 10000));
  const recommended = Number(profile?.defaults?.steps || meta?.default || 0);
  const base = recommended || 20;
  const practical = Math.min(100, Math.max(12, base * 3, base + 20));
  const max = Math.min(hardMax, Math.max(practical, Number(current) || 0));
  return { min: hardMin, max, recommended: recommended && recommended >= hardMin && recommended <= hardMax ? recommended : 0 };
}

function CreateSheet({ view, open, onClose, canUseNegativePrompt, comfyOffline }: { view: Record<string, any>; open: boolean; onClose: () => void; canUseNegativePrompt: boolean; comfyOffline: boolean }) {
  useLanguage();
  const {
    prompt, setPrompt, promptLimit, clampText, negative, setNegative, negativeLimit, currentProfile, hiddenSpace,
    aspectOptions, aspectPickerValue, aspectValue, aspectLocked, defaultAspectSize, mode, count, countMeta, setCount, steps, stepsMeta, setSteps,
    referenceInputs, referenceInpaint, referenceRole, referenceAssets, selectReferenceAsset, removeReferenceAsset, confirmAction, showToast,
    generate, generateDisabled, generateDisabledReason, comfyStatus, retryComfyStatus, comfyRetrying, seed, setSeed, loraActiveCount, phoneAdvancedControls, generationEstimate,
    customSize, sizeTier, sizeMax, customLimits, savedSizes, sizeArea, sizeTiers
  } = view;
  // Several references: Edit and Ref say what happens to all of them, not only the first.
  const many = (referenceAssets || []).length > 1;
  const [sheet, setSheet] = React.useState<'' | 'workflow' | 'size' | 'advanced'>('');
  const [showNegative, setShowNegative] = React.useState(Boolean(negative));
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const { prompts: recentPrompts } = usePromptHistory(open);
  const restarting = Boolean(comfyStatus?.restarting);
  const variations = mode === 'image' && currentProfile?.capabilities?.variations !== false;
  const maxCount = Math.max(1, Math.min(4, Number(countMeta?.max || 4)));
  const { min: stepMin, max: stepMax, recommended: stepDefault } = practicalStepRange(currentProfile, stepsMeta, steps);
  // The size row reads like the desktop's size button: the shape, its name, the size it makes.
  const tier: SizeTier = customSize ? 'custom' : sizeTier || 'none';
  const size = sizeMenuModel({ value: aspectPickerValue, options: aspectOptions || [], currentSize: aspectValue, defaultSize: defaultAspectSize, tier, native: currentProfile?.native, sizeMax, limits: customLimits, savedSizes, targetArea: sizeArea || 0, offerTwoK: Boolean(sizeTiers?.includes('2k')) });
  // A long run says so before it starts; a quick one needs no warning.
  const estimate = generationEstimate?.ms && generationEstimate.ms >= 45_000 ? `Takes ${estimatePhrase(generationEstimate)}.` : '';
  const reason = restarting ? <>{t("ComfyUI is restarting.")}{" "}<RestartEtaText fallback="Back in a few seconds." /></> : comfyOffline ? 'ComfyUI is offline.' : !prompt.trim() ? '' : generateDisabled ? generateDisabledReason : estimate;

  const go = () => {
    haptic('tap');
    if (comfyOffline) { retryComfyStatus(); return; }
    if (restarting) return;
    // generate() explains anything missing; only close when it can actually run.
    const ready = prompt.trim() && !generateDisabled;
    generate();
    if (ready) onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      full
      className="phone-create"
      title={hiddenSpace ? <span className="phone-title-inline"><LockKeyhole size={16} className="phone-ember" />{t("Create in Hidden")}</span> : t("Create")}
      footer={
        <>
          {reason ? <p className="phone-reason">{reason}</p> : null}
          <button
            type="button"
            className={cn('phone-generate', restarting && 'is-restarting', comfyOffline && !restarting && 'is-offline')}
            aria-disabled={restarting || (!comfyOffline && (!prompt.trim() || generateDisabled)) || undefined}
            onClick={go}
          >
            {restarting ? <><RefreshCw size={18} className="spin" />{t("Restarting…")}</>
              : comfyOffline ? <><RefreshCw size={18} className={cn(comfyRetrying && 'spin')} /> {comfyRetrying ? t("Checking…") : t("Check again")}</>
              : <><ArrowUp size={20} strokeWidth={2.4} /> {mode === 'image' && count > 1 ? t("Generate {0}", { "0": (count) }) : t("Generate")}</>}
            <HapticTarget />
          </button>
        </>
      }
    >
      <div className="phone-compose">
        <ReferenceSlots
          inputs={referenceInputs || []}
          inpaint={referenceInpaint}
          role={referenceRole}
          selected={referenceAssets || []}
          onSelect={selectReferenceAsset}
          onRemove={removeReferenceAsset}
          confirmDelete={(asset) => confirmAction({ title: t("Delete {0}?", { "0": (asset.name) }), description: t("It’s removed from uploads."), action: t("Delete"), destructive: true })}
          onError={(message) => showToast(message, 'error')}
        />
        {/* Edit or Reference, in plain sight: on a phone there's no hover to open the chip's menu, and no tooltip to say what each does. */}
        <AnimatePresence initial={false}>
          {referenceRole ? (
            <motion.div key="role" className="phone-ref-role" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}>
              <div className={cn('ref-menu-role', referenceRole.value === 'reference' && 'is-ref', referenceRole.locked && 'is-locked')} role="radiogroup" aria-label={t("What this image is")}>
                <i aria-hidden="true" />
                {(['edit', 'reference'] as const).map((value) => (
                  // A painted mask settles it as Edit: Reference stays, unavailable, and the line says why.
                  <button key={value} type="button" role="radio" aria-checked={referenceRole.value === value} aria-disabled={(referenceRole.locked && value === 'reference') || undefined} className={cn(referenceRole.value === value && 'is-active')} onClick={() => { if (referenceRole.locked && value === 'reference') { haptic('warning'); return; } haptic('tap'); referenceRole.onChange(value); }}>
                    {value === 'edit' ? t("Edit") : t("Reference")}<HapticTarget />
                  </button>
                ))}
              </div>
              <small key={`${referenceRole.value}:${many}:${Boolean(referenceRole.locked)}`}>{referenceRole.locked ? t("The painted part changes this picture. Clear the paint to use it as a reference")
                : referenceRole.value === 'edit'
                ? many ? t("Changes the first picture, at its size. The others are what it can draw from") : t("Changes this picture, at its size and framing")
                : many ? t("They all guide a new picture, at the size you pick") : t("Guides a new picture, at the size you pick")}</small>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <textarea
          aria-label={hiddenSpace ? t("Prompt (Hidden)") : t("Prompt")}
          value={prompt}
          placeholder={referenceInpaint?.mask ? t("Describe what the painted part becomes…") : hiddenSpace ? t("Describe what to make, privately…") : t("Describe what to make…")}
          onChange={(event) => setPrompt(clampText(event.target.value, promptLimit))}
          rows={4}
          autoFocus={!prompt.trim()}
        />
        {recentPrompts.length ? (
          <button type="button" className="phone-compose-recent" onClick={() => { haptic('tap'); setHistoryOpen(true); }}>
            <History size={15} />{t("Recent")}</button>
        ) : null}
      </div>
      <PromptHistorySheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onPick={(text) => { setPrompt(clampText(text, promptLimit)); setHistoryOpen(false); }}
        onError={(message) => showToast(message, 'error')}
      />

      {canUseNegativePrompt ? (
        showNegative ? (
          <label className="phone-field">
            <span>{t("Negative prompt")}</span>
            <textarea value={negative} rows={2} placeholder={t("What to avoid…")} onChange={(event) => setNegative(clampText(event.target.value, negativeLimit))} />
          </label>
        ) : (
          <button type="button" className="phone-link" onClick={() => setShowNegative(true)}>{t("+ Negative prompt")}</button>
        )
      ) : null}

      {String(seed || '').trim() ? (
        <button type="button" className="phone-row phone-seed" onClick={() => setSeed('')}>
          <Dices size={20} /><span>{t("Seed")}{" "}{String(seed).trim()}{t("is fixed")}<small>{t("Tap for a random seed")}</small></span>
        </button>
      ) : null}

      <div className="phone-group">
        <button type="button" className="phone-row" onClick={() => setSheet('workflow')}>
          <SlidersHorizontal size={20} />
          <span>{currentProfile?.displayName || currentProfile?.label || t("Choose a model")}<small>{currentProfile ? familyLabel(currentProfile) : t("Model")}</small></span>
          <ChevronRight size={18} className="phone-row-end" />
        </button>
        {(aspectOptions || []).length && !aspectLocked ? (
          <button type="button" className="phone-row" onClick={() => setSheet('size')}>
            {/* The real shape, tagged 2K or C like the desktop's size button. */}
            <span className="aspect-shape-slot phone-size-icon">
              <span className="aspect-shape" style={aspectIconStyle({ label: '', value: '', w: size.shown.width, h: size.shown.height })} />
              {size.badge ? <b className="aspect-upscale-badge" aria-hidden="true">{size.badge}</b> : null}
            </span>
            <span>{size.captionFor(null)}<small>{size.shown.width} × {size.shown.height}</small></span>
            <ChevronRight size={18} className="phone-row-end" />
          </button>
        ) : null}
      </div>

      {variations && maxCount > 1 ? (
        <div className="phone-control">
          <span className="phone-control-label">{t("Images")}</span>
          <div className="phone-seg" role="radiogroup" aria-label={t("Images")}>
            {Array.from({ length: maxCount }, (_, index) => index + 1).map((value) => (
              <button key={value} type="button" role="radio" aria-checked={count === value} className={cn(count === value && 'active')} onClick={() => setCount(value)}>{value}</button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="phone-control">
        <span className="phone-control-label">{t("Steps")}{" "}<b>{steps}</b></span>
        <input className="phone-slider" type="range" min={stepMin} max={stepMax} step={1} value={steps} aria-label={t("Steps")} onChange={(event) => setSteps(Number(event.target.value))} />
        <span className="phone-control-hint"><span>{t("Faster")}</span>{stepDefault ? <button type="button" className="phone-step-default" onClick={() => setSteps(stepDefault)} disabled={steps === stepDefault}>{t("Recommended")}{" "}{stepDefault}</button> : null}<span>{t("More detail")}</span></span>
      </div>

      <button type="button" className="phone-link is-strong" onClick={() => setSheet('advanced')}>{t("Advanced settings")}{loraActiveCount ? t(" · {0} LoRA{1}", { "0": (loraActiveCount), "1": (loraActiveCount === 1 ? t("") : t("s")) }) : ''} <ChevronRight size={16} />
      </button>

      <WorkflowSheet view={view} open={sheet === 'workflow'} onClose={() => setSheet('')} />
      <SizeSheet view={view} open={sheet === 'size'} onClose={() => setSheet('')} />
      <Sheet open={sheet === 'advanced'} onClose={() => setSheet('')} title={t("Advanced")} full className="phone-advanced">
        {phoneAdvancedControls}
      </Sheet>
    </Sheet>
  );
}

function WorkflowSheet({ view, open, onClose }: { view: Record<string, any>; open: boolean; onClose: () => void }) {
  useLanguage();
  const { modelProfiles, model, pickModel, modelMenu } = view as { modelProfiles: Profile[]; model: string; pickModel: (id: string) => void; modelMenu?: { favorites: string[]; recents: string[]; toggleFavorite: (id: string) => void } };
  const [query, setQuery] = React.useState('');
  React.useEffect(() => { if (!open) setQuery(''); }, [open]);
  const profiles = modelProfiles || [];
  const favorites = new Set(modelMenu?.favorites || []);
  const needle = query.trim().toLowerCase();
  const matches = (profile: Profile) => !needle || `${profile.displayName || ''} ${profile.label || ''} ${familyLabel(profile)}`.toLowerCase().includes(needle);
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const starred = profiles.filter((profile) => favorites.has(profile.id) && matches(profile));
  const recent = needle ? [] : (modelMenu?.recents || []).filter((id) => !favorites.has(id)).map((id) => byId.get(id)).filter((profile): profile is Profile => Boolean(profile)).slice(0, 4);
  const shown = new Set([...starred, ...recent].map((profile) => profile.id));
  const rest = profiles.filter((profile) => !shown.has(profile.id) && matches(profile));
  const row = (profile: Profile) => (
    <div key={profile.id} className="phone-row-wrap">
      <button type="button" className={cn('phone-row', profile.id === model && 'is-current')} onClick={() => { pickModel(profile.id); onClose(); }}>
        <span>{profile.displayName || profile.label}<small className={cn(setupNote(profile) && 'is-setup')}>{setupNote(profile) || familyLabel(profile)}</small></span>
        {profile.id === model ? <Check size={18} className="phone-row-end" /> : null}
      </button>
      {modelMenu ? (
        <button type="button" className={cn('phone-icon', favorites.has(profile.id) && 'is-on')} aria-pressed={favorites.has(profile.id)} aria-label={favorites.has(profile.id) ? t("Remove from favorites") : t("Add to favorites")} onClick={() => modelMenu.toggleFavorite(profile.id)}>
          <Star size={18} fill={favorites.has(profile.id) ? 'currentColor' : 'none'} />
        </button>
      ) : null}
    </div>
  );
  return (
    <Sheet open={open} onClose={onClose} title={t("Model")} full>
      {profiles.length > 8 ? (
        <label className="phone-search">
          <Search size={17} aria-hidden="true" />
          <input className="is-framed" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search {0} models", { "0": (profiles.length) })} aria-label={t("Search models")} spellCheck={false} autoComplete="off" />
        </label>
      ) : null}
      {!profiles.length ? <p className="phone-empty">{(view.comfyStatus?.connected) ? t("No models yet. Get one on the computer running HEISS UI.") : t("ComfyUI is offline. Models show up when it’s back.")}</p> : null}
      {starred.length ? <><h3 className="phone-section">{t("Favorites")}</h3><div className="phone-group">{starred.map(row)}</div></> : null}
      {recent.length ? <><h3 className="phone-section">{t("Recent")}</h3><div className="phone-group">{recent.map(row)}</div></> : null}
      {rest.some((profile) => !profile.id.startsWith('custom:')) ? <><h3 className="phone-section">{starred.length || recent.length ? t("All models") : ''}</h3><div className="phone-group">{rest.filter((profile) => !profile.id.startsWith('custom:')).map(row)}</div></> : null}
      {rest.some((profile) => profile.id.startsWith('custom:')) ? <><h3 className="phone-section">{t("Your workflows")}</h3><div className="phone-group">{rest.filter((profile) => profile.id.startsWith('custom:')).map(row)}</div></> : null}
      {needle && !starred.length && !rest.length ? <p className="phone-empty">{t("Nothing matches “")}{query.trim()}”.</p> : null}
    </Sheet>
  );
}

/**
 * The size menu as a sheet: the frame the picture will fill on a stage at the
 * top (it stays in view while the shapes scroll), Default · 2K · Custom,
 * Custom's linked width and height, the shapes, and the sizes you saved.
 *
 * There is no hover on a phone, so a finger resting on a row shows its frame
 * on the stage, and the saved sizes' Rename and Remove wait behind Edit
 * rather than hiding under a pointer. Picking from Default or 2K closes the
 * sheet, as the desktop menu closes; in Custom a shape keeps the area.
 */
function SizeSheet({ view, open, onClose }: { view: Record<string, any>; open: boolean; onClose: () => void }) {
  useLanguage();
  const {
    aspectOptions, aspectPickerValue, aspectValue, defaultAspectSize, applyAspect, mode, currentProfile, customSize, sizeTier, sizeMax, customLimits,
    chooseSizeTier, applyCustomRatio, setCustomDimensions, savedSizes, saveCustomSize, renameSavedSize, removeSavedSize, pickSavedSize,
    sizeTiers, sizeArea, megapixelControl
  } = view;
  const saved = (savedSizes || []) as SavedSize[];
  const tier: SizeTier = customSize ? 'custom' : sizeTier || 'none';
  const tiers: SizeTier[] = sizeTiers || (mode === 'image' ? ['none', '2k', 'custom'] : ['none', 'custom']);
  const model = sizeMenuModel({ value: aspectPickerValue, options: aspectOptions || [], currentSize: aspectValue, defaultSize: defaultAspectSize, tier, native: currentProfile?.native, sizeMax, limits: customLimits, savedSizes: saved, targetArea: sizeArea || 0, offerTwoK: tiers.includes('2k') });
  const { custom, picked, shown, rows, savedMatch, ownSize, isActive, savedRow, captionFor, note } = model;

  // The row under a finger: shown on the stage after a beat, so a scroll that starts on a row doesn't flick the frame.
  const [pressed, setPressed] = React.useState<SizeRow | null>(null);
  const pressTimer = React.useRef(0);
  const press = (row: SizeRow | null) => {
    window.clearTimeout(pressTimer.current);
    if (row) pressTimer.current = window.setTimeout(() => setPressed(row), 90);
    else setPressed(null);
  };
  React.useEffect(() => () => window.clearTimeout(pressTimer.current), []);
  const [editing, setEditing] = React.useState(false);
  React.useEffect(() => { if (!open) { press(null); setEditing(false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (!saved.length) setEditing(false); }, [saved.length]);

  const pressHandlers = (row: SizeRow) => ({
    onPointerDown: () => press(row),
    onPointerLeave: () => press(null),
    onPointerCancel: () => press(null)
  });
  const pick = (row: SizeRow) => {
    press(null);
    haptic('tap');
    if (custom) { applyCustomRatio(presetRatio(row.shape)); return; }
    applyAspect(row.value);
    onClose();
  };
  const pickSaved = (item: SavedSize) => {
    press(null);
    haptic('tap');
    pickSavedSize(item);
    if (!custom) onClose();
  };

  const stage = pressed ? pressed.size : shown;
  return (
    <Sheet open={open} onClose={onClose} title={t("Size")} className="phone-size">
      <div className="phone-size-stage">
        <SizePreview className="is-stage" size={stage} label={captionFor(pressed)} sub={`${stage.width} × ${stage.height}`} accent={!pressed && (tier !== 'none' || sizeArea > 0)} inset={18} />
      </div>
      <div className="phone-size-top">
        <SizeTabs tiers={tiers} value={tier} onChange={(next) => { haptic('tap'); chooseSizeTier(next); }} />
        <AnimatePresence initial={false}>
          {custom && customLimits ? (
            <motion.div key="custom" className="size-custom" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}>
              <LinkedSizeFields size={picked} limits={customLimits} onChange={setCustomDimensions} onSave={ownSize || savedMatch ? () => { haptic('success'); saveCustomSize(); } : undefined} saved={Boolean(savedMatch)} />
            </motion.div>
          ) : null}
        </AnimatePresence>
        {note ? <p className="phone-control-note">{note}</p> : null}
      </div>
      <div className="phone-group phone-size-list" role="listbox" aria-label={custom ? t("Shape, at this size") : t("Shape")}>
        {rows.map((row) => (
          <button key={row.key} type="button" role="option" aria-selected={isActive(row)} className={cn('phone-row phone-size-row', isActive(row) && 'is-current')} {...pressHandlers(row)} onClick={() => pick(row)}>
            <span className="phone-size-shape"><span className="aspect-shape" style={aspectIconStyle(row.shape)} /></span>
            <span>{row.label}{row.small ? <small>{row.small}</small> : null}</span>
            <em>{row.size.width}×{row.size.height}</em>
          </button>
        ))}
      </div>
      {/* Under the shapes, as on the desktop: how big they're all drawn. */}
      {megapixelControl ? <div className="phone-size-mp"><MegapixelField current={(shown.width * shown.height) / MEGAPIXEL} control={megapixelControl} custom={custom} /></div> : null}
      {saved.length ? (
        <>
          <div className="phone-size-saved-head">
            <h3 className="phone-section">{t("Saved")}</h3>
            <button type="button" className={cn('phone-size-edit', editing && 'is-on')} aria-pressed={editing} onClick={() => { haptic('tap'); setEditing((value) => !value); }}>{editing ? t("Done") : t("Edit")}<HapticTarget /></button>
          </div>
          <div className={cn('phone-group phone-size-list', editing && 'is-editing')} role="listbox" aria-label={t("Saved sizes")}>
            <AnimatePresence initial={false}>
              {saved.map((item) => (
                <PhoneSavedSize
                  key={item.id}
                  saved={item}
                  active={savedMatch?.id === item.id}
                  editing={editing}
                  pressHandlers={pressHandlers(savedRow(item))}
                  onPick={() => pickSaved(item)}
                  onRename={(name) => renameSavedSize(item.id, name)}
                  onRemove={() => { haptic('warning'); press(null); removeSavedSize(item.id); }}
                />
              ))}
            </AnimatePresence>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}

/**
 * A saved size: a row like the shapes, its name with its ratio under it.
 * Under Edit the name turns into a field where it stands (Enter or leaving
 * keeps it, Escape puts it back) and Remove slides in beside the size, which
 * steps aside for it; Undo is on the toast. One row throughout, so going in
 * and out of Edit glides instead of swapping.
 */
function PhoneSavedSize({ saved, active, editing, pressHandlers, onPick, onRename, onRemove }: {
  saved: SavedSize;
  active: boolean;
  editing: boolean;
  pressHandlers: React.HTMLAttributes<HTMLElement>;
  onPick: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  useLanguage();
  const [draft, setDraft] = React.useState(saved.name);
  React.useEffect(() => { setDraft(saved.name); }, [saved.name, editing]);
  // Escape leaves the field without keeping what was typed.
  const reverting = React.useRef(false);
  const keep = (typed: string) => {
    const name = typed.trim();
    if (reverting.current || !name || name === saved.name) { reverting.current = false; setDraft(saved.name); return; }
    onRename(name);
  };
  const ratio = ratioName(saved.width, saved.height);
  return (
    <motion.div
      className="phone-size-saved"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className={cn('phone-row phone-size-row is-saved', active && 'is-current', editing && 'is-editing')} {...(editing ? {} : pressHandlers)}>
        {editing ? null : <button type="button" className="phone-size-hit" role="option" aria-selected={active} aria-label={`${saved.name}, ${ratio}, ${saved.width} × ${saved.height}`} onClick={onPick} />}
        <span className="phone-size-shape" aria-hidden="true"><span className="aspect-shape" style={aspectIconStyle({ label: ratio, value: '', w: saved.width, h: saved.height })} /></span>
        <span className="phone-size-text" aria-hidden={!editing || undefined}>
          <input
            className="phone-size-name"
            data-own-escape
            value={draft}
            readOnly={!editing}
            tabIndex={editing ? 0 : -1}
            maxLength={32}
            enterKeyHint="done"
            aria-label={t("Name of {0}", { "0": (saved.name) })}
            onFocus={(event) => { if (editing) event.currentTarget.select(); }}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => { if (editing) keep(event.currentTarget.value); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); reverting.current = true; event.currentTarget.blur(); }
            }}
          />
          <small>{ratio}</small>
        </span>
        <em aria-hidden="true">{saved.width}×{saved.height}</em>
        <span className="phone-size-remove-slot">
          <button type="button" className="phone-size-remove" tabIndex={editing ? 0 : -1} aria-hidden={!editing || undefined} aria-label={t("Remove {0}", { "0": (saved.name) })} onClick={onRemove}><Trash2 size={18} /></button>
        </span>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------ More */

function MoreSheet({ view, open, onClose, statusText }: { view: Record<string, any>; open: boolean; onClose: () => void; statusText: string }) {
  useLanguage();
  const { prefs, setPrefs, hidden, retryComfyStatus, comfyRetrying } = view;
  const toggle = (label: string, description: string, checked: boolean, onChange: (next: boolean) => void) => (
    <button type="button" role="switch" aria-checked={checked} className="phone-row" onClick={() => onChange(!checked)}>
      <span>{label}<small>{description}</small></span>
      <span className={cn('phone-switch', checked && 'is-on')} aria-hidden="true"><i /></span>
    </button>
  );
  return (
    <Sheet open={open} onClose={onClose} title={t("More")}>
      <div className="phone-group">
        <button type="button" className="phone-row" onClick={retryComfyStatus}>
          <RefreshCw size={20} className={cn(comfyRetrying && 'spin')} /><span>{statusText}<small>{t("Tap to check again")}</small></span>
        </button>
      </div>
      <h3 className="phone-section">{t("Hidden")}</h3>
      <div className="phone-group">
        {!hidden.enabled
          ? <p className="phone-note">{t("Set up Hidden on the computer running HEISS UI, in Settings › Hidden. Then unlock it here with its password.")}</p>
          : hidden.unlocked
            ? <button type="button" className="phone-row" onClick={() => { hidden.lock(); onClose(); }}><LockKeyhole size={20} /><span>{t("Lock Hidden")}<small>{t("Also locks when idle")}</small></span></button>
            : <button type="button" className="phone-row" onClick={() => { onClose(); hidden.requestUnlock(null); }}><LockKeyhole size={20} /><span>{t("Unlock Hidden")}</span></button>}
      </div>
      <h3 className="phone-section">{t("Studio")}</h3>
      <div className="phone-group">
        {toggle('Smart upscale', 'Shows an upscale arrow on finished images', prefs.smartUpscale !== false, (next) => setPrefs({ smartUpscale: next }))}
        {toggle('Show failed generations', 'Keeps them in the gallery so you can see why', prefs.showFailedItems !== false, (next) => setPrefs({ showFailedItems: next }))}
        {toggle('Ask before deleting', 'Also asks before stopping generations', prefs.confirmActions !== false, (next) => setPrefs({ confirmActions: next }))}
      </div>
      <div className="phone-group">
        <button type="button" className="phone-row" onClick={() => { onClose(); setPrefs({ fullStudioOnPhone: true }); }}>
          <SlidersHorizontal size={20} /><span>{t("Use the full studio")}<small>{t("All controls, laid out for a larger screen")}</small></span>
        </button>
      </div>
      <p className="phone-note">{t("Models, folders, downloads and updates are managed on the computer running HEISS UI.")}</p>
    </Sheet>
  );
}

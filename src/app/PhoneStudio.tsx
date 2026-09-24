import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowUp, Check, ChevronRight, CircleStop, Dices, Download, Eye, EyeOff, ImagePlus, Info, LockKeyhole, MoreHorizontal, RefreshCw, Search, Share, SlidersHorizontal, Square, Star, Trash2, Wand2, X } from 'lucide-react';
import { cn, aspectIconStyle } from './format';
import { familyLabel } from './components';
import { downloadUrl } from './GalleryTile';
import { canUpscaleItem } from './useUpscale';
import { UpscaleArrow } from './UpscaleArrow';
import { ReferenceSlots } from './ReferenceMediaPicker';
import { useFocusTrap } from './useFocusTrap';
import { useHistoryDismiss } from './useHistoryDismiss';
import type { AspectPreset, GalleryItem, Profile } from './types';

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

type Toast = (message: string, tone?: 'default' | 'success' | 'error') => void;

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
            aria-label="Close"
            tabIndex={-1}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
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
                <button type="button" className="phone-icon" aria-label="Close" onClick={onClose}><X size={20} /></button>
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

export function prefetchShare(item: GalleryItem | null) {
  if (!item?.url || !canShareFiles) return;
  const url = downloadUrl(item);
  if (!shareBlobs.has(url)) shareBlobs.set(url, fetch(url).then((response) => response.ok ? response.blob() : Promise.reject(new Error('fetch failed'))));
}

function fileNameFor(item: GalleryItem, type = '') {
  const base = String(item.outputName || item.filename || 'heiss').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'heiss';
  if (/\.\w{2,4}$/.test(base)) return base;
  return `${base}.${type.includes('webp') ? 'webp' : type.includes('jpeg') ? 'jpg' : item.type === 'video' ? 'mp4' : 'png'}`;
}

/** Share where the phone can (Photos, Messages, AirDrop…), otherwise save the file. */
export async function shareItem(item: GalleryItem, showToast: Toast) {
  const url = downloadUrl(item);
  if (canShareFiles) {
    try {
      prefetchShare(item);
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
  if (!canShareFiles) showToast('Saved to your downloads');
}

/* ------------------------------------------------------------ Item actions */

export type PhoneItemActions = {
  showToast: Toast;
  smartUpscale: boolean;
  upscaleBusy: (item: GalleryItem) => boolean;
  upscale: (item: GalleryItem) => void;
  cancelUpscale: (item: GalleryItem) => void;
  reuse: (item: GalleryItem) => void;
  useAsReference?: (item: GalleryItem) => void;
  hide: (item: GalleryItem) => void;
  unhide: (item: GalleryItem) => void;
  remove: (item: GalleryItem) => void;
};

function upscaleLabel(item: GalleryItem) {
  if (item.upscale?.status === 'running') return 'Stop upscale';
  if (item.upscale?.url) return item.upscaleActive ? 'Show original' : 'Show upscale';
  return 'Upscale';
}

/** What a long press on a tile offers, as one sheet of big labelled rows. */
export function ItemActionSheet({ item, onClose, actions }: { item: GalleryItem | null; onClose: () => void; actions: PhoneItemActions }) {
  React.useEffect(() => { prefetchShare(item); }, [item]);
  const done = item?.status === 'done' && Boolean(item?.url);
  const run = (action: () => void) => { onClose(); action(); };
  return (
    <Sheet open={Boolean(item)} onClose={onClose} title={item?.prompt ? truncate(item.prompt, 60) : 'Image'}>
      {item ? (
        <div className="phone-group">
          {done ? (
            <button type="button" className="phone-row" onClick={() => run(() => shareItem(item, actions.showToast))}>
              {canShareFiles ? <Share size={20} /> : <Download size={20} />}<span>{canShareFiles ? 'Share or save' : 'Save'}</span>
            </button>
          ) : null}
          {actions.smartUpscale && canUpscaleItem(item) ? (
            <button type="button" className="phone-row" disabled={actions.upscaleBusy(item)} onClick={() => run(() => (item.upscale?.status === 'running' ? actions.cancelUpscale(item) : actions.upscale(item)))}>
              {item.upscale?.status === 'running' ? <Square size={16} fill="currentColor" strokeWidth={0} /> : <UpscaleArrow size={20} />}<span>{upscaleLabel(item)}</span>
            </button>
          ) : null}
          {item.prompt ? <button type="button" className="phone-row" onClick={() => run(() => actions.reuse(item))}><Wand2 size={20} /><span>Make another like this</span></button> : null}
          {done && actions.useAsReference && item.type === 'image' && !item.vaultLocked ? <button type="button" className="phone-row" onClick={() => run(() => actions.useAsReference!(item))}><ImagePlus size={20} /><span>Use as reference</span></button> : null}
          {done ? (
            item.privateVault
              ? <button type="button" className="phone-row" onClick={() => run(() => actions.unhide(item))}><Eye size={20} /><span>Move to gallery</span></button>
              : <button type="button" className="phone-row" onClick={() => run(() => actions.hide(item))}><EyeOff size={20} /><span>Hide</span></button>
          ) : null}
          <button type="button" className="phone-row is-danger" onClick={() => run(() => actions.remove(item))}><Trash2 size={20} /><span>Delete</span></button>
        </div>
      ) : null}
    </Sheet>
  );
}

/** The viewer's bottom bar on a phone: five big labelled actions and Info. */
export function PhoneViewerBar({ item, actions, showDetails, onToggleDetails }: { item: GalleryItem; actions: PhoneItemActions; showDetails: boolean; onToggleDetails: () => void }) {
  React.useEffect(() => { prefetchShare(item); }, [item]);
  const done = item.status === 'done' && Boolean(item.url);
  return (
    <nav className="viewer-phone-bar" aria-label="Image actions">
      {done ? <button type="button" onClick={() => shareItem(item, actions.showToast)}>{canShareFiles ? <Share size={21} /> : <Download size={21} />}<span>{canShareFiles ? 'Share' : 'Save'}</span></button> : null}
      {actions.smartUpscale && canUpscaleItem(item) ? (
        <button type="button" className={cn(item.upscaleActive && item.upscale?.url && 'is-on')} disabled={actions.upscaleBusy(item)} onClick={() => (item.upscale?.status === 'running' ? actions.cancelUpscale(item) : actions.upscale(item))}>
          {actions.upscaleBusy(item) ? <RefreshCw size={20} className="spin" /> : item.upscale?.status === 'running' ? <Square size={15} fill="currentColor" strokeWidth={0} /> : <UpscaleArrow size={21} />}
          <span>{item.upscale?.status === 'running' ? 'Stop' : item.upscale?.url ? (item.upscaleActive ? 'Original' : 'Upscale') : 'Upscale'}</span>
        </button>
      ) : null}
      {item.prompt ? <button type="button" onClick={() => actions.reuse(item)}><Wand2 size={21} /><span>Again</span></button> : null}
      {done ? (
        item.privateVault
          ? <button type="button" onClick={() => actions.unhide(item)}><Eye size={21} /><span>Unhide</span></button>
          : <button type="button" onClick={() => actions.hide(item)}><EyeOff size={21} /><span>Hide</span></button>
      ) : null}
      <button type="button" className="is-danger" onClick={() => actions.remove(item)}><Trash2 size={21} /><span>Delete</span></button>
      <button type="button" className={cn(showDetails && 'is-on')} aria-pressed={showDetails} onClick={onToggleDetails}><Info size={21} /><span>Info</span></button>
    </nav>
  );
}

function truncate(text: string, length: number) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > length ? `${clean.slice(0, length - 1)}…` : clean;
}

/* ------------------------------------------------------------ The shell */

export function PhoneShell({ view, galleryBody, canUseNegativePrompt, comfyOffline, hiddenLocked, toggleHiddenSpace, createOpen, setCreateOpen, itemActions, actionsFor, setActionsFor }: {
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
}) {
  const {
    prompt, currentProfile, hiddenSpace, hidden, runningCount, cancelQueue, comfyStatus, retryComfyStatus,
    galleryStageRef, onGalleryScroll, generate, generateDisabled
  } = view;
  const [moreOpen, setMoreOpen] = React.useState(false);
  const restarting = Boolean(comfyStatus?.restarting);
  const connected = Boolean(comfyStatus?.connected);
  const statusText = restarting ? 'ComfyUI is restarting' : connected ? `Connected${comfyStatus?.device ? ` · ${comfyStatus.device}` : ''}` : comfyStatus?.checked ? 'ComfyUI is offline' : 'Checking ComfyUI…';
  const workflowName = currentProfile?.displayName || currentProfile?.label || 'Choose a workflow';
  const quickGo = Boolean(prompt.trim()) && !generateDisabled && !comfyOffline && !restarting;

  return (
    <>
      <header className="phone-bar">
        <button type="button" className={cn('phone-status', restarting ? 'is-restarting' : connected ? 'is-connected' : comfyStatus?.checked ? 'is-offline' : 'is-checking')} aria-label={`${statusText}. Check again`} onClick={retryComfyStatus}>
          <span />
        </button>
        <div className="phone-title">
          {hiddenSpace ? <><button type="button" className="phone-icon" aria-label="Back to the gallery" onClick={toggleHiddenSpace}><ArrowLeft size={20} /></button><LockKeyhole size={16} className="phone-ember" /><span>Hidden</span></> : <span>Gallery</span>}
        </div>
        {!hiddenSpace ? (
          <button type="button" className={cn('phone-icon', hidden.enabled && hidden.unlocked && 'has-dot')} aria-label={hidden.enabled && hidden.unlocked ? 'Open Hidden, unlocked' : 'Open Hidden'} onClick={toggleHiddenSpace}><LockKeyhole size={20} /></button>
        ) : hidden.unlocked ? (
          <button type="button" className="phone-pill" onClick={() => hidden.lock()}><LockKeyhole size={15} /> Lock</button>
        ) : null}
        <button type="button" className="phone-icon" aria-label="More" onClick={() => setMoreOpen(true)}><MoreHorizontal size={22} /></button>
      </header>

      {runningCount ? (
        <div className="phone-running" role="status">
          <RefreshCw size={14} className="spin" />
          <span>{runningCount === 1 ? 'Generating 1 image' : `Generating ${runningCount}`}</span>
          <button type="button" className="phone-pill" onClick={cancelQueue}><CircleStop size={15} /> Stop all</button>
        </div>
      ) : null}

      <main ref={galleryStageRef} className="phone-gallery" onScroll={onGalleryScroll}>
        {galleryBody}
      </main>

      {!hiddenLocked ? (
        <div className={cn('phone-create-pill', hiddenSpace && 'is-hidden')}>
          <button type="button" className="phone-create-open" onClick={() => setCreateOpen(true)}>
            <strong className={cn(!prompt.trim() && 'is-placeholder')}>{prompt.trim() ? truncate(prompt, 90) : hiddenSpace ? 'Describe what to make, privately…' : 'Describe what to make…'}</strong>
            <small>{workflowName}</small>
          </button>
          <button
            type="button"
            className="phone-go"
            aria-label={quickGo ? 'Generate' : 'Open the composer'}
            onClick={() => (quickGo ? generate() : setCreateOpen(true))}
          >
            {restarting ? <RefreshCw size={20} className="spin" /> : <ArrowUp size={22} strokeWidth={2.4} />}
          </button>
        </div>
      ) : null}

      <CreateSheet view={view} open={createOpen} onClose={() => setCreateOpen(false)} canUseNegativePrompt={canUseNegativePrompt} comfyOffline={comfyOffline} />
      <MoreSheet view={view} open={moreOpen} onClose={() => setMoreOpen(false)} statusText={statusText} />
      <ItemActionSheet item={actionsFor} onClose={() => setActionsFor(null)} actions={itemActions} />
    </>
  );
}

/* ------------------------------------------------------------ Create */

function CreateSheet({ view, open, onClose, canUseNegativePrompt, comfyOffline }: { view: Record<string, any>; open: boolean; onClose: () => void; canUseNegativePrompt: boolean; comfyOffline: boolean }) {
  const {
    prompt, setPrompt, promptLimit, clampText, negative, setNegative, negativeLimit, currentProfile, hiddenSpace,
    aspectOptions, aspectPickerValue, aspectLocked, defaultAspectSize, mode, count, countMeta, setCount, steps, stepsMeta, setSteps,
    referenceInputs, referenceStrength, referenceAssets, selectReferenceAsset, removeReferenceAsset, confirmAction, showToast,
    generate, generateDisabled, generateDisabledReason, comfyStatus, retryComfyStatus, comfyRetrying, seed, setSeed, loraActiveCount, sidebarControls
  } = view;
  const [sheet, setSheet] = React.useState<'' | 'workflow' | 'aspect' | 'advanced'>('');
  const [showNegative, setShowNegative] = React.useState(Boolean(negative));
  const restarting = Boolean(comfyStatus?.restarting);
  const variations = mode === 'image' && currentProfile?.capabilities?.variations !== false;
  const maxCount = Math.max(1, Math.min(4, Number(countMeta?.max || 4)));
  const stepMin = Number(stepsMeta?.min || 1);
  const stepMax = Math.max(stepMin, Number(stepsMeta?.max || 60));
  const aspect = (aspectOptions as AspectPreset[] || []).find((option) => option.value === aspectPickerValue);
  const reason = restarting ? 'ComfyUI is restarting. Back in a few seconds.' : comfyOffline ? 'ComfyUI is offline.' : !prompt.trim() ? '' : generateDisabled ? generateDisabledReason : '';

  const go = () => {
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
      title={hiddenSpace ? <span className="phone-title-inline"><LockKeyhole size={16} className="phone-ember" /> Create in Hidden</span> : 'Create'}
      footer={
        <>
          {reason ? <p className="phone-reason">{reason}</p> : null}
          <button
            type="button"
            className={cn('phone-generate', restarting && 'is-restarting', comfyOffline && !restarting && 'is-offline')}
            aria-disabled={restarting || (!comfyOffline && (!prompt.trim() || generateDisabled)) || undefined}
            onClick={go}
          >
            {restarting ? <><RefreshCw size={18} className="spin" /> Restarting…</>
              : comfyOffline ? <><RefreshCw size={18} className={cn(comfyRetrying && 'spin')} /> {comfyRetrying ? 'Checking…' : 'Check again'}</>
              : <><ArrowUp size={20} strokeWidth={2.4} /> {mode === 'image' && count > 1 ? `Generate ${count}` : 'Generate'}</>}
          </button>
        </>
      }
    >
      <div className="phone-compose">
        <ReferenceSlots
          inputs={referenceInputs || []}
          strength={referenceStrength}
          selected={referenceAssets || []}
          onSelect={selectReferenceAsset}
          onRemove={removeReferenceAsset}
          confirmDelete={(asset) => confirmAction({ title: `Delete ${asset.name}?`, description: 'This removes the uploaded image from your reference library.', action: 'Delete upload', destructive: true })}
          onError={(message) => showToast(message, 'error')}
        />
        <textarea
          aria-label={hiddenSpace ? 'Prompt (Hidden)' : 'Prompt'}
          value={prompt}
          placeholder={hiddenSpace ? 'Describe what to make, privately…' : 'Describe what to make…'}
          onChange={(event) => setPrompt(clampText(event.target.value, promptLimit))}
          rows={4}
          autoFocus={!prompt.trim()}
        />
      </div>

      {canUseNegativePrompt ? (
        showNegative ? (
          <label className="phone-field">
            <span>Avoid</span>
            <textarea value={negative} rows={2} placeholder="What to leave out…" onChange={(event) => setNegative(clampText(event.target.value, negativeLimit))} />
          </label>
        ) : (
          <button type="button" className="phone-link" onClick={() => setShowNegative(true)}>+ Something to avoid</button>
        )
      ) : null}

      {String(seed || '').trim() ? (
        <button type="button" className="phone-row phone-seed" onClick={() => setSeed('')}>
          <Dices size={20} /><span>Seed {String(seed).trim()} is fixed<small>Tap for a new picture each time</small></span>
        </button>
      ) : null}

      <div className="phone-group">
        <button type="button" className="phone-row" onClick={() => setSheet('workflow')}>
          <SlidersHorizontal size={20} />
          <span>{currentProfile?.displayName || currentProfile?.label || 'Choose a workflow'}<small>{currentProfile ? familyLabel(currentProfile) : 'Workflow'}</small></span>
          <ChevronRight size={18} className="phone-row-end" />
        </button>
        {(aspectOptions || []).length && !aspectLocked ? (
          <button type="button" className="phone-row" onClick={() => setSheet('aspect')}>
            <span className="aspect-shape phone-aspect" style={aspect ? aspectIconStyle(aspect) : undefined} />
            <span>{aspect ? aspect.label : aspectPickerValue === 'default' ? 'Default size' : 'Custom size'}<small>{aspect ? aspect.value : defaultAspectSize}</small></span>
            <ChevronRight size={18} className="phone-row-end" />
          </button>
        ) : null}
      </div>

      {variations && maxCount > 1 ? (
        <div className="phone-control">
          <span className="phone-control-label">Images</span>
          <div className="phone-seg" role="radiogroup" aria-label="Images">
            {Array.from({ length: maxCount }, (_, index) => index + 1).map((value) => (
              <button key={value} type="button" role="radio" aria-checked={count === value} className={cn(count === value && 'active')} onClick={() => setCount(value)}>{value}</button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="phone-control">
        <span className="phone-control-label">Steps <b>{steps}</b></span>
        <input className="phone-slider" type="range" min={stepMin} max={stepMax} step={1} value={steps} aria-label="Steps" onChange={(event) => setSteps(Number(event.target.value))} />
        <span className="phone-control-hint"><span>Faster</span><span>More detail</span></span>
      </div>

      <button type="button" className="phone-link is-strong" onClick={() => setSheet('advanced')}>
        Advanced settings{loraActiveCount ? ` · ${loraActiveCount} LoRA${loraActiveCount === 1 ? '' : 's'}` : ''} <ChevronRight size={16} />
      </button>

      <WorkflowSheet view={view} open={sheet === 'workflow'} onClose={() => setSheet('')} />
      <AspectSheet view={view} open={sheet === 'aspect'} onClose={() => setSheet('')} />
      <Sheet open={sheet === 'advanced'} onClose={() => setSheet('')} title="Advanced" full className="phone-advanced">
        <div className="phone-advanced-body">{sidebarControls}</div>
      </Sheet>
    </Sheet>
  );
}

function WorkflowSheet({ view, open, onClose }: { view: Record<string, any>; open: boolean; onClose: () => void }) {
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
        <span>{profile.displayName || profile.label}<small>{profile.missing?.length ? 'Needs files, added on the computer' : familyLabel(profile)}</small></span>
        {profile.id === model ? <Check size={18} className="phone-row-end" /> : null}
      </button>
      {modelMenu ? (
        <button type="button" className={cn('phone-icon', favorites.has(profile.id) && 'is-on')} aria-pressed={favorites.has(profile.id)} aria-label={favorites.has(profile.id) ? 'Remove from favorites' : 'Add to favorites'} onClick={() => modelMenu.toggleFavorite(profile.id)}>
          <Star size={18} fill={favorites.has(profile.id) ? 'currentColor' : 'none'} />
        </button>
      ) : null}
    </div>
  );
  return (
    <Sheet open={open} onClose={onClose} title="Workflow" full>
      {profiles.length > 8 ? (
        <label className="phone-search">
          <Search size={17} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${profiles.length} workflows`} aria-label="Search workflows" spellCheck={false} autoComplete="off" />
        </label>
      ) : null}
      {!profiles.length ? <p className="phone-empty">{(view.comfyStatus?.connected) ? 'No workflows yet. Add models on the computer running HEISS UI.' : 'ComfyUI isn’t answering, so its workflows can’t be listed right now.'}</p> : null}
      {starred.length ? <><h3 className="phone-section">Favorites</h3><div className="phone-group">{starred.map(row)}</div></> : null}
      {recent.length ? <><h3 className="phone-section">Recent</h3><div className="phone-group">{recent.map(row)}</div></> : null}
      {rest.length ? <><h3 className="phone-section">{starred.length || recent.length ? 'All' : ''}</h3><div className="phone-group">{rest.map(row)}</div></> : null}
      {needle && !starred.length && !rest.length ? <p className="phone-empty">Nothing matches “{query.trim()}”.</p> : null}
    </Sheet>
  );
}

function AspectSheet({ view, open, onClose }: { view: Record<string, any>; open: boolean; onClose: () => void }) {
  const { aspectOptions, aspectPickerValue, applyAspect, defaultAspectSize } = view as { aspectOptions: AspectPreset[]; aspectPickerValue: string; applyAspect: (value: string) => void; defaultAspectSize: string };
  const pick = (value: string) => { applyAspect(value); onClose(); };
  return (
    <Sheet open={open} onClose={onClose} title="Shape">
      <div className="phone-group phone-aspects">
        <button type="button" className={cn('phone-row', aspectPickerValue === 'default' && 'is-current')} onClick={() => pick('default')}>
          <span className="aspect-shape default phone-aspect" />
          <span>Default<small>{defaultAspectSize}</small></span>
          {aspectPickerValue === 'default' ? <Check size={18} className="phone-row-end" /> : null}
        </button>
        {(aspectOptions || []).map((option) => (
          <button key={option.value} type="button" className={cn('phone-row', option.value === aspectPickerValue && 'is-current')} onClick={() => pick(option.value)}>
            <span className="aspect-shape phone-aspect" style={aspectIconStyle(option)} />
            <span>{option.label}<small>{option.value}</small></span>
            {option.value === aspectPickerValue ? <Check size={18} className="phone-row-end" /> : null}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------ More */

function MoreSheet({ view, open, onClose, statusText }: { view: Record<string, any>; open: boolean; onClose: () => void; statusText: string }) {
  const { prefs, setPrefs, hidden, retryComfyStatus, comfyRetrying } = view;
  const toggle = (label: string, description: string, checked: boolean, onChange: (next: boolean) => void) => (
    <button type="button" role="switch" aria-checked={checked} className="phone-row" onClick={() => onChange(!checked)}>
      <span>{label}<small>{description}</small></span>
      <span className={cn('phone-switch', checked && 'is-on')} aria-hidden="true"><i /></span>
    </button>
  );
  return (
    <Sheet open={open} onClose={onClose} title="More">
      <div className="phone-group">
        <button type="button" className="phone-row" onClick={retryComfyStatus}>
          <RefreshCw size={20} className={cn(comfyRetrying && 'spin')} /><span>{statusText}<small>Tap to check again</small></span>
        </button>
      </div>
      <h3 className="phone-section">Hidden</h3>
      <div className="phone-group">
        {!hidden.enabled
          ? <p className="phone-note">Set up Hidden on the computer running HEISS UI (Settings › Hidden). It then opens here with its password.</p>
          : hidden.unlocked
            ? <button type="button" className="phone-row" onClick={() => { hidden.lock(); onClose(); }}><LockKeyhole size={20} /><span>Lock Hidden<small>It also locks by itself when idle</small></span></button>
            : <button type="button" className="phone-row" onClick={() => { onClose(); hidden.requestUnlock(null); }}><LockKeyhole size={20} /><span>Unlock Hidden</span></button>}
      </div>
      <h3 className="phone-section">Studio</h3>
      <div className="phone-group">
        {toggle('Upscale button', 'One tap makes a larger, sharper copy', prefs.smartUpscale !== false, (next) => setPrefs({ smartUpscale: next }))}
        {toggle('Show failed generations', 'Keep them in the gallery to see why', prefs.showFailedItems !== false, (next) => setPrefs({ showFailedItems: next }))}
        {toggle('Ask before deleting', 'Deletes can be undone for a few seconds either way', prefs.confirmActions !== false, (next) => setPrefs({ confirmActions: next }))}
      </div>
      <div className="phone-group">
        <button type="button" className="phone-row" onClick={() => { onClose(); setPrefs({ fullStudioOnPhone: true }); }}>
          <SlidersHorizontal size={20} /><span>Use the full studio<small>Every control, laid out for a larger screen</small></span>
        </button>
      </div>
      <p className="phone-note">Models, folders, downloads and updates are managed on the computer running HEISS UI.</p>
    </Sheet>
  );
}


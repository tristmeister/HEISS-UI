import React from 'react';
import { GridAutoplayButton } from './GridAutoplayButton';
import { ArrowLeft, ChevronDown, CircleStop, Columns2, Shuffle, ChevronLeft, ChevronRight, ChevronUp, Download, Eye, EyeOff, GalleryHorizontalEnd, ImagePlus, Lock, LockKeyhole, Maximize2, Minimize2, PanelLeft, Plug, RefreshCw, RotateCcw, Settings, SlidersHorizontal, Smartphone, Square, Star, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn, nearTextLimit, settingsText } from './format';
import { GallerySkeleton, Media, Skeleton, Tip } from './components';
import { PromptIdeas } from './PromptIdeas';
import { useHorizontalWheel, useWheelRef } from './wheel';
import { AnimatedNumber } from './AnimatedNumber';
import { GenerationMedia, GenerationPreviewMode } from './GenerationPreview';
import { GenerationProgress } from './GenerationProgress';
import { ComposerBar } from './ComposerBar';
import { VirtualMasonryGallery } from './VirtualMasonryGallery';
import { features } from './constants';
import { RunCard, runKind } from './RunStack';
import { RunSheet } from './RunSheet';
import { StackRunsButton } from './StackRunsButton';
import { runTitle, type Run } from './runs';
import { UpscaleArrow } from './UpscaleArrow';
import { UpscaleCompare } from './UpscaleCompare';
import { canUpscaleItem, shortLeft, upscaledWithRun, upscaleTooltip, useUpscaleClock } from './useUpscale';
import { UpscaleSetupDialog } from './UpscaleDialogs';
import { ModelFoldersDialog } from './ModelFoldersDialog';
import { UpscaleNoticePopover } from './UpscaleNotice';
import { useUpscaleDownloadActivity } from './UpscaleDownloadActivity';
import { FailurePanel } from './GenerationFailure';
import { useModelDownloadActivity } from './ModelDownloadActivity';
import { useUpdateActivity } from './UpdateActivity';
import { useGenerationActivity, useTilesOnScreen } from './GenerationActivity';
import { ActivityColumn } from './Activities';
import { CopyIcon, useCopyFeedback } from './CopyFeedback';
import { ViewerActions } from './ViewerActions';
import { WorkflowGallery } from './WorkflowGallery';
import { HiddenLockScreen, HiddenUnlockSheet } from './HiddenLock';
import { HiddenSetupDialog } from './HiddenSetup';
import { HiddenActionsContext } from './hiddenContext';
import { LockMark } from './LockMark';
import { downloadUrl, TileLongPressContext } from './GalleryTile';
import { PhoneShell, PhoneViewerBar, type PhoneItemActions } from './PhoneStudio';
import { usePhone, useThisComputer } from './device';
import { haptic } from './phoneControls';
import { ConnectedCard } from './ConnectedCard';
import { Toaster } from './Toaster';
import { EmptyStage } from './EmptyStage';
import { SettingsDialog, type SettingsSection } from './SettingsDialog';
import { GetModelsSheet, StarterModels } from './StarterModels';
import { NoComfySheet } from './NoComfySheet';
import { FeedbackHost } from './FeedbackDialog';
import { ShortcutsSheet } from './shortcuts';
import { useHistoryDismiss } from './useHistoryDismiss';
import { useFocusTrap } from './useFocusTrap';
import { PromptHistoryPopover } from './PromptHistory';
import { GallerySearchBar, GallerySearchButton, SearchEmpty, useGallerySearchKeys } from './GallerySearch';
import { canStar, emptySearch, FavoriteContext, searchActive, type GallerySearch } from './favorites';
import { refreshPrompts, usePromptHistory } from './recentPrompts';
import type { GalleryItem } from './types';
import type { HiddenState } from './useHidden';
import { memoLatest } from '@/lib/memo-latest';

// App rebuilds every prop on each render (a keystroke in the prompt, a poll);
// these skip re-rendering unless their data actually changed.
const StableGallery = memoLatest(VirtualMasonryGallery);
const StableComposerBar = memoLatest(ComposerBar);

type ZenStripProps = {
  items: GalleryItem[];
  activeId?: string;
  stripRef: React.Ref<HTMLDivElement>;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp: React.PointerEventHandler<HTMLDivElement>;
  onSelect: (id: string) => void;
  titleFromPrompt: (text: string) => string;
};

const ZenStrip = memoLatest(function ZenStrip({ items, activeId, stripRef, onPointerDown, onPointerMove, onPointerUp, onSelect, titleFromPrompt }: ZenStripProps) {
  return (
    <div
      ref={stripRef}
      className="zen-gallery-strip"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {items.map((item) => (
        <Tip key={item.id} content={item.run ? `${runTitle(item.run)} · ${runKind(item.run)}` : titleFromPrompt(item.prompt || item.filename || "")}><button data-zen-id={item.id} className={cn(item.id === activeId && "active", item.run && "is-run")} onClick={(event) => { event.stopPropagation(); onSelect(item.id); }} onDragStart={(event) => event.preventDefault()}>
          <Media item={item} muted />
          {item.run ? <span className="zen-run-count" aria-hidden="true">{item.run.count}</span> : null}
        </button></Tip>
      ))}
    </div>
  );
});

function comfyStatusLabel(status: any) {
  if (status?.restarting) return "ComfyUI is restarting…";
  if (status?.checking) return "Checking ComfyUI…";
  if (status?.connected) {
    const detail = [status.device, status.latencyMs ? `${status.latencyMs}ms` : "", status.version ? `v${status.version}` : ""].filter(Boolean).join(" · ");
    return `ComfyUI connected${detail ? ` · ${detail}` : ""}`;
  }
  return `ComfyUI offline${status?.url ? ` · ${status.url}` : ""}${status?.error ? ` · ${status.error}` : ""}`;
}

function ComfyConnectionDot({ status, retrying, onClick }: { status: any; retrying: boolean; onClick: () => void }) {
  const state = status?.restarting ? "restarting" : status?.checking || retrying ? "checking" : status?.connected ? "connected" : "disconnected";
  return (
    <Tip content={comfyStatusLabel(status)}>
      <button className={`comfy-status-dot is-${state}`} aria-label={comfyStatusLabel(status)} onClick={onClick}>
        <span />
      </button>
    </Tip>
  );
}

export function StudioView({ view }: { view: Record<string, any> }) {
  const { active, applyAllSettings, applyLoras, applyAspect, aspectOptions, aspectPickerValue, aspectValue, aspectLocked, defaultAspectSize, canUseStartImage, cancelJob, cancelQueue, characterMeta, clickViewer, comfyStatus, galleryGroups, stackRuns, openRuns, setRunOpen, unstackRun, copyToClipboard, copyItemToClipboard, count, countMeta, currentProfile, customSize, deleteItem, zenGallery, formatElapsed, galleryColumnCount, galleryLoaded, galleryCrossing, galleryStageRef, generate, generateDisabled, generateDisabledReason, generationDetailEntries, goLatestZen, hasMoreGallery, height, heightMeta, isDraggingViewer, loadMoreGalleryItems, loraActiveCount, mode, model, modelProfiles, models, moveViewer, moveViewerTouch, moveZen, negative, negativeLimit, onGalleryScroll, openItem, prefs, hiddenSpace, hideItems, unhideItems, profileBadges, prompt, promptLimit, refreshComfyStatus, removeReferenceAsset, renderedGallery, resetViewer, runningCount, selectReferenceAsset, setActive, setCount, setHeight, setNegative, setPrompt, setSettings, setShowDetails, setShowGenerationSettings, setShowNegativePrompt, setSteps, setWidth, setWorkflowGalleryOpen, setZenControls, setZenGalleryOpen, setZenMode, showDetails, settings, showGenerationSettings, showNegativePrompt, showToast, sidebarControls, startViewerDrag, startViewerTouch, steps, stepsMeta, stopViewerDrag, submitZenPrompt, useOutputAsStartImage, viewerDragEndRef, viewerDragRef, viewerPan, viewerZoom, wheelViewer, width, widthMeta, workflowGalleryOpen, zenControls, zenDisplayItem, zenGalleryOpen, zenItem, zenPromptRef, zenStripRef, dragViewer, dragZenStrip, endViewerTouch, selectZenItem, startZenStripDrag, stopZenStripDrag, titleFromPrompt, zoomViewer, clampText, promptRemaining, chooseModel, pickModel, modelMenu, visibleGallery, upscaleBusyIds, activateUpscale, cancelUpscale, upscaleDisplayUrl, upscaleSetup, upscaleStatus, upscaleInstall, upscaleUnavailableReason, health, setPrefs, upscaleNotices, dismissUpscaleNotice, refreshModels, refreshWorkflows, modelFolders } = view;
  // Smart upscale works on images, and only while it is on in Settings.
  const smartUpscaleTabs = mode === "image" && prefs.smartUpscale !== false;
  const strayModelCount = modelFolders?.strayCount || 0;
  const canUseNegativePrompt = currentProfile?.capabilities?.negativePrompt !== false;
  const { confirmAction, referenceAssets, referenceInputs, referenceInpaint, retryComfyStatus, comfyRetrying, comfyReconnectedAt } = view;
  const gallerySearch = (view.gallerySearch || emptySearch) as GallerySearch;
  const setGallerySearch = view.setGallerySearch as (next: GallerySearch) => void;
  const toggleFavorite = view.toggleFavorite as (items: GalleryItem[], favorite: boolean) => void;
  const searchOn = searchActive(gallerySearch);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const hidden = view.hidden as HiddenState;
  // Hidden, locked (or mid-unlock): the lock takes the gallery's place.
  const hiddenLocked = hiddenSpace && (!hidden.unlocked || hidden.unlockStage === "opening");
  // Stable across renders, so the memoised tiles do not all redraw when anything changes.
  const hideRef = React.useRef(hideItems);
  const unhideRef = React.useRef(unhideItems);
  hideRef.current = hideItems;
  unhideRef.current = unhideItems;
  const hiddenRef = React.useRef(hidden);
  hiddenRef.current = hidden;
  const hiddenActions = React.useMemo(() => ({
    space: hidden.space,
    enabled: hidden.enabled,
    unlocked: hidden.unlocked,
    hide: (items: GalleryItem[]) => hideRef.current(items),
    unhide: (items: GalleryItem[]) => unhideRef.current(items),
    unlock: () => {
      const current = hiddenRef.current;
      // Straight from the click, so the system's Touch ID sheet is allowed to show.
      if (current.usablePasskey && current.support?.available) current.unlockBiometric();
      else current.requestUnlock(null);
    }
  }), [hidden.space, hidden.enabled, hidden.unlocked]);
  // Crossing between the gallery and Hidden (or unlocking) fades the stage in anew.
  // Two identical animations, alternated, so each crossing restarts it.
  const passageKey = `${hidden.space}|${hiddenLocked ? "shut" : "open"}`;
  const passage = React.useRef({ key: passageKey, count: 0 });
  if (passage.current.key !== passageKey) passage.current = { key: passageKey, count: passage.current.count + 1 };
  const passageClass = passage.current.count ? `hidden-pass-${passage.current.count % 2 ? "a" : "b"}` : null;
  const toggleHiddenSpace = () => {
    if (hiddenSpace) { hidden.setSpace("gallery"); return; }
    hidden.setSpace("hidden");
    if (!hidden.enabled) { hidden.ensureReady({ kind: "enter" }); return; }
    // Straight from the click, so the system's Touch ID sheet is allowed to show.
    if (!hidden.unlocked && hidden.usablePasskey && hidden.support?.available) hidden.unlockBiometric();
  };
  // Phones get the simplified phone studio, unless someone chose the full one.
  const phoneDevice = usePhone();
  const phone = phoneDevice && !prefs.fullStudioOnPhone;
  // Recent prompts: ↑ in an empty prompt or the clock in the composer opens them.
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const hasPromptHistory = usePromptHistory(!phone).prompts.length > 0;
  // The very first prompt is recorded as it runs; the clock shows up then, not after a reload.
  React.useEffect(() => {
    if (phone || !runningCount || hasPromptHistory) return;
    const timer = window.setTimeout(() => refreshPrompts(), 1500);
    return () => window.clearTimeout(timer);
  }, [runningCount > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleHistory = React.useCallback(() => setHistoryOpen((value) => !value), []);
  const insertPrompt = (text: string) => {
    const previous = String(prompt || "");
    setPrompt(clampText(text, promptLimit));
    setHistoryOpen(false);
    window.requestAnimationFrame(() => {
      const field = zenPromptRef.current as HTMLTextAreaElement | null;
      if (!field) return;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });
    // Only a prompt that was really there is worth an undo.
    if (previous.trim() && previous.trim() !== text.trim()) showToast("Prompt replaced", "default", { group: "prompt-replaced", action: { label: "Undo", onClick: () => setPrompt(previous) } });
  };
  const promptKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const plain = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
    if (event.key === "ArrowUp" && plain && !String(prompt || "").trim() && hasPromptHistory && !event.nativeEvent.isComposing) {
      event.preventDefault();
      setHistoryOpen(true);
      return;
    }
    submitZenPrompt(event);
  };
  const historyPopover = (
    <PromptHistoryPopover
      open={historyOpen && !phone}
      onClose={(reason) => { setHistoryOpen(false); if (reason === "escape") (zenPromptRef.current as HTMLTextAreaElement | null)?.focus(); }}
      onPick={insertPrompt}
      hiddenSpace={Boolean(hiddenSpace)}
      onError={(message) => showToast(message, "error")}
    />
  );
  const [phoneCreate, setPhoneCreate] = React.useState(false);
  const [phoneActionsFor, setPhoneActionsFor] = React.useState<GalleryItem | null>(null);
  const openTileActions = React.useCallback((item: GalleryItem) => { haptic('press'); setPhoneActionsFor(item); }, []);
  // Selecting several on the phone: null when not selecting.
  const [phoneSelection, setPhoneSelection] = React.useState<Set<string> | null>(null);
  const toggleSelected = React.useCallback((item: GalleryItem) => {
    haptic('tap');
    setPhoneSelection((current) => {
      const next = new Set(current || []);
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
      return next;
    });
  }, []);
  useHistoryDismiss(Boolean(phone && phoneSelection), () => setPhoneSelection(null));
  // Leaving the phone studio or crossing into Hidden ends a selection.
  React.useEffect(() => { setPhoneSelection(null); }, [phone, hiddenSpace]);
  const phoneTiles = React.useMemo(() => phone ? {
    onLongPress: openTileActions,
    selecting: Boolean(phoneSelection),
    selected: phoneSelection || new Set<string>(),
    toggle: toggleSelected
  } : null, [phone, openTileActions, phoneSelection, toggleSelected]);
  // Zen shows one image at a time: a search there would narrow a strip with nothing to say so.
  React.useEffect(() => {
    if (!prefs.zenMode) return;
    setSearchOpen(false);
    if (searchActive(gallerySearch)) setGallerySearch(emptySearch);
  }, [prefs.zenMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const openSearch = React.useCallback(() => {
    setSearchOpen(true);
    document.querySelector<HTMLInputElement>('.gallery-search input, .phone-searchbar input')?.focus();
  }, []);
  useGallerySearchKeys(!prefs.zenMode && !hiddenLocked, openSearch);
  // The viewer stars with F, as the tile's star and the dock's do.
  React.useEffect(() => {
    if (!active || !canStar(active)) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "f" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (document.querySelector('[role="dialog"]:not([data-focus-trap]), [role="alertdialog"]')) return;
      event.preventDefault();
      toggleFavorite([active], !active.favorite);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, toggleFavorite]);
  const phoneItemActions: PhoneItemActions = {
    star: (item) => toggleFavorite([item], !item.favorite),
    showToast,
    smartUpscale: prefs.smartUpscale !== false,
    upscaleBusy: (item) => Boolean(upscaleBusyIds?.has(item.id)),
    upscale: activateUpscale,
    cancelUpscale,
    // "Make another like this": the settings go into the composer, which opens.
    reuse: (item) => { applyAllSettings(item); setActive(null); setPhoneCreate(true); },
    useAsReference: canUseStartImage ? (item) => { useOutputAsStartImage(item); setActive(null); setPhoneCreate(true); } : undefined,
    hide: (item) => hideItems([item]),
    unhide: (item) => unhideItems([item]),
    remove: (item) => deleteItem(item)
  };
  const hiddenCount = hiddenSpace ? renderedGallery.filter((item: GalleryItem) => item.status === "done").length : 0;
  const hiddenLockScreen = (
    <AnimatePresence>
      {hiddenLocked ? <HiddenLockScreen key="lock" hidden={hidden} onLeave={() => hidden.setSpace("gallery")} onSetup={() => hidden.ensureReady({ kind: "enter" })} /> : null}
    </AnimatePresence>
  );
  const comfyOffline = comfyStatus && !comfyStatus.connected && !comfyStatus.checking;
  // Prompts to start from, above the prompt box, until the first image or the first word.
  const showIdeas = galleryLoaded && !renderedGallery.length && !searchOn && !hiddenSpace && !phone && !comfyOffline && Boolean(currentProfile) && !prompt.trim() && !historyOpen;
  const promptIdeas = showIdeas ? <PromptIdeas prompts={view.starterPrompts} onPick={view.fillPrompt} onSurprise={view.surprise} /> : null;
  // Back closes the viewer and the workflow gallery rather than leaving the app.
  useHistoryDismiss(Boolean(active), () => setActive(null));
  const viewerRef = React.useRef<HTMLDivElement | null>(null);
  useFocusTrap(viewerRef, Boolean(active));
  useHistoryDismiss(Boolean(workflowGalleryOpen), () => setWorkflowGalleryOpen(false));
  const [settingsSection, setSettingsSection] = React.useState<SettingsSection>("general");
  const openSettings = React.useCallback((section?: SettingsSection) => {
    if (section) setSettingsSection(section);
    setSettings(true);
  }, [setSettings]);
  useHistoryDismiss(Boolean(settings), () => setSettings(false));
  const [noComfyOpen, setNoComfyOpen] = React.useState(false);
  const [getModelsOpen, setGetModelsOpen] = React.useState(false);
  const openGetModels = React.useCallback(() => setGetModelsOpen(true), []);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  // "?" anywhere outside a field lists the keyboard shortcuts.
  React.useEffect(() => {
    if (phone) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (document.querySelector('[role="dialog"]:not([data-focus-trap]), [role="alertdialog"]')) return;
      // Before the "any letter jumps to the prompt" listener, so no "?" lands in it.
      event.preventDefault();
      event.stopImmediatePropagation();
      setShortcutsOpen(true);
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [phone]);
  const starterModels = (
    <StarterModels showToast={showToast} onStarted={view.onStarterStarted} onUse={view.selectStarterModel} />
  );
  // Leaving Hidden setup to pick the output folder comes back to setup afterwards.
  const resumeHiddenSetup = React.useRef(false);
  React.useEffect(() => {
    if (settings || !resumeHiddenSetup.current) return;
    resumeHiddenSetup.current = false;
    if (!hidden.enabled) hidden.setSetupOpen(true);
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps
  // A run opened from somewhere other than its stack (zen, a phone's sheet) is scrolled to once laid out.
  const [focusRun, setFocusRun] = React.useState("");
  const [runSheet, setRunSheet] = React.useState<Run | null>(null);
  const showRunInGallery = React.useCallback((run: Run) => {
    setRunSheet(null);
    if (prefs.zenMode) setZenMode(false);
    setRunOpen(run.id, true);
    setFocusRun(run.id);
  }, [prefs.zenMode, setRunOpen, setZenMode]);
  // Long-running work floats at the top as activities, in this order; the toasts start under them.
  const upscaleActivity = useUpscaleDownloadActivity(upscaleSetup, upscaleInstall);
  // A text encoder or VAE landing rescans models, so every panel catches up at once.
  const modelActivity = useModelDownloadActivity({
    onDone: () => { refreshModels(false); refreshWorkflows(); },
    // Either place shows the same download with its own controls.
    hidden: Boolean(workflowGalleryOpen) || getModelsOpen,
    // To the download itself: its starter card, or the setup panel of the workflow that needs it.
    onOpen: (where) => (where === "starter" ? setGetModelsOpen(true) : setWorkflowGalleryOpen(true))
  });
  const thisComputer = useThisComputer();
  const updateActivity = useUpdateActivity({
    status: view.updateStatus,
    thisComputer,
    restarting: Boolean(view.restarting),
    justUpdated: view.justUpdated,
    running: runningCount,
    hiddenSpace,
    settingsOpen: Boolean(settings),
    onUpdate: () => view.installUpdate({ confirm: false }),
    onRestart: view.restartForUpdate,
    onLater: (version) => view.setUpdatePrefs({ dismissed: version }),
    onDoneUpdated: view.clearJustUpdated
  });
  // A generation stands in for itself only where its tile can't be seen: the
  // viewer on another image, zen on an older one, the gallery scrolled away.
  const pendingIds = React.useMemo(() => ((visibleGallery || []) as GalleryItem[]).filter((item) => item.status === "pending").map((item) => item.id), [visibleGallery]);
  const pendingTileOnScreen = useTilesOnScreen(galleryStageRef, !phone && !prefs.zenMode && !active ? pendingIds : []);
  const watchingGeneration = active ? active.status === "pending" : prefs.zenMode ? zenDisplayItem?.status === "pending" : pendingTileOnScreen;
  const generationActivity = useGenerationActivity({
    items: visibleGallery || [],
    enabled: !phone && !hiddenLocked,
    watching: watchingGeneration,
    reveal: (item) => !item.privateVault || hiddenSpace,
    onJump: (item) => {
      if (active) setActive(null);
      if (prefs.zenMode) { selectZenItem(item.id); return; }
      window.requestAnimationFrame(() => {
        const tile = document.querySelector(`[data-tile-id="${CSS.escape(item.id)}"]`);
        if (tile) tile.scrollIntoView({ block: "center", behavior: "smooth" });
        else galleryStageRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      });
    },
    onView: (item) => openItem(item)
  });
  const [islandsHeight, setIslandsHeight] = React.useState(0);
  const viewerCopy = useCopyFeedback();
  const [compareOpen, setCompareOpen] = React.useState(false);
  // A different image has its own comparison, so never carry the mode over.
  React.useEffect(() => { setCompareOpen(false); }, [active?.id]);
  const viewerWheelRef = useWheelRef<HTMLElement>(wheelViewer);
  // Only Ctrl+wheel (page zoom) is swallowed, so the details panel still scrolls.
  const scrimWheelRef = useWheelRef<HTMLDivElement>((event) => { if (event.ctrlKey) event.preventDefault(); });
  const setViewerNode = React.useCallback((node: HTMLDivElement | null) => {
    viewerRef.current = node;
    return scrimWheelRef(node);
  }, [scrimWheelRef]);
  // A plain wheel scrolls the zen thumbnail strip sideways.
  useHorizontalWheel(zenStripRef, Boolean(prefs.zenMode && zenGallery.length && zenGalleryOpen));
  // .bottom-fade is fixed and full width: keep it off the gallery's scrollbar.
  React.useEffect(() => {
    const gallery = galleryStageRef.current as HTMLElement | null;
    if (prefs.zenMode || !gallery) return;
    const update = () => {
      // With "both-edges" the gutter is mirrored on the left; only the right half is the scrollbar.
      const gutters = gallery.offsetWidth - gallery.clientWidth;
      const mirrored = getComputedStyle(gallery).scrollbarGutter.includes("both-edges");
      gallery.style.setProperty("--scrollbar-w", `${mirrored ? gutters / 2 : gutters}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(gallery);
    return () => observer.disconnect();
  }, [prefs.zenMode]);
  // One compact dock, bottom right, in both layouts. Transient actions (tidy up,
  // cancel queue) rise above it as small chips, so the dock never changes size.
  const dockChip = { initial: { opacity: 0, y: 8, scale: 0.94 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 6, scale: 0.96 }, transition: { type: "spring" as const, duration: 0.34, bounce: 0 } };
  const studioDock = (
    <div className="studio-dock">
      <div className="dock-transients">
        <AnimatePresence initial={false}>
          {phoneDevice && prefs.fullStudioOnPhone ? (
            // Chose the full studio on a phone: the way back stays in plain sight.
            <motion.div key="simple" {...dockChip}>
              <button type="button" className="dock-chip" onClick={() => setPrefs({ fullStudioOnPhone: false })}>
                <Smartphone size={14} />
                <span>Simple view</span>
              </button>
            </motion.div>
          ) : null}
          {runningCount ? (
            <motion.div key="cancel" {...dockChip}>
              <Tip content="Stop everything running and queued" side="left">
                <button type="button" className="dock-chip is-cancel" onClick={cancelQueue}>
                  <CircleStop size={14} />
                  <span>Stop</span>
                  <i className="dock-count"><AnimatedNumber value={runningCount} /></i>
                </button>
              </Tip>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      <ComfyConnectionDot status={comfyStatus} retrying={Boolean(comfyRetrying)} onClick={retryComfyStatus} />
      <Tip content={hiddenSpace ? "Back to the gallery" : hidden.enabled ? hidden.unlocked ? "Hidden · unlocked" : "Hidden · locked" : "Hidden"}>
        <button
          data-hidden-dock
          className={cn("icon-button hidden-dock-button", hiddenSpace && "active", hidden.enabled && hidden.unlocked && "is-open")}
          aria-label={hiddenSpace ? "Leave Hidden" : hidden.enabled && hidden.unlocked ? "Open Hidden, unlocked" : "Open Hidden"}
          aria-pressed={hiddenSpace}
          onClick={toggleHiddenSpace}
        >
          <LockKeyhole size={16} />
        </button>
      </Tip>
      <Tip content="Workflow Gallery"><button className="icon-button" aria-label="Workflow Gallery" onClick={() => setWorkflowGalleryOpen(true)}><GalleryHorizontalEnd size={16} /></button></Tip>
      <Tip content="Settings"><button className="icon-button" aria-label="Settings" onClick={() => setSettings(true)}><Settings size={16} /></button></Tip>
      {prefs.zenMode ? (
        <Tip content="Exit zen (Esc)"><button className="icon-button" aria-label="Exit zen" onClick={() => setZenMode(false)}><Minimize2 size={16} /></button></Tip>
      ) : (
        <Tip content="Zen mode"><button className="icon-button" aria-label="Enter zen mode" onClick={() => setZenMode(true)}><Maximize2 size={16} /></button></Tip>
      )}
    </div>
  );
  const hiddenBar = (
    <AnimatePresence>
      {hiddenSpace && !hiddenLocked ? (
        <motion.div
          key="hidden-bar"
          className="hidden-bar"
          initial={{ opacity: 0, y: -10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ type: "spring", duration: 0.4, bounce: 0.1 }}
        >
          <Tip content="Back to the gallery"><button type="button" data-hidden-exit className="hidden-bar-back" aria-label="Back to the gallery" onClick={toggleHiddenSpace}><ArrowLeft size={14} /></button></Tip>
          <span className="hidden-bar-title"><LockKeyhole size={13} /> Hidden{hiddenCount ? <i><AnimatedNumber value={hiddenCount} /></i> : null}</span>
          <Tip content="Lock Hidden"><button type="button" className="hidden-bar-lock" onClick={() => hidden.lock(true)}><Lock size={12} /> Lock</button></Tip>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
  // The gallery, its empty and offline stages and the lock: the same in every layout.
  const galleryBody = (
    <>
          {hiddenLocked || galleryCrossing ? <section className="gallery" /> : !galleryLoaded ? <section className="gallery virtual-gallery" style={{ "--gallery-columns": galleryColumnCount } as React.CSSProperties}><GallerySkeleton columns={galleryColumnCount} /></section> : renderedGallery.length ? (
            <StableGallery
              cancelJob={cancelJob}
              groups={galleryGroups}
              moments={features.moments && prefs.showMoments !== false}
              stackRuns={stackRuns}
              openRuns={openRuns}
              settleVersion={view.settleVersion}
              stackStyle={prefs.runStackStyle === "flow" ? "flow" : "burst"}
              setRunOpen={setRunOpen}
              onUnstack={unstackRun}
              onStackPress={phone ? setRunSheet : undefined}
              focusRun={focusRun}
              onFocused={() => setFocusRun("")}
              columns={galleryColumnCount}
              spanWide={Boolean(prefs.spanWideImages) && !phone}
              copyPromptAndToast={(item) => copyToClipboard(item.prompt || item.filename || "", "Prompt copied")}
              deleteItem={deleteItem}
              formatElapsed={formatElapsed}
              items={renderedGallery}
              openItem={openItem}
              scrollRef={galleryStageRef}
              smartUpscale={prefs.smartUpscale !== false}
              upscaleBusyIds={upscaleBusyIds}
              onUpscale={activateUpscale}
              onCancelUpscale={cancelUpscale}
              upscaleNotices={upscaleNotices}
              onDismissUpscaleNotice={dismissUpscaleNotice}
              titleFromPrompt={titleFromPrompt}
            />
          ) : searchOn ? (
            <SearchEmpty search={gallerySearch} hiddenSpace={Boolean(hiddenSpace)} onClear={() => { setGallerySearch(emptySearch); setSearchOpen(false); }} />
          ) : hiddenSpace && !comfyOffline ? (
            <section className="gallery"><div className="empty stage-empty hidden-empty">
              <div className="stage-mark"><LockMark className="stage-layer" stage="open" /></div>
              <div className="stage-copy">
                <h2>Nothing hidden yet</h2>
                <p>Generate here, or hide images from the gallery with <EyeOff size={13} className="inline-icon" />.</p>
              </div>
            </div></section>
          ) : (
            <EmptyStage
              known={Boolean(comfyStatus?.checked)}
              offline={Boolean(comfyOffline) || Boolean(comfyStatus?.restarting)}
              restarting={Boolean(comfyStatus?.restarting)}
              device={comfyStatus?.device}
              retrying={Boolean(comfyRetrying)}
              onRetry={retryComfyStatus}
              onOpenConnection={() => openSettings("connection")}
              comfyUrl={comfyStatus?.url || health?.comfyUrl}
              nearby={comfyStatus?.nearby}
              onNoComfy={() => setNoComfyOpen(true)}
              noModels={Boolean(models) && !modelProfiles?.length}
              onFindModels={modelFolders?.openDialog}
              starter={mode === "image" ? starterModels : undefined}
            />
          )}
            {hiddenLockScreen}
          {renderedGallery.length && !hiddenLocked ? <ConnectedCard at={comfyReconnectedAt} device={comfyStatus?.device} /> : null}
            {galleryLoaded && hasMoreGallery && !hiddenSpace ? (
              <button className="gallery-load-more" onClick={loadMoreGalleryItems}>
                Load more
              </button>
            ) : null}
    </>
  );

  return (
    <GenerationPreviewMode.Provider value={prefs.generationPreviewMode}>
    <HiddenActionsContext.Provider value={hiddenActions}>
    <TileLongPressContext.Provider value={phoneTiles}>
    <FavoriteContext.Provider value={toggleFavorite}>
    <div className={cn(phone ? "phone-shell" : prefs.zenMode ? "zen-shell" : "app-shell", showNegativePrompt && canUseNegativePrompt && "negative-open", hiddenSpace && "is-hidden-space", hiddenLocked && "is-hidden-locked", passageClass)}>
      {phone ? <RunSheet run={runSheet} onClose={() => setRunSheet(null)} openItem={openItem} onShowInGallery={showRunInGallery} /> : null}
      {phone ? (
        <PhoneShell
          view={view}
          galleryBody={galleryBody}
          canUseNegativePrompt={canUseNegativePrompt}
          comfyOffline={Boolean(comfyOffline)}
          hiddenLocked={Boolean(hiddenLocked)}
          toggleHiddenSpace={toggleHiddenSpace}
          createOpen={phoneCreate}
          setCreateOpen={setPhoneCreate}
          itemActions={phoneItemActions}
          actionsFor={phoneActionsFor}
          setActionsFor={setPhoneActionsFor}
          selection={phoneSelection}
          setSelection={setPhoneSelection}
        />
      ) : prefs.zenMode ? (
        <>
          <div className="zen-stage">
            {hiddenLocked ? null : zenDisplayItem?.run ? (
              <RunCard key={zenDisplayItem.run.id} run={zenDisplayItem.run} onOpen={() => showRunInGallery(zenDisplayItem.run)} />
            ) : zenDisplayItem ? (
              <button
                aria-label={zenDisplayItem.status === "pending" ? "Generating" : "Open in the viewer"}
                className={cn("zen-output", viewerZoom > 1 && "is-zoomed", isDraggingViewer && "is-dragging", zenDisplayItem.status === "pending" && "is-pending")}
                onClick={() => {
                  if (zenDisplayItem.status === "pending") return;
                  if (Date.now() - viewerDragEndRef.current < 220) return;
                  if (viewerDragRef.current?.moved) return;
                  openItem(zenDisplayItem);
                }}
                ref={viewerWheelRef}
                onPointerDown={startViewerDrag}
                onPointerMove={dragViewer}
                onPointerUp={stopViewerDrag}
                onPointerCancel={stopViewerDrag}
                onTouchStart={startViewerTouch}
                onTouchMove={moveViewerTouch}
                onTouchEnd={endViewerTouch}
                onTouchCancel={endViewerTouch}
                style={{ "--tile-ratio": `${zenDisplayItem.width || 1} / ${zenDisplayItem.height || 1}`, "--zoom": viewerZoom, "--pan-x": `${viewerPan.x}px`, "--pan-y": `${viewerPan.y}px` } as React.CSSProperties}
              >
                <GenerationMedia item={zenDisplayItem} muted fit="contain">
                {zenDisplayItem.status === "pending" ? <GenerationProgress item={zenDisplayItem} formatElapsed={formatElapsed} /> : null}
                </GenerationMedia>
              </button>
            ) : galleryCrossing ? null : !galleryLoaded ? (
              <div className="zen-empty skeleton-stage">
                <Skeleton className="skeleton-logo" />
              </div>
            ) : hiddenSpace ? (
              <div className="zen-empty hidden-empty">
                <div className="stage-mark"><LockMark className="stage-layer" stage="open" /></div>
                <p>Nothing hidden yet</p>
              </div>
            ) : (
              <div className="zen-empty">
                <img src="/heiss-mark-white.svg" alt="HEISS UI" />
              </div>
            )}
            {hiddenLockScreen}
            <div className="zen-fade" />
            <div className="bottom-fade" />
          </div>
          {zenGallery.length > 1 ? (
            <div className="zen-arrows">
              <Tip content="Previous output"><button aria-label="Previous output" onClick={() => moveZen(-1)}><ChevronLeft size={22} /></button></Tip>
              <Tip content="Next output"><button aria-label="Next output" onClick={() => moveZen(1)}><ChevronRight size={22} /></button></Tip>
            </div>
          ) : null}
          <Tip content="Controls"><button data-open-trigger className="zen-control-button" aria-label="Controls" aria-expanded={Boolean(zenControls)} aria-controls="studio-controls" onClick={() => setZenControls((value: boolean) => !value)}>
            <PanelLeft size={16} />
          </button></Tip>
          {zenItem && !zenItem.run ? (
            <div className={cn("zen-zoom-dock", zenControls && "with-side")}>
              <Tip content="Zoom out (-)"><button className="icon-button" aria-label="Zoom out" onClick={() => zoomViewer(viewerZoom - 0.25)} disabled={viewerZoom <= 0.5}><ZoomOut size={15} /></button></Tip>
              <Tip content="Reset zoom (0)"><button className="text-button viewer-zoom" aria-label={`Reset zoom, now ${Math.round(viewerZoom * 100)}%`} onClick={resetViewer}>{viewerZoom !== 1 ? <RotateCcw size={13} /> : null} {Math.round(viewerZoom * 100)}%</button></Tip>
              <Tip content="Zoom in (+)"><button className="icon-button" aria-label="Zoom in" onClick={() => zoomViewer(viewerZoom + 0.25)} disabled={viewerZoom >= 6}><ZoomIn size={15} /></button></Tip>
            </div>
          ) : null}
          {zenGallery.length && !zenGalleryOpen ? (
            <Tip content="Show gallery"><button data-open-trigger className="zen-gallery-restore" aria-label="Show gallery" onClick={() => setZenGalleryOpen(true)}>
              <ChevronDown size={16} />
            </button></Tip>
          ) : null}
          {studioDock}
          {hiddenBar}
          {zenControls ? <button className="sidebar-dismiss" aria-label="Close controls" onClick={() => setZenControls(false)} /> : null}
          <aside id="studio-controls" translate="no" data-open-surface className={cn("zen-controls", zenControls && "open")} inert={!zenControls} aria-label="Generation controls">
            {sidebarControls}
          </aside>
          <section className="zen-prompt">
            <textarea ref={zenPromptRef} aria-label={hiddenSpace ? "Prompt (Hidden)" : "Prompt"} value={prompt} placeholder={referenceInpaint?.mask ? "Describe what the painted part becomes…" : hiddenSpace ? "Describe what to make, privately…" : "Describe what to make…"} onKeyDown={promptKeyDown} onChange={(event) => setPrompt(clampText(event.target.value, promptLimit))} />
            {nearTextLimit(prompt, promptLimit) ? <span className={cn("prompt-count", promptRemaining === 0 && "limit")}>{characterMeta(prompt, promptLimit)}</span> : null}
            <div data-open-surface className={cn("negative-drawer", showNegativePrompt && canUseNegativePrompt && "open", !canUseNegativePrompt && "is-unavailable")}>
              <label className="negative-drawer-label">Negative prompt</label>
              <div className="negative-unavailable-frame">
                <textarea aria-label="Negative prompt" value={canUseNegativePrompt ? negative : ""} disabled={!canUseNegativePrompt} placeholder={canUseNegativePrompt ? "What to avoid…" : "This model takes no negative prompt"} onChange={(event) => setNegative(clampText(event.target.value, negativeLimit))} />
              </div>
              <span>{canUseNegativePrompt ? characterMeta(negative, negativeLimit) : "Unavailable for this model"}</span>
            </div>
            <StableComposerBar
              models={models}
              model={model}
              modelProfiles={modelProfiles}
              showInpaint={prefs.inpainting !== false}
              profileBadges={profileBadges}
              chooseModel={pickModel}
              modelMenu={modelMenu}
              currentProfile={currentProfile}
              comfyOffline={Boolean(comfyOffline)}
              comfyRestarting={Boolean(comfyStatus?.restarting)}
              onFindModels={thisComputer ? modelFolders?.openDialog : undefined}
              onGetModels={thisComputer ? openGetModels : undefined}
              strayModelCount={strayModelCount}
              mode={mode}
              aspectPickerValue={aspectPickerValue}
              aspectOptions={aspectOptions}
              aspectValue={aspectValue}
              defaultAspectSize={defaultAspectSize}
              applyAspect={applyAspect}
              autoUpscale={prefs.autoUpscale || "none"}
              onAutoUpscaleChange={smartUpscaleTabs ? view.chooseAutoUpscale : undefined}
              customSize={Boolean(customSize)}
              aspectLocked={Boolean(aspectLocked)}
              width={width}
              widthMeta={widthMeta}
              setWidth={setWidth}
              height={height}
              heightMeta={heightMeta}
              setHeight={setHeight}
              steps={steps}
              stepsMeta={stepsMeta}
              setSteps={setSteps}
              count={count}
              countMeta={countMeta}
              setCount={setCount}
              loraActiveCount={loraActiveCount}
              hiddenSpace={Boolean(hiddenSpace)}
              onOpenLoras={view.openLoras}
              showNegativePrompt={showNegativePrompt}
              setShowNegativePrompt={setShowNegativePrompt}
              canUseNegativePrompt={canUseNegativePrompt}
              runningCount={runningCount}
              generateDisabled={Boolean(generateDisabled)}
              generateDisabledReason={generateDisabledReason}
              generate={generate}
              refreshComfyStatus={retryComfyStatus}
              comfyRetrying={Boolean(comfyRetrying)}
              referenceInputs={referenceInputs}
              referenceInpaint={referenceInpaint}
              loraMismatch={view.loraMismatch}
              onDismissLoraMismatch={view.dismissLoraMismatch}
              referenceAssets={referenceAssets}
              onReferenceSelect={selectReferenceAsset}
              onReferenceRemove={removeReferenceAsset}
              onReferenceDeleteRequest={(asset) => confirmAction({ title: `Delete ${asset.name}?`, description: "It’s removed from uploads.", action: "Delete", destructive: true })}
              onReferenceError={(message) => showToast(message, "error")}
              pinnedSeed={view.seed}
              onRandomSeed={() => view.setSeed("")}
              generationEstimate={view.generationEstimate}
              generateKey={view.generateKey}
              onToggleHistory={hasPromptHistory ? toggleHistory : undefined}
              historyOpen={historyOpen}
            />
            {historyPopover}
            {promptIdeas}
          </section>
          {zenGallery.length && zenGalleryOpen && !hiddenLocked ? (
            <div data-open-surface className="zen-gallery-wrap">
              <Tip content="Hide gallery"><button className="zen-gallery-toggle" aria-label="Hide gallery" onClick={() => setZenGalleryOpen(false)}><ChevronUp size={16} /></button></Tip>
              {zenGallery[0]?.id !== zenItem?.id ? <Tip content="Jump to latest output"><button className="zen-latest" onClick={goLatestZen}>Latest</button></Tip> : null}
              <ZenStrip
                items={zenGallery}
                activeId={zenItem?.id}
                stripRef={zenStripRef}
                onPointerDown={startZenStripDrag}
                onPointerMove={dragZenStrip}
                onPointerUp={stopZenStripDrag}
                onSelect={selectZenItem}
                titleFromPrompt={titleFromPrompt}
              />
            </div>
          ) : null}
        </>
      ) : (
        <>
          <main ref={galleryStageRef} className="stage-gallery" onScroll={onGalleryScroll}>
            {galleryBody}
            <div className="bottom-fade" />
          </main>
          {studioDock}
          {hiddenBar}
          {hiddenLocked ? null : <GallerySearchBar search={gallerySearch} setSearch={setGallerySearch} count={hiddenSpace ? renderedGallery.length : view.galleryTotalApprox} open={searchOpen} setOpen={setSearchOpen} hiddenSpace={Boolean(hiddenSpace)} islandsHeight={islandsHeight} />}
          <Tip content="Controls"><button data-open-trigger className="zen-control-button" aria-label="Controls" aria-expanded={Boolean(zenControls)} aria-controls="studio-controls" onClick={() => setZenControls((value: boolean) => !value)}>
            <PanelLeft size={16} />
          </button></Tip>
          {hiddenLocked ? null : <GallerySearchButton search={gallerySearch} open={searchOpen} setOpen={setSearchOpen} />}
          {/* Only a grid with videos in it has previews to pause. */}
          {hiddenLocked || !renderedGallery.some((item: GalleryItem) => item.type === 'video') ? null : <GridAutoplayButton />}
          {hiddenLocked ? null : <StackRunsButton on={Boolean(prefs.stackRuns)} disabled={searchOn} onToggle={() => setPrefs({ stackRuns: !prefs.stackRuns })} />}
          {zenControls ? <button className="sidebar-dismiss" aria-label="Close controls" onClick={() => setZenControls(false)} /> : null}
          <aside id="studio-controls" translate="no" data-open-surface className={cn("zen-controls", zenControls && "open")} inert={!zenControls} aria-label="Generation controls">
            {sidebarControls}
          </aside>
          <section className="zen-prompt">
            <textarea ref={zenPromptRef} aria-label={hiddenSpace ? "Prompt (Hidden)" : "Prompt"} value={prompt} placeholder={referenceInpaint?.mask ? "Describe what the painted part becomes…" : hiddenSpace ? "Describe what to make, privately…" : "Describe what to make…"} onKeyDown={promptKeyDown} onChange={(event) => setPrompt(clampText(event.target.value, promptLimit))} />
            {nearTextLimit(prompt, promptLimit) ? <span className={cn("prompt-count", promptRemaining === 0 && "limit")}>{characterMeta(prompt, promptLimit)}</span> : null}
            <div data-open-surface className={cn("negative-drawer", showNegativePrompt && canUseNegativePrompt && "open", !canUseNegativePrompt && "is-unavailable")}>
              <label className="negative-drawer-label">Negative prompt</label>
              <div className="negative-unavailable-frame">
                <textarea aria-label="Negative prompt" value={canUseNegativePrompt ? negative : ""} disabled={!canUseNegativePrompt} placeholder={canUseNegativePrompt ? "What to avoid…" : "This model takes no negative prompt"} onChange={(event) => setNegative(clampText(event.target.value, negativeLimit))} />
              </div>
              <span>{canUseNegativePrompt ? characterMeta(negative, negativeLimit) : "Unavailable for this model"}</span>
            </div>
            <StableComposerBar
              models={models}
              model={model}
              modelProfiles={modelProfiles}
              showInpaint={prefs.inpainting !== false}
              profileBadges={profileBadges}
              chooseModel={pickModel}
              modelMenu={modelMenu}
              currentProfile={currentProfile}
              comfyOffline={Boolean(comfyOffline)}
              comfyRestarting={Boolean(comfyStatus?.restarting)}
              onFindModels={thisComputer ? modelFolders?.openDialog : undefined}
              onGetModels={thisComputer ? openGetModels : undefined}
              strayModelCount={strayModelCount}
              mode={mode}
              aspectPickerValue={aspectPickerValue}
              aspectOptions={aspectOptions}
              aspectValue={aspectValue}
              defaultAspectSize={defaultAspectSize}
              applyAspect={applyAspect}
              autoUpscale={prefs.autoUpscale || "none"}
              onAutoUpscaleChange={smartUpscaleTabs ? view.chooseAutoUpscale : undefined}
              customSize={Boolean(customSize)}
              aspectLocked={Boolean(aspectLocked)}
              width={width}
              widthMeta={widthMeta}
              setWidth={setWidth}
              height={height}
              heightMeta={heightMeta}
              setHeight={setHeight}
              steps={steps}
              stepsMeta={stepsMeta}
              setSteps={setSteps}
              count={count}
              countMeta={countMeta}
              setCount={setCount}
              loraActiveCount={loraActiveCount}
              hiddenSpace={Boolean(hiddenSpace)}
              onOpenLoras={view.openLoras}
              showNegativePrompt={showNegativePrompt}
              setShowNegativePrompt={setShowNegativePrompt}
              canUseNegativePrompt={canUseNegativePrompt}
              runningCount={runningCount}
              generateDisabled={Boolean(generateDisabled)}
              generateDisabledReason={generateDisabledReason}
              generate={generate}
              refreshComfyStatus={retryComfyStatus}
              comfyRetrying={Boolean(comfyRetrying)}
              referenceInputs={referenceInputs}
              referenceInpaint={referenceInpaint}
              loraMismatch={view.loraMismatch}
              onDismissLoraMismatch={view.dismissLoraMismatch}
              referenceAssets={referenceAssets}
              onReferenceSelect={selectReferenceAsset}
              onReferenceRemove={removeReferenceAsset}
              onReferenceDeleteRequest={(asset) => confirmAction({ title: `Delete ${asset.name}?`, description: "It’s removed from uploads.", action: "Delete", destructive: true })}
              onReferenceError={(message) => showToast(message, "error")}
              pinnedSeed={view.seed}
              onRandomSeed={() => view.setSeed("")}
              generationEstimate={view.generationEstimate}
              generateKey={view.generateKey}
              onToggleHistory={hasPromptHistory ? toggleHistory : undefined}
              historyOpen={historyOpen}
            />
            {historyPopover}
            {promptIdeas}
          </section>
        </>
      )}
      <SettingsDialog view={view} open={Boolean(settings)} section={settingsSection} onSectionChange={setSettingsSection} onClose={() => setSettings(false)} onGetModels={thisComputer ? () => { setSettings(false); openGetModels(); } : undefined} />
      <NoComfySheet open={noComfyOpen} onOpenChange={setNoComfyOpen} onChangeAddress={thisComputer ? () => openSettings("connection") : undefined} />
      <GetModelsSheet open={getModelsOpen} onOpenChange={setGetModelsOpen} showToast={showToast} onStarted={view.onStarterStarted} onUse={view.selectStarterModel} onFindModels={thisComputer ? modelFolders?.openDialog : undefined} />
      <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <FeedbackHost />
      {modelFolders ? <ModelFoldersDialog folders={modelFolders} runningCount={runningCount} /> : null}
      <UpscaleSetupDialog
        setup={upscaleSetup}
        status={upscaleStatus}
        install={upscaleInstall}
        reason={upscaleUnavailableReason}
        quality={upscaleSetup.quality}
        comfyUrl={health?.comfyUrl}
        onQualityChange={(upscaleQuality) => setPrefs({ upscaleQuality })}
        onOpenLibrary={() => { upscaleSetup.closeSetup(); openSettings("library"); }}
        showToast={showToast}
      />
      <ActivityColumn activities={[upscaleActivity, modelActivity, updateActivity, generationActivity]} onHeight={setIslandsHeight} />
      <HiddenSetupDialog hidden={hidden} comfyOnline={Boolean(comfyStatus?.connected)} comfyUrl={health?.comfyUrl} onRecheck={refreshComfyStatus} onDone={() => { if (!hidden.intent || hidden.intent.kind === "enter") hidden.setSpace("hidden"); }} onChooseFolder={() => { resumeHiddenSetup.current = true; hidden.setSetupOpen(false); openSettings("library"); }} />
      <HiddenUnlockSheet hidden={hidden} />
      {active ? (() => {
        const hasNeighbors = ((view.viewerGallery || []) as GalleryItem[]).length > 1;
        return (
          <div className="scrim" role="dialog" aria-modal="true" aria-label="Image viewer" data-focus-trap tabIndex={-1} onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            if (Date.now() - viewerDragEndRef.current < 200) return;
            setActive(null);
          }} ref={setViewerNode}>
            <div className="viewer-shell" onClick={(event) => event.stopPropagation()}>
              <div className={cn("viewer-stage", showDetails && "with-side")} data-viewer-empty>
                <div
                  className={cn("viewer-canvas", active.type === 'video' && 'is-video', viewerZoom > 1 && "is-zoomed", isDraggingViewer && "is-dragging")}
                  data-open-surface
                  style={{ "--zoom": viewerZoom, "--pan-x": `${viewerPan.x}px`, "--pan-y": `${viewerPan.y}px` } as React.CSSProperties}
                  ref={viewerWheelRef}
                  onPointerDown={startViewerDrag}
                  onPointerMove={dragViewer}
                  onPointerUp={stopViewerDrag}
                  onPointerCancel={stopViewerDrag}
                  onTouchStart={startViewerTouch}
                  onTouchMove={moveViewerTouch}
                  onTouchEnd={endViewerTouch}
                  onTouchCancel={endViewerTouch}
                  onClick={clickViewer}
                  onDoubleClick={(event) => { event.stopPropagation(); zoomViewer(viewerZoom > 1 ? 1 : 2.5); }}
                >
                  {active.status === "error" ? <FailurePanel item={active} onCopy={copyToClipboard} onReuse={() => { applyAllSettings(active); setActive(null); }} fixes={view.failureFixes} showToast={showToast} onNodesInstalled={() => { refreshModels(false); refreshWorkflows(); }} /> : compareOpen && active.upscale?.url && !upscaledWithRun(active) ? <UpscaleCompare item={active} zoomed={viewerZoom > 1} /> : (
                  <GenerationMedia item={active} fit="contain">
                  {active.status === "pending" ? <GenerationProgress item={active} formatElapsed={formatElapsed} /> : null}
                  </GenerationMedia>
                  )}
                </div>
                {hasNeighbors ? (
                  <>
                    <Tip content="Previous"><button className="viewer-arrow prev" aria-label="Previous output" onClick={() => moveViewer(-1)}><ChevronLeft size={20} /></button></Tip>
                    <Tip content="Next"><button className="viewer-arrow next" aria-label="Next output" onClick={() => moveViewer(1)}><ChevronRight size={20} /></button></Tip>
                  </>
                ) : null}
                {showDetails ? (
                  <aside translate="no" data-open-surface className="viewer-side" onWheel={(event) => event.stopPropagation()}>
                    <div className="viewer-side-head">
                      <h3>Details</h3>
                    </div>
                    <div className="viewer-side-body">
                      <div className="prompt-readout">
                        <span>Prompt</span>
                        <div className="readout-box">
                          <p>{active.prompt || "No prompt recorded"}</p>
                          <Tip content="Copy prompt"><button className="readout-copy" aria-label="Copy prompt" onClick={() => viewerCopy.copyWith(() => copyToClipboard(active.prompt || ""), "prompt")}><CopyIcon copied={viewerCopy.copied === "prompt"} size={13} /></button></Tip>
                        </div>
                      </div>
                      {active.negative ? (
                        <div className="prompt-readout">
                          <span>Negative</span>
                          <div className="readout-box">
                            <p>{active.negative}</p>
                            <Tip content="Copy negative prompt"><button className="readout-copy" aria-label="Copy negative prompt" onClick={() => viewerCopy.copyWith(() => copyToClipboard(active.negative || ""), "negative")}><CopyIcon copied={viewerCopy.copied === "negative"} size={13} /></button></Tip>
                          </div>
                        </div>
                      ) : null}
                      <ViewerActions
                        item={active}
                        copied={viewerCopy.copied === "settings"}
                        onUseSettings={() => applyAllSettings(active)}
                        onCopySettings={() => viewerCopy.copyWith(() => copyToClipboard(settingsText(active)), "settings")}
                        onUseLoras={() => applyLoras(active)}
                        onUseAsReference={canUseStartImage && active.status === "done" && active.type === "image" && active.url && !active.vaultLocked && !active.library ? () => useOutputAsStartImage(active) : undefined}
                      />
                      {generationDetailEntries(active).length ? (
                        <details className="settings-disclosure" open={showGenerationSettings} onToggle={(event) => setShowGenerationSettings(event.currentTarget.open)}>
                          <summary>Generation settings</summary>
                          {generationDetailEntries(active).map((section: { title: string; rows: Array<[string, string]> }) => (
                            <div className="detail-section" key={section.title}>
                              <h4>{section.title}</h4>
                              <div className="detail-grid">
                                {section.rows.map(([key, value], index) => (
                                  <React.Fragment key={`${key}-${index}`}>
                                    <span>{key}</span><strong>{value}</strong>
                                  </React.Fragment>
                                ))}
                              </div>
                            </div>
                          ))}
                        </details>
                      ) : null}
                    </div>
                  </aside>
                ) : null}
                {phone ? (
                  <>
                    {upscaleNotices?.get(active.id) ? (
                      <div className="viewer-phone-notice"><UpscaleNoticePopover notice={upscaleNotices.get(active.id)} placement="viewer" onDismiss={() => dismissUpscaleNotice(active.id)} /></div>
                    ) : null}
                    <PhoneViewerBar
                      item={active}
                      actions={phoneItemActions}
                      showDetails={Boolean(showDetails)}
                      onToggleDetails={() => setShowDetails((value: boolean) => !value)}
                      compareOpen={Boolean(compareOpen)}
                      onToggleCompare={() => { setCompareOpen((value) => !value); if (!compareOpen) resetViewer(); }}
                    />
                  </>
                ) : (
                <div data-open-trigger className={cn("viewer-dock", showDetails && "with-side")}>
                  <Tip content="Zoom out (-)"><button className="icon-button is-zoom-control" aria-label="Zoom out" onClick={() => zoomViewer(viewerZoom - 0.25)} disabled={viewerZoom <= 0.5}><ZoomOut size={15} /></button></Tip>
                  <Tip content="Reset zoom (0)"><button className="text-button viewer-zoom is-zoom-control" aria-label={`Reset zoom, now ${Math.round(viewerZoom * 100)}%`} onClick={resetViewer}>{viewerZoom > 1 ? <RotateCcw size={13} /> : null} {Math.round(viewerZoom * 100)}%</button></Tip>
                  <Tip content="Zoom in (+)"><button className="icon-button is-zoom-control" aria-label="Zoom in" onClick={() => zoomViewer(viewerZoom + 0.25)} disabled={viewerZoom >= 6}><ZoomIn size={15} /></button></Tip>
                  <span className="viewer-divider is-zoom-control" />
                  <Tip content={active.url ? active.type === "image" ? "Copy image" : "Copy output link" : "Copy generation details"}><button className="icon-button" aria-label={active.url ? active.type === "image" ? "Copy image" : "Copy output link" : "Copy generation details"} onClick={() => viewerCopy.copyWith(() => copyItemToClipboard(active), "item")}><CopyIcon copied={viewerCopy.copied === "item"} size={15} /></button></Tip>
                  {canStar(active) ? (
                    <Tip content={active.favorite ? "Unstar (F)" : "Star (F)"}>
                      <button className={cn("icon-button viewer-star", active.favorite && "is-on")} aria-label={active.favorite ? "Unstar" : "Star"} aria-pressed={Boolean(active.favorite)} onClick={() => toggleFavorite([active], !active.favorite)}>
                        <Star size={15} fill={active.favorite ? "currentColor" : "none"} />
                      </button>
                    </Tip>
                  ) : null}
                  {active.status === "done" && active.url && !active.vaultLocked && !active.library ? <Tip content="Vary with a new seed"><button className="icon-button" aria-label="Vary this" onClick={() => view.varyItem(active)}><Shuffle size={15} /></button></Tip> : null}
                  {canUseStartImage && active.status === "done" && active.type === "image" && active.url && !active.vaultLocked && !active.library ? <Tip content="Use as reference image"><button className="icon-button" aria-label="Use as reference image" onClick={() => useOutputAsStartImage(active)}><ImagePlus size={15} /></button></Tip> : null}
                  {prefs.smartUpscale !== false && canUpscaleItem(active) ? (
                    <span className="upscale-notice-anchor">
                    {upscaleNotices?.get(active.id) ? <UpscaleNoticePopover notice={upscaleNotices.get(active.id)} placement="viewer" onDismiss={() => dismissUpscaleNotice(active.id)} /> : null}
                    <ViewerUpscaleButton item={active} busy={Boolean(upscaleBusyIds?.has(active.id))} onCancel={cancelUpscale} onActivate={activateUpscale} />
                    </span>
                  ) : null}
                  {active.upscale?.url && !upscaledWithRun(active) ? (
                    <Tip content={compareOpen ? "Hide the comparison" : "Compare with the original"}>
                      <button
                        className={cn("icon-button", compareOpen && "active")}
                        aria-label="Compare with the original"
                        aria-pressed={compareOpen}
                        onClick={() => { setCompareOpen((value) => !value); if (!compareOpen) resetViewer(); }}
                      >
                        <Columns2 size={15} />
                      </button>
                    </Tip>
                  ) : null}
                  {active.status === "done" && active.url && !active.library ? (
                    active.privateVault
                      ? <Tip content="Move to gallery"><button className="icon-button" aria-label="Move to gallery" onClick={() => unhideItems([active])}><Eye size={15} /></button></Tip>
                      : <Tip content="Move to Hidden"><button className="icon-button" aria-label="Move to Hidden" onClick={() => hideItems([active])}><EyeOff size={15} /></button></Tip>
                  ) : null}
                  {active.url ? <Tip content={active.upscaleActive && !upscaledWithRun(active) ? "Download the upscale" : "Download"}><a className="icon-button" aria-label={active.upscaleActive && !upscaledWithRun(active) ? "Download the upscale" : "Download"} href={downloadUrl(active)} download><Download size={15} /></a></Tip> : null}
                  <Tip content="Delete (Del)"><button className="icon-button danger-tone" aria-label={active.privateVault ? "Delete from Hidden" : "Delete from gallery"} onClick={() => deleteItem(active)}><Trash2 size={15} /></button></Tip>
                  <span className="viewer-divider" />
                  <Tip content={showDetails ? "Hide details" : "Show details"}><button className={cn("icon-button", showDetails && "active")} aria-label="Toggle details" aria-pressed={showDetails} onClick={() => setShowDetails((value: boolean) => !value)}><SlidersHorizontal size={15} /></button></Tip>
                  <Tip content="Close (Esc)"><button className="icon-button viewer-dock-close" aria-label="Close" onClick={() => setActive(null)}><X size={16} /></button></Tip>
                </div>
                )}
                {/* Phones and tablets: the dock has no room for Close, so it sits in the corner. */}
                <button className="viewer-close" aria-label="Close viewer" onClick={() => setActive(null)}><X size={18} /></button>
              </div>
            </div>
          </div>
        );
      })() : null}
      {workflowGalleryOpen ? <WorkflowGallery view={{ ...view, onClose: () => setWorkflowGalleryOpen(false) }} /> : null}
      {/* Generation progress for screen readers: started, rendering, ready. */}
      <div className="sr-only" role="status" aria-live="polite">{view.status && view.status !== "Ready" && !/^Rendering|^Queued/.test(view.status) ? view.status : ""}</div>
      {/* Portaled to <body>: inside the fixed shell it would sit under every dialog's scrim. */}
      <Toaster offset={islandsHeight ? islandsHeight + 8 : 0} />
    </div>
    </FavoriteContext.Provider>
    </TileLongPressContext.Provider>
    </HiddenActionsContext.Provider>
    </GenerationPreviewMode.Provider>
  );
}

/**
 * The viewer's upscale button. Its own component, so a running upscale's
 * clock re-renders this alone each second; the tip and a small count beside
 * the icon say how long is left once the time is known.
 */
function ViewerUpscaleButton({ item, busy, onCancel, onActivate }: { item: GalleryItem; busy: boolean; onCancel: (item: GalleryItem) => void; onActivate: (item: GalleryItem) => void }) {
  const running = item.upscale?.status === "running";
  const clock = useUpscaleClock(item);
  const tip = upscaleTooltip(item, clock.leftMs);
  return (
    <Tip content={tip}>
      <button
        className={cn("icon-button", item.upscaleActive && item.upscale?.url && "active", running && clock.leftMs !== null && "has-count")}
        aria-label={running ? tip : "Smart upscale"}
        aria-pressed={item.upscale?.url ? Boolean(item.upscaleActive) : undefined}
        disabled={busy}
        onClick={() => running ? onCancel(item) : onActivate(item)}
      >
        {busy ? <RefreshCw size={15} className="spin" /> : running ? <Square size={11} fill="currentColor" strokeWidth={0} /> : <UpscaleArrow size={16} />}
        {running && clock.leftMs !== null ? <span className="viewer-upscale-left" aria-hidden="true">{shortLeft(clock.leftMs)}</span> : null}
      </button>
    </Tip>
  );
}

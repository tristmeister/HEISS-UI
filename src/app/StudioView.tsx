import React from 'react';
import { createPortal } from 'react-dom';
import { Toaster } from 'sonner';
import { ArrowLeft, BrushCleaning, ChevronDown, CircleStop, Columns2, ChevronLeft, ChevronRight, ChevronUp, Copy, Download, Eye, EyeOff, GalleryHorizontalEnd, ImagePlus, Layers, Lock, LockKeyhole, Maximize2, Minimize2, PanelLeft, Plug, RefreshCw, RotateCcw, Settings, SlidersHorizontal, Square, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn, nearTextLimit } from './format';
import { GallerySkeleton, Media, Skeleton, Tip } from './components';
import { useHorizontalWheel, useWheelRef } from './wheel';
import { AnimatedNumber } from './AnimatedNumber';
import { GenerationMedia, GenerationPreviewMode } from './GenerationPreview';
import { ElapsedTime } from './ElapsedTime';
import { ComposerBar } from './ComposerBar';
import { VirtualMasonryGallery } from './VirtualMasonryGallery';
import { UpscaleArrow } from './UpscaleArrow';
import { UpscaleCompare } from './UpscaleCompare';
import { canUpscaleItem } from './useUpscale';
import { UpscaleSetupDialog } from './UpscaleDialogs';
import { ModelFoldersDialog } from './ModelFoldersDialog';
import { UpscaleNoticePopover } from './UpscaleNotice';
import { UpscaleDownloadWidget, useUpscaleDownloadWidget } from './UpscaleDownloadWidget';
import { FailurePanel } from './GenerationFailure';
import { ModelDownloadWidget, useModelDownloadWidget } from './ModelDownloadWidget';
import { WorkflowGallery } from './WorkflowGallery';
import { HiddenLockScreen, HiddenUnlockSheet } from './HiddenLock';
import { HiddenSetupDialog } from './HiddenSetup';
import { HiddenActionsContext } from './hiddenContext';
import { LockMark } from './LockMark';
import { downloadUrl } from './GalleryTile';
import { ConnectedCard } from './ConnectedCard';
import { EmptyStage } from './EmptyStage';
import { SettingsDialog, type SettingsSection } from './SettingsDialog';
import type { GalleryItem } from './types';
import type { HiddenState } from './useHidden';

function comfyStatusLabel(status: any) {
  if (status?.checking) return "Checking ComfyUI...";
  if (status?.connected) {
    const detail = [status.device, status.latencyMs ? `${status.latencyMs}ms` : "", status.version ? `v${status.version}` : ""].filter(Boolean).join(" • ");
    return `ComfyUI connected${detail ? ` • ${detail}` : ""}`;
  }
  return `ComfyUI offline${status?.url ? ` • ${status.url}` : ""}${status?.error ? ` • ${status.error}` : ""}`;
}

function ComfyConnectionDot({ status, retrying, onClick }: { status: any; retrying: boolean; onClick: () => void }) {
  const state = status?.checking || retrying ? "checking" : status?.connected ? "connected" : "disconnected";
  return (
    <Tip content={comfyStatusLabel(status)}>
      <button className={`comfy-status-dot is-${state}`} aria-label={comfyStatusLabel(status)} onClick={onClick}>
        <span />
      </button>
    </Tip>
  );
}

export function StudioView({ view }: { view: Record<string, any> }) {
  const { active, applyAllSettings, applyLoras, applyAspect, aspectOptions, aspectPickerValue, aspectValue, aspectLocked, defaultAspectSize, canUseStartImage, cancelJob, cancelQueue, characterMeta, clickViewer, comfyStatus, compactGallery, compactBusy, pendingBundles, gatheringIds, settlingBundles, setBundleCover, ungroupBundle, copyAndToast, copyImageAndToast, count, countMeta, currentProfile, customSize, deleteItem, zenGallery, formatElapsed, galleryColumnCount, galleryLoaded, galleryStageRef, generate, generateDisabled, generateDisabledReason, generationDetailEntries, goLatestZen, hasMoreGallery, height, heightMeta, isDraggingViewer, loadMoreGalleryItems, loraActiveCount, mode, model, modelProfiles, models, moveViewer, moveViewerTouch, moveZen, negative, negativeLimit, onGalleryScroll, openItem, prefs, hiddenSpace, hideItems, unhideItems, profileBadges, prompt, promptLimit, refreshComfyStatus, removeReferenceAsset, renderedGallery, resetViewer, runningCount, selectReferenceAsset, setActive, setCount, setHeight, setNegative, setPrompt, setSettings, setShowDetails, setShowGenerationSettings, setShowNegativePrompt, setSteps, setWidth, setWorkflowGalleryOpen, setZenControls, setZenGalleryOpen, setZenMode, showDetails, settings, showGenerationSettings, showNegativePrompt, showToast, sidebarControls, startViewerDrag, startViewerTouch, steps, stepsMeta, stopViewerDrag, submitZenPrompt, useOutputAsStartImage, viewerDragEndRef, viewerDragRef, viewerPan, viewerZoom, wheelViewer, width, widthMeta, workflowGalleryOpen, zenControls, zenDisplayItem, zenGalleryOpen, zenItem, zenPromptRef, zenStripRef, dragViewer, dragZenStrip, endViewerTouch, selectZenItem, startZenStripDrag, stopZenStripDrag, titleFromPrompt, zoomViewer, clampText, promptRemaining, chooseModel, visibleGallery, upscaleBusyIds, activateUpscale, cancelUpscale, upscaleDisplayUrl, upscaleSetup, upscaleStatus, upscaleInstall, upscaleUnavailableReason, health, setPrefs, upscaleNotices, dismissUpscaleNotice, refreshModels, refreshWorkflows, modelFolders } = view;
  const strayModelCount = (modelFolders?.report?.folders || []).reduce((sum: number, folder: { count: number }) => sum + folder.count, 0);
  const canUseNegativePrompt = currentProfile?.capabilities?.negativePrompt !== false;
  const { confirmAction, referenceAssets, referenceInputs, referenceStrength, retryComfyStatus, comfyRetrying, comfyReconnectedAt } = view;
  const hidden = view.hidden as HiddenState;
  // Hidden, locked (or mid-unlock): the lock takes the gallery's place.
  const hiddenLocked = hiddenSpace && (!hidden.unlocked || hidden.unlockStage === "opening");
  // Stable across renders, so the memoised tiles do not all redraw when anything changes.
  const hideRef = React.useRef(hideItems);
  const unhideRef = React.useRef(unhideItems);
  hideRef.current = hideItems;
  unhideRef.current = unhideItems;
  const hiddenActions = React.useMemo(() => ({
    space: hidden.space,
    hide: (items: GalleryItem[]) => hideRef.current(items),
    unhide: (items: GalleryItem[]) => unhideRef.current(items)
  }), [hidden.space]);
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
    if (!hidden.unlocked && hidden.hasPasskey && hidden.support?.available) hidden.unlockBiometric();
  };
  const hiddenCount = hiddenSpace ? renderedGallery.filter((item: GalleryItem) => item.status === "done").length : 0;
  const hiddenLockScreen = (
    <AnimatePresence>
      {hiddenLocked ? <HiddenLockScreen key="lock" hidden={hidden} onLeave={() => hidden.setSpace("gallery")} onSetup={() => hidden.ensureReady({ kind: "enter" })} /> : null}
    </AnimatePresence>
  );
  const comfyOffline = comfyStatus && !comfyStatus.connected && !comfyStatus.checking;
  const [settingsSection, setSettingsSection] = React.useState<SettingsSection>("general");
  const openSettings = React.useCallback((section?: SettingsSection) => {
    if (section) setSettingsSection(section);
    setSettings(true);
  }, [setSettings]);
  // Expansion is a view concern: a run stays grouped once created, it just
  // opens and closes in place.
  const [expandedBundles, setExpandedBundles] = React.useState<Set<string>>(() => new Set());
  const upscaleWidget = useUpscaleDownloadWidget(upscaleSetup, upscaleInstall);
  // A text encoder or VAE landing rescans models, so every panel catches up at once.
  const modelWidget = useModelDownloadWidget({
    onDone: () => { refreshModels(false); refreshWorkflows(); },
    onError: (item) => showToast(item.error || `${item.label} failed to download`, "error")
  });
  // Two pills share the top edge; the upscale one wins, the toaster moves for either.
  const downloadWidget = { visible: upscaleWidget.visible || (modelWidget.visible && !workflowGalleryOpen) };
  const [compareOpen, setCompareOpen] = React.useState(false);
  // A different image has its own comparison, so never carry the mode over.
  React.useEffect(() => { setCompareOpen(false); }, [active?.id]);
  const viewerWheelRef = useWheelRef<HTMLElement>(wheelViewer);
  // Only Ctrl+wheel (page zoom) is swallowed, so the details panel still scrolls.
  const scrimWheelRef = useWheelRef<HTMLDivElement>((event) => { if (event.ctrlKey) event.preventDefault(); });
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
  const toggleBundle = React.useCallback((bundleId: string) => {
    setExpandedBundles((current) => {
      const next = new Set(current);
      if (next.has(bundleId)) next.delete(bundleId); else next.add(bundleId);
      return next;
    });
  }, []);
  // One compact dock, bottom right, in both layouts. Transient actions (tidy up,
  // cancel queue) rise above it as small chips, so the dock never changes size.
  const dockChip = { initial: { opacity: 0, y: 8, scale: 0.94 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 6, scale: 0.96 }, transition: { type: "spring" as const, duration: 0.34, bounce: 0 } };
  const studioDock = (
    <div className="studio-dock">
      <div className="dock-transients">
        <AnimatePresence initial={false}>
          {!prefs.zenMode && pendingBundles.runs > 0 ? (
            <motion.div key="tidy" {...dockChip}>
              <Tip content={`Group ${pendingBundles.items} outputs from ${pendingBundles.runs} finished run${pendingBundles.runs === 1 ? "" : "s"} into stacks`} side="left">
                <button type="button" className="dock-chip gallery-tidy" onClick={compactGallery} disabled={compactBusy}>
                  <BrushCleaning size={14} />
                  <span>{compactBusy ? "Grouping" : "Group runs"}</span>
                  <i className="dock-count"><AnimatedNumber value={pendingBundles.runs} /></i>
                </button>
              </Tip>
            </motion.div>
          ) : null}
          {runningCount ? (
            <motion.div key="cancel" {...dockChip}>
              <Tip content="Stop all running and queued generations and upscales" side="left">
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
      <Tip content={hiddenSpace ? "Back to the gallery" : hidden.enabled ? hidden.unlocked ? "Hidden" : "Hidden · locked" : "Hidden"}>
        <button
          data-hidden-dock
          className={cn("icon-button hidden-dock-button", hiddenSpace && "active", hidden.enabled && hidden.unlocked && "is-open")}
          aria-label={hiddenSpace ? "Leave Hidden" : "Open Hidden"}
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
  return (
    <GenerationPreviewMode.Provider value={prefs.generationPreviewMode}>
    <HiddenActionsContext.Provider value={hiddenActions}>
    <div className={cn(prefs.zenMode ? "zen-shell" : "app-shell", showNegativePrompt && "negative-open", hiddenSpace && "is-hidden-space", hiddenLocked && "is-hidden-locked", passageClass)}>
      {prefs.zenMode ? (
        <>
          <div className="zen-stage">
            {hiddenLocked ? null : zenDisplayItem ? (
              <button
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
                {zenDisplayItem.status === "pending" ? (() => {
                  const ratio = zenDisplayItem.progress?.max ? Math.min(1, Math.max(0, zenDisplayItem.progress.value / zenDisplayItem.progress.max)) : 0;
                  const indeterminate = !zenDisplayItem.progress?.max;
                  return (
                    <div className="generation-progress" style={{ "--progress-ratio": ratio } as React.CSSProperties}>
                      <div className="generate-overlay">
                        <span className="generate-step">
                          {zenDisplayItem.progress?.max ? (
                            <>
                              <span className="generate-step-label">Step</span>
                              <span className="generate-step-count">
                                <AnimatePresence mode="wait">
                                  <motion.span
                                    key={zenDisplayItem.progress.value}
                                    initial={{ opacity: 0, y: 3 }}
                                    animate={{ opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const } }}
                                    exit={{ opacity: 0, y: -3, transition: { duration: 0.1 } }}
                                  >
                                    {zenDisplayItem.progress.value}
                                  </motion.span>
                                </AnimatePresence>
                                <i>/</i>{zenDisplayItem.progress.max}
                              </span>
                            </>
                          ) : (
                            <span className="generate-step-label is-queued">Queued</span>
                          )}
                        </span>
                        <span className="generate-elapsed"><ElapsedTime startedAt={zenDisplayItem.createdAt} format={formatElapsed} /></span>
                      </div>
                      <div className={cn("generate-bar", indeterminate && "is-indeterminate")}>
                        <div className="generate-bar-fill" />
                      </div>
                    </div>
                  );
                })() : null}
                </GenerationMedia>
              </button>
            ) : !galleryLoaded ? (
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
          {zenDisplayItem?.bundle ? (
            <div className="zen-run-badge">
              <Layers size={12} />
              <span>{zenDisplayItem.bundle.reasonLabel}</span>
              <i>{zenDisplayItem.bundle.count}</i>
            </div>
          ) : null}
          {zenGallery.length > 1 ? (
            <div className="zen-arrows">
              <Tip content="Previous output"><button aria-label="Previous output" onClick={() => moveZen(-1)}><ChevronLeft size={22} /></button></Tip>
              <Tip content="Next output"><button aria-label="Next output" onClick={() => moveZen(1)}><ChevronRight size={22} /></button></Tip>
            </div>
          ) : null}
          <Tip content="Controls"><button data-open-trigger className="zen-control-button" aria-label="Controls" onClick={() => setZenControls((value: boolean) => !value)}>
            <PanelLeft size={16} />
          </button></Tip>
          {zenItem ? (
            <div className={cn("zen-zoom-dock", zenControls && "with-side")}>
              <Tip content="Zoom out (-)"><button className="icon-button" aria-label="Zoom out" onClick={() => zoomViewer(viewerZoom - 0.25)} disabled={viewerZoom <= 0.5}><ZoomOut size={15} /></button></Tip>
              <Tip content="Reset zoom (0)"><button className="text-button viewer-zoom" onClick={resetViewer}>{viewerZoom !== 1 ? <RotateCcw size={13} /> : null} {Math.round(viewerZoom * 100)}%</button></Tip>
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
          <aside data-open-surface className={cn("zen-controls", zenControls && "open")}>
            {sidebarControls}
          </aside>
          <section className="zen-prompt">
            <textarea ref={zenPromptRef} value={prompt} placeholder={hiddenSpace ? "Describe what to make, privately..." : "Describe what to make..."} onKeyDown={submitZenPrompt} onChange={(event) => setPrompt(clampText(event.target.value, promptLimit))} />
            {nearTextLimit(prompt, promptLimit) ? <span className={cn("prompt-count", promptRemaining === 0 && "limit")}>{characterMeta(prompt, promptLimit)}</span> : null}
            <div data-open-surface className={cn("negative-drawer", showNegativePrompt && "open", !canUseNegativePrompt && "is-unavailable")}>
              <label className="negative-drawer-label">Negative prompt</label>
              <div className="negative-unavailable-frame">
                <textarea value={canUseNegativePrompt ? negative : ""} disabled={!canUseNegativePrompt} placeholder={canUseNegativePrompt ? "What to avoid..." : "This workflow does not expose a negative prompt"} onChange={(event) => setNegative(clampText(event.target.value, negativeLimit))} />
              </div>
              <span>{canUseNegativePrompt ? characterMeta(negative, negativeLimit) : "Unavailable for this workflow"}</span>
            </div>
            <ComposerBar
              models={models}
              model={model}
              modelProfiles={modelProfiles}
              profileBadges={profileBadges}
              chooseModel={chooseModel}
              currentProfile={currentProfile}
              comfyOffline={Boolean(comfyOffline)}
              onFindModels={modelFolders?.openDialog}
              strayModelCount={strayModelCount}
              mode={mode}
              aspectPickerValue={aspectPickerValue}
              aspectOptions={aspectOptions}
              aspectValue={aspectValue}
              defaultAspectSize={defaultAspectSize}
              applyAspect={applyAspect}
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
              referenceStrength={referenceStrength}
              referenceAssets={referenceAssets}
              onReferenceSelect={selectReferenceAsset}
              onReferenceRemove={removeReferenceAsset}
              onReferenceDeleteRequest={(asset) => confirmAction({ title: `Delete ${asset.name}?`, description: "This removes the uploaded image from your reference library.", action: "Delete upload", destructive: true })}
              onReferenceError={(message) => showToast(message, "error")}
            />
          </section>
          {zenGallery.length && zenGalleryOpen && !hiddenLocked ? (
            <div data-open-surface className="zen-gallery-wrap">
              <Tip content="Hide gallery"><button className="zen-gallery-toggle" aria-label="Hide gallery" onClick={() => setZenGalleryOpen(false)}><ChevronUp size={16} /></button></Tip>
              {zenGallery[0]?.id !== zenItem?.id ? <Tip content="Jump to latest output"><button className="zen-latest" onClick={goLatestZen}>Latest</button></Tip> : null}
              <div
                ref={zenStripRef}
                className="zen-gallery-strip"
                onPointerDown={startZenStripDrag}
                onPointerMove={dragZenStrip}
                onPointerUp={stopZenStripDrag}
                onPointerCancel={stopZenStripDrag}
              >
                {zenGallery.map((item: GalleryItem) => (
                  <Tip key={item.id} content={item.bundle ? `${item.bundle.reasonLabel} · ${item.bundle.count} outputs` : titleFromPrompt(item.prompt || item.filename)}><button data-zen-id={item.id} className={cn(item.id === zenItem?.id && "active", item.bundle && "is-run")} onClick={(event) => { event.stopPropagation(); selectZenItem(item.id); }} onDragStart={(event) => event.preventDefault()}>
                    <Media item={item} muted />
                    {item.bundle ? <span className="zen-run-count" aria-hidden="true"><Layers size={9} />{item.bundle.count}</span> : null}
                  </button></Tip>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <main ref={galleryStageRef} className="stage-gallery" onScroll={onGalleryScroll}>
          {hiddenLocked ? <section className="gallery" /> : !galleryLoaded ? <section className="gallery" style={{ "--gallery-columns": galleryColumnCount } as React.CSSProperties}><GallerySkeleton columns={galleryColumnCount} /></section> : renderedGallery.length ? (
            <VirtualMasonryGallery
              cancelJob={cancelJob}
              expandedBundles={expandedBundles}
              gatheringIds={gatheringIds}
              settlingBundles={settlingBundles}
              setBundleCover={setBundleCover}
              toggleBundle={toggleBundle}
              ungroupBundle={ungroupBundle}
              columns={galleryColumnCount}
              copyPromptAndToast={(item) => copyAndToast(item.prompt || item.filename || "", "Prompt copied")}
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
              offline={Boolean(comfyOffline)}
              device={comfyStatus?.device}
              retrying={Boolean(comfyRetrying)}
              onRetry={retryComfyStatus}
              onOpenConnection={() => openSettings("connection")}
            />
          )}
            {hiddenLockScreen}
          {renderedGallery.length && !hiddenLocked ? <ConnectedCard at={comfyReconnectedAt} device={comfyStatus?.device} /> : null}
            {galleryLoaded && hasMoreGallery && !hiddenSpace ? (
              <button className="gallery-load-more" onClick={loadMoreGalleryItems}>
                Load more
              </button>
            ) : null}
            <div className="bottom-fade" />
          </main>
          {studioDock}
          {hiddenBar}
          <Tip content="Controls"><button data-open-trigger className="zen-control-button" aria-label="Controls" onClick={() => setZenControls((value: boolean) => !value)}>
            <PanelLeft size={16} />
          </button></Tip>
          {zenControls ? <button className="sidebar-dismiss" aria-label="Close controls" onClick={() => setZenControls(false)} /> : null}
          <aside data-open-surface className={cn("zen-controls", zenControls && "open")}>
            {sidebarControls}
          </aside>
          <section className="zen-prompt">
            <textarea ref={zenPromptRef} value={prompt} placeholder={hiddenSpace ? "Describe what to make, privately..." : "Describe what to make..."} onKeyDown={submitZenPrompt} onChange={(event) => setPrompt(clampText(event.target.value, promptLimit))} />
            {nearTextLimit(prompt, promptLimit) ? <span className={cn("prompt-count", promptRemaining === 0 && "limit")}>{characterMeta(prompt, promptLimit)}</span> : null}
            <div data-open-surface className={cn("negative-drawer", showNegativePrompt && "open", !canUseNegativePrompt && "is-unavailable")}>
              <label className="negative-drawer-label">Negative prompt</label>
              <div className="negative-unavailable-frame">
                <textarea value={canUseNegativePrompt ? negative : ""} disabled={!canUseNegativePrompt} placeholder={canUseNegativePrompt ? "What to avoid..." : "This workflow does not expose a negative prompt"} onChange={(event) => setNegative(clampText(event.target.value, negativeLimit))} />
              </div>
              <span>{canUseNegativePrompt ? characterMeta(negative, negativeLimit) : "Unavailable for this workflow"}</span>
            </div>
            <ComposerBar
              models={models}
              model={model}
              modelProfiles={modelProfiles}
              profileBadges={profileBadges}
              chooseModel={chooseModel}
              currentProfile={currentProfile}
              comfyOffline={Boolean(comfyOffline)}
              onFindModels={modelFolders?.openDialog}
              strayModelCount={strayModelCount}
              mode={mode}
              aspectPickerValue={aspectPickerValue}
              aspectOptions={aspectOptions}
              aspectValue={aspectValue}
              defaultAspectSize={defaultAspectSize}
              applyAspect={applyAspect}
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
              referenceStrength={referenceStrength}
              referenceAssets={referenceAssets}
              onReferenceSelect={selectReferenceAsset}
              onReferenceRemove={removeReferenceAsset}
              onReferenceDeleteRequest={(asset) => confirmAction({ title: `Delete ${asset.name}?`, description: "This removes the uploaded image from your reference library.", action: "Delete upload", destructive: true })}
              onReferenceError={(message) => showToast(message, "error")}
            />
          </section>
        </>
      )}
      <SettingsDialog view={view} open={Boolean(settings)} section={settingsSection} onSectionChange={setSettingsSection} onClose={() => setSettings(false)} />
      {modelFolders ? <ModelFoldersDialog folders={modelFolders} runningCount={runningCount} /> : null}
      <UpscaleSetupDialog
        setup={upscaleSetup}
        status={upscaleStatus}
        install={upscaleInstall}
        reason={upscaleUnavailableReason}
        quality={prefs.upscaleQuality || "balanced"}
        comfyUrl={health?.comfyUrl}
        onQualityChange={(upscaleQuality) => setPrefs({ upscaleQuality })}
        onOpenLibrary={() => { upscaleSetup.closeSetup(); openSettings("library"); }}
        showToast={showToast}
      />
      <UpscaleDownloadWidget widget={upscaleWidget} setup={upscaleSetup} install={upscaleInstall} />
      <ModelDownloadWidget widget={modelWidget} hidden={upscaleWidget.visible || workflowGalleryOpen} onOpen={() => setWorkflowGalleryOpen(true)} />
      <HiddenSetupDialog hidden={hidden} comfyOnline={Boolean(comfyStatus?.connected)} comfyUrl={health?.comfyUrl} onRecheck={refreshComfyStatus} onDone={() => { if (!hidden.intent || hidden.intent.kind === "enter") hidden.setSpace("hidden"); }} onChooseFolder={() => { hidden.setSetupOpen(false); openSettings("library"); }} />
      <HiddenUnlockSheet hidden={hidden} />
      {active ? (() => {
        const viewerItems = visibleGallery.filter((item: GalleryItem) => item.status === "pending" || item.status === "done" || item.status === "error");
        const hasNeighbors = viewerItems.length > 1;
        return (
          <div className="scrim" onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            if (Date.now() - viewerDragEndRef.current < 200) return;
            setActive(null);
          }} ref={scrimWheelRef}>
            <div className="viewer-shell" onClick={(event) => event.stopPropagation()}>
              <div className={cn("viewer-stage", showDetails && "with-side")} data-viewer-empty>
                <div
                  className={cn("viewer-canvas", viewerZoom > 1 && "is-zoomed", isDraggingViewer && "is-dragging")}
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
                  {active.status === "error" ? <FailurePanel item={active} onCopy={copyAndToast} onReuse={() => { applyAllSettings(active); setActive(null); }} /> : compareOpen && active.upscale?.url ? <UpscaleCompare item={active} zoomed={viewerZoom > 1} /> : (
                  <GenerationMedia item={active} fit="contain">
                  {active.status === "pending" ? (() => {
                    const ratio = active.progress?.max ? Math.min(1, Math.max(0, active.progress.value / active.progress.max)) : 0;
                    return (
                      <div className="generation-progress" style={{ "--progress-ratio": ratio } as React.CSSProperties}>
                      <div className="generate-overlay">
                          <span className="generate-step">
                            {active.progress?.max ? (
                              <>
                                <span className="generate-step-label">Step</span>
                                <span className="generate-step-count">
                                  <AnimatePresence mode="wait">
                                    <motion.span
                                      key={active.progress.value}
                                      initial={{ opacity: 0, y: 3 }}
                                      animate={{ opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const } }}
                                      exit={{ opacity: 0, y: -3, transition: { duration: 0.1 } }}
                                    >
                                      {active.progress.value}
                                    </motion.span>
                                  </AnimatePresence>
                                  <i>/</i>{active.progress.max}
                                </span>
                              </>
                            ) : (
                              <span className="generate-step-label is-queued">Queued</span>
                            )}
                          </span>
                          <span className="generate-elapsed"><ElapsedTime startedAt={active.createdAt} format={formatElapsed} /></span>
                        </div>
                        <div className={cn("generate-bar", !active.progress?.max && "is-indeterminate")}><div className="generate-bar-fill" /></div>
                      </div>
                    );
                  })() : null}
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
                  <aside data-open-surface className="viewer-side" onWheel={(event) => event.stopPropagation()}>
                    <div className="viewer-side-head">
                      <h3>Details</h3>
                    </div>
                    <div className="viewer-side-body">
                      <div className="prompt-readout">
                        <span>Prompt</span>
                        <div className="readout-box">
                          <p>{active.prompt || "No prompt recorded"}</p>
                          <Tip content="Copy prompt"><button className="readout-copy" aria-label="Copy prompt" onClick={() => copyAndToast(active.prompt || "", "Prompt copied")}><Copy size={13} /></button></Tip>
                        </div>
                      </div>
                      {active.negative ? (
                        <div className="prompt-readout">
                          <span>Negative</span>
                          <div className="readout-box">
                            <p>{active.negative}</p>
                            <Tip content="Copy negative prompt"><button className="readout-copy" aria-label="Copy negative prompt" onClick={() => copyAndToast(active.negative || "", "Negative prompt copied")}><Copy size={13} /></button></Tip>
                          </div>
                        </div>
                      ) : null}
                      <Tip content="Copy this output's full settings into the generator"><button className="copy-all-settings" onClick={() => applyAllSettings(active)}>Copy all settings</button></Tip>
                      <Tip content="Copy this output's LoRA stack into the generator"><button className="copy-all-settings" onClick={() => applyLoras(active)}>Copy LoRAs</button></Tip>
                      {canUseStartImage && active.status === "done" && active.type === "image" && active.url && !active.vaultLocked ? (
                        <Tip content="Use this output as the next reference image"><button className="copy-all-settings" onClick={() => useOutputAsStartImage(active)}>Use as reference</button></Tip>
                      ) : null}
                      {generationDetailEntries(active).length ? (
                        <details className="settings-disclosure" open={showGenerationSettings} onToggle={(event) => setShowGenerationSettings(event.currentTarget.open)}>
                          <summary>Generation settings</summary>
                          <div className="detail-grid">
                            {generationDetailEntries(active).map(([key, value]: [string, string]) => (
                              <React.Fragment key={key}>
                                <span>{key}</span><strong>{value}</strong>
                              </React.Fragment>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  </aside>
                ) : null}
                <div data-open-trigger className={cn("viewer-dock", showDetails && "with-side")}>
                  <Tip content="Zoom out (-)"><button className="icon-button" aria-label="Zoom out" onClick={() => zoomViewer(viewerZoom - 0.25)} disabled={viewerZoom <= 0.5}><ZoomOut size={15} /></button></Tip>
                  <Tip content="Reset zoom (0)"><button className="text-button viewer-zoom" onClick={resetViewer}>{viewerZoom > 1 ? <RotateCcw size={13} /> : null} {Math.round(viewerZoom * 100)}%</button></Tip>
                  <Tip content="Zoom in (+)"><button className="icon-button" aria-label="Zoom in" onClick={() => zoomViewer(viewerZoom + 0.25)} disabled={viewerZoom >= 6}><ZoomIn size={15} /></button></Tip>
                  <span className="viewer-divider" />
                  <Tip content={active.url ? active.type === "image" ? "Copy image" : "Copy output link" : "Copy generation details"}><button className="icon-button" aria-label={active.url ? active.type === "image" ? "Copy image" : "Copy output link" : "Copy generation details"} onClick={() => copyImageAndToast(active)}><Copy size={15} /></button></Tip>
                  {canUseStartImage && active.status === "done" && active.type === "image" && active.url && !active.vaultLocked ? <Tip content="Use as reference image"><button className="icon-button" aria-label="Use as reference image" onClick={() => useOutputAsStartImage(active)}><ImagePlus size={15} /></button></Tip> : null}
                  {prefs.smartUpscale !== false && canUpscaleItem(active) ? (
                    <span className="upscale-notice-anchor">
                    {upscaleNotices?.get(active.id) ? <UpscaleNoticePopover notice={upscaleNotices.get(active.id)} placement="viewer" onDismiss={() => dismissUpscaleNotice(active.id)} /> : null}
                    <Tip content={active.upscale?.status === "running" ? "Upscaling · click to stop" : active.upscale?.url ? (active.upscaleActive ? "Showing the upscale - click for the original" : "Showing the original - click for the upscale") : "Smart upscale"}>
                      <button
                        className={cn("icon-button", active.upscaleActive && active.upscale?.url && "active")}
                        aria-label="Smart upscale"
                        aria-pressed={active.upscale?.url ? Boolean(active.upscaleActive) : undefined}
                        disabled={upscaleBusyIds?.has(active.id)}
                        onClick={() => active.upscale?.status === "running" ? cancelUpscale(active) : activateUpscale(active)}
                      >
                        {upscaleBusyIds?.has(active.id) ? <RefreshCw size={15} className="spin" /> : active.upscale?.status === "running" ? <Square size={11} fill="currentColor" strokeWidth={0} /> : <UpscaleArrow size={16} />}
                      </button>
                    </Tip>
                    </span>
                  ) : null}
                  {active.upscale?.url ? (
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
                  {active.status === "done" && active.url ? (
                    active.privateVault
                      ? <Tip content="Move to gallery"><button className="icon-button" aria-label="Move to gallery" onClick={() => unhideItems([active])}><Eye size={15} /></button></Tip>
                      : <Tip content="Hide"><button className="icon-button" aria-label="Hide" onClick={() => hideItems([active])}><EyeOff size={15} /></button></Tip>
                  ) : null}
                  {active.url ? <Tip content={active.upscaleActive ? "Download the upscale" : "Download file"}><a className="icon-button" aria-label="Download file" href={downloadUrl(active)} download><Download size={15} /></a></Tip> : null}
                  <Tip content="Delete (Del)"><button className="icon-button danger-tone" aria-label={active.privateVault ? "Delete from Hidden" : "Delete from gallery"} onClick={() => deleteItem(active)}><Trash2 size={15} /></button></Tip>
                  <span className="viewer-divider" />
                  <Tip content={showDetails ? "Hide details" : "Show details"}><button className={cn("icon-button", showDetails && "active")} aria-label="Toggle details" aria-pressed={showDetails} onClick={() => setShowDetails((value: boolean) => !value)}><SlidersHorizontal size={15} /></button></Tip>
                  <Tip content="Close (Esc)"><button className="icon-button" aria-label="Close" onClick={() => setActive(null)}><X size={16} /></button></Tip>
                </div>
              </div>
            </div>
          </div>
        );
      })() : null}
      {workflowGalleryOpen ? <WorkflowGallery view={{ ...view, onClose: () => setWorkflowGalleryOpen(false) }} /> : null}
      {/* The shell is position: fixed, a stacking context of its own, so a toaster
          inside it sits under every portaled dialog and its blurred scrim. */}
      {createPortal(<Toaster theme="dark" position="top-center" richColors closeButton toastOptions={{ className: "heiss-toast" }} offset={downloadWidget.visible ? { top: 88 } : undefined} mobileOffset={downloadWidget.visible ? { top: 80 } : undefined} />, document.body)}
    </div>
    </HiddenActionsContext.Provider>
    </GenerationPreviewMode.Provider>
  );
}

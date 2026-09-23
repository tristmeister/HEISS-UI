import React from 'react';
import { createPortal } from 'react-dom';
import { Toaster } from 'sonner';
import { BrushCleaning, ChevronDown, CircleStop, Columns2, ChevronLeft, ChevronRight, ChevronUp, Copy, Download, GalleryHorizontalEnd, ImagePlus, Layers, LockKeyhole, Maximize2, Minimize2, PanelLeft, Plug, RefreshCw, RotateCcw, Settings, SlidersHorizontal, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn, nearTextLimit } from './format';
import { GallerySkeleton, Media, Skeleton, Tip } from './components';
import { AnimatedNumber } from './AnimatedNumber';
import { GenerationMedia, GenerationPreviewMode } from './GenerationPreview';
import { ElapsedTime } from './ElapsedTime';
import { ComposerBar } from './ComposerBar';
import { VirtualMasonryGallery } from './VirtualMasonryGallery';
import { UpscaleArrow } from './UpscaleArrow';
import { UpscaleCompare } from './UpscaleCompare';
import { canUpscaleItem } from './useUpscale';
import { UpscaleSetupDialog } from './UpscaleDialogs';
import { UpscaleNoticePopover } from './UpscaleNotice';
import { UpscaleDownloadWidget, useUpscaleDownloadWidget } from './UpscaleDownloadWidget';
import { ModelDownloadWidget, useModelDownloadWidget } from './ModelDownloadWidget';
import { WorkflowGallery } from './WorkflowGallery';
import { Modal } from './Modal';
import { SettingsDialog, type SettingsSection } from './SettingsDialog';
import type { GalleryItem } from './types';

function comfyStatusLabel(status: any) {
  if (status?.checking) return "Checking ComfyUI...";
  if (status?.connected) {
    const detail = [status.device, status.latencyMs ? `${status.latencyMs}ms` : "", status.version ? `v${status.version}` : ""].filter(Boolean).join(" • ");
    return `ComfyUI connected${detail ? ` • ${detail}` : ""}`;
  }
  return `ComfyUI offline${status?.url ? ` • ${status.url}` : ""}${status?.error ? ` • ${status.error}` : ""}`;
}

function ComfyConnectionDot({ status, onClick }: { status: any; onClick: () => void }) {
  const state = status?.checking ? "checking" : status?.connected ? "connected" : "disconnected";
  return (
    <Tip content={comfyStatusLabel(status)}>
      <button className={`comfy-status-dot is-${state}`} aria-label={comfyStatusLabel(status)} onClick={onClick}>
        <span />
      </button>
    </Tip>
  );
}

export function StudioView({ view }: { view: Record<string, any> }) {
  const { active, applyAllSettings, applyLoras, applyAspect, aspectOptions, aspectPickerValue, aspectValue, aspectLocked, defaultAspectSize, canUseStartImage, cancelJob, cancelQueue, characterMeta, clickViewer, comfyStatus, compactGallery, compactBusy, pendingBundles, gatheringIds, settlingBundles, setBundleCover, ungroupBundle, copyAndToast, copyImageAndToast, count, countMeta, currentProfile, customSize, deleteItem, zenGallery, formatElapsed, galleryColumnCount, galleryLoaded, galleryStageRef, generate, generateDisabled, generateDisabledReason, generationDetailEntries, goLatestZen, hasMoreGallery, height, heightMeta, isDraggingViewer, loadMoreGalleryItems, loraActiveCount, mode, model, modelProfiles, models, moveViewer, moveViewerTouch, moveZen, negative, negativeLimit, onGalleryScroll, openItem, prefs, privateGeneration, privacyBusy, privacyPassword, privacyStatus, privacyGateDismissed, profileBadges, prompt, promptLimit, refreshComfyStatus, removeReferenceAsset, renderedGallery, resetViewer, runningCount, selectReferenceAsset, setActive, setCount, setHeight, setNegative, setPrivacyPassword, setPrivateGeneration, setPrompt, setSettings, setShowDetails, setShowGenerationSettings, setShowNegativePrompt, setSteps, setWidth, setWorkflowGalleryOpen, setZenControls, setZenGalleryOpen, setZenMode, showDetails, settings, showGenerationSettings, showNegativePrompt, showToast, sidebarControls, startViewerDrag, startViewerTouch, steps, stepsMeta, stopViewerDrag, submitZenPrompt, unlockPrivacy, useOutputAsStartImage, viewerDragEndRef, viewerDragRef, viewerPan, viewerZoom, wheelViewer, width, widthMeta, workflowGalleryOpen, zenControls, zenDisplayItem, zenGalleryOpen, zenItem, zenPromptRef, zenStripRef, dragViewer, dragZenStrip, endViewerTouch, selectZenItem, startZenStripDrag, stopZenStripDrag, titleFromPrompt, zoomViewer, clampText, promptRemaining, chooseModel, visibleGallery, upscaleBusyIds, activateUpscale, upscaleDisplayUrl, upscaleSetup, upscaleStatus, upscaleInstall, upscaleUnavailableReason, health, setPrefs, upscaleNotices, dismissUpscaleNotice, refreshModels, refreshWorkflows } = view;
  const canUseNegativePrompt = currentProfile?.capabilities?.negativePrompt !== false;
  const { confirmAction, referenceAssets, referenceInputs, referenceStrength } = view;
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
                  <span>{compactBusy ? "Grouping" : "Tidy up"}</span>
                  <i className="dock-count"><AnimatedNumber value={pendingBundles.runs} /></i>
                </button>
              </Tip>
            </motion.div>
          ) : null}
          {runningCount ? (
            <motion.div key="cancel" {...dockChip}>
              <Tip content="Cancel all running and queued generations" side="left">
                <button type="button" className="dock-chip is-cancel" onClick={cancelQueue}>
                  <CircleStop size={14} />
                  <span>Cancel</span>
                  <i className="dock-count"><AnimatedNumber value={runningCount} /></i>
                </button>
              </Tip>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      <ComfyConnectionDot status={comfyStatus} onClick={refreshComfyStatus} />
      <Tip content="Workflow Gallery"><button className="icon-button" aria-label="Workflow Gallery" onClick={() => setWorkflowGalleryOpen(true)}><GalleryHorizontalEnd size={16} /></button></Tip>
      <Tip content="Settings"><button className="icon-button" aria-label="Settings" onClick={() => setSettings(true)}><Settings size={16} /></button></Tip>
      {prefs.zenMode ? (
        <Tip content="Exit zen (Esc)"><button className="icon-button" aria-label="Exit zen" onClick={() => setZenMode(false)}><Minimize2 size={16} /></button></Tip>
      ) : (
        <Tip content="Zen mode"><button className="icon-button" aria-label="Enter zen mode" onClick={() => setZenMode(true)}><Maximize2 size={16} /></button></Tip>
      )}
    </div>
  );
  return (
    <GenerationPreviewMode.Provider value={prefs.generationPreviewMode}>
    <div className={cn(prefs.zenMode ? "zen-shell" : "app-shell", showNegativePrompt && "negative-open")}>
      {prefs.zenMode ? (
        <>
          <div className="zen-stage">
            {zenDisplayItem ? (
              <button
                className={cn("zen-output", viewerZoom > 1 && "is-zoomed", isDraggingViewer && "is-dragging", zenDisplayItem.status === "pending" && "is-pending")}
                onClick={() => {
                  if (zenDisplayItem.status === "pending") return;
                  if (Date.now() - viewerDragEndRef.current < 220) return;
                  if (viewerDragRef.current?.moved) return;
                  openItem(zenDisplayItem);
                }}
                onWheel={wheelViewer}
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
            ) : (
              <div className="zen-empty">
                <img src="/heiss-mark-white.svg" alt="HEISS UI" />
              </div>
            )}
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
          {zenControls ? <button className="sidebar-dismiss" aria-label="Close controls" onClick={() => setZenControls(false)} /> : null}
          <aside data-open-surface className={cn("zen-controls", zenControls && "open")}>
            {sidebarControls}
          </aside>
          <section className="zen-prompt">
            <textarea ref={zenPromptRef} value={prompt} placeholder="Describe what to make..." onKeyDown={submitZenPrompt} onChange={(event) => setPrompt(clampText(event.target.value, promptLimit))} />
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
              privateGeneration={privateGeneration}
              onPrivacySetup={() => openSettings("privacy")}
              onOpenLoras={view.openLoras}
              privacyEnabled={Boolean(privacyStatus?.enabled)}
              setPrivateGeneration={setPrivateGeneration}
              showNegativePrompt={showNegativePrompt}
              setShowNegativePrompt={setShowNegativePrompt}
              canUseNegativePrompt={canUseNegativePrompt}
              runningCount={runningCount}
              generateDisabled={Boolean(generateDisabled)}
              generateDisabledReason={generateDisabledReason}
              generate={generate}
              refreshComfyStatus={refreshComfyStatus}
              referenceInputs={referenceInputs}
              referenceStrength={referenceStrength}
              referenceAssets={referenceAssets}
              onReferenceSelect={selectReferenceAsset}
              onReferenceRemove={removeReferenceAsset}
              onReferenceDeleteRequest={(asset) => confirmAction({ title: `Delete ${asset.name}?`, description: "This removes the uploaded image from your reference library.", action: "Delete upload", destructive: true })}
              onReferenceError={(message) => showToast(message, "error")}
            />
          </section>
          {zenGallery.length && zenGalleryOpen ? (
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
          {!galleryLoaded ? <section className="gallery" style={{ "--gallery-columns": galleryColumnCount } as React.CSSProperties}><GallerySkeleton columns={galleryColumnCount} /></section> : renderedGallery.length ? (
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
              upscaleNotices={upscaleNotices}
              onDismissUpscaleNotice={dismissUpscaleNotice}
              titleFromPrompt={titleFromPrompt}
            />
          ) : comfyOffline ? (
            <section className="gallery"><div className="empty is-offline">
              <img src="/heiss-mark-black.svg" alt="HEISS UI" />
              <h2>ComfyUI is offline</h2>
              <p>Start ComfyUI to connect your studio.</p>
              <div className="empty-actions">
                <button className="reconnect-btn primary" onClick={refreshComfyStatus}><RefreshCw size={13} /> Retry connection</button>
                <button className="reconnect-btn" onClick={() => openSettings("connection")}><Plug size={13} /> Connection settings</button>
              </div>
            </div></section>
          ) : (
            <section className="gallery"><div className="empty">
              <img src="/heiss-mark-black.svg" alt="HEISS UI" />
              <h2>No outputs yet</h2>
              <p>Start with a prompt. Your creations will appear here.</p>
            </div></section>
          )}
            {galleryLoaded && hasMoreGallery ? (
              <button className="gallery-load-more" onClick={loadMoreGalleryItems}>
                Load more
              </button>
            ) : null}
            <div className="bottom-fade" />
          </main>
          {studioDock}
          <Tip content="Controls"><button data-open-trigger className="zen-control-button" aria-label="Controls" onClick={() => setZenControls((value: boolean) => !value)}>
            <PanelLeft size={16} />
          </button></Tip>
          {zenControls ? <button className="sidebar-dismiss" aria-label="Close controls" onClick={() => setZenControls(false)} /> : null}
          <aside data-open-surface className={cn("zen-controls", zenControls && "open")}>
            {sidebarControls}
          </aside>
          <section className="zen-prompt">
            <textarea ref={zenPromptRef} value={prompt} placeholder="Describe what to make..." onKeyDown={submitZenPrompt} onChange={(event) => setPrompt(clampText(event.target.value, promptLimit))} />
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
              privateGeneration={privateGeneration}
              onPrivacySetup={() => openSettings("privacy")}
              onOpenLoras={view.openLoras}
              privacyEnabled={Boolean(privacyStatus?.enabled)}
              setPrivateGeneration={setPrivateGeneration}
              showNegativePrompt={showNegativePrompt}
              setShowNegativePrompt={setShowNegativePrompt}
              canUseNegativePrompt={canUseNegativePrompt}
              runningCount={runningCount}
              generateDisabled={Boolean(generateDisabled)}
              generateDisabledReason={generateDisabledReason}
              generate={generate}
              refreshComfyStatus={refreshComfyStatus}
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
      {privacyStatus?.enabled && !privacyStatus.unlocked && !privacyGateDismissed && !settings ? (
        <Modal
          open
          onOpenChange={(open) => { if (!open) view.continueWithoutPrivacy(); }}
          size="alert"
          busy={privacyBusy}
          hideClose
          icon={<LockKeyhole size={17} />}
          title="Unlock HEISS UI"
          description="Enter the privacy password to decrypt prompts and private items, or continue to the normal gallery."
          footer={
            <>
              <button className="btn" onClick={view.continueWithoutPrivacy} disabled={privacyBusy}>View normal gallery</button>
              <button className="btn is-primary" onClick={unlockPrivacy} disabled={privacyBusy || !privacyPassword}>{privacyBusy ? "Unlocking…" : "Unlock"}</button>
            </>
          }
        >
          <input
            className="modal-input"
            type="password"
            autoComplete="current-password"
            value={privacyPassword}
            placeholder="Privacy password"
            aria-label="Privacy password"
            onChange={(event) => setPrivacyPassword(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") unlockPrivacy(); }}
            autoFocus
          />
        </Modal>
      ) : null}
      {active ? (() => {
        const viewerItems = visibleGallery.filter((item: GalleryItem) => item.status === "pending" || item.status === "done" || item.status === "error");
        const hasNeighbors = viewerItems.length > 1;
        return (
          <div className="scrim" onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            if (Date.now() - viewerDragEndRef.current < 200) return;
            setActive(null);
          }} onWheel={(event) => event.preventDefault()}>
            <div className="viewer-shell" onClick={(event) => event.stopPropagation()}>
              <div className={cn("viewer-stage", showDetails && "with-side")} data-viewer-empty>
                <div
                  className={cn("viewer-canvas", viewerZoom > 1 && "is-zoomed", isDraggingViewer && "is-dragging")}
                  data-open-surface
                  style={{ "--zoom": viewerZoom, "--pan-x": `${viewerPan.x}px`, "--pan-y": `${viewerPan.y}px` } as React.CSSProperties}
                  onWheel={wheelViewer}
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
                  {compareOpen && active.upscale?.url ? <UpscaleCompare item={active} zoomed={viewerZoom > 1} /> : (
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
                      <Tip content="Copy this output's full settings into the generator"><button className="copy-all-settings" onClick={() => applyAllSettings(active)}>Copy All Settings</button></Tip>
                      <Tip content="Copy this output's LoRA stack into the generator"><button className="copy-all-settings" onClick={() => applyLoras(active)}>Copy LoRAs</button></Tip>
                      {canUseStartImage && active.status === "done" && active.type === "image" && active.url && !active.vaultLocked ? (
                        <Tip content="Use this output as the next reference image"><button className="copy-all-settings" onClick={() => useOutputAsStartImage(active)}>Use as Reference</button></Tip>
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
                    <Tip content={active.upscale?.status === "running" ? "Upscaling" : active.upscale?.url ? (active.upscaleActive ? "Showing the upscale - click for the original" : "Showing the original - click for the upscale") : "Smart upscale"}>
                      <button
                        className={cn("icon-button", active.upscaleActive && active.upscale?.url && "active")}
                        aria-label="Smart upscale"
                        aria-pressed={active.upscale?.url ? Boolean(active.upscaleActive) : undefined}
                        disabled={active.upscale?.status === "running" || upscaleBusyIds?.has(active.id)}
                        onClick={() => activateUpscale(active)}
                      >
                        {active.upscale?.status === "running" || upscaleBusyIds?.has(active.id) ? <RefreshCw size={15} className="spin" /> : <UpscaleArrow size={16} />}
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
                  {active.url ? <Tip content={active.upscaleActive ? "Download the upscale" : "Download file"}><a className="icon-button" aria-label="Download file" href={upscaleDisplayUrl(active)} download><Download size={15} /></a></Tip> : null}
                  <Tip content="Delete (Del)"><button className="icon-button danger-tone" aria-label="Delete from gallery" onClick={() => deleteItem(active)}><Trash2 size={15} /></button></Tip>
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
    </GenerationPreviewMode.Provider>
  );
}

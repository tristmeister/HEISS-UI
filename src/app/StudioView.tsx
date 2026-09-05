import React from 'react';
import { Toaster } from 'sonner';
import { ArrowUp, BrushCleaning, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Download, GalleryHorizontalEnd, Github, ImagePlus, Layers, LockKeyhole, Maximize2, Minimize2, PanelLeft, Plug, RefreshCw, RotateCcw, Settings, SlidersHorizontal, Trash2, WifiOff, Wrench, X, ZoomIn, ZoomOut } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { githubUrl } from './constants';
import { cn } from './format';
import { AspectPicker, Field, GallerySkeleton, InfoTip, Media, ModelPicker, NumberPicker, Skeleton, StudioSelect as Select, Tip } from './components';
import { AnimatedNumber } from './AnimatedNumber';
import { GenerationMedia, GenerationPreviewMode } from './GenerationPreview';
import { ElapsedTime } from './ElapsedTime';
import { ComposerBar } from './ComposerBar';
import { VirtualMasonryGallery } from './VirtualMasonryGallery';
import { WorkflowGallery } from './WorkflowGallery';
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

const SETTINGS_TABS = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "connection", label: "Connection", icon: Plug },
  { id: "workflows", label: "Workflows", icon: Layers },
  { id: "gallery", label: "Gallery", icon: GalleryHorizontalEnd },
  { id: "privacy", label: "Privacy", icon: LockKeyhole },
  { id: "advanced", label: "Advanced", icon: Wrench }
] as const;

export function StudioView({ view }: { view: Record<string, any> }) {
  const { active, applyAllSettings, applyAspect, aspectOptions, aspectPickerValue, aspectValue, defaultAspectSize, canUseStartImage, cancelJob, cancelQueue, characterMeta, checkForUpdates, clearAllCache, clearFailedItems, clearGallery, clickViewer, comfyStatus, compactGallery, compactBusy, pendingBundles, gatheringIds, settlingBundles, setBundleCover, ungroupBundle, copyAndToast, copyImageAndToast, count, countMeta, currentProfile, customSize, deleteItem, zenGallery, formatElapsed, gallery, galleryColumnCount, galleryLoaded, galleryStageRef, generate, generationDetailEntries, goLatestZen, hasMoreGallery, health, height, heightMeta, importWorkflowFile, installUpdate, isDraggingViewer, isMobile, loadMoreGalleryItems, lockPrivacy, loraActiveCount, mode, model, modelProfiles, models, moveViewer, moveViewerTouch, moveZen, negative, negativeLimit, now, onGalleryScroll, openItem, openOutputFolder, outputDirDraft, paths, prefs, privateGeneration, privacyBusy, privacyConfirmPassword, privacyPassword, privacyStatus, profileBadges, prompt, promptLimit, refreshComfyStatus, refreshHealth, refreshModels, renderedGallery, resetAllSettings, resetViewer, runningCount, saveOutputDirectory, setActive, setCount, setHeight, setNegative, setOutputDirDraft, setPrivacyConfirmPassword, setPrivacyPassword, setPrivateGeneration, setPrompt, setSettings, setShowDetails, setShowGenerationSettings, setShowNegativePrompt, setSteps, setupPrivacyPassword, setWidth, setWorkflowGalleryOpen, setZenControls, setZenGalleryOpen, setZenMode, showDetails, settings, showGenerationSettings, showNegativePrompt, sidebarControls, startViewerDrag, startViewerTouch, steps, stepsMeta, stopViewerDrag, submitZenPrompt, unlockPrivacy, updateBusy, updateStatus, useOutputAsStartImage, viewerDragEndRef, viewerDragRef, viewerPan, viewerZoom, wheelViewer, width, widthMeta, workflowGalleryOpen, zenControls, zenDisplayItem, zenGalleryOpen, zenItem, zenPromptRef, zenStripRef, dragViewer, dragZenStrip, endViewerTouch, selectZenItem, startZenStripDrag, stopZenStripDrag, titleFromPrompt, zoomViewer, clampText, promptRemaining, chooseModel, visibleGallery, setPrefs } = view;
  const canUseNegativePrompt = currentProfile?.capabilities?.negativePrompt !== false;
  const comfyOffline = comfyStatus && !comfyStatus.connected && !comfyStatus.checking;
  const [settingsTab, setSettingsTab] = React.useState<string>("general");
  const [lanBusy, setLanBusy] = React.useState(false);
  const openLanUrl = React.useCallback(async () => {
    setLanBusy(true);
    try {
      const response = await fetch("/api/network");
      if (!response.ok) throw new Error("LAN address unavailable");
      const data = await response.json();
      const address = data.addresses?.[0];
      if (!address) throw new Error("No local network address found");
      const url = `${window.location.protocol}//${address}:${window.location.port || 5173}`;
      await navigator.clipboard?.writeText(url);
      copyAndToast(url, "LAN URL copied");
    } catch (error) {
      copyAndToast(error instanceof Error ? error.message : "Could not find LAN address", "error");
    } finally {
      setLanBusy(false);
    }
  }, [copyAndToast]);
  // Expansion is a view concern: a run stays grouped once created, it just
  // opens and closes in place.
  const [expandedBundles, setExpandedBundles] = React.useState<Set<string>>(() => new Set());
  const toggleBundle = React.useCallback((bundleId: string) => {
    setExpandedBundles((current) => {
      const next = new Set(current);
      if (next.has(bundleId)) next.delete(bundleId); else next.add(bundleId);
      return next;
    });
  }, []);
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
                <img src="/j-ai-logo.png" alt="" />
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
          <div className="zen-top-actions">
            <ComfyConnectionDot status={comfyStatus} onClick={refreshComfyStatus} />
            <Tip content="Workflow Gallery"><button className="icon-button" aria-label="Workflow Gallery" onClick={() => setWorkflowGalleryOpen(true)}><GalleryHorizontalEnd size={15} /></button></Tip>
            <Tip content="Settings"><button className="icon-button" aria-label="Settings" onClick={() => setSettings(true)}><Settings size={15} /></button></Tip>
            <Tip content="Exit zen"><button className="icon-button" aria-label="Exit zen" onClick={() => setZenMode(false)}><Minimize2 size={15} /></button></Tip>
          </div>
          {zenControls ? <button className="sidebar-dismiss" aria-label="Close controls" onClick={() => setZenControls(false)} /> : null}
          <aside data-open-surface className={cn("zen-controls", zenControls && "open")}>
            {sidebarControls}
          </aside>
          <section className="zen-prompt">
            <textarea ref={zenPromptRef} value={prompt} placeholder="Describe what to make..." onKeyDown={submitZenPrompt} onChange={(event) => setPrompt(clampText(event.target.value, promptLimit))} />
            <span className={cn("prompt-count", promptRemaining === 0 && "limit")}>{characterMeta(prompt, promptLimit)}</span>
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
              privacyEnabled={Boolean(privacyStatus?.enabled)}
              setPrivateGeneration={setPrivateGeneration}
              showNegativePrompt={showNegativePrompt}
              setShowNegativePrompt={setShowNegativePrompt}
              canUseNegativePrompt={canUseNegativePrompt}
              runningCount={runningCount}
              generate={generate}
              refreshComfyStatus={refreshComfyStatus}
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
          <header className="studio-nav">
            <Tip content="Controls"><button className="studio-brand-lockup" aria-label="Controls" onClick={() => setZenControls((value: boolean) => !value)}>
              <img src="/j-ai-logo.png" alt="" />
              <div>
                <strong>J AI Studio</strong>
                <span>{mode === "image" ? "Image studio" : "Video studio"}</span>
              </div>
              <PanelLeft className="mobile-sidebar-icon" size={18} />
            </button></Tip>
            <div className="studio-nav-actions">
              {runningCount ? <Tip content="Cancel all running and queued generations"><button className="queue-button" onClick={cancelQueue}>Cancel queue</button></Tip> : null}
              <ComfyConnectionDot status={comfyStatus} onClick={refreshComfyStatus} />
              <Tip content="Workflow Gallery"><button className="nav-action" aria-label="Workflow Gallery" onClick={() => setWorkflowGalleryOpen(true)}><GalleryHorizontalEnd size={16} /><span>Workflows</span></button></Tip>
              <Tip content="Settings"><button className="nav-action" aria-label="Settings" onClick={() => setSettings(true)}><Settings size={16} /><span>Settings</span></button></Tip>
              <Tip content="Zen mode"><button className="nav-action icon-only" aria-label="Enter zen mode" onClick={() => setZenMode(true)}><Maximize2 size={16} /></button></Tip>
            </div>
          </header>
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
              titleFromPrompt={titleFromPrompt}
            />
          ) : comfyOffline ? (
            <section className="gallery"><div className="empty is-offline">
              <img src="/j-ai-logo.png" alt="" />
              <h2>ComfyUI is offline</h2>
              <p>Start ComfyUI to connect your studio.</p>
              <div className="empty-actions">
                <button className="reconnect-btn primary" onClick={refreshComfyStatus}><RefreshCw size={13} /> Retry connection</button>
                <button className="reconnect-btn" onClick={() => setSettings(true)}><Settings size={13} /> Open settings</button>
              </div>
            </div></section>
          ) : (
            <section className="gallery"><div className="empty">
              <img src="/j-ai-logo.png" alt="" />
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
          <AnimatePresence>
            {pendingBundles.runs > 0 ? (
              <motion.div
                className="gallery-tidy-dock"
                initial={{ opacity: 0, y: 10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.96 }}
                transition={{ type: "spring", duration: 0.34, bounce: 0 }}
              >
                <Tip content={`Group ${pendingBundles.items} outputs from ${pendingBundles.runs} finished run${pendingBundles.runs === 1 ? "" : "s"} into stacks`} side="left">
                  <button type="button" className="gallery-tidy" onClick={compactGallery} disabled={compactBusy}>
                    <BrushCleaning size={16} />
                    <span>{compactBusy ? "Grouping..." : "Tidy up"}</span>
                    <i className="gallery-tidy-count"><AnimatedNumber value={pendingBundles.runs} /></i>
                  </button>
                </Tip>
              </motion.div>
            ) : null}
          </AnimatePresence>
          <Tip content="Controls"><button data-open-trigger className="zen-control-button desktop-sidebar-trigger" aria-label="Controls" onClick={() => setZenControls((value: boolean) => !value)}>
            <PanelLeft size={16} />
          </button></Tip>
          {zenControls ? <button className="sidebar-dismiss" aria-label="Close controls" onClick={() => setZenControls(false)} /> : null}
          <aside data-open-surface className={cn("zen-controls", zenControls && "open")}>
            {sidebarControls}
          </aside>
          <section className="zen-prompt">
            <div className="composer-kicker">
              <span>{mode === "image" ? "Create image" : "Create video"}</span>
              <span>{currentProfile?.displayName || currentProfile?.label || "Choose a workflow"}</span>
            </div>
            <textarea ref={zenPromptRef} value={prompt} placeholder="Describe what to make..." onKeyDown={submitZenPrompt} onChange={(event) => setPrompt(clampText(event.target.value, promptLimit))} />
            <span className={cn("prompt-count", promptRemaining === 0 && "limit")}>{characterMeta(prompt, promptLimit)}</span>
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
              privacyEnabled={Boolean(privacyStatus?.enabled)}
              setPrivateGeneration={setPrivateGeneration}
              showNegativePrompt={showNegativePrompt}
              setShowNegativePrompt={setShowNegativePrompt}
              canUseNegativePrompt={canUseNegativePrompt}
              runningCount={runningCount}
              generate={generate}
              refreshComfyStatus={refreshComfyStatus}
            />
          </section>
        </>
      )}
      {settings ? (
        <div className="scrim modal-scrim" onClick={() => setSettings(false)}>
          <div data-open-surface className="settings-card" onClick={(event) => event.stopPropagation()}>
            <header>
              <div className="settings-brand">
                <img src="/j-ai-logo.png" alt="" />
                <h2>Settings</h2>
              </div>
              <Tip content="Close (Esc)"><button className="icon-button" aria-label="Close settings" onClick={() => setSettings(false)}><X size={15} /></button></Tip>
            </header>
            <div className="settings-body">
              <nav className="settings-nav" aria-label="Settings sections">
                {SETTINGS_TABS.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      className={cn("settings-nav-item", settingsTab === tab.id && "active")}
                      aria-current={settingsTab === tab.id ? "page" : undefined}
                      onClick={() => setSettingsTab(tab.id)}
                    >
                      <Icon size={15} />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </nav>
              <div className="settings-panel" key={settingsTab}>
                {settingsTab === "general" ? (
                  <>
                    <section>
                      <h3>Project</h3>
                      <div className="project-card">
                        <img src="/j-ai-logo.png" alt="" />
                        <div>
                          <strong>J AI Studio</strong>
                          <span>Local image and video studio</span>
                        </div>
                        <Tip content="Open the public GitHub repo"><a className="ghost-button" href={githubUrl} target="_blank" rel="noreferrer"><Github size={14} /> GitHub</a></Tip>
                      </div>
                    </section>
                    <section>
                      <h3>Experience</h3>
                      <div className="toggle-group">
                        <label className="toggle-row">
                          <span>
                            <strong>Zen mode</strong>
                            <em>Prompt-first fullscreen layout</em>
                          </span>
                          <input type="checkbox" checked={prefs.zenMode} onChange={(event) => setZenMode(event.target.checked)} />
                        </label>
                        <label className="toggle-row">
                          <span>
                            <strong>Confirm actions</strong>
                            <em>Ask before delete, cancel, reset, and cache clearing</em>
                          </span>
                          <input type="checkbox" checked={prefs.confirmActions} onChange={(event) => setPrefs({ confirmActions: event.target.checked })} />
                        </label>
                        <label className="toggle-row">
                          <span>
                            <strong>Follow latest output</strong>
                            <em>Jump to the newest finished item while generating</em>
                          </span>
                          <input type="checkbox" checked={prefs.followLatest} onChange={(event) => setPrefs({ followLatest: event.target.checked })} />
                        </label>
                      </div>
                    </section>
                    <section>
                      <h3>Generation</h3>
                      <div className="toggle-group">
                        <label className="toggle-row">
                          <span>
                            <strong>Enter to generate</strong>
                            <em>Press Enter to submit, Shift+Enter for a new line</em>
                          </span>
                          <input type="checkbox" checked={prefs.enterToGenerate} onChange={(event) => setPrefs({ enterToGenerate: event.target.checked })} />
                        </label>
                      </div>
                      <Field label="Generation previews">
                        <Select value={prefs.generationPreviewMode === "simple" ? "Simple · step previews" : "Advanced · pixel mosaic"}
                          onChange={(value) => setPrefs({ generationPreviewMode: value === "Simple · step previews" ? "simple" : "advanced" })}
                          options={[
                            "Advanced · pixel mosaic",
                            "Simple · step previews",
                          ]} />
                      </Field>
                      <p className="generation-preview-help">Advanced adds animated pixels over early previews. Simple shows each step directly and uses less graphics power. Reduced motion uses simple previews.</p>
                      <Field label={<>Multiple images <InfoTip content="Batch runs one Comfy prompt with a larger latent batch. Separate jobs queue one prompt per image, which is easier to cancel individually." /></>}>
                        <Select
                          value={prefs.variationQueueMode}
                          onChange={(value) => setPrefs({ variationQueueMode: value === "separate" ? "separate" : "batch" })}
                          options={[
                            { label: "One Comfy batch", value: "batch" },
                            { label: "Queue them as separate jobs", value: "separate" }
                          ]}
                        />
                      </Field>
                    </section>
                  </>
                ) : null}

                {settingsTab === "connection" ? (
                  <>
                    <section>
                      <h3>ComfyUI</h3>
                      <div className="setting-rows">
                        <div className="setting-row"><span>Studio</span><strong>{window.location.host || "Localhost"}</strong></div>
                        <div className="setting-row"><span>ComfyUI</span><strong>{health ? health.comfyUrl || "Not connected" : <Skeleton className="skeleton-text short" />}</strong></div>
                        <div className="setting-row"><span>Status</span><strong className={cn("status-value", health && (health.ok ? "is-ok" : "is-bad"))}>{health ? health.ok ? "Connected" : health.error || "Disconnected" : <Skeleton className="skeleton-text tiny" />}</strong></div>
                      </div>
                      <div className="setting-actions">
                        <Tip content="Check the local ComfyUI connection"><button className="is-primary" onClick={refreshHealth}>Check connection</button></Tip>
                        <Tip content="Rescan local models"><button onClick={() => refreshModels()}>Refresh models</button></Tip>
                        <Tip content="Open ComfyUI in a new tab"><button onClick={() => { window.open(health?.comfyUrl || "http://127.0.0.1:8188", "_blank"); }}>Open ComfyUI</button></Tip>
                        <Tip content="Copy the address for another device when LAN mode is enabled"><button onClick={openLanUrl} disabled={lanBusy}>{lanBusy ? "Finding LAN address..." : "Copy LAN URL"}</button></Tip>
                      </div>
                      <p className="field-meta">Start with <code>npm run dev:lan</code> before opening this address on another device.</p>
                    </section>
                    <section>
                      <details className="settings-disclosure">
                        <summary>What is installed</summary>
                        <div className="disclosure-body">
                          <div className="setting-rows">
                            <div className="setting-row"><span>Image models</span><strong>{models ? models.imageModels.length : <Skeleton className="skeleton-text tiny" />}</strong></div>
                            <div className="setting-row"><span>Video models</span><strong>{models ? models.videoModels.length : <Skeleton className="skeleton-text tiny" />}</strong></div>
                            <div className="setting-row"><span>Active workflow</span><strong>{models ? currentProfile?.family || "None" : <Skeleton className="skeleton-text short" />}</strong></div>
                            <div className="setting-row"><span>Start image</span><strong>{canUseStartImage ? "Available" : "Hidden for this model"}</strong></div>
                            {(models?.unsupportedModels?.length || 0) > 0 ? <div className="setting-row"><span>Unsupported</span><strong>{models?.unsupportedModels?.length || 0}</strong></div> : null}
                          </div>
                        </div>
                      </details>
                    </section>
                  </>
                ) : null}

                {settingsTab === "workflows" ? (
                  <section>
                    <h3>Workflows <InfoTip content="Imported workflows only appear once their required ComfyUI nodes are installed." /></h3>
                    <div className="setting-rows">
                      <div className="setting-row"><span>Folder</span><strong>{paths.workflowsDir || <Skeleton className="skeleton-text path" />}</strong></div>
                    </div>
                    <label className="file-drop">
                      <input
                        type="file"
                        accept="application/json,.json"
                        onChange={(event) => {
                          importWorkflowFile(event.target.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                      />
                      <ImagePlus size={15} />
                      <span>Import ComfyUI API workflow</span>
                    </label>
                    <div className="setting-actions">
                      <Tip content="Browse and manage workflow templates"><button className="is-primary" onClick={() => { setSettings(false); setWorkflowGalleryOpen(true); }}>Open workflow gallery</button></Tip>
                      <Tip content="Reload workflow templates from disk"><button onClick={() => refreshModels()}>Refresh workflows</button></Tip>
                    </div>
                  </section>
                ) : null}

                {settingsTab === "gallery" ? (
                  <>
                    <section>
                      <h3>Library</h3>
                      <div className="setting-rows">
                        <div className="setting-row"><span>Total items</span><strong>{galleryLoaded ? gallery.length : <Skeleton className="skeleton-text tiny" />}</strong></div>
                        <div className="setting-row"><span>Current tab</span><strong>{galleryLoaded ? `${visibleGallery.length} ${mode === "image" ? "images" : "videos"}` : <Skeleton className="skeleton-text short" />}</strong></div>
                      </div>
                      <Field label={<>Output folder <InfoTip content="Required for Private Vault. J AI only ingests and removes completed outputs from this exact folder." /></>}>
                        <div className="inline-form">
                          <input value={outputDirDraft} placeholder="ComfyUI output folder" onChange={(event) => setOutputDirDraft(event.target.value)} />
                          <button onClick={saveOutputDirectory} disabled={!outputDirDraft.trim()}>Save</button>
                        </div>
                      </Field>
                      <div className="setting-actions">
                        <Tip content="Copy the output folder path"><button onClick={() => copyAndToast(paths.outputDir || "", "Output path copied")}>Copy path</button></Tip>
                        <Tip content="Open the output folder"><button onClick={openOutputFolder} disabled={!paths.outputDir}>Open folder</button></Tip>
                      </div>
                    </section>
                    <section>
                      <h3>Runs <InfoTip content="A burst of related generations - same job, or the same prompt repeated - collapses into one stack once it has been quiet for the chosen time. Grouping is exact and local: no similarity matching. Private Vault outputs group only among themselves, in their own record inside the encrypted vault - never mixed with the regular gallery, and invisible while the vault is locked." /></h3>
                      <div className="toggle-group">
                        <label className="toggle-row">
                          <span>
                            <strong>Group generation runs</strong>
                            <em>Offer to collapse finished runs into stacks you can open in place</em>
                          </span>
                          <input type="checkbox" checked={prefs.groupRuns !== false} onChange={(event) => setPrefs({ groupRuns: event.target.checked })} />
                        </label>
                      </div>
                      {prefs.groupRuns !== false ? (
                        <>
                          <Field label="Group by">
                            <Select
                              value={prefs.runGroupingMode || "smart"}
                              onChange={(value) => setPrefs({ runGroupingMode: value === "job" ? "job" : "smart" })}
                              options={[
                                { label: "Smart - same prompt, or one batch", value: "smart" },
                                { label: "Batches only - one generation job", value: "job" }
                              ]}
                            />
                          </Field>
                          <Field label={<>Close a run after <InfoTip content="A run ends when nothing matching finishes for this long. A later generation starts a new run rather than reopening an old one." /></>}>
                            <NumberPicker
                              label="Minutes"
                              value={Number(prefs.runCooldownMinutes ?? 5)}
                              onChange={(next) => setPrefs({ runCooldownMinutes: next })}
                              min={1}
                              max={240}
                              step={1}
                              fill
                            />
                          </Field>
                        </>
                      ) : null}
                    </section>
                    <section>
                      <h3>Display</h3>
                      <div className="toggle-group">
                        <label className="toggle-row">
                          <span>
                            <strong>Show failed items</strong>
                            <em>Keep interrupted or failed generations visible in the gallery</em>
                          </span>
                          <input type="checkbox" checked={prefs.showFailedItems} onChange={(event) => setPrefs({ showFailedItems: event.target.checked })} />
                        </label>
                        <label className="toggle-row">
                          <span>
                            <strong>Zen gallery strip</strong>
                            <em>Show the small gallery across the top in zen mode</em>
                          </span>
                          <input type="checkbox" checked={zenGalleryOpen} onChange={(event) => setZenGalleryOpen(event.target.checked)} />
                        </label>
                      </div>
                    </section>
                    <section>
                      <details className="settings-disclosure">
                        <summary>Clean up the gallery</summary>
                        <div className="disclosure-body">
                          <div className="setting-actions">
                            <Tip content="Remove failed and interrupted cards"><button onClick={clearFailedItems}>Clear failed items</button></Tip>
                            <Tip content="Remove finished items from this gallery"><button className="subtle-danger" onClick={clearGallery}>Clear finished gallery</button></Tip>
                          </div>
                          <span className="field-meta">Files on disk are not deleted. This only clears what J AI shows.</span>
                        </div>
                      </details>
                    </section>
                  </>
                ) : null}

                {settingsTab === "privacy" ? (
                  <>
                    <section>
                      <h3>Private Vault</h3>
                      <div className="setting-rows">
                        <div className="setting-row">
                          <span>Password <InfoTip content="Private Vault keeps opted-in originals, previews, prompts, and settings encrypted. Private outputs are only served after unlock; the normal gallery is unchanged." /></span>
                          <strong className={cn("status-value", privacyStatus?.enabled && (privacyStatus.unlocked ? "is-ok" : "is-bad"))}>{privacyStatus?.enabled ? privacyStatus.unlocked ? "Unlocked" : "Locked" : "Not set"}</strong>
                        </div>
                      </div>
                      <div className="privacy-form">
                        <input
                          type="password"
                          autoComplete={privacyStatus?.enabled ? "current-password" : "new-password"}
                          value={privacyPassword}
                          placeholder={privacyStatus?.enabled ? "Privacy password" : "Create password"}
                          onChange={(event) => setPrivacyPassword(event.target.value)}
                        />
                        {!privacyStatus?.enabled ? (
                          <input
                            type="password"
                            autoComplete="new-password"
                            value={privacyConfirmPassword}
                            placeholder="Confirm password"
                            onChange={(event) => setPrivacyConfirmPassword(event.target.value)}
                          />
                        ) : null}
                      </div>
                      <div className="setting-actions">
                        {!privacyStatus?.enabled ? (
                          <Tip content="Enable encrypted prompts, Private Vault, and password-protected LAN access"><button className="is-primary" onClick={setupPrivacyPassword} disabled={privacyBusy}>{privacyBusy ? "Saving..." : "Enable password"}</button></Tip>
                        ) : privacyStatus.unlocked ? (
                          <Tip content="Hide encrypted prompts until the password is entered again"><button className="is-primary" onClick={lockPrivacy} disabled={privacyBusy}>{privacyBusy ? "Locking..." : "Lock prompts"}</button></Tip>
                        ) : (
                          <Tip content="Decrypt prompts and save the LAN unlock cookie"><button className="is-primary" onClick={unlockPrivacy} disabled={privacyBusy}>{privacyBusy ? "Unlocking..." : "Unlock"}</button></Tip>
                        )}
                        <Tip content="Refresh privacy status"><button onClick={view.refreshPrivacyStatus} disabled={privacyBusy}>Refresh</button></Tip>
                      </div>
                    </section>
                    {privacyStatus?.vault?.assetCount ? (
                      <section>
                        <details className="settings-disclosure">
                          <summary>Vault backup</summary>
                          <div className="disclosure-body">
                            <div className="setting-actions">
                              <Tip content="Downloads an encrypted archive; it contains no plaintext originals"><a className="ghost-button" href="/api/vault/export" download><Download size={14} /> Export encrypted vault</a></Tip>
                            </div>
                            <span className="field-meta">The archive can only be read with this privacy password.</span>
                          </div>
                        </details>
                      </section>
                    ) : null}
                  </>
                ) : null}

                {settingsTab === "advanced" ? (
                  <>
                    <section>
                      <h3>Updates</h3>
                      <div className="setting-rows">
                        <div className="setting-row"><span>Status</span><strong className={cn("status-value", updateStatus && !updateStatus.error && (updateStatus.available ? "is-bad" : updateStatus.ok && "is-ok"))}>{updateStatus?.error || (updateStatus?.available ? `${updateStatus.behind || 1} update${updateStatus.behind === 1 ? "" : "s"} available` : updateStatus?.ok ? "Up to date" : "Not checked")}</strong></div>
                      </div>
                      <div className="setting-actions">
                        <Tip content="Check GitHub for a newer commit"><button className="is-primary" onClick={() => checkForUpdates()} disabled={updateBusy}>{updateBusy ? "Checking..." : "Check for updates"}</button></Tip>
                        <Tip content="Pull latest code, install packages, and rebuild"><button onClick={installUpdate} disabled={updateBusy || !updateStatus?.available}>{updateBusy ? "Working..." : "Install update"}</button></Tip>
                      </div>
                      {updateStatus?.restartRequired ? <span className="field-meta">Restart the local server to finish updating.</span> : null}
                      <details className="settings-disclosure">
                        <summary>Build details</summary>
                        <div className="disclosure-body">
                          <div className="setting-rows">
                            <div className="setting-row"><span>Branch</span><strong>{updateStatus?.branch || "Unknown"}</strong></div>
                            <div className="setting-row"><span>Commit</span><strong>{updateStatus?.current || "Unknown"}</strong></div>
                          </div>
                        </div>
                      </details>
                    </section>
                    <section>
                      <details className="settings-disclosure">
                        <summary>Reset and cache</summary>
                        <div className="disclosure-body">
                          <div className="setting-actions">
                            <Tip content="Clear browser cache, stale queue state, and free ComfyUI memory"><button onClick={clearAllCache}>Clear all cache</button></Tip>
                            <Tip content="Reset prompts, layout, model choices, and saved settings"><button className="subtle-danger" onClick={resetAllSettings}>Reset all settings</button></Tip>
                          </div>
                          <span className="field-meta">Generated files are never touched by either action.</span>
                        </div>
                      </details>
                    </section>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {privacyStatus?.enabled && !privacyStatus.unlocked && !settings ? (
        <div className="scrim modal-scrim privacy-lock">
          <div data-open-surface className="privacy-lock-card">
            <header>
              <div>
                <h2>Unlock J AI Studio</h2>
                <p>Enter the privacy password to decrypt prompts and authorize this browser.</p>
              </div>
            </header>
            <input
              type="password"
              autoComplete="current-password"
              value={privacyPassword}
              placeholder="Privacy password"
              onChange={(event) => setPrivacyPassword(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") unlockPrivacy(); }}
              autoFocus
            />
            <div className="setting-actions single">
              <button onClick={unlockPrivacy} disabled={privacyBusy}>{privacyBusy ? "Unlocking..." : "Unlock"}</button>
            </div>
          </div>
        </div>
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
                      {canUseStartImage && active.type === "image" && active.url ? (
                        <Tip content="Use this output as the next start image"><button className="copy-all-settings" onClick={() => useOutputAsStartImage(active)}>Use as Start Image</button></Tip>
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
                  {canUseStartImage && active.type === "image" && active.url ? <Tip content="Use as start image"><button className="icon-button" aria-label="Use as start image" onClick={() => useOutputAsStartImage(active)}><ImagePlus size={15} /></button></Tip> : null}
                  {active.url ? <Tip content="Download file"><a className="icon-button" aria-label="Download file" href={active.url} download><Download size={15} /></a></Tip> : null}
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
      <Toaster theme="dark" position={isMobile ? "top-center" : "bottom-left"} richColors closeButton toastOptions={{ className: "sonner-toast" }} />
    </div>
    </GenerationPreviewMode.Provider>
  );
}

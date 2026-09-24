import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import "./styles.css";

import { useModelFolders } from './app/useModelFolders';
import type { ComfyStatus, GalleryItem, Health, LoraSelection, MediaInput, Mode, Models, OutputFolderReport, Paths, Preferences, Profile, ReferenceAsset, SelectedReferenceAsset, TouchGesture, UpdateStatus, WorkflowPreferences, WorkflowSummary } from './app/types';
import { fallbackAspectPresets } from './app/constants';
import { apiJson, copyImage, copyText, loadDraft, loadPrefs, referenceAssetFromGallery } from './app/api';
import { characterMeta, clampText, formatElapsed, generationDetailEntries, settingMax, textLength, titleFromPrompt } from './app/format';
import { useGalleryColumnCount } from './app/gallery';
import { normalizeLoras } from './app/loras';
import { deleteLoraStack, loraFamilyKey, loraFavorites, loraRecents, loraStacks, recordLoraRecents, rememberActiveLoras, rememberedLoraStrength, rememberLoraStrengths, renameLoraStack, saveLoraStack, startLoraSync, subscribeLoraLibrary, subscribeLoraSync, toggleLoraFavorite, updateLoraStack, type LoraSnapshot, type LoraSyncStatus } from './app/lora-storage';
import { useConfirmation } from './app/useConfirmation';
import { StudioView } from './app/StudioView';
import { SidebarControls } from './app/SidebarControls';
import { useGenerationActions } from './app/useGenerationActions';
import { useViewerControls } from './app/useViewerControls';
import { useGalleryBundles } from './app/useGalleryBundles';
import { useGalleryStore } from './app/useGalleryStore';
import { upscaleDisplayThumbnail, upscaleDisplayUrl, useUpscale } from './app/useUpscale';
import { useHidden, type HiddenIntent } from './app/useHidden';
import { flyInto, hiddenDockTarget } from './app/hiddenMotion';
import { useVisibleInterval } from './hooks/use-visible-interval';
import { useKeyboardInset } from './hooks/use-keyboard-inset';
import { memoLatest } from './lib/memo-latest';

// Rebuilt from scratch on every App render (each keystroke in the prompt); skips unless its data changed.
const StableSidebarControls = memoLatest(SidebarControls);

/** Snap a raw pixel dimension to something ComfyUI will accept: a multiple of the
 *  workflow's step (default 8), clamped to its width/height range. */
function snapDimension(value: number, meta: Record<string, number> = {}): number {
  const step = meta.step || 8;
  const min = meta.min ?? 64;
  const max = meta.max ?? 4096;
  const snapped = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, snapped || step));
}

function imageInputsForProfile(profile: Profile | null | undefined): MediaInput[] {
  if (!profile || profile.kind !== "image") return [];
  const declared = (profile.mediaInputs || []).filter((input) => input.kind === "image");
  if (declared.length) return declared;
  // Edit models read a reference; everything else can only start from a picture and redraw it.
  if (profile.capabilities.imageToImage) {
    return [{ id: "reference", kind: "image", required: true, min: 1, max: 1, label: "Reference image", role: "reference" }];
  }
  if (profile.capabilities.startImage) {
    return [{ id: "reference", kind: "image", required: false, min: 0, max: 1, label: "Start image", role: "start" }];
  }
  return [];
}


const updateInstalledKey = "heiss-ui:update-installed";
const formatUpdateBytes = (bytes = 0) => `${(bytes / 1024 ** 2).toFixed(bytes > 100 * 1024 ** 2 ? 0 : 1)} MB`;

function App() {
  useKeyboardInset();
  const now = Date.now();
  const initialDraft = useMemo(() => loadDraft(), []);
  const [mode, setMode] = useState<Mode>(initialDraft.mode === "video" ? "video" : "image");
  const [models, setModels] = useState<Models | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [comfyStatus, setComfyStatus] = useState<ComfyStatus>({ connected: false, checking: true });
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [prefs, setPrefsState] = useState<Preferences>(() => loadPrefs());
  const hidden = useHidden({ autoLockMinutes: prefs.hiddenAutoLockMinutes ?? 15, showToast });
  const hiddenSpace = hidden.space === "hidden";
  const [prompt, setPrompt] = useState(String(initialDraft.prompt || ""));
  const [negative, setNegative] = useState(String(initialDraft.negative || ""));
  const [model, setModel] = useState(String(initialDraft.model || ""));
  const [paths, setPaths] = useState<Paths>({});
  const [textEncoder, setTextEncoder] = useState(String(initialDraft.textEncoder || ""));
  // Built-in families can need several encoders (Flux.1 two, HiDream four), one per slot.
  const [textEncoders, setTextEncoders] = useState<string[]>(Array.isArray(initialDraft.textEncoders) ? initialDraft.textEncoders.map(String) : []);
  const [vae, setVae] = useState(String(initialDraft.vae || ""));
  const [clipType, setClipType] = useState(String(initialDraft.clipType || ""));
  const [weightDtype, setWeightDtype] = useState(String(initialDraft.weightDtype || "default"));
  const [width, setWidth] = useState(Number(initialDraft.width || 1024));
  const [height, setHeight] = useState(Number(initialDraft.height || 1024));
  const [steps, setSteps] = useState(Number(initialDraft.steps || prefs.defaultImageSteps));
  const [cfg, setCfg] = useState(Number(initialDraft.cfg || 1));
  const [denoise, setDenoise] = useState(Number(initialDraft.denoise || 0.65));
  const [seed, setSeed] = useState(String(initialDraft.seed || ""));
  const [count, setCount] = useState(Number(initialDraft.count || prefs.defaultImageCount));
  const [frames, setFrames] = useState(Number(initialDraft.frames || prefs.defaultVideoFrames));
  const [fps, setFps] = useState(Number(initialDraft.fps || prefs.defaultFps));
  const [sampler, setSampler] = useState(String(initialDraft.sampler || "euler_ancestral"));
  const [scheduler, setScheduler] = useState(String(initialDraft.scheduler || "beta"));
  const [loras, setLoras] = useState<LoraSelection[]>(() => normalizeLoras(initialDraft.loras));
  const [loraSnapshotRevision, setLoraSnapshotRevision] = useState(0);
  const advanced = true;
  const [settings, setSettings] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 620px)").matches : false
  );
  const [zenControls, setZenControls] = useState(Boolean(initialDraft.zenControls));
  const [sidebarTab, setSidebarTab] = useState<'basics' | 'advanced' | 'loras'>('basics');
  const [showNegativePrompt, setShowNegativePrompt] = useState(Boolean(initialDraft.showNegativePrompt));
  const [zenGalleryOpen, setZenGalleryOpen] = useState(initialDraft.zenGalleryOpen !== false);
  const [zenSelectedId, setZenSelectedId] = useState(String(initialDraft.zenSelectedId || ""));
  const [status, setStatus] = useState("Ready");
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflowPreferences, setWorkflowPreferences] = useState<WorkflowPreferences>({ favorites: [], lastUsed: {}, thumbnails: {} });
  const [workflowGalleryOpen, setWorkflowGalleryOpen] = useState(false);
  const [active, setActive] = useState<GalleryItem | null>(null);
  const [viewerZoom, setViewerZoom] = useState(1);
  const [viewerPan, setViewerPan] = useState({ x: 0, y: 0 });
  const [showDetails, setShowDetails] = useState(Boolean(initialDraft.showDetails));
  const [showGenerationSettings, setShowGenerationSettings] = useState(Boolean(initialDraft.showGenerationSettings));
  const [customSize, setCustomSize] = useState(Boolean(initialDraft.customSize));
  const [startImage, setStartImage] = useState("");
  const [startImageId, setStartImageId] = useState(String(initialDraft.startImageId || ""));
  const [startImageName, setStartImageName] = useState(String(initialDraft.startImageName || ""));
  const [referenceAssets, setReferenceAssets] = useState<SelectedReferenceAsset[]>(() => Array.isArray(initialDraft.referenceAssets) ? initialDraft.referenceAssets : []);
  const generatePostingRef = useRef(false);
  const viewerDragRef = useRef<{ id: number; x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const viewerDragEndRef = useRef<number>(0);
  const [isDraggingViewer, setIsDraggingViewer] = useState(false);
  const zenPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const galleryStageRef = useRef<HTMLElement | null>(null);
  const zenStripRef = useRef<HTMLDivElement | null>(null);
  const zenStripDragRef = useRef<{ id: number; x: number; scrollLeft: number; moved: boolean } | null>(null);
  const latestZenIdRef = useRef("");
  // Set when LoRAs are applied for a workflow we're about to switch to (e.g. "Copy
  // all settings"), so the switch doesn't load that workflow's saved stack over them.
  const explicitLorasFor = useRef("");
  const comfyStatusRequestRef = useRef<Promise<void> | null>(null);
  const [comfyRetrying, setComfyRetrying] = useState(false);
  const touchGestureRef = useRef<TouchGesture | null>(null);
  const lastTapRef = useRef(0);
  const lastTouchRef = useRef(0);
  const {
    gallery,
    visibleGallery,
    renderedGallery,
    galleryLoaded,
    galleryCrossing,
    hasMoreGallery,
    galleryTotalApprox,
    galleryRevision,
    loadGallery,
    loadGalleryDelta,
    loadMoreGalleryItems,
    setGallery,
    upsertGalleryItems,
    removeGalleryItems,
    removeGalleryItemsWhere,
    patchGalleryItems,
  } = useGalleryStore({ mode, showFailedItems: prefs.showFailedItems, space: hidden.space, onLocked: hidden.refresh });

  const { pendingBundles, compactGallery, compactBusy, gatheringIds, settlingBundles, setBundleCover, ungroupBundle } = useGalleryBundles({
    prefs,
    galleryRevision,
    domain: hiddenSpace ? "vault" : "gallery",
    enabled: !hiddenSpace || hidden.unlocked,
    reloadGallery: loadGallery,
    showToast
  });

  useEffect(() => {
    refreshHealth();
    refreshComfyStatus();
    refreshModels(false);
    refreshWorkflows();
    refreshPaths();
    loadGallery();
  }, [loadGallery]);

  // Locking or unlocking changes what Hidden can show; so does another device doing it.
  useEffect(() => {
    if (!hiddenSpace) return;
    if (!hidden.unlocked) setActive(null);
    loadGallery();
  }, [hidden.unlocked]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing from one space stays open in the other.
  useEffect(() => {
    setActive(null);
  }, [hidden.space]);

  // After "Install update" the server has to restart; once this page sees a server
  // that started after the install, say the update landed (or that it was undone).
  useEffect(() => {
    let pending: { at: number } | null = null;
    try { pending = JSON.parse(localStorage.getItem(updateInstalledKey) || "null"); } catch { pending = null; }
    if (!pending?.at) return;
    fetch("/api/health").then((response) => response.json()).then(async (data: { startedAt?: number }) => {
      if (!data?.startedAt || data.startedAt < pending!.at) return;
      try { localStorage.removeItem(updateInstalledKey); } catch { /* nothing to clear */ }
      const status = await apiJson<UpdateStatus>("/api/update/status").catch(() => null);
      if (status) setUpdateStatus(status);
      const result = status?.result;
      if (result && !result.ok) showToast(result.rolledBack ? `HEISS UI ${result.to} would not start, so it went back to ${result.from}${result.error ? ` (${result.error})` : ""}.` : result.error || "The update did not install", "error");
      else showToast(result?.to ? `Updated to HEISS UI ${result.to}` : "HEISS UI is updated and running the new version", "success");
    }).catch(() => null);
  }, []);

  // A release download runs on the server; follow it while it is in flight.
  const downloadStage = updateStatus?.download?.status;
  useEffect(() => {
    if (downloadStage !== "downloading" && downloadStage !== "verifying" && downloadStage !== "unpacking") return;
    const timer = window.setInterval(() => {
      apiJson<UpdateStatus>("/api/update/status").then((data) => {
        setUpdateStatus(data);
        if (data.download?.status === "ready") showToast(`HEISS UI ${data.latest} is ready. Restart to finish.`, "success");
        if (data.download?.status === "error") showToast(data.download.error || "The update download failed", "error");
      }).catch(() => null);
    }, 800);
    return () => window.clearInterval(timer);
  }, [downloadStage]);

  // The LoRA library lives on the server and syncs edit by edit. Speak up only
  // when edits are actually stuck (a server restart with nothing to sync is not
  // worth an error), and say so again once they have gone through.
  const loraSyncFailing = useRef(false);
  useEffect(() => {
    const stop = startLoraSync();
    const offLibrary = subscribeLoraLibrary(() => setLoraSnapshotRevision((value) => value + 1));
    const offSync = subscribeLoraSync((sync: LoraSyncStatus) => {
      if (sync.failing && sync.pending > 0 && !loraSyncFailing.current) {
        showToast(sync.locked
          ? "LoRA changes are saved on this device. Unlock HEISS UI to sync them."
          : "Could not reach HEISS UI. LoRA changes are saved on this device and sync when it is back.", "error");
      } else if (!sync.failing && loraSyncFailing.current && !sync.pending) {
        showToast("LoRA changes synced", "success");
      }
      if (!sync.failing || sync.pending > 0) loraSyncFailing.current = sync.failing && sync.pending > 0;
    });
    return () => { stop(); offLibrary(); offSync(); };
  }, []);

  useEffect(() => {
    if (!model) return;
    if (explicitLorasFor.current === model) {
      explicitLorasFor.current = "";
      return;
    }
    let current = true;
    apiJson<{ found: boolean; loras: LoraSelection[] }>(`/api/loras/${encodeURIComponent(model)}`)
      .then((data) => { if (current && data.found) setLoras(normalizeLoras(data.loras)); })
      .catch(() => null);
    return () => { current = false; };
  }, [model]);

  // ComfyUI came back (started late, or restarted): pick everything up again
  // without a reload. Only a real offline → online change counts.
  const wasConnected = useRef<boolean | null>(null);
  const [comfyReconnectedAt, setComfyReconnectedAt] = useState(0);
  useEffect(() => {
    if (!comfyStatus.checked) return;
    const previous = wasConnected.current;
    wasConnected.current = comfyStatus.connected;
    if (previous !== false || !comfyStatus.connected) return;
    refreshModels(false);
    refreshWorkflows();
    refreshHealth();
    refreshUpscaleStatus(prefs.upscaleQuality, { fresh: true });
    setComfyReconnectedAt(Date.now());
  }, [comfyStatus.connected, comfyStatus.checked]);

  useVisibleInterval(refreshComfyStatus, 5000);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 620px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // A locked Hidden has nothing to poll for.
  useVisibleInterval(loadGalleryDelta, 2500, !hiddenSpace || hidden.unlocked);

  useEffect(() => {
    if (!prefs.zenMode || active || settings || zenControls) return;
    window.setTimeout(() => zenPromptRef.current?.focus(), 0);
  }, [prefs.zenMode, active, settings, zenControls]);

  useEffect(() => {
    const textarea = zenPromptRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(128, Math.max(44, textarea.scrollHeight))}px`;
  }, [prompt, prefs.zenMode]);

  useEffect(() => {
    if (prefs.zenMode) return;
    setZenControls(false);
    setActive(null);
    resetViewer();
  }, [prefs.zenMode]);


  useEffect(() => {
    if (!active && !settings && !workflowGalleryOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active, settings, workflowGalleryOpen]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-open-trigger], [data-open-surface], [data-radix-popper-content-wrapper], [role='listbox'], [role='tooltip']")) return;
      if (zenControls) setZenControls(false);
      if (active && showDetails && target.closest("[data-viewer-empty]")) setShowDetails(false);
    }
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [active, prefs.zenMode, showDetails, zenControls, zenGalleryOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (event.key !== "Escape") return;
      if (settings) {
        event.preventDefault();
        setSettings(false);
        return;
      }
      if (workflowGalleryOpen) {
        event.preventDefault();
        setWorkflowGalleryOpen(false);
        return;
      }
      if (active) {
        event.preventDefault();
        setActive(null);
        return;
      }
      if (zenControls) {
        event.preventDefault();
        setZenControls(false);
        return;
      }
      if (prefs.zenMode) {
        // First Escape only leaves the prompt, so it never exits zen mid-sentence.
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.closest("input, textarea, select, [contenteditable='true']")) {
          target.blur();
          return;
        }
        event.preventDefault();
        setZenMode(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settings, active, zenControls, workflowGalleryOpen, prefs.zenMode]);

  // A file dropped outside a drop zone would make the browser open it and
  // leave the app. Swallow file drags the zones haven't claimed.
  useEffect(() => {
    const isFileDrag = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes("Files"));
    function onDragOver(event: DragEvent) {
      if (!isFileDrag(event) || event.defaultPrevented) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    }
    function onDrop(event: DragEvent) {
      if (isFileDrag(event)) event.preventDefault();
    }
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (settings || active) return;
      // AltGr types @ { \ € on many layouts; Windows reports it as Ctrl+Alt.
      const altGraph = event.getModifierState("AltGraph") || (event.ctrlKey && event.altKey);
      if (!altGraph && (event.ctrlKey || event.metaKey || event.altKey)) return;
      if (event.key.length !== 1 && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a, [contenteditable='true'], [role='dialog'], [role='listbox'], [data-radix-popper-content-wrapper]")) return;
      zenPromptRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [settings, active]);

  // Each space keeps its own prompt. Hidden's lives in memory only: it never
  // reaches the saved draft, never follows you out, and goes when Hidden locks.
  const spacePrompts = useRef({ gallery: { prompt, negative }, hidden: { prompt: "", negative: "" } });
  const promptSpace = useRef(hidden.space);
  if (promptSpace.current === hidden.space) spacePrompts.current[hidden.space] = { prompt, negative };
  useEffect(() => {
    if (promptSpace.current === hidden.space) return;
    promptSpace.current = hidden.space;
    const next = spacePrompts.current[hidden.space];
    setPrompt(next.prompt);
    setNegative(next.negative);
  }, [hidden.space]);
  useEffect(() => {
    if (hidden.unlocked) return;
    spacePrompts.current.hidden = { prompt: "", negative: "" };
    if (hiddenSpace) { setPrompt(""); setNegative(""); }
  }, [hidden.unlocked]); // eslint-disable-line react-hooks/exhaustive-deps
  const draftPrompt = { current: spacePrompts.current.gallery };
  useEffect(() => {
    const draft = {
      mode,
      prompt: draftPrompt.current.prompt,
      negative: draftPrompt.current.negative,
      model,
      textEncoder,
      textEncoders,
      vae,
      clipType,
      weightDtype,
      width,
      height,
      steps,
      cfg,
      denoise,
      seed,
      count,
      frames,
      fps,
      sampler,
      scheduler,
      loras,
      customSize,
      startImageId,
      startImageName,
      // Hidden references keep only their id in the browser: no name, no thumbnail.
      // The preview is looked up again once Hidden is unlocked.
      referenceAssets: referenceAssets.map(({ slot, asset }) => asset.privacyDomain === "vault" || asset.source === "vault"
        ? { slot, asset: { id: asset.id, source: "vault" as const, privacyDomain: "vault" as const, galleryItemId: asset.galleryItemId, name: "Hidden image", mime: "", width: 0, height: 0, size: 0, createdAt: "", thumbnailUrl: "" } }
        : { slot, asset }),
      advanced,
      showDetails,
      showGenerationSettings,
      showNegativePrompt,
      zenGalleryOpen,
      zenControls,
      zenSelectedId
    };
    const save = () => {
      try {
        localStorage.setItem("heiss-ui-draft", JSON.stringify(draft));
      } catch {
        localStorage.setItem("heiss-ui-draft", JSON.stringify({ ...draft, startImage: "", startImageId }));
      }
    };
    // Typing changes the draft on every keystroke: write it once typing pauses,
    // and straight away if the page is closed first.
    const timer = window.setTimeout(save, 300);
    window.addEventListener("pagehide", save);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", save);
    };
  }, [mode, prompt, negative, model, textEncoder, textEncoders, vae, clipType, weightDtype, width, height, steps, cfg, denoise, seed, count, frames, fps, sampler, scheduler, loras, customSize, startImageId, startImageName, referenceAssets, advanced, showDetails, showGenerationSettings, showNegativePrompt, zenGalleryOpen, zenControls, zenSelectedId, hiddenSpace]);

  useEffect(() => {
    if (!active) return;
    const activeItem = active;
    const viewerItems = visibleGallery.filter((item) => item.status === "pending" || item.status === "done" || item.status === "error");
    const currentIndex = viewerItems.findIndex((item) => item.id === activeItem.id);
    function onKeyDown(event: KeyboardEvent) {
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowRight" && currentIndex >= 0) {
        event.preventDefault();
        setViewerZoom(1);
        setViewerPan({ x: 0, y: 0 });
        setActive(viewerItems[(currentIndex + 1) % viewerItems.length]);
      }
      if (event.key === "ArrowLeft" && currentIndex >= 0) {
        event.preventDefault();
        setViewerZoom(1);
        setViewerPan({ x: 0, y: 0 });
        setActive(viewerItems[(currentIndex - 1 + viewerItems.length) % viewerItems.length]);
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setViewerZoom((value) => Math.min(5, Number((value + 0.25).toFixed(2))));
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setViewerZoom((value) => Math.max(0.5, Number((value - 0.25).toFixed(2))));
      }
      if (event.key === "0") {
        event.preventDefault();
        setViewerZoom(1);
        setViewerPan({ x: 0, y: 0 });
      }
      // Delete only: Backspace is pressed by reflex to mean "go back".
      if (event.key === "Delete") {
        event.preventDefault();
        deleteItem(activeItem);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, gallery, mode]);

  useEffect(() => {
    if (!prefs.zenMode || active || settings) return;
    const zenItems = visibleGallery.filter((item) => item.status === "pending" || item.status === "done" || item.status === "error");
    const currentIndex = Math.max(0, zenItems.findIndex((item) => item.id === zenSelectedId));
    function onKeyDown(event: KeyboardEvent) {
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowRight" && zenItems.length) {
        event.preventDefault();
        setZenSelectedId(zenItems[(currentIndex + 1) % zenItems.length].id);
      }
      if (event.key === "ArrowLeft" && zenItems.length) {
        event.preventDefault();
        setZenSelectedId(zenItems[(currentIndex - 1 + zenItems.length) % zenItems.length].id);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [prefs.zenMode, active, settings, gallery, mode, zenSelectedId]);

  useEffect(() => {
    const latest = visibleGallery.find((item) => item.status === "done");
    if (prefs.zenMode && prefs.followLatest && latest && (!zenSelectedId || (latestZenIdRef.current && latest.id !== latestZenIdRef.current))) {
      setZenSelectedId(latest.id);
    }
    if (latest) latestZenIdRef.current = latest.id;
  }, [prefs.zenMode, prefs.followLatest, visibleGallery, zenSelectedId]);

  function setPrefs(next: Partial<Preferences>) {
    const merged = { ...prefs, ...next };
    setPrefsState(merged);
    try {
      localStorage.setItem("heiss-ui-prefs", JSON.stringify(merged));
    } catch {
      showToast("Could not save settings", "error");
    }
  }

  function setZenMode(enabled: boolean) {
    if (!enabled) {
      setZenControls(false);
      setActive(null);
      resetViewer();
    }
    setPrefs({ zenMode: enabled });
  }

  const { confirmAction, confirmationDialog } = useConfirmation(prefs.confirmActions);

  const { upscaleStatus, upscaleUnavailableReason, upscaleSetup, upscaleInstall, upscaleBusyIds, upscaleNotices, dismissUpscaleNotice, refreshUpscaleStatus, cancelUpscaleInstall, activateUpscale, toggleUpscale, cancelUpscale } = useUpscale({
    prefs,
    showToast,
    loadGalleryDelta
  });

  function showToast(message: string, tone: "default" | "success" | "error" = "default") {
    if (tone === "success") toast.success(message);
    else if (tone === "error") toast.error(message);
    else toast(message);
  }

  async function copyAndToast(text: string, message = "Copied") {
    if (!text) {
      showToast("Nothing to copy", "error");
      return;
    }
    const copied = await copyText(text);
    showToast(copied ? message : "Copy failed", copied ? "success" : "error");
  }

  async function copyImageAndToast(item: GalleryItem) {
    const copied = await copyImage(item);
    showToast(copied ? (!item.url ? "Generation details copied" : item.type === "image" ? "Image copied" : "Output link copied") : "Copy failed", copied ? "success" : "error");
  }

  function refreshModels(notify = true) {
    apiJson<Models>("/api/models")
      .then((data: Models) => {
        setModels(data);
        const profileId = model || "";
        if (!profileId && !notify) {
          const defaultProfile = data.profiles.find((item) => item.id === data.defaults.imageModel) || data.profiles[0];
          if (defaultProfile) applyProfile(defaultProfile);
        }
        if (notify) setStatus("Ready");
      })
      .catch((error) => {
        setStatus(error.message);
        if (notify) showToast("Model refresh failed", "error");
      });
  }

  function refreshWorkflows() {
    apiJson<{ workflows: WorkflowSummary[]; preferences: WorkflowPreferences }>("/api/workflows")
      .then((data) => {
        setWorkflows(data.workflows || []);
        if (data.preferences) setWorkflowPreferences(data.preferences);
      })
      .catch(() => null);
  }

  function refreshHealth() {
    apiJson<Health>("/api/health")
      .then(setHealth)
      .catch((error) => setHealth({ ok: false, error: error instanceof Error ? error.message : "Connection failed" }));
  }

  /** The status poll mostly returns the same answer; a new object would re-render the whole app every five seconds. */
  function setComfyStatusIfChanged(next: ComfyStatus) {
    setComfyStatus((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  }

  function refreshComfyStatus(): Promise<void> {
    if (comfyStatusRequestRef.current) return comfyStatusRequestRef.current;
    // Only the first check shows as "checking". Later polls keep the last answer
    // on screen until the new one arrives, so the offline screen and the status
    // dot do not blink (and restart their animations) every five seconds.
    setComfyStatus((current) => (current.checked ? current : { ...current, checking: true }));
    const request = apiJson<ComfyStatus>("/api/comfy/status")
      .then((data) => setComfyStatusIfChanged({ ...data, checking: false, checked: true }))
      .catch((error) => setComfyStatusIfChanged({ connected: false, checking: false, checked: true, error: error instanceof Error ? error.message : "Connection failed" }))
      .finally(() => { comfyStatusRequestRef.current = null; });
    comfyStatusRequestRef.current = request;
    return request;
  }

  /** A retry someone asked for: the buttons say "Checking…" for at least a beat, even when the answer is instant. */
  function retryComfyStatus() {
    if (comfyRetrying) return;
    setComfyRetrying(true);
    const shown = new Promise((resolve) => window.setTimeout(resolve, 700));
    Promise.all([refreshComfyStatus(), shown]).finally(() => setComfyRetrying(false));
  }

  function refreshPaths() {
    apiJson<Paths>("/api/paths")
      .then(setPaths)
      .catch(() => null);
  }

  async function saveOutputDirectory(outputDir: string) {
    try {
      const next = await apiJson<Paths & { report?: OutputFolderReport }>("/api/config/output-dir", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outputDir })
      });
      setPaths(next);
      showToast(next.report?.state === "mismatch" ? "Folder saved, but your recent images aren’t in it" : "Output folder saved", next.report?.state === "mismatch" ? "default" : "success");
      loadGallery().catch(() => null);
      return next.report || null;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not save output folder", "error");
      return null;
    }
  }

  /** Moves finished images into Hidden, each flying into the dock's lock as it goes. */
  async function hideItems(items: GalleryItem[]) {
    const movable = items.filter((item) => item.status === "done" && item.url && !item.privateVault);
    if (!movable.length) return;
    if (!hidden.ensureReady({ kind: "hide", items: movable })) return;
    const target = hiddenDockTarget();
    movable.forEach((item, index) => {
      const tile = document.querySelector(`[data-tile-id="${CSS.escape(item.id)}"]`) || (active?.id === item.id ? document.querySelector(".viewer-canvas img, .viewer-canvas video") : null);
      if (tile) flyInto(tile.getBoundingClientRect(), target, upscaleDisplayThumbnail(item) || item.url, { delay: index * 60 });
    });
    if (active && movable.some((item) => item.id === active.id)) setActive(null);
    removeGalleryItems(movable.flatMap((item) => [item.id, item.url]).filter(Boolean));
    const result = await hidden.hide(movable);
    if (!result || result.failed?.length) loadGallery();
    else showToast(movable.length === 1 ? "Moved to Hidden" : `Moved ${movable.length} images to Hidden`, "success");
  }

  /** Puts Hidden images back in the gallery. */
  async function unhideItems(items: GalleryItem[]) {
    const movable = items.filter((item) => item.status === "done" && item.privateVault);
    if (!movable.length) return;
    const target = document.querySelector("[data-hidden-exit]");
    movable.forEach((item, index) => {
      const tile = document.querySelector(`[data-tile-id="${CSS.escape(item.id)}"]`) || (active?.id === item.id ? document.querySelector(".viewer-canvas img, .viewer-canvas video") : null);
      if (tile) flyInto(tile.getBoundingClientRect(), target, upscaleDisplayThumbnail(item) || item.url, { delay: index * 60 });
    });
    if (active && movable.some((item) => item.id === active.id)) setActive(null);
    removeGalleryItems(movable.map((item) => item.id));
    const result = await hidden.unhide(movable);
    if (!result) loadGallery();
    else showToast(movable.length === 1 ? "Moved to gallery" : `Moved ${movable.length} images to gallery`, "success");
  }

  // Whatever was asked for before Hidden was set up or unlocked happens now.
  useEffect(() => {
    if (!hidden.unlocked || hidden.setupOpen || hidden.unlockOpen || !hidden.intent) return;
    const intent: HiddenIntent | null = hidden.takeIntent();
    if (intent?.kind === "hide") hideItems(intent.items);
    if (intent?.kind === "enter") hidden.setSpace("hidden");
    if (intent?.kind === "generate") window.setTimeout(() => generate(), 0);
  }, [hidden.unlocked, hidden.setupOpen, hidden.unlockOpen, hidden.intent]); // eslint-disable-line react-hooks/exhaustive-deps

  async function checkForUpdates(notify = true) {
    try {
      setUpdateBusy(true);
      // The check the person asks for always goes to GitHub; polling uses the server's cache.
      const data = await apiJson<UpdateStatus>("/api/update/status?fresh=1");
      setUpdateStatus(data);
      if (notify) showToast(data.available ? "Update available" : data.ok ? "Already up to date" : data.error || "Update check failed", data.ok ? "success" : "error");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Update check failed";
      setUpdateStatus({ ok: false, error: message });
      if (notify) showToast(message, "error");
    } finally {
      setUpdateBusy(false);
    }
  }

  async function installUpdate() {
    const release = Boolean(updateStatus?.release);
    if (!await confirmAction(release
      ? { title: `Update to HEISS UI ${updateStatus?.latest}?`, description: `Downloads${updateStatus?.size ? ` ${formatUpdateBytes(updateStatus.size)}` : " the update"} and installs it when HEISS UI restarts.`, action: "Download update" }
      : { title: "Update HEISS UI?", description: "Pulls the latest code, installs packages and rebuilds.", action: "Install update" })) return;
    try {
      setUpdateBusy(true);
      const data = await apiJson<UpdateStatus>("/api/update/install", { method: "POST" });
      setUpdateStatus(data);
      if (release) {
        if (data.message) showToast(data.message, "default");
        return;
      }
      if (data.updated) {
        try { localStorage.setItem(updateInstalledKey, JSON.stringify({ at: Date.now() })); } catch { /* the success toast just won't show */ }
      }
      showToast(data.updated ? "Update installed. Restart HEISS UI to use it." : data.message || "Already up to date", data.updated ? "success" : "default");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Update failed", "error");
    } finally {
      setUpdateBusy(false);
    }
  }

  /** Restarts a release copy through its launcher, which swaps in the downloaded update. */
  async function restartForUpdate() {
    const at = Date.now();
    try {
      await apiJson("/api/update/restart", { method: "POST" });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not restart HEISS UI", "error");
      return;
    }
    try { localStorage.setItem(updateInstalledKey, JSON.stringify({ at })); } catch { /* the toast just won't show */ }
    setRestarting(true);
    // Wait for a server that started after the restart, then load its new page.
    const deadline = at + 3 * 60 * 1000;
    const poll = async () => {
      const data = await fetch("/api/health", { cache: "no-store" }).then((response) => response.json()).catch(() => null);
      if (data?.startedAt && data.startedAt >= at) { window.location.reload(); return; }
      if (Date.now() > deadline) {
        setRestarting(false);
        showToast("HEISS UI did not come back. Start it again with its launcher.", "error");
        return;
      }
      window.setTimeout(poll, 1000);
    };
    window.setTimeout(poll, 1500);
  }

  function applyProfile(profile: Profile, setModelId = true) {
    const nextReferenceInput = imageInputsForProfile(profile)[0];
    if (setModelId) setModel(profile.id);
    setCustomSize(false);
    setTextEncoder(String(profile.defaults.textEncoder || ""));
    setTextEncoders((profile.encoderSlots || []).map((slot) => slot.default));
    setVae(String(profile.defaults.vae || ""));
    setClipType(String(profile.defaults.clipType || ""));
    setWeightDtype(String(profile.defaults.weightDtype || "default"));
    setWidth(Number(profile.defaults.width || 1024));
    setHeight(Number(profile.defaults.height || 1024));
    setSteps(Number(profile.defaults.steps || profile.constraints?.steps?.default || (profile.kind === "video" ? prefs.defaultVideoSteps : prefs.defaultImageSteps)));
    setCfg(Number(profile.defaults.cfg || profile.constraints?.cfg?.default || 1));
    setSampler(String(profile.defaults.sampler || "euler_ancestral"));
    setScheduler(String(profile.defaults.scheduler || "beta"));
    setDenoise(Number(profile.defaults.denoise || profile.constraints?.denoise?.default || 0.65));
    if (profile.kind === "video") {
      setFrames(Number(profile.defaults.frames || prefs.defaultVideoFrames));
      setFps(Number(profile.defaults.fps || profile.constraints?.fps?.default || prefs.defaultFps));
    }
    if (!nextReferenceInput) {
      setReferenceAssets([]);
      setStartImage("");
      setStartImageId("");
      setStartImageName("");
    } else {
      const nextInputs = imageInputsForProfile(profile);
      setReferenceAssets((current) => nextInputs.flatMap((input, index) => {
        const compatible = current.find((item) => item.slot === input.id) || (nextInputs.length === 1 && index === 0 ? current[0] : undefined);
        return compatible ? [{ slot: input.id, asset: compatible.asset }] : [];
      }));
    }
  }

  /** Updates the LoRA stack and remembers it for a workflow: the current one by
   *  default, or the one being switched to when settings are applied together. */
  function setLorasWithMemory(update: React.SetStateAction<LoraSelection[]>, workflowId: string = model) {
    if (workflowId && workflowId !== model) explicitLorasFor.current = workflowId;
    setLoras((current) => {
      const next = normalizeLoras(typeof update === 'function' ? update(current) : update);
      rememberLoraStrengths(workflowId, next);
      rememberActiveLoras(workflowId, next);
      return next;
    });
  }

  // Restore previews of Hidden references once Hidden is open again.
  useEffect(() => {
    if (!hidden.unlocked) return;
    const pending = referenceAssets.filter(({ asset }) => asset.source === "vault" && !asset.thumbnailUrl && asset.galleryItemId);
    if (!pending.length) return;
    let live = true;
    Promise.all(pending.map(({ slot, asset }) => referenceAssetFromGallery(asset.galleryItemId || "").then((resolved) => ({ slot, resolved })).catch(() => null)))
      .then((results) => {
        if (!live) return;
        const found = results.filter(Boolean) as Array<{ slot: string; resolved: ReferenceAsset }>;
        if (found.length) setReferenceAssets((current) => current.map((item) => found.find((hit) => hit.slot === item.slot)?.resolved ? { slot: item.slot, asset: found.find((hit) => hit.slot === item.slot)!.resolved } : item));
      });
    return () => { live = false; };
  }, [hidden.unlocked, referenceAssets]);

  const loraStrengthForCurrentWorkflow = (name: string, fallback: number) => rememberedLoraStrength(model, name, fallback);

  function changeMode(next: Mode) {
    setMode(next);
    if (!models) return;
    if (next === "image") {
      const profile = models.profiles.find((item) => item.id === models.defaults.imageModel);
      if (profile) applyProfile(profile);
    } else {
      const profile = models.profiles.find((item) => item.id === models.defaults.videoModel);
      if (profile) applyProfile(profile);
    }
  }

  function applyAspect(value: string, targetMode = mode) {
    if (value === "default") {
      const defaults = currentProfile?.defaults || {};
      setCustomSize(false);
      setWidth(Number(defaults.width || (targetMode === "video" ? 512 : 1024)));
      setHeight(Number(defaults.height || (targetMode === "video" ? 288 : 1024)));
      return;
    }
    if (value === "free" || value === "custom") {
      setCustomSize(true);
      return;
    }
    const preset = aspectOptions.find((item) => item.value === value) || fallbackAspectPresets[targetMode].find((item) => item.value === value);
    if (!preset) return;
    setCustomSize(false);
    setWidth(preset.w);
    setHeight(preset.h);
  }

  const modelProfiles = useMemo(() => {
    if (!models) return [];
    const favorites = new Set(workflowPreferences.favorites || []);
    const lastUsed = workflowPreferences.lastUsed || {};
    return models.profiles.filter((profile) => profile.kind === mode).sort((a, b) => {
      const favoriteDelta = Number(favorites.has(b.id)) - Number(favorites.has(a.id));
      if (favoriteDelta) return favoriteDelta;
      const recentDelta = Date.parse(lastUsed[b.id] || "0") - Date.parse(lastUsed[a.id] || "0");
      if (recentDelta) return recentDelta;
      const customDelta = Number(a.family === "custom") - Number(b.family === "custom");
      if (customDelta) return customDelta;
      return (a.displayName || a.label).localeCompare(b.displayName || b.label);
    });
  }, [mode, models, workflowPreferences]);

  const currentProfile = useMemo(() => models?.profiles.find((profile) => profile.id === model) || null, [model, models]);
  const toggleModelFavoriteRef = useRef<(id: string) => void>(() => undefined);
  const modelMenu = useMemo(() => ({
    favorites: workflowPreferences.favorites || [],
    recents: Object.entries(workflowPreferences.lastUsed || {}).sort((a, b) => Date.parse(b[1]) - Date.parse(a[1])).map(([id]) => id),
    toggleFavorite: (id: string) => toggleModelFavoriteRef.current(id)
  }), [workflowPreferences]);
  const profileBadges = useMemo(() => {
    const favorites = new Set(workflowPreferences.favorites || []);
    const lastUsed = workflowPreferences.lastUsed || {};
    return Object.fromEntries((models?.profiles || []).map((profile) => [
      profile.id,
      favorites.has(profile.id) ? "Favorite" : lastUsed[profile.id] ? "Recent" : profile.family === "custom" ? "Workflow" : ""
    ]).filter(([, badge]) => badge));
  }, [models, workflowPreferences]);
  const aspectOptions = currentProfile?.aspectPresets?.length ? currentProfile.aspectPresets : fallbackAspectPresets[mode];
  const referenceInputs = imageInputsForProfile(currentProfile);
  const referenceInput = referenceInputs[0] || null;
  const storedReferenceAsset = referenceInput ? referenceAssets.find((item) => item.slot === referenceInput.id)?.asset || referenceAssets[0]?.asset || null : null;
  const referenceAsset: ReferenceAsset | null = storedReferenceAsset || (referenceInput && startImageId ? {
    id: startImageId,
    source: "upload",
    name: startImageName || "Reference image",
    mime: "",
    width: 0,
    height: 0,
    size: 0,
    createdAt: "",
    // Only the id survives a reload for images kept out of the saved draft (Hidden ones);
    // uploads can still be previewed from it, anything else falls back to an icon.
    thumbnailUrl: `/api/reference-assets/${encodeURIComponent(startImageId)}/thumbnail`
  } : null);
  const composerReferenceAssets = referenceAsset && referenceInput && !referenceAssets.some((item) => item.slot === referenceInput.id)
    ? [{ slot: referenceInput.id, asset: referenceAsset }, ...referenceAssets]
    : referenceAssets;
  const canUseStartImage = Boolean(referenceInput);
  const widthMeta = currentProfile?.constraints?.width || {};
  const heightMeta = currentProfile?.constraints?.height || {};
  /* Workflows may declare that a reference image dictates the output framing
     (aspectPolicy: "reference"). When one is selected we hide the manual aspect
     and size controls and let the reference's own dimensions drive generation. */
  const referenceForAspect = currentProfile?.aspectPolicy === "reference"
    ? composerReferenceAssets.find((item) => item.slot === referenceInput?.id)?.asset || null
    : null;
  const aspectLocked = Boolean(referenceForAspect && referenceForAspect.width > 0 && referenceForAspect.height > 0);
  useEffect(() => {
    if (!aspectLocked || !referenceForAspect) return;
    setCustomSize(false);
    setWidth(snapDimension(referenceForAspect.width, widthMeta));
    setHeight(snapDimension(referenceForAspect.height, heightMeta));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspectLocked, referenceForAspect?.id, model]);
  const frameMeta = currentProfile?.constraints?.frames || {};
  const countMeta = currentProfile?.constraints?.count || {};
  const stepsMeta = currentProfile?.constraints?.steps || {};
  const cfgMeta = currentProfile?.constraints?.cfg || {};
  const denoiseMeta = currentProfile?.constraints?.denoise || {};
  const fpsMeta = currentProfile?.constraints?.fps || {};
  const promptLimit = settingMax(currentProfile?.constraints?.prompt);
  const negativeLimit = settingMax(currentProfile?.constraints?.negative);
  const promptRemaining = promptLimit ? Math.max(0, promptLimit - textLength(prompt)) : undefined;
  const profileOptions = currentProfile?.options || {};
  const aspectValue = `${width}x${height}`;
  const defaultAspectSize = `${Number(currentProfile?.defaults.width || (mode === "video" ? 512 : 1024))}x${Number(currentProfile?.defaults.height || (mode === "video" ? 288 : 1024))}`;
  const aspectPickerValue = aspectValue === defaultAspectSize ? "default" : customSize || !aspectOptions.some((item) => item.value === aspectValue) ? "free" : aspectValue;
  const galleryColumnCount = useGalleryColumnCount();
  // Upscales count too, so Stop shows (and stops them) while only an upscale is running.
  const runningCount = visibleGallery.filter((item) => item.status === "pending" || item.upscale?.status === "running").length;
  // Models on this computer that ComfyUI does not read, and the one-step fix for them.
  const modelFolders = useModelFolders({
    connected: comfyStatus.connected,
    emptyModels: Boolean(models && comfyStatus.connected && !models.profiles.some((profile) => profile.ready !== false)),
    onModelsChanged: () => { refreshModels(false); refreshWorkflows(); },
    showToast
  });
  const doneGallery = useMemo(() => visibleGallery.filter((item) => item.status === "done" || item.status === "error"), [visibleGallery]);
  const zenGallery = useMemo(() => visibleGallery.filter((item) => item.status === "pending" || item.status === "done" || item.status === "error"), [visibleGallery]);
  const zenItem = zenGallery.find((item) => item.id === zenSelectedId) || zenGallery[0] || null;
  const zenDisplayItem = zenItem;
  const missingReferenceInput = referenceInputs.find((input) => (input.required || (input.min || 0) > 0) && !composerReferenceAssets.some((item) => item.slot === input.id));
  const missingRequiredReference = Boolean(missingReferenceInput);
  // Built-in families say exactly what they lack; custom workflows fall back to their encoder/VAE fields.
  const modelMissingParts = currentProfile?.missing || [];
  const modelSetupMissing = Boolean(currentProfile && (currentProfile.ready === false
    || (!currentProfile.encoderSlots && ((currentProfile.capabilities.textEncoder && !textEncoder) || (currentProfile.capabilities.vae && !vae)))));
  const generateDisabled = !currentProfile || modelSetupMissing || missingRequiredReference;
  const generateDisabledReason = missingRequiredReference ? `${missingReferenceInput?.label || "Reference image"} is required`
    : modelMissingParts.length ? `Needs ${modelMissingParts.map((item) => item.label).join(", ")}`
    : modelSetupMissing ? "This model needs files first"
    : !currentProfile ? "Choose a workflow" : undefined;
  const loraActiveCount = currentProfile?.capabilities.lora ? loras.filter((item) => item.enabled && item.name).length : 0;

  function onGalleryScroll(event: React.UIEvent<HTMLElement>) {
    if (!hasMoreGallery) return;
    const target = event.currentTarget;
    const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (remaining < 900) loadMoreGalleryItems();
  }

  function chooseModel(profileId: string) {
    const profile = models?.profiles.find((item) => item.id === profileId);
    if (profile) applyProfile(profile);
    else setModel(profileId);
  }

  // Picking in the composer counts as using it, so the menu's Recent follows what you pick.
  function pickModel(profileId: string) {
    chooseModel(profileId);
    const lastUsed = { [profileId]: new Date().toISOString() };
    setWorkflowPreferences((current) => ({ ...current, lastUsed: { ...current.lastUsed, ...lastUsed } }));
    apiJson<{ preferences: WorkflowPreferences }>("/api/workflows/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lastUsed })
    }).then((data) => { if (data.preferences) setWorkflowPreferences(data.preferences); }).catch(() => null);
  }

  function toggleModelFavorite(profileId: string) {
    const current = workflowPreferences.favorites || [];
    const favorites = current.includes(profileId) ? current.filter((id) => id !== profileId) : [...current, profileId];
    setWorkflowPreferences((prefs) => ({ ...prefs, favorites }));
    apiJson<{ preferences: WorkflowPreferences }>("/api/workflows/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorites })
    }).then((data) => {
      if (data.preferences) setWorkflowPreferences(data.preferences);
      refreshWorkflows();
    }).catch(() => showToast("Could not save the favorite", "error"));
  }

  toggleModelFavoriteRef.current = toggleModelFavorite;

  function selectWorkflow(profileId: string) {
    // Picking a video workflow from the image gallery (or the reverse) switches mode with it.
    const profile = models?.profiles.find((item) => item.id === profileId);
    if (profile && profile.kind !== mode) setMode(profile.kind);
    chooseModel(profileId);
    apiJson<{ preferences: WorkflowPreferences }>("/api/workflows/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lastUsed: { [profileId]: new Date().toISOString() } })
    }).then((data) => {
      if (data.preferences) setWorkflowPreferences(data.preferences);
      refreshWorkflows();
    }).catch(() => null);
  }

  async function readStartImage(file: File | undefined) {
    if (!file) return;
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const uploaded = await apiJson<{ startImageId: string }>("/api/start-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataUrl: data, name: file.name })
    });
    setStartImage("");
    setStartImageId(uploaded.startImageId);
    setStartImageName(file.name);
  }

  function selectReferenceAsset(slot: string, asset: ReferenceAsset) {
    if (!referenceInputs.some((input) => input.id === slot)) return;
    setReferenceAssets((current) => [{ slot, asset }, ...current.filter((item) => item.slot !== slot)]);
    setStartImage("");
    if (slot === referenceInput?.id) {
      setStartImageId(asset.id);
      setStartImageName(asset.name);
    }
  }

  function removeReferenceAsset(slot: string) {
    setReferenceAssets((current) => current.filter((item) => item.slot !== slot));
    if (slot === referenceInput?.id) {
      setStartImage("");
      setStartImageId("");
      setStartImageName("");
    }
  }

  async function useOutputAsStartImage(item: GalleryItem) {
    if (!canUseStartImage || item.status !== "done" || item.type !== "image" || !item.url || item.vaultLocked) {
      showToast("The selected workflow cannot use this image as a reference", "error");
      return;
    }
    try {
      const data = await apiJson<{ asset: ReferenceAsset }>("/api/reference-assets/from-gallery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ galleryItemId: item.id })
      });
      setMode("image");
      selectReferenceAsset(referenceInput!.id, data.asset);
      setActive(null);
      showToast("Reference image set", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not use this image", "error");
    }
  }

  async function importWorkflowFile(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      const workflow = JSON.parse(text);
      // Same path as the gallery import: preview first, so the prompt and other
      // controls get auto-mapped and the file name becomes the workflow name.
      const { preview } = await apiJson<{ preview: { detected: Record<string, unknown> } }>("/api/workflows/import/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflow, filename: file.name })
      });
      await apiJson("/api/workflows/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflow, filename: file.name, metadata: preview.detected })
      });
      refreshModels(false);
      refreshWorkflows();
      showToast("Workflow imported", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Workflow import failed", "error");
    }
  }



  const generationActions = useGenerationActions({
    active, canUseStartImage, confirmAction, count, currentProfile, denoise, frames, fps, generateDisabled, generatePostingRef, height, loadGallery, loadGalleryDelta, loras, missingRequiredReference, mode, model, negative, prefs, hiddenSpace, hidden, prompt, referenceAssets: composerReferenceAssets, sampler, scheduler, seed, setActive, setGallery, upsertGalleryItems, removeGalleryItems, removeGalleryItemsWhere, patchGalleryItems, setStatus, setZenSelectedId, showToast, startImage, startImageId, startImageName, steps, cfg, textEncoder, textEncoders, vae, clipType, weightDtype, width, visibleGallery, outputDir: paths.outputDir
  });
  const { generate, cancelJob, cancelQueue, clearGallery, clearFailedItems, resetAllSettings, clearAllCache, openOutputFolder, deleteItem } = generationActions;

  const viewerActions = useViewerControls({
    active, deleteItem, doneGallery: zenGallery, generate, generateDisabled, height, lastTapRef, lastTouchRef, mode, models, prefs, setActive, setCfg, setClipType, setCount, setCustomSize, setDenoise, setFps, setFrames, setHeight, setIsDraggingViewer, setLoras: setLorasWithMemory, setMode, setModel, setNegative, setPrompt, setSampler, setScheduler, setSeed, setShowDetails, setStartImage, setStartImageId, setStartImageName, setSteps, setTextEncoder, setTextEncoders, setVae, setViewerPan, setViewerZoom, setWeightDtype, setWidth, setZenSelectedId, showToast, touchGestureRef, viewerDragEndRef, viewerDragRef, viewerPan, viewerZoom, visibleGallery, width, zenItem, zenStripDragRef, zenStripRef
  });
  const { resetViewer, openItem, applyAllSettings, applyLoras, moveZen, moveViewer, goLatestZen, submitZenPrompt, startZenStripDrag, dragZenStrip, stopZenStripDrag, selectZenItem, zoomViewer, wheelViewer, clickViewer, startViewerDrag, dragViewer, stopViewerDrag, startViewerTouch, moveViewerTouch, endViewerTouch } = viewerActions;

  const currentWorkflow = useMemo(() => workflows.find((w) => w.profileId === model) || null, [workflows, model]);
  // LoRA stacks are shared by every workflow of the same model family.
  const loraFamily = loraFamilyKey(currentProfile?.family);
  const loraStackList = useMemo(() => loraStacks(loraFamily, model), [loraFamily, model, loraSnapshotRevision]);
  const loraFavoriteList = useMemo(() => loraFavorites(), [loraSnapshotRevision]);
  const loraRecentList = useMemo(() => loraRecents(), [loraSnapshotRevision]);
  const bumpLoraLibrary = () => setLoraSnapshotRevision((value) => value + 1);
  const loraLibrary = {
    familyLabel: currentProfile?.family || '',
    stacks: loraStackList,
    favorites: loraFavoriteList,
    recents: loraRecentList,
    loadStack: (stack: LoraSnapshot) => setLorasWithMemory(stack.loras),
    saveStack: (name: string) => { const stack = saveLoraStack(loraFamily, name, loras); bumpLoraLibrary(); return stack; },
    updateStack: (id: string) => { updateLoraStack(loraFamily, id, loras); bumpLoraLibrary(); showToast('Stack updated', 'success'); },
    renameStack: (id: string, name: string) => { renameLoraStack(loraFamily, id, name); bumpLoraLibrary(); },
    deleteStack: async (stack: LoraSnapshot) => {
      if (!await confirmAction({ title: `Delete ${stack.name}?`, description: 'Only the saved stack goes away. The LoRAs stay installed and in use.', action: 'Delete stack', destructive: true })) return false;
      deleteLoraStack(loraFamily, stack.id);
      bumpLoraLibrary();
      return true;
    },
    toggleFavorite: (name: string) => { toggleLoraFavorite(name); bumpLoraLibrary(); },
    recordRecents: (names: string[]) => { recordLoraRecents(names); bumpLoraLibrary(); }
  };
  const sidebarControls = <StableSidebarControls view={{ canUseStartImage, cfg, cfgMeta, changeMode, clipType, confirmAction, count, countMeta, currentProfile, currentWorkflow, customSize, aspectLocked, denoise, denoiseMeta, fps, fpsMeta, frameMeta, frames, height, heightMeta, loras, loraActiveCount, mode, models, profileOptions, readStartImage, sampler, scheduler, seed, setCfg, setCount, setDenoise, setFps, setFrames, setHeight, setLoras: setLorasWithMemory, setSampler, setScheduler, setSeed, setStartImage, setStartImageId, setStartImageName, setSteps, setTextEncoder, setTextEncoders, setVae, setWeightDtype, setWidth, setWorkflowGalleryOpen, startImageName, steps, stepsMeta, textEncoder, textEncoders, refreshModels, refreshWorkflows, showToast, modelFolders, vae, weightDtype, width, widthMeta, workflowPreferences, loraLibrary, rememberedLoraStrength: loraStrengthForCurrentWorkflow, sidebarTab, setSidebarTab }} />;

  const baseView = { pendingBundles, compactGallery, compactBusy, gatheringIds, settlingBundles, setBundleCover, ungroupBundle, active, applyAllSettings, applyLoras, applyAspect, aspectOptions, aspectPickerValue, aspectValue, aspectLocked, defaultAspectSize, canUseStartImage, cancelJob, cancelQueue, checkForUpdates, restartForUpdate, restarting, confirmAction, clearAllCache, clearFailedItems, clearGallery, clickViewer, comfyStatus, copyAndToast, copyImageAndToast, count, countMeta, currentProfile, customSize, deleteItem, doneGallery, zenGallery, gallery, galleryColumnCount, galleryLoaded, galleryCrossing, galleryRevision, galleryStageRef, galleryTotalApprox, generate, generateDisabled, generateDisabledReason, goLatestZen, hasMoreGallery, health, height, heightMeta, importWorkflowFile, installUpdate, isDraggingViewer, isMobile, loadMoreGalleryItems, loraActiveCount, mode, model, modelProfiles, models, moveViewer, moveViewerTouch, moveZen, negative, negativeLimit, now, onGalleryScroll, openItem, openOutputFolder, paths, prefs, hidden, hiddenSpace, hideItems, unhideItems, profileBadges, prompt, promptLimit, referenceAsset, referenceInput, refreshComfyStatus, retryComfyStatus, comfyRetrying, comfyReconnectedAt, refreshHealth, refreshModels, refreshWorkflows, removeReferenceAsset, renderedGallery, resetAllSettings, resetViewer, runningCount, saveOutputDirectory, selectReferenceAsset, selectWorkflow, setActive, setCount, setHeight, setNegative, setPrompt, setSettings, setShowDetails, setShowGenerationSettings, setShowNegativePrompt, setSteps, setWidth, setWorkflowGalleryOpen, setWorkflowPreferences, setWorkflows, setZenControls, setZenGalleryOpen, setZenMode, showDetails, showGenerationSettings, showNegativePrompt, showToast, sidebarControls, startViewerDrag, startViewerTouch, status, steps, stepsMeta, stopViewerDrag, submitZenPrompt, touchGestureRef, updateBusy, updateStatus, useOutputAsStartImage, viewerDragEndRef, viewerDragRef, viewerPan, viewerZoom, wheelViewer, width, widthMeta, workflowGalleryOpen, workflowPreferences, workflows, zenControls, zenDisplayItem, zenGalleryOpen, zenItem, zenPromptRef, zenSelectedId, zenStripDragRef, zenStripRef, dragViewer, dragZenStrip, endViewerTouch, selectZenItem, startZenStripDrag, stopZenStripDrag, characterMeta, formatElapsed, generationDetailEntries, titleFromPrompt , zoomViewer, clampText, promptRemaining, chooseModel, pickModel, modelMenu, visibleGallery, settings, setPrefs, upscaleStatus, upscaleUnavailableReason, upscaleSetup, upscaleInstall, upscaleBusyIds, upscaleNotices, dismissUpscaleNotice, toggleUpscale, cancelUpscale, refreshUpscaleStatus, cancelUpscaleInstall, activateUpscale, upscaleDisplayUrl, modelFolders, openLoras: () => { setSidebarTab('loras'); setZenControls(true); } };

  // How much a start image may change: denoise, shown next to the image in the composer.
  const referenceStrength = currentProfile?.capabilities.denoise ? { value: denoise, onChange: setDenoise, meta: denoiseMeta } : null;
  const view = { ...baseView, referenceAssets: composerReferenceAssets, referenceInputs, referenceStrength };
  return (
    <>
      <StudioView view={view} />
      {confirmationDialog}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

import { t } from './i18n/core.js';
import { useLanguage } from './i18n/react';
import "./app/domGuard";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { RefreshCw } from "lucide-react";
import { showToastTone as showToast, toast } from "./app/toast";
import "./styles.css";

import { useModelFolders } from './app/useModelFolders';
import type { AspectPreset, AutoUpscale, PreviousExit, SavedSize, ComfyStatus, GalleryItem, Health, LoraSelection, MediaInput, Mode, Models, OutputFolderReport, Paths, Preferences, Profile, InpaintMask, ReferenceAsset, ReferenceInpaint, ReferenceRole, ReferenceRoleControl, SelectedReferenceAsset, TouchGesture, UpdatePrefs, UpdateStatus, WorkflowPreferences, WorkflowSummary } from './app/types';
import { fallbackAspectPresets } from './app/constants';
import { apiJson, copyImage, copyText, loadDraft, loadPrefs, referenceAssetFromGallery } from './app/api';
import { characterMeta, clampText, clientJobUuid, formatElapsed, generationDetailEntries, settingMax, textLength, titleFromPrompt } from './app/format';
import { useGalleryColumnCount } from './app/gallery';
import { normalizeLoras, sameBaseModel } from './app/loras';
import { arrangeReferences, referenceRoleFor, referenceRoleOffered, withReference, withoutReferences } from './app/referenceSlots';
import { deleteLoraStack, loraFamilyKey, loraFavorites, loraRecents, loraStacks, recordLoraRecents, rememberActiveLoras, rememberedLoraStrength, rememberLoraStrengths, renameLoraStack, saveLoraStack, startLoraSync, subscribeLoraLibrary, subscribeLoraSync, toggleLoraFavorite, updateLoraStack, type LoraSnapshot, type LoraSyncStatus } from './app/lora-storage';
import { useConfirmation } from './app/useConfirmation';
import { StudioView } from './app/StudioView';
import { DeviceGate } from './app/DeviceGate';
import { CrashBoundary } from './app/CrashScreen';
import { TooltipProvider } from './components/ui/tooltip';
import { setShareSettings } from './app/shareSettings';
import { PhoneAdvancedControls, SidebarControls } from './app/SidebarControls';
import { useGenerationActions } from './app/useGenerationActions';
import { loraFit, useLoraInfo } from './app/useLoraInfo';
import type { LoraMismatch } from './app/LoraMismatchChip';
import { useViewerControls } from './app/useViewerControls';
import { collapseRuns, useGalleryGroups } from './app/useGalleryGroups';
import { viewerOrder } from './app/viewerOrder';
import { useUnstackedRuns } from './app/useUnstackedRuns';
import { useRunSettling } from './app/useRunSettling';
import { runTitle, type Run } from './app/runs';
import { useGalleryStore } from './app/useGalleryStore';
import { emptySearch, searchActive, useFavorites, type GallerySearch } from './app/favorites';
import { sizePlan, tiledDecodeFor, upscaleDisplayThumbnail, upscaleDisplayUrl, upscaleSize, useUpscale } from './app/useUpscale';
import { closestPreset, fitRatio, MEGAPIXEL, sameRatio, snapSide } from './app/sizing';
import type { MegapixelControl, SizeTier } from './app/SizeMenu';
import { useHidden, type HiddenIntent } from './app/useHidden';
import { flyInto, hiddenDockTarget } from './app/hiddenMotion';
import { useVisibleInterval } from './hooks/use-visible-interval';
import { useKeyboardInset } from './hooks/use-keyboard-inset';
import { setAtComputer, setThisComputer, usePhone, useThisComputer } from './app/device';
import { useArrowKeyGroups } from './hooks/use-arrow-key-groups';
import { useGenerationEstimate } from './app/useGenerationEstimate';
import { listNames, registerRestartConfirm, setComfyRestartClock, setComfyRestartResult, setComfyRestarting } from './app/ComfyRestart';
import { memoLatest } from './lib/memo-latest';
import { refreshHardware } from './app/hardware';
import { starterPromptsFor, surprisePrompt } from './app/starterPrompts';
import { generateShortcut } from './app/shortcuts';
import type { StarterPick } from './app/StarterModels';

// Rebuilt from scratch on every App render (each keystroke in the prompt); skips unless its data changed.
const StableSidebarControls = memoLatest(SidebarControls);
const StablePhoneAdvancedControls = memoLatest(PhoneAdvancedControls);

/** Snap a raw pixel dimension to something ComfyUI will accept: a multiple of the
 *  workflow's step (default 8), clamped to its width/height range. */
/** Custom's range for one side: 256 to 4096, on the model's step or 16, whichever is coarser. */
function customSideLimits(meta: Record<string, number> = {}) {
  return { min: 256, max: Math.min(Number(meta.max) || 4096, 4096), step: Math.max(Number(meta.step) || 0, 16) };
}

function snapDimension(value: number, meta: Record<string, number> = {}): number {
  const step = meta.step || 8;
  const min = meta.min ?? 64;
  const max = meta.max ?? 4096;
  const snapped = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, snapped || step));
}

function imageInputsForProfile(profile: Profile | null | undefined): MediaInput[] {
  if (!profile) return [];
  const declared = (profile.mediaInputs || []).filter((input) => input.kind === "image");
  // Video models take a picture only when they declare it (image-to-video's start image).
  if (declared.length) return declared;
  if (profile.kind !== "image") return [];
  // Edit models read a reference; everything else can only start from a picture and redraw it.
  if (profile.capabilities.imageToImage) {
    return [{ id: "reference", kind: "image", required: true, min: 1, max: 1, label: t("Reference image"), role: "reference" }];
  }
  if (profile.capabilities.startImage) {
    return [{ id: "reference", kind: "image", required: false, min: 0, max: 1, label: t("Start image"), role: "start" }];
  }
  return [];
}


const updateInstalledKey = "heiss-ui:update-installed";
// A restart this page asked for, so the page it reloads into can say how it went.
const restartedKey = "heiss-ui:restarted";
const restartToastId = "heiss-restart";
const formatUpdateBytes = (bytes = 0) => `${(bytes / 1024 ** 2).toFixed(bytes > 100 * 1024 ** 2 ? 0 : 1)} MB`;

// Another dialog on top owns the keyboard. The viewer is a dialog too, but it is
// the surface these shortcuts drive, so it does not count (data-focus-trap).
const OPEN_DIALOG = '[role="dialog"]:not([data-focus-trap]), [role="alertdialog"]';

function App() {
  useLanguage();
  useKeyboardInset();
  useArrowKeyGroups();
  const now = Date.now();
  const initialDraft = useMemo(() => loadDraft(), []);
  const [mode, setMode] = useState<Mode>(initialDraft.mode === "video" ? "video" : "image");
  const [models, setModels] = useState<Models | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [comfyStatus, setComfyStatus] = useState<ComfyStatus>({ connected: false, checking: true });
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  // The version this page just came back on after an update, for the "Updated" pill.
  const [justUpdated, setJustUpdated] = useState("");
  const [prefs, setPrefsState] = useState<Preferences>(() => loadPrefs());
  // Read by every download link and share as it is made (shareSettings.ts); kept in step here.
  setShareSettings(prefs);
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
  // Inpainting: a mask painted on the first reference (never saved with the draft or a run),
  // how much the painted part may change, and how softly it blends back in.
  const [inpaintMask, setInpaintMask] = useState<InpaintMask | null>(null);
  const [inpaintStrength, setInpaintStrength] = useState(Number(initialDraft.inpaintStrength || 1));
  const [inpaintFeather, setInpaintFeather] = useState(Number(initialDraft.inpaintFeather ?? 0.4));
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
  const modelsRefreshRef = useRef<Promise<unknown> | null>(null);
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
  // The gallery search: words and the Favourites filter. Lives in memory only, never saved.
  const [gallerySearch, setGallerySearch] = useState<GallerySearch>(emptySearch);
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
  } = useGalleryStore({ mode, showFailedItems: prefs.showFailedItems, space: hidden.space, onLocked: hidden.refresh, search: gallerySearch });
  const toggleFavorite = useFavorites({ patchGalleryItems, removeGalleryItems, setActive, search: gallerySearch, showToast });

  // Moments and runs: a way of looking at the gallery, worked out from what is
  // loaded (runs.js). Runs stack only when asked, and never in search results.
  const stackRuns = Boolean(prefs.stackRuns) && !searchActive(gallerySearch);
  const foundGroups = useGalleryGroups(visibleGallery, { runs: stackRuns });
  const { groups: keptGroups, unstack } = useUnstackedRuns(foundGroups);
  // Runs settle rather than snap: a run being worked on stays plain tiles, and
  // folds once it's been quiet and is off screen (useRunSettling).
  const { groups: galleryGroups, settleVersion } = useRunSettling(keptGroups, { enabled: stackRuns, showToast });
  // Which stacked runs are laid out open, on their shelves.
  const [openRuns, setOpenRuns] = useState<Set<string>>(() => new Set());
  const setRunOpen = useCallback((runId: string, open: boolean) => {
    setOpenRuns((current) => {
      if (current.has(runId) === open) return current;
      const next = new Set(current);
      if (open) next.add(runId); else next.delete(runId);
      return next;
    });
  }, []);
  // Taking a run apart for good: its tiles stay separate, with a way back.
  const unstackRun = useCallback((run: Run) => {
    unstack(run, true);
    setOpenRuns((current) => {
      if (!current.has(run.id)) return current;
      const next = new Set(current);
      next.delete(run.id);
      return next;
    });
    showToast(t("Unstacked"), "default", { description: runTitle(run), action: { label: t("Undo"), onClick: () => { unstack(run, false); setOpenRuns((current) => new Set([...current, run.id])); } } });
  }, [unstack]); // eslint-disable-line react-hooks/exhaustive-deps
  // Zen steps over a stacked run as one thing, and shows it as a run.
  const zenGallery = useMemo(() => {
    const shown = visibleGallery.filter((item) => item.status === "pending" || item.status === "done" || item.status === "error");
    return stackRuns ? collapseRuns(shown, galleryGroups, openRuns) : shown;
  }, [visibleGallery, stackRuns, galleryGroups, openRuns]);

  // The viewer steps through the gallery as it is laid out: a stacked run's
  // takes one after another where the stack stands, not wherever they fell in time.
  const viewerGallery = useMemo(() => viewerOrder(visibleGallery, stackRuns ? galleryGroups : null, openRuns), [visibleGallery, stackRuns, galleryGroups, openRuns]);

  // Chrome on Windows can hand playing videos to a hardware layer that frosted
  // glass can't blur, so the glass over the video gallery shows it through.
  // There, in video mode, the glass turns nearly opaque (16-system.css).
  useEffect(() => {
    const root = document.documentElement;
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "";
    root.classList.toggle("is-windows", /^win/i.test(platform));
    root.classList.toggle("is-video-mode", mode === "video");
  }, [mode]);
  useEffect(() => {
    refreshHealth();
    refreshComfyStatus();
    refreshModels(false);
    refreshWorkflows();
    refreshPaths();
    // A failed first load would leave the skeleton spinning forever: say so, and keep trying.
    let cancelled = false;
    let attempt = 0;
    let timer = 0;
    const load = () => loadGallery().catch(() => {
      if (cancelled) return;
      attempt += 1;
      if (attempt === 1) showToast(t("Couldn’t load the gallery. Trying again…"), "error");
      timer = window.setTimeout(load, Math.min(15000, 2000 * attempt));
    });
    load();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [loadGallery]);

  // Locking or unlocking changes what Hidden can show; so does another device doing it.
  useEffect(() => {
    if (!hiddenSpace) return;
    if (!hidden.unlocked) setActive(null);
    loadGallery().catch(() => null);
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
      if (result && !result.ok) showToast(result.rolledBack ? `HEISS UI ${result.to} didn’t start. Back on ${result.from}${result.error ? ` (${result.error})` : ""}.` : result.error || "The update didn’t install", "error");
      else if (status?.release) setJustUpdated(result?.to || status.current || "");
      else showToast(t("HEISS UI updated"), "success");
    }).catch(() => null);
  }, []);

  // After any restart from here: say HEISS UI is back, and for the LAN switch, whether
  // other devices can now reach it. An update says its own thing above.
  useEffect(() => {
    let pending: { at: number; lan?: boolean } | null = null;
    try { pending = JSON.parse(localStorage.getItem(restartedKey) || "null"); } catch { pending = null; }
    if (!pending?.at) return;
    try { localStorage.removeItem(restartedKey); } catch { /* nothing to clear */ }
    // An old marker (the restart never came back here) says nothing about this page.
    if (Date.now() - pending.at > 10 * 60 * 1000) return;
    if (typeof pending.lan !== "boolean") {
      showToast(t("HEISS UI restarted"), "success");
      return;
    }
    const wanted = pending.lan;
    apiJson<{ listening: boolean; addresses: string[]; port: number }>("/api/network").then((network) => {
      if (network.listening === wanted) {
        const address = network.addresses[0];
        showToast(wanted ? "Open on other devices" : "Closed to other devices", "success", wanted && address ? { description: t("On this network: {0}//{1}:{2}", { "0": (window.location.protocol), "1": (address), "2": (window.location.port || network.port) }) } : undefined);
      } else {
        showToast(wanted ? "Still closed to other devices" : "Still open to other devices", "error", { description: t("HEISS UI restarted, but the setting didn’t take. Settings › Connection says why."), duration: Infinity });
      }
    }).catch(() => showToast(t("HEISS UI restarted"), "success"));
  }, []);

  // A release download runs on the server; follow it while it is in flight.
  const downloadStage = updateStatus?.download?.status;
  useEffect(() => {
    if (downloadStage !== "downloading" && downloadStage !== "verifying" && downloadStage !== "unpacking") return;
    const timer = window.setInterval(() => {
      // The update pill (or Settings › About) shows how it ends.
      apiJson<UpdateStatus>("/api/update/status").then(setUpdateStatus).catch(() => null);
    }, 800);
    return () => window.clearInterval(timer);
  }, [downloadStage]);

  // Looks for a new release on its own, on the computer that can install it:
  // shortly after opening, then every six hours while the page is open (the
  // server keeps GitHub's answer, so every device and tab share one ask). It
  // stays silent when offline or switched off in Settings › About.
  // Not tied to ComfyUI: the address says "this computer" before /api/health
  // does, and the server refuses anyone else anyway.
  const canManage = useThisComputer();
  const lastUpdateCheck = useRef(0);
  const refreshUpdateStatus = () => {
    lastUpdateCheck.current = Date.now();
    fetch("/api/update/status?auto=1", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<UpdateStatus> : null)
      // Only a release copy has an answer here; a checkout keeps what About found.
      .then((data) => { if (data?.ok && data.release) setUpdateStatus(data); })
      .catch(() => null);
  };
  useEffect(() => {
    if (!canManage) return;
    const check = () => {
      if (document.hidden || Date.now() - lastUpdateCheck.current < 6 * 60 * 60 * 1000) return;
      refreshUpdateStatus();
    };
    // The server asked GitHub when it started, so this is usually instant.
    const first = window.setTimeout(check, 1500);
    const timer = window.setInterval(check, 30 * 60 * 1000);
    document.addEventListener("visibilitychange", check);
    return () => { window.clearTimeout(first); window.clearInterval(timer); document.removeEventListener("visibilitychange", check); };
  }, [canManage]);

  /** "Later" on the update pill, or the automatic-check switch: shared by every device. */
  async function setUpdatePrefs(next: Partial<UpdatePrefs>) {
    setUpdateStatus((current) => current?.prefs ? { ...current, prefs: { ...current.prefs, ...next } } : current);
    try {
      const data = await apiJson<{ prefs: UpdatePrefs }>("/api/update/prefs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      setUpdateStatus((current) => current ? { ...current, prefs: data.prefs } : current);
      // Switched back on: look now rather than in six hours.
      if (next.autoCheck) apiJson<UpdateStatus>("/api/update/status?auto=1").then((status) => { if (status.ok && status.release) setUpdateStatus(status); }).catch(() => null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn’t save that", "error");
    }
  }

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
          ? "LoRA changes are saved on this device. Sign in again to sync them."
          : "Can’t reach HEISS UI. LoRA changes are saved on this device and sync when it’s back.", "error");
      } else if (!sync.failing && loraSyncFailing.current && !sync.pending) {
        showToast(t("LoRA changes synced"), "success");
      }
      if (!sync.failing || sync.pending > 0) loraSyncFailing.current = sync.failing && sync.pending > 0;
    });
    return () => { stop(); offLibrary(); offSync(); };
  }, []);

  // Switching workflow on the same weights keeps the stack. A different base
  // model starts from its own last stack, or none: LoRAs don't carry across models.
  const lorasModelRef = useRef("");
  useEffect(() => {
    const previous = lorasModelRef.current;
    lorasModelRef.current = model;
    if (!model) return;
    if (explicitLorasFor.current === model) {
      explicitLorasFor.current = "";
      return;
    }
    const profileFor = (id: string) => models?.profiles.find((profile) => profile.id === id);
    if (previous && sameBaseModel(profileFor(previous), profileFor(model))) {
      setLorasWithMemory((current) => current);
      return;
    }
    if (previous) setLoras([]);
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
  // A new ComfyUI version counts too: an update and restart can fall between two checks
  // without ever looking offline, and what it runs may have changed (a model it couldn't before).
  const lastComfyVersion = useRef("");
  useEffect(() => {
    if (!comfyStatus.checked) return;
    const previous = wasConnected.current;
    wasConnected.current = comfyStatus.connected;
    const version = comfyStatus.connected ? comfyStatus.version || "" : "";
    const updated = Boolean(version && lastComfyVersion.current && version !== lastComfyVersion.current);
    if (version) lastComfyVersion.current = version;
    if (!updated && (previous !== false || !comfyStatus.connected)) return;
    refreshModels(false);
    refreshWorkflows();
    refreshHealth();
    refreshHardware();
    refreshUpscaleStatus(prefs.upscaleQuality, { fresh: true });
    setComfyReconnectedAt(Date.now());
  }, [comfyStatus.connected, comfyStatus.checked, comfyStatus.version]);

  // A restart HEISS asked for: every surface says "restarting", the poll speeds
  // up so ComfyUI's return shows at once, and a restart that never comes back
  // hands over to plain reconnecting with one clear message.
  const comfyRestarting = Boolean(comfyStatus.restarting);
  // The restart this device watched, so its end is told here once, and only here.
  const watchedRestart = useRef(0);
  const lastRestart = comfyStatus.lastRestart;
  useEffect(() => {
    if (comfyRestarting && comfyStatus.restartStartedAt) {
      watchedRestart.current = comfyStatus.restartStartedAt;
      setComfyRestartClock({ startedAt: comfyStatus.restartStartedAt, elapsedMs: comfyStatus.restartElapsedMs ?? 0, typicalMs: comfyStatus.restartTypicalMs });
    } else {
      setComfyRestartClock(null);
    }
    if (lastRestart && lastRestart.startedAt === watchedRestart.current) {
      watchedRestart.current = 0;
      setComfyRestartResult(lastRestart);
      if (lastRestart.outcome === "failed") showToast(t("ComfyUI didn’t come back after the restart. Check its window for errors."), "error");
      else if (lastRestart.failedPacks?.length) showToast(t("ComfyUI is back, but {0} didn’t load. See its window for details.", { "0": (listNames(lastRestart.failedPacks)) }), "error");
      else if (lastRestart.newPacks?.length) showToast(t("ComfyUI is back with {0}.", { "0": (listNames(lastRestart.newPacks)) }), "success");
    }
    setComfyRestarting(comfyRestarting);
  }, [comfyRestarting, comfyStatus.restartStartedAt, comfyStatus.restartTypicalMs, lastRestart?.startedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onRestart = () => {
      refreshComfyStatus();
      window.setTimeout(() => refreshComfyStatus(), 1200);
    };
    window.addEventListener("heiss:comfy-restart", onRestart);
    return () => window.removeEventListener("heiss:comfy-restart", onRestart);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useVisibleInterval(refreshComfyStatus, comfyRestarting ? 1500 : 5000);

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
      if (document.querySelector(OPEN_DIALOG)) return;
      if (event.defaultPrevented || document.fullscreenElement) return;
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
      if (document.querySelector(OPEN_DIALOG)) return;
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
      inpaintStrength,
      inpaintFeather,
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
  }, [mode, prompt, negative, model, textEncoder, textEncoders, vae, clipType, weightDtype, width, height, steps, cfg, denoise, inpaintStrength, inpaintFeather, seed, count, frames, fps, sampler, scheduler, loras, customSize, startImageId, startImageName, referenceAssets, advanced, showDetails, showGenerationSettings, showNegativePrompt, zenGalleryOpen, zenControls, zenSelectedId, hiddenSpace]);

  useEffect(() => {
    if (!active) return;
    const activeItem = active;
    const viewerItems = visibleGallery.filter((item) => item.status === "pending" || item.status === "done" || item.status === "error");
    const currentIndex = viewerItems.findIndex((item) => item.id === activeItem.id);
    function onKeyDown(event: KeyboardEvent) {
      if (document.querySelector(OPEN_DIALOG)) return;
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[data-video-viewer]'))) return;
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
      if (activeItem.type === 'image' && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        setViewerZoom((value) => Math.min(6, Number((value + 0.25).toFixed(2))));
      }
      if (activeItem.type === 'image' && (event.key === "-" || event.key === "_")) {
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

  // The viewer holds the item it opened with; follow the gallery's copy, so an
  // upscale starting, ticking and finishing (or a star) shows while it is open.
  useEffect(() => {
    setActive((current) => {
      if (!current) return current;
      const fresh = gallery.find((item) => item.id === current.id);
      return fresh && fresh !== current ? fresh : current;
    });
  }, [gallery]);

  useEffect(() => {
    if (!prefs.zenMode || active || settings) return;
    const zenItems = zenGallery;
    const currentIndex = Math.max(0, zenItems.findIndex((item) => item.id === zenSelectedId));
    function onKeyDown(event: KeyboardEvent) {
      if (document.querySelector(OPEN_DIALOG)) return;
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
  }, [prefs.zenMode, active, settings, gallery, mode, zenSelectedId, zenGallery]);

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
      showToast(t("Couldn’t save settings"), "error");
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

  const { upscaleStatus, upscaleUnavailableReason, upscaleSetup, upscaleInstall, upscaleBusyIds, upscaleNotices, dismissUpscaleNotice, refreshUpscaleStatus, cancelUpscaleInstall, activateUpscale, toggleUpscale, cancelUpscale, chooseAutoUpscale } = useUpscale({
    gallery,
    prefs,
    showToast,
    loadGalleryDelta,
    patchGalleryItems,
    setPrefs
  });


  /**
   * Copies for a button that shows its own check (useCopyFeedback), so only a
   * failure is a toast. `announce` says it in a toast instead, for the few
   * buttons that are gone once clicked (a tile's menu).
   */
  async function copyToClipboard(text: string, announce = ""): Promise<boolean> {
    if (!text) {
      showToast(t("Nothing to copy"), "error");
      return false;
    }
    const copied = await copyText(text);
    if (!copied) showToast(t("Couldn’t copy"), "error");
    else if (announce) showToast(announce, "success");
    return copied;
  }

  /** The viewer's copy button: the image itself, its link, or its details. */
  async function copyItemToClipboard(item: GalleryItem): Promise<boolean> {
    const copied = await copyImage(item);
    if (!copied) showToast(t("Couldn’t copy"), "error");
    return copied;
  }

  function refreshModels(notify = true) {
    const request = apiJson<Models>("/api/models")
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
        if (notify) showToast(t("Couldn’t refresh models"), "error", { action: { label: t("Try again"), onClick: () => refreshModels(true) } });
      });
    modelsRefreshRef.current = request;
    return request;
  }

  function refreshWorkflows() {
    // /api/models asks ComfyUI afresh; /api/workflows reuses that answer, so it waits for a
    // refresh in flight rather than racing it and showing a model as still missing files.
    const pending = modelsRefreshRef.current || Promise.resolve();
    pending.catch(() => null)
      .then(() => apiJson<{ workflows: WorkflowSummary[]; preferences: WorkflowPreferences }>("/api/workflows"))
      .then((data) => {
        setWorkflows(data.workflows || []);
        if (data.preferences) setWorkflowPreferences(data.preferences);
      })
      .catch(() => null);
  }

  /** How the last run stopped, when nobody meant it to: told once per stop, on this computer. */
  function tellPreviousExit(exit: PreviousExit) {
    const key = `heiss-ui:exit-told:${exit.at}`;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch { /* told this session at most */ }
    const when = new Date(exit.lastSeen || exit.at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
    const details = [`HEISS UI stopped: ${exit.reason}`, `Last seen running: ${new Date(exit.lastSeen || exit.at).toISOString()}`, exit.code !== null ? `Exit code: ${exit.code}` : "", exit.signal ? `Signal: ${exit.signal}` : "", exit.detail ? `\nLast output:\n${exit.detail}` : ""].filter(Boolean).join("\n");
    showToast(t("HEISS UI stopped unexpectedly last time"), "warning", {
      description: t("{0} Last seen running {1}.", { "0": (exit.reason.replace(/\.?$/, ".")), "1": (when) }),
      duration: 20_000,
      action: { label: t("Copy details"), onClick: () => { void copyToClipboard(details, "Details copied"); } }
    });
  }

  function refreshHealth() {
    // 503 only means ComfyUI isn't answering: its body still says whether
    // this is the computer that looks after HEISS UI, so read it either way.
    fetch("/api/health", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as Health | null;
        if (!data) throw new Error(response.statusText || "Connection failed");
        setHealth(data);
        if (typeof data.thisComputer === "boolean") setThisComputer(data.thisComputer);
        if (typeof data.atComputer === "boolean") setAtComputer(data.atComputer);
        if (data.previousExit) tellPreviousExit(data.previousExit);
      })
      .catch((error) => setHealth({ ok: false, error: error instanceof Error && !/fetch|load failed/i.test(error.message) ? error.message : "Can’t reach HEISS UI. Make sure it’s running." }));
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
      .then((data) => {
        // Not at the saved address, but on ComfyUI Desktop's port (or the other way round): now saved.
        if (data.found) {
          showToast(t("Found ComfyUI at {0}", { "0": (data.found.replace(/^https?:\/\//, "")) }), "success");
          refreshHealth();
        }
        const { found: _found, ...status } = data;
        setComfyStatusIfChanged({ ...status, checking: false, checked: true });
      })
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
      // The row shows the saved folder; only a folder that doesn't hold your images is worth a word.
      if (next.report?.state === "mismatch") showToast(t("Folder saved. Recent images aren’t in it."), "warning");
      loadGallery().catch(() => null);
      return next.report || null;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn’t save the output folder", "error");
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
    if (!result || result.failed?.length) { loadGallery().catch(() => null); return; }
    const hiddenIds = result.hiddenIds || [];
    toast.success("Moved to Hidden", {
      group: "hide",
      count: movable.length,
      plural: (count) => `Moved ${count} images to Hidden`,
      glyph: "lock",
      action: hiddenIds.length ? {
        label: t("Undo"),
        onClick: async () => {
          await hidden.unhide(hiddenIds.map((id) => ({ id } as GalleryItem)));
          loadGallery().catch(() => null);
        }
      } : undefined
    });
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
    else toast.success("Moved to gallery", { group: "unhide", count: movable.length, plural: (count) => `Moved ${count} images to gallery` });
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
      if (notify) showToast(data.available ? "Update available" : data.ok ? "Up to date" : data.error || "Couldn’t check for updates", data.ok ? "success" : "error");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn’t check for updates";
      setUpdateStatus({ ok: false, error: message });
      if (notify) showToast(message, "error");
    } finally {
      setUpdateBusy(false);
    }
  }

  async function installUpdate({ confirm = true }: { confirm?: boolean } = {}) {
    const release = Boolean(updateStatus?.release);
    if (confirm && !await confirmAction(release
      ? { title: t("Update to HEISS UI {0}?", { "0": (updateStatus?.latest) }), description: t("Downloads{0} and installs it when HEISS UI restarts.", { "0": (updateStatus?.size ? ` ${formatUpdateBytes(updateStatus.size)}` : t(" the update")) }), action: t("Download") }
      : { title: t("Update HEISS UI?"), description: t("Pulls the latest code, installs packages and rebuilds."), action: t("Update") })) return;
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
      showToast(data.updated ? "Update installed. Restart HEISS UI to use it." : data.message || "Up to date", data.updated ? "success" : "default");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn’t update", "error", { action: { label: t("Try again"), onClick: () => installUpdate({ confirm: false }) } });
    } finally {
      setUpdateBusy(false);
    }
  }

  /**
   * Restarts HEISS UI through its launcher (which also swaps in a downloaded
   * update), then reloads the page once the new server answers.
   */
  async function restartHeiss({ update = false, lan }: { update?: boolean; lan?: boolean } = {}) {
    const at = Date.now();
    try {
      await apiJson("/api/update/restart", { method: "POST" });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn’t restart HEISS UI", "error", { id: restartToastId, duration: Infinity, action: { label: t("Try again"), onClick: () => restartHeiss({ update, lan }) } });
      return false;
    }
    // A downloaded update goes in with any restart, so say so when the page comes back.
    const withUpdate = update || updateStatus?.download?.status === "ready";
    try {
      if (withUpdate) localStorage.setItem(updateInstalledKey, JSON.stringify({ at }));
      else localStorage.setItem(restartedKey, JSON.stringify({ at, ...(typeof lan === "boolean" ? { lan } : {}) }));
    } catch { /* the toast just won't show */ }
    showToast(withUpdate ? "Installing the update…" : "Restarting HEISS UI…", "default", { id: restartToastId, duration: Infinity, description: t("This page reloads when it’s back."), glyph: <RefreshCw size={16} className="spin" /> });
    setRestarting(true);
    // Wait for a server that started after the restart, then load its new page.
    const deadline = at + 3 * 60 * 1000;
    const poll = async () => {
      const data = await fetch("/api/health", { cache: "no-store" }).then((response) => response.json()).catch(() => null);
      if (data?.startedAt && data.startedAt >= at) { window.location.reload(); return; }
      if (Date.now() > deadline) {
        setRestarting(false);
        try { localStorage.removeItem(restartedKey); } catch { /* nothing to clear */ }
        showToast(t("HEISS UI didn’t come back"), "error", { id: restartToastId, description: t("Start it again with its launcher, then reload."), duration: Infinity, action: { label: t("Reload"), onClick: () => window.location.reload() } });
        return;
      }
      window.setTimeout(poll, 1000);
    };
    window.setTimeout(poll, 1500);
    return true;
  }
  const restartForUpdate = () => restartHeiss({ update: true });

  /** The preset closest to a width-to-height ratio, compared on a log scale so 2:1 and 1:2 are as far from 1:1. */
  function nearestShape(presets: AspectPreset[], ratio: number) {
    if (!presets.length || !Number.isFinite(ratio) || ratio <= 0) return undefined;
    return presets.reduce((best, item) => (Math.abs(Math.log(item.w / item.h / ratio)) < Math.abs(Math.log(best.w / best.h / ratio)) ? item : best));
  }

  function applyProfile(profile: Profile, setModelId = true) {
    const nextReferenceInput = imageInputsForProfile(profile)[0];
    if (setModelId) setModel(profile.id);
    // A custom size is yours, so it stays across models of the same kind, fitted to the new one's limits.
    const keepCustom = customSize && profile.kind === mode;
    if (!keepCustom) setCustomSize(false);
    // A shape you picked (16:9, 3:4 …) stays too: the new model's own size for it, or its nearest
    // shape. Default stays the new model's default, which may be another shape.
    const keptShape = !keepCustom && setModelId && profile.kind === mode && model && aspectValue !== defaultAspectSize
      ? nearestShape(profile.aspectPresets || [], width / height)
      : undefined;
    setTextEncoder(String(profile.defaults.textEncoder || ""));
    setTextEncoders((profile.encoderSlots || []).map((slot) => slot.default));
    setVae(String(profile.defaults.vae || ""));
    setClipType(String(profile.defaults.clipType || ""));
    setWeightDtype(String(profile.defaults.weightDtype || "default"));
    if (keepCustom) {
      const fitted = { width: snapSide(width, customSideLimits(profile.constraints?.width)), height: snapSide(height, customSideLimits(profile.constraints?.height)) };
      setWidth(fitted.width);
      setHeight(fitted.height);
      if (fitted.width !== width || fitted.height !== height) {
        showToast(t("Custom size fitted to {0}: {1} × {2}", { "0": (profile.displayName || profile.label || "this model"), "1": (fitted.width), "2": (fitted.height) }), "default", { description: t("{0} × {1} is past what it takes.", { "0": (width), "1": (height) }) });
      }
    } else if (keptShape) {
      setWidth(keptShape.w);
      setHeight(keptShape.h);
    } else {
      setWidth(Number(profile.defaults.width || 1024));
      setHeight(Number(profile.defaults.height || 1024));
    }
    setSteps(Number(profile.defaults.steps || profile.constraints?.steps?.default || (profile.kind === "video" ? prefs.defaultVideoSteps : prefs.defaultImageSteps)));
    setCfg(Number(profile.defaults.cfg || profile.constraints?.cfg?.default || 1));
    setSampler(String(profile.defaults.sampler || "euler_ancestral"));
    setScheduler(String(profile.defaults.scheduler || "beta"));
    setDenoise(Number(profile.defaults.denoise || profile.constraints?.denoise?.default || 0.65));
    setInpaintStrength(Number(profile.defaults.inpaintStrength || 1));
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

  /* The size menu (components.tsx AspectPicker). Default and 2K start from a
     preset; Custom is any width and height. Moving between them keeps what's
     on screen as close as it can: into Custom at the size you were seeing,
     out of it to the preset nearest its shape. */
  function chooseSizeTier(tier: "none" | "2k" | "custom") {
    if (tier === "custom") {
      if (customSize) return;
      const shown = sizePlan(sizeTier, width, height, currentProfile?.native, sizeMax, sizeArea, customLimits.width.step).final;
      // Fitted as a whole, not side by side, so a side at Custom's limit doesn't reshape it.
      const fitted = fitRatio(shown.width / shown.height, shown.width * shown.height, customLimits.width, customLimits.height, 16);
      setWidth(fitted.width);
      setHeight(fitted.height);
      setCustomSize(true);
      return;
    }
    if (customSize) {
      const defaults = currentProfile?.defaults || {};
      const defaultPreset = { label: t("Default"), value: "default", w: Number(defaults.width || 1024), h: Number(defaults.height || 1024) };
      const preset = closestPreset([defaultPreset, ...aspectOptions], { width, height });
      if (preset) { setWidth(preset.w); setHeight(preset.h); }
      setCustomSize(false);
    }
    // With Megapixels in 2K's place there's no 2K to choose: leave the saved pick for when it's back.
    if (!megapixelMode) chooseAutoUpscale(tier);
  }
  /** A ratio row while in Custom: that shape at about the same area. */
  function applyCustomRatio(ratio: number) {
    const size = fitRatio(ratio, width * height, customLimits.width, customLimits.height, 16);
    setWidth(size.width);
    setHeight(size.height);
  }
  /* Saved custom sizes (the size menu's "Save size"): the studio's, on the
     server (/api/sizes), so every device and every model has the same list.
     Named Custom, Custom 2, … in turn; picking one puts it in Custom, fitted
     to this model's limits; removing one can be undone from its toast.
     Changes show at once and are sent behind; another device's arrive when
     this page comes back into view. */
  const [savedSizes, setSavedSizesState] = useState<SavedSize[]>([]);
  const savedSizesRef = useRef<SavedSize[]>([]);
  // The ids last had from the server: sent with each save, so one another device added since is kept, not overwritten.
  const serverSizeIdsRef = useRef<string[]>([]);
  function updateSavedSizes(change: (current: SavedSize[]) => SavedSize[]) {
    const next = change(savedSizesRef.current);
    savedSizesRef.current = next;
    setSavedSizesState(next);
    apiJson<{ sizes: SavedSize[] }>("/api/sizes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ sizes: next, base: serverSizeIdsRef.current }) })
      .then((data) => {
        if (!Array.isArray(data.sizes)) return;
        serverSizeIdsRef.current = data.sizes.map((item) => item.id);
        // Another device's sizes come in with the answer, unless this page changed again meanwhile.
        if (savedSizesRef.current === next) { savedSizesRef.current = data.sizes; setSavedSizesState(data.sizes); }
      })
      .catch(() => showToast(t("Couldn’t save your sizes"), "error", { description: t("They’re kept on this page until it reloads.") }));
  }
  useEffect(() => {
    let alive = true;
    const load = () => apiJson<{ sizes: SavedSize[] }>("/api/sizes").then((data) => {
      if (!alive) return;
      const sizes = Array.isArray(data.sizes) ? data.sizes : [];
      serverSizeIdsRef.current = sizes.map((item) => item.id);
      // Sizes saved in this browser before they lived on the server move over, once.
      const local = loadPrefs().savedSizes || [];
      if (local.length) {
        const known = new Set(sizes.map((item) => item.id));
        savedSizesRef.current = sizes;
        updateSavedSizes((current) => [...current, ...local.filter((item) => !known.has(item.id))]);
        setPrefsState((current) => {
          const { savedSizes: _moved, ...rest } = current;
          try { localStorage.setItem("heiss-ui-prefs", JSON.stringify(rest)); } catch { /* moved either way */ }
          return rest;
        });
        return;
      }
      savedSizesRef.current = sizes;
      setSavedSizesState(sizes);
    }).catch(() => null);
    load();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; document.removeEventListener("visibilitychange", onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function saveCustomSize() {
    if (savedSizesRef.current.some((item) => item.width === width && item.height === height)) return;
    updateSavedSizes((current) => {
      const names = new Set(current.map((item) => item.name));
      let name = "Custom";
      for (let n = 2; names.has(name); n += 1) name = `Custom ${n}`;
      return [...current, { id: clientJobUuid(), name, width, height }];
    });
  }
  function renameSavedSize(id: string, name: string) {
    const next = name.trim().slice(0, 32);
    if (!next) return;
    updateSavedSizes((current) => current.map((item) => item.id === id ? { ...item, name: next } : item));
  }
  function removeSavedSize(id: string) {
    const index = savedSizesRef.current.findIndex((item) => item.id === id);
    if (index < 0) return;
    const removed = savedSizesRef.current[index];
    updateSavedSizes((current) => current.filter((item) => item.id !== id));
    showToast(t("Removed “{0}”", { "0": (removed.name) }), "removed", {
      action: { label: t("Undo"), onClick: () => updateSavedSizes((current) => {
        if (current.some((item) => item.id === removed.id)) return current;
        const restored = [...current];
        restored.splice(Math.min(index, restored.length), 0, removed);
        return restored;
      }) }
    });
  }
  function pickSavedSize(saved: SavedSize) {
    const snapped = { width: snapSide(saved.width, customLimits.width), height: snapSide(saved.height, customLimits.height) };
    // Past this model's limits: its shape at the largest size that fits, not each side cut on its own (a 2:1 turned 4:3).
    const fitted = sameRatio(snapped, saved) ? snapped : fitRatio(saved.width / saved.height, saved.width * saved.height, customLimits.width, customLimits.height, 16);
    setCustomDimensions(fitted);
    if (fitted.width !== saved.width || fitted.height !== saved.height) {
      showToast(t("“{0}” fitted to this model: {1} × {2}", { "0": (saved.name), "1": (fitted.width), "2": (fitted.height) }), "default", { description: t("It’s saved as {0} × {1}, past what {2} takes.", { "0": (saved.width), "1": (saved.height), "2": (currentProfile?.displayName || currentProfile?.label || "this model") }) });
    }
  }
  function setCustomDimensions(next: { width: number; height: number }) {
    setWidth(next.width);
    setHeight(next.height);
    setCustomSize(true);
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
  /* A text encoder saved with the draft can stop fitting its slot (a rescan, a sharper
     file check): fall back to the slot's default instead of sending a pick the server rejects. */
  useEffect(() => {
    const slots = currentProfile?.encoderSlots || [];
    if (!slots.length) return;
    const fitting = slots.map((slot, index) => slot.options.includes(textEncoders[index]) ? textEncoders[index] : slot.default);
    if (fitting.some((name, index) => name !== textEncoders[index])) setTextEncoders(fitting);
    if (textEncoder && !slots[0].options.includes(textEncoder)) setTextEncoder(slots[0].default);
  }, [currentProfile, textEncoders, textEncoder]);
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
  // One picture per slot, in slot order, whatever the saved list says (referenceSlots.js).
  const arrangedReferenceAssets = arrangeReferences(referenceAssets, referenceInputs);
  const storedReferenceAsset = referenceInput ? arrangedReferenceAssets.find((item) => item.slot === referenceInput.id)?.asset || null : null;
  const referenceAsset: ReferenceAsset | null = storedReferenceAsset || (referenceInput && startImageId ? {
    id: startImageId,
    source: startImageId.startsWith("vault:") ? "vault" : "upload",
    ...(startImageId.startsWith("vault:") ? { privacyDomain: "vault" as const } : {}),
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
  const composerReferenceAssets = referenceAsset && referenceInput && !storedReferenceAsset
    ? arrangeReferences([{ slot: referenceInput.id, asset: referenceAsset }, ...arrangedReferenceAssets], referenceInputs)
    : arrangedReferenceAssets;
  const canUseStartImage = Boolean(referenceInput);
  // A mask belongs to the image it was painted on, for a model that can inpaint.
  // Settings › Features › Inpainting can switch it off: no brush, no mask, no inpaint settings.
  const canInpaint = Boolean(prefs.inpainting !== false && currentProfile?.capabilities.inpaint && referenceInput && (referenceAsset?.url || referenceAsset?.thumbnailUrl));
  const activeInpaintMask = canInpaint && inpaintMask && inpaintMask.assetId === referenceAsset?.id ? inpaintMask : null;
  useEffect(() => {
    if (inpaintMask && !activeInpaintMask) setInpaintMask(null);
  }, [inpaintMask, activeInpaintMask]);
  const visibleReferenceInputs = referenceInputs.filter((input) => !input.follows
    || composerReferenceAssets.some((item) => item.slot === input.follows || item.slot === input.id));
  const widthMeta = currentProfile?.constraints?.width || {};
  const heightMeta = currentProfile?.constraints?.height || {};
  /* Workflows may declare that a reference image dictates the output framing
     (aspectPolicy: "reference"). When one is selected we hide the manual aspect
     and size controls and let the reference's own dimensions drive generation. */
  const framingReference = currentProfile?.aspectPolicy === "reference"
    ? composerReferenceAssets.find((item) => item.slot === referenceInput?.id)?.asset || null
    : null;
  // Only an image being edited frames the output; a painted mask always edits it, and so does
  // a model without the switch, whatever was picked on another.
  const referenceRole: ReferenceRole = referenceRoleFor(currentProfile, prefs.referenceRole, Boolean(activeInpaintMask));
  const referenceForAspect = referenceRole === "edit" ? framingReference : null;
  const aspectLocked = Boolean(referenceForAspect && referenceForAspect.width > 0 && referenceForAspect.height > 0);
  // The size picked before a reference took over, put back when it lets go (same model only).
  const sizeBeforeLock = useRef<{ model: string; width: number; height: number; customSize: boolean } | null>(null);
  useEffect(() => {
    if (!aspectLocked || !referenceForAspect) {
      const before = sizeBeforeLock.current;
      sizeBeforeLock.current = null;
      if (before && before.model === model) {
        setWidth(before.width);
        setHeight(before.height);
        setCustomSize(before.customSize);
      }
      return;
    }
    // Kept from before the first lock only: on another model the size is already the reference's.
    if (!sizeBeforeLock.current) sizeBeforeLock.current = { model, width, height, customSize: Boolean(customSize) };
    setCustomSize(false);
    const pixels = Number(currentProfile?.defaults.width || 1024) * Number(currentProfile?.defaults.height || 1024);
    const scale = prefs.autoResizeInputs === false ? 1 : Math.min(1, Math.sqrt(pixels / (referenceForAspect.width * referenceForAspect.height)));
    setWidth(snapDimension(referenceForAspect.width * scale, widthMeta));
    setHeight(snapDimension(referenceForAspect.height * scale, heightMeta));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspectLocked, referenceForAspect?.id, model, prefs.autoResizeInputs]);
  /* A reference that dictates the framing, or a painted mask, takes the size
     tabs off the composer and the run skips 2K/4K (useGenerationActions). The
     saved pick stays, so it is back once the reference is gone or only guides. */
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
  /* Megapixels (Settings › Generation) takes 2K's place, for images: Default draws every shape
     at that many pixels (the presets stay what's picked, as with 2K), and the menu's field in
     Custom rescales the size you have, keeping its shape. Unset, each model keeps its own size. */
  const megapixelMode = mode === "image" && Boolean(prefs.megapixelSizing);
  // As far as the model's sides reach (4096 at most, as in Custom), and no further than 16.
  const megapixelMax = Math.max(1, Math.min(16, Math.floor((Math.min(Number(widthMeta.max) || 8192, Number(heightMeta.max) || 8192, 4096) ** 2) / MEGAPIXEL)));
  // A target from a model that went further is held to this one's reach, in the field as in the run.
  const megapixelTarget = megapixelMode && Number(prefs.megapixels) > 0 ? Math.min(Number(prefs.megapixels), megapixelMax) : null;
  const sizeArea = megapixelTarget && !customSize ? megapixelTarget * MEGAPIXEL : 0;
  const sizeTiers: SizeTier[] = mode === "image" && !megapixelMode ? ["none", "2k", "custom"] : ["none", "custom"];
  // The size menu's tab: Custom is the size as typed; Default and 2K start from a preset (2K for images only).
  const sizeTier: AutoUpscale = customSize || mode !== "image" || megapixelMode ? "none" : upscaleSize(prefs.autoUpscale);
  const sizeMax = Math.min(Number(widthMeta.max) || 8192, Number(heightMeta.max) || 8192);
  const customLimits = { width: customSideLimits(widthMeta), height: customSideLimits(heightMeta) };
  const megapixelControl: MegapixelControl | null = megapixelMode ? {
    target: megapixelTarget,
    max: megapixelMax,
    onChange: (value: number) => {
      setPrefs({ megapixels: value });
      if (!customSize) return;
      const size = fitRatio(width / height, value * MEGAPIXEL, customLimits.width, customLimits.height, 16);
      setWidth(size.width);
      setHeight(size.height);
    },
    onReset: () => setPrefs({ megapixels: null })
  } : null;
  const defaultAspectSize = `${Number(currentProfile?.defaults.width || (mode === "video" ? 512 : 1024))}x${Number(currentProfile?.defaults.height || (mode === "video" ? 288 : 1024))}`;
  const aspectPickerValue = aspectValue === defaultAspectSize ? "default" : customSize || !aspectOptions.some((item) => item.value === aspectValue) ? "free" : aspectValue;
  const galleryColumnCount = useGalleryColumnCount();
  // Upscales count too, so Stop shows (and stops them) while only an upscale is running.
  const runningCount = visibleGallery.filter((item) => item.status === "pending" || item.upscale?.status === "running").length;
  // Steps far slower than this model's usual mean a GPU out of memory, not a busy one.
  // Said once a session, and only about a run that finished while this page watched.
  const watchedRuns = useRef(new Set<string>());
  const slowHintShown = useRef(false);
  useEffect(() => {
    for (const item of gallery) if (item.status === "pending") watchedRuns.current.add(item.jobId || item.id);
    if (slowHintShown.current) return;
    const slow = gallery.find((item) => item.status === "done" && item.timing?.slow && watchedRuns.current.has(item.jobId || item.id));
    if (!slow) return;
    slowHintShown.current = true;
    showToast(t("That run was much slower than usual. ComfyUI may be short on graphics memory. Close other apps that use it, or try a smaller size."), "warning");
  }, [gallery]); // eslint-disable-line react-hooks/exhaustive-deps

  // What Generate would take with these settings, the way generate() would send them.
  const estimateCount = mode === "image" && currentProfile?.capabilities?.variations === false ? 1 : count;
  const separateRuns = mode === "image" && prefs.variationQueueMode === "separate";
  // Estimated the way generate() sends it: at the size it's drawn at.
  // Not where generate() skips the plan: a mask, or an edited reference that sets the size.
  const estimatePlan = mode === "image" && !activeInpaintMask && !referenceForAspect ? sizePlan(sizeTier, Number(width), Number(height), currentProfile?.native, sizeMax, sizeArea, customLimits.width.step) : null;
  const estimateSize = estimatePlan?.draw || { width, height };
  const generationEstimate = useGenerationEstimate({
    mode, model: currentProfile?.model || model, profileId: currentProfile?.id || model, family: currentProfile?.family || '', width: estimateSize.width, height: estimateSize.height, steps,
    count: separateRuns ? 1 : estimateCount, runs: separateRuns ? estimateCount : 1, frames: mode === "video" ? frames : 0, revision: runningCount,
    // Learned apart on the server: runs that read images, and a native size's tiled decode.
    refs: composerReferenceAssets.length, tiled: tiledDecodeFor(estimatePlan)
  });
  // Every Restart ComfyUI button asks first when it would stop running work.
  useEffect(() => {
    registerRestartConfirm(() => runningCount
      ? confirmAction({ title: t("Restart ComfyUI?"), description: t("{0} running generation{1} will stop.", { "0": (runningCount), "1": (runningCount === 1 ? t("") : t("s")) }), action: t("Restart"), destructive: true })
      : Promise.resolve(true));
    return () => registerRestartConfirm(null);
  }, [runningCount, confirmAction]);
  // Models on this computer that ComfyUI does not read, and the one-step fix for them.
  const modelFolders = useModelFolders({
    connected: comfyStatus.connected,
    emptyModels: Boolean(models && comfyStatus.connected && !models.profiles.some((profile) => profile.ready !== false)),
    onModelsChanged: () => { refreshModels(false); refreshWorkflows(); },
    showToast,
    hints: prefs.modelFolderHints !== false,
    onStopHints: () => setPrefs({ modelFolderHints: false })
  });
  const doneGallery = useMemo(() => visibleGallery.filter((item) => item.status === "done" || item.status === "error"), [visibleGallery]);
  const zenItem = zenGallery.find((item) => item.id === zenSelectedId) || zenGallery[0] || null;
  const zenDisplayItem = zenItem;
  const missingReferenceInput = referenceInputs.find((input) => (input.required || (input.min || 0) > 0) && !composerReferenceAssets.some((item) => item.slot === input.id));
  const missingRequiredReference = Boolean(missingReferenceInput);
  // Built-in families say exactly what they lack; custom workflows fall back to their encoder/VAE fields.
  const modelMissingParts = currentProfile?.missing || [];
  const modelSetupMissing = Boolean(currentProfile && (currentProfile.ready === false
    || (!currentProfile.encoderSlots && ((currentProfile.capabilities.textEncoder && !textEncoder) || (currentProfile.capabilities.vae && !vae)))));
  const generateDisabled = !currentProfile || modelSetupMissing || missingRequiredReference;
  const generateDisabledReason = missingRequiredReference ? t('{0} is required', { 0: t(missingReferenceInput?.label || "Reference image") })
    : modelMissingParts.length ? t('Needs {0}', { 0: modelMissingParts.map((item) => item.label).join(", ") })
    : modelSetupMissing ? t("This model needs files first")
    : !currentProfile ? (models ? t("Choose a model") : t("Loading models…")) : undefined;
  const loraActiveCount = currentProfile?.capabilities.lora ? loras.filter((item) => item.enabled && item.name).length : 0;
  // Active LoRAs whose files clearly say another model family (lora-info.js): a quiet note above the prompt bar.
  const loraOptionNames = useMemo(() => ((currentProfile?.options?.loras || models?.loras || []) as unknown[]).map((option) => typeof option === "string" ? option : String((option as { name?: string })?.name || "")).filter(Boolean), [currentProfile, models]);
  const loraInfos = useLoraInfo(loraActiveCount ? loraOptionNames : []);
  const [dismissedLoraWarnings, setDismissedLoraWarnings] = useState<string[]>([]);
  const loraMismatch = useMemo<LoraMismatch | null>(() => {
    if (!loraActiveCount || !currentProfile) return null;
    const wrong = loras.filter((item) => item.enabled && item.name && loraFit(loraInfos[item.name], currentProfile) === "other").map((item) => item.name);
    if (!wrong.length) return null;
    const key = `${currentProfile.id}|${[...wrong].sort().join("|")}`;
    if (dismissedLoraWarnings.includes(key)) return null;
    return { key, names: wrong, madeFor: [...new Set(wrong.map((name) => loraInfos[name]?.base).filter(Boolean))] as string[], model: currentProfile.familyName || currentProfile.displayName || currentProfile.label };
  }, [loraActiveCount, currentProfile, loras, loraInfos, dismissedLoraWarnings]);
  const dismissLoraMismatch = useCallback((key: string) => setDismissedLoraWarnings((current) => [...current, key]), []);

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
    const next = models?.profiles.find((item) => item.id === profileId);
    if (next && profileId !== model) {
      // A switch loads the workflow's own defaults, which the composer shows; only
      // a reference image it had to drop is news.
      if (referenceAssets.length > 0 && !imageInputsForProfile(next).length) showToast(t("Reference image removed. {0} doesn’t use one.", { "0": (next.displayName || next.label || "This model") }), "warning");
    }
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
    }).catch(() => showToast(t("Couldn’t save the favorite"), "error"));
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
    setReferenceAssets((current) => withReference(current, referenceInputs, slot, asset));
    setStartImage("");
    if (slot === referenceInput?.id) {
      setStartImageId(asset.id);
      setStartImageName(asset.name);
    }
  }

  /** Takes the pictures in `slots` off, from what the composer shows, and closes up the rest. */
  function removeReferenceAsset(slots: string | string[]) {
    const next = withoutReferences(composerReferenceAssets, referenceInputs, Array.isArray(slots) ? slots : [slots]);
    const first = next.find((item) => item.slot === referenceInput?.id)?.asset;
    setReferenceAssets(next);
    setStartImage("");
    setStartImageId(first?.id || "");
    setStartImageName(first?.name || "");
  }

  async function useOutputAsStartImage(item: GalleryItem) {
    if (!canUseStartImage || item.status !== "done" || item.type !== "image" || !item.url || item.vaultLocked) {
      showToast(t("This model can’t use this image as a reference"), "error");
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
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn’t use this image", "error");
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
      showToast(t("Workflow imported"), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn’t import the workflow", "error");
    }
  }



  const generationActions = useGenerationActions({
    active, canUseStartImage, confirmAction, count, currentProfile, denoise, frames, fps, generateDisabled, generatePostingRef, height, loadGallery, loadGalleryDelta, loras, missingRequiredReference, mode, model, negative, prefs, hiddenSpace, hidden, prompt, referenceAssets: composerReferenceAssets, inpaint: activeInpaintMask ? { mask: activeInpaintMask.dataUrl, strength: inpaintStrength, feather: inpaintFeather } : null, sizeTier, sizeMax, sizeArea, sizeStep: customLimits.width.step, sampler, scheduler, seed, setActive, setGallery, upsertGalleryItems, removeGalleryItems, removeGalleryItemsWhere, patchGalleryItems, setStatus, setZenSelectedId, showToast, startImage, startImageId, startImageName, steps, cfg, textEncoder, textEncoders, vae, clipType, weightDtype, width, visibleGallery, outputDir: paths.outputDir, generateDisabledReason, comfyOffline: Boolean(comfyStatus.checked && !comfyStatus.connected && !comfyStatus.checking), comfyRestarting: Boolean(comfyStatus.restarting),
    openModelSetup: () => setWorkflowGalleryOpen(true),
    retryComfyStatus,
    refreshModels
  });
  const { generate, cancelJob, cancelQueue, clearGallery, clearFailedItems, resetAllSettings, clearAllCache, openOutputFolder, deleteItem, deleteItems } = generationActions;

  const viewerActions = useViewerControls({
    draft: { prompt, negative, seed, mode, model, width, height, steps, cfg, count, loras }, active, deleteItem, doneGallery: zenGallery, generate, generateDisabled, height, lastTapRef, lastTouchRef, mode, models, prefs, setActive, setCfg, setClipType, setCount, setCustomSize, setDenoise, setFps, setFrames, setHeight, setIsDraggingViewer, setLoras: setLorasWithMemory, setMode, setModel, setNegative, setPrompt, setSampler, setScheduler, setSeed, setShowDetails, setStartImage, setStartImageId, setStartImageName, setSteps, setTextEncoder, setTextEncoders, setVae, setViewerPan, setViewerZoom, setWeightDtype, setWidth, setZenSelectedId, showToast, touchGestureRef, viewerDragEndRef, viewerDragRef, viewerPan, viewerZoom, visibleGallery, width, zenItem, zenStripDragRef, zenStripRef, viewerGallery
  });
  const { resetViewer, openItem, applyAllSettings, applyLoras, moveZen, moveViewer, goLatestZen, submitZenPrompt, startZenStripDrag, dragZenStrip, stopZenStripDrag, selectZenItem, zoomViewer, wheelViewer, clickViewer, startViewerDrag, dragViewer, stopViewerDrag, startViewerTouch, moveViewerTouch, endViewerTouch } = viewerActions;

  // A prompt to start from, or a surprise: into the box, ready to send.
  function fillPrompt(text: string) {
    setPrompt(clampText(text, promptLimit));
    window.setTimeout(() => zenPromptRef.current?.focus(), 0);
  }
  const starterPrompts = useMemo(() => starterPromptsFor(currentProfile?.family || "", mode), [currentProfile?.family, mode]);

  // A starter model on its way: selected, with a prompt to try, once ComfyUI lists it ready.
  const starterKey = "heiss-ui:starter-pick";
  const [starterPick, setStarterPick] = useState<StarterPick | null>(() => {
    try { return JSON.parse(localStorage.getItem(starterKey) || "null"); } catch { return null; }
  });
  function rememberStarter(pick: StarterPick | null) {
    setStarterPick(pick);
    try { if (pick) localStorage.setItem(starterKey, JSON.stringify(pick)); else localStorage.removeItem(starterKey); } catch { /* it just won't survive a reload */ }
  }
  const profileForFile = (file: string) => models?.profiles.find((profile) => profile.model === file || profile.model.split(/[\\/]/).pop() === file);
  function selectStarterModel(file: string) {
    const profile = profileForFile(file);
    if (!profile) { rememberStarter({ family: "", file, title: file }); refreshModels(false); return; }
    if (profile.kind !== mode) setMode(profile.kind);
    pickModel(profile.id);
  }
  useEffect(() => {
    if (!starterPick || !models) return;
    const profile = profileForFile(starterPick.file);
    if (!profile || profile.ready === false) return;
    rememberStarter(null);
    if (profile.kind !== mode) setMode(profile.kind);
    pickModel(profile.id);
    const first = !prompt.trim();
    if (first) setPrompt(starterPromptsFor(profile.family, profile.kind)[0]);
    showToast(t("{0} is ready.{1}", { "0": (starterPick.title || profile.displayName || "The model"), "1": (first ? ` Press ${generateShortcut(prefs.enterToGenerate)} to try the example prompt.` : t("")) }), "success");
    window.setTimeout(() => zenPromptRef.current?.focus(), 0);
  }, [models, starterPick]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Back to recommended": the sampling values the model's makers ship, once anything moved from them.
  const recommendedValues = currentProfile ? {
    steps: Number(currentProfile.defaults.steps || currentProfile.constraints?.steps?.default || (currentProfile.kind === "video" ? prefs.defaultVideoSteps : prefs.defaultImageSteps)),
    cfg: Number(currentProfile.defaults.cfg || currentProfile.constraints?.cfg?.default || 1),
    sampler: String(currentProfile.defaults.sampler || ""),
    scheduler: String(currentProfile.defaults.scheduler || ""),
    denoise: Number(currentProfile.defaults.denoise || currentProfile.constraints?.denoise?.default || 0.65)
  } : null;
  const recommended = {
    family: currentProfile?.familyName || "",
    differs: Boolean(recommendedValues && (steps !== recommendedValues.steps || cfg !== recommendedValues.cfg
      || (recommendedValues.sampler && sampler !== recommendedValues.sampler) || (recommendedValues.scheduler && scheduler !== recommendedValues.scheduler)
      || (currentProfile?.capabilities.denoise && denoise !== recommendedValues.denoise))),
    restore: () => {
      if (!recommendedValues) return;
      setSteps(recommendedValues.steps);
      setCfg(recommendedValues.cfg);
      if (recommendedValues.sampler) setSampler(recommendedValues.sampler);
      if (recommendedValues.scheduler) setScheduler(recommendedValues.scheduler);
      setDenoise(recommendedValues.denoise);
    }
  };

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
    updateStack: (id: string) => { updateLoraStack(loraFamily, id, loras); bumpLoraLibrary(); showToast(t("Stack updated"), 'success'); },
    renameStack: (id: string, name: string) => { renameLoraStack(loraFamily, id, name); bumpLoraLibrary(); },
    deleteStack: async (stack: LoraSnapshot) => {
      if (!await confirmAction({ title: t("Delete {0}?", { "0": (stack.name) }), description: t("The LoRAs stay installed and in use."), action: t("Delete"), destructive: true })) return false;
      deleteLoraStack(loraFamily, stack.id);
      bumpLoraLibrary();
      return true;
    },
    toggleFavorite: (name: string) => { toggleLoraFavorite(name); bumpLoraLibrary(); },
    recordRecents: (names: string[]) => { recordLoraRecents(names); bumpLoraLibrary(); }
  };
  // The first reference, shown at the top of the sidebar's Basics with how much it may change.
  const sidebarReference = referenceInput && referenceAsset ? { asset: referenceAsset, label: referenceInput.role === "start" ? "Start image" : referenceInput.label || "Reference image", remove: () => removeReferenceAsset(referenceInput.id) } : null;
  const sidebarView = { sidebarReference, inpaintActive: Boolean(activeInpaintMask), inpaintStrength, setInpaintStrength, inpaintFeather, setInpaintFeather, canUseStartImage, cfg, cfgMeta, changeMode, clipType, confirmAction, count, countMeta, currentProfile, currentWorkflow, customSize, aspectLocked, denoise, denoiseMeta, fps, fpsMeta, frameMeta, frames, height, heightMeta, loras, loraActiveCount, mode, models, profileOptions, readStartImage, sampler, scheduler, seed, setCfg, setCount, setDenoise, setFps, setFrames, setHeight, setLoras: setLorasWithMemory, setSampler, setScheduler, setSeed, setStartImage, setStartImageId, setStartImageName, setSteps, setTextEncoder, setTextEncoders, setVae, setWeightDtype, setWidth, setWorkflowGalleryOpen, startImageName, steps, stepsMeta, textEncoder, textEncoders, refreshModels, refreshWorkflows, showToast, modelFolders, vae, weightDtype, width, widthMeta, workflowPreferences, loraLibrary, rememberedLoraStrength: loraStrengthForCurrentWorkflow, sidebarTab, setSidebarTab, recommended, prefs, setPrefs };
  const sidebarControls = <StableSidebarControls view={sidebarView} />;
  // The same settings as the sidebar, laid out for the phone's Advanced sheet.
  const phoneAdvancedControls = <StablePhoneAdvancedControls view={sidebarView} />;

  const baseView = { viewerGallery, gallerySearch, setGallerySearch, toggleFavorite, seed, setSeed, galleryGroups, settleVersion, stackRuns, openRuns, setRunOpen, unstackRun, active, applyAllSettings, applyLoras, applyAspect, aspectOptions, aspectPickerValue, aspectValue, aspectLocked, sizeTier, sizeTiers, sizeArea, megapixelControl, sizeMax, customLimits, chooseSizeTier, applyCustomRatio, setCustomDimensions, savedSizes, saveCustomSize, renameSavedSize, removeSavedSize, pickSavedSize, defaultAspectSize, canUseStartImage, cancelJob, cancelQueue, checkForUpdates, restartForUpdate, restartHeiss, restarting, justUpdated, clearJustUpdated: () => setJustUpdated(""), setUpdatePrefs, refreshUpdateStatus, confirmAction, clearAllCache, clearFailedItems, clearGallery, clickViewer, comfyStatus, copyToClipboard, copyItemToClipboard, count, countMeta, currentProfile, customSize, deleteItem, deleteItems, doneGallery, zenGallery, gallery, galleryColumnCount, galleryLoaded, galleryCrossing, galleryRevision, galleryStageRef, galleryTotalApprox, generate, generateDisabled, generateDisabledReason, goLatestZen, hasMoreGallery, health, height, heightMeta, importWorkflowFile, installUpdate, isDraggingViewer, isMobile, loadMoreGalleryItems, loraActiveCount, mode, model, modelProfiles, models, moveViewer, moveViewerTouch, moveZen, negative, negativeLimit, now, onGalleryScroll, openItem, openOutputFolder, paths, prefs, hidden, hiddenSpace, hideItems, unhideItems, profileBadges, prompt, promptLimit, referenceAsset, referenceInput, refreshComfyStatus, retryComfyStatus, comfyRetrying, comfyReconnectedAt, refreshHealth, refreshModels, refreshWorkflows, removeReferenceAsset, renderedGallery, resetAllSettings, resetViewer, runningCount, saveOutputDirectory, selectReferenceAsset, selectWorkflow, setActive, setCount, setHeight, setNegative, setPrompt, setSettings, setShowDetails, setShowGenerationSettings, setShowNegativePrompt, setSteps, setWidth, setWorkflowGalleryOpen, setWorkflowPreferences, setWorkflows, setZenControls, setZenGalleryOpen, setZenMode, showDetails, showGenerationSettings, showNegativePrompt, showToast, sidebarControls, phoneAdvancedControls, startViewerDrag, startViewerTouch, status, steps, stepsMeta, stopViewerDrag, submitZenPrompt, touchGestureRef, updateBusy, updateStatus, useOutputAsStartImage, viewerDragEndRef, viewerDragRef, viewerPan, viewerZoom, wheelViewer, width, widthMeta, workflowGalleryOpen, workflowPreferences, workflows, zenControls, zenDisplayItem, zenGalleryOpen, zenItem, zenPromptRef, zenSelectedId, zenStripDragRef, zenStripRef, dragViewer, dragZenStrip, endViewerTouch, selectZenItem, startZenStripDrag, stopZenStripDrag, characterMeta, formatElapsed, generationDetailEntries, titleFromPrompt , zoomViewer, clampText, promptRemaining, chooseModel, pickModel, modelMenu, visibleGallery, settings, setPrefs, upscaleStatus, upscaleUnavailableReason, upscaleSetup, upscaleInstall, upscaleBusyIds, upscaleNotices, dismissUpscaleNotice, toggleUpscale, cancelUpscale, refreshUpscaleStatus, cancelUpscaleInstall, activateUpscale, chooseAutoUpscale, upscaleDisplayUrl, modelFolders, generationEstimate, openLoras: () => { setSidebarTab('loras'); setZenControls(true); }, fillPrompt, surprise: () => fillPrompt(surprisePrompt(prompt, mode)), starterPrompts, onStarterStarted: rememberStarter, selectStarterModel, generateKey: generateShortcut(prefs.enterToGenerate), failureFixes: generationActions.failureFixes };

  // Painting on the first reference, for a model that can inpaint (InpaintStudio.tsx).
  const referenceInpaint: ReferenceInpaint | null = canInpaint && referenceInput && referenceAsset ? {
    slot: referenceInput.id,
    mask: activeInpaintMask?.dataUrl || null,
    onChange: (dataUrl: string | null) => setInpaintMask(dataUrl ? { assetId: referenceAsset.id, dataUrl } : null)
  } : null;
  // The switch shows on the framing reference, once one is there. A painted mask settles it as an
  // edit: it stays, locked on Edit, so the chips say so (EDIT, the others greyed, no +).
  const referenceRoleControl: ReferenceRoleControl | null = referenceRoleOffered(currentProfile) && referenceInput && framingReference ? {
    slot: referenceInput.id,
    value: referenceRole,
    locked: Boolean(activeInpaintMask),
    onChange: (value: ReferenceRole) => { if (!activeInpaintMask) setPrefs({ referenceRole: value }); }
  } : null;
  const view = { ...baseView, loraMismatch, dismissLoraMismatch, referenceAssets: composerReferenceAssets, referenceInputs: visibleReferenceInputs, referenceInpaint, referenceRole: referenceRoleControl };
  return (
    <>
      <StudioView view={view} />
      {confirmationDialog}
    </>
  );
}

// Other devices sign in before the studio loads (DeviceGate.tsx).
// A render error anywhere shows the crash screen (with Reload and Report) instead of a blank page.
// One tooltip provider for the whole app holds the shared hover delay and lets neighbours open at once.
createRoot(document.getElementById("root")!).render(<TooltipProvider><CrashBoundary><DeviceGate><App /></DeviceGate></CrashBoundary></TooltipProvider>);

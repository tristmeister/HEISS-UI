export type Mode = "image" | "video";
export type Progress = { value: number; max: number; node?: string };
export type Output = { url: string; filename: string; type: "image" | "video"; prompt?: string; negative?: string; outputName?: string };
export type LoraSelection = { name: string; enabled: boolean; strength: number };
export type MediaInput = {
  id: string;
  kind: "image";
  required?: boolean;
  min?: number;
  max?: number;
  label?: string;
  control?: { node: string; input: string };
  /** "start": image-to-image, the model redraws this picture. "reference": a model that reads it as guidance. */
  role?: "reference" | "start";
};
export type ReferenceAsset = {
  id: string;
  source: "upload" | "generation" | "vault";
  name: string;
  mime: string;
  width: number;
  height: number;
  size: number;
  createdAt: string;
  thumbnailUrl: string;
  url?: string;
  privacyDomain?: "gallery" | "vault";
  galleryItemId?: string;
};
export type SelectedReferenceAsset = { slot: string; asset: ReferenceAsset };
export type PromptComposition = { prefix?: string; suffix?: string; policy?: string; version?: number };
export type GenerationSettings = Record<string, string | number | boolean | null | undefined | LoraSelection[]>;
export type UpscaleQuality = "fast" | "balanced" | "high";
export type UpscaleState = {
  status: "running" | "done" | "error" | "canceled";
  jobId?: string;
  quality?: UpscaleQuality;
  faceDetail?: boolean;
  progress?: Progress | null;
  url?: string;
  thumbnailUrl?: string;
  outputName?: string;
  width?: number;
  height?: number;
  scale?: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};
/** Why a run failed: a headline, a plain hint, and the raw detail for bug reports. */
export type GenerationFailure = { title: string; summary: string; hint?: string; nodeType?: string; nodeId?: string; exceptionType?: string; detail?: string; traceback?: string; at?: number };
export type GalleryItem = Output & { failure?: GenerationFailure; id: string; jobId?: string; status: "done" | "pending" | "error" | "canceled"; progress?: Progress; preview?: string; width?: number; height?: number; createdAt?: string; durationMs?: number; model?: string; settings?: GenerationSettings; index?: number; referenceImage?: string; referenceImageName?: string; startImageId?: string; optimistic?: boolean; promptProtected?: boolean; privateVault?: boolean; vaultLocked?: boolean; thumbnailUrl?: string; upscale?: UpscaleState; upscaleActive?: boolean; bundle?: GalleryBundle };
export type GalleryBundle = {
  id: string;
  domain: "gallery" | "vault";
  reason: "prompt" | "batch";
  reasonLabel: string;
  count: number;
  startedAt: string;
  endedAt: string;
  coverId: string;
  items: GalleryItem[];
};
export type BundlePending = { runs: number; items: number; itemIds?: string[] };
export type BundleStatus = { bundles: unknown[]; pending: BundlePending; mode: string; cooldownMinutes: number };
export type Job = { status: string; outputs: GalleryItem[]; error?: string; progress?: Progress; preview?: string; previews?: string[] };
export type TouchGesture = { mode: "pan"; id: number; x: number; y: number; panX: number; panY: number; moved: boolean } | { mode: "pinch"; distance: number; zoom: number; panX: number; panY: number; centerX: number; centerY: number; moved: boolean };
export type SelectOption = { label: string; value: string };
export type Profile = {
  id: string;
  kind: Mode;
  label: string;
  displayName?: string;
  description?: string;
  model: string;
  workflow: string;
  family: string;
  defaults: Record<string, string | number>;
  aspectPresets: AspectPreset[];
  constraints?: Record<string, { min?: number; max?: number; step?: number; default?: number }>;
  options?: {
    textEncoders?: string[];
    vaes?: string[];
    clipTypes?: string[];
    weightDtypes?: string[];
    samplers?: string[];
    schedulers?: string[];
    loras?: string[];
  };
  capabilities: Record<string, boolean>;
  mediaInputs?: MediaInput[];
  aspectPolicy?: "manual" | "reference";
  /** LoRAs the workflow's loader accepts; rgthree stacks take 4. */
  maxLoras?: number;
  /** Built-in families: where the file sits, which variant it is, and what fills its parts. */
  source?: ModelSource | "sana";
  variant?: string;
  variantLabel?: string;
  encoderSlots?: EncoderSlot[];
  encoderBuiltIn?: boolean;
  vaeBuiltIn?: boolean;
  detectedBy?: string;
  missing?: MissingPart[];
  /** False while a part the model needs is missing; generation stays off until then. */
  ready?: boolean;
};
export type EncoderSlot = { slot: string; label: string; options: string[]; default: string };
export type PartDownload = { id: string; file: string; url: string; folder: string; label: string; bytes?: number };
/** A ComfyUI custom node pack (server/node-packs.js). */
export type NodePackInfo = { id?: string; name: string; repository: string; folder?: string; search?: string; note?: string };
/** Which one-click routes HEISS has for a pack: Manager (the pack is in its list) and/or a local clone + pip. */
export type PackAutoInstall = { manager: boolean; local: boolean };
export type PackInstallState = { id: string; name: string; route: "manager" | "local"; status: "running" | "done" | "error"; step: string; log: string; error: string; startedAt: number; finishedAt: number };
/** One command per shell: Terminal on macOS and Linux; PowerShell and Command Prompt on Windows. */
export type ShellPlan = { commands: Array<{ shell: "sh" | "powershell" | "cmd"; label: string; command: string }> };
export type NodeInstallPlan = ShellPlan & { exact: boolean; customNodesDir: string; python: string; cloned: boolean; needsGit: boolean };
/**
 * Something a model still needs. A missing node pack carries `nodePack` and its
 * terminal `install`; a part fetched outside HEISS carries a `command`.
 */
export type MissingPart = {
  part: "encoder" | "vae" | "model" | "comfy"; slot?: string; label: string; kind?: string; detail?: string; downloads: PartDownload[];
  nodePack?: NodePackInfo; install?: NodeInstallPlan; autoInstall?: PackAutoInstall; missingNodes?: string[];
  command?: ShellPlan & { target?: string };
};
export type ModelDownload = { id: string; file: string; folder?: string; label: string; status: "queued" | "downloading" | "done" | "error" | "canceled" | "paused"; receivedBytes: number; totalBytes: number; bytesPerSecond?: number; already?: boolean; error?: string; finishedAt?: number };
export type DownloadState = { active: ModelDownload | null; queued: ModelDownload[]; recent: ModelDownload[]; paused?: ModelDownload[] };
export type ModelSource = "unet" | "checkpoint";
/** A model file and what HEISS took it for: via says how (your choice, its weights, metadata, filename). */
export type ModelFile = { name: string; source: ModelSource; family: string; choice: string; via: "choice" | "file" | "metadata" | "name" | "default" | ""; label: string; supported: boolean; reason?: string; missing?: string[] };
export type Models = {
  imageModels: SelectOption[];
  videoModels: SelectOption[];
  profiles: Profile[];
  unsupportedModels?: string[];
  modelFiles?: ModelFile[];
  modelTypeChoices?: Record<ModelSource, SelectOption[]>;
  textEncoders: string[];
  vaes: string[];
  clipTypes?: string[];
  weightDtypes?: string[];
  samplers: string[];
  schedulers: string[];
  loras?: string[];
  defaults: Record<string, string>;
  capabilities: Record<string, boolean>;
};
export type Paths = { outputDir?: string; galleryDir?: string; workflowsDir?: string };
export type OutputFolderState = "empty" | "missing" | "not-folder" | "ok" | "match" | "mismatch";
export type OutputFolderReport = { path: string; state: OutputFolderState; media?: number; capped?: boolean; checked?: number; found?: number; looksLikeComfy?: boolean; source?: "comfy" | "common" };
export type Health = { ok: boolean; comfyUrl?: string; error?: string };
export type ComfyStatus = { connected: boolean; url?: string; latencyMs?: number; version?: string; device?: string; error?: string; checking?: boolean; checked?: boolean };
export type UpdateDownload = { status: "downloading" | "verifying" | "unpacking" | "ready" | "error"; version?: string; receivedBytes?: number; totalBytes?: number; error?: string };
export type UpdateResult = { ok: boolean; rolledBack?: boolean; from?: string; to?: string; error?: string };
export type UpdateStatus = {
  ok: boolean; available?: boolean; current?: string; latest?: string; branch?: string; behind?: number; updated?: boolean; restartRequired?: boolean; message?: string; error?: string;
  /** A copy unpacked from a GitHub release rather than a Git checkout. */
  release?: boolean; url?: string; size?: number; canInstall?: boolean; supervised?: boolean; download?: UpdateDownload; result?: UpdateResult;
};
export type AspectPreset = { label: string; value: string; w: number; h: number };
export type WorkflowValidation = { ok: boolean; unverified?: boolean; issues: string[]; warnings?: string[]; missingNodes?: string[]; missingFiles?: string[]; missingPacks?: string[] };
export type WorkflowSummary = {
  id: string;
  profileId: string;
  workflow: string;
  name: string;
  description?: string;
  kind: Mode;
  family: string;
  source: "builtin" | "custom";
  deleteId?: string;
  controls?: string[];
  capabilities?: Record<string, boolean>;
  mediaInputs?: MediaInput[];
  aspectPolicy?: "manual" | "reference";
  defaults?: Record<string, string | number | boolean | null | undefined>;
  path?: string;
  favorite?: boolean;
  lastUsedAt?: string;
  thumbnail?: string;
  tags?: string[];
  validation: WorkflowValidation;
};
export type WorkflowPreferences = { favorites: string[]; lastUsed: Record<string, string>; thumbnails: Record<string, string> };
export type WorkflowImportPreview = {
  filename?: string;
  format?: string;
  hasHeissUi: boolean;
  detected: {
    id: string;
    name: string;
    description?: string;
    kind: Mode;
    family: string;
    controls: Record<string, { node: string; input: string }>;
    defaults?: Record<string, unknown>;
    capabilities?: Record<string, boolean>;
    mediaInputs?: MediaInput[];
    promptComposition?: PromptComposition | null;
    aspectRatios?: unknown[];
    aspectPolicy?: "manual" | "reference";
    nodes: Array<{ id: string; classType: string; inputs: string[]; suggestedInputs: string[] }>;
  };
  validation: WorkflowValidation;
};

export type Preferences = {
  defaultImageCount: number;
  defaultImageSteps: number;
  defaultVideoFrames: number;
  defaultVideoSteps: number;
  defaultFps: number;
  generationPreviewMode: "advanced" | "simple";
  variationQueueMode: "batch" | "separate";
  zenMode: boolean;
  confirmActions: boolean;
  enterToGenerate: boolean;
  followLatest: boolean;
  showFailedItems: boolean;
  groupRuns: boolean;
  runGroupingMode: "smart" | "job";
  runCooldownMinutes: number;
  smartUpscale: boolean;
  upscaleQuality: UpscaleQuality;
  upscaleFaceDetail: boolean;
  mobileZenDefaulted?: boolean;
};

export type UpscaleModelInfo = { key: string; file: string; label: string; detail?: string; bytes: number; present: boolean; partialBytes: number };
export type UpscaleInstallFile = {
  file: string;
  label: string;
  detail?: string;
  bytes: number;
  totalBytes: number;
  phase: "queued" | "resuming" | "downloading" | "retrying" | "verifying" | "verified";
  done: boolean;
};
export type UpscaleInstall = {
  status: "running" | "done" | "error" | "canceled";
  dir?: string;
  quality?: UpscaleQuality;
  current?: string;
  files?: UpscaleInstallFile[];
  receivedBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  error?: string;
} | null;
export type UpscaleStatus = {
  ok?: boolean;
  quality: UpscaleQuality;
  nodesInstalled: boolean;
  missingNodes: string[];
  detectedNodes?: string[];
  modelDir: string;
  remote?: boolean;
  canDownload: boolean;
  freeBytes: number | null;
  models: UpscaleModelInfo[];
  missingModels: string[];
  downloadBytes: number;
  needsDownload: boolean;
  substituting: boolean;
  fallbackFile?: string;
  ready: boolean;
  faceDetail: { nodesInstalled: boolean; missingNodes: string[]; detectors: string[]; samModels: string[] };
  install: UpscaleInstall;
  /** Only while the nodes are missing: whether Manager is on, and the terminal route otherwise. */
  nodeSetup?: NodeInstallPlan & { manager: boolean; pack?: NodePackInfo; autoInstall?: PackAutoInstall };
};
export type UpscaleDownloadPreview = {
  quality: UpscaleQuality;
  modelDir: string;
  totalBytes: number;
  remainingBytes: number;
  freeBytes: number | null;
  files: Array<{ key: string; file: string; label: string; detail?: string; bytes: number; partialBytes: number }>;
};

export type PrivacyStatus = { enabled: boolean; unlocked: boolean; cookieName?: string; vault?: { enabled: boolean; unlocked: boolean; assetCount: number } };

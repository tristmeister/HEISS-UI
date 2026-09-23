import React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Image as ImageIcon, Images, LoaderCircle, LockKeyhole, Plus, Trash2, Upload, X } from "lucide-react";
import { cn } from "./format";
import { Tip } from "./components";
import { useDismiss } from "./useDismiss";
import { deleteReferenceAsset, listReferenceAssets, referenceAssetFromGallery, uploadReferenceAsset } from "./api";
import type { MediaInput, ReferenceAsset, SelectedReferenceAsset } from "./types";

type PickerTab = "generation" | "upload";

type PageState = {
  items: ReferenceAsset[];
  cursor: string;
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
  error: string;
};

const emptyPage = (): PageState => ({ items: [], cursor: "", hasMore: false, loading: false, loaded: false, error: "" });
const spring = { type: "spring", duration: 0.38, bounce: 0.12 } as const;

function assetImage(asset: ReferenceAsset) {
  return asset.thumbnailUrl || asset.url || "";
}

function moveGridFocus(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  const grid = event.currentTarget.closest<HTMLElement>("[data-reference-grid]");
  if (!grid) return;
  const buttons = Array.from(grid.querySelectorAll<HTMLButtonElement>("[data-reference-index]"));
  if (!buttons.length) return;
  const columnWidth = buttons[0].getBoundingClientRect().width;
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
  const columns = Math.max(1, Math.round((grid.clientWidth + gap) / (columnWidth + gap)));
  const offset = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -columns : columns;
  const target = buttons[Math.max(0, Math.min(buttons.length - 1, index + offset))];
  if (target && target !== event.currentTarget) {
    event.preventDefault();
    target.focus();
  }
}

/* --------------------------------------------------------------- Popover */

/**
 * The reference library as a popover that rises out of the composer: recent
 * generations and uploads in a grid, an upload button, drop and paste.
 */
function ReferencePopover({ input, selected, anchor, popRef, dropActive, dropped, onClose, onSelect, onRemoveSelected, confirmDelete, onError, upload }: {
  input: MediaInput;
  anchor: HTMLElement | null;
  popRef: React.RefObject<HTMLDivElement | null>;
  dropActive: boolean;
  dropped: { asset: ReferenceAsset; nonce: number } | null;
  selected: ReferenceAsset | null;
  onClose: () => void;
  onSelect: (asset: ReferenceAsset) => void;
  onRemoveSelected: () => void;
  confirmDelete?: (asset: ReferenceAsset) => Promise<boolean>;
  onError?: (message: string) => void;
  upload: { busy: boolean; progress: number; start: (file: File | undefined) => Promise<ReferenceAsset | null> };
}) {
  const [tab, setTab] = React.useState<PickerTab>("generation");
  const [pages, setPages] = React.useState<Record<PickerTab, PageState>>({ generation: emptyPage(), upload: emptyPage() });
  const [selectingId, setSelectingId] = React.useState("");
  const uploadInput = React.useRef<HTMLInputElement>(null);
  const label = (input.label || "Reference image").toLowerCase();
  const [newId, setNewId] = React.useState("");

  // Pinned above the prompt bar. It lives in <body>, not inside the bar, because
  // the bar's own backdrop blur would stop this one from blurring the gallery.
  const [box, setBox] = React.useState<{ left: number; width: number; bottom: number } | null>(null);
  React.useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      setBox({ left: rect.left, width: rect.width, bottom: window.innerHeight - rect.top + 10 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(anchor);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [anchor]);

  // Dragging a file over the popover means "add to my uploads".
  React.useEffect(() => { if (dropActive) setTab("upload"); }, [dropActive]);
  React.useEffect(() => {
    if (!dropped) return;
    setTab("upload");
    setNewId(dropped.asset.id);
    setPages((current) => ({ ...current, upload: { ...current.upload, loaded: true, items: [dropped.asset, ...current.upload.items.filter((item) => item.id !== dropped.asset.id)] } }));
  }, [dropped]);

  const load = React.useCallback(async (target: PickerTab, cursor = "") => {
    setPages((current) => ({ ...current, [target]: { ...current[target], loading: true, error: "" } }));
    try {
      const page = await listReferenceAssets(target, cursor);
      setPages((current) => ({
        ...current,
        [target]: {
          items: cursor ? [...current[target].items, ...(page.items || [])] : (page.items || []),
          cursor: page.nextCursor || "",
          hasMore: Boolean(page.hasMore || page.nextCursor),
          loading: false,
          loaded: true,
          error: ""
        }
      }));
    } catch (error) {
      setPages((current) => ({ ...current, [target]: { ...current[target], loading: false, loaded: true, error: error instanceof Error ? error.message : "Could not load images" } }));
    }
  }, []);

  React.useEffect(() => {
    if (pages[tab].loaded || pages[tab].loading) return;
    load(tab);
  }, [load, pages, tab]);

  const uploadAndUse = async (file: File | undefined) => {
    const asset = await upload.start(file);
    if (!asset) return;
    setPages((current) => ({ ...current, upload: { ...current.upload, loaded: true, items: [asset, ...current.upload.items] } }));
    onClose();
  };

  async function choose(asset: ReferenceAsset) {
    if (selectingId || upload.busy) return;
    setSelectingId(asset.id);
    try {
      const resolved = asset.source === "generation" && asset.galleryItemId ? await referenceAssetFromGallery(asset.galleryItemId) : asset;
      onSelect(resolved);
      onClose();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Could not use this image");
    } finally {
      setSelectingId("");
    }
  }

  async function removeUpload(event: React.MouseEvent, asset: ReferenceAsset) {
    event.preventDefault();
    event.stopPropagation();
    try {
      if (confirmDelete && !await confirmDelete(asset)) return;
      await deleteReferenceAsset(asset.id);
      setPages((current) => ({ ...current, upload: { ...current.upload, items: current.upload.items.filter((item) => item.id !== asset.id) } }));
      if (selected?.id === asset.id) onRemoveSelected();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Could not delete upload");
    }
  }

  const page = pages[tab];
  if (!box) return null;
  return createPortal(
    <motion.div
      ref={popRef}
      className={cn("reference-popover", dropActive && "is-drop-target")}
      style={{ left: box.left, width: box.width, bottom: box.bottom }}
      role="dialog"
      aria-label={`Choose ${label}`}
      aria-busy={upload.busy || Boolean(selectingId) || undefined}
      data-open-surface
      initial={{ opacity: 0, y: 10, scale: 0.97, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: 8, scale: 0.98, filter: "blur(3px)" }}
      transition={spring}
    >
      <header className="reference-popover-head">
        <div className="reference-tabs" role="tablist" aria-label="Reference image sources">
          <button role="tab" aria-selected={tab === "generation"} className={cn(tab === "generation" && "active")} onClick={() => setTab("generation")}><Images size={14} /> Generations</button>
          <button role="tab" aria-selected={tab === "upload"} className={cn(tab === "upload" && "active")} onClick={() => setTab("upload")}><ImageIcon size={14} /> Uploads</button>
        </div>
        <span className="reference-popover-hint">Drop or paste an image anywhere on the prompt</span>
        <button type="button" className="btn is-primary reference-upload" onClick={() => uploadInput.current?.click()} disabled={upload.busy}>
          {upload.busy ? <LoaderCircle className="spin" size={14} /> : <Upload size={14} />}
          <span>{upload.busy ? `${upload.progress || 0}%` : "Upload"}</span>
        </button>
        <input ref={uploadInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { uploadAndUse(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        <Tip content="Close (Esc)"><button type="button" className="reference-popover-close" aria-label="Close" onClick={onClose}><X size={15} /></button></Tip>
      </header>

      <div className="reference-popover-body" role="tabpanel">
        {page.loading && !page.items.length ? (
          <div className="reference-grid is-loading" aria-label="Loading images">
            {Array.from({ length: 12 }, (_, index) => <div className="reference-skeleton" key={index} />)}
          </div>
        ) : page.error && !page.items.length ? (
          <div className="reference-empty"><ImageIcon size={22} /><strong>Images unavailable</strong><p>{page.error}</p><button className="btn" onClick={() => load(tab)}>Try again</button></div>
        ) : !page.items.length ? (
          <div className="reference-empty">
            <ImageIcon size={22} />
            <strong>{tab === "generation" ? "No generations yet" : "No uploads yet"}</strong>
            <p>{tab === "generation" ? "Finished images will show up here." : "Upload one, or drop it on the prompt."}</p>
            {tab === "upload" ? <button className="btn" onClick={() => uploadInput.current?.click()}><Upload size={14} /> Upload image</button> : null}
          </div>
        ) : (
          <>
            <div className="reference-grid" data-reference-grid>
              {page.items.map((asset, index) => {
                const isSelected = selected?.id === asset.id;
                return (
                  <motion.div
                    key={asset.id}
                    className={cn("reference-tile", isSelected && "is-selected", asset.id === newId && "is-new")}
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ ...spring, delay: Math.min(index, 18) * 0.012 }}
                  >
                    <button
                      type="button"
                      data-reference-index={index}
                      className="reference-tile-select"
                      aria-pressed={isSelected}
                      aria-label={`${isSelected ? "Selected: " : ""}${asset.name}`}
                      onKeyDown={(event) => moveGridFocus(event, index)}
                      onClick={() => choose(asset)}
                      disabled={Boolean(selectingId || upload.busy)}
                    >
                      <img src={assetImage(asset)} alt="" loading="lazy" draggable={false} />
                      {isSelected ? <i className="reference-tile-check"><Check size={12} strokeWidth={3} /></i> : null}
                    </button>
                    {asset.source === "upload" ? <button type="button" className="reference-tile-delete" aria-label={`Delete ${asset.name}`} onClick={(event) => removeUpload(event, asset)}><Trash2 size={13} /></button> : null}
                    {selectingId === asset.id ? <span className="reference-tile-busy"><LoaderCircle className="spin" size={16} /></span> : null}
                  </motion.div>
                );
              })}
            </div>
            {page.hasMore ? <button className="btn is-ghost reference-more" onClick={() => load(tab, page.cursor)} disabled={page.loading}>{page.loading ? "Loading…" : "Load more"}</button> : null}
          </>
        )}
      </div>
      <AnimatePresence>
        {dropActive ? (
          <motion.div key="drop" className="reference-drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
            <DropBadge text="Drop to add to your uploads" />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>,
    document.body
  );
}

/** The shared drop affordance: an icon that lifts toward the pointer and a label. */
function DropBadge({ text }: { text: string }) {
  return (
    <div className="drop-badge">
      <span className="drop-badge-icon"><Upload size={18} /></span>
      <strong>{text}</strong>
    </div>
  );
}

/* ------------------------------------------------------------------ Slot */

/** How much a start image may change (the sampler's denoise), 0-1. */
export type ReferenceStrength = { value: number; onChange: (value: number) => void; meta?: { min?: number; max?: number; step?: number } };

/**
 * One reference input as a chip in the composer's top-right corner. Empty, it
 * introduces itself as "Add reference" (or "Add start image" for plain
 * image-to-image) and settles into a round +. With an
 * image it becomes a squircle thumbnail that opens into a small menu on hover.
 */
function ReferenceSlot({ input, strength, selected, open, busy, progress, fresh, onOpen, onRemove }: {
  input: MediaInput;
  strength?: ReferenceStrength | null;
  selected: ReferenceAsset | null;
  open: boolean;
  busy: boolean;
  progress: number;
  fresh: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const image = selected ? assetImage(selected) : "";
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => { setBroken(false); }, [image]);
  const required = Boolean(input.required || (input.min || 0) > 0);
  const label = input.label || "Reference image";
  const isStart = input.role === "start";
  const [introduced, setIntroduced] = React.useState(false);
  React.useEffect(() => {
    const id = window.setTimeout(() => setIntroduced(true), 2600);
    return () => window.clearTimeout(id);
  }, []);

  if (busy) {
    return (
      <div className="ref-chip is-busy" aria-live="polite">
        <LoaderCircle className="spin" size={15} /><span>{progress ? `${progress}%` : "Uploading"}</span>
      </div>
    );
  }

  if (!selected) {
    // The label is always rendered; a grid track animates it open and shut.
    const expanded = !introduced || required || open;
    return (
      <Tip content={expanded ? `Choose a ${label.toLowerCase()}, or drop one on the prompt` : `Add ${label.toLowerCase()}`}>
        <button
          type="button"
          data-open-trigger
          className={cn("ref-chip ref-add", expanded && "is-expanded", required && "is-required", open && "is-open")}
          aria-label={`Add ${label.toLowerCase()}${required ? ", required" : ""}`}
          aria-expanded={open}
          onClick={onOpen}
        >
          <Plus size={15} strokeWidth={2.2} />
          <span className="ref-add-label"><span>{isStart ? "Add start image" : "Add reference"}{required ? <em>Required</em> : null}</span></span>
        </button>
      </Tip>
    );
  }

  return (
    <div className={cn("ref-chip ref-selected", open && "is-open", fresh && "is-new")}>
      {/* The menu reveals leftward from behind the thumbnail with a clip-path, so
          nothing reflows and the thumbnail never moves. */}
      <div className="ref-menu">
        <button type="button" className="ref-menu-name" onClick={onOpen} tabIndex={-1}>
          <strong>{selected.name}</strong>
          <small>{isStart ? "Start image" : selected.source === "generation" ? "Generation" : selected.source === "vault" ? "Private" : "Upload"} · change</small>
        </button>
        {isStart && strength ? (
          <Tip content="How much the model may change your image: low keeps it close, high only borrows its layout and colours">
            <label className="ref-strength">
              <span>Change<b>{Math.round(strength.value * 100)}%</b></span>
              <input
                type="range"
                min={strength.meta?.min ?? 0}
                max={strength.meta?.max ?? 1}
                step={Math.max(0.05, strength.meta?.step ?? 0.05)}
                value={strength.value}
                aria-label="How much to change the start image"
                onChange={(event) => strength.onChange(Number(event.target.value))}
              />
            </label>
          </Tip>
        ) : null}
        <Tip content={`Remove ${label.toLowerCase()}`}>
          <button type="button" className="ref-menu-remove" aria-label={`Remove ${label.toLowerCase()}`} onClick={onRemove}><X size={13} /></button>
        </Tip>
      </div>
      <button type="button" data-open-trigger className="ref-thumb" onClick={onOpen} aria-label={`Change ${label.toLowerCase()}, currently ${selected.name}`} aria-expanded={open}>
        {image && !broken ? <img src={image} alt="" draggable={false} onError={() => setBroken(true)} /> : selected.source === "vault" ? <LockKeyhole size={14} /> : <ImageIcon size={15} />}
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- Slots */

/**
 * Every reference input of the workflow, top right of the composer, plus the
 * picker popover and drop-and-paste uploads on the whole prompt bar.
 */
export function ReferenceSlots({ inputs, strength = null, selected, onSelect, onRemove, confirmDelete, onError }: {
  inputs: MediaInput[];
  strength?: ReferenceStrength | null;
  selected: SelectedReferenceAsset[];
  onSelect: (slot: string, asset: ReferenceAsset) => void;
  onRemove: (slot: string) => void;
  confirmDelete?: (asset: ReferenceAsset) => Promise<boolean>;
  onError?: (message: string) => void;
}) {
  const [openSlot, setOpenSlot] = React.useState("");
  const [uploadSlot, setUploadSlot] = React.useState("");
  const [progress, setProgress] = React.useState(0);
  const [dropTarget, setDropTarget] = React.useState<"" | "prompt" | "popover">("");
  const [landing, setLanding] = React.useState(false);
  const [freshSlot, setFreshSlot] = React.useState("");
  const [dropped, setDropped] = React.useState<{ asset: ReferenceAsset; nonce: number } | null>(null);
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const popRef = React.useRef<HTMLDivElement>(null);
  const overlayRef = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpenSlot(""), []);
  useDismiss([rootRef, popRef], Boolean(openSlot), close);
  // Find the prompt bar whenever this renders into it. On first mount there may be
  // no inputs yet (the workflow is still loading), so nothing is rendered to look from.
  React.useLayoutEffect(() => {
    const next = rootRef.current?.closest<HTMLElement>(".zen-prompt") || null;
    setHost((current) => current === next ? current : next);
  });

  const assetFor = (slot: string) => selected.find((item) => item.slot === slot)?.asset || null;
  // New images go to the slot that's open, else the first empty one, else the first.
  const targetSlot = () => openSlot || inputs.find((input) => !assetFor(input.id))?.id || inputs[0]?.id || "";

  const upload = React.useCallback(async (file: File | undefined, slot: string) => {
    if (!file || !slot || uploadSlot) return null;
    if (!file.type.startsWith("image/")) { onError?.("Choose an image file"); return null; }
    setUploadSlot(slot);
    setProgress(0);
    try {
      const asset = await uploadReferenceAsset(file, setProgress);
      onSelect(slot, asset);
      setFreshSlot(slot);
      window.setTimeout(() => setFreshSlot(""), 700);
      return asset;
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Upload failed");
      return null;
    } finally {
      setUploadSlot("");
      setProgress(0);
    }
  }, [onError, onSelect, uploadSlot]);

  /*
   * Drag and drop follows the pointer: over the open popover it offers "add to
   * uploads", over the prompt bar "use as reference", anywhere else nothing.
   * The indicator's spotlight tracks the pointer; a drop lands with a pulse.
   */
  const live = React.useRef({ upload, targetSlot, openSlot });
  live.current = { upload, targetSlot, openSlot };
  React.useEffect(() => {
    if (!host || !inputs.length) return;
    const hasImage = (event: DragEvent) => Array.from(event.dataTransfer?.items || []).some((item) => item.kind === "file" && item.type.startsWith("image/"));
    const targetOf = (event: DragEvent): "" | "prompt" | "popover" => {
      const node = event.target instanceof Element ? event.target : null;
      if (node?.closest(".reference-popover")) return "popover";
      if (node && host.contains(node)) return "prompt";
      return "";
    };
    const track = (event: DragEvent, target: "" | "prompt" | "popover") => {
      const surface = target === "popover" ? popRef.current : target === "prompt" ? host : null;
      const layer = target === "prompt" ? overlayRef.current : surface?.querySelector<HTMLElement>(".reference-drop");
      if (!surface || !layer) return;
      const rect = surface.getBoundingClientRect();
      layer.style.setProperty("--drop-x", `${event.clientX - rect.left}px`);
      layer.style.setProperty("--drop-y", `${event.clientY - rect.top}px`);
    };
    let clearTimer = 0;
    const over = (event: DragEvent) => {
      if (!hasImage(event)) return;
      const target = targetOf(event);
      window.clearTimeout(clearTimer);
      setDropTarget(target);
      if (!target) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      track(event, target);
    };
    // dragleave fires between children; only clear once nothing re-claims the drag.
    const leave = () => { window.clearTimeout(clearTimer); clearTimer = window.setTimeout(() => setDropTarget(""), 80); };
    const drop = (event: DragEvent) => {
      const target = targetOf(event);
      window.clearTimeout(clearTimer);
      setDropTarget("");
      const file = Array.from(event.dataTransfer?.files || []).find((item) => item.type.startsWith("image/"));
      if (!file || !target) return;
      event.preventDefault();
      setLanding(true);
      window.setTimeout(() => setLanding(false), 520);
      const { upload: run, targetSlot: slot, openSlot: open } = live.current;
      run(file, slot()).then((asset) => {
        if (!asset) return;
        if (target === "popover" && open) setDropped({ asset, nonce: Date.now() });
        else setOpenSlot("");
      });
    };
    const paste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files || []).find((item) => item.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      live.current.upload(file, live.current.targetSlot());
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    host.addEventListener("paste", paste);
    return () => {
      window.clearTimeout(clearTimer);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      host.removeEventListener("paste", paste);
    };
  }, [host, inputs.length]);

  if (!inputs.length) return null;
  const openInput = inputs.find((input) => input.id === openSlot) || null;

  return (
    <div className="composer-reference" ref={rootRef}>
      <div className="composer-reference-slots">
        {inputs.map((input) => (
          <ReferenceSlot
            key={input.id}
            input={input}
            strength={strength}
            selected={assetFor(input.id)}
            open={openSlot === input.id}
            busy={uploadSlot === input.id}
            progress={progress}
            fresh={freshSlot === input.id}
            onOpen={() => setOpenSlot((current) => current === input.id ? "" : input.id)}
            onRemove={() => onRemove(input.id)}
          />
        ))}
      </div>
      <AnimatePresence>
        {openInput ? (
          <ReferencePopover
            key="popover"
            input={openInput}
            selected={assetFor(openInput.id)}
            anchor={host}
            popRef={popRef}
            dropActive={dropTarget === "popover"}
            dropped={dropped}
            onClose={close}
            onSelect={(asset) => onSelect(openInput.id, asset)}
            onRemoveSelected={() => onRemove(openInput.id)}
            confirmDelete={confirmDelete}
            onError={onError}
            upload={{ busy: Boolean(uploadSlot), progress, start: (file) => upload(file, openInput.id) }}
          />
        ) : null}
      </AnimatePresence>
      <div ref={overlayRef} className={cn("composer-drop", dropTarget === "prompt" && "is-active", landing && "is-landing")} aria-hidden={dropTarget !== "prompt"}>
        <DropBadge text={inputs.length === 1 && inputs[0].role === "start" ? "Drop to start from this image" : inputs.length > 1 ? "Drop to use as a reference" : "Drop to use as reference"} />
      </div>
    </div>
  );
}

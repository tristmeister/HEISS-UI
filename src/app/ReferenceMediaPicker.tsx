import { t } from '../i18n/core.js';
import { useLanguage } from '../i18n/react';
import React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Brush, Check, Image as ImageIcon, Images, LoaderCircle, LockKeyhole, Plus, Trash2, Upload, X } from "lucide-react";
import { cn } from "./format";
import { Tip } from "./components";
import { useDismiss } from "./useDismiss";
import { useHiddenActions } from "./hiddenContext";
import { deleteReferenceAsset, listReferenceAssets, referenceAssetFromGallery, uploadReferenceAsset } from "./api";
import type { MediaInput, ReferenceAsset, ReferenceInpaint, ReferenceRoleControl, SelectedReferenceAsset } from "./types";
import { InpaintStudio } from "./InpaintStudio";
import { SafeImg } from './SafeImg';
import { showToastTone } from './toast';

type PickerTab = "generation" | "hidden" | "upload";

// Files dragged from Windows Explorer can arrive with an empty type (often
// .webp and .avif): fall back to the extension. The server sniffs the bytes.
const IMAGE_EXTENSION = /\.(png|jpe?g|webp|avif|gif|bmp)$/i;
const isImageFile = (file: File) => file.type.startsWith("image/") || (!file.type && IMAGE_EXTENSION.test(file.name));

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
function ReferencePopover({ input, selected, anchor, popRef, dropActive, dropped, onClose, onSelect, onDeleted, confirmDelete, onError, upload }: {
  input: MediaInput;
  anchor: HTMLElement | null;
  popRef: React.RefObject<HTMLDivElement | null>;
  dropActive: boolean;
  dropped: { asset: ReferenceAsset; nonce: number } | null;
  selected: ReferenceAsset | null;
  onClose: () => void;
  onSelect: (asset: ReferenceAsset) => void;
  /** An upload was deleted for good: whichever slots hold it let it go. */
  onDeleted: (asset: ReferenceAsset) => void;
  confirmDelete?: (asset: ReferenceAsset) => Promise<boolean>;
  onError?: (message: string) => void;
  upload: { busy: boolean; progress: number; start: (file: File | undefined) => Promise<ReferenceAsset | null> };
}) {
  useLanguage();
  // Hidden images sit on their own shelf, behind the same lock as Hidden itself.
  // It opens first when the picked image came from there, or when making in Hidden.
  const hidden = useHiddenActions();
  const hiddenShelf = Boolean(hidden?.enabled);
  const hiddenOpen = Boolean(hidden?.unlocked);
  const [tab, setTab] = React.useState<PickerTab>(() => hiddenShelf && (selected?.source === "vault" || (hidden?.space === "hidden" && hiddenOpen)) ? "hidden" : "generation");
  const [pages, setPages] = React.useState<Record<PickerTab, PageState>>({ generation: emptyPage(), hidden: emptyPage(), upload: emptyPage() });
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
    // Not marked loaded: the rest of the uploads still have to come from the server.
    setPages((current) => ({ ...current, upload: { ...current.upload, items: [dropped.asset, ...current.upload.items.filter((item) => item.id !== dropped.asset.id)] } }));
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
      setPages((current) => ({ ...current, [target]: { ...current[target], loading: false, loaded: true, error: error instanceof Error ? error.message : "Couldn’t load images" } }));
    }
  }, []);

  // Locking empties the shelf; unlocking fills it afresh.
  React.useEffect(() => { setPages((current) => ({ ...current, hidden: emptyPage() })); }, [hiddenOpen]);
  React.useEffect(() => { if (tab === "hidden" && !hiddenShelf) setTab("generation"); }, [hiddenShelf, tab]);

  React.useEffect(() => {
    if (pages[tab].loaded || pages[tab].loading || (tab === "hidden" && !hiddenOpen)) return;
    load(tab);
  }, [hiddenOpen, load, pages, tab]);

  const uploadAndUse = async (file: File | undefined) => {
    const asset = await upload.start(file);
    if (!asset) return;
    setPages((current) => ({ ...current, upload: { ...current.upload, items: [asset, ...current.upload.items.filter((item) => item.id !== asset.id)] } }));
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
      onError?.(error instanceof Error ? error.message : "Couldn’t use this image");
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
      onDeleted(asset);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Couldn’t delete the upload");
    }
  }

  const page = pages[tab];
  if (!box) return null;
  // In the phone studio the prompt sits at the top of a full-height sheet, so the
  // picker comes up from the bottom edge as a sheet of its own.
  const asSheet = Boolean(anchor?.classList.contains("phone-compose"));
  return createPortal(
    <motion.div
      ref={popRef}
      className={cn("reference-popover", dropActive && "is-drop-target", asSheet && "is-sheet")}
      style={asSheet ? undefined : { left: box.left, width: box.width, bottom: box.bottom }}
      role="dialog"
      aria-label={t("Choose {0}", { "0": (label) })}
      aria-busy={upload.busy || Boolean(selectingId) || undefined}
      data-open-surface
      initial={{ opacity: 0, y: 10, scale: 0.97, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: 8, scale: 0.98, filter: "blur(3px)" }}
      transition={spring}
    >
      <header className="reference-popover-head">
        <div className="reference-tabs" role="tablist" aria-label={t("Reference image sources")}>
          <button role="tab" aria-selected={tab === "generation"} className={cn(tab === "generation" && "active")} onClick={() => setTab("generation")}><Images size={14} />{t("Generations")}</button>
          {hiddenShelf ? <button role="tab" aria-selected={tab === "hidden"} className={cn(tab === "hidden" && "active")} onClick={() => setTab("hidden")}><LockKeyhole size={14} />{t("Hidden")}</button> : null}
          <button role="tab" aria-selected={tab === "upload"} className={cn(tab === "upload" && "active")} onClick={() => setTab("upload")}><ImageIcon size={14} />{t("Uploads")}</button>
        </div>
        <span className="reference-popover-hint">{t("Drop or paste an image anywhere on the prompt")}</span>
        <button type="button" className="btn is-primary reference-upload" onClick={() => uploadInput.current?.click()} disabled={upload.busy}>
          {upload.busy ? <LoaderCircle className="spin" size={14} /> : <Upload size={14} />}
          <span>{upload.busy ? `${upload.progress || 0}%` : t("Upload")}</span>
        </button>
        <input ref={uploadInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { uploadAndUse(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        <Tip content={t("Close (Esc)")}><button type="button" className="reference-popover-close" aria-label={t("Close")} onClick={onClose}><X size={15} /></button></Tip>
      </header>

      <div className="reference-popover-body" role="tabpanel">
        {tab === "hidden" && !hiddenOpen ? (
          <div className="reference-empty">
            <LockKeyhole size={22} />
            <strong>{t("Hidden is locked")}</strong>
            <p>{t("Unlock it to use a hidden image. The image stays in Hidden.")}</p>
            <button className="btn is-primary" onClick={() => hidden?.unlock()}><LockKeyhole size={14} />{t("Unlock")}</button>
          </div>
        ) : page.loading && !page.items.length ? (
          <div className="reference-grid is-loading" aria-label={t("Loading images")}>
            {Array.from({ length: 12 }, (_, index) => <div className="reference-skeleton" key={index} />)}
          </div>
        ) : page.error && !page.items.length ? (
          <div className="reference-empty"><ImageIcon size={22} /><strong>{t("Images unavailable")}</strong><p>{page.error}</p><button className="btn" onClick={() => load(tab)}>{t("Try again")}</button></div>
        ) : !page.items.length ? (
          <div className="reference-empty">
            <ImageIcon size={22} />
            <strong>{tab === "generation" ? t("No generations yet") : tab === "hidden" ? t("Nothing in Hidden yet") : t("No uploads yet")}</strong>
            <p>{tab === "generation" ? t("Finished images show up here.") : tab === "hidden" ? t("Images you hide show up here.") : t("Upload one, or drop it on the prompt.")}</p>
            {tab === "upload" ? <button className="btn" onClick={() => uploadInput.current?.click()}><Upload size={14} />{t("Upload image")}</button> : null}
          </div>
        ) : (
          <>
            {tab === "hidden" && hidden?.space !== "hidden" ? <p className="reference-shelf-note"><LockKeyhole size={12} />{t("What you make from a hidden image goes to Hidden too.")}</p> : null}
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
                      <SafeImg src={assetImage(asset)} loading="lazy" draggable={false} fallback={<ImageIcon size={16} />} />
                      {isSelected ? <i className="reference-tile-check"><Check size={12} strokeWidth={3} /></i> : null}
                    </button>
                    {asset.source === "upload" ? <button type="button" className="reference-tile-delete" aria-label={t("Delete {0}", { "0": (asset.name) })} onClick={(event) => removeUpload(event, asset)}><Trash2 size={13} /></button> : null}
                    {selectingId === asset.id ? <span className="reference-tile-busy"><LoaderCircle className="spin" size={16} /></span> : null}
                  </motion.div>
                );
              })}
            </div>
            {page.hasMore ? <button className="btn is-ghost reference-more" onClick={() => load(tab, page.cursor)} disabled={page.loading}>{page.loading ? t("Loading…") : t("Load more")}</button> : null}
          </>
        )}
      </div>
      <AnimatePresence>
        {dropActive ? (
          <motion.div key="drop" className="reference-drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
            <DropBadge text="Drop to upload" />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>,
    document.body
  );
}

/** The shared drop affordance: an icon that lifts toward the pointer and a label. */
function DropBadge({ text }: { text: string }) {
  useLanguage();
  return (
    <div className="drop-badge">
      <span className="drop-badge-icon"><Upload size={18} /></span>
      <strong>{text}</strong>
    </div>
  );
}

/* ------------------------------------------------------------------ Slot */

/** A reference's name as shown: its file name without the extension. */
export function referenceName(name: string) {
  return name.replace(/\.[a-z0-9]{2,5}$/i, "") || name;
}

// The menu opens a beat after the pointer arrives and stays a moment after it
// leaves, so passing over the chip or wobbling off its edge never flickers it.
const hoverOpenDelay = 70;
const hoverCloseDelay = 260;
const inpaintIntroKey = "heiss-ui-inpaint-introduced";
const inpaintIntroduced = () => { try { return localStorage.getItem(inpaintIntroKey) === "1"; } catch { return true; } };
const coarsePointer = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
const noHoverQuery = "(hover: none)";
/** A screen with no hover (a phone, a tablet without a trackpad), kept live: a trackpad can come and go. The CSS's always-shown × uses the same test. */
function useNoHover() {
  const [none, setNone] = React.useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(noHoverQuery).matches));
  React.useEffect(() => {
    const query = window.matchMedia?.(noHoverQuery);
    if (!query) return;
    const update = () => setNone(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return none;
}
const rememberInpaintIntro = () => { try { localStorage.setItem(inpaintIntroKey, "1"); } catch { /* shown again next time, which is fine */ } };

/** One of the other references in a stack: what it holds, and how to change or remove it. */
type StackItem = { input: MediaInput; asset: ReferenceAsset; open: boolean; busy: boolean; progress: number; fresh: boolean; onOpen: () => void; onRemove: () => void };
/**
 * The references that follow the first one (a model that reads several): the
 * first stays the chip in the corner, the others sit behind it as a deck and
 * fan out into its strip, with a + for the next one (greyed once all are used).
 */
type ReferenceStack = {
  items: StackItem[];
  /** The next empty slot, or null when every slot holds a picture. */
  add: { open: boolean; busy: boolean; progress: number; onOpen: () => void } | null;
  max: number;
  /** No + in Edit: it changes one picture. */
  canAdd: boolean;
  /** Open the strip for a moment, to show where a dropped picture went. */
  intro: boolean;
};

const foldEase = "cubic-bezier(.16, 1, .3, 1)";
/**
 * Something in a row that comes and goes with a state switch (Edit | Reference): it stays
 * mounted and folds to nothing, width and the row's gap with it, so its neighbours glide
 * instead of jumping. Folded, it can't be reached by pointer, keyboard or screen reader.
 */
function Fold({ shown, children, gap = 6 }: { shown: boolean; children: React.ReactNode; gap?: number }) {
  useLanguage();
  const ref = React.useRef<HTMLSpanElement>(null);
  const was = React.useRef(shown);
  // Its width while shown, kept up to date: once folded (width 0) its content can be squeezed.
  const openWidth = React.useRef(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el && shown && !el.classList.contains("is-folding")) openWidth.current = el.offsetWidth;
  });
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.inert = !shown;
    const before = was.current;
    was.current = shown;
    if (before === shown || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Unfolding, it's back at its natural width to measure; folding, the last width it had.
    const width = `${shown ? el.offsetWidth : openWidth.current}px`;
    if (!shown && !openWidth.current) return;
    const open = { width, marginLeft: "0px", opacity: 1, scale: "1" };
    const shut = { width: "0px", marginLeft: `${-gap}px`, opacity: 0, scale: ".7" };
    // Clipped only while it moves, so a focus ring or a corner × isn't cut off at rest.
    el.classList.add("is-folding");
    const animation = el.animate(shown ? [shut, open] : [open, shut], { duration: 340, easing: foldEase });
    const done = () => el.classList.remove("is-folding");
    animation.onfinish = done;
    animation.oncancel = done;
    return () => animation.cancel();
  }, [shown, gap]);
  return <span ref={ref} className={cn("ref-fold", !shown && "is-folded")} style={{ "--fold-gap": `${-gap}px` } as React.CSSProperties} aria-hidden={!shown || undefined}>{children}</span>;
}

const fullMessage = (max: number) => `Up to ${max} references. Remove one to add another`;

/** The + for another reference: greyed, with why, once every slot is used. */
function AddMore({ max, add, className, size = 15 }: { max: number; add: ReferenceStack["add"]; className: string; size?: number }) {
  useLanguage();
  if (add?.busy) return <span className={cn(className, "is-busy")} aria-live="polite"><LoaderCircle className="spin" size={size} /></span>;
  return (
    <Tip content={add ? t("Add another reference, or drop one on the prompt") : fullMessage(max)}>
      <button
        type="button"
        data-open-trigger={add ? true : undefined}
        className={cn(className, add?.open && "is-open", !add && "is-full")}
        aria-label={add ? t("Add another reference") : fullMessage(max)}
        aria-disabled={!add || undefined}
        aria-expanded={add ? add.open : undefined}
        onClick={() => add ? add.onOpen() : showToastTone(fullMessage(max), "default")}
      >
        <Plus size={size} strokeWidth={2.2} />
      </button>
    </Tip>
  );
}

/**
 * One reference input as a chip in the composer's top-right corner. Empty, it
 * introduces itself as "Add reference" (or "Add start image" for plain
 * image-to-image) and settles into a round +. With an
 * image it becomes a squircle thumbnail that opens into a small menu on hover.
 */
function ReferenceSlot({ input, selected, open, busy, progress, fresh, paint, role = null, stack = null, guide = false, onOpen, onRemove }: {
  input: MediaInput;
  selected: ReferenceAsset | null;
  open: boolean;
  busy: boolean;
  progress: number;
  fresh: boolean;
  /** Painting on this image, for a model that can inpaint: the studio's state and how to open it. */
  paint?: { masked: boolean; open: boolean; intro: boolean; hidden?: boolean; onOpen: () => void } | null;
  /** For a reference that can frame the output: edit this image, or only use it as a reference. */
  role?: ReferenceRoleControl | null;
  /** The references after this one, folded behind it (desktop only; a phone lays them out in a row). */
  stack?: ReferenceStack | null;
  /** A later reference while the first is edited: it isn't changed, only drawn from. */
  guide?: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  useLanguage();
  const image = selected ? assetImage(selected) : "";
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => { setBroken(false); }, [image]);
  const required = Boolean(input.required || (input.min || 0) > 0);
  const label = input.label || "Reference image";
  const isStart = input.role === "start";
  // Only the first slot introduces itself: a later one appears after each picture, and spelling
  // it out every time would make the row jump.
  const [introduced, setIntroduced] = React.useState(Boolean(input.follows));
  React.useEffect(() => {
    const id = window.setTimeout(() => setIntroduced(true), 2600);
    return () => window.clearTimeout(id);
  }, []);
  const [hover, setHover] = React.useState(false);
  const hoverTimer = React.useRef(0);
  React.useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  // The brush folds by its measured width: the menu sizes to its content, where CSS can't tween to "auto".
  const paintSlot = React.useRef<HTMLSpanElement>(null);
  const paintWidth = React.useRef(0);
  const paintHidden = Boolean(paint?.hidden);
  const paintWasHidden = React.useRef(paintHidden);
  React.useLayoutEffect(() => {
    const slot = paintSlot.current;
    if (!slot) return;
    const was = paintWasHidden.current;
    paintWasHidden.current = paintHidden;
    if (!paintHidden) paintWidth.current = slot.scrollWidth;
    if (was === paintHidden || !paintWidth.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const open = `${paintWidth.current}px`;
    slot.animate({ width: paintHidden ? [open, "0px"] : ["0px", open] }, { duration: 320, easing: "cubic-bezier(.16, 1, .3, 1)" });
  });
  const hoverTo = (next: boolean, event: React.PointerEvent) => {
    if (event.pointerType === "touch") return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHover(next), next ? hoverOpenDelay : hoverCloseDelay);
  };

  if (busy) {
    return (
      <div className="ref-chip is-busy" aria-live="polite">
        <LoaderCircle className="spin" size={15} /><span>{progress ? `${progress}%` : t("Uploading")}</span>
      </div>
    );
  }

  if (!selected) {
    // The label is always rendered; a grid track animates it open and shut.
    const expanded = !introduced || required || open;
    return (
      <Tip content={expanded ? t("Choose a {0}, or drop one on the prompt", { "0": (label.toLowerCase()) }) : t("Add {0}", { "0": (label.toLowerCase()) })}>
        <button
          type="button"
          data-open-trigger
          className={cn("ref-chip ref-add", expanded && "is-expanded", required && "is-required", open && "is-open")}
          aria-label={t("Add {0}{1}", { "0": (label.toLowerCase()), "1": (required ? t(", required") : t("")) })}
          aria-expanded={open}
          onClick={onOpen}
        >
          <Plus size={15} strokeWidth={2.2} />
          <span className="ref-add-label"><span>{isStart ? t("Add start image") : t("Add reference")}{required ? <em>{t("Required")}</em> : null}</span></span>
        </button>
      </Tip>
    );
  }

  // The thumbnail is the anchor and says what the image is at rest: EDIT when it's the picture
  // being changed, a deck behind it when others come with it. The strip that grows out of it on
  // hover holds the choices (Edit | Reference, the brush) and the other references with a + for more.
  const menu = Boolean(role || paint || stack);
  const many = Boolean(stack?.items.length);
  const editing = role?.value === "edit";
  const name = editing ? `Picture to edit: ${referenceName(selected.name)}` : `${isStart ? "Start image" : label}: ${referenceName(selected.name)}${guide ? " · Not edited, only drawn from" : ""}`;
  const stackOpen = Boolean(stack && (stack.add?.open || stack.items.some((item) => item.open)));
  return (
    <div
      className={cn("ref-chip ref-selected", (open || paint?.open || stackOpen) && "is-open", hover && "is-hover", (paint?.intro || stack?.intro) && "is-intro", fresh && "is-new", editing && "is-edit", many && "has-deck")}
      onPointerEnter={(event) => hoverTo(true, event)}
      onPointerLeave={(event) => hoverTo(false, event)}
    >
      {/* The menu reveals leftward from behind the thumbnail with a clip-path, so
          nothing reflows and the thumbnail never moves. */}
      {menu ? <div className="ref-menu">
        {role ? <RoleSwitch role={role} many={many} /> : null}
        {paint ? (
          // Folds away (rather than vanishing) while the image is a Ref, so the menu glides to its new width.
          <span ref={paintSlot} className={cn("ref-menu-paint-slot", paint.hidden && "is-hidden")} aria-hidden={paint.hidden || undefined}>
            {role ? <span className="ref-menu-divider" aria-hidden="true" /> : null}
            <Tip content={paint.masked ? t("Change the painted part") : t("Paint over a part to change only that")}>
              <button type="button" className={cn("ref-menu-paint", paint.masked && "is-masked", paint.open && "is-active")} aria-label={paint.masked ? t("Edit the painted part") : t("Paint the part to change")} aria-pressed={paint.open} tabIndex={paint.hidden ? -1 : undefined} onClick={paint.onOpen}>
                <Brush size={17} />
                <span className="ref-menu-paint-label"><span>{coarsePointer() ? t("Tap") : t("Click")}{t("to inpaint")}</span></span>
              </button>
            </Tip>
          </span>
        ) : null}
        {stack ? (
          <span className="ref-stack">
            {/* The divider goes with the last thing after it: in Edit with no other pictures, nothing is. */}
            {role || paint ? <Fold shown={stack.items.length > 0 || stack.canAdd} gap={0}><span className="ref-menu-divider" aria-hidden="true" /></Fold> : null}
            {stack.items.map((item, index) => <StackThumb key={item.input.id} item={item} number={index + 2} guide={editing} />)}
            <Fold shown={stack.canAdd}><AddMore max={stack.max} add={stack.add} className="ref-stack-add" /></Fold>
          </span>
        ) : null}
      </div> : null}
      {/* The others peek out from behind the thumbnail, so it says "and more" at rest. */}
      {stack?.items.slice(0, 2).map((item, index) => {
        const src = assetImage(item.asset);
        return <i key={item.input.id} className={cn("ref-deck-card", `is-${index + 1}`)} aria-hidden="true" style={src ? { backgroundImage: `url("${src.replace(/"/g, "%22")}")` } : undefined} />;
      })}
      <Tip content={t("{0} · Click to change", { "0": (name) })}>
        <button type="button" data-open-trigger className="ref-thumb" onClick={onOpen} aria-label={t("Change {0}, currently {1}", { "0": (label.toLowerCase()), "1": (selected.name) })} aria-expanded={open}>
          {image && !broken ? <img src={image} alt="" draggable={false} onError={() => setBroken(true)} /> : selected.source === "vault" ? <LockKeyhole size={14} /> : <ImageIcon size={15} />}
        </button>
      </Tip>
      {/* Remove on the thumbnail's corner, where it's expected and far from Edit | Reference; Undo is in its toast. */}
      <Tip content={t("Remove {0}", { "0": (label.toLowerCase()) })}>
        <button type="button" className="ref-thumb-remove" aria-label={t("Remove {0}", { "0": (label.toLowerCase()) })} onClick={onRemove}><X size={10} strokeWidth={2.8} /></button>
      </Tip>
      {paint?.masked ? <i className="ref-mask-badge" aria-hidden="true"><Brush size={9} strokeWidth={2.6} /></i> : null}
      {/* The picture being edited is the one that's different from the rest: Ref leaves every image a plain reference. */}
      {role ? <i className={cn("ref-role-badge", editing && "is-on")} aria-hidden="true">{t("EDIT")}</i> : null}
    </div>
  );
}

/** Edit | Reference: one thumb slides between the two, like the size menu's tabs. */
export function RoleSwitch({ role, many, className }: { role: ReferenceRoleControl; many: boolean; className?: string }) {
  useLanguage();
  return (
    <div className={cn("ref-menu-role", role.value === "reference" && "is-ref", role.locked && "is-locked", className)} role="radiogroup" aria-label={t("What this image is")}>
      <i aria-hidden="true" />
      <Tip content={many ? t("Change the first picture, at its size and framing. The others are what it can draw from") : t("Change this picture: the result keeps its size and framing")}>
        <button type="button" role="radio" aria-checked={role.value === "edit"} className={cn(role.value === "edit" && "is-active")} onClick={() => role.onChange("edit")}>{t("Edit")}</button>
      </Tip>
      <Tip content={role.locked ? t("The painted part is changed in this picture. Clear the paint to use it as a reference") : many ? t("Let them all guide a new picture, at the size you picked") : t("Let it guide a new picture, at the size you picked")}>
        <button type="button" role="radio" aria-checked={role.value === "reference"} aria-disabled={role.locked || undefined} className={cn(role.value === "reference" && "is-active")} onClick={() => { if (!role.locked) role.onChange("reference"); }}>{t("Reference")}</button>
      </Tip>
    </div>
  );
}

/** Another reference in the stack's strip: click to change it, × to take it off. */
function StackThumb({ item, number, guide }: { item: StackItem; number: number; /** Edit: it isn't changed, only drawn from. */ guide: boolean }) {
  useLanguage();
  const src = assetImage(item.asset);
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => { setBroken(false); }, [src]);
  return (
    <span className={cn("ref-stack-item", item.open && "is-open", item.fresh && "is-new")}>
      <Tip content={t("Reference {0}: {1}{2} · Click to change", { "0": (number), "1": (referenceName(item.asset.name)), "2": (guide ? t(" · Not edited, only drawn from") : t("")) })}>
        <button type="button" data-open-trigger className="ref-stack-thumb" aria-label={t("Change reference {0}, currently {1}", { "0": (number), "1": (item.asset.name) })} aria-expanded={item.open} onClick={item.onOpen}>
          {item.busy ? <LoaderCircle className="spin" size={14} /> : src && !broken ? <img src={src} alt="" draggable={false} onError={() => setBroken(true)} /> : item.asset.source === "vault" ? <LockKeyhole size={13} /> : <ImageIcon size={14} />}
        </button>
      </Tip>
      <Tip content={t("Remove reference {0}", { "0": (number) })}>
        <button type="button" className="ref-stack-remove" aria-label={t("Remove reference {0}", { "0": (number) })} onClick={item.onRemove}><X size={9} strokeWidth={2.8} /></button>
      </Tip>
    </span>
  );
}

/* ----------------------------------------------------------------- Slots */

/**
 * Every reference input of the workflow, top right of the composer, plus the
 * picker popover and drop-and-paste uploads on the whole prompt bar.
 */
export function ReferenceSlots({ inputs, inpaint = null, role = null, selected, onSelect, onRemove, confirmDelete, onError }: {
  inputs: MediaInput[];
  inpaint?: ReferenceInpaint | null;
  role?: ReferenceRoleControl | null;
  selected: SelectedReferenceAsset[];
  onSelect: (slot: string, asset: ReferenceAsset) => void;
  onRemove: (slots: string | string[]) => void;
  confirmDelete?: (asset: ReferenceAsset) => Promise<boolean>;
  onError?: (message: string) => void;
}) {
  useLanguage();
  const [openSlot, setOpenSlot] = React.useState("");
  const noHover = useNoHover();
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
  // A drop only belongs to the popover it landed on; forget it on close so the
  // next open starts on the default tab and fetches the full list.
  React.useEffect(() => { if (!openSlot) setDropped(null); }, [openSlot]);
  useDismiss([rootRef, popRef], Boolean(openSlot), close);
  // The inpaint studio stays open while the prompt is typed into: the whole bar counts as inside it.
  const [painting, setPainting] = React.useState(false);
  const studioRef = React.useRef<HTMLDivElement>(null);
  const hostRef = React.useRef<HTMLElement | null>(null);
  const stopPainting = React.useCallback(() => setPainting(false), []);
  useDismiss([hostRef, studioRef], painting, stopPainting);
  React.useEffect(() => { if (!inpaint) setPainting(false); }, [inpaint]);
  const paintedAsset = inpaint ? selected.find((item) => item.slot === inpaint.slot)?.asset || null : null;
  React.useEffect(() => { setPainting(false); }, [paintedAsset?.id]);
  // Ref only guides a new picture, so there is nothing of this image to paint: Ref closes the brush studio.
  const asRef = role?.value === "reference";
  React.useEffect(() => { if (asRef) setPainting(false); }, [asRef]);
  // The first image that can be painted on shows where the brush is, once, by opening its menu for a moment.
  const [introSlot, setIntroSlot] = React.useState("");
  React.useEffect(() => {
    // Not while it's a Ref: the brush is folded away, and the one-time intro would be spent on nothing.
    if (!inpaint || !paintedAsset || asRef || inpaintIntroduced()) return;
    const start = window.setTimeout(() => setIntroSlot(inpaint.slot), 500);
    const end = window.setTimeout(() => { setIntroSlot(""); rememberInpaintIntro(); }, 3600);
    return () => { window.clearTimeout(start); window.clearTimeout(end); setIntroSlot(""); };
  }, [inpaint?.slot, paintedAsset?.id, asRef]);
  // Find the prompt bar whenever this renders into it. On first mount there may be
  // no inputs yet (the workflow is still loading), so nothing is rendered to look from.
  React.useLayoutEffect(() => {
    const next = rootRef.current?.closest<HTMLElement>(".zen-prompt, .phone-compose") || null;
    hostRef.current = next;
    setHost((current) => current === next ? current : next);
  });

  // Publish the chips' width to the prompt bar, so the prompt text wraps before
  // them; past ~40% of the bar they move onto a row of their own.
  const slotsRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const slots = slotsRef.current;
    if (!host || !slots) return;
    const measure = () => {
      // A folded chip (Edit's absent +) takes no room, nor the gap before it.
      const chips = (Array.from(slots.children) as HTMLElement[]).filter((chip) => !chip.classList.contains("is-folded"));
      const gap = parseFloat(getComputedStyle(slots).columnGap) || 0;
      const width = chips.reduce((sum, chip) => sum + chip.offsetWidth, 0) + gap * Math.max(0, chips.length - 1);
      host.style.setProperty("--ref-slots-w", `${Math.ceil(width)}px`);
      host.classList.toggle("has-wide-refs", width > host.clientWidth * 0.4);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    // Border box: the deck's room is padding, which animates, and a content box wouldn't see it.
    Array.from(slots.children).forEach((chip) => observer.observe(chip, { box: "border-box" }));
    return () => {
      observer.disconnect();
      host.style.removeProperty("--ref-slots-w");
      host.classList.remove("has-wide-refs");
    };
  });

  const assetFor = (slot: string) => selected.find((item) => item.slot === slot)?.asset || null;
  // What's picked now, for a removal's Undo, which runs later.
  const selectedNow = React.useRef(selected);
  selectedNow.current = selected;
  // Slots that follow one another (a model that reads several references) form one chain: the
  // first is the chip, the rest its stack. Independent inputs (a custom workflow's) stand alone.
  // Edit changes one picture: no slot for another (the ones already there stay, to draw from; Ref adds more).
  const editOnly = role?.value === "edit";
  const usable = editOnly ? inputs.filter((input) => !input.follows || assetFor(input.id)) : inputs;
  // Every slot is laid out either way; what Edit leaves out folds away (Fold), so the switch glides.
  const chains: MediaInput[][] = [];
  for (const input of inputs) {
    const chain = input.follows ? chains.find((items) => items.some((item) => item.id === input.follows)) : null;
    if (chain) chain.push(input); else chains.push([input]);
  }
  // A phone, or a screen without hover, lays the stack out in a row: there's nothing to hover open.
  const phone = Boolean(host?.classList.contains("phone-compose"));
  const inline = phone || noHover;
  // New images go to the slot that's open, else the first empty one. With every one of several
  // references used, a new one replaces none of them (least of all the picture being edited);
  // a single slot, or a workflow's own inputs, swap the first.
  const chained = inputs.some((input) => input.follows);
  const targetSlot = () => openSlot || usable.find((input) => !assetFor(input.id))?.id || (chained ? "" : inputs[0]?.id || "");
  const maxReferences = Math.max(1, ...chains.map((chain) => chain.length));
  // The picker open on a slot that's no longer offered (Edit, or the picture before it removed):
  // close it, so nothing lands there and a later paste doesn't reopen it.
  const usableIds = usable.map((input) => input.id).join(" ");
  React.useEffect(() => {
    if (openSlot && !usableIds.split(" ").includes(openSlot)) setOpenSlot("");
  }, [openSlot, usableIds]);
  const blockedMessage = editOnly ? "Edit changes one picture. Switch to Reference to add more" : fullMessage(maxReferences);

  // What the window's drag/paste listeners and a finishing upload read: always this render's.
  // (Through a ref, so a parent's new onError each render doesn't re-add the listeners, which
  // dropped the drop overlay's pending clear and left it on screen.)
  const live = React.useRef<{ upload: (file: File | undefined, slot: string) => Promise<ReferenceAsset | null>; targetSlot: () => string; openSlot: string; blockedMessage: string; usableIds: string; onError?: (message: string) => void }>(null!);
  const upload = React.useCallback(async (file: File | undefined, slot: string) => {
    if (!file || !slot || uploadSlot) return null;
    if (!isImageFile(file)) { live.current.onError?.("Choose an image file"); return null; }
    setUploadSlot(slot);
    setProgress(0);
    try {
      const asset = await uploadReferenceAsset(file, setProgress);
      // Switched to Edit (or the slot went) while it uploaded: it's in your uploads, not in the prompt.
      if (!live.current.usableIds.split(" ").includes(slot)) { live.current.onError?.(live.current.blockedMessage); return null; }
      onSelect(slot, asset);
      setFreshSlot(slot);
      // A picture that lands in the stack opens it a moment, so you see where it went.
      window.setTimeout(() => setFreshSlot(""), inputs.find((input) => input.id === slot)?.follows ? 1600 : 700);
      return asset;
    } catch (error) {
      live.current.onError?.(error instanceof Error ? error.message : "Couldn’t upload the image");
      return null;
    } finally {
      setUploadSlot("");
      setProgress(0);
    }
  }, [inputs, onSelect, uploadSlot]);

  /*
   * Drag and drop follows the pointer: over the open popover it offers "add to
   * uploads", over the prompt bar "use as reference", anywhere else nothing.
   * The indicator's spotlight tracks the pointer; a drop lands with a pulse.
   */
  live.current = { upload, targetSlot, openSlot, blockedMessage, usableIds, onError };
  React.useEffect(() => {
    if (!host || !inputs.length) return;
    // Names aren't readable mid-drag, so an untyped file counts until the drop checks it.
    const hasImage = (event: DragEvent) => Array.from(event.dataTransfer?.items || []).some((item) => item.kind === "file" && (!item.type || item.type.startsWith("image/")));
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
      const file = Array.from(event.dataTransfer?.files || []).find(isImageFile);
      if (!file || !target) return;
      event.preventDefault();
      setLanding(true);
      window.setTimeout(() => setLanding(false), 520);
      const { upload: run, targetSlot: slot, openSlot: open, blockedMessage: blocked } = live.current;
      const into = slot();
      if (!into) { live.current.onError?.(blocked); return; }
      run(file, into).then((asset) => {
        if (!asset) return;
        if (target === "popover" && open) setDropped({ asset, nonce: Date.now() });
        else setOpenSlot("");
      });
    };
    const paste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files || []).find(isImageFile);
      if (!file) return;
      event.preventDefault();
      const into = live.current.targetSlot();
      if (!into) { live.current.onError?.(live.current.blockedMessage); return; }
      live.current.upload(file, into);
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
  const openFor = (id: string) => () => { setPainting(false); setOpenSlot((current) => current === id ? "" : id); };
  // Undo puts every picture back where it was: the ones after it closed up into its slot. Only onto
  // what the removal left, though: a picture added since (or another model's slots) would be overwritten.
  const ids = (items: SelectedReferenceAsset[]) => items.map((item) => item.asset.id).join(" ");
  const removeFor = (input: MediaInput) => () => {
    const asset = assetFor(input.id);
    const before = selected.slice();
    const left = ids(before.filter((item) => item.slot !== input.id));
    onRemove(input.id);
    if (asset) showToastTone(t("Removed {0}", { "0": ((input.label || "reference image").toLowerCase()) }), "removed", { action: { label: t("Undo"), onClick: () => {
      if (ids(selectedNow.current) !== left) { showToastTone(t("The references changed since, so there’s nothing to undo"), "default"); return; }
      before.forEach((item) => onSelect(item.slot, item.asset));
    } } });
  };
  const renderSlot = (input: MediaInput, stack: ReferenceStack | null, guide = false) => (
    <ReferenceSlot
      key={input.id}
      input={input}
      selected={assetFor(input.id)}
      open={openSlot === input.id}
      busy={uploadSlot === input.id}
      progress={progress}
      fresh={freshSlot === input.id}
      stack={stack}
      guide={guide}
      // Inpainting changes part of this very image, which is an edit: a Ref only guides a new picture.
      paint={inpaint && inpaint.slot === input.id && assetFor(input.id) ? {
        hidden: role?.slot === input.id && role.value === "reference",
        masked: Boolean(inpaint.mask),
        open: painting,
        intro: introSlot === input.id,
        onOpen: () => { setOpenSlot(""); setIntroSlot(""); rememberInpaintIntro(); setPainting((current) => !current); }
      } : null}
      role={role && role.slot === input.id && assetFor(input.id) ? role : null}
      onOpen={openFor(input.id)}
      onRemove={removeFor(input)}
    />
  );

  return (
    <div className="composer-reference" ref={rootRef}>
      <div className={cn("composer-reference-slots", inline && "is-inline")} ref={slotsRef}>
        {/* No hover to open the strip (a tablet, the full studio on a phone): Edit | Reference in plain
            sight at the row's start. The phone's create sheet has its own row for it, with a line. */}
        {inline && !phone && role ? <RoleSwitch role={role} many={selected.length > 1} className="ref-role-chip" /> : null}
        {chains.flatMap((chain) => {
          const [lead, ...rest] = chain;
          const stacked = !inline && rest.length > 0 && Boolean(assetFor(lead.id));
          const filled = rest.filter((input) => assetFor(input.id));
          const next = rest.find((input) => !assetFor(input.id)) || null;
          const stack: ReferenceStack | null = stacked ? {
            items: filled.map((input) => ({ input, asset: assetFor(input.id)!, open: openSlot === input.id, busy: uploadSlot === input.id, progress, fresh: freshSlot === input.id, onOpen: openFor(input.id), onRemove: removeFor(input) })),
            add: next ? { open: openSlot === next.id, busy: uploadSlot === next.id, progress, onOpen: openFor(next.id) } : null,
            max: chain.length,
            canAdd: !editOnly,
            // Open while one uploads into it too, so its progress shows (it's in the strip).
            intro: rest.some((input) => freshSlot === input.id || uploadSlot === input.id)
          } : null;
          const shown = stacked ? [lead] : chain;
          // In a row, every slot of a full chain is used: a greyed + says how many it takes.
          // Edit folds the row's empty slot and this + away (Fold), rather than dropping them.
          const full = !stacked && rest.length > 0 && chain.every((input) => assetFor(input.id));
          return [
            ...shown.map((input) => input === lead ? renderSlot(input, stack) : <Fold key={input.id} shown={!editOnly || Boolean(assetFor(input.id))}>{renderSlot(input, null, editOnly)}</Fold>),
            ...(full ? [<Fold key={`${lead.id}:full`} shown={!editOnly}><AddMore max={chain.length} add={null} className="ref-chip ref-add" /></Fold>] : [])
          ];
        })}
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
            onDeleted={(asset) => {
              const holding = selected.filter((item) => item.asset.id === asset.id).map((item) => item.slot);
              if (holding.length) onRemove(holding);
            }}
            confirmDelete={confirmDelete}
            onError={onError}
            upload={{ busy: Boolean(uploadSlot), progress, start: (file) => upload(file, openInput.id) }}
          />
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {painting && inpaint && paintedAsset && host ? (
          <InpaintStudio
            key={paintedAsset.id}
            anchor={host}
            asset={paintedAsset}
            mask={inpaint.mask}
            popRef={studioRef}
            onChange={inpaint.onChange}
            onClose={stopPainting}
          />
        ) : null}
      </AnimatePresence>
      <div ref={overlayRef} className={cn("composer-drop", dropTarget === "prompt" && "is-active", landing && "is-landing")} aria-hidden={dropTarget !== "prompt"}>
        <DropBadge text={inputs.length === 1 && inputs[0].role === "start" ? "Drop to start from this image" : inputs.length > 1 ? "Drop to use as a reference" : "Drop to use as reference"} />
      </div>
    </div>
  );
}

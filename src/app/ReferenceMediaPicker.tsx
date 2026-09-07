import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Image as ImageIcon, Images, LoaderCircle, Plus, Trash2, Upload, X } from "lucide-react";
import { cn } from "./format";
import { deleteReferenceAsset, listReferenceAssets, referenceAssetFromGallery, uploadReferenceAsset } from "./api";
import type { MediaInput, ReferenceAsset } from "./types";

type PickerTab = "generation" | "upload";

export type ReferenceMediaPickerProps = {
  open: boolean;
  input: MediaInput;
  selected: ReferenceAsset | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: ReferenceAsset) => void;
  onRemoveSelected?: () => void;
  confirmDelete?: (asset: ReferenceAsset) => Promise<boolean>;
  onError?: (message: string) => void;
};

type PageState = {
  items: ReferenceAsset[];
  cursor: string;
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
  error: string;
};

const emptyPage = (): PageState => ({ items: [], cursor: "", hasMore: false, loading: false, loaded: false, error: "" });

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

export function ReferenceMediaPicker({ open, input, selected, onOpenChange, onSelect, onRemoveSelected, confirmDelete, onError }: ReferenceMediaPickerProps) {
  const [tab, setTab] = React.useState<PickerTab>("generation");
  const [pages, setPages] = React.useState<Record<PickerTab, PageState>>({ generation: emptyPage(), upload: emptyPage() });
  const [uploading, setUploading] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [selectingId, setSelectingId] = React.useState("");
  const [dragging, setDragging] = React.useState(false);
  const uploadInput = React.useRef<HTMLInputElement>(null);

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
    if (!open || pages[tab].loaded || pages[tab].loading) return;
    load(tab);
  }, [load, open, pages, tab]);

  const uploadFile = React.useCallback(async (file: File | undefined) => {
    if (!file || uploading) return;
    if (!file.type.startsWith("image/")) {
      onError?.("Choose an image file");
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    try {
      const asset = await uploadReferenceAsset(file, setUploadProgress);
      setPages((current) => ({ ...current, upload: { ...current.upload, loaded: true, items: [asset, ...current.upload.items] } }));
      onSelect(asset);
      onOpenChange(false);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (uploadInput.current) uploadInput.current.value = "";
    }
  }, [onError, onOpenChange, onSelect, uploading]);

  React.useEffect(() => {
    if (!open) return;
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files || []).find((item) => item.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      uploadFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open, uploadFile]);

  async function choose(asset: ReferenceAsset) {
    if (selectingId || uploading) return;
    setSelectingId(asset.id);
    try {
      const resolved = asset.source === "generation" && asset.galleryItemId
        ? await referenceAssetFromGallery(asset.galleryItemId)
        : asset;
      onSelect(resolved);
      onOpenChange(false);
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
      if (selected?.id === asset.id) onRemoveSelected?.();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Could not delete upload");
    }
  }

  const page = pages[tab];
  const label = input.label || "Reference image";

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!uploading) onOpenChange(next); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim modal-scrim reference-media-overlay" />
        <Dialog.Content
          data-open-surface
          className={cn("reference-media-dialog", dragging && "is-dragging")}
          aria-busy={uploading || selectingId ? "true" : undefined}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
          onDrop={(event) => { event.preventDefault(); setDragging(false); uploadFile(Array.from(event.dataTransfer.files).find((file) => file.type.startsWith("image/"))); }}
        >
          <header className="reference-media-head">
            <div>
              <Dialog.Title>Choose {label.toLowerCase()}</Dialog.Title>
              <Dialog.Description>Select a past generation or upload an image.</Dialog.Description>
            </div>
            <div className="reference-media-head-actions">
              <button className="reference-upload-button" type="button" onClick={() => uploadInput.current?.click()} disabled={uploading}>
                {uploading ? <LoaderCircle className="spin" size={17} /> : <Plus size={18} />}
                <span>{uploading ? `Uploading ${uploadProgress || ""}${uploadProgress ? "%" : ""}` : "Upload"}</span>
              </button>
              <Dialog.Close className="icon-button" aria-label="Close reference picker" disabled={uploading}><X size={16} /></Dialog.Close>
              <input ref={uploadInput} className="reference-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => uploadFile(event.target.files?.[0])} />
            </div>
          </header>
          <div className="reference-media-body">
            <nav className="reference-media-tabs" role="tablist" aria-label="Reference image sources">
              <button id="reference-tab-generation" role="tab" aria-selected={tab === "generation"} aria-controls="reference-panel" className={cn(tab === "generation" && "active")} onClick={() => setTab("generation")}>
                <Images size={18} /><span>Generations</span>
              </button>
              <button id="reference-tab-upload" role="tab" aria-selected={tab === "upload"} aria-controls="reference-panel" className={cn(tab === "upload" && "active")} onClick={() => setTab("upload")}>
                <ImageIcon size={18} /><span>Uploads</span>
              </button>
              <button className="reference-mobile-upload" type="button" onClick={() => uploadInput.current?.click()} disabled={uploading}>
                <Upload size={18} /><span>Upload image</span>
              </button>
            </nav>
            <section id="reference-panel" role="tabpanel" aria-labelledby={`reference-tab-${tab}`} className="reference-media-panel">
              {page.loading && !page.items.length ? (
                <div className="reference-media-grid is-loading" aria-label="Loading images">
                  {Array.from({ length: 10 }, (_, index) => <div className="reference-media-skeleton" key={index} />)}
                </div>
              ) : page.error && !page.items.length ? (
                <div className="reference-media-empty is-error"><ImageIcon size={25} /><h3>Images unavailable</h3><p>{page.error}</p><button onClick={() => load(tab)}>Try again</button></div>
              ) : !page.items.length ? (
                <div className="reference-media-empty"><ImageIcon size={25} /><h3>{tab === "generation" ? "No generations yet" : "No uploads yet"}</h3><p>{tab === "generation" ? "Completed image generations will appear here." : "Drop, paste, or upload an image to get started."}</p>{tab === "upload" ? <button onClick={() => uploadInput.current?.click()}>Upload image</button> : null}</div>
              ) : (
                <>
                  <div className="reference-media-grid" data-reference-grid>
                    {page.items.map((asset, index) => {
                      const isSelected = selected?.id === asset.id;
                      return (
                        <div
                          key={asset.id}
                          className={cn("reference-media-tile", isSelected && "is-selected")}
                        >
                          <button
                            type="button"
                            data-reference-index={index}
                            className="reference-media-tile-select"
                            aria-pressed={isSelected}
                            aria-label={`${isSelected ? "Selected: " : ""}${asset.name}`}
                            onKeyDown={(event) => moveGridFocus(event, index)}
                            onClick={() => choose(asset)}
                            disabled={Boolean(selectingId || uploading)}
                          >
                            <img src={assetImage(asset)} alt="" loading="lazy" draggable={false} />
                            <span className="reference-media-tile-name">{asset.name}</span>
                            {isSelected ? <i className="reference-media-check"><Check size={13} /></i> : null}
                          </button>
                          {asset.source === "upload" ? <button type="button" className="reference-media-delete" aria-label={`Delete ${asset.name}`} onClick={(event) => removeUpload(event, asset)}><Trash2 size={14} /></button> : null}
                          {selectingId === asset.id ? <span className="reference-media-selecting"><LoaderCircle className="spin" size={18} /></span> : null}
                        </div>
                      );
                    })}
                  </div>
                  {page.hasMore ? <button className="reference-media-more" onClick={() => load(tab, page.cursor)} disabled={page.loading}>{page.loading ? "Loading…" : "Load more"}</button> : null}
                </>
              )}
            </section>
          </div>
          {dragging ? <div className="reference-drop-overlay"><Upload size={24} /><strong>Drop image to upload</strong></div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ReferenceMediaControl({ input, selected, onOpen, onRemove }: { input: MediaInput; selected: ReferenceAsset | null; onOpen: () => void; onRemove: () => void }) {
  const required = Boolean(input.required || (input.min || 0) > 0);
  const label = input.label || "Reference image";
  if (!selected) {
    return <button type="button" className={cn("composer-reference-empty", required && "is-required")} onClick={onOpen} aria-label={`Add ${label.toLowerCase()}${required ? ", required" : ""}`}><Plus size={16} /><span>Add reference</span>{required ? <i>Required</i> : null}</button>;
  }
  return (
    <div className="composer-reference-selected">
      <button type="button" className="composer-reference-main" onClick={onOpen} aria-label={`Change ${label.toLowerCase()}, currently ${selected.name}`}>
        {assetImage(selected) ? <img src={assetImage(selected)} alt="" /> : <span className="composer-reference-thumb-placeholder"><ImageIcon size={17} /></span>}
        <span><strong>{selected.name}</strong><small>{selected.source === "generation" ? "Generation" : selected.source === "vault" ? "Private generation" : "Upload"}</small></span>
      </button>
      <button type="button" className="composer-reference-change" onClick={onOpen}>Change</button>
      <button type="button" className="composer-reference-remove" onClick={onRemove} aria-label={`Remove ${label.toLowerCase()}`}><X size={15} /></button>
    </div>
  );
}

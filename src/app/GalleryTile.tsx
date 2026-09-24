import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Download, Eye, EyeOff, Loader2, MoreHorizontal, Square, Trash2 } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from './format';
import { Tip } from './components';
import { GenerationMedia } from './GenerationPreview';
import { ElapsedTime } from './ElapsedTime';
import { FailureTile } from './GenerationFailure';
import type { GalleryItem } from './types';
import { canUpscaleItem, upscaleDisplayUrl } from './useUpscale';
import { UpscaleArrow } from './UpscaleArrow';
import { UpscaleNoticePopover } from './UpscaleNotice';
import { useHiddenActions } from './hiddenContext';
import type { UpscaleNotice } from './useUpscale';
import { useDismiss } from './useDismiss';

type GalleryTileProps = {
  item: GalleryItem;
  width: number;
  height: number;
  formatElapsed: (value: number) => string;
  titleFromPrompt: (value?: string) => string;
  openItem: (item: GalleryItem) => void;
  cancelJob: (jobId?: string) => void;
  copyPromptAndToast: (item: GalleryItem) => void;
  deleteItem: (item: GalleryItem) => void;
  gathering?: boolean;
  gatherIndex?: number;
  smartUpscale?: boolean;
  upscaleBusy?: boolean;
  onUpscale?: (item: GalleryItem) => void;
  onCancelUpscale?: (item: GalleryItem) => void;
  upscaleNotice?: UpscaleNotice;
  onDismissUpscaleNotice?: (id: string) => void;
};

/** Hidden files are served inline; asking for an attachment gets them a real file name. */
export function downloadUrl(item: GalleryItem) {
  const url = upscaleDisplayUrl(item) || "";
  return item.privateVault ? `${url}${url.includes("?") ? "&" : "?"}download=1` : url;
}

function upscaleTooltip(item: GalleryItem) {
  const state = item.upscale;
  if (state?.status === "running") {
    const step = state.progress?.max ? ` · ${state.progress.value}/${state.progress.max}` : "";
    return `Upscaling${step} · click to stop`;
  }
  if (state?.status === "error") return `Upscale failed: ${state.error || "unknown error"}. Click to retry`;
  if (state?.url) return item.upscaleActive ? "Showing the upscale · click for the original" : "Showing the original · click for the upscale";
  return "Smart upscale";
}

function UpscaleButton({ item, busy, onUpscale, onCancelUpscale, held = false }: { item: GalleryItem; busy: boolean; onUpscale: (item: GalleryItem) => void; onCancelUpscale: (item: GalleryItem) => void; held?: boolean }) {
  const state = item.upscale;
  const running = state?.status === "running";
  const ratio = state?.progress?.max ? Math.min(1, Math.max(0, state.progress.value / state.progress.max)) : 0;
  const active = Boolean(item.upscaleActive && state?.url);
  return (
    <Tip content={upscaleTooltip(item)}>
      <button
        type="button"
        className={cn("tile-upscale", active && "is-active", running && "is-running", running && !ratio && "is-indeterminate", busy && "is-busy", held && "is-held")}
        aria-label={upscaleTooltip(item)}
        aria-pressed={state?.url ? active : undefined}
        aria-disabled={busy}
        style={{ "--upscale-ratio": ratio } as React.CSSProperties}
        onClick={() => { if (!busy) (running ? onCancelUpscale(item) : onUpscale(item)); }}
      >
        {busy ? <Loader2 size={14} className="spin" /> : running ? <Square size={10} fill="currentColor" strokeWidth={0} /> : <UpscaleArrow size={15} />}
        {running ? <span className="tile-upscale-ring" /> : null}
      </button>
    </Tip>
  );
}

const numberVariants = {
  initial: { opacity: 0, y: 3 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const } },
  exit: { opacity: 0, y: -3, transition: { duration: 0.1 } },
};

const tileEnterTransition = {
  type: "spring" as const,
  stiffness: 380,
  damping: 32,
  mass: 0.86,
};

function GalleryTileComponent({ cancelJob, copyPromptAndToast, deleteItem, formatElapsed, gatherIndex = 0, gathering = false, height, item, onUpscale, onCancelUpscale = () => {}, openItem, smartUpscale = false, titleFromPrompt, upscaleBusy = false, upscaleNotice, onDismissUpscaleNotice, width }: GalleryTileProps) {
  const ratio = item.progress?.max ? Math.min(1, Math.max(0, item.progress.value / item.progress.max)) : 0;
  const indeterminate = !item.progress?.max;
  const mountedRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();
  const isEntering = !mountedRef.current && (Date.now() - Date.parse(item.createdAt || "")) < 2000;
  useEffect(() => { mountedRef.current = true; }, []);
  const hiddenActions = useHiddenActions();
  const canMove = item.status === "done" && Boolean(item.url) && Boolean(hiddenActions);
  // Phones get one "More" button instead of a row of circles that would not fit.
  const [menuOpen, setMenuOpen] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismiss(overlayRef, menuOpen, closeMenu);
  const act = (run: () => void) => { setMenuOpen(false); run(); };
  return (
    <motion.div
      data-tile-id={item.id}
      className={cn("tile-motion-wrap", gathering && "is-gathering")}
      style={{ width, height, "--gather-delay": `${Math.min(gatherIndex, 6) * 14}ms` } as React.CSSProperties}
      initial={prefersReducedMotion || !isEntering ? false : { opacity: 0, y: -18, scale: 0.965 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        opacity: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
        y: tileEnterTransition,
        scale: tileEnterTransition,
      }}
    >
      <button className={cn("tile", item.status)} style={{ width: "100%", height: "100%" } as React.CSSProperties} onClick={() => item.status !== "pending" && openItem(item)}>
        {item.status === "pending" || item.status === "done" ? (
          <GenerationMedia item={item} muted>
          <div className="generation-progress" style={{ "--progress-ratio": ratio } as React.CSSProperties}>
            <div className="generate-overlay">
              <span className="generate-step">
                {item.progress?.max ? (
                  <>
                    <span className="generate-step-label">Step</span>
                    <span className="generate-step-count">
                      <AnimatePresence mode="wait">
                        <motion.span key={item.progress.value} variants={numberVariants} initial="initial" animate="animate" exit="exit">
                          {item.progress.value}
                        </motion.span>
                      </AnimatePresence>
                      <i>/</i>{item.progress.max}
                    </span>
                  </>
                ) : (
                  <span className="generate-step-label is-queued">Queued</span>
                )}
              </span>
              <span className="generate-elapsed"><ElapsedTime startedAt={item.createdAt} format={formatElapsed} /></span>
            </div>
            <div className={cn("generate-bar", indeterminate && "is-indeterminate")}>
              <div className="generate-bar-fill" />
            </div>
          </div>
          </GenerationMedia>
        ) : item.status === "error" ? <FailureTile item={item} /> : <div className="generating stopped"><span>{titleFromPrompt(item.filename || "Failed")}</span></div>}
        <span className="tile-caption">
          <strong>{titleFromPrompt(item.prompt || item.filename)}</strong>
          <em>{item.status === "pending" ? <ElapsedTime startedAt={item.createdAt} format={formatElapsed} /> : item.status === "error" ? "Failed" : item.durationMs ? formatElapsed(item.durationMs) : item.outputName || item.type}</em>
        </span>
      </button>
      {/* Controls are siblings of the tile's button, never inside it: a button
          inside a button is invalid and unreachable by keyboard. */}
      <div ref={overlayRef} className={cn("tile-overlay", menuOpen && "is-menu-open")}>
        {smartUpscale && onUpscale && canUpscaleItem(item) ? <UpscaleButton item={item} busy={upscaleBusy} onUpscale={onUpscale} onCancelUpscale={onCancelUpscale} held={Boolean(upscaleNotice)} /> : null}
        {upscaleNotice && onDismissUpscaleNotice ? <UpscaleNoticePopover notice={upscaleNotice} placement="tile" onDismiss={() => onDismissUpscaleNotice(item.id)} /> : null}
        {item.status === "pending" ? <Tip content="Stop generation"><button type="button" className="tile-action" onClick={() => cancelJob(item.jobId)}>Stop</button></Tip> : null}
        {item.status !== "pending" ? (
          <>
            <button type="button" className="tile-more" aria-label="More actions" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal size={16} /></button>
            <span className="tile-hover-actions">
              {canMove ? (
                item.privateVault
                  ? <Tip content="Move to gallery" side="left"><button type="button" className="tile-icon tile-hide" aria-label="Move to gallery" onClick={() => act(() => hiddenActions!.unhide([item]))}><Eye size={14} /><span className="tile-menu-label">Move to gallery</span></button></Tip>
                  : <Tip content="Hide" side="left"><button type="button" className="tile-icon tile-hide" aria-label="Hide" onClick={() => act(() => hiddenActions!.hide([item]))}><EyeOff size={14} /><span className="tile-menu-label">Hide</span></button></Tip>
              ) : null}
              {item.url ? <Tip content={item.upscaleActive ? "Download the upscale" : "Download"} side="left"><a className="tile-icon" aria-label="Download" href={downloadUrl(item)} download onClick={() => setMenuOpen(false)}><Download size={13} /><span className="tile-menu-label">Download</span></a></Tip> : null}
              {item.status === "done" ? <Tip content="Copy prompt" side="left"><button type="button" className="tile-icon" aria-label="Copy prompt" onClick={() => act(() => copyPromptAndToast(item))}><Copy size={14} /><span className="tile-menu-label">Copy prompt</span></button></Tip> : null}
              <Tip content={item.privateVault ? "Delete from Hidden" : "Delete from gallery"} side="left"><button type="button" className="tile-delete" aria-label={item.privateVault ? "Delete from Hidden" : "Delete from gallery"} onClick={() => act(() => deleteItem(item))}><Trash2 size={14} /><span className="tile-menu-label">Delete</span></button></Tip>
            </span>
          </>
        ) : null}
      </div>
    </motion.div>
  );
}

export const GalleryTile = React.memo(GalleryTileComponent, (previous, next) => {
  if (previous.item !== next.item) return false;
  if (previous.gathering !== next.gathering) return false;
  if (previous.smartUpscale !== next.smartUpscale) return false;
  if (previous.upscaleBusy !== next.upscaleBusy) return false;
  if (previous.upscaleNotice !== next.upscaleNotice) return false;
  if (previous.width !== next.width || previous.height !== next.height) return false;
  return true;
});

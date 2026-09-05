import React, { useEffect, useRef } from 'react';
import { Copy, Download, LockKeyhole, Trash2 } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from './format';
import { Tip } from './components';
import { GenerationMedia } from './GenerationPreview';
import { ElapsedTime } from './ElapsedTime';
import type { GalleryItem } from './types';

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
};

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

function GalleryTileComponent({ cancelJob, copyPromptAndToast, deleteItem, formatElapsed, gatherIndex = 0, gathering = false, height, item, openItem, titleFromPrompt, width }: GalleryTileProps) {
  const ratio = item.progress?.max ? Math.min(1, Math.max(0, item.progress.value / item.progress.max)) : 0;
  const indeterminate = !item.progress?.max;
  const mountedRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();
  const isEntering = !mountedRef.current && (Date.now() - Date.parse(item.createdAt || "")) < 2000;
  useEffect(() => { mountedRef.current = true; }, []);
  return (
    <motion.div
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
        {!item.vaultLocked && (item.status === "pending" || item.status === "done") ? (
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
        ) : item.vaultLocked ? <div className="generating stopped vault-locked"><LockKeyhole size={22} /><span>Private item</span></div> : <div className="generating stopped"><span>{titleFromPrompt(item.filename || "Failed")}</span></div>}
        <span className="tile-caption">
          <strong>{item.vaultLocked ? "Private item" : titleFromPrompt(item.prompt || item.filename)}</strong>
          <em>{item.vaultLocked ? "Unlock to view" : item.status === "pending" ? <ElapsedTime startedAt={item.createdAt} format={formatElapsed} /> : item.durationMs ? formatElapsed(item.durationMs) : item.outputName || item.type}</em>
        </span>
        {item.status === "pending" ? <Tip content="Cancel generation"><span className="tile-action" onClick={(event) => { event.stopPropagation(); cancelJob(item.jobId); }}>Cancel</span></Tip> : null}
        {item.status !== "pending" && !item.vaultLocked ? (
          <span className="tile-hover-actions" onPointerDown={(event) => event.stopPropagation()}>
            {item.url ? <Tip content="Download" side="left"><a className="tile-icon" aria-label="Download" href={item.url} download onClick={(event) => event.stopPropagation()}><Download size={13} /></a></Tip> : null}
            {item.status === "done" ? <Tip content="Copy prompt" side="left"><span className="tile-icon" role="button" aria-label="Copy prompt" onClick={(event) => { event.stopPropagation(); copyPromptAndToast(item); }}><Copy size={14} /></span></Tip> : null}
            <Tip content="Delete from gallery" side="left"><span className="tile-delete" role="button" aria-label="Delete from gallery" onClick={(event) => { event.stopPropagation(); deleteItem(item); }}><Trash2 size={14} /></span></Tip>
          </span>
        ) : null}
      </button>
    </motion.div>
  );
}

export const GalleryTile = React.memo(GalleryTileComponent, (previous, next) => {
  if (previous.item !== next.item) return false;
  if (previous.gathering !== next.gathering) return false;
  if (previous.width !== next.width || previous.height !== next.height) return false;
  return true;
});

import React from 'react';
import { Download, ImageUp, Layers, LockKeyhole, Minimize2, Ungroup } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from './format';
import { Media, Tip } from './components';
import { AnimatedNumber } from './AnimatedNumber';
import type { GalleryItem } from './types';

type BundleTileProps = {
  item: GalleryItem;
  width: number;
  height: number;
  expanded: boolean;
  onToggle: (bundleId: string) => void;
  onSetCover: (domain: "gallery" | "vault", bundleId: string, itemId: string) => void;
  onUngroup: (domain: "gallery" | "vault", bundleId: string) => void;
  settling?: boolean;
  openItem: (item: GalleryItem) => void;
  titleFromPrompt: (value?: string) => string;
};

export const BUNDLE_SHEET_COLUMNS = 2;
const SHEET_GAP = 6;
const SHEET_PADDING = 8;
const SHEET_HEADER = 40;
/** An 80-image run must not become an 80-image-tall cell: past this the sheet scrolls. */
const SHEET_MAX_ROWS = 5;

/** Kept in step with the rendered layout so the virtualizer estimates well. */
export function bundleSheetHeight(count: number, width: number) {
  const inner = Math.max(80, width - SHEET_PADDING * 2);
  const cell = Math.floor((inner - SHEET_GAP * (BUNDLE_SHEET_COLUMNS - 1)) / BUNDLE_SHEET_COLUMNS);
  const rows = Math.min(SHEET_MAX_ROWS, Math.ceil(Math.max(1, count) / BUNDLE_SHEET_COLUMNS));
  return SHEET_HEADER + SHEET_PADDING * 2 + rows * cell + (rows - 1) * SHEET_GAP;
}

function BundleTileComponent({ expanded, height, item, onSetCover, onToggle, onUngroup, openItem, settling = false, titleFromPrompt, width }: BundleTileProps) {
  const bundle = item.bundle!;
  const reducedMotion = useReducedMotion();
  const title = titleFromPrompt(item.prompt || item.filename);

  return (
    <div
      className={cn("bundle", expanded && "is-open", settling && "is-settling")}
      style={{ width, height } as React.CSSProperties}
      data-bundle={bundle.id}
      /* The frame stays on screen while open, so the run still reads as one thing. */
      aria-label={`${bundle.reasonLabel}, ${bundle.count} outputs`}
    >
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="open"
            className="bundle-open"
            initial={reducedMotion ? false : { opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", duration: 0.28, bounce: 0 }}
          >
            <header className="bundle-open-head">
              <span className="bundle-chip">
                {bundle.domain === "vault" ? <LockKeyhole size={11} /> : <Layers size={11} />}
                {bundle.reasonLabel}
                <i><AnimatedNumber value={bundle.count} /></i>
              </span>
              <span className="bundle-open-actions">
                <Tip content="Ungroup this run - the outputs stay, the stack goes" side="bottom">
                  <button
                    type="button"
                    className="bundle-head-button"
                    aria-label="Ungroup this run"
                    onClick={() => onUngroup(bundle.domain, bundle.id)}
                  >
                    <Ungroup size={13} />
                  </button>
                </Tip>
                <Tip content="Collapse this run" side="left">
                  <button
                    type="button"
                    className="bundle-head-button"
                    aria-label="Collapse this run"
                    onClick={() => onToggle(bundle.id)}
                  >
                    <Minimize2 size={13} />
                  </button>
                </Tip>
              </span>
            </header>
            <div className="bundle-sheet">
              {bundle.items.map((child, index) => (
                <motion.div
                  key={child.id}
                  className={cn("bundle-sheet-cell", child.id === bundle.coverId && "is-cover")}
                  initial={reducedMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index, 8) * 0.018, duration: 0.22, ease: [0.2, 0, 0, 1] }}
                >
                  <button
                    type="button"
                    className="bundle-sheet-open"
                    onClick={() => openItem(child)}
                    aria-label={titleFromPrompt(child.prompt || child.filename)}
                  >
                    <Media item={child} muted />
                  </button>
                  {child.url ? (
                    <Tip content="Download" side="right">
                      <a
                        className="bundle-cell-download"
                        aria-label={`Download ${child.filename || "output"}`}
                        href={child.url}
                        download
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Download size={12} />
                      </a>
                    </Tip>
                  ) : null}
                  {child.id === bundle.coverId ? (
                    <span className="bundle-cover-flag" aria-label="Current cover">Cover</span>
                  ) : (
                    <Tip content="Use as the run's cover" side="left">
                      <button
                        type="button"
                        className="bundle-cover-set"
                        aria-label="Use as the run's cover"
                        onClick={() => onSetCover(bundle.domain, bundle.id, child.id)}
                      >
                        <ImageUp size={12} />
                      </button>
                    </Tip>
                  )}
                </motion.div>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.button
            key="stack"
            type="button"
            className="bundle-stack"
            onClick={() => onToggle(bundle.id)}
            initial={reducedMotion ? false : { opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", duration: 0.28, bounce: 0 }}
          >
            <span className="bundle-stack-card behind-2" aria-hidden="true" />
            <span className="bundle-stack-card behind-1" aria-hidden="true" />
            <span className="bundle-stack-cover">
              <Media item={item} muted />
            </span>
            <span className="bundle-count"><AnimatedNumber value={bundle.count} /></span>
            <span className="bundle-stack-peek" aria-hidden="true">
              {bundle.items.slice(0, 3).map((child) => (
                <span className="bundle-peek-cell" key={`peek-${child.id}`}>
                  <Media item={child} muted />
                </span>
              ))}
            </span>
            <span className="tile-caption bundle-caption">
              <strong>{title}</strong>
              <em><span className="bundle-chip is-inline">{bundle.domain === "vault" ? <LockKeyhole size={10} /> : <Layers size={10} />}{bundle.reasonLabel}</span></em>
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

export const BundleTile = React.memo(BundleTileComponent, (previous, next) =>
  previous.item === next.item
  && previous.expanded === next.expanded
  && previous.settling === next.settling
  && previous.width === next.width
  && previous.height === next.height);

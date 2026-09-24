import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import type { ModelFolders } from './useModelFolders';

// A folder in 7×6 cells, drawn like the dialog's hero, so the two read as one thing.
const GLYPH = [
  '.XXX...',
  'XXXXXXX',
  'XXXXXXX',
  'XXXXXXX',
  'XXXXXXX',
  'XXXXXXX'
];

function FolderGlyph() {
  return (
    <span className="mf-glyph" aria-hidden="true">
      {GLYPH.flatMap((row, y) => row.split('').map((cell, x) => (
        <i key={`${x}-${y}`} className={cell === 'X' ? (y === 0 || y === 1 ? 'is-tab' : 'is-on') : ''} style={{ '--x': x, '--y': y } as React.CSSProperties} />
      )))}
    </span>
  );
}

/**
 * The quiet heads-up in the sidebar: models on this computer that ComfyUI does
 * not read. One tap opens the setup; the × hides it until what it found changes.
 */
export function ModelFoldersNotice({ folders: state }: { folders: ModelFolders }) {
  const reduced = useReducedMotion();
  const folders = state.report?.folders || [];
  const count = folders.reduce((sum, folder) => sum + folder.count, 0);
  const where = folders.length === 1 ? folders[0].name : `${folders.length} folders`;
  return (
    <AnimatePresence initial={false}>
      {state.noticeVisible ? (
        <motion.div
          className="mf-notice-wrap"
          initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
          transition={{ type: 'spring', duration: 0.45, bounce: 0.12 }}
        >
          <div className="mf-notice" role="status">
            <button type="button" className="mf-notice-main" onClick={state.openDialog}>
              <FolderGlyph />
              <span className="mf-notice-text">
                <strong>{count === 1 ? '1 model' : `${count} models`} found</strong>
                <span>In {where}, which ComfyUI doesn’t read.</span>
              </span>
              <span className="mf-notice-cta">Add</span>
            </button>
            <button type="button" className="mf-notice-close" aria-label="Hide this" onClick={state.dismissNotice}><X size={12} /></button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

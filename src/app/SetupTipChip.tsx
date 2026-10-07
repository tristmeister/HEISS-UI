import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Gauge, X } from 'lucide-react';
import { copyText } from './api';
import { CopyIcon, useCopyFeedback } from './CopyFeedback';

export type SetupTip = { id: string; title: string; detail: string; command?: string; commandNote?: string };

/**
 * One note above the prompt bar about the ComfyUI setup (server/setup-tips.js),
 * in the LoRA note's place when that has nothing to say. "How to fix" opens the
 * steps; "Hide" keeps it away until the page reloads, "Don't show again" for good.
 */
export function SetupTipChip({ tip, onHide, onNever }: { tip: SetupTip | null; onHide: (id: string) => void; onNever: (id: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const copy = useCopyFeedback();
  React.useEffect(() => { setOpen(false); }, [tip?.id]);
  return (
    <AnimatePresence>
      {tip ? (
        <motion.div
          key={tip.id}
          className={open ? 'setup-tip is-open' : 'setup-tip'}
          role="status"
          layout
          initial={{ opacity: 0, y: 6, filter: 'blur(2px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: 4, filter: 'blur(2px)' }}
          transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
        >
          <div className="setup-tip-row">
            <Gauge size={13} aria-hidden="true" />
            <span className="setup-tip-title">{tip.title}</span>
            <button type="button" className="lora-mismatch-action" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? 'Less' : 'How to fix'}</button>
            <button type="button" className="lora-mismatch-action is-quiet" onClick={() => onHide(tip.id)}>Hide</button>
            <button type="button" className="lora-mismatch-close" aria-label="Hide" onClick={() => onHide(tip.id)}><X size={12} /></button>
          </div>
          {open ? (
            <div className="setup-tip-body">
              <p>{tip.detail}</p>
              {tip.command ? (
                <div className="setup-tip-command">
                  <code>{tip.command}</code>
                  <button type="button" className="icon-button" aria-label="Copy the command" onClick={() => void copy.copyWith(() => copyText(tip.command || ''))}>
                    <CopyIcon copied={copy.copied === 'copy'} size={13} />
                  </button>
                </div>
              ) : null}
              {tip.commandNote ? <p className="setup-tip-note">{tip.commandNote}</p> : null}
              <button type="button" className="setup-tip-never" onClick={() => onNever(tip.id)}>Don’t show this again</button>
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

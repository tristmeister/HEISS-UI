import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TriangleAlert, X } from 'lucide-react';

export type LoraMismatch = { key: string; names: string[]; madeFor: string[]; model: string };

const shortName = (name: string) => name.split(/[\\/]/).pop()?.replace(/\.(safetensors|pt|ckpt|bin)$/i, "") || name;

/**
 * A small note above the prompt bar when an active LoRA's file clearly says it
 * was made for another model family. Generating still works; "Keep them"
 * hides the note for this exact set until the tab reloads.
 */
export function LoraMismatchChip({ mismatch, onOpenLoras, onDismiss }: { mismatch: LoraMismatch | null; onOpenLoras?: () => void; onDismiss: (key: string) => void }) {
  return (
    <AnimatePresence>
      {mismatch ? (
        <motion.div
          key={mismatch.key}
          className="lora-mismatch"
          role="status"
          initial={{ opacity: 0, y: 6, filter: "blur(2px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: 4, filter: "blur(2px)" }}
          transition={{ type: "spring", duration: 0.3, bounce: 0 }}
        >
          <TriangleAlert size={13} aria-hidden="true" />
          <span>
            {mismatch.names.length === 1
              ? <><b>{shortName(mismatch.names[0])}</b> is made for {mismatch.madeFor[0] || "another model"}, not {mismatch.model}.</>
              : <>{mismatch.names.length} LoRAs are made for other models, not {mismatch.model}.</>}
            {" "}Sure they fit?
          </span>
          {onOpenLoras ? <button type="button" className="lora-mismatch-action" onClick={onOpenLoras}>Check</button> : null}
          <button type="button" className="lora-mismatch-action is-quiet" onClick={() => onDismiss(mismatch.key)}>Keep them</button>
          <button type="button" className="lora-mismatch-close" aria-label="Dismiss" onClick={() => onDismiss(mismatch.key)}><X size={12} /></button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

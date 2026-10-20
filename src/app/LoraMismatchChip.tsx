import { t } from '../i18n/core.js';
import { useLanguage } from '../i18n/react';
import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TriangleAlert, X } from 'lucide-react';

export type LoraMismatch = { key: string; names: string[]; madeFor: string[]; model: string };

const shortName = (name: string) => name.split(/[\\/]/).pop()?.replace(/\.(safetensors|pt|ckpt|bin)$/i, "") || name;

/**
 * Prompt ideas float in the same spot above the composer; publishing the
 * note's height as --lora-note-h on .zen-prompt lets them stack above it.
 */
function useNoteHeightVar() {
  const [node, setNode] = React.useState<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const composer = node?.closest(".zen-prompt") as HTMLElement | null;
    if (!node || !composer) return;
    const publish = () => composer.style.setProperty("--lora-note-h", `${Math.round(node.offsetHeight)}px`);
    publish();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      composer.style.removeProperty("--lora-note-h");
    };
  }, [node]);
  return setNode;
}

/**
 * A small note above the prompt bar when an active LoRA's file clearly says it
 * was made for another model family. Generating still works; "Keep them"
 * hides the note for this exact set until the tab reloads.
 */
export function LoraMismatchChip({ mismatch, onOpenLoras, onDismiss }: { mismatch: LoraMismatch | null; onOpenLoras?: () => void; onDismiss: (key: string) => void }) {
  useLanguage();
  const noteRef = useNoteHeightVar();
  return (
    <AnimatePresence>
      {mismatch ? (
        <motion.div
          key={mismatch.key}
          ref={noteRef}
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
              ? <><b>{shortName(mismatch.names[0])}</b>{t("is made for")}{" "}{mismatch.madeFor[0] || t("another model")}{t(", not")}{" "}{mismatch.model}.</>
              : <>{mismatch.names.length}{t("LoRAs are made for other models, not")}{" "}{mismatch.model}.</>}
            {" "}{t("Sure they fit?")}</span>
          {onOpenLoras ? <button type="button" className="lora-mismatch-action" onClick={onOpenLoras}>{t("Check")}</button> : null}
          <button type="button" className="lora-mismatch-action is-quiet" onClick={() => onDismiss(mismatch.key)}>{t("Keep them")}</button>
          <button type="button" className="lora-mismatch-close" aria-label={t("Dismiss")} onClick={() => onDismiss(mismatch.key)}><X size={12} /></button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

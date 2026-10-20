import { t } from '../i18n/core.js';
import { useLanguage } from '../i18n/react';
import React from 'react';
import { ImagePlus, Layers, Wand2 } from 'lucide-react';
import { Tip } from './components';
import { normalizeLoras } from './loras';
import type { GalleryItem } from './types';

/**
 * The detail panel's actions. One clear move, loading the whole recipe back
 * into the composer, gets the full-width button; the smaller ones share a row
 * under it and only show when they apply: no LoRAs, no LoRA button.
 *
 * Short visible labels keep three to a row in the 380px panel; the hidden
 * words give each button its full name ("Use as reference") for a screen reader.
 */
export function ViewerActions({ item, onUseSettings, onUseLoras, onUseAsReference }: {
  item: GalleryItem;
  onUseSettings: () => void;
  onUseLoras: () => void;
  /** Left out when this output can't be a reference (not an image, locked, from another folder). */
  onUseAsReference?: () => void;
}) {
  useLanguage();
  // An earlier image shown from another folder carries a prompt at most: Copy prompt above covers it.
  const canUse = !(item.library && !item.prompt);
  const loraCount = item.library ? 0 : normalizeLoras(item.settings?.loras).length;
  const hasSecondary = loraCount > 0 || Boolean(onUseAsReference);
  if (!canUse && !hasSecondary) return null;
  return (
    <div className="viewer-actions">
      {canUse ? (
        <Tip content={t("Load its prompt and settings, keeping your seed. You can undo this.")}>
          <button type="button" className="btn is-primary viewer-action-main" onClick={onUseSettings}><Wand2 size={15} />{t("Use these settings")}</button>
        </Tip>
      ) : null}
      {hasSecondary ? (
        <div className="viewer-action-row">
          {loraCount > 0 ? (
            <Tip content={t("Load its {0} into the composer", { "0": (loraCount === 1 ? t("LoRA") : `${loraCount} LoRAs`) })}>
              <button type="button" className="btn viewer-action" onClick={onUseLoras}>
                <Layers size={14} />
                <span className="viewer-action-label"><span className="sr-only">{t("Use its")}{" "}</span>{loraCount === 1 ? t("LoRA") : t("LoRAs")}</span>
                {loraCount > 1 ? <span className="viewer-action-count" aria-hidden="true">{loraCount}</span> : null}
              </button>
            </Tip>
          ) : null}
          {onUseAsReference ? (
            <Tip content={t("Use as the reference image for the next run")}>
              <button type="button" className="btn viewer-action" onClick={onUseAsReference}>
                <ImagePlus size={14} />
                <span className="viewer-action-label"><span className="sr-only">{t("Use as")}{" "}</span>{t("Reference")}</span>
              </button>
            </Tip>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

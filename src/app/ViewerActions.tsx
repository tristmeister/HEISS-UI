import React from 'react';
import { ImagePlus, Layers, Wand2 } from 'lucide-react';
import { Tip } from './components';
import { CopyIcon } from './CopyFeedback';
import { cn } from './format';
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
export function ViewerActions({ item, copied, onUseSettings, onCopySettings, onUseLoras, onUseAsReference }: {
  item: GalleryItem;
  /** The settings were just copied: the copy icon is a check for a moment. */
  copied: boolean;
  onUseSettings: () => void;
  onCopySettings: () => void;
  onUseLoras: () => void;
  /** Left out when this output can't be a reference (not an image, locked, from another folder). */
  onUseAsReference?: () => void;
}) {
  // An earlier image shown from another folder carries a prompt at most: Copy prompt above covers it.
  const canUse = !(item.library && !item.prompt);
  const canCopy = !item.library;
  const loraCount = item.library ? 0 : normalizeLoras(item.settings?.loras).length;
  const hasSecondary = canCopy || loraCount > 0 || Boolean(onUseAsReference);
  if (!canUse && !hasSecondary) return null;
  return (
    <div className="viewer-actions">
      {canUse ? (
        <Tip content="Load its prompt and settings. You can undo this.">
          <button type="button" className="btn is-primary viewer-action-main" onClick={onUseSettings}><Wand2 size={15} /> Use these settings</button>
        </Tip>
      ) : null}
      {hasSecondary ? (
        <div className="viewer-action-row">
          {canCopy ? (
            <Tip content="Copy the prompt, model, steps, seed and size as text">
              <button type="button" className={cn('btn viewer-action', copied && 'is-copied')} onClick={onCopySettings}>
                <CopyIcon copied={copied} size={14} />
                <span className="viewer-action-label">{copied ? 'Copied' : <>Copy<span className="sr-only"> settings</span></>}</span>
              </button>
            </Tip>
          ) : null}
          {loraCount > 0 ? (
            <Tip content={`Load its ${loraCount === 1 ? 'LoRA' : `${loraCount} LoRAs`} into the composer`}>
              <button type="button" className="btn viewer-action" onClick={onUseLoras}>
                <Layers size={14} />
                <span className="viewer-action-label"><span className="sr-only">Use its </span>{loraCount === 1 ? 'LoRA' : 'LoRAs'}</span>
                {loraCount > 1 ? <span className="viewer-action-count" aria-hidden="true">{loraCount}</span> : null}
              </button>
            </Tip>
          ) : null}
          {onUseAsReference ? (
            <Tip content="Use as the reference image for the next run">
              <button type="button" className="btn viewer-action" onClick={onUseAsReference}>
                <ImagePlus size={14} />
                <span className="viewer-action-label"><span className="sr-only">Use as </span>Reference</span>
              </button>
            </Tip>
          ) : null}
        </div>
      ) : null}
      {/* The label flip alone isn't announced; this is. */}
      <span className="sr-only" role="status">{copied ? 'Settings copied' : ''}</span>
    </div>
  );
}

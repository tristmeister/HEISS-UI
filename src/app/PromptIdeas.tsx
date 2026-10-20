import { t } from '../i18n/core.js';
import { useLanguage } from '../i18n/react';
import React from 'react';
import { Dices } from 'lucide-react';
import { Tip } from './components';

/** A chip shows a prompt up to its first comma; the whole prompt goes in when picked. */
const shortLabel = (text: string) => text.split(',')[0].trim();

/**
 * Prompts to start from, floating just above the prompt box while the gallery
 * is still empty and nothing is typed. Picking one fills the prompt; it waits
 * there to be sent or changed.
 */
export function PromptIdeas({ prompts, onPick, onSurprise }: { prompts: string[]; onPick: (text: string) => void; onSurprise?: () => void }) {
  useLanguage();
  if (!prompts.length) return null;
  return (
    <div className="prompt-ideas" role="group" aria-label={t("Prompts to start from")} style={{ '--n': prompts.length } as React.CSSProperties}>
      {prompts.map((text, index) => (
        <Tip key={text} content={t(text)} side="top">
          <button type="button" className="prompt-idea" style={{ '--i': index } as React.CSSProperties} onClick={() => onPick(text)}>
            <span>{shortLabel(t(text))}</span>
          </button>
        </Tip>
      ))}
      {onSurprise ? (
        <Tip content={t("Surprise me")} side="top">
          <button type="button" className="prompt-idea is-surprise" aria-label={t("Surprise me")} style={{ '--i': prompts.length } as React.CSSProperties} onClick={onSurprise}>
            <Dices size={17} aria-hidden="true" />
          </button>
        </Tip>
      ) : null}
    </div>
  );
}

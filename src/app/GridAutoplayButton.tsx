import { t } from '../i18n/core.js';
import { useLanguage } from '../i18n/react';
import React, { useSyncExternalStore } from 'react';
import { Pause, Play } from 'lucide-react';
import { Tip } from './components';
import { gridAutoplayEnabled, subscribeGridAutoplay, toggleGridAutoplay } from './videoPreviewScheduler';

export function GridAutoplayButton({ phone = false }: { phone?: boolean }) {
  useLanguage();
  const enabled = useSyncExternalStore(subscribeGridAutoplay, gridAutoplayEnabled);
  const label = `Grid autoplay: ${enabled ? 'on' : 'off'}`;
  return <Tip content={enabled ? t("Pause grid previews") : t("Play grid previews")}><button type="button" className={`${phone ? 'phone-icon' : 'zen-control-button grid-autoplay-button'}${enabled ? ' is-on' : ''}`}
    aria-label={label} aria-pressed={enabled} onClick={toggleGridAutoplay}>
    {enabled ? <Pause size={phone ? 20 : 16} /> : <Play size={phone ? 20 : 16} />}
  </button></Tip>;
}

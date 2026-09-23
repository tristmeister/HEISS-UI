import React, { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { LockKeyhole, TriangleAlert, X } from 'lucide-react';
import { cn } from './format';
import type { UpscaleNotice } from './useUpscale';

const AUTO_DISMISS_MS = 12000;

/**
 * Says why an image could not be upscaled, right at its upscale button: under
 * it on a gallery tile, above it in the viewer. It stays long enough to read,
 * goes on Escape, an outside click or its close button, and never opens the
 * tile it sits on.
 *
 * Tiles are buttons, so inside one this renders spans with button roles.
 */
export function UpscaleNoticePopover({ notice, onDismiss, placement }: {
  notice: UpscaleNotice;
  onDismiss: () => void;
  placement: 'tile' | 'viewer';
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss.current(), AUTO_DISMISS_MS);
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) dismiss.current();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss.current(); };
    // Next tick, so the click that opened it does not close it.
    const listen = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointer, true);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(listen);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [notice]);

  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  const Icon = notice.reason === 'private' ? LockKeyhole : TriangleAlert;
  const from = placement === 'tile' ? -6 : 6;

  return (
    <motion.span
      ref={ref}
      className={cn('upscale-notice', `is-${placement}`, notice.reason === 'private' && 'is-private')}
      role="alert"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: from, scale: 0.97 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', duration: 0.32, bounce: 0.15 }}
      onClick={stop}
      onPointerDown={stop}
      onKeyDown={stop}
    >
      <span className="upscale-notice-icon" aria-hidden="true"><Icon size={14} /></span>
      <span className="upscale-notice-text">
        <strong>{notice.title}</strong>
        <span>{notice.message}</span>
      </span>
      <span
        className="upscale-notice-close"
        role="button"
        tabIndex={0}
        aria-label="Dismiss"
        onClick={(event) => { event.stopPropagation(); onDismiss(); }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onDismiss(); } }}
      >
        <X size={12} />
      </span>
    </motion.span>
  );
}

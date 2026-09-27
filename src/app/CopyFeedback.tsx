import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Copy } from 'lucide-react';
import { cn } from './format';

/**
 * Copying says so where you clicked: the button's icon turns into a check for
 * a moment (and a labelled button reads "Copied"), instead of a toast across
 * the screen. Only a failed copy is worth a toast.
 *
 * `copied` is the key of whichever button copied last, so one component can
 * give several copy buttons their own check.
 */
export function useCopyFeedback(ms = 1600) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const mark = useCallback((key = 'copy') => {
    window.clearTimeout(timer.current);
    setCopied(key);
    timer.current = window.setTimeout(() => setCopied(null), ms);
  }, [ms]);
  /** Runs a copy and marks `key` when it went through. */
  const copyWith = useCallback(async (copy: () => Promise<boolean>, key = 'copy') => {
    const ok = await copy();
    if (ok) mark(key);
    return ok;
  }, [mark]);
  return { copied, mark, copyWith };
}

/** The copy icon, swapping to a check (and back) with a small spring. */
export function CopyIcon({ copied, size = 14 }: { copied: boolean; size?: number }) {
  const reduced = useReducedMotion();
  return (
    <span className={cn('copy-icon', copied && 'is-copied')} aria-hidden="true">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={copied ? 'check' : 'copy'}
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5, filter: 'blur(2px)' }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5, filter: 'blur(2px)' }}
          transition={{ type: 'spring', duration: 0.3, bounce: 0.3 }}
        >
          {copied ? <Check size={size} /> : <Copy size={size} />}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from './format';

/**
 * Rolls each changed character into place instead of swapping it instantly.
 * Only the digits that actually differ animate, so stepping 9 -> 10 does not
 * re-roll the whole value.
 */
export function AnimatedNumber({ value, className }: { value: string | number; className?: string }) {
  const text = String(value);
  const reduced = useReducedMotion();
  const previousRef = useRef(text);
  const [direction, setDirection] = useState(1);

  useEffect(() => {
    const previous = Number(previousRef.current);
    const next = Number(text);
    if (Number.isFinite(previous) && Number.isFinite(next) && previous !== next) {
      setDirection(next > previous ? 1 : -1);
    }
    previousRef.current = text;
  }, [text]);

  if (reduced) return <span className={cn('animated-number', className)}>{text}</span>;

  const characters = text.split('');
  return (
    <span className={cn('animated-number', className)}>
      <span className="sr-only-value">{text}</span>
      {characters.map((character, index) => (
        <span className="animated-number-slot" key={`slot-${characters.length}-${index}`} aria-hidden="true">
          <AnimatePresence initial={false}>
            <motion.span
              key={`${index}-${character}`}
              className="animated-number-char"
              initial={{ y: `${direction * 90}%`, opacity: 0, filter: 'blur(3px)' }}
              animate={{ y: '0%', opacity: 1, filter: 'blur(0px)' }}
              exit={{ y: `${direction * -90}%`, opacity: 0, filter: 'blur(3px)' }}
              transition={{ type: 'spring', duration: 0.32, bounce: 0 }}
            >
              {character}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}

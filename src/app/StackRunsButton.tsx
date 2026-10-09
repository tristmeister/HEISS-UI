import React from 'react';
import { motion } from 'framer-motion';
import { Tip } from './components';

/**
 * The switch that folds runs into stacks. Its icon is the grid itself: three
 * tiles laid out as masonry while runs are spread, gathered into one card with
 * two edges behind it while they are stacked, moving between the two.
 */
export function StackRunsButton({ on, onToggle, disabled = false, phone = false }: { on: boolean; onToggle: () => void; disabled?: boolean; phone?: boolean }) {
  const size = phone ? 22 : 18;
  const spring = { type: "spring" as const, stiffness: 520, damping: 34 };
  const rects = on
    ? [{ x: 6.5, y: 2.25, width: 7, height: 0.01 }, { x: 4.5, y: 4.75, width: 11, height: 0.01 }, { x: 2.5, y: 7.5, width: 15, height: 10 }]
    : [{ x: 2.5, y: 2.5, width: 6.5, height: 15 }, { x: 11, y: 2.5, width: 6.5, height: 6.5 }, { x: 11, y: 11, width: 6.5, height: 6.5 }];
  const label = disabled ? "Auto-grouping is paused in search results" : on ? "Turn off auto-grouping" : "Turn on auto-grouping";
  return (
    <Tip content={label}>
      <button
        type="button"
        className={`${phone ? "phone-icon" : "zen-control-button stack-runs-button"}${on ? " is-on" : ""}`}
        aria-label="Auto-grouping"
        aria-pressed={on}
        disabled={disabled}
        onClick={onToggle}
      >
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {rects.map((rect, index) => (
            // Height eases instead of springing: a spring overshoots the
            // collapsed edges' 0.01 into a negative height, which Chrome and
            // Firefox reject with a console error every frame.
            <motion.rect key={index} rx={2} initial={false} animate={rect} transition={{ ...spring, delay: on ? (2 - index) * 0.03 : index * 0.03, height: { type: "tween", duration: 0.24, ease: [0.22, 1, 0.36, 1], delay: on ? (2 - index) * 0.03 : index * 0.03 } }} />
          ))}
        </svg>
      </button>
    </Tip>
  );
}

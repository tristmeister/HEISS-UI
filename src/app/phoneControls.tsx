import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './format';

/* Small building blocks for the phone studio, sized for a thumb. */

type Option = string | { label: string; value: string };
const optionValue = (option: Option) => (typeof option === 'string' ? option : option.value);
const optionLabel = (option: Option) => (typeof option === 'string' ? option : option.label);

/**
 * A row that opens the phone's own picker (the iOS wheel, Android's list):
 * a real <select> laid over the row, invisible, so the tap is native.
 */
export function PhoneSelect({ label, value, options, onChange, icon }: { label: string; value: string; options: Option[]; onChange: (value: string) => void; icon?: React.ReactNode }) {
  const current = options.find((option) => optionValue(option) === value);
  return (
    <label className="phone-row phone-select">
      {icon}
      <span>{label}<small>{current ? optionLabel(current) : value || 'Not set'}</small></span>
      <ChevronDown size={18} className="phone-row-end" aria-hidden="true" />
      <select value={value} aria-label={label} onChange={(event) => { haptic('tap'); onChange(event.target.value); }}>
        {current || !value ? null : <option value={value}>{value}</option>}
        {options.map((option) => <option key={optionValue(option)} value={optionValue(option)}>{optionLabel(option)}</option>)}
      </select>
    </label>
  );
}

/** A labelled slider with a thumb-sized knob and the value on the right. */
export function PhoneSlider({ label, value, min, max, step = 1, onChange, format, hint, className }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('phone-control', className)}>
      <span className="phone-control-label">{label} <b>{format ? format(value) : value}</b></span>
      <input className="phone-slider" type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(event) => onChange(Number(event.target.value))} />
      {hint ? <span className="phone-control-hint">{hint}</span> : null}
    </div>
  );
}

/**
 * Haptic feedback where the phone allows it. Android's browsers vibrate, so
 * haptic() does it from the handler. iPhones have no vibrate API and, since
 * iOS 26.5, no script-triggered tick either: only a real tap that toggles a
 * switch checkbox ticks. So on iPhones, buttons that should tick carry a
 * <HapticTarget />, one light tick whatever the kind; haptics without a tap
 * behind them (long press, an image landing) stay silent there.
 */
const patterns = {
  tap: 8,
  press: 16,
  success: [12, 60, 18],
  warning: [28, 40, 28]
} as const;

export function haptic(kind: keyof typeof patterns) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try { navigator.vibrate(patterns[kind] as number | number[]); } catch { /* not allowed right now */ }
}

const switchHaptics = typeof window !== 'undefined'
  && typeof navigator.vibrate !== 'function'
  && /iPhone|iPod/.test(navigator.userAgent)
  && window.matchMedia('(pointer: coarse)').matches;

/**
 * A see-through label over its button (the button's last child) with a hidden
 * switch inside. The tap lands on the label, which iOS turns into a trusted
 * click on the switch: that ticks. The label's own click still reaches the
 * button's onClick; the switch's forwarded one is stopped so it does not run
 * twice. A label has no touch handling of its own, so scrolling still works.
 */
export function HapticTarget() {
  if (!switchHaptics) return null;
  return (
    <label className="haptic-target" aria-hidden="true">
      <input type="checkbox" tabIndex={-1} ref={(input) => { input?.setAttribute('switch', ''); }} onClick={(event) => event.stopPropagation()} />
    </label>
  );
}

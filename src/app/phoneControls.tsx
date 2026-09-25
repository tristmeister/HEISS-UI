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
 * Haptic feedback where the phone allows it. Android's browsers vibrate.
 * iPhones have no vibrate API, but Safari (iOS 18+) ticks when a switch
 * checkbox is toggled, so there we click a hidden one: a single light tick
 * whatever the kind, and only from inside a tap handler.
 */
const patterns = {
  tap: 8,
  press: 16,
  success: [12, 60, 18],
  warning: [28, 40, 28]
} as const;

let iosSwitch: HTMLLabelElement | null = null;

function iosTick() {
  if (!iosSwitch) {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

export function haptic(kind: keyof typeof patterns) {
  if (typeof navigator === 'undefined') return;
  try {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(patterns[kind] as number | number[]);
    else if (typeof document !== 'undefined' && matchMedia('(pointer: coarse)').matches) iosTick();
  } catch { /* not allowed right now */ }
}

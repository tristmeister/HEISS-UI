import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './format';

/**
 * A settings row that opens onto more rows below it, for things most people
 * never need to see (every shortcut, HTTPS). Closed until asked for, unless
 * `defaultOpen` says it has something to show.
 */
export function SettingsDrawer({ id, title, description, defaultOpen = false, children }: React.PropsWithChildren<{ id: string; title: React.ReactNode; description?: React.ReactNode; defaultOpen?: boolean }>) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className={cn('set-drawer', open && 'is-open')}>
      <button type="button" className="set-row set-drawer-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <span className="set-row-text">
          <strong>{title}</strong>
          {description ? <span>{description}</span> : null}
        </span>
        <span className="set-drawer-knob" aria-hidden="true"><ChevronDown size={14} className="set-drawer-chevron" /></span>
      </button>
      <div className="set-drawer-body" id={id} inert={!open}>
        <div className="set-drawer-inner">{children}</div>
      </div>
    </div>
  );
}

/**
 * A quiet text toggle that folds away whole groups: the rarely needed ones at
 * the bottom of a page. Collapsed, it costs one thin line.
 */
export function SettingsFold({ title, description, children }: React.PropsWithChildren<{ title: React.ReactNode; description?: React.ReactNode }>) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  return (
    <div className={cn('set-fold', open && 'is-open')}>
      <button type="button" className="set-fold-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <ChevronDown size={14} className="set-drawer-chevron" aria-hidden="true" />
        <strong>{title}</strong>
        {description ? <span>{description}</span> : null}
      </button>
      <div className="set-drawer-body" id={id} inert={!open}>
        <div className="set-drawer-inner set-fold-inner">{children}</div>
      </div>
    </div>
  );
}

/**
 * One feature on Settings › Features, as its own card: what it is and where it
 * stands on one line, its on/off switch beside that, and everything that
 * belongs to it (quality, setup, how to use it) folded underneath.
 */
export function FeatureDrawer({ id, icon: Icon, title, tag, summary, status, enabled, onEnabledChange, disabled, defaultOpen = false, children }: React.PropsWithChildren<{
  id: string;
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  tag?: React.ReactNode;
  /** One line under the title: what it does, or what it still needs. */
  summary: React.ReactNode;
  status?: React.ReactNode;
  enabled?: boolean;
  onEnabledChange?: (next: boolean) => void;
  disabled?: boolean;
  defaultOpen?: boolean;
}>) {
  const [open, setOpen] = React.useState(defaultOpen);
  const bodyId = `${id}-body`;
  const hasSwitch = typeof enabled === 'boolean' && onEnabledChange;
  return (
    <section className={cn('set-feature', open && 'is-open', hasSwitch && 'has-switch', enabled === false && 'is-off')} aria-labelledby={`${id}-title`}>
      <div className="set-feature-head">
        <button type="button" className="set-feature-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((value) => !value)}>
          <span className="set-feature-icon" aria-hidden="true"><Icon size={15} /></span>
          <span className="set-feature-text">
            <strong id={`${id}-title`}>{title}{tag}</strong>
            <span>{summary}</span>
          </span>
          {status ? <span className="set-feature-status">{status}</span> : null}
          <span className="set-drawer-knob" aria-hidden="true"><ChevronDown size={14} className="set-drawer-chevron" /></span>
        </button>
        {hasSwitch ? (
          <span className="set-feature-switch">
            <button type="button" role="switch" aria-checked={enabled} aria-label={title} disabled={disabled} className="switch" onClick={() => onEnabledChange(!enabled)}>
              <span className="switch-thumb" />
            </button>
          </span>
        ) : null}
      </div>
      <div className="set-drawer-body" id={bodyId} inert={!open}>
        <div className="set-drawer-inner">{children}</div>
      </div>
    </section>
  );
}

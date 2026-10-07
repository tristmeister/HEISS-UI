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
  // What's inside (a demo, a form) mounts the first time it opens, not with the page.
  const [seen, setSeen] = React.useState(defaultOpen);
  React.useEffect(() => { if (open) setSeen(true); }, [open]);
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
        <div className="set-drawer-inner">{seen || open ? children : null}</div>
      </div>
    </div>
  );
}

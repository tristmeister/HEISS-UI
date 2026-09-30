import React from 'react';
import { AlertTriangle, Bug, ChevronDown, ChevronRight, Download, LifeBuoy, Minimize2, RefreshCw, RotateCcw, RotateCw } from 'lucide-react';
import { CopyIcon, useCopyFeedback } from './CopyFeedback';
import { knownDiagnostics, loadDiagnostics, troubleshootingUrl, withDiagnostics } from './diagnostics';
import { openFeedback } from './feedback';
import { NodeInstall } from './NodeInstall';
import { useThisComputer } from './device';
import { cn } from './format';
import type { RetryOptions } from './retry';
import type { ShowToast } from './toast';
import type { GalleryItem, GenerationFailure } from './types';

/** The failure a gallery item carries; older items only kept the message in their name. */
export function failureOf(item: GalleryItem): GenerationFailure {
  if (item.failure) return item.failure;
  const text = String(item.filename || '').trim();
  return { title: 'Generation failed', summary: text || 'ComfyUI didn’t say why.', detail: text };
}

function reportFor(item: GalleryItem, failure: GenerationFailure) {
  return [
    `HEISS UI generation failed: ${failure.title}`,
    failure.summary,
    failure.file ? `File: ${failure.file}` : '',
    failure.nodeType ? `Node: ${failure.nodeType}${failure.nodeId ? ` (#${failure.nodeId})` : ''}` : '',
    failure.exceptionType ? `Exception: ${failure.exceptionType}` : '',
    failure.missingNode ? `Missing node: ${failure.missingNode}` : '',
    item.model ? `Model: ${item.model}` : '',
    item.width && item.height ? `Size: ${item.width}×${item.height}` : '',
    '',
    failure.detail && failure.detail !== failure.summary ? failure.detail : '',
    failure.traceback ? `\nTraceback:\n${failure.traceback}` : ''
  ].filter((line, index, all) => line || all[index - 1]).join('\n').trim();
}

/** What a failed tile shows: calm, readable, never a cut-off line of Python. */
export function FailureTile({ item }: { item: GalleryItem }) {
  const failure = failureOf(item);
  return (
    <div className="failure-tile">
      <div className="failure-tile-body">
        <div className="failure-icon" aria-hidden="true"><AlertTriangle size={17} strokeWidth={2} /></div>
        <strong>{failure.title}</strong>
        <p>{failure.summary}</p>
        {/* The whole tile opens the viewer; say so, since the fix lives there. */}
        <div className="failure-more">{failure.hint ? 'How to fix' : 'Show details'}<ChevronRight size={12} strokeWidth={2.25} /></div>
      </div>
    </div>
  );
}

/** What the viewer can do about a failure, wired to the studio's own actions. */
export type FailureFixes = {
  retry: (item: GalleryItem, options?: RetryOptions) => Promise<void>;
  freeMemoryAndRetry: (item: GalleryItem) => Promise<void>;
  redownload: (item: GalleryItem) => Promise<void>;
  rescan: () => void;
};

type FixButton = { label: string; icon: React.ReactNode; run: () => unknown };

/**
 * The buttons a failure earns: only fixes HEISS can actually carry out, the
 * likeliest first. Freeing ComfyUI's memory and downloading are for the
 * computer itself (`admin`); another device gets what it may run.
 */
function fixButtons(item: GalleryItem, failure: GenerationFailure, fixes: FailureFixes | undefined, admin: boolean): FixButton[] {
  if (!fixes) return [];
  // An item from before fixes existed (or a Hidden one still locked) has nothing to rerun from.
  const canRerun = Boolean(item.prompt && item.model && item.settings);
  if (failure.fix === 'memory' && canRerun) {
    return [
      ...(admin ? [{ label: failure.retry?.tiledDecode ? 'Free memory, decode in tiles' : 'Free memory and try again', icon: <RotateCw size={14} />, run: () => fixes.freeMemoryAndRetry(item) }] : []),
      { label: 'Try again smaller', icon: <Minimize2 size={14} />, run: () => fixes.retry(item, { smaller: true }) }
    ];
  }
  if (failure.fix === 'redownload' && failure.redownload && admin) return [{ label: 'Download again', icon: <Download size={14} />, run: () => fixes.redownload(item) }];
  if (failure.fix === 'rescan') return [{ label: 'Rescan models', icon: <RefreshCw size={14} />, run: fixes.rescan }];
  if (failure.fix === 'retry' && canRerun) return [{ label: 'Try again', icon: <RotateCw size={14} />, run: () => fixes.retry(item) }];
  return [];
}

/** The viewer's side of a failure: what went wrong, what to do, and the whole error one click away. */
export function FailurePanel({ item, onCopy, onReuse, fixes, showToast, onNodesInstalled }: {
  item: GalleryItem;
  onCopy: (text: string) => Promise<boolean>;
  onReuse?: () => void;
  fixes?: FailureFixes;
  showToast?: ShowToast;
  /** After a missing node pack is installed and ComfyUI restarted. */
  onNodesInstalled?: () => void;
}) {
  const { copied, copyWith } = useCopyFeedback();
  const failure = failureOf(item);
  const raw = [failure.detail !== failure.summary ? failure.detail : '', failure.traceback].filter(Boolean).join('\n\n');
  const hasDetail = Boolean(raw || failure.nodeType || failure.exceptionType);
  const [open, setOpen] = React.useState(false);
  // The report carries the setup (versions, system, GPU); fetched now so the copy needs no wait.
  React.useEffect(() => { void loadDiagnostics(); }, []);
  const copyReport = async () => onCopy(withDiagnostics(reportFor(item, failure), knownDiagnostics() || await loadDiagnostics()));
  const [busy, setBusy] = React.useState(false);
  const admin = useThisComputer();
  const buttons = fixButtons(item, failure, fixes, admin);
  const run = async (action: () => unknown) => {
    setBusy(true);
    try { await action(); } finally { setBusy(false); }
  };
  return (
    <div className="failure-panel" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
      <div className="failure-icon is-large" aria-hidden="true"><AlertTriangle size={22} strokeWidth={2} /></div>
      <h3>{failure.title}</h3>
      <p className="failure-summary">{failure.summary}</p>
      {failure.hint ? <p className="failure-hint">{failure.hint}</p> : null}
      {failure.nodePack && showToast ? (
        <div className="failure-install">
          <NodeInstall pack={failure.nodePack} plan={failure.install} autoInstall={failure.autoInstall} showToast={showToast} onRestarted={() => onNodesInstalled?.()} afterRestart="Then run it again." />
        </div>
      ) : null}
      {buttons.length ? (
        <div className="failure-actions">
          {buttons.map((button, index) => (
            <button key={button.label} type="button" className={cn('btn', index === 0 && 'is-primary')} disabled={busy} onClick={() => run(button.run)}>{button.icon} {button.label}</button>
          ))}
        </div>
      ) : null}
      <div className={cn('failure-actions', buttons.length > 0 && 'is-secondary')}>
        {onReuse ? <button type="button" className={cn('btn', !buttons.length && 'is-primary', buttons.length > 0 && 'is-ghost')} onClick={onReuse}><RotateCcw size={14} /> Use these settings</button> : null}
        <button type="button" className={cn('btn', buttons.length > 0 && 'is-ghost')} onClick={() => copyWith(copyReport)}><CopyIcon copied={Boolean(copied)} /> {copied ? 'Copied' : 'Copy report'}</button>
        {/* Straight to the feedback board, filled in; the setup lines are added (and shown) in the dialog. */}
        <button type="button" className="btn is-ghost" onClick={() => openFeedback({ kind: 'bug', title: `Generation failed: ${failure.title}`, body: reportFor(item, failure).split('\n').slice(1).join('\n').trim(), withSetup: true, from: 'failure' })}><Bug size={14} /> Report bug</button>
        <a className="btn is-ghost" href={troubleshootingUrl(failure.help)} target="_blank" rel="noreferrer"><LifeBuoy size={14} /> Troubleshooting</a>
      </div>
      {hasDetail ? (
        <div className={cn('failure-detail', open && 'is-open')}>
          <button type="button" className="failure-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {open ? 'Hide details' : 'Show details'} <ChevronDown size={13} />
          </button>
          {open ? (
            <div className="failure-detail-body">
              {failure.nodeType || failure.exceptionType || failure.file ? (
                <dl className="failure-facts">
                  {failure.file ? <><dt>File</dt><dd><code>{failure.file}</code></dd></> : null}
                  {failure.nodeType ? <><dt>Node</dt><dd><code>{failure.nodeType}</code>{failure.nodeId ? <em> #{failure.nodeId}</em> : null}</dd></> : null}
                  {failure.exceptionType ? <><dt>Error</dt><dd><code>{failure.exceptionType}</code></dd></> : null}
                </dl>
              ) : null}
              {raw ? <pre>{raw}</pre> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

import React from 'react';
import { AlertTriangle, ChevronDown, Copy, RotateCcw } from 'lucide-react';
import { cn } from './format';
import type { GalleryItem, GenerationFailure } from './types';

/** The failure a gallery item carries; older items only kept the message in their name. */
export function failureOf(item: GalleryItem): GenerationFailure {
  if (item.failure) return item.failure;
  const text = String(item.filename || '').trim();
  return { title: 'Generation failed', summary: text || 'ComfyUI did not say why.', detail: text };
}

function reportFor(item: GalleryItem, failure: GenerationFailure) {
  return [
    `HEISS UI generation failed: ${failure.title}`,
    failure.summary,
    failure.nodeType ? `Node: ${failure.nodeType}${failure.nodeId ? ` (#${failure.nodeId})` : ''}` : '',
    failure.exceptionType ? `Exception: ${failure.exceptionType}` : '',
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
      <span className="failure-icon" aria-hidden="true"><AlertTriangle size={15} /></span>
      <strong>{failure.title}</strong>
      <p>{failure.summary}</p>
      {failure.nodeType ? <code className="failure-node">{failure.nodeType}</code> : null}
    </div>
  );
}

/** The viewer's side of a failure: the hint, the node, and the whole error one click away. */
export function FailurePanel({ item, onCopy, onReuse }: { item: GalleryItem; onCopy: (text: string, message?: string) => void; onReuse?: () => void }) {
  const failure = failureOf(item);
  const hasDetail = Boolean(failure.traceback || (failure.detail && failure.detail !== failure.summary));
  const [open, setOpen] = React.useState(false);
  return (
    <div className="failure-panel" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
      <span className="failure-icon is-large" aria-hidden="true"><AlertTriangle size={20} /></span>
      <h3>{failure.title}</h3>
      <p className="failure-summary">{failure.summary}</p>
      {failure.hint ? <p className="failure-hint">{failure.hint}</p> : null}
      {failure.nodeType || failure.exceptionType ? (
        <div className="failure-facts">
          {failure.nodeType ? <span>In <code>{failure.nodeType}</code>{failure.nodeId ? <em> #{failure.nodeId}</em> : null}</span> : null}
          {failure.exceptionType ? <span><code>{failure.exceptionType}</code></span> : null}
        </div>
      ) : null}
      <div className="failure-actions">
        {onReuse ? <button type="button" className="btn" onClick={onReuse}><RotateCcw size={14} /> Use these settings</button> : null}
        <button type="button" className="btn is-ghost" onClick={() => onCopy(reportFor(item, failure), 'Error report copied')}><Copy size={14} /> Copy report</button>
      </div>
      {hasDetail ? (
        <div className={cn('failure-detail', open && 'is-open')}>
          <button type="button" className="failure-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            <ChevronDown size={14} /> {open ? 'Hide' : 'Show'} the full error
          </button>
          {open ? <pre>{[failure.detail, failure.traceback].filter(Boolean).join('\n\n')}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}

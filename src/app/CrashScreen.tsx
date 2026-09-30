import React from 'react';
import { Bug, RotateCw } from 'lucide-react';
import { CopyIcon, useCopyFeedback } from './CopyFeedback';
import { FeedbackHost } from './FeedbackDialog';
import { openFeedback } from './feedback';
import { copyText } from './api';

/** The error as a report: message, then the top of the stack, without this page's address. */
function crashReport(error: Error, componentStack = '') {
  const strip = (text: string) => text.split(location.origin).join('');
  const stack = strip(error.stack || '').split('\n').slice(0, 14).join('\n');
  const components = strip(componentStack).trim().split('\n').slice(0, 8).map((line) => line.trim()).join('\n');
  return [`${error.name}: ${error.message}`, stack && stack !== `${error.name}: ${error.message}` ? `\n${stack}` : '', components ? `\nIn:\n${components}` : '', `\nPage: ${location.pathname}`].join('\n').trim();
}

function CrashScreen({ error, componentStack }: { error: Error; componentStack: string }) {
  const { copied, copyWith } = useCopyFeedback();
  const report = crashReport(error, componentStack);
  return (
    <main className="crash">
      <div className="crash-card" role="alert">
        <span className="crash-mark" aria-hidden="true"><i /><i /><i /><i /></span>
        <h1>Something broke</h1>
        <p>The studio hit an error it couldn’t recover from. Your images are safe in ComfyUI’s output folder, and anything still rendering keeps going.</p>
        <pre>{error.message || String(error)}</pre>
        <div className="crash-actions">
          <button type="button" className="btn is-primary" onClick={() => location.reload()}><RotateCw size={14} /> Reload</button>
          <button type="button" className="btn" onClick={() => openFeedback({ kind: 'bug', title: `Studio crashed: ${(error.message || error.name).slice(0, 90)}`, body: report, withSetup: true, from: 'crash' })}><Bug size={14} /> Report this bug</button>
          <button type="button" className="btn is-ghost" onClick={() => copyWith(() => copyText(report))}><CopyIcon copied={Boolean(copied)} /> {copied ? 'Copied' : 'Copy details'}</button>
        </div>
      </div>
      <FeedbackHost />
    </main>
  );
}

/** Catches a render error anywhere below it and shows the crash screen instead of a blank page. */
export class CrashBoundary extends React.Component<React.PropsWithChildren, { error: Error | null; componentStack: string }> {
  state = { error: null as Error | null, componentStack: '' };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(_error: unknown, info: React.ErrorInfo) {
    this.setState({ componentStack: info.componentStack || '' });
  }

  render() {
    return this.state.error ? <CrashScreen error={this.state.error} componentStack={this.state.componentStack} /> : this.props.children;
  }
}

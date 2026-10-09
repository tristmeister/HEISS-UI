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


type Culprit = { id: string; title: string; hint: string };

/** Errors React throws when something other than React changed the page's elements under it. */
const DOM_TAMPERING = /removeChild|insertBefore|not a child of this node|Failed to execute '(?:appendChild|replaceChild)'/i;

/** What the page itself shows about who else is editing it: translation, injected elements, extension attributes. */
function findCulprits(error: Error): Culprit[] {
  if (!DOM_TAMPERING.test(`${error.name} ${error.message}`)) return [];
  const root = document.documentElement;
  const found: Culprit[] = [];
  const translated = /\btranslated-(ltr|rtl)\b/.test(root.className) || root.lang !== 'en' || document.querySelector('font[style*="vertical-align"], .goog-te-banner-frame, #google_translate_element, [class*="skiptranslate"]') !== null;
  if (translated) found.push({ id: 'translate', title: 'Page translation', hint: 'Chrome or Edge is translating this page and rewrote its text. Turn translation off for this address: the translate icon in the address bar, then “Never translate this site”.' });
  const injected = [...document.querySelectorAll('body > *, #root *')].filter((el) => /^(grammarly|lastpass|bitwarden|deepl|loom|honey|kaspersky|dark-?reader|immersive|nord)/i.test(el.tagName) || /grammarly|lastpass|bitwarden|1password|dashlane|deepl|darkreader|kaspersky|immersive-translate/i.test(`${el.id} ${el.className && typeof el.className === 'string' ? el.className : ''}`)).length > 0
    || [...root.attributes, ...document.body.attributes].some((a) => /^(data-(gr-|new-gr-|darkreader|lastpass|bitwarden|dashlane|immersive|kaspersky)|cz-shortcut|data-gptw|data-lt-installed)/i.test(a.name));
  if (injected) found.push({ id: 'extension', title: 'A browser extension', hint: 'An extension added to or restyled this page. Grammarly, dark-mode, password-manager, translator and ad-block extensions do this. Pause them for this site, or open the studio in a private window.' });
  if (!found.length) found.push({ id: 'unknown', title: 'Translation or an extension', hint: 'This error usually means the browser or an extension edited the page while the studio was running. Turn off page translation and pause extensions for this site, then reload. If it still happens, report it.' });
  return found;
}

function CrashScreen({ error, componentStack }: { error: Error; componentStack: string }) {
  const { copied, copyWith } = useCopyFeedback();
  const culprits = findCulprits(error);
  const report = [crashReport(error, componentStack), culprits.length ? `\nLikely cause: ${culprits.map((c) => c.id).join(', ')}` : ''].join('').trim();
  return (
    <main className="crash">
      <div className="crash-card" role="alert">
        <span className="crash-mark" aria-hidden="true"><i /><i /><i /><i /></span>
        <h1>Something broke</h1>
        <p>The studio hit an error it couldn’t recover from. Your images are safe in ComfyUI’s output folder, and anything still rendering keeps going.</p>
        <pre>{error.message || String(error)}</pre>
        {culprits.length ? (
          <div className="crash-culprits">
            <h2>This looks like something outside the studio</h2>
            <ul>
              {culprits.map((c) => <li key={c.id}><strong>{c.title}.</strong> {c.hint}</li>)}
            </ul>
            <p>Try those, then reload. If it keeps happening, report it.</p>
          </div>
        ) : null}
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

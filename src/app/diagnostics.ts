import { apiJson } from './api';
import { githubUrl } from './constants';

/**
 * The setup lines a bug report needs (HEISS UI, Node.js, system, ComfyUI,
 * GPU), from /api/diagnostics. Fetched ahead of a copy and kept for a minute,
 * so the copy itself runs straight from the click (Safari refuses a clipboard
 * write that waited on the network).
 */
let cached: { text: string; at: number } | null = null;
let loading: Promise<string> | null = null;
const freshMs = 60_000;

export function loadDiagnostics(): Promise<string> {
  if (cached && Date.now() - cached.at < freshMs) return Promise.resolve(cached.text);
  loading ??= apiJson<{ text?: string }>('/api/diagnostics')
    .then((data) => {
      const text = String(data.text || '');
      cached = { text, at: Date.now() };
      return text;
    })
    .catch(() => '')
    .finally(() => { loading = null; });
  return loading;
}

/** What is already known, without waiting: '' until loadDiagnostics has answered once. */
export function knownDiagnostics() {
  return cached?.text || '';
}

/** A report with the setup appended, under its own heading. */
export function withDiagnostics(report: string, diagnostics: string) {
  return diagnostics ? `${report}\n\nSetup:\n${diagnostics}` : report;
}

/** TROUBLESHOOTING.md on GitHub, at a failure's section when it names one. */
export function troubleshootingUrl(anchor = '') {
  return `${githubUrl}/blob/main/docs/guides/TROUBLESHOOTING.md${anchor ? `#${anchor}` : ''}`;
}

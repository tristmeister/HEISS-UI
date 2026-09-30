/**
 * The feedback board on heiss-ui.vercel.app, seen from the app: open the send
 * dialog from anywhere (Settings, a failed image, the crash screen), post to
 * the board, or fall back to the board's own form with the fields filled in.
 *
 * Nothing leaves the computer until someone presses Send in that dialog, and
 * the dialog shows everything that goes with it.
 */

export const boardUrl = 'https://heiss-ui.vercel.app/board/';
const boardApi = 'https://heiss-ui.vercel.app/api/board/';

export type FeedbackKind = 'bug' | 'idea' | 'question';

export type FeedbackDraft = {
  kind?: FeedbackKind;
  title?: string;
  body?: string;
  /** Whether the setup lines (versions, system, GPU) start switched on. Default: on for bugs. */
  withSetup?: boolean;
  /** Where it was opened from, for the dialog's wording: 'failure', 'crash', 'settings'. */
  from?: string;
};

type Listener = (draft: FeedbackDraft) => void;
const listeners = new Set<Listener>();

/** Opens the send dialog, filled in with `draft`. */
export function openFeedback(draft: FeedbackDraft = {}) {
  for (const listener of listeners) listener(draft);
}

export function subscribeFeedback(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export type FeedbackPost = { kind: FeedbackKind; title: string; body: string; setup: string; name: string; appVersion: string };
export type SentPost = { id: string; url: string };

/**
 * Posts to the board. Sent as text/plain so the browser asks no CORS
 * preflight; the board reads it as JSON either way.
 */
export async function sendFeedback(post: FeedbackPost, signal?: AbortSignal): Promise<SentPost> {
  let response: Response;
  try {
    response = await fetch(boardApi, {
      method: 'POST',
      credentials: 'omit',
      body: JSON.stringify({ action: 'create', source: 'app', type: post.kind, title: post.title, body: post.body, setup: post.setup, name: post.name, appVersion: post.appVersion }),
      signal
    });
  } catch {
    throw new Error('Can’t reach the board. Check the internet connection, or send it from the website.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.card?.id) throw new Error(data?.error || 'The board didn’t take it. Try again, or send it from the website.');
  return { id: data.card.id, url: `${boardUrl}#p-${data.card.id}` };
}

/** The board's own form with the fields filled in, for when posting from here fails. */
export function boardComposeUrl(post: Pick<FeedbackPost, 'kind' | 'title' | 'body' | 'setup'>) {
  const params = new URLSearchParams({ new: post.kind });
  if (post.title) params.set('title', post.title.slice(0, 120));
  // Keep the link a length every browser opens.
  if (post.body) params.set('body', post.body.slice(0, 2500));
  if (post.setup) params.set('setup', post.setup.slice(0, 1200));
  return `${boardUrl}?${params}`;
}

/** The HEISS UI version from the diagnostics' first line. */
export function versionFromDiagnostics(text: string) {
  return /^HEISS UI (\S+)/.exec(text)?.[1]?.replace(/^\(unknown$/, '') || '';
}

import React from 'react';
import { ArrowUpRight, Bug, Check, ChevronDown, HelpCircle, Lightbulb } from 'lucide-react';
import { Modal } from './Modal';
import { Segmented, Switch } from './SettingsDialog';
import { knownDiagnostics, loadDiagnostics } from './diagnostics';
import { boardComposeUrl, boardUrl, sendFeedback, subscribeFeedback, versionFromDiagnostics, type FeedbackDraft, type FeedbackKind, type SentPost } from './feedback';
import { cn } from './format';

const NAME_KEY = 'heiss-feedback-name';

const KINDS: Array<{ value: FeedbackKind; label: React.ReactNode }> = [
  { value: 'bug', label: <><Bug size={13} /> Bug</> },
  { value: 'idea', label: <><Lightbulb size={13} /> Idea</> },
  { value: 'question', label: <><HelpCircle size={13} /> Question</> }
];

const COPY: Record<FeedbackKind, { title: string; heading: string; body: string; send: string }> = {
  bug: { title: 'What goes wrong, in a few words', heading: 'Report a bug', body: 'What did you do, what happened, and what did you expect?', send: 'Send report' },
  idea: { title: 'Short and specific', heading: 'Share an idea', body: 'What would it look like, and when would you use it?', send: 'Send idea' },
  question: { title: 'Your question', heading: 'Ask a question', body: 'What are you trying to do?', send: 'Ask' }
};

const readName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
const saveName = (name: string) => { try { if (name) localStorage.setItem(NAME_KEY, name); else localStorage.removeItem(NAME_KEY); } catch { /* private mode */ } };

/**
 * Sends a bug, idea or question to the public feedback board. Mounted once
 * next to the studio (and on the crash screen); `openFeedback()` opens it.
 */
export function FeedbackHost({ initial }: { initial?: FeedbackDraft | null }) {
  const [draft, setDraft] = React.useState<FeedbackDraft | null>(initial ?? null);
  React.useEffect(() => subscribeFeedback((next) => setDraft({ ...next })), []);
  return <FeedbackDialog draft={draft} onClose={() => setDraft(null)} />;
}

function FeedbackDialog({ draft, onClose }: { draft: FeedbackDraft | null; onClose: () => void }) {
  const open = Boolean(draft);
  const [kind, setKind] = React.useState<FeedbackKind>('idea');
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [name, setName] = React.useState('');
  const [withSetup, setWithSetup] = React.useState(true);
  const [setup, setSetup] = React.useState('');
  const [setupRead, setSetupRead] = React.useState(false);
  const [showSetup, setShowSetup] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [sent, setSent] = React.useState<SentPost | null>(null);
  const titleRef = React.useRef<HTMLInputElement>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  // Each opening starts from its draft.
  React.useEffect(() => {
    if (!draft) return;
    const nextKind = draft.kind || 'idea';
    setKind(nextKind);
    setTitle(draft.title || '');
    setBody(draft.body || '');
    setName(readName());
    setWithSetup(draft.withSetup ?? nextKind === 'bug');
    setShowSetup(false);
    setError('');
    setSent(null);
    setBusy(false);
    setSetup(knownDiagnostics());
    setSetupRead(Boolean(knownDiagnostics()));
    loadDiagnostics().then((text) => { if (text) setSetup(text); setSetupRead(true); });
  }, [draft]);

  const trimmedTitle = title.trim();
  const includeSetup = withSetup && Boolean(setup) && kind !== 'question';
  const post = { kind, title: trimmedTitle, body: body.trim(), setup: includeSetup ? setup : '', name: name.trim(), appVersion: versionFromDiagnostics(setup) };

  const send = async () => {
    if (trimmedTitle.length < 4) {
      setError('Give it a title of a few words.');
      titleRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    saveName(post.name);
    try {
      setSent(await sendFeedback(post));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t send it.');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Modal
        open={open}
        onOpenChange={(next) => { if (!next) onClose(); }}
        size="form"
        className="feedback-modal"
        icon={<span className="feedback-done-icon"><Check size={18} strokeWidth={2.5} /></span>}
        title="Sent. Thank you!"
        description={kind === 'question' ? 'Answers show up on the board, under your question.' : 'It’s on the board. Upvotes, replies and status updates show up there.'}
        footer={
          <>
            <button type="button" className="btn is-ghost" onClick={onClose}>Done</button>
            <a className="btn is-primary" href={sent.url} target="_blank" rel="noreferrer"><ArrowUpRight size={14} /> Open on the board</a>
          </>
        }
      />
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      size="form"
      busy={busy}
      className="feedback-modal"
      initialFocus={draft?.title ? bodyRef : titleRef}
      title={draft?.from === 'crash' ? 'Report what broke' : COPY[kind].heading}
      description={<>Goes to the public <a href={boardUrl} target="_blank" rel="noreferrer">feedback board</a>, where anyone can upvote and reply. No account needed.</>}
      footer={
        <>
          {error ? <a className="btn is-ghost feedback-web" href={boardComposeUrl(post)} target="_blank" rel="noreferrer"><ArrowUpRight size={14} /> Send from the website</a> : null}
          <button type="button" className="btn is-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn is-primary" onClick={send} disabled={busy}>{busy ? 'Sending…' : error ? 'Try again' : COPY[kind].send}</button>
        </>
      }
    >
      <form className="feedback-form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <Segmented label="Kind of post" value={kind} options={KINDS} onChange={setKind} />

        <label className="field">
          <span>Title</span>
          <input ref={titleRef} value={title} maxLength={120} placeholder={COPY[kind].title} onChange={(event) => setTitle(event.target.value)} autoComplete="off" />
        </label>

        <label className="field">
          <span>Details</span>
          <textarea ref={bodyRef} value={body} maxLength={4000} placeholder={COPY[kind].body} onChange={(event) => setBody(event.target.value)} className={cn(body.length > 400 && 'is-long')} />
        </label>

        {kind !== 'question' ? (
          <div className="feedback-setup">
            <div className="feedback-setup-row">
              <div>
                <strong>Include setup</strong>
                <span>HEISS UI, ComfyUI and Node.js versions, system and GPU.</span>
              </div>
              <Switch label="Include setup" checked={withSetup} onChange={setWithSetup} size="sm" />
            </div>
            {withSetup ? (
              <>
                <button type="button" className="feedback-peek" aria-expanded={showSetup} onClick={() => setShowSetup((value) => !value)}>
                  {showSetup ? 'Hide what’s included' : 'See what’s included'} <ChevronDown size={12} />
                </button>
                {showSetup ? <pre className="feedback-setup-text">{setup || (setupRead ? 'The setup couldn’t be read here, so none is sent.' : 'Reading the setup…')}</pre> : null}
              </>
            ) : null}
          </div>
        ) : null}

        <label className="field">
          <span>Your name <em>optional, shown on the post</em></span>
          <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} autoComplete="nickname" placeholder="Anonymous" />
        </label>

        <p className="feedback-note">
          Only what’s above is sent, and only when you press {COPY[kind].send}. It’s public, so check the details for anything private, like names in file paths.
        </p>
        {error ? <p className="feedback-error" role="alert">{error}</p> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

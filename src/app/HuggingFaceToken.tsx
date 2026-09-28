import React from 'react';
import { apiJson } from './api';
import { Group, Row } from './SettingsDialog';
import type { ShowToast } from './toast';

type TokenStatus = { set: boolean; source: '' | 'settings' | 'environment'; editable: boolean; key?: string; hint?: string; mirror?: string };

/**
 * A Hugging Face token for gated downloads (some model makers ask you to
 * accept their licence first). It stays on this computer, in HEISS UI's .env,
 * goes only to huggingface.co, and is never shown again once saved.
 */
export function HuggingFaceTokenSettings({ showToast }: { showToast: ShowToast }) {
  const [status, setStatus] = React.useState<TokenStatus | null>(null);
  const [value, setValue] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState('');
  React.useEffect(() => {
    apiJson<TokenStatus>('/api/settings/hf-token').then(setStatus).catch(() => setStatus(null));
  }, []);

  const save = async (token: string) => {
    setBusy(true);
    setNote('');
    try {
      const next = await apiJson<TokenStatus>('/api/settings/hf-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
      setStatus(next);
      setValue('');
      // Removed from HEISS UI, but one set in the shell still applies: say so rather than claim it is gone.
      if (!token && next.source === 'environment') showToast(`Removed from Settings. ${next.key || 'HF_TOKEN'} in your environment still applies.`, 'warning');
      else showToast(token ? 'Hugging Face token saved' : 'Hugging Face token removed', token ? 'success' : 'removed');
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'The token could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  const description = note || (status.source === 'environment'
    ? `Set by ${status.key || 'HF_TOKEN'} in your environment (${status.hint}). Gated files download here once you’ve accepted their licence on Hugging Face.`
    : status.set
      ? `Saved on this computer (${status.hint}). It is sent to huggingface.co only.`
      : 'For gated models, after you accept their licence on Hugging Face. Create a read token under Settings › Access Tokens there. It stays on this computer and goes to huggingface.co only.');
  return (
    <Group title="Downloads" note={status.mirror ? `Downloads come from ${status.mirror} (HF_ENDPOINT).` : undefined}>
      <Row label="Hugging Face token" description={description}>
        {status.editable ? (
          <form className="set-address" onSubmit={(event) => { event.preventDefault(); if (value.trim()) save(value.trim()); }}>
            <input
              className="set-path-input"
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={status.set ? 'Replace with a new token' : 'hf_…'}
              aria-label="Hugging Face token"
              spellCheck={false}
              autoComplete="off"
            />
            {status.set && !value ? <button type="button" className="btn" disabled={busy} onClick={() => save('')}>Remove</button> : null}
            <button type="submit" className="btn is-primary" disabled={busy || !value.trim()}>{busy ? 'Saving…' : 'Save'}</button>
          </form>
        ) : null}
      </Row>
    </Group>
  );
}

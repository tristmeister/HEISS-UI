import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Pencil, Trash2 } from 'lucide-react';
import { Modal } from './Modal';

export type ConfirmationOptions = { title: string; description: string; action: string; destructive?: boolean };
export type ConfirmAction = (options: ConfirmationOptions) => Promise<boolean>;
export type PromptOptions = { title: string; description?: string; label?: string; initialValue?: string; action?: string; placeholder?: string };
export type PromptText = (options: PromptOptions) => Promise<string | null>;

/** Confirm and prompt dialogs as promises, rendered through the shared Modal. */
export function useConfirmation(enabled: boolean) {
  const [pending, setPending] = useState<ConfirmationOptions | null>(null);
  const [prompt, setPrompt] = useState<PromptOptions | null>(null);
  const [draft, setDraft] = useState('');
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  const promptResolveRef = useRef<((value: string | null) => void) | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const settle = useCallback((accepted: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setPending(null);
    resolve?.(accepted);
  }, []);
  const settlePrompt = useCallback((value: string | null) => {
    const resolve = promptResolveRef.current;
    promptResolveRef.current = null;
    setPrompt(null);
    resolve?.(value);
  }, []);
  useEffect(() => () => { resolveRef.current?.(false); promptResolveRef.current?.(null); }, []);

  const confirmAction: ConfirmAction = useCallback((options) => {
    if (!enabled) return Promise.resolve(true);
    if (resolveRef.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setPending(options);
    });
  }, [enabled]);

  const promptText: PromptText = useCallback((options) => {
    if (promptResolveRef.current) return Promise.resolve(null);
    setDraft(options.initialValue || '');
    return new Promise<string | null>((resolve) => {
      promptResolveRef.current = resolve;
      setPrompt(options);
    });
  }, []);

  const submitPrompt = () => { const value = draft.trim(); if (value) settlePrompt(value); };

  const confirmationDialog = (
    <>
      <Modal
        open={!!pending}
        onOpenChange={(open) => { if (!open) settle(false); }}
        size="alert"
        tone={pending?.destructive ? 'danger' : 'default'}
        icon={pending?.destructive ? <Trash2 size={18} /> : <AlertCircle size={18} />}
        title={pending?.title}
        description={pending?.description}
        hideClose
        initialFocus={cancelRef}
        footer={
          <>
            <button ref={cancelRef} className="btn" onClick={() => settle(false)}>Cancel</button>
            <button className={pending?.destructive ? 'btn is-danger' : 'btn is-primary'} onClick={() => settle(true)}>{pending?.action}</button>
          </>
        }
      />
      <Modal
        open={!!prompt}
        onOpenChange={(open) => { if (!open) settlePrompt(null); }}
        size="alert"
        icon={<Pencil size={17} />}
        title={prompt?.title}
        description={prompt?.description}
        hideClose
        dismissOnOutside
        initialFocus={inputRef}
        footer={
          <>
            <button className="btn" onClick={() => settlePrompt(null)}>Cancel</button>
            <button className="btn is-primary" disabled={!draft.trim()} onClick={submitPrompt}>{prompt?.action || 'Save'}</button>
          </>
        }
      >
        <input
          ref={inputRef}
          className="modal-input"
          aria-label={prompt?.label || prompt?.title}
          value={draft}
          placeholder={prompt?.placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitPrompt(); } }}
        />
      </Modal>
    </>
  );
  return { confirmAction, promptText, confirmationDialog };
}

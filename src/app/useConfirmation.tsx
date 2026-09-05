import { useCallback, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, Trash2 } from 'lucide-react';

export type ConfirmationOptions = { title: string; description: string; action: string; destructive?: boolean };
export type ConfirmAction = (options: ConfirmationOptions) => Promise<boolean>;

export function useConfirmation(enabled: boolean) {
  const [pending, setPending] = useState<ConfirmationOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const settle = useCallback((accepted: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setPending(null);
    resolve?.(accepted);
  }, []);
  useEffect(() => () => resolveRef.current?.(false), []);
  const confirmAction: ConfirmAction = useCallback((options) => {
    if (!enabled) return Promise.resolve(true);
    if (resolveRef.current) return Promise.resolve(false);
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setPending(options);
    });
  }, [enabled]);
  const confirmationDialog = (
    <Dialog.Root open={!!pending} onOpenChange={(open) => { if (!open) settle(false); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="confirmation-overlay" />
        <Dialog.Content className="confirmation-dialog" role="alertdialog"
          onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus(); }}
          onCloseAutoFocus={(event) => { event.preventDefault(); if (openerRef.current?.isConnected) openerRef.current.focus(); }}
          onPointerDownOutside={(event) => event.preventDefault()}>
          <div className={`confirmation-symbol${pending?.destructive ? ' is-destructive' : ''}`}>
            {pending?.destructive ? <Trash2 size={19} /> : <AlertCircle size={19} />}
          </div>
          <Dialog.Title>{pending?.title}</Dialog.Title>
          <Dialog.Description>{pending?.description}</Dialog.Description>
          <div className="confirmation-actions">
            <button ref={cancelRef} onClick={() => settle(false)}>Cancel</button>
            <button className={pending?.destructive ? 'is-destructive' : 'is-primary'} onClick={() => settle(true)}>{pending?.action}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
  return { confirmAction, confirmationDialog };
}

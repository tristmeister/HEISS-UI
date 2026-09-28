import React from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { apiJson } from './api';
import type { ConfirmAction } from './useConfirmation';
import type { ShowToast } from './toast';

type TrashSummary = { batches: number; items: number; files: number; days: number; latest: string; purgesAt: string };

function day(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Settings › Library: what "Delete all" moved to the trash, until it empties
 * itself. Restore puts the newest clear back; Empty deletes it all for good.
 */
export function TrashRow({ confirmAction, showToast, Row }: {
  confirmAction: ConfirmAction;
  showToast: ShowToast;
  Row: React.ComponentType<React.PropsWithChildren<{ label: React.ReactNode; description?: React.ReactNode; stacked?: boolean; disabled?: boolean }>>;
}) {
  const [trash, setTrash] = React.useState<TrashSummary | null>(null);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(() => apiJson<TrashSummary>('/api/gallery/trash').then(setTrash).catch(() => null), []);
  React.useEffect(() => { load(); }, [load]);
  if (!trash) return null;
  const empty = !trash.files;
  const restore = async () => {
    setBusy(true);
    try {
      const data = await apiJson<{ restored: number; missing: number; trash: TrashSummary }>('/api/gallery/trash/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ batch: trash.latest }) });
      // The gallery picks them up with its next poll.
      setTrash(data.trash);
      showToast(data.missing ? `${data.restored} back in the gallery. ${data.missing} stayed in the trash because a newer file has the same name.` : `${data.restored} back in the gallery`, data.missing ? 'warning' : 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Couldn’t restore them', 'error');
    } finally {
      setBusy(false);
    }
  };
  const emptyNow = async () => {
    if (!await confirmAction({ title: 'Empty the trash?', description: `${trash.files} file${trash.files === 1 ? ' is' : 's are'} deleted permanently. This can’t be undone.`, action: 'Empty trash', destructive: true, irreversible: true })) return;
    setBusy(true);
    try {
      const data = await apiJson<{ trash: TrashSummary }>('/api/gallery/trash/empty', { method: 'POST' });
      setTrash(data.trash);
      showToast('Trash emptied', 'removed');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Couldn’t empty the trash', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row
      label="Trash"
      description={empty
        ? `“Delete all” moves images here for ${trash.days} days.`
        : `${trash.items} image${trash.items === 1 ? '' : 's'} from ${trash.batches === 1 ? 'one clear' : `${trash.batches} clears`}. The oldest are deleted on ${day(trash.purgesAt)}.`}
      disabled={busy}
    >
      {empty ? null : (
        <>
          <button className="btn" disabled={busy} onClick={restore}><RotateCcw size={14} /> Restore{trash.batches > 1 ? ' latest' : ''}</button>
          <button className="btn is-ghost" disabled={busy} aria-label="Empty trash" onClick={emptyNow}><Trash2 size={14} /></button>
        </>
      )}
    </Row>
  );
}

import { t } from '../i18n/core.js';
import { useLanguage } from '../i18n/react';
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
  useLanguage();
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
    if (!await confirmAction({ title: t("Empty the trash?"), description: t("{0} file{1} deleted permanently. This can’t be undone.", { "0": (trash.files), "1": (trash.files === 1 ? t(" is") : t("s are")) }), action: t("Empty trash"), destructive: true, irreversible: true })) return;
    setBusy(true);
    try {
      const data = await apiJson<{ trash: TrashSummary }>('/api/gallery/trash/empty', { method: 'POST' });
      setTrash(data.trash);
      showToast(t("Trash emptied"), 'removed');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Couldn’t empty the trash', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row
      label={t("Trash")}
      description={empty
        ? t("“Delete all” moves images here for {0} days.", { "0": (trash.days) })
        : t("{0} image{1} from {2}. The oldest are deleted on {3}.", { "0": (trash.items), "1": (trash.items === 1 ? t("") : t("s")), "2": (trash.batches === 1 ? t("one clear") : `${trash.batches} clears`), "3": (day(trash.purgesAt)) })}
      disabled={busy}
    >
      {empty ? null : (
        <>
          <button className="btn" disabled={busy} onClick={restore}><RotateCcw size={14} />{t("Restore")}{trash.batches > 1 ? t(" latest") : ''}</button>
          <button className="btn is-ghost" disabled={busy} aria-label={t("Empty trash")} onClick={emptyNow}><Trash2 size={14} /></button>
        </>
      )}
    </Row>
  );
}

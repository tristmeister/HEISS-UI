import React from 'react';
import { FolderPlus, RefreshCw } from 'lucide-react';
import { apiJson } from './api';
import { BetaTag } from './components';
import { clearPrompts, setPromptHistoryEnabled, usePromptHistory } from './recentPrompts';
import type { ConfirmAction } from './useConfirmation';
import type { ShowToast } from './toast';

/* ---------------------------------------------------------------------------
   Settings › Library additions: earlier images, Civitai-ready files (beta),
   and forgetting recent prompts. The row pieces come from SettingsDialog, as
   HiddenSettings takes them, so every row reads the same.
--------------------------------------------------------------------------- */

type GroupProps = React.PropsWithChildren<{ title?: string; note?: React.ReactNode; tone?: 'danger' }>;
type RowProps = React.PropsWithChildren<{ label: React.ReactNode; description?: React.ReactNode; stacked?: boolean; disabled?: boolean }>;
type Parts = {
  Group: React.ComponentType<GroupProps>;
  Row: React.ComponentType<RowProps>;
  Switch: React.ComponentType<{ checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string }>;
  showToast: ShowToast;
};

type LibraryFolder = { id: string; path: string; name: string; count: number; scannedAt: string; available: boolean };
type ImportResult = { ok?: boolean; canceled?: boolean; output?: boolean; added?: number; found?: number; capped?: boolean; folders?: LibraryFolder[]; error?: string };

const plural = (count: number, word: string) => `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;

function resultLine(result: ImportResult, where: string) {
  const added = result.added || 0;
  const more = result.capped ? ' Only the first 20,000 files were checked. Add a subfolder for the rest.' : '';
  if (!added) return `Nothing new ${where}.${more}`;
  return `Added ${plural(added, 'image')} ${where}.${more}`;
}

/** Earlier images: other folders shown in place, and the output folder's unknown files. */
export function EarlierImagesGroup({ Group, Row, showToast, confirmAction, outputDir }: Omit<Parts, 'Switch'> & {
  confirmAction: ConfirmAction;
  outputDir?: string;
}) {
  const [folders, setFolders] = React.useState<LibraryFolder[] | null>(null);
  const [busy, setBusy] = React.useState('');
  React.useEffect(() => {
    let live = true;
    apiJson<{ folders: LibraryFolder[] }>('/api/library/folders').then((data) => { if (live) setFolders(data.folders || []); }).catch(() => { if (live) setFolders([]); });
    return () => { live = false; };
  }, []);

  const run = async (key: string, request: () => Promise<ImportResult>, where: string) => {
    setBusy(key);
    try {
      const result = await request();
      if (result.folders) setFolders(result.folders);
      if (result.canceled) return;
      showToast(resultLine(result, result.output ? 'from the output folder' : where), result.added ? 'success' : 'default');

    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Couldn’t read that folder', 'error');
    } finally {
      setBusy('');
    }
  };
  const post = (url: string, body?: unknown) => apiJson<ImportResult>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });

  return (
    <Group title="Earlier images" note="Images stay where they are and aren’t copied. Prompts saved in the files by ComfyUI or AUTOMATIC1111 can be searched.">
      {(folders || []).map((folder) => (
        <Row
          key={folder.id}
          label={folder.name}
          description={<><code className="set-path">{folder.path}</code><br />{folder.available ? plural(folder.count, 'image') : 'Not reachable right now. Is the drive connected?'}</>}
        >
          <button className="btn is-ghost" disabled={Boolean(busy)} onClick={() => run(folder.id, () => post(`/api/library/folders/${encodeURIComponent(folder.id)}/scan`), `from ${folder.name}`)} aria-label={`Rescan ${folder.name}`}>
            <RefreshCw size={14} className={busy === folder.id ? 'spin' : undefined} /> Rescan
          </button>
          <button className="btn is-ghost" disabled={Boolean(busy)} onClick={async () => {
            if (!await confirmAction({ title: `Stop showing ${folder.name}?`, description: 'Its images are removed from the gallery. The files stay where they are.', action: 'Remove folder' })) return;
            try {
              const result = await apiJson<ImportResult>(`/api/library/folders/${encodeURIComponent(folder.id)}`, { method: 'DELETE' });
              if (result.folders) setFolders(result.folders);

            } catch (error) {
              showToast(error instanceof Error ? error.message : 'Couldn’t remove that folder', 'error');
            }
          }}>Remove</button>
        </Row>
      ))}
      <Row label="Add a folder" description="Older ComfyUI outputs, or an AUTOMATIC1111 or Forge folder. Subfolders are included.">
        <button className="btn" disabled={Boolean(busy)} onClick={() => run('add', () => post('/api/library/folders', { start: outputDir || '' }), 'from that folder')}>
          <FolderPlus size={14} /> {busy === 'add' ? 'Looking…' : 'Choose…'}
        </button>
      </Row>
      {outputDir ? (
        <Row label="Everything in the output folder" description="Adds images ComfyUI saved that aren’t in the gallery, such as runs made in ComfyUI or older than its history.">
          <button className="btn" disabled={Boolean(busy)} onClick={() => run('output', () => post('/api/library/output'), 'from the output folder')}>
            <RefreshCw size={14} className={busy === 'output' ? 'spin' : undefined} /> {busy === 'output' ? 'Scanning…' : 'Scan'}
          </button>
        </Row>
      ) : null}
    </Group>
  );
}

/** Civitai-ready PNGs: off unless switched on, and never for Hidden. A row of Library › Sharing. */
export function CivitaiRow({ Row, Switch, showToast, canChange }: Omit<Parts, 'Group'> & { canChange: boolean }) {
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    let live = true;
    apiJson<{ enabled: boolean }>('/api/civitai').then((data) => { if (live) setEnabled(Boolean(data.enabled)); }).catch(() => { if (live) setEnabled(false); });
    return () => { live = false; };
  }, []);
  const change = async (next: boolean) => {
    const before = enabled;
    setEnabled(next);
    try {
      const data = await apiJson<{ enabled: boolean }>('/api/civitai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: next }) });
      setEnabled(Boolean(data.enabled));
    } catch (error) {
      setEnabled(before);
      showToast(error instanceof Error ? error.message : 'Couldn’t save the setting', 'error');
    }
  };
  return (
    <Row
      label={<>Civitai-ready images<BetaTag /></>}
      description="Saves the prompt, LoRAs, steps, sampler, seed and model in each new PNG the way AUTOMATIC1111 does, so Civitai fills them in on upload. ComfyUI’s workflow stays in the file; Hidden images are left alone."
      disabled={enabled === null || !canChange}
    >
      <Switch label="Civitai-ready images" checked={Boolean(enabled)} onChange={change} disabled={enabled === null || !canChange} />
    </Row>
  );
}

/** Recent prompts: whether to keep them, what the list holds, and the way to empty it. */
export function PromptHistoryRow({ Row, Switch, showToast, confirmAction }: Pick<Parts, 'Row' | 'Switch' | 'showToast'> & { confirmAction: ConfirmAction }) {
  const { prompts, enabled } = usePromptHistory(true);
  const starred = prompts.filter((entry) => entry.pinned).length;
  const recent = prompts.length - starred;
  const fail = (error: unknown) => showToast(error instanceof Error ? error.message : 'Couldn’t change recent prompts', 'error');
  const toggle = async (next: boolean) => {
    if (!next && recent && !await confirmAction({ title: 'Turn off recent prompts?', description: `${plural(recent, 'recent prompt')} ${recent === 1 ? 'is' : 'are'} forgotten.${starred ? ' Starred prompts stay.' : ''}`, action: 'Turn off' })) return;
    setPromptHistoryEnabled(next).catch(fail);
  };
  return (
    <>
      <Row
        label="Keep recent prompts"
        description={`Press ↑ in an empty prompt, or the clock beside Negative, to reuse one. Shared with other devices; prompts from Hidden aren’t saved.${enabled && prompts.length ? ` ${plural(recent, 'recent prompt')}${starred ? `, ${starred} starred` : ''}.` : ''}`}
      >
        <Switch label="Keep recent prompts" checked={enabled} onChange={toggle} />
      </Row>
      {enabled && recent ? (
        <Row label="Forget recent prompts" description={starred ? 'Starred prompts stay.' : 'The list starts over with your next prompt.'}>
          <button className="btn" onClick={async () => {
            if (!await confirmAction({ title: 'Forget recent prompts?', description: starred ? 'Starred prompts stay.' : 'The list starts over with your next prompt.', action: 'Forget' })) return;
            clearPrompts().catch(fail);
          }}>Forget</button>
        </Row>
      ) : null}
    </>
  );
}

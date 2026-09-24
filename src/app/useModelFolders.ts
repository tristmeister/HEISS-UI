import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJson } from './api';
import { fetchManager } from './ComfyRestart';
import type { ModelFolderReport, StrayModelFolder } from './types';

/**
 * Model folders ComfyUI is not reading, and the walk from "found" to "ready":
 *
 *   scanning -> found | none | remote | offline
 *   found -> adding -> restarting (Manager restarts ComfyUI) | waiting (you do)
 *         -> done
 *
 * The scan runs once when the studio connects; the sidebar notice and the
 * empty model menu read its result, the dialog walks the rest.
 */
export type ModelFolderStage = 'scanning' | 'found' | 'none' | 'remote' | 'offline' | 'adding' | 'restarting' | 'waiting' | 'done' | 'error';

const dismissKey = 'heiss-ui:model-folders-dismissed';
const signature = (folders: StrayModelFolder[]) => folders.map((folder) => `${folder.path}:${folder.count}`).sort().join('|');
const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function readDismissed() {
  try { return localStorage.getItem(dismissKey) || ''; } catch { return ''; }
}

export function useModelFolders({ connected, emptyModels, onModelsChanged, showToast }: {
  /** ComfyUI answers; the scan waits for it. */
  connected: boolean;
  /** ComfyUI lists no model HEISS can run: found folders then open the dialog by themselves, once. */
  emptyModels: boolean;
  onModelsChanged: () => void;
  showToast: (message: string, tone?: 'default' | 'success' | 'error') => void;
}) {
  const [report, setReport] = useState<ModelFolderReport | null>(null);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<ModelFolderStage>('scanning');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<{ folders: StrayModelFolder[]; count: number }>({ folders: [], count: 0 });
  const [dismissed, setDismissed] = useState(readDismissed);
  const alive = useRef(true);
  const busy = useRef(false);
  const autoOpened = useRef(false);
  useEffect(() => () => { alive.current = false; }, []);

  const settle = useCallback((next: ModelFolderReport) => {
    setReport(next);
    setSelected(next.folders.map((folder) => folder.path));
    return next.offline ? 'offline' : next.local === false ? 'remote' : next.folders.length ? 'found' : 'none';
  }, []);

  const scan = useCallback(async ({ quiet = false } = {}) => {
    if (busy.current) return null;
    if (!quiet) setStage('scanning');
    // Long enough for the search to read as a search, even on a fast disk.
    const [next] = await Promise.all([
      apiJson<ModelFolderReport>('/api/model-folders').catch((reason) => ({ ok: false, folders: [], linked: [], error: reason instanceof Error ? reason.message : 'Scan failed' } as ModelFolderReport)),
      quiet ? Promise.resolve() : sleep(1100)
    ]);
    if (!alive.current || busy.current) return next;
    const nextStage = next.ok || next.offline ? settle(next) : 'error';
    if (!next.ok && !next.offline) setError(next.error || 'The scan did not finish.');
    setStage(nextStage);
    return next;
  }, [settle]);

  // One quiet look as soon as ComfyUI answers.
  const scanned = useRef(false);
  useEffect(() => {
    if (!connected || scanned.current) return;
    scanned.current = true;
    scan({ quiet: true });
  }, [connected, scan]);

  // No runnable model at all, and there are models right there: that is the moment to say so.
  useEffect(() => {
    if (autoOpened.current || !emptyModels || !report?.folders.length) return;
    autoOpened.current = true;
    setOpen(true);
  }, [emptyModels, report]);

  const openDialog = useCallback(() => {
    setOpen(true);
    if (!busy.current && stage !== 'done') scan();
  }, [scan, stage]);

  const close = useCallback(() => {
    setOpen(false);
    if (stage === 'done') setStage(report?.folders.length ? 'found' : 'none');
  }, [report, stage]);

  const dismissNotice = useCallback(() => {
    const value = signature(report?.folders || []);
    try { localStorage.setItem(dismissKey, value); } catch { /* the notice just comes back */ }
    setDismissed(value);
  }, [report]);

  /** Waits until ComfyUI reads every added folder, which it does from its next start; true once it does. */
  const waitUntilRead = useCallback(async (paths: string[], deadline: number) => {
    while (alive.current && Date.now() < deadline) {
      await sleep(1800);
      const next = await apiJson<ModelFolderReport>('/api/model-folders').catch(() => null);
      if (next?.ok && paths.every((dir) => next.linked.some((item) => item.path === dir && item.read))) {
        setReport(next);
        return true;
      }
    }
    return false;
  }, []);

  const add = useCallback(async ({ picked = '' } = {}) => {
    const folders = (report?.folders || []).filter((folder) => selected.includes(folder.path));
    if (!folders.length && !picked) return;
    busy.current = true;
    setError('');
    setStage('adding');
    try {
      const [result] = await Promise.all([
        apiJson<{ added: string[] }>('/api/model-folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: folders.map((folder) => folder.path), picked })
        }),
        sleep(700)
      ]);
      // Nothing new written means these were added before but ComfyUI never restarted: wait for the same thing.
      const paths = result.added.length ? result.added : folders.map((folder) => folder.path);
      setAdded({ folders, count: folders.reduce((sum, folder) => sum + folder.count, 0) });
      // ComfyUI reads its model folders when it starts, so it has to restart once.
      setStage('restarting');
      const manager = await fetchManager(true);
      let restarted = false;
      if (manager.available) {
        restarted = await apiJson('/api/comfy/restart', { method: 'POST' }).then(() => true, () => false);
      }
      if (!restarted) setStage('waiting');
      const read = await waitUntilRead(paths, Date.now() + (restarted ? 150_000 : 30 * 60_000));
      if (!alive.current) return;
      if (!read) {
        setStage('error');
        setError(restarted ? 'ComfyUI has not come back with the new folders yet. Check its window for errors.' : 'ComfyUI did not restart yet.');
        return;
      }
      onModelsChanged();
      setStage('done');
      setDismissed('');
    } catch (reason) {
      if (!alive.current) return;
      setStage('error');
      setError(reason instanceof Error ? reason.message : 'ComfyUI could not be set up.');
    } finally {
      busy.current = false;
    }
  }, [onModelsChanged, report, selected, waitUntilRead]);

  const pick = useCallback(async () => {
    try {
      const result = await apiJson<{ path?: string; canceled?: boolean }>('/api/model-folders/pick', { method: 'POST' });
      if (result.path) await add({ picked: result.path });
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : 'Could not open the folder picker', 'error');
    }
  }, [add, showToast]);

  const remove = useCallback(async (path: string) => {
    try {
      await apiJson('/api/model-folders', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
      showToast('Removed. ComfyUI stops reading it after its next restart.', 'success');
      scan({ quiet: true });
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : 'Could not remove that folder', 'error');
    }
  }, [scan, showToast]);

  const folders = report?.folders || [];
  const noticeVisible = folders.length > 0 && dismissed !== signature(folders) && stage !== 'done';
  return {
    report, stage, open, error, selected, added, noticeVisible,
    setSelected, openDialog, close, scan, add, pick, remove, dismissNotice
  };
}

export type ModelFolders = ReturnType<typeof useModelFolders>;

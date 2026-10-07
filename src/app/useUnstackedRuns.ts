import { useCallback, useMemo, useState } from 'react';
import type { GalleryGroups, Run } from './runs';

const storageKey = "heiss-ui-unstacked-runs";
/** Enough to remember every run anyone unstacks, without growing forever. */
const limit = 500;

function load(): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * Runs someone took apart: their outputs go back to being separate tiles and
 * stay that way. A run's id is its oldest output's, so it survives new takes.
 * Remembered on this device; a Hidden run only until the page reloads, so
 * nothing about Hidden is written down in the clear.
 */
export function useUnstackedRuns(groups: GalleryGroups) {
  const [unstacked, setUnstacked] = useState<Set<string>>(load);
  const [session, setSession] = useState<Set<string>>(() => new Set());
  const persist = (next: Set<string>) => {
    try { localStorage.setItem(storageKey, JSON.stringify([...next].slice(-limit))); } catch { /* storage off: this session only */ }
  };
  const unstack = useCallback((run: Run, apart: boolean) => {
    const hidden = run.items.some((item) => item.privateVault);
    const update = (setter: typeof setUnstacked, save: boolean) => setter((current) => {
      if (current.has(run.id) === apart) return current;
      const next = new Set(current);
      if (apart) next.add(run.id); else next.delete(run.id);
      if (save) persist(next);
      return next;
    });
    if (hidden) update(setSession, false);
    else update(setUnstacked, true);
  }, []);
  const visible = useMemo(() => {
    if (!unstacked.size && !session.size) return groups;
    const runs = groups.runs.filter((run) => !unstacked.has(run.id) && !session.has(run.id));
    if (runs.length === groups.runs.length) return groups;
    const runOf = new Map(groups.runOf);
    for (const run of groups.runs) {
      if (!unstacked.has(run.id) && !session.has(run.id)) continue;
      for (const item of run.items) runOf.delete(item.id);
    }
    return { ...groups, runs, runOf };
  }, [groups, session, unstacked]);
  return { groups: visible, unstack };
}

import { useSyncExternalStore } from 'react';
import { getLanguage, getServerLanguage, subscribeLanguage } from './core.js';

/** Subscribe memoized components too, without remounting or resetting drafts. */
export function useLanguage() {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getServerLanguage);
}

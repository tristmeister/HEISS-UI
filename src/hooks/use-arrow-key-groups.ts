import { useEffect } from 'react';

const GROUP = '[role="tablist"], [role="radiogroup"]';
const ITEM = '[role="tab"], [role="radio"]';

/**
 * Arrow keys, Home and End move between the tabs of every tablist and the
 * options of every radio group in the app, and select what they land on - the
 * keyboard pattern those roles promise. One listener covers them all.
 */
export function useArrowKeyGroups() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return;
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(ITEM) : null;
      const group = target?.closest<HTMLElement>(GROUP);
      if (!target || !group) return;
      const items = Array.from(group.querySelectorAll<HTMLElement>(ITEM))
        .filter((item) => item.closest(GROUP) === group && !item.hasAttribute('disabled') && item.getAttribute('aria-disabled') !== 'true');
      const index = items.indexOf(target);
      if (index < 0 || items.length < 2) return;
      const next = key === 'Home' ? 0
        : key === 'End' ? items.length - 1
        : key === 'ArrowLeft' || key === 'ArrowUp' ? (index - 1 + items.length) % items.length
        : (index + 1) % items.length;
      event.preventDefault();
      items[next].focus();
      items[next].click();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}

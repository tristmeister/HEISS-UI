import { useEffect, useState } from 'react';

/**
 * Two facts about the device in front of the studio, shared app-wide:
 *
 *   thisComputer  the page is open on the computer HEISS UI runs on. Only
 *                 there can it look after that computer (folders, downloads,
 *                 installs, restarts, updates); the server refuses those from
 *                 other devices, and the app hides them there.
 *   phone         a touch phone, which gets the simplified phone studio
 *                 unless someone chose the full one.
 */

const localNames = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
let thisComputer = typeof window === 'undefined' ? true : localNames.has(window.location.hostname);
const listeners = new Set<(value: boolean) => void>();

/** The server's answer (from /api/health) replaces the guess from the address. */
export function setThisComputer(value: boolean) {
  if (value === thisComputer) return;
  thisComputer = value;
  listeners.forEach((listener) => listener(value));
}

export function useThisComputer() {
  const [value, setValue] = useState(thisComputer);
  useEffect(() => {
    listeners.add(setValue);
    setValue(thisComputer);
    return () => { listeners.delete(setValue); };
  }, []);
  return value;
}

const PHONE_QUERY = '(pointer: coarse) and (max-width: 760px)';

// ?phone=1 forces the phone studio (and ?phone=0 turns the force off) for this
// tab, so it can be tried or checked on a desktop.
function forcedPhone() {
  if (typeof window === 'undefined') return false;
  try {
    const flag = new URLSearchParams(window.location.search).get('phone');
    if (flag !== null) window.sessionStorage.setItem('heiss-force-phone', flag === '1' ? '1' : '');
    return window.sessionStorage.getItem('heiss-force-phone') === '1';
  } catch {
    return false;
  }
}

/** A touch phone: coarse pointer on a narrow screen. Tablets keep the full studio. */
export function usePhone() {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && (forcedPhone() || window.matchMedia(PHONE_QUERY).matches));
  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(forcedPhone() || query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return phone;
}

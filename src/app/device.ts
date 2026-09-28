import { useEffect, useState } from 'react';

/**
 * Two facts about the device in front of the studio, shared app-wide:
 *
 *   thisComputer  the page may look after the computer HEISS UI runs on
 *                 (folders, downloads, installs, restarts, updates): it is
 *                 open on that computer, or on a signed-in device its owner
 *                 trusts with that (Settings › Connection). Elsewhere the
 *                 server refuses those, and the app hides them.
 *   atComputer    the page is open on that computer itself. Only there can
 *                 the passwords, the admin switch and sign-ins be changed.
 *   phone         a touch phone, which gets the simplified phone studio
 *                 unless someone chose the full one.
 */

const localNames = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const onLoopback = typeof window === 'undefined' ? true : localNames.has(window.location.hostname);

/** A value the server confirms later, shared by every component that asks. */
function sharedFlag(initial: boolean) {
  let current = initial;
  const listeners = new Set<(value: boolean) => void>();
  return {
    set(value: boolean) {
      if (value === current) return;
      current = value;
      listeners.forEach((listener) => listener(value));
    },
    use() {
      const [value, setValue] = useState(current);
      useEffect(() => {
        listeners.add(setValue);
        setValue(current);
        return () => { listeners.delete(setValue); };
      }, []);
      return value;
    }
  };
}

const admin = sharedFlag(onLoopback);
const atComputer = sharedFlag(onLoopback);

/** The server's answer (from /api/health) replaces the guess from the address. */
export function setThisComputer(value: boolean) {
  admin.set(value);
}

export function setAtComputer(value: boolean) {
  atComputer.set(value);
}

export function useThisComputer() {
  return admin.use();
}

export function useAtComputer() {
  return atComputer.use();
}

// Narrow, or short (a phone held sideways is wide but only ~400px tall).
const PHONE_QUERY = '(pointer: coarse) and (max-width: 760px), (pointer: coarse) and (max-height: 500px)';

/** Phones say so in their user agent; tablets and touch laptops do not. */
function mobileAgent() {
  if (typeof navigator === 'undefined') return false;
  const hint = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile;
  if (typeof hint === 'boolean') return hint;
  return /iPhone|iPod|Android.+Mobile|Windows Phone|Mobile Safari(?!.*iPad)/i.test(navigator.userAgent) && !/iPad/i.test(navigator.userAgent);
}

function phoneNow(query: MediaQueryList) {
  return forcedPhone() || query.matches || (mobileAgent() && window.matchMedia('(pointer: coarse)').matches);
}

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
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && phoneNow(window.matchMedia(PHONE_QUERY)));
  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(phoneNow(query));
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return phone;
}

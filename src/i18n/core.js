import { ru } from './ru.js';

export const languages = Object.freeze([
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' }
]);
export const languageStorageKey = 'heiss-ui-language';
const listeners = new Set();

export function supportedLanguage(value) {
  const language = String(value || '').toLowerCase().split(/[-_]/)[0];
  return languages.some((item) => item.value === language) ? language : null;
}

function browserLanguage() {
  if (typeof navigator === 'undefined') return 'en';
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const candidate of candidates) {
    const language = supportedLanguage(candidate);
    if (language) return language;
  }
  return 'en';
}

function initialLanguage() {
  try {
    const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(languageStorageKey);
    const supported = supportedLanguage(saved);
    if (supported) return supported;
  } catch { /* Storage may be blocked; the language still works for this session. */ }
  return browserLanguage();
}

let language = initialLanguage();

function publish(next) {
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  if (next === language) return;
  language = next;
  for (const listener of listeners) listener();
}

export function getLanguage() { return language; }
export function getServerLanguage() { return 'en'; }
export function subscribeLanguage(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLanguage(value) {
  const next = supportedLanguage(value);
  if (!next) return false;
  try { localStorage.setItem(languageStorageKey, next); } catch { /* Session-only preference. */ }
  publish(next);
  return true;
}

/** Translate presentation text only. Interpolation values remain opaque data. */
export function translate(message, values = {}, locale = language) {
  const translated = locale === 'ru' && Object.hasOwn(ru, message) ? ru[message] : undefined;
  let text = translated ?? message;
  if (typeof text === 'object') {
    const count = Number(values.count ?? values[0]);
    const rule = Number.isFinite(count) ? new Intl.PluralRules(locale).select(count) : 'other';
    text = text[rule] || text.other || message;
  }
  return text.replace(/\{([\w]+)\}/g, (token, key) => Object.hasOwn(values, key) ? String(values[key]) : token);
}

export function t(message, values) { return translate(message, values); }

if (typeof document !== 'undefined') document.documentElement.lang = language;
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== languageStorageKey && event.key !== null) return;
    publish(supportedLanguage(event.newValue) || browserLanguage());
  });
}

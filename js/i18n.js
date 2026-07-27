// Internationalization. Loads JSON locale files, resolves nested dotted keys,
// supports {placeholders}, falls back to English. Ready to add more languages:
// drop a locales/<code>.json and add it to SUPPORTED below.

export const SUPPORTED = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'ru', label: 'Русский' }
];
const FALLBACK = 'en';

let current = FALLBACK;
let dict = {};
let fallbackDict = {};

function detect(pref) {
  if (pref && SUPPORTED.some((l) => l.code === pref)) return pref;
  const navs = navigator.languages || [navigator.language || 'en'];
  for (const n of navs) {
    const code = String(n).slice(0, 2).toLowerCase();
    if (SUPPORTED.some((l) => l.code === code)) return code;
  }
  return FALLBACK;
}

async function fetchLocale(code) {
  const res = await fetch(`locales/${code}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error('locale ' + code + ' ' + res.status);
  return res.json();
}

/** Initialise with a preferred code ('' => auto). */
export async function initI18n(pref) {
  if (!Object.keys(fallbackDict).length) {
    try { fallbackDict = await fetchLocale(FALLBACK); } catch (e) { console.error(e); }
  }
  await setLang(pref);
}

export async function setLang(pref) {
  const code = detect(pref);
  current = code;
  if (code === FALLBACK) {
    dict = fallbackDict;
  } else {
    try { dict = await fetchLocale(code); }
    catch (e) { console.warn('i18n: fallback to en', e); dict = fallbackDict; current = FALLBACK; }
  }
  document.documentElement.lang = current;
  applyDOM();
  return current;
}

export function getLang() { return current; }

function resolve(obj, key) {
  return key.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj);
}

/** Translate a dotted key with optional {params}. */
export function t(key, params) {
  let s = resolve(dict, key);
  if (s === undefined) s = resolve(fallbackDict, key);
  if (s === undefined) return key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, p) => (params[p] != null ? params[p] : m));
  return s;
}

/** Apply translations to any element carrying data-i18n / data-i18n-* attributes. */
export function applyDOM(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder)); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}

/** Pick localized field from an object like {en, de, ...} with fallback. */
export function pick(map) {
  if (!map) return '';
  return map[current] || map[FALLBACK] || Object.values(map)[0] || '';
}

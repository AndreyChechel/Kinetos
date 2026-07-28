// Tiny DOM + formatting helpers (no framework).

/** Escape untrusted text for safe HTML interpolation. */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** querySelector shorthand scoped to root (defaults to document). */
export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

/** Create an element with props and children. */
export function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Generate a compact unique id. */
export function uid(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

let toastTimer;
/** Show a toast. opts.action + opts.onAction add a tappable action (e.g. Undo). */
export function toast(msg, opts = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = '';
  el.appendChild(document.createTextNode(msg));
  if (opts.action && typeof opts.onAction === 'function') {
    const btn = document.createElement('button');
    btn.className = 'toast__action';
    btn.type = 'button';
    btn.textContent = opts.action;
    btn.addEventListener('click', () => {
      clearTimeout(toastTimer);
      el.classList.remove('show');
      opts.onAction();
    });
    el.appendChild(btn);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), opts.duration || 2200);
}

/** Make a non-button element keyboard-operable (Enter/Space fire click). */
export function clickable(el, role = 'button') {
  el.setAttribute('role', role);
  el.tabIndex = 0;
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
  });
  return el;
}

/** Format a date for display as YYYY-MM-DD (ISO 8601), independent of locale.
 *  - A `weekday` option prefixes the localized weekday name, e.g.
 *    "Tuesday, 2026-07-28" (used for day headers).
 *  - A month/year request without a day (`{month, year}`, no `day`) is a
 *    month bucket, formatted as YYYY-MM (used by the progress chart). */
/** Parse an ISO string; date-only values ('yyyy-mm-dd') are treated as LOCAL
 *  midnight. (new Date('yyyy-mm-dd') is UTC midnight, which renders as the
 *  previous day in negative-offset timezones.) */
export function parseISO(iso) {
  if (typeof iso === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  return new Date(iso);
}

export function fmtDate(iso, lang, opts) {
  try {
    const d = parseISO(iso);
    if (isNaN(d)) return iso;
    if (opts && opts.month && !opts.day) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    const base = localISO(d);
    if (opts && opts.weekday) {
      const wd = new Intl.DateTimeFormat(lang, { weekday: opts.weekday }).format(d);
      return `${wd}, ${base}`;
    }
    return base;
  } catch { return iso; }
}
export function fmtTime(iso, lang) {
  try {
    return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  } catch { return iso; }
}
/** Time including seconds, e.g. 14:03:27 (24-hour). */
export function fmtTimeSec(iso, lang) {
  try {
    return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  } catch { return iso; }
}
/** mm:ss from milliseconds. */
export function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const hh = Math.floor(m / 60); const mm = m % 60;
    return `${hh}:${String(mm).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }
  return `${m}:${String(r).padStart(2, '0')}`;
}
/** Local calendar date as YYYY-MM-DD (avoids UTC off-by-one from toISOString). */
export function localISO(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
export function todayISO() { return localISO(new Date()); }
export function isSameDay(iso, dayISO) {
  const s = String(iso || '');
  // Timestamps compare by LOCAL calendar day; date-only strings compare as-is.
  return (s.includes('T') ? localISO(new Date(s)) : s.slice(0, 10)) === dayISO;
}

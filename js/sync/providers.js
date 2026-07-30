// Authorization + file I/O for cloud sync. Google Drive only.
//
// Authorization is the GIS token model (js/sync/gis.js): no client secret, no
// redirect round-trip, no refresh token. An access token lives ~1h in
// localStorage under TOKENS_KEY, is never synced, and is re-obtained from a user
// gesture. Everything here that touches auth therefore comes in two halves:
//   prepareAuth() — async, safe to call any time (loads the GIS library)
//   requestAuth() — synchronous entry point, MUST be called from a click
import { SYNC } from '../config.js';
import * as gis from './gis.js';

const TOKENS_KEY = 'kinetos.tokens';
const GDRIVE_FILE_KEY = 'kinetos.gdrive.fileId';
// Treat a token as spent a minute early so a sync can't start on one that dies
// halfway through the pull/push.
const SKEW_MS = 60000;

function getFileId() { return localStorage.getItem(GDRIVE_FILE_KEY) || ''; }
function setFileId(id) { if (id) localStorage.setItem(GDRIVE_FILE_KEY, id); }
function clearFileId() { localStorage.removeItem(GDRIVE_FILE_KEY); }

function authError(msg) { const e = new Error(msg || 'auth'); e.code = 'auth'; return e; }

// ---- token storage ----
function allTokens() { try { return JSON.parse(localStorage.getItem(TOKENS_KEY) || '{}'); } catch { return {}; } }
function getTokens(p) { return allTokens()[p] || null; }
function setTokens(p, t) { const all = allTokens(); all[p] = t; localStorage.setItem(TOKENS_KEY, JSON.stringify(all)); }

export function clearTokens(p) {
  const all = allTokens(); delete all[p];
  localStorage.setItem(TOKENS_KEY, JSON.stringify(all));
  if (p === 'google') clearFileId();
}
/** A grant exists on this device (the token itself may have expired). */
export function hasTokens(p) { return !!(getTokens(p) && getTokens(p).access_token); }
/** A token that is still good — the only state in which we can sync unattended. */
export function hasLiveToken(p) {
  const tk = getTokens(p);
  return !!(tk && tk.access_token && tk.expires_at && tk.expires_at - SKEW_MS > Date.now());
}
export function isConfigured(p) { const c = SYNC.providers[p]; return !!(c && c.clientId); }

// ---- authorization ----
/** Load + build the token client. Call while rendering sync UI, not on click. */
export async function prepareAuth(p) {
  const cfg = SYNC.providers[p];
  if (!cfg || !cfg.clientId) throw new Error('not-configured');
  if (cfg.flow !== 'gis') throw new Error('unsupported-flow');
  // onToken is the only place a token is stored, so one that arrives after the
  // requester timed out still lands on disk instead of being lost.
  await gis.init(p, {
    clientId: cfg.clientId,
    scope: cfg.scope,
    onToken: (tk) => setTokens(p, { access_token: tk.access_token, expires_at: tk.expires_at })
  });
}

/** True when requestAuth(p) can open its popup immediately. */
export function authReady(p) { return gis.ready(p); }

/**
 * Get a fresh token. MUST be called synchronously from a user gesture —
 * awaiting first loses the activation and the popup gets blocked. Call
 * prepareAuth() ahead of time so authReady(p) is already true. Storage happens
 * in the onToken sink above, not here.
 */
export function requestAuth(p) {
  if (!isConfigured(p)) return Promise.reject(new Error('not-configured'));
  return gis.requestToken(p).then(() => p);
}

/** Best-effort revoke of the grant (disconnect). Never throws. */
export async function revokeAuth(p) {
  const tk = getTokens(p);
  if (!tk || !tk.access_token) return false;
  try { return await gis.revoke(tk.access_token); } catch (e) { return false; }
}

// ---- authorized requests ----
// A stalled request would wedge the sync manager's single-flight gate (and leave
// the status on "syncing") until a reload, so every call is time-boxed.
const REQUEST_TIMEOUT_MS = 30000;

async function authed(provider, url, opts = {}) {
  if (!hasLiveToken(provider)) throw authError();
  const token = getTokens(provider).access_token;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS) : null;
  let res;
  try {
    res = await fetch(url, {
      ...opts,
      signal: ctl ? ctl.signal : undefined,
      headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token }
    });
  } catch (e) {
    if (e && e.name === 'AbortError') { const t = new Error('request-timeout'); t.code = 'timeout'; throw t; }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 401) throw authError();
  return res;
}

/** Throw a descriptive error for a non-OK response. */
async function ensureOk(res) {
  if (res.ok) return res;
  if (res.status === 401) throw authError();
  let detail = '';
  try {
    const body = await res.clone().json();
    detail = (body && body.error && (body.error.message || body.error.error_description)) || '';
  } catch { try { detail = (await res.clone().text()).slice(0, 200); } catch {} }
  const e = new Error(`${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}`);
  e.code = res.status === 403 ? 'forbidden' : 'http';
  throw e;
}

// ---- Google Drive file I/O ----
// Uses the drive.file scope: the app only sees files it created. We create a
// regular file named kinetos.json and remember its id locally. That visibility
// is tied to the OAuth client id — keep the same client id or the app loses
// sight of a file it created earlier.
const FILE = () => SYNC.fileName;

export async function download(p) {
  if (p !== 'google') throw new Error('unknown-provider');
  let id = getFileId();
  if (id) {
    const res = await authed(p, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
    if (res.status === 404) { clearFileId(); id = ''; }
    else { await ensureOk(res); return { text: await res.text(), id }; }
  }
  const q = encodeURIComponent(`name='${FILE()}' and trashed=false`);
  const list = await ensureOk(await authed(p, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`));
  const j = await list.json();
  const found = j.files && j.files[0] && j.files[0].id;
  if (!found) return { text: null, id: null };
  setFileId(found);
  const res = await ensureOk(await authed(p, `https://www.googleapis.com/drive/v3/files/${found}?alt=media`));
  return { text: await res.text(), id: found };
}

export async function upload(p, text, remote) {
  if (p !== 'google') throw new Error('unknown-provider');
  // Reuse the file id resolved by the preceding download (or the cached one)
  // instead of re-downloading the whole file just to learn its id.
  let id = (remote && remote.id) || getFileId();
  if (id) {
    const res = await authed(p, `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text });
    if (res.status === 404) { clearFileId(); id = ''; } // file vanished remotely -> recreate below
    else { await ensureOk(res); return; }
  }
  const meta = await ensureOk(await authed(p, 'https://www.googleapis.com/drive/v3/files',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FILE() }) }));
  const created = await meta.json();
  if (!created.id) throw new Error('Drive create returned no file id');
  setFileId(created.id);
  await ensureOk(await authed(p, `https://www.googleapis.com/upload/drive/v3/files/${created.id}?uploadType=media`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text }));
}

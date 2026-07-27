// OAuth 2.0 (PKCE / implicit) + per-provider file I/O for cloud sync.
// Providers: Google Drive (appDataFolder), OneDrive (Graph app root), Yandex Disk.
// Tokens live only in localStorage under TOKENS_KEY and are never synced.
import { SYNC } from '../config.js';
import { getClientSecret } from './secret.js';

const TOKENS_KEY = 'kinetos.tokens';
const OAUTH_KEY = 'kinetos.oauth';
const GDRIVE_FILE_KEY = 'kinetos.gdrive.fileId';

function getFileId() { return localStorage.getItem(GDRIVE_FILE_KEY) || ''; }
function setFileId(id) { if (id) localStorage.setItem(GDRIVE_FILE_KEY, id); }
function clearFileId() { localStorage.removeItem(GDRIVE_FILE_KEY); }

// ---- small crypto/util helpers ----
function b64url(bytes) {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randStr(n = 64) {
  const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a).slice(0, n);
}
async function sha256b64url(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return b64url(new Uint8Array(buf));
}
function authError(msg) { const e = new Error(msg || 'auth'); e.code = 'auth'; return e; }

// ---- token storage ----
function allTokens() { try { return JSON.parse(localStorage.getItem(TOKENS_KEY) || '{}'); } catch { return {}; } }
function getTokens(p) { return allTokens()[p] || null; }
function setTokens(p, t) { const all = allTokens(); all[p] = t; localStorage.setItem(TOKENS_KEY, JSON.stringify(all)); }
export function clearTokens(p) { const all = allTokens(); delete all[p]; localStorage.setItem(TOKENS_KEY, JSON.stringify(all)); if (p === 'google') clearFileId(); }
export function hasTokens(p) { return !!(getTokens(p) && getTokens(p).access_token); }
export function isConfigured(p) { const c = SYNC.providers[p]; return !!(c && c.clientId); }

// ---- OAuth ----
export async function beginAuth(providerId) {
  const cfg = SYNC.providers[providerId];
  if (!cfg || !cfg.clientId) throw new Error('not-configured');
  const state = providerId + '.' + randStr(8);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: SYNC.redirectUri,
    response_type: cfg.flow === 'token' ? 'token' : 'code',
    scope: cfg.scope,
    state
  });
  Object.entries(cfg.extraAuthParams || {}).forEach(([k, v]) => params.set(k, v));
  let verifier = '';
  if (cfg.flow === 'pkce') {
    verifier = randStr(64);
    params.set('code_challenge', await sha256b64url(verifier));
    params.set('code_challenge_method', 'S256');
  }
  sessionStorage.setItem(OAUTH_KEY, JSON.stringify({ provider: providerId, verifier, state }));
  location.assign(cfg.authUrl + '?' + params.toString());
}

/** Handle an OAuth redirect if present. Returns the provider id or null. */
export async function handleRedirect() {
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem(OAUTH_KEY) || 'null'); } catch { return null; } })();
  const hash = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  const query = new URLSearchParams((location.search || '').replace(/^\?/, ''));

  // Implicit token flow (e.g. Yandex): token arrives in the hash fragment.
  if (hash.get('access_token')) {
    const provider = (saved && saved.provider) || (hash.get('state') || '').split('.')[0];
    if (provider) setTokens(provider, {
      access_token: hash.get('access_token'),
      expires_at: Date.now() + (parseInt(hash.get('expires_in') || '3600', 10) * 1000)
    });
    finishRedirect();
    return provider || null;
  }
  // Authorization-code + PKCE flow: exchange the code for tokens.
  if (query.get('code')) {
    const provider = (saved && saved.provider) || (query.get('state') || '').split('.')[0];
    const cfg = SYNC.providers[provider];
    if (cfg) {
      const body = new URLSearchParams({
        grant_type: 'authorization_code', code: query.get('code'),
        redirect_uri: SYNC.redirectUri, client_id: cfg.clientId
      });
      if (saved && saved.verifier) body.set('code_verifier', saved.verifier);
      const secret = await getClientSecret(provider);
      if (secret) body.set('client_secret', secret);
      try {
        const res = await fetch(cfg.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        const j = await res.json();
        if (j.access_token) setTokens(provider, {
          access_token: j.access_token, refresh_token: j.refresh_token,
          expires_at: Date.now() + ((j.expires_in || 3600) * 1000)
        });
      } catch (e) { /* leave unauthenticated */ }
    }
    finishRedirect();
    return provider || null;
  }
  return null;
}

function finishRedirect() {
  sessionStorage.removeItem(OAUTH_KEY);
  try { history.replaceState({}, document.title, SYNC.redirectUri + '#/profile'); }
  catch { location.hash = '#/profile'; }
}

async function ensureToken(provider) {
  const tk = getTokens(provider);
  if (!tk || !tk.access_token) return null;
  if (tk.expires_at && tk.expires_at - 60000 > Date.now()) return tk.access_token;
  const cfg = SYNC.providers[provider];
  if (cfg && cfg.flow === 'pkce' && tk.refresh_token) {
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tk.refresh_token, client_id: cfg.clientId });
    const secret = await getClientSecret(provider);
    if (secret) body.set('client_secret', secret);
    try {
      const res = await fetch(cfg.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const j = await res.json();
      if (j.access_token) { setTokens(provider, { access_token: j.access_token, refresh_token: tk.refresh_token, expires_at: Date.now() + ((j.expires_in || 3600) * 1000) }); return j.access_token; }
    } catch (e) { /* fall through */ }
  }
  return tk.access_token; // may be expired; caller handles 401
}

async function authed(provider, url, opts = {}) {
  const token = await ensureToken(provider);
  if (!token) throw authError();
  const scheme = provider === 'yandex' ? 'OAuth' : 'Bearer';
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: scheme + ' ' + token } });
  if (res.status === 401) throw authError();
  return res;
}

/** Throw a descriptive error for a non-OK response (404 optionally allowed). */
async function ensureOk(res, { allow404 = false } = {}) {
  if (res.ok) return res;
  if (allow404 && res.status === 404) return res;
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

// ---- file adapters: download() -> {text|null}, upload(text) ----
const FILE = () => SYNC.fileName;

const adapters = {
  // Uses the drive.file scope: the app only sees files it created. We create a
  // regular file named kinetos.json and remember its id locally.
  async googleDownload(p) {
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
  },
  async googleUpload(p, text) {
    const { id } = await adapters.googleDownload(p);
    if (id) {
      await ensureOk(await authed(p, `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text }));
    } else {
      const meta = await ensureOk(await authed(p, 'https://www.googleapis.com/drive/v3/files',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FILE() }) }));
      const created = await meta.json();
      if (!created.id) throw new Error('Drive create returned no file id');
      setFileId(created.id);
      await ensureOk(await authed(p, `https://www.googleapis.com/upload/drive/v3/files/${created.id}?uploadType=media`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text }));
    }
  },
  async onedriveDownload(p) {
    const res = await authed(p, `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${FILE()}:/content`);
    if (res.status === 404) return { text: null };
    await ensureOk(res);
    return { text: await res.text() };
  },
  async onedriveUpload(p, text) {
    await ensureOk(await authed(p, `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${FILE()}:/content`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text }));
  },
  async yandexDownload(p) {
    const meta = await authed(p, `https://cloud-api.yandex.net/v1/disk/resources/download?path=${encodeURIComponent('app:/' + FILE())}`);
    if (meta.status === 404) return { text: null };
    await ensureOk(meta);
    const { href } = await meta.json();
    const res = await fetch(href);           // href is pre-signed, no auth header
    if (!res.ok) return { text: null };
    return { text: await res.text() };
  },
  async yandexUpload(p, text) {
    const meta = await ensureOk(await authed(p, `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent('app:/' + FILE())}&overwrite=true`));
    const { href } = await meta.json();
    await ensureOk(await fetch(href, { method: 'PUT', body: text }));
  }
};

export async function download(provider) {
  if (provider === 'google') return adapters.googleDownload(provider);
  if (provider === 'onedrive') return adapters.onedriveDownload(provider);
  if (provider === 'yandex') return adapters.yandexDownload(provider);
  throw new Error('unknown-provider');
}
export async function upload(provider, text) {
  if (provider === 'google') return adapters.googleUpload(provider, text);
  if (provider === 'onedrive') return adapters.onedriveUpload(provider, text);
  if (provider === 'yandex') return adapters.yandexUpload(provider, text);
  throw new Error('unknown-provider');
}

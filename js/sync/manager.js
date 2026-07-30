// Sync orchestration: connect/disconnect, pull+merge, push, auto-schedule.
//
// Trigger policy — this is the part shaped by the GIS token model. Background
// triggers (the interval, `online`, tab-hide, app-open) only run when a *live*
// access token is already in hand; they never try to authorize, because Google's
// popup requires a user gesture and there is none in those code paths. When the
// token has lapsed we keep `dirty` set, flag needsAuth and surface a tap: a
// toast with a Sync action on open, plus the Profile card. Nothing is lost by
// deferring — every sync is a full pull+merge+push, so a later one converges
// exactly the same way.
import { SYNC } from '../config.js';
import * as prov from './providers.js';
import { serialize, mergeRemote, subscribe, getSettings, setSettings, flushPersist } from '../store.js';
import { toast } from '../ui.js';
import { t } from '../i18n.js';

const META_KEY = 'kinetos.sync.meta';

let status = 'idle';       // idle | syncing | ok | error | needsAuth | offline
let message = '';
let dirty = false;
let applying = false;      // true while we apply a remote snapshot (don't mark dirty)
let intervalId = null;
const listeners = new Set();

function meta() { try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; } }
function setMeta(patch) { localStorage.setItem(META_KEY, JSON.stringify({ ...meta(), ...patch })); }

function emit() { listeners.forEach((fn) => fn(getStatus())); }
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function getStatus() {
  const p = provider();
  return {
    status, message, dirty, provider: p,
    connected: isConnected(),
    // `connected` means a grant exists on this device; `live` means the token
    // hasn't expired yet. Only `live` allows syncing without a user tap.
    live: !!p && prov.hasLiveToken(p),
    lastSyncedAt: meta().lastSyncedAt || null,
    configured: p ? prov.isConfigured(p) : false
  };
}

export function provider() { return (getSettings().sync || {}).provider || ''; }
export function isConnected() { const p = provider(); return !!p && prov.hasTokens(p); }
export function providerConfigured(p) { return prov.isConfigured(p); }

function setStatus(s, msg = '') { status = s; message = msg; emit(); }

function online() { return typeof navigator === 'undefined' || navigator.onLine !== false; }
function canSyncSilently() { const p = provider(); return !!p && prov.hasLiveToken(p) && online(); }

/**
 * Warm up the authorization library. Async and safe to call any time — do it
 * while rendering sync UI so a later click can open the popup with no awaiting
 * (see js/sync/gis.js: `await` destroys the user activation the popup needs).
 */
export function prepareAuth() {
  const p = provider();
  if (!p || !prov.isConfigured(p)) return Promise.resolve(false);
  if (prov.authReady(p)) return Promise.resolve(true);
  if (!online()) return Promise.resolve(false); // nothing to fetch it from
  return prov.prepareAuth(p).then(() => true).catch((e) => {
    console.warn('sync: authorization library failed to load', e);
    return false;
  });
}

/**
 * Authorize, then sync. MUST be called directly from a user gesture (button
 * onclick, toast action) — do not await anything before it.
 */
export function authorize() {
  const p = provider();
  if (!p || !prov.isConfigured(p)) { setStatus('error', 'not-configured'); return Promise.resolve(); }
  if (!prov.authReady(p)) {
    // Loading the library here would mean awaiting inside the gesture, after
    // which the popup gets blocked. Load it now, ask for a second tap — and
    // carry the action along so the retry doesn't mean a trip to Profile.
    toast(t('sync.authPreparing'), { duration: 6000, action: t('sync.reauthAction'), onAction: () => authorize() });
    prepareAuth().then((ok) => { if (!ok) setStatus('error', 'auth-unavailable'); });
    setStatus('needsAuth');
    return Promise.resolve();
  }
  setStatus('syncing');
  return prov.requestAuth(p).then(() => {
    lastReauthPromptAt = 0; // authorized again: don't hold the nudge back later
    return syncNow();
  }).catch((e) => {
    const code = e && e.code;
    if (code === 'cancelled' || code === 'busy') setStatus('needsAuth');
    else if (code === 'popup') setStatus('needsAuth', t('sync.popupBlocked'));
    else setStatus('error', (e && e.message) || 'auth');
  });
}

/** Choose a provider and authorize it. Call from a user gesture. */
export function connect(providerId) {
  setSettings({ sync: { ...(getSettings().sync || {}), provider: providerId } });
  if (!prov.isConfigured(providerId)) { setStatus('error', 'not-configured'); return Promise.resolve(); }
  return authorize();
}

export function disconnect() {
  const p = provider();
  if (p) {
    // Reads the token synchronously before we drop it, then revokes in the
    // background — the grant shouldn't outlive the disconnect.
    revokeQuietly(p);
    prov.clearTokens(p);
  }
  setSettings({ sync: { provider: '' } });
  setStatus('idle');
}

function revokeQuietly(p) {
  try { prov.revokeAuth(p).catch(() => {}); } catch (e) { /* best effort */ }
}

async function pull() {
  const p = provider();
  const remote = await prov.download(p); // { text, id? }
  const text = remote && remote.text;
  if (text) {
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = null; }
    if (parsed) { applying = true; try { mergeRemote(parsed); } finally { applying = false; } }
  }
  return remote || { text: null };
}
async function push(remote) {
  flushPersist(); // make sure any debounced write is on disk before we snapshot
  const text = serialize();
  // Clear dirty at snapshot time: edits made while the upload is in flight land
  // after serialize() and re-set dirty via subscribe(), so they aren't lost.
  dirty = false;
  // Skip the write when the remote file already holds exactly what we'd upload.
  // (remote is the result of the pull that just ran.)
  if (!(remote && remote.text === text)) {
    try { await prov.upload(provider(), text, remote); }
    catch (e) { dirty = true; throw e; }
  }
  setMeta({ lastSyncedAt: new Date().toISOString() });
}

// Single-flight guard: manual button, the interval, the online handler and the
// hidden-tab hook can all fire — only one sync runs at a time; overlapping
// requests coalesce into one follow-up run.
let inFlight = null;
let runAgain = false;

/**
 * Full sync: pull + merge, then push. Never pushes without merging first.
 * Requires a live token — it will not authorize, so it is safe to call from
 * timers and event handlers. Use authorize() when a tap is available.
 */
export function syncNow() {
  const p = provider();
  if (!p || !prov.hasTokens(p)) { setStatus('needsAuth'); return Promise.resolve(); }
  if (!online()) { setStatus('offline'); return Promise.resolve(); }
  if (!prov.hasLiveToken(p)) { setStatus('needsAuth'); return Promise.resolve(); }
  if (inFlight) { runAgain = true; return inFlight; }
  setStatus('syncing');
  inFlight = (async () => {
    try {
      const remote = await pull();
      await push(remote);
      setStatus('ok');
    } catch (e) {
      console.error('Kinetos sync error:', e);
      setStatus(e && e.code === 'auth' ? 'needsAuth' : 'error', (e && e.message) || '');
    } finally {
      inFlight = null;
      if (runAgain) { runAgain = false; if (dirty) autoSync(); }
    }
  })();
  return inFlight;
}

/** Background trigger: sync only when it can happen without asking for a tap. */
function autoSync() {
  if (canSyncSilently()) { syncNow(); return; }
  const p = provider();
  if (p && prov.hasTokens(p) && online()) { setStatus('needsAuth'); promptReauth(); }
}

// Re-auth nudge. A token lapsing mid-session must still surface — it isn't a
// boot-only event — so this is throttled rather than once-per-run, and it stays
// a toast rather than a dialog because in heavy use it recurs hourly.
const REAUTH_PROMPT_EVERY_MS = 30 * 60 * 1000;
let lastReauthPromptAt = 0;
let reauthScheduled = false;
function promptReauth() {
  if (reauthScheduled) return;
  if (Date.now() - lastReauthPromptAt < REAUTH_PROMPT_EVERY_MS) return;
  // No point toasting a page nobody is looking at (tab-hide is a trigger).
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  reauthScheduled = true;
  setTimeout(() => {
    reauthScheduled = false;
    const p = provider();
    if (!p || !prov.hasTokens(p) || prov.hasLiveToken(p) || !online()) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    // Burn the throttle only when a toast is actually shown.
    lastReauthPromptAt = Date.now();
    toast(dirty ? t('sync.reauthDirty') : t('sync.reauthIdle'), {
      action: t('sync.reauthAction'),
      duration: 8000,
      // A toast action click is a real user gesture, so authorize() can open the
      // Google popup straight from here.
      onAction: () => authorize()
    });
  }, 1200);
}

/** Called once on boot. Wires triggers, kicks a sync or asks for a tap. */
export async function init() {
  // 1) mark data dirty on any user change (not while applying a remote snapshot)
  subscribe(() => { if (!applying) { dirty = true; emit(); } });

  // 2) periodic sync if something changed
  const everyMs = Math.max(1, SYNC.autoEveryMinutes || 10) * 60000;
  clearInterval(intervalId);
  intervalId = setInterval(() => { if (dirty) autoSync(); }, everyMs);

  // 3) best-effort sync when the tab is hidden/closed. A full pull+merge+push —
  //    a blind push here could overwrite what another device wrote in between.
  //    No popup is possible on a page that's going away, so a lapsed token just
  //    leaves the data dirty for the next open.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirty) autoSync();
  });
  // Coming back online is also the moment the auth library becomes fetchable.
  window.addEventListener('online', () => { prepareAuth(); if (dirty) autoSync(); });

  const p = provider();
  if (!p || !prov.isConfigured(p) || !prov.hasTokens(p)) return;

  // 4) warm the authorization library so buttons can open their popup instantly
  if (online()) prepareAuth();

  // 5) sync on open (in the background — don't block UI), or ask for the tap a
  //    lapsed token needs. Offer it even when nothing local changed: a pull is
  //    how this device learns what the others logged.
  if (prov.hasLiveToken(p)) { setTimeout(() => syncNow(), 400); return; }
  setStatus('needsAuth');
  promptReauth();
}

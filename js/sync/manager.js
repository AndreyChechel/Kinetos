// Sync orchestration: connect/disconnect, pull+merge, push, auto-schedule.
// Trigger policy: on app open, on manual "Sync now", and every N minutes if the
// data changed. Pull merges (union collections, last-write-wins scalars) then push.
import { SYNC } from '../config.js';
import * as prov from './providers.js';
import { forgetSecrets } from './secret.js';
import { serialize, mergeRemote, subscribe, getSettings, setSettings, flushPersist } from '../store.js';

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
  return { status, message, dirty, provider: provider(), connected: isConnected(), lastSyncedAt: meta().lastSyncedAt || null, configured: provider() ? prov.isConfigured(provider()) : false };
}

export function provider() { return (getSettings().sync || {}).provider || ''; }
export function isConnected() { const p = provider(); return !!p && prov.hasTokens(p); }
export function providerConfigured(p) { return prov.isConfigured(p); }

function setStatus(s, msg = '') { status = s; message = msg; emit(); }

/** Choose a provider and start its OAuth login (redirects away). */
export async function connect(providerId) {
  setSettings({ sync: { ...(getSettings().sync || {}), provider: providerId } });
  if (!prov.isConfigured(providerId)) { setStatus('error', 'not-configured'); return; }
  await prov.beginAuth(providerId); // navigates to the provider
}

export function disconnect() {
  const p = provider();
  if (p) prov.clearTokens(p);
  forgetSecrets();
  setSettings({ sync: { provider: '' } });
  setStatus('idle');
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

/** Full sync: pull + merge, then push. Never pushes without merging first. */
export function syncNow() {
  if (!isConnected()) { setStatus('needsAuth'); return Promise.resolve(); }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { setStatus('offline'); return Promise.resolve(); }
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
      if (runAgain) { runAgain = false; if (dirty) syncNow(); }
    }
  })();
  return inFlight;
}

/** Called once on boot. Handles OAuth redirect, wires triggers, kicks a sync. */
export async function init() {
  // 1) finish an OAuth redirect if we just came back from a provider
  try {
    const p = await prov.handleRedirect();
    if (p) setSettings({ sync: { ...(getSettings().sync || {}), provider: p } });
  } catch (e) {
    // A failed token exchange used to be swallowed, leaving the user looking
    // "connected" with no tokens. Surface it so Profile shows the error.
    console.warn('sync: OAuth redirect failed', e);
    setStatus('error', (e && e.message) || 'auth');
  }

  // 2) mark data dirty on any user change (not while applying a remote snapshot)
  subscribe(() => { if (!applying) { dirty = true; emit(); } });

  // 3) periodic push if something changed
  const everyMs = Math.max(1, SYNC.autoEveryMinutes || 10) * 60000;
  clearInterval(intervalId);
  intervalId = setInterval(() => { if (dirty && isConnected() && navigator.onLine !== false) syncNow(); }, everyMs);

  // 4) best-effort sync when the tab is hidden/closed. A full pull+merge+push —
  //    a blind push here could overwrite what another device wrote in between.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirty && isConnected() && navigator.onLine !== false) {
      syncNow().catch(() => { /* status already set inside syncNow */ });
    }
  });
  window.addEventListener('online', () => { if (dirty && isConnected()) syncNow(); });

  // 5) sync on open (in the background — don't block UI)
  if (isConnected()) setTimeout(() => syncNow(), 400);
}

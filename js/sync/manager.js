// Sync orchestration: connect/disconnect, pull+merge, push, auto-schedule.
// Trigger policy: on app open, on manual "Sync now", and every N minutes if the
// data changed. Pull merges (union collections, last-write-wins scalars) then push.
import { SYNC } from '../config.js';
import * as prov from './providers.js';
import { forgetSecrets } from './secret.js';
import { serialize, mergeRemote, subscribe, getSettings, setSettings } from '../store.js';

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
  const text = serialize();
  // Skip the write when the remote file already holds exactly what we'd upload.
  // (remote is the result of the pull that just ran; absent on best-effort pushes.)
  if (!(remote && remote.text === text)) {
    await prov.upload(provider(), text, remote);
  }
  dirty = false;
  setMeta({ lastSyncedAt: new Date().toISOString() });
}

/** Full sync: pull + merge, then push. */
export async function syncNow() {
  if (!isConnected()) { setStatus('needsAuth'); return; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { setStatus('offline'); return; }
  setStatus('syncing');
  try {
    const remote = await pull();
    await push(remote);
    setStatus('ok');
  } catch (e) {
    console.error('Kinetos sync error:', e);
    setStatus(e && e.code === 'auth' ? 'needsAuth' : 'error', (e && e.message) || '');
  }
}

/** Called once on boot. Handles OAuth redirect, wires triggers, kicks a sync. */
export async function init() {
  // 1) finish an OAuth redirect if we just came back from a provider
  try {
    const p = await prov.handleRedirect();
    if (p) setSettings({ sync: { ...(getSettings().sync || {}), provider: p } });
  } catch (e) { /* ignore */ }

  // 2) mark data dirty on any user change (not while applying a remote snapshot)
  subscribe(() => { if (!applying) { dirty = true; emit(); } });

  // 3) periodic push if something changed
  const everyMs = Math.max(1, SYNC.autoEveryMinutes || 10) * 60000;
  clearInterval(intervalId);
  intervalId = setInterval(() => { if (dirty && isConnected() && navigator.onLine !== false) syncNow(); }, everyMs);

  // 4) best-effort push when the tab is hidden/closed
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirty && isConnected()) { try { push(); } catch (e) {} }
  });
  window.addEventListener('online', () => { if (dirty && isConnected()) syncNow(); });

  // 5) sync on open (in the background — don't block UI)
  if (isConnected()) setTimeout(() => syncNow(), 400);
}

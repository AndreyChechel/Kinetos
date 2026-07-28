// Service-worker registration, update-available notification, install prompt.
let deferredPrompt = null;
const listeners = new Set();
const updateListeners = new Set();

/** fn(apply) is called when a new version is installed and waiting; calling
 *  apply() activates it (the page reloads via controllerchange). */
export function onUpdateAvailable(fn) { updateListeners.add(fn); return () => updateListeners.delete(fn); }
function notifyUpdate(worker) {
  const apply = () => { try { worker.postMessage({ type: 'SKIP_WAITING' }); } catch (_) { /* ignore */ } };
  updateListeners.forEach((fn) => fn(apply));
}

export function initPWA() {
  if ('serviceWorker' in navigator) {
    // Only reload on controllerchange when a controller existed before (an
    // update took over) — not on the very first install's clients.claim().
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('sw.js');
        // A new build may already be waiting (page loaded while it installed).
        if (reg.waiting && navigator.serviceWorker.controller) notifyUpdate(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) notifyUpdate(nw);
          });
        });
      } catch (e) { console.warn('SW registration failed', e); }
    });
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    listeners.forEach((fn) => fn(true));
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; listeners.forEach((fn) => fn(false)); });
}

export function canInstall() { return !!deferredPrompt; }
export function onInstallAvailability(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  listeners.forEach((fn) => fn(false));
  return outcome === 'accepted';
}

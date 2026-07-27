// Service-worker registration + install-prompt handling.
let deferredPrompt = null;
const listeners = new Set();

export function initPWA() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
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

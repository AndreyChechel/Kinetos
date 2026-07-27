/* Kinetos service worker — offline-first.
   Bump CACHE when you change app files so clients pick up updates.
   Keep the version in sync with js/version.js (APP_VERSION). */
const CACHE = 'kinetos-1.4.1';

const CORE = [
  './',
  'index.html',
  '404.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js', 'js/version.js', 'js/ui.js', 'js/store.js', 'js/i18n.js', 'js/calc.js', 'js/router.js',
  'js/svg.js', 'js/exsvg.js', 'js/sortable.js', 'js/charts.js', 'js/planedit.js',
  'js/components.js', 'js/pwa.js', 'js/workout.js', 'js/suggest.js', 'js/config.js',
  'js/sync/manager.js', 'js/sync/providers.js', 'js/sync/secret.js',
  'js/data/db.js', 'js/data/exercises.json', 'js/data/muscles.json',
  'js/views/home.js', 'js/views/exercises.js', 'js/views/plan.js', 'js/views/templates.js',
  'js/views/session.js', 'js/views/progress.js', 'js/views/profile.js',
  'locales/en.json', 'locales/de.json', 'locales/fr.json', 'locales/es.json', 'locales/ru.json',
  'assets/icons/icon.svg', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/icon-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Core files must all cache; tolerate individual failures for robustness.
    await Promise.allSettled(CORE.map((u) => cache.add(u)));
    // Precache every exercise illustration listed in the data file.
    try {
      const res = await fetch('js/data/exercises.json', { cache: 'no-cache' });
      const list = await res.json();
      await Promise.allSettled(list.map((ex) => cache.add('assets/exercises/' + ex.id + '.svg')));
    } catch (e) { /* offline first install still works with core */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // don't touch cross-origin

  // Navigation requests -> serve the cached app shell (clean-URL SPA routing).
  // Serving index.html for any in-app path (e.g. /Kinetos/plan) keeps deep-link
  // reloads instant and fully offline, and avoids the GitHub Pages 404 bounce.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const shell = (await caches.match('index.html')) || (await caches.match('./'));
      if (shell) return shell;
      try { return await fetch(req); }
      catch { return Response.error(); }
    })());
    return;
  }

  // Cache-first with runtime caching for everything else same-origin.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const clone = res.clone();
        const cache = await caches.open(CACHE);
        cache.put(req, clone);
      }
      return res;
    } catch (e) {
      return cached || Response.error();
    }
  })());
});

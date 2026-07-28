// App bootstrap: theme, i18n, routing, chrome (top bar + tabs), PWA.
import { getSettings, subscribe } from './store.js';
import { initI18n, setLang, applyDOM, t } from './i18n.js';
import { loadDB } from './data/db.js';
import { defineRoutes, startRouter, back, navigate, refresh } from './router.js';
import { initPWA, onUpdateAvailable } from './pwa.js';
import * as sync from './sync/manager.js';
import { qs, qsa, toast } from './ui.js';

import renderHome from './views/home.js';
import { renderExerciseList, renderExerciseDetail } from './views/exercises.js';
import { renderCalendar, renderPlanEditor } from './views/plan.js';
import { renderTemplateList, renderTemplateEditor } from './views/templates.js';
import renderSession from './views/session.js';
import renderProgress from './views/progress.js';
import renderProfile from './views/profile.js';

const viewEl = qs('#view');
const titleEl = qs('#topbarTitle');
const backBtn = qs('#backBtn');
const actionsEl = qs('#topbarActions');

// ---- Theme ----
const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');
export function applyTheme() {
  const setting = getSettings().theme || 'system';
  const dark = setting === 'dark' || (setting === 'system' && darkMedia.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0b1220' : '#ffffff');
}
darkMedia.addEventListener('change', applyTheme);

// ---- Chrome / view mounting ----
function makeCtx() {
  return {
    setTitle: (txt) => {
      titleEl.textContent = txt;
      document.title = txt && txt !== t('app.name') ? txt + ' — ' + t('app.name') : t('app.name');
    },
    setActions: (nodes) => {
      actionsEl.innerHTML = '';
      [].concat(nodes || []).forEach((n) => n && actionsEl.appendChild(n));
    },
    navigate
  };
}

function show(renderFn, meta, params) {
  viewEl.innerHTML = '';
  viewEl.className = 'view view--' + (meta.tab || 'home');
  actionsEl.innerHTML = '';
  backBtn.hidden = !meta.back;
  qsa('.tabbar__item').forEach((a) => {
    const active = a.dataset.tab === meta.tab;
    a.classList.toggle('is-active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const ctx = makeCtx();
  ctx.setTitle(meta.title ? t(meta.title) : t('app.name'));
  window.scrollTo(0, 0);
  viewEl.scrollTop = 0;
  Promise.resolve(renderFn(viewEl, params || {}, ctx)).catch((e) => {
    console.error('view error', e);
    viewEl.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = t('app.error');
    viewEl.appendChild(p);
  });
}

function routes() {
  defineRoutes({
    '/': (p) => show(renderHome, { tab: 'home', title: 'app.name' }, p),
    '/exercises': (p) => show(renderExerciseList, { tab: 'exercises', title: 'exercises.title' }, p),
    '/exercises/:id': (p) => show(renderExerciseDetail, { tab: 'exercises', back: true }, p),
    '/plan': (p) => show(renderCalendar, { tab: 'plan', title: 'plan.title' }, p),
    '/plan/new': (p) => show(renderPlanEditor, { tab: 'plan', back: true, title: 'plan.schedule' }, { id: null }),
    '/plan/:id': (p) => show(renderPlanEditor, { tab: 'plan', back: true }, p),
    '/templates': (p) => show(renderTemplateList, { tab: 'plan', back: true, title: 'templates.title' }, p),
    '/templates/new': (p) => show(renderTemplateEditor, { tab: 'plan', back: true, title: 'templates.new' }, { id: null }),
    '/templates/:id': (p) => show(renderTemplateEditor, { tab: 'plan', back: true }, p),
    '/session/:id': (p) => show(renderSession, { tab: 'home', back: true, title: 'session.title' }, p),
    '/progress': (p) => show(renderProgress, { tab: 'progress', title: 'progress.title' }, p),
    '/profile': (p) => show(renderProfile, { tab: 'profile', title: 'profile.title' }, p)
  }, { notFound: () => navigate('/') });
}

// ---- Language switching re-renders current view ----
export async function changeLanguage(code) {
  await setLang(code);
  applyDOM();
  refresh(); // re-run current route
}

async function boot() {
  applyTheme();
  backBtn.addEventListener('click', () => back());
  // Intercept internal nav links (data-route) for SPA navigation without reload.
  // Real hrefs are kept so open-in-new-tab / right-click still work.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[data-route]');
    if (!a) return;
    e.preventDefault();
    navigate(a.dataset.route);
  });
  initPWA();
  await Promise.all([initI18n(getSettings().lang), loadDB()]);
  applyDOM();
  // A new build is installed and waiting — let the user apply it when ready
  // instead of yanking the running page over to new assets mid-session.
  onUpdateAvailable((apply) => toast(t('toast.updateAvailable'), { action: t('toast.reload'), duration: 10000, onAction: apply }));
  // localStorage write failed (quota?) — tell the user before they lose data.
  window.addEventListener('store:persist-error', () => toast(t('toast.saveFailed'), { duration: 6000 }));
  // Ask the browser not to evict our storage under pressure.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  try { await sync.init(); } catch (e) { console.warn('sync init failed', e); }
  routes();
  startRouter();
  // React to store changes that affect theme/lang globally is handled per-view.
  subscribe(() => { /* views manage their own refresh */ });
}

boot();

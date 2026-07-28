// Minimal History-API router. Routes are patterns like '/exercises/:id'.
// Clean URLs (no '#'): the home page is the bare base path, other routes are
// base + '/plan' etc. The base path is read from the document's <base href>, so
// the same code works at the domain root and at a GitHub Pages '/repo/' subpath.
// Deep-link reloads rely on 404.html (GitHub Pages) + the service worker shell.

let routes = [];
let notFound = null;
let onNavigate = null;
let navGuard = null;   // editor views set this to intercept leaving with unsaved changes
let lastPath = null;   // last successfully rendered in-app path

// App base path with a trailing slash, e.g. '/' or '/Kinetos/'.
// document.baseURI comes from the <base href> set in index.html.
const BASE = new URL('.', document.baseURI).pathname;

function parse(pattern) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  return { rx, keys };
}

export function defineRoutes(table, opts = {}) {
  routes = Object.entries(table).map(([pattern, handler]) => ({ pattern, handler, ...parse(pattern) }));
  notFound = opts.notFound || null;
  onNavigate = opts.onNavigate || null;
}

// Current in-app route (base stripped), always starting with '/'. Includes any query string.
export function currentPath() {
  let p = location.pathname;
  const baseNoSlash = BASE.replace(/\/$/, ''); // '' at root, '/Kinetos' at a subpath
  if (baseNoSlash && p.startsWith(baseNoSlash)) p = p.slice(baseNoSlash.length);
  if (!p.startsWith('/')) p = '/' + p;
  return p + location.search;
}

// Build an absolute URL for an in-app path like '/plan' or '/'.
export function href(path) {
  return BASE + String(path).replace(/^\//, '');
}

export function navigate(path) {
  const clean = String(path).split('?')[0];
  if (currentPath().split('?')[0] === clean) { handle(); return; }
  history.pushState({}, '', href(path));
  handle();
}

export function back() {
  if (history.length > 1) history.back();
  else navigate('/');
}

// Re-run the current route (used after a language switch re-renders the view).
export function refresh() { handle(); }

/** Register a guard called before leaving the current route. Return false to
 *  stay (the URL is restored). Cleared automatically once a navigation passes. */
export function setNavGuard(fn) { navGuard = fn; }
export function clearNavGuard(fn) { if (!fn || navGuard === fn) navGuard = null; }

function handle() {
  const path = currentPath() || '/';
  if (navGuard && lastPath && path.split('?')[0] !== lastPath.split('?')[0]) {
    if (!navGuard()) {
      // Rejected: restore the previous URL (covers both pushState and popstate).
      history.replaceState({}, '', href(lastPath));
      return;
    }
    navGuard = null;
  }
  // Let views react to navigation (e.g. stop the session timer) before re-render.
  window.dispatchEvent(new Event('route:change'));
  lastPath = path;
  const clean = path.split('?')[0];
  for (const r of routes) {
    const m = clean.match(r.rx);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      if (onNavigate) onNavigate(r.pattern, params, path);
      r.handler(params, path);
      return;
    }
  }
  if (notFound) notFound(path);
}

export function startRouter() {
  window.addEventListener('popstate', handle);
  handle();
}

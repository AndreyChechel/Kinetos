// Minimal hash router. Routes are patterns like '/exercises/:id'.

let routes = [];
let notFound = null;
let onNavigate = null;

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

export function currentPath() {
  const h = location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : '/' + h;
}

export function navigate(path) {
  if (currentPath() === path) { handle(); return; }
  location.hash = path;
}

export function back() {
  if (history.length > 1) history.back();
  else navigate('/');
}

function handle() {
  const path = currentPath() || '/';
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
  window.addEventListener('hashchange', handle);
  if (!location.hash) location.hash = '/';
  handle();
}

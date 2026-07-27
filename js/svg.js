// Fetch-and-inline SVGs so they inherit theme colors (currentColor + CSS classes).
const cache = new Map();

export async function loadSVG(path) {
  if (cache.has(path)) return cache.get(path);
  const p = fetch(path, { cache: 'force-cache' })
    .then((r) => (r.ok ? r.text() : ''))
    .catch(() => '');
  cache.set(path, p);
  return p;
}

/** Inject an SVG file's markup into a container element. */
export async function injectSVG(el, path) {
  if (!el) return;
  const text = await loadSVG(path);
  if (text) el.innerHTML = text;
}

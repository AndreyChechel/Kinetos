// Fetch-and-inline SVGs so they inherit theme colors (currentColor + CSS classes).
import { buildExerciseSVG } from './exsvg.js';
import { svgPath, isCustom } from './data/db.js';

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

const reduceMotion = () => typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Built-in exercise art is animated (SMIL). Only the full-size detail
 *  illustration (.illus) plays; thumbnails, and everything when the user
 *  prefers reduced motion, freeze on frame 0 (the start position). */
function settleAnimation(el) {
  const svg = el.querySelector('svg');
  if (!svg || typeof svg.pauseAnimations !== 'function') return;
  const play = el.classList.contains('illus') && !el.classList.contains('illus--sm') && !reduceMotion();
  if (play) return;
  svg.pauseAnimations();
  try { svg.setCurrentTime(0); } catch { /* not ready: stays at start */ }
}

/** Inject an exercise illustration: generated markup for custom exercises
 *  (no pre-rendered file exists), otherwise the built-in art file. */
export function injectExerciseSVG(el, ex) {
  if (!el || !ex) return;
  if (isCustom(ex)) { el.innerHTML = buildExerciseSVG(ex); return; }
  injectSVG(el, svgPath(ex)).then(() => settleAnimation(el));
}

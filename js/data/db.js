// Exercise database access. Loads built-in JSON once, merges user custom
// exercises from the store, exposes query helpers. Extensible: add rows to
// exercises.json (and an SVG) or let users add custom ones at runtime.

import { getCustomExercises, isExerciseHidden } from '../store.js';
import { pick } from '../i18n.js';

let builtin = [];
let muscleMeta = { groups: [], muscles: [] };
let loaded = false;

export async function loadDB() {
  if (loaded) return;
  const [ex, mu] = await Promise.all([
    fetch('js/data/exercises.json', { cache: 'no-cache' }).then((r) => r.json()),
    fetch('js/data/muscles.json', { cache: 'no-cache' }).then((r) => r.json())
  ]);
  builtin = ex;
  muscleMeta = mu;
  loaded = true;
}

/** Everything, including soft-deleted custom exercises — used to resolve ids in history. */
export function allExercises() {
  return [...builtin, ...getCustomExercises()];
}

/** Exercises to show when browsing: drops soft-deleted, and hidden unless asked. */
export function browseExercises({ includeHidden = false } = {}) {
  return allExercises().filter((e) => !e.deleted && (includeHidden || !isExerciseHidden(e.id)));
}

export function isCustom(ex) { return !!(ex && ex.custom); }

export function getExercise(id) {
  return allExercises().find((e) => e.id === id);
}

export function groups() { return muscleMeta.groups; }
export function muscles() { return muscleMeta.muscles; }

/** Localized display name for an exercise. */
export function exName(ex) { return ex ? pick(ex.names) : ''; }

/** Group -> list of exercises, honoring current filter/search. */
export function byGroup(filterGroup = 'all', query = '', { includeHidden = false } = {}) {
  const q = query.trim().toLowerCase();
  const list = browseExercises({ includeHidden }).filter((e) => {
    if (filterGroup !== 'all' && e.group !== filterGroup) return false;
    if (!q) return true;
    return Object.values(e.names || {}).some((n) => n.toLowerCase().includes(q))
      || e.id.includes(q);
  });
  const grouped = {};
  for (const g of muscleMeta.groups) grouped[g] = [];
  grouped._other = [];
  for (const e of list) (grouped[e.group] || grouped._other).push(e);
  return grouped;
}

/** SVG path for an exercise (built-in art or custom fallback). */
export function svgPath(ex) {
  return `assets/exercises/${ex.id}.svg`;
}

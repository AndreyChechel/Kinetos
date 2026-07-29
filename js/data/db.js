// Exercise database access. Loads built-in JSON once, merges user custom
// exercises from the store, exposes query helpers. Extensible: add rows to
// exercises.json (and an SVG) or let users add custom ones at runtime.

import { getCustomExercises, isExerciseHidden, getSettings } from '../store.js';
import { pick, t } from '../i18n.js';

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

// --- Dumbbell weight handling ---------------------------------------------
// A dumbbell exercise can be logged two ways (Profile → Dumbbell weight):
//   'single' (default): user enters ONE dumbbell's weight; it counts x2 in
//                        volume / est-1RM / progress. The UI shows a "2×" badge.
//   'pair':             user enters the combined weight of both; no scaling.

/** True if this exercise is loaded with a pair of dumbbells (per-hand weight). */
export function usesDumbbell(exOrId) {
  const ex = typeof exOrId === 'string' ? getExercise(exOrId) : exOrId;
  return !!(ex && ex.equipment === 'dumbbell');
}

/** True when a "2×" multiplier is currently in effect for this exercise. */
export function isPerDumbbell(exOrId) {
  return usesDumbbell(exOrId) && (getSettings().dumbbellInput || 'single') === 'single';
}

/** Multiplier applied to the ENTERED weight when computing loads (1 or 2). */
export function weightFactor(exOrId) { return isPerDumbbell(exOrId) ? 2 : 1; }

// --- Barbell weight handling ----------------------------------------------
// A barbell exercise can be logged two ways (Profile → Barbell weight):
//   'included' (default): the logged weight already includes the bar. No change.
//   'added':              the user logs the plates only; the chosen bar weight
//                         (per set, from the configured list) is ADDED in totals.

/** True if this exercise is loaded on a barbell. */
export function usesBarbell(exOrId) {
  const ex = typeof exOrId === 'string' ? getExercise(exOrId) : exOrId;
  return !!(ex && ex.equipment === 'barbell');
}

/** True when the bar weight should be added on top of the entered weight. */
export function barbellAdded() { return (getSettings().barbellInput || 'included') === 'added'; }

/** True when the per-set bar chooser / +bar rule is active for this exercise. */
export function isBarbellAdded(exOrId) { return usesBarbell(exOrId) && barbellAdded(); }

/** Configured selectable bar weights (kg); first entry is the default. */
export function barbellWeights() {
  const w = getSettings().barbellWeights;
  return (Array.isArray(w) && w.length) ? w : [20, 10, 5];
}
export function defaultBarKg() { return barbellWeights()[0]; }

/** Resolve the bar weight for a set (its stored choice, else the default). */
export function barKgOf(set) { return (set && set.barKg != null) ? set.barKg : defaultBarKg(); }

/** Effective load for calculations from an exercise (or id) + entered weight.
 *  `set` is optional but lets the barbell rule read the set's chosen bar. */
export function effectiveWeight(exOrId, weightKg, set) {
  if (weightKg == null) return weightKg;
  if (isBarbellAdded(exOrId)) return weightKg + barKgOf(set);
  return weightKg * weightFactor(exOrId);
}

/** Resolver for calc.js sessionVolume: entry-aware effective set weight. */
export function volumeWeightOf(set, entry) {
  return effectiveWeight(entry && entry.exerciseId, set.weightKg, set) || 0;
}

// --- Rep presets ------------------------------------------------------------
// The quick-pick rep counts offered by the rep chooser. Configurable in
// Profile (like the bar weights) so 5×5 / 3×3 lifters aren't stuck with 6–20.
const DEFAULT_REP_PRESETS = [6, 8, 10, 12, 15, 20];

/** Configured quick-pick rep counts (ascending, de-duplicated). */
export function repPresets() {
  const raw = getSettings().repPresets;
  const list = [...new Set((Array.isArray(raw) ? raw : []).map(Number).filter((n) => Number.isFinite(n) && n > 0))]
    .sort((a, b) => a - b);
  return list.length ? list : DEFAULT_REP_PRESETS.slice();
}

// --- Counted exercises ('count' metric) ------------------------------------
// Some machines are logged as a plain tally rather than reps/time/distance —
// e.g. a stair stepper counts stairs. The exercise carries a `countUnit` key
// that resolves to a localized label; time comes from the set runner's clock.

/** True when this exercise is logged as a counted tally. */
export function usesCount(exOrId) {
  const ex = typeof exOrId === 'string' ? getExercise(exOrId) : exOrId;
  return !!(ex && ex.metric === 'count');
}

/** Localized unit label for a counted exercise (e.g. "stairs"). */
export function countUnit(exOrId) {
  const ex = typeof exOrId === 'string' ? getExercise(exOrId) : exOrId;
  return t('units.' + ((ex && ex.countUnit) || 'count'));
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

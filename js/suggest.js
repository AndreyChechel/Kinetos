// Effort- and performance-aware target suggestions (lightweight autoregulation).
// Looks at the last session that trained an exercise, takes the reference set,
// and nudges the target using BOTH:
//   - effort rating (1=easy, 2=medium, 3=hard), and
//   - whether the logged reps hit the target (planned reps, or last time's reps).
// Priority: a missed target backs you off even if effort wasn't marked; beating
// the target pushes you up. No signals at all => steady progression.
import { getExercise } from './data/db.js';
import { getExerciseMeta } from './store.js';
import { historyFor } from './workout.js';
import { t } from './i18n.js';

// Weight increment by equipment. Barbells load in 1.25 kg plates per side;
// dumbbell racks usually step by 2 kg; machines/cables by their stack.
// A per-exercise override can be stored in exerciseMeta[id].weightStep.
const STEP_BY_EQUIPMENT = { barbell: 2.5, dumbbell: 2, machine: 2.5, cable: 2.5, band: 0, bodyweight: 0 };
const DEFAULT_STEP = 2.5;

/** The kg increment to use when progressing this exercise. */
export function weightStepFor(exOrId) {
  const ex = typeof exOrId === 'string' ? getExercise(exOrId) : exOrId;
  const meta = ex ? getExerciseMeta(ex.id) : null;
  if (meta && meta.weightStep > 0) return meta.weightStep;
  const s = ex ? STEP_BY_EQUIPMENT[ex.equipment] : undefined;
  return (s === undefined || s === 0) ? DEFAULT_STEP : s;
}

function round(n, step) { return Math.round(n / step) * step; }
function round1(n) { return Math.round(n * 10) / 10; }
function heaviest(sets) { return [...sets].sort((a, b) => (b.weightKg || 0) - (a.weightKg || 0) || (b.reps || 0) - (a.reps || 0))[0] || {}; }

/**
 * @returns { values, trend, reason, avgEffort, from } | null
 *   values: subset of { weightKg, reps, seconds, distanceKm, minutes }
 *   trend:  'up' | 'down' | 'steady'
 *   reason: 'Up' | 'Beat' | 'Steady' | 'Down' | 'Missed'  (=> session.reason<X> key)
 */
export function suggestNext(exerciseId, excludeSessionId) {
  const ex = getExercise(exerciseId);
  const metric = ex ? ex.metric : 'reps';
  const hist = historyFor(exerciseId, excludeSessionId);
  if (!hist.length) return null;
  const sets = hist[0].sets;

  const rated = sets.filter((s) => s.effort);
  const avgEffort = rated.length ? rated.reduce((a, s) => a + s.effort, 0) / rated.length : null;
  const effortTrend = avgEffort == null ? 'steady' : (avgEffort < 1.7 ? 'up' : (avgEffort > 2.3 ? 'down' : 'steady'));
  const base = { avgEffort, from: hist[0].session };

  if (metric === 'time') {
    const sec = (heaviestBy(sets, 'seconds').seconds) || 30;
    const [trend, reason] = pickTrend(effortTrend, false, false);
    const seconds = trend === 'up' ? sec + 15 : trend === 'down' ? Math.max(10, sec - 10) : sec + 5;
    return { ...base, trend, reason, values: { seconds } };
  }
  if (metric === 'count') {
    // Counted work (e.g. stairs) has no load to add, so progress the tally itself.
    const c = heaviestBy(sets, 'count').count || 0;
    const [trend, reason] = pickTrend(effortTrend, false, false);
    const count = trend === 'up' ? Math.round(c * 1.1) + 1 : trend === 'down' ? Math.max(1, Math.round(c * 0.9)) : c + 1;
    return { ...base, trend, reason, values: { count } };
  }
  if (metric === 'distance') {
    const ref = heaviestBy(sets, 'distanceKm');
    const km = ref.distanceKm || 0, min = ref.minutes || 0;
    const [trend, reason] = pickTrend(effortTrend, false, false);
    const distanceKm = trend === 'up' && km ? round1(km * 1.1) : km;
    return { ...base, trend, reason, values: { distanceKm, minutes: min } };
  }

  // reps (weighted or bodyweight)
  const ref = heaviest(sets);
  const w = ref.weightKg || 0;
  const r = ref.reps || 8;

  // Did we hit the target reps for the reference set?
  let missed = false, beat = false, retryReps = r;
  if (ref.targetReps != null) {
    if (r < ref.targetReps) { missed = true; retryReps = ref.targetReps; }
    else if (r > ref.targetReps) beat = true;
  } else if (hist[1]) {
    // No explicit target — compare to previous session at the same-or-lighter top weight.
    const prev = heaviest(hist[1].sets);
    const pw = prev.weightKg || 0, pr = prev.reps || 0;
    if (pw <= w && pr > r) { missed = true; retryReps = pr; }
    else if (pw === w && r > pr) beat = true;
  }

  const [trend, reason] = pickTrend(effortTrend, missed, beat);

  if (w > 0) {
    const step = weightStepFor(ex);
    if (trend === 'up') return { ...base, trend, reason, values: { weightKg: round(w + step, step), reps: r } };
    if (trend === 'down') return { ...base, trend, reason, values: { weightKg: w, reps: missed ? retryReps : r } };
    return { ...base, trend, reason, values: { weightKg: w, reps: r + 1 } };
  }
  if (trend === 'up') return { ...base, trend, reason, values: { reps: r + 2 } };
  if (trend === 'down') return { ...base, trend, reason, values: { reps: missed ? retryReps : r } };
  return { ...base, trend, reason, values: { reps: r + 1 } };
}

/** Combine effort + performance into a [trend, reason]. Missed reps wins. */
function pickTrend(effortTrend, missed, beat) {
  if (missed) return ['down', 'Missed'];
  if (effortTrend === 'down') return ['down', 'Down'];
  if (effortTrend === 'up') return ['up', 'Up'];
  if (beat) return ['up', 'Beat'];
  return ['steady', 'Steady'];
}

function heaviestBy(sets, key) { return [...sets].sort((a, b) => (b[key] || 0) - (a[key] || 0))[0] || {}; }

/** Apply a suggestion's values to a set, and record them as that set's target. */
export function applyToSet(set, sug) {
  Object.assign(set, sug.values);
  if (sug.values.reps != null) set.targetReps = sug.values.reps;
  if (sug.values.weightKg != null) set.targetWeightKg = sug.values.weightKg;
}

/** Localized "42.5 kg × 8" / "8 reps" / "45 s" / "3.2 km · 18 min" / "120 stairs".
 *  `unitLabel` names the tally for the 'count' metric (see db.countUnit). */
export function formatSuggestion(sug, metric, unitLabel) {
  const v = sug.values;
  if (metric === 'time') return `${v.seconds} ${t('common.sec')}`;
  if (metric === 'count') return `${v.count} ${unitLabel || t('units.count')}`;
  if (metric === 'distance') {
    const d = v.distanceKm ? `${v.distanceKm} ${t('units.km')}` : '';
    const m = v.minutes ? `${v.minutes} ${t('common.min')}` : '';
    return [d, m].filter(Boolean).join(' · ') || '—';
  }
  if (v.weightKg) return `${v.weightKg} ${t('units.kg')} × ${v.reps}`;
  return `${v.reps} ${t('common.reps')}`;
}

/** Localized reason line. */
export function suggestionReason(sug) {
  return t('session.reason' + (sug.reason || 'Steady'));
}

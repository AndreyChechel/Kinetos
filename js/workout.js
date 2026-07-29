// Higher-level workout helpers shared by views.
import { getSessions, saveSession, getPlan, getTemplate } from './store.js';
import { uid } from './ui.js';
import { getExercise, volumeWeightOf, effectiveWeight } from './data/db.js';
import { sessionVolume, oneRepMax } from './calc.js';

/** A set counts as performed only if it has data AND wasn't left/marked not-done.
 *  (Plan-prefilled sets carry reps but done:false until the user taps them —
 *  without this check they'd poison history, suggestions and "Previous" hints.) */
export function performed(st) {
  return !!(st && st.done !== false && (st.reps || st.seconds || st.count || st.distanceKm));
}

const DEFAULT_REPS = 12; // app-wide default target reps (feature: default to 12)

// ------------------------------------------------- plan/template row model ---
//
// A planned exercise ("target row") comes in two shapes:
//
//   simple    { exerciseId, targetSets, targetReps, targetWeightKg }
//             — every set of the exercise is prescribed alike.
//   detailed  the same fields PLUS { detailed: true, setTargets: [ … ] }
//             — one object per set, so a ramp-up, a drop set, intervals of
//               different lengths, a per-set rest or a per-set cue survive.
//
// Simple stays the default and the only shape older builds know, so detailed
// rows keep the scalars in sync (see syncTargetRow): anything that only reads
// `targetSets`/`targetReps`/`targetWeightKg` — calendar counts, the AI import
// preview, a device still running an older version after a sync — keeps working.

/** Hard cap on prescribed sets per exercise (matches the editor's stepper). */
export const MAX_SET_TARGETS = 20;

/** The metric fields a per-set target uses, per exercise metric. */
export function setTargetKeys(metric) {
  if (metric === 'time') return ['seconds'];
  if (metric === 'distance') return ['distanceKm', 'minutes'];
  if (metric === 'count') return ['count'];
  return ['reps', 'weightKg'];
}

/** True when a row prescribes each set individually. */
export function isDetailedTarget(pe) {
  return !!(pe && pe.detailed && Array.isArray(pe.setTargets) && pe.setTargets.length);
}

/** A row's per-set targets — always an array (empty for a simple row). */
export function setTargetsOf(pe) {
  return isDetailedTarget(pe) ? pe.setTargets : [];
}

/** A blank per-set target for a metric. `from` seeds the metric fields and the
 *  rest override (never the note — a cue belongs to the set it was written for). */
export function newSetTarget(metric, from) {
  const st = { restSeconds: (from && from.restSeconds) || null, note: '' };
  setTargetKeys(metric).forEach((k) => { st[k] = from ? (from[k] ?? null) : null; });
  return st;
}

/** Re-establish the row invariants: setTargets is the source of truth in
 *  detailed mode, and the legacy scalars mirror it. Call after any structural
 *  edit to `setTargets`. */
export function syncTargetRow(pe, metric) {
  if (!pe) return pe;
  if (!isDetailedTarget(pe)) {
    if (pe.detailed || pe.setTargets) { pe.detailed = false; delete pe.setTargets; }
    return pe;
  }
  pe.detailed = true;
  if (pe.setTargets.length > MAX_SET_TARGETS) pe.setTargets = pe.setTargets.slice(0, MAX_SET_TARGETS);
  pe.targetSets = pe.setTargets.length;
  if ((metric || 'reps') === 'reps') {
    // Mirror the heaviest prescribed set, the same representative a simple row
    // would have carried, so "3 × 80 kg" style summaries stay meaningful.
    let top = null;
    pe.setTargets.forEach((st) => { if (!top || (st.weightKg || 0) > (top.weightKg || 0)) top = st; });
    pe.targetReps = (top && top.reps != null) ? top.reps : null;
    pe.targetWeightKg = (top && top.weightKg) || null;
  } else {
    pe.targetReps = null;
    pe.targetWeightKg = null;
  }
  return pe;
}

/** Expand a simple row into `targetSets` identical per-set targets. */
export function toDetailedTarget(pe, metric) {
  const n = Math.max(1, Math.min(pe.targetSets || 3, MAX_SET_TARGETS));
  const seed = (metric || 'reps') === 'reps'
    ? { reps: pe.targetReps ?? DEFAULT_REPS, weightKg: pe.targetWeightKg || null }
    : null;
  pe.detailed = true;
  pe.setTargets = Array.from({ length: n }, () => newSetTarget(metric, seed));
  return syncTargetRow(pe, metric);
}

/** Collapse a detailed row back to a simple one, keeping its set count and the
 *  heaviest set as the representative target. Rest overrides and cues are lost —
 *  that is exactly what leaving per-set mode means. */
export function toSimpleTarget(pe, metric) {
  syncTargetRow(pe, metric);
  const n = pe.targetSets || 3;
  pe.detailed = false;
  delete pe.setTargets;
  pe.targetSets = n;
  if ((metric || 'reps') === 'reps' && !pe.targetReps) pe.targetReps = DEFAULT_REPS;
  return pe;
}

/** Deep copy of a target row (the nested setTargets must not be shared). */
export function cloneTargetRow(pe) {
  const row = { ...pe };
  if (Array.isArray(pe.setTargets)) row.setTargets = pe.setTargets.map((st) => ({ ...st }));
  return row;
}

/** Turn a planned/template exercise list into fresh session entries. */
export function entriesFromExerciseList(list) {
  return (list || []).map((pe) => {
    const targets = setTargetsOf(pe);
    const sets = targets.length
      ? targets.map((st, i) => setFromTarget(st, i, pe))
      : Array.from({ length: pe.targetSets || 3 }, (_, i) => setFromTarget(null, i, pe));
    return { id: uid('en'), exerciseId: pe.exerciseId, note: '', sets };
  });
}

/** One prefilled session set. `st` is the per-set target, or null for a simple
 *  row (which prescribes the same numbers for every set). */
function setFromTarget(st, i, pe) {
  const reps = st ? (st.reps ?? null) : (pe.targetReps ?? null);
  const weightKg = (st ? st.weightKg : pe.targetWeightKg) || null;
  return {
    n: i + 1,
    reps,
    weightKg,
    seconds: (st && st.seconds) ?? null,
    count: (st && st.count) ?? null,
    distanceKm: (st && st.distanceKm) ?? null,
    // A prescribed pace is a TARGET, never a prefilled value: the set runner's
    // stopwatch only fills an empty `minutes`, so prefilling it here would make
    // the plan's split masquerade as a measured one. Shown as the field's hint.
    minutes: null,
    targetMinutes: (st && st.minutes) ?? null,
    effort: null,
    targetReps: reps,
    targetWeightKg: weightKg,
    // Per-set rest override (null = use the profile default) and the planned cue.
    restSeconds: (st && st.restSeconds) || null,
    note: (st && st.note) || '',
    done: false,
    timestamp: null,
    startedAt: null,
    durationMs: null
  };
}

/** The per-set target a logged set would be re-planned as. */
function targetFromSet(set, metric) {
  const st = { restSeconds: set.restSeconds || null, note: set.note || '' };
  setTargetKeys(metric).forEach((k) => { st[k] = set[k] ?? null; });
  return st;
}

/** True when every set prescribes the same numbers (so one simple row says it all). */
function uniformSets(sets, metric) {
  const keys = setTargetKeys(metric).concat(['restSeconds', 'note']);
  const sig = (s) => keys.map((k) => JSON.stringify(s[k] ?? null)).join('|');
  const first = sig(sets[0]);
  return sets.every((s) => sig(s) === first);
}

/** Inverse of entriesFromExerciseList: turn a logged session into reusable
 *  template/plan target rows. For reps exercises the heaviest logged set is
 *  used as the representative target (entered weight is kept as-is). A session
 *  whose sets were NOT all alike becomes a detailed row — collapsing a 5/3/1
 *  ramp to its top set would silently rewrite what was actually done. */
export function targetsFromSession(session) {
  return (session.entries || []).map((e) => {
    const ex = getExercise(e.exerciseId);
    const metric = ex ? ex.metric : 'reps';
    const sets = e.sets || [];
    // The editor (and a detailed row) top out at MAX_SET_TARGETS, so a template
    // must not claim a set count it can never show.
    const row = { exerciseId: e.exerciseId, targetSets: Math.min(sets.length || 3, MAX_SET_TARGETS), targetReps: null, targetWeightKg: null };
    if (metric === 'reps') {
      let top = null;
      sets.forEach((s) => { if (!top || (s.weightKg || 0) > (top.weightKg || 0)) top = s; });
      row.targetReps = (top && top.reps != null) ? top.reps : DEFAULT_REPS;
      row.targetWeightKg = (top && top.weightKg) || null;
    }
    if (sets.length > 1 && !uniformSets(sets, metric)) {
      row.detailed = true;
      row.setTargets = sets.map((s) => targetFromSet(s, metric));
      syncTargetRow(row, metric);
    }
    return row;
  });
}

export function activeSession() {
  return getSessions().find((s) => !s.endedAt);
}

// A session left running this long is almost certainly forgotten, not active.
const STALE_SESSION_MS = 12 * 60 * 60 * 1000;

/** True for an unfinished session that has been open suspiciously long. */
export function isStaleSession(s) {
  return !!(s && !s.endedAt && (Date.now() - new Date(s.startedAt).getTime()) > STALE_SESSION_MS);
}

/** Finish a (stale) session in place: end it at the last logged set's time,
 *  or an hour after start if nothing was ever logged. */
export function autoFinishSession(s) {
  let last = null;
  (s.entries || []).forEach((e) => (e.sets || []).forEach((st) => {
    if (st.timestamp && (!last || st.timestamp > last)) last = st.timestamp;
  }));
  s.endedAt = last || new Date(new Date(s.startedAt).getTime() + 3600000).toISOString();
  saveSession(s);
}

/** True if any session (active or completed) was started from this plan —
 *  a started plan shouldn't be offered as "planned" again. */
export function planStarted(planId) {
  return !!planId && getSessions().some((s) => s.planId === planId);
}

/** Best estimated 1RM ever logged for an exercise before/outside one session. */
export function bestE1RMBefore(exerciseId, excludeSessionId) {
  let best = 0;
  completedSessions().forEach((s) => {
    if (s.id === excludeSessionId) return;
    (s.entries || []).forEach((e) => {
      if (e.exerciseId !== exerciseId) return;
      (e.sets || []).forEach((st) => {
        if (!performed(st) || !st.weightKg || !st.reps) return;
        const o = oneRepMax(effectiveWeight(exerciseId, st.weightKg, st), st.reps);
        if (o && o.avg > best) best = o.avg;
      });
    });
  });
  return best;
}

/** Consecutive training weeks (Mon-based), counting back from this week.
 *  An empty current week doesn't break the streak — it just isn't counted yet. */
export function weekStreak() {
  const weeks = new Set(completedSessions().map((s) => startOfWeek(new Date(s.startedAt)).getTime()));
  if (!weeks.size) return 0;
  let cur = startOfWeek(new Date());
  if (!weeks.has(cur.getTime())) { cur.setDate(cur.getDate() - 7); cur = startOfWeek(cur); }
  let streak = 0;
  while (weeks.has(cur.getTime())) { streak++; cur.setDate(cur.getDate() - 7); cur = startOfWeek(cur); }
  return streak;
}

export function createEmptySession(name) {
  const s = {
    id: uid('sess'),
    planId: null,
    name: name || '',
    startedAt: new Date().toISOString(),
    endedAt: null,
    notes: '',
    entries: []
  };
  saveSession(s);
  return s.id;
}

export function createSessionFromPlan(planId) {
  const plan = getPlan(planId);
  const s = {
    id: uid('sess'),
    planId,
    templateId: plan ? (plan.templateId || null) : null,
    name: plan ? plan.name : '',
    startedAt: new Date().toISOString(),
    endedAt: null,
    notes: plan ? (plan.notes || '') : '',
    entries: entriesFromExerciseList(plan ? plan.exercises : [])
  };
  saveSession(s);
  return s.id;
}

export function createSessionFromTemplate(templateId) {
  const tpl = getTemplate(templateId);
  const s = {
    id: uid('sess'),
    planId: null,
    templateId: templateId || null,
    name: tpl ? tpl.name : '',
    startedAt: new Date().toISOString(),
    endedAt: null,
    notes: tpl ? (tpl.notes || '') : '',
    entries: entriesFromExerciseList(tpl ? tpl.exercises : [])
  };
  saveSession(s);
  return s.id;
}

/** Build (but do not save) a scheduled plan seeded from a template. */
export function planFromTemplate(templateId, dateISO) {
  const tpl = getTemplate(templateId);
  return {
    id: uid('plan'),
    templateId: templateId || null,
    name: tpl ? tpl.name : '',
    date: dateISO,
    notes: tpl ? (tpl.notes || '') : '',
    exercises: tpl ? JSON.parse(JSON.stringify(tpl.exercises || [])) : []
  };
}

/** Most recent completed set data for an exercise (for "last time" prefill). */
export function lastSetFor(exerciseId, excludeSessionId) {
  return historyFor(exerciseId, excludeSessionId)[0] || null;
}

/** Completed performances for an exercise, newest first: [{session, sets}]. */
export function historyFor(exerciseId, excludeSessionId) {
  return completedSessions()
    .filter((s) => s.id !== excludeSessionId)
    .map((s) => {
      const e = (s.entries || []).find((x) => x.exerciseId === exerciseId);
      if (!e) return null;
      const sets = (e.sets || []).filter(performed);
      return sets.length ? { session: s, sets } : null;
    })
    .filter(Boolean);
}

/** ISO start date of the most recent completed session that trained an exercise. */
export function lastPerformedISO(exerciseId) {
  const h = historyFor(exerciseId)[0];
  return h ? h.session.startedAt : null;
}

/** { exerciseId: lastPerformedISO } across all completed sessions. */
export function lastPerformedMap() {
  const map = {};
  completedSessions().forEach((s) => {
    (s.entries || []).forEach((e) => {
      if (!e || !e.exerciseId || map[e.exerciseId]) return;
      const did = (e.sets || []).some(performed);
      if (did) map[e.exerciseId] = s.startedAt;
    });
  });
  return map;
}

/** True if any session (logged or active) references this exercise — governs
 *  whether deleting a custom exercise must be a soft delete to preserve history. */
export function exerciseUsedInHistory(exerciseId) {
  return getSessions().some((s) => (s.entries || []).some((e) => e.exerciseId === exerciseId));
}

/** Exercises trained most recently, newest first: [{ exerciseId, lastISO }]. */
export function recentExercises(limit = 8) {
  const seen = new Map();
  completedSessions().forEach((s) => {
    (s.entries || []).forEach((e) => {
      if (!e || !e.exerciseId || seen.has(e.exerciseId)) return;
      const did = (e.sets || []).some(performed);
      if (did) seen.set(e.exerciseId, s.startedAt);
    });
  });
  return [...seen.entries()].map(([exerciseId, lastISO]) => ({ exerciseId, lastISO }))
    .sort((a, b) => new Date(b.lastISO) - new Date(a.lastISO)).slice(0, limit);
}

export function startOfWeek(d = new Date()) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}

export function isThisWeek(iso) {
  const t = new Date(iso);
  const start = startOfWeek();
  const end = new Date(start); end.setDate(end.getDate() + 7);
  return t >= start && t < end;
}

export function completedSessions() {
  return getSessions().filter((s) => s.endedAt).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

export function weekStats() {
  const list = completedSessions().filter((s) => isThisWeek(s.startedAt));
  let volume = 0, sets = 0;
  list.forEach((s) => { const v = sessionVolume(s, volumeWeightOf); volume += v.volume; sets += v.sets; });
  return { workouts: list.length, volume, sets };
}

export function sessionDurationMs(s) {
  if (!s.startedAt) return 0;
  const end = s.endedAt ? new Date(s.endedAt) : new Date();
  return new Date(end) - new Date(s.startedAt);
}

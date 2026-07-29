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

/** Turn a planned/template exercise list into fresh session entries. */
export function entriesFromExerciseList(list) {
  return (list || []).map((pe) => ({
    id: uid('en'),
    exerciseId: pe.exerciseId,
    note: '',
    sets: Array.from({ length: pe.targetSets || 3 }, (_, i) => ({
      n: i + 1,
      reps: pe.targetReps ?? null,
      weightKg: pe.targetWeightKg || null,
      seconds: null,
      count: null,
      distanceKm: null,
      minutes: null,
      effort: null,
      targetReps: pe.targetReps ?? null,
      targetWeightKg: pe.targetWeightKg || null,
      done: false,
      timestamp: null,
      startedAt: null,
      durationMs: null
    }))
  }));
}

/** Inverse of entriesFromExerciseList: turn a logged session into reusable
 *  template/plan target rows. For reps exercises the heaviest logged set is
 *  used as the representative target (entered weight is kept as-is). */
export function targetsFromSession(session) {
  return (session.entries || []).map((e) => {
    const ex = getExercise(e.exerciseId);
    const metric = ex ? ex.metric : 'reps';
    const sets = e.sets || [];
    const row = { exerciseId: e.exerciseId, targetSets: sets.length || 3, targetReps: null, targetWeightKg: null };
    if (metric === 'reps') {
      let top = null;
      sets.forEach((s) => { if (!top || (s.weightKg || 0) > (top.weightKg || 0)) top = s; });
      row.targetReps = (top && top.reps != null) ? top.reps : DEFAULT_REPS;
      row.targetWeightKg = (top && top.weightKg) || null;
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

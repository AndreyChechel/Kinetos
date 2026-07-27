// Higher-level workout helpers shared by views.
import { getSessions, saveSession, getPlan, getTemplate, getState } from './store.js';
import { uid } from './ui.js';
import { getExercise, volumeWeightOf } from './data/db.js';
import { sessionVolume } from './calc.js';

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
      distanceKm: null,
      minutes: null,
      effort: null,
      targetReps: pe.targetReps ?? null,
      targetWeightKg: pe.targetWeightKg || null,
      done: false,
      timestamp: null
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
      const sets = (e.sets || []).filter((st) => st.reps || st.seconds || st.distanceKm);
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
      const did = (e.sets || []).some((st) => st.reps || st.seconds || st.distanceKm);
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
      const did = (e.sets || []).some((st) => st.reps || st.seconds || st.distanceKm);
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

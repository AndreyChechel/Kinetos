// Higher-level workout helpers shared by views.
import { getSessions, saveSession, getPlan, getState } from './store.js';
import { uid } from './ui.js';
import { getExercise } from './data/db.js';
import { sessionVolume } from './calc.js';

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
    name: plan ? plan.name : '',
    startedAt: new Date().toISOString(),
    endedAt: null,
    notes: plan ? (plan.notes || '') : '',
    entries: (plan ? plan.exercises : []).map((pe) => ({
      id: uid('en'),
      exerciseId: pe.exerciseId,
      sets: Array.from({ length: pe.targetSets || 3 }, (_, i) => ({
        n: i + 1,
        reps: pe.targetReps || null,
        weightKg: pe.targetWeightKg || null,
        seconds: null,
        distanceKm: null,
        done: false,
        timestamp: null
      }))
    }))
  };
  saveSession(s);
  return s.id;
}

/** Most recent completed set data for an exercise (for "last time" prefill). */
export function lastSetFor(exerciseId, excludeSessionId) {
  const sessions = getSessions()
    .filter((s) => s.id !== excludeSessionId && s.endedAt)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  for (const s of sessions) {
    const e = (s.entries || []).find((x) => x.exerciseId === exerciseId);
    if (e) {
      const done = (e.sets || []).filter((st) => st.reps || st.seconds || st.distanceKm);
      if (done.length) return { session: s, sets: done };
    }
  }
  return null;
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
  list.forEach((s) => { const v = sessionVolume(s); volume += v.volume; sets += v.sets; });
  return { workouts: list.length, volume, sets };
}

export function sessionDurationMs(s) {
  if (!s.startedAt) return 0;
  const end = s.endedAt ? new Date(s.endedAt) : new Date();
  return new Date(end) - new Date(s.startedAt);
}

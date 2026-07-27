// Data layer: single source of truth persisted to localStorage.
// No backend. Simple pub/sub so views can re-render on change.

const KEY = 'kinetos.v1';
const VERSION = 1;

function defaultState() {
  return {
    version: VERSION,
    profile: {
      name: '',
      photo: '',            // dataURL
      sex: 'male',          // 'male' | 'female'
      birthdate: '',        // ISO yyyy-mm-dd
      heightCm: null,
      weightKg: null,
      restingHR: null,      // bpm, optional (improves HR zones)
      activityLevel: 'moderate' // sedentary|light|moderate|active|very
    },
    settings: {
      lang: '',             // '' => auto-detect from browser
      theme: 'system',      // system|light|dark
      units: 'metric'
    },
    plans: [],              // planned sessions (templates/scheduled)
    sessions: [],           // logged workouts
    customExercises: []     // user-added exercises (merged with built-in)
  };
}

let state = load();
const subs = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return migrate(parsed);
  } catch (e) {
    console.warn('store: load failed, using defaults', e);
    return defaultState();
  }
}

function migrate(s) {
  const base = defaultState();
  // shallow-merge top-level, deep-merge known objects
  const merged = { ...base, ...s, version: VERSION };
  merged.profile = { ...base.profile, ...(s.profile || {}) };
  merged.settings = { ...base.settings, ...(s.settings || {}) };
  merged.plans = Array.isArray(s.plans) ? s.plans : [];
  merged.sessions = Array.isArray(s.sessions) ? s.sessions : [];
  merged.customExercises = Array.isArray(s.customExercises) ? s.customExercises : [];
  return merged;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('store: save failed (quota?)', e);
  }
}

function notify() { subs.forEach((fn) => fn(state)); }

/** Subscribe to state changes. Returns an unsubscribe fn. */
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

export function getState() { return state; }
export function getProfile() { return state.profile; }
export function getSettings() { return state.settings; }

/** Mutate via updater(draft) then persist + notify. */
export function update(mutator) {
  mutator(state);
  persist();
  notify();
}

export function setProfile(patch) { update((s) => { s.profile = { ...s.profile, ...patch }; }); }
export function setSettings(patch) { update((s) => { s.settings = { ...s.settings, ...patch }; }); }

// --- Plans ---
export function getPlans() { return state.plans; }
export function getPlan(id) { return state.plans.find((p) => p.id === id); }
export function savePlan(plan) {
  update((s) => {
    const i = s.plans.findIndex((p) => p.id === plan.id);
    if (i >= 0) s.plans[i] = plan; else s.plans.push(plan);
  });
}
export function deletePlan(id) { update((s) => { s.plans = s.plans.filter((p) => p.id !== id); }); }

// --- Sessions ---
export function getSessions() { return state.sessions; }
export function getSession(id) { return state.sessions.find((x) => x.id === id); }
export function saveSession(sess) {
  update((s) => {
    const i = s.sessions.findIndex((x) => x.id === sess.id);
    if (i >= 0) s.sessions[i] = sess; else s.sessions.push(sess);
  });
}
export function deleteSession(id) { update((s) => { s.sessions = s.sessions.filter((x) => x.id !== id); }); }

// --- Custom exercises ---
export function getCustomExercises() { return state.customExercises; }
export function addCustomExercise(ex) { update((s) => { s.customExercises.push(ex); }); }

// --- Export / Import ---
export function exportJSON() {
  return JSON.stringify({ ...state, exportedAt: new Date().toISOString(), app: 'kinetos' }, null, 2);
}
export function importJSON(text, { merge = false } = {}) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object') throw new Error('invalid');
  update((s) => {
    const incoming = migrate(data);
    if (merge) {
      const byId = (arr, add) => {
        const ids = new Set(arr.map((x) => x.id));
        add.forEach((x) => { if (!ids.has(x.id)) arr.push(x); });
      };
      byId(s.plans, incoming.plans);
      byId(s.sessions, incoming.sessions);
      byId(s.customExercises, incoming.customExercises);
      s.profile = { ...s.profile, ...incoming.profile };
    } else {
      Object.assign(s, incoming);
    }
  });
}

/** Wipe everything (used by "reset" in profile). */
export function resetAll() {
  state = defaultState();
  persist();
  notify();
}

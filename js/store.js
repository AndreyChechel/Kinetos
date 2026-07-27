// Data layer: single source of truth persisted to localStorage.
// No backend. Simple pub/sub so views can re-render on change.

const KEY = 'kinetos.v1';
const VERSION = 1;

function defaultState() {
  return {
    version: VERSION,
    updatedAt: null,        // ISO of last local change; drives sync conflict resolution
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
      units: 'metric',
      sync: { provider: '' } // '' | 'google' | 'onedrive' | 'yandex'
    },
    templates: [],          // reusable, dateless workout blueprints
    plans: [],              // scheduled sessions on the calendar (a date + exercises)
    sessions: [],           // logged workouts
    customExercises: [],    // user-added exercises (merged with built-in)
    exerciseMeta: {}        // per-exercise UI state keyed by id: { hidden, notes:[{id,text,ts}] }
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
  merged.templates = Array.isArray(s.templates) ? s.templates : [];
  merged.plans = Array.isArray(s.plans) ? s.plans : [];
  merged.sessions = Array.isArray(s.sessions) ? s.sessions : [];
  merged.customExercises = Array.isArray(s.customExercises) ? s.customExercises : [];
  merged.exerciseMeta = (s.exerciseMeta && typeof s.exerciseMeta === 'object') ? s.exerciseMeta : {};
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

/** Mutate via updater(draft) then persist + notify.
 *  opts.internal = true skips bumping updatedAt (used by sync merges). */
export function update(mutator, opts = {}) {
  mutator(state);
  if (!opts.internal) state.updatedAt = new Date().toISOString();
  persist();
  notify();
}

export function getUpdatedAt() { return state.updatedAt; }

/** Full state as a JSON string (for cloud upload). */
export function serialize() { return JSON.stringify(state); }

/** Merge a remote snapshot: union collections by id, last-write-wins on scalars. */
export function mergeRemote(remote) {
  if (!remote || typeof remote !== 'object') return;
  update((s) => {
    const remoteNewer = !!remote.updatedAt && (!s.updatedAt || remote.updatedAt > s.updatedAt);
    const mergeArr = (local, incoming) => {
      const map = new Map();
      const first = remoteNewer ? (local || []) : (incoming || []);
      const second = remoteNewer ? (incoming || []) : (local || []);
      first.forEach((x) => x && x.id && map.set(x.id, x));
      second.forEach((x) => x && x.id && map.set(x.id, x)); // newer side overrides on conflict
      return [...map.values()];
    };
    s.templates = mergeArr(s.templates, remote.templates);
    s.plans = mergeArr(s.plans, remote.plans);
    s.sessions = mergeArr(s.sessions, remote.sessions);
    s.customExercises = mergeArr(s.customExercises, remote.customExercises);
    // exerciseMeta is an object keyed by exercise id — union keys, newer side wins on conflict.
    const localMeta = s.exerciseMeta || {}, remoteMeta = remote.exerciseMeta || {};
    s.exerciseMeta = remoteNewer ? { ...localMeta, ...remoteMeta } : { ...remoteMeta, ...localMeta };
    if (remoteNewer) {
      s.profile = { ...s.profile, ...(remote.profile || {}) };
      s.settings = { ...s.settings, ...(remote.settings || {}) };
    } else {
      s.profile = { ...(remote.profile || {}), ...s.profile };
      s.settings = { ...(remote.settings || {}), ...s.settings };
    }
    const a = s.updatedAt || '', b = remote.updatedAt || '';
    s.updatedAt = a > b ? a : b;
  }, { internal: true });
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

// --- Templates (reusable, dateless workout blueprints) ---
export function getTemplates() { return state.templates; }
export function getTemplate(id) { return state.templates.find((tpl) => tpl.id === id); }
export function saveTemplate(tpl) {
  update((s) => {
    tpl.updatedAt = new Date().toISOString();
    const i = s.templates.findIndex((x) => x.id === tpl.id);
    if (i >= 0) s.templates[i] = tpl; else s.templates.push(tpl);
  });
}
export function deleteTemplate(id) { update((s) => { s.templates = s.templates.filter((x) => x.id !== id); }); }

// --- Custom exercises ---
export function getCustomExercises() { return state.customExercises; }
export function addCustomExercise(ex) { update((s) => { s.customExercises.push(ex); }); }
export function updateCustomExercise(ex) {
  update((s) => { const i = s.customExercises.findIndex((x) => x.id === ex.id); if (i >= 0) s.customExercises[i] = ex; });
}
/** Hard-remove a custom exercise (only safe when it has no logged history). */
export function removeCustomExercise(id) { update((s) => { s.customExercises = s.customExercises.filter((x) => x.id !== id); }); }
/** Soft-delete: keep the row (so history still resolves its name) but flag as deleted. */
export function softDeleteCustomExercise(id) {
  update((s) => { const ex = s.customExercises.find((x) => x.id === id); if (ex) ex.deleted = true; });
}

// --- Per-exercise UI meta (hide + notes), works for built-in and custom ids ---
export function getExerciseMeta(id) { return state.exerciseMeta[id] || {}; }
function ensureMeta(s, id) { return (s.exerciseMeta[id] = s.exerciseMeta[id] || {}); }
export function isExerciseHidden(id) { return !!(state.exerciseMeta[id] && state.exerciseMeta[id].hidden); }
export function setExerciseHidden(id, hidden) { update((s) => { ensureMeta(s, id).hidden = !!hidden; }); }
export function getExerciseNotes(id) { return (state.exerciseMeta[id] && state.exerciseMeta[id].notes) || []; }
export function addExerciseNote(id, text) {
  const noteId = 'note_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  update((s) => { const m = ensureMeta(s, id); m.notes = m.notes || []; m.notes.push({ id: noteId, text, ts: new Date().toISOString() }); });
  return noteId;
}
export function updateExerciseNote(id, noteId, text) {
  update((s) => { const n = ((s.exerciseMeta[id] || {}).notes || []).find((x) => x.id === noteId); if (n) { n.text = text; n.ts = new Date().toISOString(); } });
}
export function deleteExerciseNote(id, noteId) {
  update((s) => { const m = s.exerciseMeta[id]; if (m && m.notes) m.notes = m.notes.filter((x) => x.id !== noteId); });
}

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
      byId(s.templates, incoming.templates);
      byId(s.plans, incoming.plans);
      byId(s.sessions, incoming.sessions);
      byId(s.customExercises, incoming.customExercises);
      s.exerciseMeta = { ...incoming.exerciseMeta, ...s.exerciseMeta };
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

// Data layer: single source of truth persisted to localStorage.
// No backend. Simple pub/sub so views can re-render on change.

const KEY = 'kinetos.v1';
const VERSION = 1;
// Deletions are remembered as tombstones so a delete on one device propagates
// across sync instead of being re-added from another device's copy. Prune ones
// older than this so the registry can't grow forever (devices offline longer
// than this may resurrect an entity — an acceptable trade-off).
const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000; // ~6 months

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
      dumbbellInput: 'single', // 'single' => user logs ONE dumbbell (counted x2); 'pair' => logs both (total)
      barbellInput: 'included', // 'included' => logged weight already includes the bar; 'added' => log plates only, add the chosen bar
      barbellWeights: [20, 10, 5], // selectable bar weights (kg) when barbellInput==='added'; first is the default
      plates: [25, 20, 15, 10, 5, 2.5, 1.25], // available plate sizes (kg) — drives the per-side plate calculator
      restSeconds: 90,      // rest countdown after a set is marked done; 0 = off
      sync: { provider: '' } // '' | 'google' | 'onedrive' | 'yandex'
    },
    templates: [],          // reusable, dateless workout blueprints
    plans: [],              // scheduled sessions on the calendar (a date + exercises)
    sessions: [],           // logged workouts
    customExercises: [],    // user-added exercises (merged with built-in)
    exerciseMeta: {},       // per-exercise UI state keyed by id: { hidden, notes:[{id,text,ts}] }
    tombstones: {}          // deletion registry: { [collection]: { [id]: isoDeletedAt } } — drives delete propagation on sync
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
  merged.tombstones = (s.tombstones && typeof s.tombstones === 'object' && !Array.isArray(s.tombstones)) ? s.tombstones : {};
  return merged;
}

/** Record that `id` in `coll` was deleted now (so sync can propagate the delete). */
function recordTombstone(s, coll, id) {
  if (!id) return;
  s.tombstones = s.tombstones || {};
  (s.tombstones[coll] = s.tombstones[coll] || {})[id] = new Date().toISOString();
}
/** Drop any tombstone for `id` in `coll` (a re-add/save resurrects the entity). */
function clearTombstone(s, coll, id) {
  if (s.tombstones && s.tombstones[coll]) delete s.tombstones[coll][id];
}
/** Union two tombstone registries, keeping the latest deletion time per id. */
function unionTombstones(a, b) {
  a = a || {}; b = b || {};
  const out = {};
  new Set([...Object.keys(a), ...Object.keys(b)]).forEach((coll) => {
    const x = a[coll] || {}, y = b[coll] || {}, m = {};
    new Set([...Object.keys(x), ...Object.keys(y)]).forEach((id) => {
      const tx = x[id] || '', ty = y[id] || '';
      m[id] = tx > ty ? tx : ty;
    });
    out[coll] = m;
  });
  return out;
}
/** Drop tombstones older than the TTL so the registry stays bounded. */
function prunedTombstones(tombs) {
  const cutoff = new Date(Date.now() - TOMBSTONE_TTL_MS).toISOString();
  const out = {};
  Object.keys(tombs || {}).forEach((coll) => {
    const m = {};
    Object.keys(tombs[coll] || {}).forEach((id) => { if (tombs[coll][id] >= cutoff) m[id] = tombs[coll][id]; });
    if (Object.keys(m).length) out[coll] = m;
  });
  return out;
}

const HAS_DOM = typeof window !== 'undefined' && typeof document !== 'undefined';

// Writes are debounced: rapid edits during logging (every keystroke/tap) would
// otherwise serialize the whole state each time. flushPersist() guarantees the
// pending write lands (called on pagehide/visibilitychange and before sync).
let persistTimer = null;
let lastPersistErrorAt = 0;
function persist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(flushPersist, 250);
}
export function flushPersist() {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    lastPersistErrorAt = 0;
  } catch (e) {
    // Surface the failure — silently losing writes mid-workout is worse than a
    // scary toast. app.js listens and tells the user to export.
    console.error('store: save failed (quota?)', e);
    const now = Date.now();
    if (HAS_DOM && now - lastPersistErrorAt > 60000) {
      lastPersistErrorAt = now;
      try { window.dispatchEvent(new CustomEvent('store:persist-error', { detail: e })); } catch (_) { /* ignore */ }
    }
  }
}
if (HAS_DOM) {
  window.addEventListener('pagehide', flushPersist);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPersist(); });
  // Cross-tab coordination: another tab (or PWA window) wrote the key — adopt
  // its state if it's at least as new, instead of clobbering it on our next write.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || e.newValue == null) return;
    try {
      const incoming = migrate(JSON.parse(e.newValue));
      if ((incoming.updatedAt || '') >= (state.updatedAt || '')) { state = incoming; notify(); }
    } catch (_) { /* ignore malformed writes */ }
  });
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

/** Last-modified time an entity carries, if any (drives edit-after-delete resurrection).
 *  NOTE: deliberately excludes Plan.date — that's the scheduled day, not a modify time. */
function lastModOf(x) { return (x && (x.updatedAt || x.finishedAt || x.endedAt || x.startedAt || x.createdAt || x.ts)) || ''; }

/** Merge a remote snapshot: union collections by id, last-write-wins on scalars,
 *  and honor deletions via tombstones so a delete on one device isn't re-added
 *  from another device's stale copy. */
export function mergeRemote(remote) {
  if (!remote || typeof remote !== 'object') return;
  update((s) => {
    const remoteNewer = !!remote.updatedAt && (!s.updatedAt || remote.updatedAt > s.updatedAt);

    // Union tombstones from both sides, keeping the latest deletion time per id.
    const tombs = unionTombstones(s.tombstones, remote.tombstones);

    const mergeArr = (local, incoming, coll) => {
      const map = new Map();
      const first = remoteNewer ? (local || []) : (incoming || []);
      const second = remoteNewer ? (incoming || []) : (local || []);
      first.forEach((x) => x && x.id && map.set(x.id, x));
      second.forEach((x) => x && x.id && map.set(x.id, x)); // newer side overrides on conflict
      const dead = tombs[coll] || {};
      const out = [];
      map.forEach((x, id) => {
        const deletedAt = dead[id];
        // Suppress a deleted id unless the surviving entity was modified AFTER the
        // deletion (an edit that beats the delete resurrects it — true LWW).
        if (deletedAt && !(lastModOf(x) > deletedAt)) return;
        out.push(x);
      });
      return out;
    };
    s.templates = mergeArr(s.templates, remote.templates, 'templates');
    s.plans = mergeArr(s.plans, remote.plans, 'plans');
    s.sessions = mergeArr(s.sessions, remote.sessions, 'sessions');
    s.customExercises = mergeArr(s.customExercises, remote.customExercises, 'customExercises');
    s.tombstones = prunedTombstones(tombs);
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
    clearTombstone(s, 'plans', plan.id);
    plan.updatedAt = new Date().toISOString(); // entity-level stamp — lets an edit beat a remote delete (lastModOf)
    const i = s.plans.findIndex((p) => p.id === plan.id);
    if (i >= 0) s.plans[i] = plan; else s.plans.push(plan);
  });
}
export function deletePlan(id) { update((s) => { s.plans = s.plans.filter((p) => p.id !== id); recordTombstone(s, 'plans', id); }); }

// --- Sessions ---
export function getSessions() { return state.sessions; }
export function getSession(id) { return state.sessions.find((x) => x.id === id); }
export function saveSession(sess) {
  update((s) => {
    clearTombstone(s, 'sessions', sess.id);
    sess.updatedAt = new Date().toISOString(); // entity-level stamp — lets an edit beat a remote delete (lastModOf)
    const i = s.sessions.findIndex((x) => x.id === sess.id);
    if (i >= 0) s.sessions[i] = sess; else s.sessions.push(sess);
  });
}
export function deleteSession(id) { update((s) => { s.sessions = s.sessions.filter((x) => x.id !== id); recordTombstone(s, 'sessions', id); }); }

// --- Templates (reusable, dateless workout blueprints) ---
export function getTemplates() { return state.templates; }
export function getTemplate(id) { return state.templates.find((tpl) => tpl.id === id); }
export function saveTemplate(tpl) {
  update((s) => {
    clearTombstone(s, 'templates', tpl.id);
    tpl.updatedAt = new Date().toISOString();
    const i = s.templates.findIndex((x) => x.id === tpl.id);
    if (i >= 0) s.templates[i] = tpl; else s.templates.push(tpl);
  });
}
export function deleteTemplate(id) { update((s) => { s.templates = s.templates.filter((x) => x.id !== id); recordTombstone(s, 'templates', id); }); }

// --- Custom exercises ---
export function getCustomExercises() { return state.customExercises; }
export function addCustomExercise(ex) { update((s) => { clearTombstone(s, 'customExercises', ex.id); ex.updatedAt = new Date().toISOString(); s.customExercises.push(ex); }); }
export function updateCustomExercise(ex) {
  update((s) => { clearTombstone(s, 'customExercises', ex.id); ex.updatedAt = new Date().toISOString(); const i = s.customExercises.findIndex((x) => x.id === ex.id); if (i >= 0) s.customExercises[i] = ex; });
}
/** Hard-remove a custom exercise (only safe when it has no logged history). */
export function removeCustomExercise(id) { update((s) => { s.customExercises = s.customExercises.filter((x) => x.id !== id); recordTombstone(s, 'customExercises', id); }); }
/** Soft-delete: keep the row (so history still resolves its name) but flag as deleted. */
export function softDeleteCustomExercise(id) {
  update((s) => { const ex = s.customExercises.find((x) => x.id === id); if (ex) { ex.deleted = true; ex.updatedAt = new Date().toISOString(); } });
}

// --- Per-exercise UI meta (hide + notes), works for built-in and custom ids ---
export function getExerciseMeta(id) { return state.exerciseMeta[id] || {}; }
function ensureMeta(s, id) { return (s.exerciseMeta[id] = s.exerciseMeta[id] || {}); }
export function isExerciseHidden(id) { return !!(state.exerciseMeta[id] && state.exerciseMeta[id].hidden); }
export function setExerciseHidden(id, hidden) { update((s) => { ensureMeta(s, id).hidden = !!hidden; }); }
export function getExerciseNotes(id) { return (state.exerciseMeta[id] && state.exerciseMeta[id].notes) || []; }
/** Per-exercise weight increment override (kg); null/0 clears it. */
export function setExerciseWeightStep(id, step) {
  update((s) => { const m = ensureMeta(s, id); if (step > 0) m.weightStep = step; else delete m.weightStep; });
}
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
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid');
  // Only accept files that plausibly are a Kinetos backup — an arbitrary JSON
  // object would otherwise be "migrated" into a valid-looking empty state.
  const looksLikeKinetos = data.app === 'kinetos' ||
    ['sessions', 'plans', 'templates', 'customExercises', 'profile'].some((k) => Array.isArray(data[k]) || (data[k] && typeof data[k] === 'object'));
  if (!looksLikeKinetos) throw new Error('invalid');
  update((s) => {
    const incoming = migrate(data);
    // Sync wiring (provider choice) is device-local — never adopt it from a file.
    const localSync = (s.settings || {}).sync || { provider: '' };
    if (merge) {
      const byId = (arr, add) => {
        const ids = new Set(arr.map((x) => x.id));
        add.forEach((x) => { if (x && x.id && !ids.has(x.id)) arr.push(x); });
      };
      byId(s.templates, incoming.templates);
      byId(s.plans, incoming.plans);
      byId(s.sessions, incoming.sessions);
      byId(s.customExercises, incoming.customExercises);
      s.exerciseMeta = { ...incoming.exerciseMeta, ...s.exerciseMeta };
      s.tombstones = unionTombstones(s.tombstones, incoming.tombstones);
      // Merge keeps local profile/settings values; the import only fills gaps.
      const fillEmpty = (loc, inc) => {
        const out = { ...loc };
        Object.entries(inc || {}).forEach(([k, v]) => { if (out[k] == null || out[k] === '') out[k] = v; });
        return out;
      };
      s.profile = fillEmpty(s.profile, incoming.profile);
      s.settings = fillEmpty(s.settings, incoming.settings);
    } else {
      Object.assign(s, incoming);
    }
    s.settings = { ...s.settings, sync: localSync };
  });
}

/** Wipe everything (used by "reset" in profile). Also forgets the cloud-sync
 *  identity (tokens, remote file id, sync meta) — otherwise the very next sync
 *  would just merge all the "erased" data back in from the remote copy. */
export function resetAll() {
  state = defaultState();
  try {
    ['kinetos.tokens', 'kinetos.gdrive.fileId', 'kinetos.sync.meta'].forEach((k) => localStorage.removeItem(k));
    if (typeof sessionStorage !== 'undefined') {
      Object.keys(sessionStorage).filter((k) => k.startsWith('kinetos.')).forEach((k) => sessionStorage.removeItem(k));
    }
  } catch (_) { /* best-effort */ }
  flushPersist();
  notify();
}

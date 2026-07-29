// AI planning bridge (Profile -> Your data).
//
// Two halves, both fully offline:
//   buildPrompt()   — renders one self-contained ENGLISH prompt the user copies
//                     into any AI agent: their request, their profile, logging
//                     conventions, the allowed exercise catalog, recent history
//                     and the exact JSON schema to answer with.
//   parseSessions() — validates the JSON the agent produced and normalizes it
//                     into plan-shaped rows; importSessions() saves them as
//                     dated calendar plans.
//
// The prompt is deliberately English regardless of app language: agents follow
// English instructions/schemas most reliably, and the data in it (exercise ids)
// must stay stable anyway.
import { getProfile, getSettings, getPlans, getExerciseMeta, savePlan } from './store.js';
import { browseExercises, getExercise, barbellAdded, barbellWeights, repPresets, effectiveWeight } from './data/db.js';
import { completedSessions, performed } from './workout.js';
import { weightStepFor } from './suggest.js';
import { age, maxHR, bmi, bmr, tdee, oneRepMax } from './calc.js';
import { uid, todayISO, localISO } from './ui.js';

export const SCHEMA_VERSION = 1;
export const DEFAULT_MAX_SESSIONS = 10;

const EFFORT = { 1: 'easy', 2: 'medium', 3: 'hard' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SETS = 20;
const MAX_REPS = 200;
const MAX_WEIGHT = 500;

/** English default request: tomorrow's session, informed by the history below. */
export function defaultUserMessage() {
  return 'Plan my next training session for tomorrow. Use my recent sessions to progress sensibly '
    + '(respect how hard the last sets felt), keep the workout balanced, and stay with equipment I already use.';
}

/** The user's saved prompt options (message + how many sessions to include). */
export function getPromptOptions() {
  const o = getSettings().aiPrompt || {};
  const n = parseInt(o.maxSessions, 10);
  return {
    userMessage: typeof o.userMessage === 'string' && o.userMessage.trim() ? o.userMessage : defaultUserMessage(),
    maxSessions: Number.isFinite(n) && n >= 0 ? Math.min(n, 100) : DEFAULT_MAX_SESSIONS
  };
}

// ---------------------------------------------------------------- prompt ----

const enName = (ex) => (ex && ex.names && (ex.names.en || Object.values(ex.names)[0])) || (ex ? ex.id : '');
const num = (n) => (Math.round(n * 100) / 100).toString();

function metricNote(ex) {
  if (ex.metric === 'reps') {
    if (ex.equipment === 'bodyweight') return 'reps (bodyweight — omit weightKg unless extra load is added)';
    if (ex.equipment === 'band') return 'reps (band — omit weightKg)';
    return 'reps (log weight x reps)';
  }
  if (ex.metric === 'time') return 'time (log seconds)';
  if (ex.metric === 'distance') return 'distance (log km + minutes)';
  if (ex.metric === 'count') return 'count (log ' + (ex.countUnit || 'count') + ')';
  return ex.metric;
}

/** One set rendered compactly, e.g. "62.5kg x 8 hard [0:44]". */
function setLine(set, ex) {
  const bits = [];
  if (ex.metric === 'reps') {
    const w = set.weightKg != null
      ? num(set.weightKg) + (set.barKg != null && barbellAdded() && ex.equipment === 'barbell' ? '+' + num(set.barKg) : '') + 'kg'
      : 'bodyweight';
    bits.push(w + ' x ' + (set.reps != null ? set.reps : '?'));
    if (set.targetReps != null && set.reps != null && set.targetReps !== set.reps) bits.push('(target ' + set.targetReps + ')');
  } else if (ex.metric === 'time') {
    bits.push((set.seconds != null ? set.seconds : '?') + 's');
  } else if (ex.metric === 'distance') {
    bits.push((set.distanceKm != null ? num(set.distanceKm) : '?') + 'km');
    if (set.minutes) bits.push('in ' + num(set.minutes) + 'min');
  } else {
    bits.push((set.count != null ? set.count : '?') + ' ' + (ex.countUnit || ''));
  }
  if (set.effort) bits.push(EFFORT[set.effort] || '');
  if (set.durationMs > 0) bits.push('[' + Math.round(set.durationMs / 1000) + 's]');
  return bits.filter(Boolean).join(' ');
}

function historyBlock(maxSessions) {
  const list = completedSessions().slice(0, maxSessions);
  if (!list.length) return 'No completed sessions logged yet.';
  return list.map((s) => {
    const date = s.startedAt ? localISO(new Date(s.startedAt)) : '?';
    const mins = (s.startedAt && s.endedAt) ? Math.round((new Date(s.endedAt) - new Date(s.startedAt)) / 60000) : null;
    const head = '### ' + date + (s.name ? ' — ' + s.name : '') + (mins != null ? ' (' + mins + ' min)' : '');
    const lines = [head];
    if (s.notes) lines.push('session notes: ' + s.notes);
    (s.entries || []).forEach((e) => {
      const ex = getExercise(e.exerciseId);
      if (!ex) return;
      const sets = (e.sets || []).filter(performed);
      if (!sets.length) return;
      lines.push('- ' + enName(ex) + ' [' + ex.id + ']: ' + sets.map((st) => setLine(st, ex)).join('; ')
        + (e.note ? '  // ' + e.note : ''));
    });
    return lines.join('\n');
  }).join('\n');
}

/** Best estimated 1RM per exercise across all logged history (kg).
 *  Uses the EFFECTIVE load (bar + both dumbbells) so the numbers are comparable
 *  regardless of how the athlete enters weight — the heading says so. */
function bestsBlock() {
  const best = new Map();
  completedSessions().forEach((s) => (s.entries || []).forEach((e) => {
    const ex = getExercise(e.exerciseId);
    if (!ex || ex.metric !== 'reps') return;
    (e.sets || []).forEach((st) => {
      if (!performed(st) || !st.weightKg || !st.reps) return;
      const o = oneRepMax(effectiveWeight(ex.id, st.weightKg, st), st.reps);
      if (o && o.avg > (best.get(ex.id) || 0)) best.set(ex.id, o.avg);
    });
  }));
  if (!best.size) return 'Not enough data yet.';
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => '- ' + id + ': ' + num(v) + ' kg')
    .join('\n');
}

function catalogBlock() {
  const list = browseExercises();
  const rows = list.map((ex) => {
    const cells = [ex.id, enName(ex), ex.group, ex.equipment, metricNote(ex)];
    if (ex.metric === 'reps' && ex.equipment !== 'bodyweight' && ex.equipment !== 'band') cells.push('step ' + num(weightStepFor(ex)) + 'kg');
    if (ex.custom) cells.push('custom');
    return '- ' + cells.join(' | ');
  });
  return rows.join('\n');
}

function exerciseNotesBlock() {
  const out = [];
  browseExercises().forEach((ex) => {
    const notes = (getExerciseMeta(ex.id).notes || []).map((n) => n.text).filter(Boolean);
    if (notes.length) out.push('- ' + ex.id + ': ' + notes.join(' | '));
  });
  return out.length ? out.join('\n') : null;
}

function athleteBlock() {
  const p = getProfile();
  const a = age(p.birthdate);
  const rows = [];
  if (p.name) rows.push('- Name: ' + p.name);
  if (p.sex) rows.push('- Sex: ' + p.sex);
  if (a != null) rows.push('- Age: ' + a);
  if (p.heightCm) rows.push('- Height: ' + num(p.heightCm) + ' cm');
  if (p.weightKg) rows.push('- Body weight: ' + num(p.weightKg) + ' kg');
  if (p.restingHR) rows.push('- Resting heart rate: ' + p.restingHR + ' bpm');
  if (p.activityLevel) rows.push('- Daily activity level: ' + p.activityLevel);
  if (a != null) rows.push('- Estimated max heart rate: ' + maxHR(a) + ' bpm');
  if (a != null && p.heightCm && p.weightKg) {
    rows.push('- BMI: ' + bmi(p.weightKg, p.heightCm).value);
    rows.push('- BMR: ' + bmr(p.weightKg, p.heightCm, a, p.sex) + ' kcal, TDEE: '
      + tdee(p.weightKg, p.heightCm, a, p.sex, p.activityLevel) + ' kcal');
  }
  return rows.length ? rows.join('\n') : 'The athlete has not filled in their profile.';
}

function conventionsBlock() {
  const st = getSettings();
  const rows = [
    '- All units are metric: kg, km, cm, seconds/minutes.',
    '- Dumbbell weights are entered ' + ((st.dumbbellInput || 'single') === 'single'
      ? 'PER DUMBBELL (one hand; the app doubles it internally). Give the per-hand weight.'
      : 'as the COMBINED weight of both dumbbells.'),
    '- Barbell weights are entered ' + (barbellAdded()
      ? 'as PLATES ONLY — the bar is added by the app. Available bars: ' + barbellWeights().map(num).join(', ') + ' kg.'
      : 'INCLUDING the bar.'),
    '- Available plates (kg, per side pairs): ' + (Array.isArray(st.plates) && st.plates.length ? st.plates.map(num).join(', ') : 'unknown')
      + '. Keep barbell weights achievable with these.',
    '- Preferred rep counts: ' + repPresets().join(', ') + '.',
    '- Rest between sets: ' + (st.restSeconds ? st.restSeconds + ' s' : 'no timer configured') + '.',
    '- Effort ratings in the history are the athlete\'s own rating right after the set: easy / medium / hard.',
    '- "[42s]" after a set is how long that set took; "(target 8)" is the rep target they were given.'
  ];
  return rows.join('\n');
}

function scheduleBlock() {
  const today = todayISO();
  const upcoming = getPlans()
    .filter((p) => (p.date || '').slice(0, 10) >= today)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .slice(0, 20);
  const rows = ['- Today is ' + today + ' (' + new Date(today + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }) + ').'];
  if (upcoming.length) {
    rows.push('- Sessions already on the calendar (do NOT duplicate these dates unless asked):');
    upcoming.forEach((p) => rows.push('  - ' + (p.date || '').slice(0, 10) + ': ' + (p.name || 'untitled')
      + ' (' + (p.exercises || []).map((x) => x.exerciseId).join(', ') + ')'));
  } else {
    rows.push('- Nothing is scheduled on the calendar yet.');
  }
  return rows.join('\n');
}

const SCHEMA = `{
  "kinetos": "sessions",
  "version": ${SCHEMA_VERSION},
  "sessions": [
    {
      "date": "YYYY-MM-DD",
      "name": "short session title, e.g. Upper A",
      "notes": "optional coaching notes for the athlete, or \\"\\"",
      "exercises": [
        { "exerciseId": "bench-press", "sets": 4, "reps": 8, "weightKg": 62.5 },
        { "exerciseId": "plank", "sets": 3 }
      ]
    }
  ]
}`;

/** Build the full prompt text. */
export function buildPrompt({ userMessage, maxSessions } = {}) {
  const opts = getPromptOptions();
  const msg = (userMessage != null && String(userMessage).trim()) ? String(userMessage).trim() : opts.userMessage;
  const n = Number.isFinite(maxSessions) ? Math.max(0, Math.min(maxSessions, 100)) : opts.maxSessions;
  const notes = exerciseNotesBlock();

  return [
    'You are an experienced strength & conditioning coach planning workouts for the athlete described below.',
    'Everything you need is in this message. Answer ONLY with the JSON object described in section 2.',
    '',
    '## 1. WHAT THE ATHLETE ASKED FOR',
    msg,
    '',
    '## 2. HOW TO ANSWER (strict)',
    'Output exactly one JSON object and nothing else — no explanation before or after, no markdown code fence.',
    '',
    SCHEMA,
    '',
    'Rules:',
    '- "exerciseId" MUST be copied verbatim from the catalog in section 6. Never invent, translate or guess an id.',
    '- "date" is a calendar date "YYYY-MM-DD" (see section 5 for today). One object per training day; multiple days are allowed.',
    '- "sets" is an integer from 1 to ' + MAX_SETS + '.',
    '- "reps" and "weightKg" apply only to exercises whose metric is "reps". Omit them for time/distance/count exercises.',
    '- For time / distance / count exercises only "sets" is planned — state the intended duration, distance or tally in "notes".',
    '- "weightKg" is in kilograms, following the entry conventions in section 4; omit it (or use null) for bodyweight work.',
    '- Prefer weights the athlete can actually load (see plates in section 4) and rep counts from their presets.',
    '- Put warm-up work in the session as normal exercises from the "warmup" group if you want it done.',
    '- Keep "name" short; put reasoning, tempo, RPE hints or substitutions in "notes".',
    '',
    '## 3. THE ATHLETE',
    athleteBlock(),
    '',
    '## 4. HOW THIS APP LOGS WEIGHT (read before choosing numbers)',
    conventionsBlock(),
    '',
    '## 5. CALENDAR',
    scheduleBlock(),
    '',
    '## 6. ALLOWED EXERCISES (id | name | muscle group | equipment | metric | weight step)',
    catalogBlock(),
    ...(notes ? ['', '### Athlete notes on specific exercises', notes] : []),
    '',
    '## 7. RECENT SESSIONS' + (n ? ' (newest first, up to ' + n + ')' : ' (omitted)'),
    n ? historyBlock(n) : 'The athlete chose not to share history this time.',
    '',
    '## 8. BEST ESTIMATED 1RM PER EXERCISE (true total load: bar and both dumbbells included)',
    bestsBlock(),
    '',
    '## 9. NOW ANSWER',
    'Return the JSON object from section 2 — only valid exercise ids, only JSON.'
  ].join('\n');
}

// ---------------------------------------------------------------- import ----

/** Strip markdown fences / surrounding prose and return the JSON substring. */
function extractJSON(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (s.startsWith('{') || s.startsWith('[')) return s;
  // Agents sometimes prepend a sentence — take the widest brace/bracket span.
  const first = Math.min(...['{', '['].map((c) => { const i = s.indexOf(c); return i < 0 ? Infinity : i; }));
  const last = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (first !== Infinity && last > first) return s.slice(first, last + 1);
  return s;
}

class ImportError extends Error {}
const fail = (msg) => { throw new ImportError(msg); };

function intIn(v, lo, hi) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  return i >= lo && i <= hi ? i : null;
}
function floatIn(v, lo, hi) {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
  if (!Number.isFinite(n)) return null;
  return n >= lo && n <= hi ? Math.round(n * 100) / 100 : null;
}
function validDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s.slice(0, 10))) return null;
  const d = s.slice(0, 10);
  const dt = new Date(d + 'T12:00:00');
  return isNaN(dt) || localISO(dt) !== d ? null : d;
}

/**
 * Validate + normalize an agent answer into plan-shaped sessions.
 * @returns {{sessions: Array, warnings: string[]}}
 * @throws {Error} with a human-readable message when the payload is unusable.
 */
export function parseSessions(text) {
  if (!String(text || '').trim()) fail('Nothing pasted.');
  let data;
  try { data = JSON.parse(extractJSON(text)); }
  catch (e) { fail('Not valid JSON: ' + (e.message || 'parse error')); }

  let raw = data;
  if (raw && !Array.isArray(raw) && typeof raw === 'object') raw = raw.sessions || raw.workouts || raw.plans || (raw.date ? [raw] : raw);
  if (!Array.isArray(raw)) fail('Expected a "sessions" array.');
  if (!raw.length) fail('The JSON contains no sessions.');
  if (raw.length > 60) fail('Too many sessions (' + raw.length + '). Max 60 per import.');

  const warnings = [];
  const sessions = raw.map((s, i) => {
    const at = 'session ' + (i + 1);
    if (!s || typeof s !== 'object' || Array.isArray(s)) fail(at + ': not an object.');
    const date = validDate(s.date || s.day);
    if (!date) fail(at + ': missing or invalid "date" (expected YYYY-MM-DD, got ' + JSON.stringify(s.date ?? null) + ').');

    const rawEx = Array.isArray(s.exercises) ? s.exercises : (Array.isArray(s.items) ? s.items : null);
    if (!rawEx || !rawEx.length) fail(at + ' (' + date + '): no "exercises".');

    const exercises = [];
    rawEx.forEach((pe, j) => {
      const where = at + ' (' + date + '), exercise ' + (j + 1);
      if (!pe || typeof pe !== 'object') fail(where + ': not an object.');
      const id = String(pe.exerciseId || pe.id || '').trim();
      if (!id) fail(where + ': missing "exerciseId".');
      const ex = getExercise(id);
      if (!ex || ex.deleted) fail(where + ': unknown exerciseId "' + id + '". It must come from the catalog in the prompt.');

      const sets = intIn(pe.sets ?? pe.targetSets, 1, MAX_SETS);
      if (sets == null) {
        warnings.push(where + ': "sets" missing or out of range — using 3.');
      }
      const row = { exerciseId: ex.id, targetSets: sets == null ? 3 : sets, targetReps: null, targetWeightKg: null };
      if (ex.metric === 'reps') {
        row.targetReps = intIn(pe.reps ?? pe.targetReps, 1, MAX_REPS);
        row.targetWeightKg = floatIn(pe.weightKg ?? pe.targetWeightKg ?? pe.weight, 0, MAX_WEIGHT);
        if (row.targetReps == null) { row.targetReps = 12; warnings.push(where + ' (' + ex.id + '): no usable "reps" — using 12.'); }
        if (row.targetWeightKg === 0) row.targetWeightKg = null;
      } else if (pe.reps != null || pe.weightKg != null) {
        warnings.push(where + ' (' + ex.id + '): metric is ' + ex.metric + ' — reps/weight ignored.');
      }
      exercises.push(row);
    });

    return {
      date,
      name: String(s.name || s.title || '').trim().slice(0, 80),
      notes: String(s.notes || s.note || '').trim().slice(0, 2000),
      exercises
    };
  });

  return { sessions, warnings };
}

/** Save normalized sessions as dated calendar plans. Returns the plan ids. */
export function importSessions(sessions) {
  const ids = [];
  (sessions || []).forEach((s) => {
    const plan = {
      id: uid('plan'),
      templateId: null,
      name: s.name || '',
      date: s.date,
      notes: s.notes || '',
      exercises: s.exercises.map((x) => ({ ...x })),
      source: 'ai'
    };
    savePlan(plan);
    ids.push(plan.id);
  });
  return ids;
}

/** How many plans already sit on a given date (shown in the import preview). */
export function plansOnDate(dateISO) {
  return getPlans().filter((p) => (p.date || '').slice(0, 10) === dateISO).length;
}

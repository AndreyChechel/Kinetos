// Active workout logging + finished (read-only) summary.
// Active: live timer, per-set logging via the set runner (stopwatch + effort),
// swipe/long-press set deletion, hold-to-drag exercise reorder, per-entry notes,
// tap-for-chooser / hold-to-type number fields.
// Finished: read-only by default with an explicit Edit mode; notes stay editable;
// extended stats with charts.
import { h, uid, toast, fmtDuration, fmtTimeSec, fmtDate, clickable } from '../ui.js';
import { t, getLang } from '../i18n.js';
import { getSession, saveSession, deleteSession, saveTemplate, getSettings } from '../store.js';
import { getExercise, exName, effectiveWeight, isPerDumbbell, isBarbellAdded, usesBarbell, barKgOf, barbellWeights, defaultBarKg, volumeWeightOf, countUnit } from '../data/db.js';
import { injectExerciseSVG } from '../svg.js';
import {
  exercisePicker, confirmDialog, promptDialog, PROMPT_DELETE, popoverMenu, repChooser, barChooser,
  weightChooser, setRunner, EFFORT_COLORS, attachLongPress, attachSwipeToDelete
} from '../components.js';
import { makeSortable } from '../sortable.js';
import { lastSetFor, sessionDurationMs, targetsFromSession, bestE1RMBefore } from '../workout.js';
import { sessionVolume, oneRepMax, platesPerSide } from '../calc.js';
import { suggestNext, formatSuggestion, suggestionReason, applyToSet, weightStepFor } from '../suggest.js';
import { ensureChart, chartOrFallback } from '../charts.js';
import { icon } from '../icons.js';

let timer = null;
let restInt = null;             // rest-countdown interval (active sessions)
let collapsed = new Set();      // entry ids currently collapsed (UI-only)
let collapsedFor = null;        // session id the collapsed set belongs to
let editMode = false;           // finished session: has the user opted into editing?
let editModeFor = null;
window.addEventListener('route:change', () => {
  if (timer) { clearInterval(timer); timer = null; }
  if (restInt) { clearInterval(restInt); restInt = null; }
  // Never carry Edit mode across navigations — returning to a finished session
  // must always land read-only (accidental edits to history are too easy).
  editMode = false; editModeFor = null;
});

const EFFORT = { 1: { label: 'effortEasy' }, 2: { label: 'effortMedium' }, 3: { label: 'effortHard' } };
const EFFORT_COLOR = EFFORT_COLORS;

// Which set field holds a metric's primary logged value.
const VALUE_KEY = { reps: 'reps', count: 'count', time: 'seconds', distance: 'distanceKm' };
// Long-press duration before an exercise card becomes draggable.
const DRAG_HOLD_MS = 400;

// Inline SVG glyphs for the done control — SVG (not text) so a long-press can't
// trigger native text selection / callout on touch devices.
const ICON_DONE = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M5 12.5l4.2 4.3L19 7.2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_TODO = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
// Pending set in a live session: a "go" glyph, since tapping starts the set runner.
const ICON_START = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10.3 8.8l4.9 3.2-4.9 3.2z" fill="currentColor"/></svg>';

export default function renderSession(root, params, ctx) {
  if (timer) { clearInterval(timer); timer = null; }
  const s = getSession(params.id);
  if (!s) { ctx.navigate('/'); return; }
  s.entries = s.entries || []; // hand-edited imports may lack the array
  if (collapsedFor !== s.id) { collapsed = new Set(); collapsedFor = s.id; }
  if (editModeFor !== s.id) { editMode = false; editModeFor = s.id; }
  const lang = getLang();
  const finished = !!s.endedAt;
  const editable = !finished || editMode;
  const persist = () => saveSession(s);

  ctx.setTitle(s.name || (finished ? t('session.summary') : t('session.active')));

  const wrap = h('div', { class: 'stack' });

  // ---- Rest timer (active sessions): counts down after a set is marked done ----
  const restLabel = h('span', { class: 'restbar__label' });
  const restBar = h('div', { class: 'restbar', hidden: true, role: 'timer' }, [
    restLabel,
    h('button', { class: 'restbar__skip', type: 'button', 'aria-label': t('common.close'), onclick: () => stopRest() }, [icon('x', { size: 16 })])
  ]);
  let restEndsAt = 0;
  /** `set` may carry a planned per-set rest override; otherwise the profile default.
   *  A profile timer of 0 means "no rest timer, ever" — a plan must not override
   *  a switch the user deliberately turned off. */
  function startRest(set) {
    const dflt = Number(getSettings().restSeconds ?? 90);
    const override = Number(set && set.restSeconds);
    const secs = (dflt && override > 0) ? override : dflt;
    if (!secs || finished) return;
    restEndsAt = Date.now() + secs * 1000;
    restBar.hidden = false;
    if (restInt) clearInterval(restInt);
    restInt = setInterval(tickRest, 250);
    tickRest();
  }
  function tickRest() {
    const left = restEndsAt - Date.now();
    if (left <= 0) {
      stopRest();
      if (navigator.vibrate) { try { navigator.vibrate([150, 90, 150]); } catch (_) { /* ignore */ } }
      toast(t('session.restDone'));
      return;
    }
    restLabel.textContent = t('session.rest') + ' · ' + fmtDuration(left);
  }
  function stopRest() {
    if (restInt) { clearInterval(restInt); restInt = null; }
    restBar.hidden = true;
  }

  // ---- Header ----
  const nameInput = h('input', { class: 'input', value: s.name, placeholder: t('common.name') });
  nameInput.addEventListener('change', () => { s.name = nameInput.value.trim(); persist(); ctx.setTitle(s.name || (finished ? t('session.summary') : t('session.active'))); });
  const elapsed = h('span', { class: 'timer', text: fmtDuration(sessionDurationMs(s)) });
  wrap.appendChild(h('div', { class: 'card' }, [
    editable ? nameInput : null,
    h('div', { class: 'row row--between', style: editable ? 'margin-top:10px' : '' }, [
      h('span', { class: 'badge ' + (finished ? '' : 'badge--live') },
        finished ? [icon('check', { size: 14 }), ' ' + fmtDate(s.startedAt, lang)]
                 : [icon('dot', { size: 12 }), ' ' + t('session.active')]),
      finished
        ? h('button', { class: 'btn btn--sm ' + (editMode ? 'btn--primary' : ''), onclick: toggleEdit }, [editMode ? t('session.doneEditing') : t('common.edit')])
        : h('span', {}, [h('span', { class: 'muted small', text: t('session.elapsed') + ': ' }), elapsed])
    ])
  ]));
  if (!finished) timer = setInterval(() => { elapsed.textContent = fmtDuration(sessionDurationMs(s)); }, 1000);

  // ---- Finished stats ----
  if (finished) {
    const statsHost = h('div', { class: 'stack' });
    wrap.appendChild(statsHost);
    renderFinishedStats(statsHost, s, lang);
  }

  // ---- Session notes (editable even in read-only) ----
  wrap.appendChild(sessionNotesCard());

  // ---- Exercises ----
  const exWrap = h('div', { class: 'stack' });
  wrap.appendChild(exWrap);

  function renderExercises() {
    exWrap.innerHTML = '';
    if (!s.entries.length) {
      exWrap.appendChild(h('div', { class: 'card center muted', text: t('session.empty') }));
      return;
    }
    s.entries.forEach((entry, idx) => exWrap.appendChild(entryCard(entry, idx)));
  }
  // Attach drag-reorder once (exWrap persists across re-renders); handles are
  // resolved at drag time so rebuilding children is fine.
  // Reorder by pressing and holding the exercise thumbnail, then dragging — a
  // plain tap on it still opens the exercise detail.
  if (editable) makeSortable(exWrap, { handle: '.list__thumb', holdMs: DRAG_HOLD_MS, onReorder: (from, to) => { const [it] = s.entries.splice(from, 1); s.entries.splice(to, 0, it); persist(); renderExercises(); } });

  function entryCard(entry, idx) {
    const ex = getExercise(entry.exerciseId);
    const metric = ex ? ex.metric : 'reps';
    const isCollapsed = collapsed.has(entry.id);
    const thumb = h('div', { class: 'list__thumb' + (editable ? ' entry-grip' : ''), style: editable ? '' : 'cursor:pointer', title: editable ? t('common.reorder') : t('exercises.title') });
    if (ex) injectExerciseSVG(thumb, ex);
    thumb.addEventListener('click', (e) => { e.stopPropagation(); ctx.navigate('/exercises/' + entry.exerciseId); });

    const doneCount = entry.sets.filter((x) => x.done).length;
    // Every set logged: tint the card so finished exercises stand out at a glance.
    const allDone = entry.sets.length > 0 && doneCount === entry.sets.length;

    const header = h('div', { class: 'row', style: 'cursor:pointer; gap:10px', onclick: (e) => {
      if (e.target.closest('.entry-tools') || e.target.closest('.list__thumb')) return;
      if (isCollapsed) collapsed.delete(entry.id); else collapsed.add(entry.id);
      renderExercises();
    } }, [
      thumb,
      h('div', { class: 'list__body' }, [
        h('div', { class: 'list__title', text: ex ? exName(ex) : entry.exerciseId }),
        isCollapsed
          ? h('div', { class: 'list__sub', text: `${doneCount}/${entry.sets.length} ${t('common.sets')}` })
          : prevHint(entry.exerciseId)
      ]),
      // Add set, then note, then remove — the destructive action stays on the outside.
      h('div', { class: 'entry-tools row', style: 'gap:2px' }, [
        editable ? h('button', { class: 'btn btn--icon btn--ghost btn--sm', 'aria-label': t('session.addSet'), title: t('session.addSet'),
          onclick: () => {
            entry.sets.push(nextSet(entry, metric));
            collapsed.delete(entry.id); // a new set should be visible straight away
            persist(); renderExercises();
          } }, [icon('plus', { size: 18 })]) : null,
        noteButton(entry),
        editable ? h('button', { class: 'btn btn--icon btn--ghost btn--sm', 'aria-label': t('session.removeExercise'), title: t('session.removeExercise'),
          onclick: () => confirmRemoveExercise(idx) }, [icon('trash', { size: 18 })]) : null
      ])
    ]);

    const body = h('div', { class: 'stack', style: 'margin-top:10px' });
    if (!isCollapsed) {
      if (editable && !finished) {
        const sug = suggestNext(entry.exerciseId, s.id);
        if (sug) body.appendChild(suggestionChip(entry, sug, metric));
      }
      const perDb = isPerDumbbell(entry.exerciseId);
      const barAdd = isBarbellAdded(entry.exerciseId);
      entry.sets.forEach((set, si) => {
        body.appendChild(editable ? setRow(entry, set, si, metric) : setRowRO(set, metric, perDb, barAdd, entry.exerciseId));
        // A cue written into the plan for this one set (e.g. "drop set", "AMRAP").
        if (set.note) body.appendChild(setNoteBlock(set));
      });
      body.appendChild(entryNoteBlock(entry));
    }

    return h('div', { class: 'card' + (allDone ? ' card--complete' : '') }, [header, isCollapsed ? null : body]);
  }

  // --- editable set row ---
  function setRow(entry, set, si, metric) {
    const numInput = (val, key, ph, opts = {}) => {
      const inp = h('input', { class: 'input set__in', type: 'number', inputmode: 'decimal', value: val ?? '', placeholder: ph, ...opts });
      inp.addEventListener('change', () => { const n = parseFloat(inp.value); set[key] = isNaN(n) ? null : n; persist(); });
      return inp;
    };
    let row;
    // Repaint just this row after a done/effort change — a full renderExercises()
    // here rebuilt every card (and SVG) per tap, dropping focus and scroll.
    const repaintRow = () => { const fresh = setRow(entry, set, si, metric); row.replaceWith(fresh); };
    const fields = h('div', { class: 'set__fields' });
    if (metric === 'reps') {
      const repsInp = numInput(set.reps, 'reps', set.targetReps ? String(set.targetReps) : t('common.reps'), { step: '1' });
      // Tap = pick from the presets, hold (or "Custom…") = enter a free value.
      // Picking a value is an explicit target — recorded so the suggestion engine
      // judges next time against what the user actually aimed for.
      const applyReps = (v) => { set.reps = v; set.targetReps = v; repsInp.value = v; persist(); };
      const repsCustom = () => customNumberPrompt(set.reps ?? set.targetReps ?? null, t('common.reps'), (n) => applyReps(Math.round(n)));
      tapToChoose(repsInp, t('session.repsHint'),
        () => repChooser(repsInp, set.reps ?? set.targetReps ?? null, applyReps, repsCustom),
        repsCustom);
      if (isPerDumbbell(entry.exerciseId)) fields.append(x2Badge());
      if (isBarbellAdded(entry.exerciseId)) fields.append(barButton(set));
      const weightInp = numInput(set.weightKg, 'weightKg', set.targetWeightKg ? String(set.targetWeightKg) : t('units.kg'), { step: String(weightStepFor(entry.exerciseId)) });
      const weightCustom = () => customNumberPrompt(set.weightKg ?? set.targetWeightKg ?? null, `${t('common.weight')} (${t('units.kg')})`, (n) => { set.weightKg = n; weightInp.value = n; persist(); });
      tapToChoose(weightInp, t('session.weightHint'),
        () => showWeightChooser(weightInp, set, entry, weightCustom),
        weightCustom);
      fields.append(weightInp, repsInp);
    } else if (metric === 'time') {
      fields.append(numInput(set.seconds, 'seconds', t('common.sec'), { step: '5' }));
    } else if (metric === 'count') {
      fields.append(numInput(set.count, 'count', countUnit(entry.exerciseId), { step: '1' }));
    } else {
      fields.append(numInput(set.distanceKm, 'distanceKm', t('units.km'), { step: '0.1' }),
        // A planned pace shows as the placeholder, the way targetReps does.
        numInput(set.minutes, 'minutes', set.targetMinutes ? String(set.targetMinutes) : t('common.min'), { step: '1' }));
    }

    const numEl = h('span', { class: 'set__n', text: String(set.n) });

    row = h('div', { class: 'set' + (set.done ? ' set--done' : '') }, [numEl, fields, doneControl(entry, set, repaintRow, metric)]);
    if (set.done && set.timestamp) {
      const ts = h('div', { class: 'set__ts set__ts--edit small muted', style: 'cursor:pointer', title: t('session.editTime'),
        text: fmtTimeSec(set.timestamp, lang) + durationSuffix(set) });
      attachLongPress(ts, { onLongPress: () => editSetTime(set) });
      row.appendChild(ts);
    }
    attachSwipeToDelete(row, { onDelete: () => deleteSet(entry, si, { undoable: true }), isEnabled: () => editable });
    return row;
  }

  /** Set duration recorded by the set runner, as " · 0:42" (empty when unknown). */
  function durationSuffix(set) {
    return set.durationMs > 0 ? ' · ' + fmtDuration(set.durationMs) : '';
  }

  /** Tap a number field to pick from a chooser; press and hold (or the chooser's
   *  "Custom…" option) to enter a free value. The field stays read-only: inline
   *  typing is unreliable on mobile — a long-press on a number input makes the OS
   *  select the value / pop a "Search" toolbar instead of letting you type — so
   *  custom entry goes through a modal prompt (which can also raise the keyboard). */
  function tapToChoose(inp, hint, openChooser, openCustom) {
    inp.readOnly = true;
    inp.classList.add('set__in--locked');
    inp.title = hint;
    // Never inline-edited, so block the native selection/callout outright.
    inp.addEventListener('contextmenu', (e) => e.preventDefault());
    inp.addEventListener('selectstart', (e) => e.preventDefault());
    // Keyboard path: Enter/Space opens the chooser, F2 opens the custom prompt.
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChooser(); }
      else if (e.key === 'F2' && openCustom) { e.preventDefault(); openCustom(); }
    });
    attachLongPress(inp, {
      onTap: () => { inp.blur(); openChooser(); },
      onLongPress: openCustom
    });
  }

  /** Prompt for a free numeric value via a modal (mobile-safe, unlike inline
   *  editing of the list field). `apply(n)` gets a parsed, non-negative number. */
  function customNumberPrompt(current, title, apply) {
    promptDialog(title, { type: 'number', value: current != null ? String(current) : '', placeholder: title })
      .then((res) => {
        if (res == null) return;                       // cancelled
        const n = parseFloat(String(res).replace(',', '.'));
        if (!isFinite(n) || n < 0) return;             // ignore blanks / bad input
        apply(n);
      });
  }

  // --- quick weight chooser (tap a weight field) ---
  // On barbell exercises the popover title doubles as the plate calculator:
  // it shows what the current weight needs per side.
  function showWeightChooser(anchor, set, entry, onCustom) {
    const base = set.weightKg ?? set.targetWeightKg ?? 0;
    weightChooser(anchor, base, weightStepFor(entry.exerciseId), (v) => {
      set.weightKg = v; anchor.value = v; persist();
    }, { title: usesBarbell(entry.exerciseId) ? platesTitle(set, entry) : `${t('common.weight')} (${t('units.kg')})`, onCustom });
  }
  /** "60 kg · per side: 20 + 5" for the weight chooser's title on barbell lifts. */
  function platesTitle(set, entry) {
    const label = `${t('common.weight')} (${t('units.kg')})`;
    if (set.weightKg == null) return label;
    const barAdd = isBarbellAdded(entry.exerciseId);
    const bar = barAdd ? barKgOf(set) : defaultBarKg();
    const total = barAdd ? set.weightKg + bar : set.weightKg;
    const res = platesPerSide(total, bar, getSettings().plates || []);
    if (!res) return label;
    const text = (res.plates.length ? res.plates.join(' + ') : '0') + (res.remainder ? ` (+${res.remainder})` : '');
    return `${total} ${t('units.kg')} · ${t('session.perSide')}: ${text}`;
  }

  // --- barbell bar-weight chooser (only when Profile → Barbell = "add bar") ---
  function barButton(set) {
    const cur = barKgOf(set);
    const btn = h('button', { class: 'barbtn', type: 'button', title: t('session.barWeight'), text: '+' + cur });
    btn.addEventListener('click', () => barChooser(btn, cur, barbellWeights(), (w) => { set.barKg = w; persist(); renderExercises(); }));
    return btn;
  }

  // --- combined effort + done control ---
  // Pending set + tap  -> open the set runner (stopwatch, value ±, effort)
  // Done set    + tap  -> mark not done again
  // Any set     + hold -> effort menu (log instantly without the stopwatch)
  function doneControl(entry, set, onChanged, metric) {
    const btn = h('button', { class: 'donebtn', 'aria-label': t('session.done'), 'aria-pressed': set.done ? 'true' : 'false' });
    paint();
    attachLongPress(btn, {
      onTap: () => {
        if (set.done) { clearDone(set); persist(); onChanged(); }
        else if (finished) { markDone(set, 2); persist(); onChanged(); }
        else runSet(entry, set, metric, onChanged);
      },
      onLongPress: () => effortMenu(btn, entry, set, onChanged)
    });
    function paint() {
      btn.className = 'donebtn' + (set.done ? ' donebtn--done done-eff--' + (set.effort || 2) : '');
      btn.innerHTML = set.done ? ICON_DONE : (finished ? ICON_TODO : ICON_START);
      btn.title = set.done ? t('session.' + EFFORT[set.effort || 2].label) : t('session.startSet');
    }
    return btn;
  }

  /** Open the stopwatch panel for a pending set, then log it on finish. */
  function runSet(entry, set, metric, onChanged) {
    const ex = getExercise(entry.exerciseId);
    const key = VALUE_KEY[metric] || 'reps';
    const opts = { reps: { step: 1, min: 0, max: 999, unitLabel: t('common.reps') },
      // Counted machines run into the hundreds — step in 5s (hold ± to repeat),
      // and the exact figure can still be corrected in the set row afterwards.
      count: { step: 5, min: 0, max: 99999, unitLabel: countUnit(entry.exerciseId) },
      time: { step: 5, min: 0, max: 7200, unitLabel: t('common.sec') },
      distance: { step: 0.1, min: 0, max: 500, decimals: 1, unitLabel: t('units.km') } }[metric] || {};
    setRunner({
      ...opts,
      title: `${ex ? exName(ex) : entry.exerciseId} · ${t('common.set')} ${set.n}`,
      metric,
      value: set[key] ?? (metric === 'reps' ? set.targetReps : null) ?? 0,
      onFinish: ({ effort, value, durationMs, startedAt }) => {
        if (value != null) set[key] = value;
        applyMeasuredTime(set, metric, durationMs);
        set.startedAt = startedAt;
        set.durationMs = durationMs;
        markDone(set, effort);
        persist(); onChanged();
      }
    });
  }

  /** Fold the stopwatch reading into the set's own time fields where it IS the
   *  measurement. Distance keeps a value the user typed — the clock only fills
   *  an empty minutes field so a mis-tap can't overwrite a real split. */
  function applyMeasuredTime(set, metric, durationMs) {
    if (metric === 'time') set.seconds = Math.max(1, Math.round(durationMs / 1000));
    else if (metric === 'distance' && !set.minutes) set.minutes = Math.round(durationMs / 6000) / 10;
  }

  function clearDone(set) {
    set.done = false; set.effort = null; set.timestamp = null;
    set.startedAt = null; set.durationMs = null;
  }

  /** Mark a set done at the given effort. Re-rating an already-done set only
   *  changes the rating: re-stamping its time would rewrite history, and
   *  restarting the rest countdown mid-rest is just wrong. */
  function markDone(set, eff) {
    const wasDone = !!set.done;
    set.done = true; set.effort = eff;
    if (wasDone) return;
    if (!finished) {
      set.timestamp = new Date().toISOString();
      startRest(set);
    } else if (!set.timestamp) {
      // Editing history: keep the original timing — don't re-stamp with "now".
      set.timestamp = s.endedAt || s.startedAt;
    }
  }
  function effortMenu(anchor, entry, set, onChanged) {
    const items = [1, 2, 3].map((e) => ({ label: t('session.' + EFFORT[e].label), color: EFFORT_COLOR[e], active: set.done && set.effort === e,
      onClick: () => { markDone(set, e); persist(); onChanged(); } }));
    if (set.done) items.push({ label: t('session.markUndone'), onClick: () => { clearDone(set); persist(); onChanged(); } });
    items.push({ label: t('plan.setNote'), onClick: () => editSetNote(set) });
    items.push({ label: t('common.delete'), onClick: () => confirmDeleteSet(entry, entry.sets.indexOf(set)) });
    popoverMenu(anchor, items, { title: t('session.effort') });
  }

  // --- read-only set row ---
  function setRowRO(set, metric, perDb, barAdd, exerciseId) {
    let val;
    if (metric === 'time') val = set.seconds ? `${set.seconds} ${t('common.sec')}` : '—';
    else if (metric === 'count') val = set.count ? `${set.count} ${countUnit(exerciseId)}` : '—';
    else if (metric === 'distance') val = [set.distanceKm ? `${set.distanceKm} ${t('units.km')}` : null, set.minutes ? `${set.minutes} ${t('common.min')}` : null].filter(Boolean).join(' · ') || '—';
    else val = set.weightKg ? `${set.weightKg} ${t('units.kg')} × ${set.reps ?? '—'}` : (set.reps ? `${set.reps} ${t('common.reps')}` : '—');
    const showX2 = perDb && metric === 'reps' && !!set.weightKg;
    const showBar = barAdd && metric === 'reps' && set.weightKg != null;
    return h('div', { class: 'set set--ro' + (set.done ? ' set--done' : '') }, [
      h('span', { class: 'set__n', text: String(set.n) }),
      h('div', { class: 'set__ro-val' }, [val, showX2 ? x2Badge() : null, showBar ? barBadge(barKgOf(set)) : null]),
      set.effort ? h('span', { class: 'eff-dot done-eff--' + set.effort, title: t('session.' + EFFORT[set.effort].label) }) : null,
      set.done ? h('span', { class: 'set__done-mark', style: 'color:var(--success)' }, [icon('check', { size: 16 })]) : null,
      set.timestamp ? h('span', { class: 'set__ts small muted', text: fmtTimeSec(set.timestamp, lang) + durationSuffix(set) }) : null
    ]);
  }

  function deleteSet(entry, si, { undoable = false } = {}) {
    const removed = entry.sets[si];
    entry.sets.splice(si, 1);
    entry.sets.forEach((x, i) => (x.n = i + 1));
    persist(); renderExercises();
    // The swipe gesture is easy to hit by accident on a phone — offer an Undo
    // instead of forcing a confirm dialog on every intentional delete.
    if (undoable && removed) {
      toast(t('toast.setDeleted'), { action: t('common.undo'), duration: 5000, onAction: () => {
        entry.sets.splice(Math.min(si, entry.sets.length), 0, removed);
        entry.sets.forEach((x, i) => (x.n = i + 1));
        persist(); renderExercises();
      } });
    }
  }
  async function confirmDeleteSet(entry, si) {
    if (await confirmDialog(t('session.removeSetConfirm'), { danger: true, okText: t('common.delete') })) deleteSet(entry, si);
  }
  async function confirmRemoveExercise(idx) {
    if (await confirmDialog(t('session.removeExerciseConfirm'), { danger: true, okText: t('common.delete') })) {
      s.entries.splice(idx, 1); persist(); renderExercises();
    }
  }
  async function editSetTime(set) {
    const v = await promptDialog(t('session.editTime'), { type: 'datetime-local', value: tsToLocalInput(set.timestamp || s.startedAt) });
    if (v == null) return;
    const iso = localInputToISO(v);
    if (iso) { set.timestamp = iso; persist(); renderExercises(); }
  }

  // --- per-entry note — editable in read-only too ---
  // The control lives in the card header (left of the remove button) so it
  // costs no vertical space in the set list; deleting happens inside the dialog.
  function noteButton(entry) {
    const btn = h('button', {
      class: 'btn btn--icon btn--ghost btn--sm' + (entry.note ? ' btn--note-on' : ''),
      'aria-label': entry.note ? t('session.entryNote') : t('session.addNote'),
      title: entry.note ? t('session.entryNote') : t('session.addNote'),
      onclick: (e) => { e.stopPropagation(); editEntryNote(entry); }
    }, [icon('note', { size: 18 })]);
    return btn;
  }

  async function editEntryNote(entry) {
    const had = !!entry.note;
    const res = await promptDialog(t('session.entryNote'), {
      multiline: true, value: entry.note || '', placeholder: t('exercises.notePlaceholder'),
      deleteText: had ? t('common.delete') : undefined
    });
    if (res == null) return;
    if (res === PROMPT_DELETE) {
      if (!(await confirmDialog(t('exercises.deleteNote'), { danger: true, okText: t('common.delete') }))) return;
      entry.note = '';
    } else {
      entry.note = String(res).trim();
    }
    persist(); renderExercises();
  }

  /** A planned per-set cue, shown under its own set row. Tap to edit — notes stay
   *  editable in a read-only session, like the session and per-entry notes do.
   *  (The effort menu has the same entry, for sets that carry no cue yet.) */
  function setNoteBlock(set) {
    const box = h('div', { class: 'note note--inline note--set', title: t('plan.setNote'), style: 'cursor:pointer' }, [
      h('div', { class: 'note__text', text: set.n + '. ' + set.note })
    ]);
    box.addEventListener('click', () => editSetNote(set));
    return clickable(box);
  }

  async function editSetNote(set) {
    const had = !!set.note;
    const res = await promptDialog(t('plan.setNote'), {
      multiline: true, value: set.note || '', placeholder: t('exercises.notePlaceholder'),
      deleteText: had ? t('common.delete') : undefined
    });
    if (res == null) return;
    set.note = res === PROMPT_DELETE ? '' : String(res).trim();
    persist(); renderExercises();
  }

  /** Read-only rendering of the note under the set list (edited from the header). */
  function entryNoteBlock(entry) {
    const host = h('div', { class: 'entry-note' });
    if (entry.note) {
      host.appendChild(h('div', { class: 'note note--inline' }, [
        h('div', { class: 'note__text', text: entry.note })
      ]));
    }
    return host;
  }

  function sessionNotesCard() {
    const host = h('div', {});
    draw();
    function draw() {
      host.innerHTML = '';
      host.appendChild(h('div', { class: 'card' }, [
        h('div', { class: 'row row--between', style: 'margin-bottom:6px' }, [
          h('div', { class: 'card__title', style: 'margin:0', text: t('common.notes') }),
          h('button', { class: 'btn btn--sm btn--ghost', onclick: edit }, s.notes ? [t('common.edit')] : [icon('plus', { size: 16 }), ' ' + t('common.add')])
        ]),
        s.notes ? h('div', { class: 'note__text', text: s.notes }) : h('p', { class: 'muted small', style: 'margin:0', text: t('session.noNotes') })
      ]));
    }
    async function edit() {
      const txt = await promptDialog(t('common.notes'), { multiline: true, value: s.notes || '', placeholder: t('exercises.notePlaceholder') });
      if (txt != null) { s.notes = txt.trim(); persist(); draw(); }
    }
    return host;
  }

  function prevHint(exerciseId) {
    const last = lastSetFor(exerciseId, s.id);
    if (!last) return h('div', { class: 'list__sub muted', text: '' });
    const best = last.sets.map((x) => x.weightKg ? `${x.weightKg}×${x.reps}` : (x.reps || x.seconds || x.distanceKm || '')).slice(0, 4).join(', ');
    return h('div', { class: 'list__sub', text: t('session.previous') + ': ' + best });
  }

  function nextSet(entry, metric) {
    const prev = entry.sets[entry.sets.length - 1] || {};
    const defReps = metric === 'reps' ? 12 : null;
    // targetReps only carries over when it was explicitly set (plan target or
    // rep-chooser pick) — stamping the 12-rep default here made every workout
    // that wasn't 12s read as "missed target" and froze the suggestions.
    // The rest override carries over (same exercise, same pacing); the cue does
    // not — it was written for the set it sat on.
    return { n: entry.sets.length + 1, reps: prev.reps ?? defReps, weightKg: prev.weightKg ?? null,
      seconds: prev.seconds ?? null, count: prev.count ?? null, distanceKm: prev.distanceKm ?? null, minutes: prev.minutes ?? null,
      effort: null, targetReps: prev.targetReps ?? null, targetMinutes: prev.targetMinutes ?? null,
      barKg: prev.barKg ?? null, done: false, restSeconds: prev.restSeconds ?? null, note: '',
      timestamp: null, startedAt: null, durationMs: null };
  }

  function suggestionChip(entry, sug, metric) {
    return h('div', { class: 'suggest' }, [
      h('span', { class: 'suggest__ico' }, [icon('bulb', { size: 18 })]),
      h('div', { class: 'suggest__txt' }, [
        h('span', { class: 'suggest__val', text: t('session.suggested') + ': ' + formatSuggestion(sug, metric, countUnit(entry.exerciseId)) }),
        h('span', { class: 'suggest__reason', text: ' · ' + suggestionReason(sug) })
      ]),
      h('button', { class: 'btn btn--sm btn--primary', onclick: () => applySuggestion(entry, sug, metric) }, [t('session.use')])
    ]);
  }

  function applySuggestion(entry, sug, metric) {
    const filled = (st) => metric === 'time' ? st.seconds : metric === 'count' ? st.count
      : metric === 'distance' ? (st.distanceKm || st.minutes) : (st.weightKg || st.reps);
    // Prefer an empty pending set, else fill the first not-done one (plan-prefilled
    // sets count as "filled" but should be updated, not duplicated with a 4th set).
    let target = entry.sets.find((st) => !st.done && !filled(st)) || entry.sets.find((st) => !st.done);
    if (!target) { target = nextSet(entry, metric); entry.sets.push(target); }
    applyToSet(target, sug);
    persist(); renderExercises();
  }

  renderExercises();

  // ---- Footer ----
  if (editable) {
    wrap.appendChild(h('button', { class: 'btn btn--block', onclick: () => exercisePicker((ex) => {
      const set0 = freshSet(ex.metric);
      if (!finished) { const sug = suggestNext(ex.id, s.id); if (sug) applyToSet(set0, sug); }
      s.entries.push({ id: uid('en'), exerciseId: ex.id, note: '', sets: [set0] });
      persist(); renderExercises();
    }) }, [icon('plus', { size: 16 }), ' ' + t('session.addExercise')]));
  }
  if (!finished) {
    wrap.appendChild(h('button', { class: 'btn btn--primary btn--block', onclick: finish }, [t('session.finish')]));
    wrap.appendChild(h('button', { class: 'btn btn--ghost btn--block', style: 'color:var(--danger)', onclick: discard }, [t('session.discard')]));
  } else {
    wrap.appendChild(h('button', { class: 'btn btn--block', onclick: saveAsTemplate }, [t('plan.saveAsTemplate')]));
    wrap.appendChild(h('button', { class: 'btn btn--danger btn--block', onclick: remove }, [t('common.delete')]));
  }

  root.appendChild(wrap);
  if (!finished) root.appendChild(restBar);

  function freshSet(metric) {
    const defReps = metric === 'reps' ? 12 : null;
    // See nextSet(): 12 reps stays a prefill, never an implicit target.
    return { n: 1, reps: defReps, weightKg: null, seconds: null, count: null, distanceKm: null, minutes: null,
      effort: null, targetReps: null, targetMinutes: null, barKg: null, done: false, restSeconds: null, note: '',
      timestamp: null, startedAt: null, durationMs: null };
  }
  function toggleEdit() {
    // Re-render in place (no navigation) — route:change resets editMode.
    editMode = !editMode; editModeFor = s.id;
    root.innerHTML = '';
    renderSession(root, params, ctx);
  }
  function detectPRs() {
    const names = [];
    (s.entries || []).forEach((e) => {
      const ex = getExercise(e.exerciseId);
      if (!ex || ex.metric !== 'reps') return;
      let best = 0;
      (e.sets || []).forEach((st) => {
        if (st.done === false || !st.weightKg || !st.reps) return;
        const o = oneRepMax(effectiveWeight(e.exerciseId, st.weightKg, st), st.reps);
        if (o && o.avg > best) best = o.avg;
      });
      if (best > 0 && best > bestE1RMBefore(e.exerciseId, s.id)) names.push(exName(ex));
    });
    return names;
  }
  async function finish() {
    if (await confirmDialog(t('session.finishConfirm'), { okText: t('session.finish') })) {
      const prs = detectPRs(); // before endedAt flips this session into history
      s.endedAt = new Date().toISOString();
      if (timer) { clearInterval(timer); timer = null; }
      stopRest();
      persist();
      if (prs.length) toast(t('session.newPR', { names: prs.join(', ') }), { duration: 4500 });
      else toast(t('toast.sessionSaved'));
      ctx.navigate('/session/' + s.id);
    }
  }
  async function discard() {
    if (await confirmDialog(t('session.discardConfirm'), { danger: true, okText: t('session.discard') })) {
      if (timer) { clearInterval(timer); timer = null; }
      deleteSession(s.id); ctx.navigate('/');
    }
  }
  async function remove() {
    if (await confirmDialog(t('session.deleteConfirm'), { danger: true, okText: t('common.delete') })) {
      deleteSession(s.id); toast(t('toast.deleted')); ctx.navigate('/');
    }
  }
  function saveAsTemplate() {
    const exercises = targetsFromSession(s);
    if (!exercises.length) { toast(t('session.empty')); return; }
    const tpl = { id: uid('tpl'), name: s.name || fmtDate(s.startedAt, lang), notes: s.notes || '', exercises };
    saveTemplate(tpl); toast(t('templates.saved')); ctx.navigate('/templates/' + tpl.id);
  }
}

// ---- Finished-session stats + charts (feature 16) ----
async function renderFinishedStats(host, s, lang) {
  const v = sessionVolume(s, volumeWeightOf);
  const eff = avgEffort(s);
  host.appendChild(h('div', { class: 'grid2' }, [
    tile(fmtDuration(sessionDurationMs(s)), t('session.duration')),
    tile(v.sets, t('session.totalSets')),
    tile(v.volume.toLocaleString(lang) + ' ' + t('units.kg'), t('session.volume')),
    eff ? tile(eff.toFixed(1) + ' / 3', t('session.effort')) : tile(v.reps, t('common.reps'))
  ]));

  // Aggregate per-exercise + per-group + effort distribution.
  const perEx = [];         // { name, volume, best, e1rm }
  const byGroup = {};       // group -> done set count
  const effDist = [0, 0, 0];
  (s.entries || []).forEach((e) => {
    const ex = getExercise(e.exerciseId);
    const name = ex ? exName(ex) : e.exerciseId;
    let vol = 0, best = null, e1rm = 0;
    (e.sets || []).forEach((st) => {
      const counted = st.done !== false && (st.reps || st.seconds || st.count || st.distanceKm);
      if (!counted) return;
      const effW = effectiveWeight(e.exerciseId, st.weightKg, st);
      if (st.reps) vol += (effW || 0) * st.reps;
      if (st.weightKg && st.reps) {
        const o = oneRepMax(effW, st.reps);
        if (o && o.avg > e1rm) e1rm = o.avg;
        if (!best || st.weightKg > (best.weightKg || 0)) best = st;
      } else if (!best && st.reps) best = st;
      if (ex) byGroup[ex.group] = (byGroup[ex.group] || 0) + 1;
      if (st.effort) effDist[st.effort - 1]++;
    });
    perEx.push({ exerciseId: e.exerciseId, name, volume: Math.round(vol), best, e1rm: Math.round(e1rm), e1rmRaw: e1rm, perDumbbell: isPerDumbbell(e.exerciseId), barAdd: isBarbellAdded(e.exerciseId) });
  });

  const hasChart = await ensureChart();
  const withVol = perEx.filter((p) => p.volume > 0);
  if (withVol.length) {
    host.appendChild(card(t('session.volumeByExercise'),
      chartOrFallback(hasChart, 'bar', withVol.map((p) => p.name), withVol.map((p) => p.volume), { height: 180 })));
  }
  const gLabels = Object.keys(byGroup);
  if (gLabels.length) {
    host.appendChild(card(t('progress.byMuscle'),
      chartOrFallback(hasChart, 'doughnut', gLabels.map((g) => t('groups.' + g)), gLabels.map((g) => byGroup[g]), { height: 200 })));
  }
  if (effDist.some((x) => x)) {
    host.appendChild(card(t('session.effortBreakdown'),
      chartOrFallback(hasChart, 'doughnut', [t('session.effortEasy'), t('session.effortMedium'), t('session.effortHard')], effDist,
        { colors: [EFFORT_COLOR[1], EFFORT_COLOR[2], EFFORT_COLOR[3]], height: 200 })));
  }
  const withBest = perEx.filter((p) => p.e1rm > 0);
  if (withBest.length) {
    const rows = withBest.map((p) => h('div', { class: 'row row--between', style: 'padding:6px 0;border-bottom:1px solid var(--border)' }, [
      h('span', {}, [
        p.name,
        p.e1rmRaw > bestE1RMBefore(p.exerciseId, s.id) ? h('span', { class: 'tag tag--pr', title: t('progress.est1rm'), text: ' ' + t('session.pr') }) : null
      ]),
      h('span', { class: 'small' }, [
        p.best ? h('span', { class: 'muted', text: `${p.best.weightKg} ${t('units.kg')} × ${p.best.reps}  ` }) : null,
        p.best && p.perDumbbell ? x2Badge() : null,
        p.best && p.barAdd ? barBadge(barKgOf(p.best)) : null,
        h('strong', { text: `${p.e1rm} ${t('units.kg')} ` }),
        h('span', { class: 'muted small', text: t('progress.est1rm') })
      ])
    ]));
    host.appendChild(card(t('session.bestSets'), h('div', {}, rows)));
  }
}

/** ISO timestamp -> value for a <input type="datetime-local"> (local, minute precision). */
function tsToLocalInput(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** datetime-local value (parsed as local time) -> ISO string, or null if invalid. */
function localInputToISO(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
}

/** Small "2×" pill shown on dumbbell exercises when weight is logged per hand. */
function x2Badge() {
  return h('span', { class: 'x2-badge', title: t('session.dumbbellX2Hint'), text: '2×' });
}

/** Small "+<bar>" pill shown on barbell exercises when the bar is added on top. */
function barBadge(barKg) {
  return h('span', { class: 'x2-badge', title: t('session.barWeight'), text: '+' + barKg });
}

function avgEffort(s) {
  const vals = [];
  (s.entries || []).forEach((e) => (e.sets || []).forEach((x) => { if (x.done && x.effort) vals.push(x.effort); }));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function tile(value, label) {
  return h('div', { class: 'stat' }, [h('div', { class: 'stat__value', text: String(value) }), h('div', { class: 'stat__label', text: label })]);
}
function card(title, node) { return h('div', { class: 'card' }, [h('div', { class: 'card__title', text: title }), node]); }

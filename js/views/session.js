// Active workout logging + finished (read-only) summary.
// Active: live timer, per-set logging, combined effort+done control, swipe/long-
// press set deletion, drag-reorder exercises, per-entry notes, rep chooser.
// Finished: read-only by default with an explicit Edit mode; notes stay editable;
// extended stats with charts.
import { h, uid, toast, fmtDuration, fmtTimeSec, fmtDate } from '../ui.js';
import { t, getLang } from '../i18n.js';
import { getSession, saveSession, deleteSession, saveTemplate } from '../store.js';
import { getExercise, exName, effectiveWeight, isPerDumbbell, volumeWeightOf } from '../data/db.js';
import { injectExerciseSVG } from '../svg.js';
import {
  exercisePicker, confirmDialog, promptDialog, popoverMenu, repChooser,
  attachLongPress, attachSwipeToDelete
} from '../components.js';
import { makeSortable } from '../sortable.js';
import { lastSetFor, sessionDurationMs, targetsFromSession } from '../workout.js';
import { sessionVolume, oneRepMax } from '../calc.js';
import { suggestNext, formatSuggestion, suggestionReason, applyToSet } from '../suggest.js';
import { ensureChart, chartOrFallback } from '../charts.js';

let timer = null;
let collapsed = new Set();      // entry ids currently collapsed (UI-only)
let collapsedFor = null;        // session id the collapsed set belongs to
let editMode = false;           // finished session: has the user opted into editing?
let editModeFor = null;
window.addEventListener('route:change', () => { if (timer) { clearInterval(timer); timer = null; } });

const EFFORT = { 1: { label: 'effortEasy' }, 2: { label: 'effortMedium' }, 3: { label: 'effortHard' } };
const EFFORT_COLOR = { 1: 'var(--success)', 2: '#f0b429', 3: 'var(--danger)' };

// Inline SVG glyphs for the done control — SVG (not text) so a long-press can't
// trigger native text selection / callout on touch devices.
const ICON_DONE = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M5 12.5l4.2 4.3L19 7.2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_TODO = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

export default function renderSession(root, params, ctx) {
  if (timer) { clearInterval(timer); timer = null; }
  const s = getSession(params.id);
  if (!s) { ctx.navigate('/'); return; }
  if (collapsedFor !== s.id) { collapsed = new Set(); collapsedFor = s.id; }
  if (editModeFor !== s.id) { editMode = false; editModeFor = s.id; }
  const lang = getLang();
  const finished = !!s.endedAt;
  const editable = !finished || editMode;
  const persist = () => saveSession(s);

  ctx.setTitle(s.name || (finished ? t('session.summary') : t('session.active')));

  const wrap = h('div', { class: 'stack' });

  // ---- Header ----
  const nameInput = h('input', { class: 'input', value: s.name, placeholder: t('common.name') });
  nameInput.addEventListener('change', () => { s.name = nameInput.value.trim(); persist(); ctx.setTitle(s.name || t('session.active')); });
  const elapsed = h('span', { class: 'timer', text: fmtDuration(sessionDurationMs(s)) });
  wrap.appendChild(h('div', { class: 'card' }, [
    editable ? nameInput : null,
    h('div', { class: 'row row--between', style: editable ? 'margin-top:10px' : '' }, [
      h('span', { class: 'badge ' + (finished ? '' : 'badge--live') }, [
        finished ? '✓ ' + fmtDate(s.startedAt, lang) : '● ' + t('session.active')
      ]),
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
  if (editable) makeSortable(exWrap, { handle: '.drag-handle', onReorder: (from, to) => { const [it] = s.entries.splice(from, 1); s.entries.splice(to, 0, it); persist(); renderExercises(); } });

  function entryCard(entry, idx) {
    const ex = getExercise(entry.exerciseId);
    const metric = ex ? ex.metric : 'reps';
    const isCollapsed = collapsed.has(entry.id);
    const thumb = h('div', { class: 'list__thumb', style: 'cursor:pointer', title: t('exercises.title') });
    if (ex) injectExerciseSVG(thumb, ex);
    thumb.addEventListener('click', (e) => { e.stopPropagation(); ctx.navigate('/exercises/' + entry.exerciseId); });

    const doneCount = entry.sets.filter((x) => x.done).length;

    const header = h('div', { class: 'row', style: 'cursor:pointer; gap:10px', onclick: (e) => {
      if (e.target.closest('.entry-tools') || e.target.closest('.drag-handle') || e.target.closest('.list__thumb')) return;
      if (isCollapsed) collapsed.delete(entry.id); else collapsed.add(entry.id);
      renderExercises();
    } }, [
      editable ? h('span', { class: 'drag-handle', 'aria-label': t('common.reorder'), text: '⋮⋮' }) : null,
      h('span', { class: 'chev' + (isCollapsed ? '' : ' chev--open'), text: '▸' }),
      thumb,
      h('div', { class: 'list__body' }, [
        h('div', { class: 'list__title', text: ex ? exName(ex) : entry.exerciseId }),
        isCollapsed
          ? h('div', { class: 'list__sub', text: `${doneCount}/${entry.sets.length} ${t('common.sets')}` })
          : prevHint(entry.exerciseId)
      ]),
      editable ? h('div', { class: 'entry-tools row', style: 'gap:2px' }, [
        h('button', { class: 'btn btn--icon btn--ghost btn--sm', 'aria-label': t('session.removeExercise'),
          onclick: () => { s.entries.splice(idx, 1); persist(); renderExercises(); } }, ['🗑'])
      ]) : null
    ]);

    const body = h('div', { class: 'stack', style: 'margin-top:10px' });
    if (!isCollapsed) {
      if (editable && !finished) {
        const sug = suggestNext(entry.exerciseId, s.id);
        if (sug) body.appendChild(suggestionChip(entry, sug, metric));
      }
      const perDb = isPerDumbbell(entry.exerciseId);
      entry.sets.forEach((set, si) => body.appendChild(editable ? setRow(entry, set, si, metric) : setRowRO(set, metric, perDb)));
      if (editable) body.appendChild(h('button', { class: 'btn btn--sm btn--block', style: 'margin-top:4px',
        onclick: () => { entry.sets.push(nextSet(entry, metric)); persist(); renderExercises(); } }, ['＋ ' + t('session.addSet')]));
      body.appendChild(entryNoteBlock(entry));
    }

    return h('div', { class: 'card' }, [header, isCollapsed ? null : body]);
  }

  // --- editable set row ---
  function setRow(entry, set, si, metric) {
    const numInput = (val, key, ph, opts = {}) => {
      const inp = h('input', { class: 'input set__in', type: 'number', inputmode: 'decimal', value: val ?? '', placeholder: ph, ...opts });
      inp.addEventListener('change', () => { const n = parseFloat(inp.value); set[key] = isNaN(n) ? null : n; persist(); });
      return inp;
    };
    const fields = h('div', { class: 'set__fields' });
    if (metric === 'reps') {
      const repsInp = numInput(set.reps, 'reps', set.targetReps ? String(set.targetReps) : t('common.reps'), { step: '1' });
      attachLongPress(repsInp, { onLongPress: () => repChooser(repsInp, set.reps ?? set.targetReps ?? 12, (v) => { set.reps = v; repsInp.value = v; persist(); }) });
      if (isPerDumbbell(entry.exerciseId)) fields.append(x2Badge());
      fields.append(
        numInput(set.weightKg, 'weightKg', set.targetWeightKg ? String(set.targetWeightKg) : t('units.kg'), { step: '2.5' }),
        repsInp
      );
    } else if (metric === 'time') {
      fields.append(numInput(set.seconds, 'seconds', t('common.sec'), { step: '5' }));
    } else {
      fields.append(numInput(set.distanceKm, 'distanceKm', t('units.km'), { step: '0.1' }),
        numInput(set.minutes, 'minutes', t('common.min'), { step: '1' }));
    }

    const numEl = h('span', { class: 'set__n', title: t('session.removeSet'), text: String(set.n) });
    attachLongPress(numEl, { onLongPress: () => confirmDeleteSet(entry, si) });

    const row = h('div', { class: 'set' + (set.done ? ' set--done' : '') }, [numEl, fields, doneControl(entry, set)]);
    if (set.done && set.timestamp) {
      const ts = h('div', { class: 'set__ts set__ts--edit small muted', style: 'cursor:pointer', title: t('session.editTime'), text: fmtTimeSec(set.timestamp, lang) });
      attachLongPress(ts, { onLongPress: () => editSetTime(set) });
      row.appendChild(ts);
    }
    attachSwipeToDelete(row, { onDelete: () => deleteSet(entry, si), isEnabled: () => editable });
    return row;
  }

  // --- combined effort + done control (feature 10) ---
  function doneControl(entry, set) {
    const btn = h('button', { class: 'donebtn', 'aria-label': t('session.done') });
    paint();
    attachLongPress(btn, {
      onTap: () => {
        if (set.done) { set.done = false; set.effort = null; set.timestamp = null; }
        else markDone(set, 2);
        persist(); renderExercises();
      },
      onLongPress: () => effortMenu(btn, set)
    });
    function paint() {
      btn.className = 'donebtn' + (set.done ? ' donebtn--done done-eff--' + (set.effort || 2) : '');
      btn.innerHTML = set.done ? ICON_DONE : ICON_TODO;
      btn.title = set.done ? t('session.' + EFFORT[set.effort || 2].label) : t('session.markDone');
    }
    return btn;
  }
  function markDone(set, eff) { set.done = true; set.effort = eff; set.timestamp = new Date().toISOString(); }
  function effortMenu(anchor, set) {
    const items = [1, 2, 3].map((e) => ({ label: t('session.' + EFFORT[e].label), color: EFFORT_COLOR[e], active: set.done && set.effort === e,
      onClick: () => { markDone(set, e); persist(); renderExercises(); } }));
    if (set.done) items.push({ label: t('session.markUndone'), onClick: () => { set.done = false; set.effort = null; set.timestamp = null; persist(); renderExercises(); } });
    popoverMenu(anchor, items, { title: t('session.effort') });
  }

  // --- read-only set row ---
  function setRowRO(set, metric, perDb) {
    let val;
    if (metric === 'time') val = set.seconds ? `${set.seconds} ${t('common.sec')}` : '—';
    else if (metric === 'distance') val = [set.distanceKm ? `${set.distanceKm} ${t('units.km')}` : null, set.minutes ? `${set.minutes} ${t('common.min')}` : null].filter(Boolean).join(' · ') || '—';
    else val = set.weightKg ? `${set.weightKg} ${t('units.kg')} × ${set.reps ?? '—'}` : (set.reps ? `${set.reps} ${t('common.reps')}` : '—');
    const showX2 = perDb && metric === 'reps' && !!set.weightKg;
    return h('div', { class: 'set set--ro' + (set.done ? ' set--done' : '') }, [
      h('span', { class: 'set__n', text: String(set.n) }),
      h('div', { class: 'set__ro-val' }, [val, showX2 ? x2Badge() : null]),
      set.effort ? h('span', { class: 'eff-dot done-eff--' + set.effort, title: t('session.' + EFFORT[set.effort].label) }) : null,
      set.done ? h('span', { class: 'set__done-mark', text: '✓' }) : null,
      set.timestamp ? h('span', { class: 'set__ts small muted', text: fmtTimeSec(set.timestamp, lang) }) : null
    ]);
  }

  function deleteSet(entry, si) { entry.sets.splice(si, 1); entry.sets.forEach((x, i) => (x.n = i + 1)); persist(); renderExercises(); }
  async function confirmDeleteSet(entry, si) {
    if (await confirmDialog(t('session.removeSetConfirm'), { danger: true, okText: t('common.delete') })) deleteSet(entry, si);
  }
  async function editSetTime(set) {
    const v = await promptDialog(t('session.editTime'), { type: 'datetime-local', value: tsToLocalInput(set.timestamp || s.startedAt) });
    if (v == null) return;
    const iso = localInputToISO(v);
    if (iso) { set.timestamp = iso; persist(); renderExercises(); }
  }

  // --- per-entry note (feature 8) — editable in read-only too ---
  function entryNoteBlock(entry) {
    const host = h('div', { class: 'entry-note' });
    draw();
    function draw() {
      host.innerHTML = '';
      if (entry.note) {
        host.appendChild(h('div', { class: 'note note--inline' }, [
          h('div', { class: 'note__text', text: entry.note }),
          h('div', { class: 'note__row' }, [
            h('button', { class: 'btn btn--icon btn--ghost btn--sm', 'aria-label': t('common.edit'), onclick: edit }, ['✎']),
            h('button', { class: 'btn btn--icon btn--ghost btn--sm', 'aria-label': t('common.delete'), onclick: del }, ['🗑'])
          ])
        ]));
      } else {
        host.appendChild(h('button', { class: 'btn btn--sm btn--ghost', onclick: edit }, ['＋ ' + t('session.addNote')]));
      }
    }
    async function edit() {
      const txt = await promptDialog(t('session.entryNote'), { multiline: true, value: entry.note || '', placeholder: t('exercises.notePlaceholder') });
      if (txt != null) { entry.note = txt.trim(); persist(); draw(); }
    }
    async function del() {
      if (await confirmDialog(t('exercises.deleteNote'), { danger: true, okText: t('common.delete') })) { entry.note = ''; persist(); draw(); }
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
          h('button', { class: 'btn btn--sm btn--ghost', onclick: edit }, [s.notes ? t('common.edit') : ('＋ ' + t('common.add'))])
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
    return { n: entry.sets.length + 1, reps: prev.reps ?? defReps, weightKg: prev.weightKg ?? null,
      seconds: prev.seconds ?? null, distanceKm: prev.distanceKm ?? null, minutes: prev.minutes ?? null,
      effort: null, targetReps: prev.targetReps ?? defReps, done: false, timestamp: null };
  }

  function suggestionChip(entry, sug, metric) {
    return h('div', { class: 'suggest' }, [
      h('span', { text: '💡' }),
      h('div', { class: 'suggest__txt' }, [
        h('span', { class: 'suggest__val', text: t('session.suggested') + ': ' + formatSuggestion(sug, metric) }),
        h('span', { class: 'suggest__reason', text: ' · ' + suggestionReason(sug) })
      ]),
      h('button', { class: 'btn btn--sm btn--primary', onclick: () => applySuggestion(entry, sug, metric) }, [t('session.use')])
    ]);
  }

  function applySuggestion(entry, sug, metric) {
    const filled = (st) => metric === 'time' ? st.seconds : metric === 'distance' ? (st.distanceKm || st.minutes) : (st.weightKg || st.reps);
    let target = entry.sets.find((st) => !st.done && !filled(st));
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
    }) }, ['＋ ' + t('session.addExercise')]));
  }
  if (!finished) {
    wrap.appendChild(h('button', { class: 'btn btn--primary btn--block', onclick: finish }, [t('session.finish')]));
    wrap.appendChild(h('button', { class: 'btn btn--ghost btn--block', style: 'color:var(--danger)', onclick: discard }, [t('session.discard')]));
  } else {
    wrap.appendChild(h('button', { class: 'btn btn--block', onclick: saveAsTemplate }, [t('plan.saveAsTemplate')]));
    wrap.appendChild(h('button', { class: 'btn btn--danger btn--block', onclick: remove }, [t('common.delete')]));
  }

  root.appendChild(wrap);

  function freshSet(metric) {
    const defReps = metric === 'reps' ? 12 : null;
    return { n: 1, reps: defReps, weightKg: null, seconds: null, distanceKm: null, minutes: null, effort: null, targetReps: defReps, done: false, timestamp: null };
  }
  function toggleEdit() { editMode = !editMode; ctx.navigate('/session/' + s.id); }
  async function finish() {
    if (await confirmDialog(t('session.finishConfirm'), { okText: t('session.finish') })) {
      s.endedAt = new Date().toISOString();
      if (timer) { clearInterval(timer); timer = null; }
      persist(); toast(t('toast.sessionSaved')); ctx.navigate('/session/' + s.id);
    }
  }
  async function discard() {
    if (await confirmDialog(t('session.discardConfirm'), { danger: true, okText: t('session.discard') })) {
      if (timer) { clearInterval(timer); timer = null; }
      deleteSession(s.id); ctx.navigate('/');
    }
  }
  async function remove() {
    if (await confirmDialog(t('session.discardConfirm'), { danger: true, okText: t('common.delete') })) {
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
      const counted = st.done !== false && (st.reps || st.seconds || st.distanceKm);
      if (!counted) return;
      const effW = effectiveWeight(e.exerciseId, st.weightKg);
      if (st.reps) vol += (effW || 0) * st.reps;
      if (st.weightKg && st.reps) {
        const o = oneRepMax(effW, st.reps);
        if (o && o.avg > e1rm) e1rm = o.avg;
        if (!best || st.weightKg > (best.weightKg || 0)) best = st;
      } else if (!best && st.reps) best = st;
      if (ex) byGroup[ex.group] = (byGroup[ex.group] || 0) + 1;
      if (st.effort) effDist[st.effort - 1]++;
    });
    perEx.push({ name, volume: Math.round(vol), best, e1rm: Math.round(e1rm), perDumbbell: isPerDumbbell(e.exerciseId) });
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
      h('span', { text: p.name }),
      h('span', { class: 'small' }, [
        p.best ? h('span', { class: 'muted', text: `${p.best.weightKg} ${t('units.kg')} × ${p.best.reps}  ` }) : null,
        p.best && p.perDumbbell ? x2Badge() : null,
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

function avgEffort(s) {
  const vals = [];
  (s.entries || []).forEach((e) => (e.sets || []).forEach((x) => { if (x.done && x.effort) vals.push(x.effort); }));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function tile(value, label) {
  return h('div', { class: 'stat' }, [h('div', { class: 'stat__value', text: String(value) }), h('div', { class: 'stat__label', text: label })]);
}
function card(title, node) { return h('div', { class: 'card' }, [h('div', { class: 'card__title', text: title }), node]); }

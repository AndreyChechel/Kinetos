// Active workout logging + finished summary.
// Features: live timer, per-set weight/reps/time/distance, effort rating,
// completion timestamps (with seconds), add/remove sets, reorder & collapse
// exercises.
import { h, uid, toast, fmtDuration, fmtTimeSec, fmtDate } from '../ui.js';
import { t, getLang } from '../i18n.js';
import { getSession, saveSession, deleteSession } from '../store.js';
import { getExercise, exName, svgPath } from '../data/db.js';
import { injectSVG } from '../svg.js';
import { exercisePicker, confirmDialog } from '../components.js';
import { lastSetFor, sessionDurationMs } from '../workout.js';
import { sessionVolume } from '../calc.js';
import { suggestNext, formatSuggestion, suggestionReason, applyToSet } from '../suggest.js';

let timer = null;
let collapsed = new Set();      // entry ids currently collapsed (UI-only)
let collapsedFor = null;        // session id the set belongs to
window.addEventListener('route:change', () => { if (timer) { clearInterval(timer); timer = null; } });

const EFFORT = { 1: { label: 'effortEasy', cls: 'eff-1' }, 2: { label: 'effortMedium', cls: 'eff-2' }, 3: { label: 'effortHard', cls: 'eff-3' } };

export default function renderSession(root, params, ctx) {
  if (timer) { clearInterval(timer); timer = null; }
  const s = getSession(params.id);
  if (!s) { ctx.navigate('/'); return; }
  if (collapsedFor !== s.id) { collapsed = new Set(); collapsedFor = s.id; }
  const lang = getLang();
  const finished = !!s.endedAt;
  const persist = () => saveSession(s);

  ctx.setTitle(s.name || (finished ? t('session.summary') : t('session.active')));

  const wrap = h('div', { class: 'stack' });

  // Header
  const nameInput = h('input', { class: 'input', value: s.name, placeholder: t('common.name') });
  nameInput.addEventListener('change', () => { s.name = nameInput.value.trim(); persist(); ctx.setTitle(s.name || t('session.active')); });
  const elapsed = h('span', { class: 'timer', text: fmtDuration(sessionDurationMs(s)) });
  wrap.appendChild(h('div', { class: 'card' }, [
    finished ? null : nameInput,
    h('div', { class: 'row row--between', style: finished ? '' : 'margin-top:10px' }, [
      h('span', { class: 'badge ' + (finished ? '' : 'badge--live') }, [
        finished ? '✓ ' + fmtDate(s.startedAt, lang) : '● ' + t('session.active')
      ]),
      h('span', {}, [h('span', { class: 'muted small', text: t('session.elapsed') + ': ' }), elapsed])
    ])
  ]));
  if (!finished) timer = setInterval(() => { elapsed.textContent = fmtDuration(sessionDurationMs(s)); }, 1000);

  // Summary tiles (finished)
  if (finished) {
    const v = sessionVolume(s);
    const eff = avgEffort(s);
    wrap.appendChild(h('div', { class: 'grid2' }, [
      tile(fmtDuration(sessionDurationMs(s)), t('session.duration')),
      tile(v.sets, t('session.totalSets')),
      tile(v.volume.toLocaleString(lang) + ' ' + t('units.kg'), t('session.volume')),
      eff ? tile(eff.toFixed(1) + ' / 3', t('session.effort')) : tile(v.reps, t('common.reps'))
    ]));
  }

  // Exercises
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

  function entryCard(entry, idx) {
    const ex = getExercise(entry.exerciseId);
    const metric = ex ? ex.metric : 'reps';
    const isCollapsed = collapsed.has(entry.id);
    const thumb = h('div', { class: 'list__thumb' }); thumb.textContent = '🏋️';
    if (ex) injectSVG(thumb, svgPath(ex));

    const doneCount = entry.sets.filter((x) => x.done).length;

    // Header (click to collapse/expand)
    const header = h('div', { class: 'row', style: 'cursor:pointer; gap:10px', onclick: (e) => {
      if (e.target.closest('.entry-tools')) return;
      if (isCollapsed) collapsed.delete(entry.id); else collapsed.add(entry.id);
      renderExercises();
    } }, [
      h('span', { class: 'chev' + (isCollapsed ? '' : ' chev--open'), text: '▸' }),
      thumb,
      h('div', { class: 'list__body' }, [
        h('div', { class: 'list__title', text: ex ? exName(ex) : entry.exerciseId }),
        isCollapsed
          ? h('div', { class: 'list__sub', text: `${doneCount}/${entry.sets.length} ${t('common.sets')}` })
          : prevHint(entry.exerciseId)
      ]),
      h('div', { class: 'entry-tools row', style: 'gap:2px' }, [
        h('button', { class: 'btn btn--icon btn--ghost btn--sm', 'aria-label': t('session.moveUp'), disabled: idx === 0 ? true : null,
          onclick: () => move(idx, -1) }, ['↑']),
        h('button', { class: 'btn btn--icon btn--ghost btn--sm', 'aria-label': t('session.moveDown'), disabled: idx === s.entries.length - 1 ? true : null,
          onclick: () => move(idx, 1) }, ['↓']),
        h('button', { class: 'btn btn--icon btn--ghost btn--sm', 'aria-label': t('session.removeExercise'),
          onclick: () => { s.entries.splice(idx, 1); persist(); renderExercises(); } }, ['🗑'])
      ])
    ]);

    const body = h('div', { class: 'stack', style: 'margin-top:10px' });
    if (!isCollapsed) {
      if (!finished) {
        const sug = suggestNext(entry.exerciseId, s.id);
        if (sug) body.appendChild(suggestionChip(entry, sug, metric));
      }
      entry.sets.forEach((set, si) => body.appendChild(setRow(entry, set, si, metric)));
      body.appendChild(h('button', { class: 'btn btn--sm btn--block', style: 'margin-top:4px',
        onclick: () => { entry.sets.push(nextSet(entry)); persist(); renderExercises(); } }, ['＋ ' + t('session.addSet')]));
    }

    return h('div', { class: 'card' }, [header, isCollapsed ? null : body]);
  }

  function move(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= s.entries.length) return;
    const [it] = s.entries.splice(idx, 1);
    s.entries.splice(j, 0, it);
    persist(); renderExercises();
  }

  function setRow(entry, set, si, metric) {
    const numInput = (val, key, opts = {}) => {
      const inp = h('input', { class: 'input set__in', type: 'number', inputmode: 'decimal', value: val ?? '', ...opts });
      inp.addEventListener('change', () => { const n = parseFloat(inp.value); set[key] = isNaN(n) ? null : n; persist(); });
      return inp;
    };
    const fields = h('div', { class: 'set__fields' });
    if (metric === 'reps') {
      const wLabel = t('units.kg') + (set.targetWeightKg ? ' /' + set.targetWeightKg : '');
      const rLabel = t('common.reps') + (set.targetReps ? ' /' + set.targetReps : '');
      fields.append(unit(numInput(set.weightKg, 'weightKg', { step: '2.5', placeholder: t('units.kg') }), wLabel),
        unit(numInput(set.reps, 'reps', { step: '1', placeholder: t('session.reps') }), rLabel));
    } else if (metric === 'time') {
      fields.append(unit(numInput(set.seconds, 'seconds', { step: '5', placeholder: t('common.sec') }), t('common.sec')));
    } else {
      fields.append(unit(numInput(set.distanceKm, 'distanceKm', { step: '0.1', placeholder: t('units.km') }), t('units.km')),
        unit(numInput(set.minutes, 'minutes', { step: '1', placeholder: t('common.min') }), t('common.min')));
    }

    // Effort pill: cycles none -> easy -> medium -> hard -> none
    const effBtn = h('button', { class: 'effort', 'aria-label': t('session.effort'),
      onclick: () => { set.effort = !set.effort ? 1 : (set.effort >= 3 ? null : set.effort + 1); persist(); renderExercises(); } });
    styleEffort(effBtn, set.effort);

    const doneBtn = h('button', {
      class: 'btn btn--icon btn--sm ' + (set.done ? 'btn--primary' : ''),
      'aria-label': t('session.done'),
      onclick: () => { set.done = !set.done; set.timestamp = set.done ? new Date().toISOString() : null; persist(); renderExercises(); }
    }, [set.done ? '✓' : '○']);

    const rm = h('button', { class: 'btn btn--icon btn--ghost btn--sm set__rm', 'aria-label': t('session.removeSet'),
      onclick: () => { entry.sets.splice(si, 1); entry.sets.forEach((x, i) => x.n = i + 1); persist(); renderExercises(); } }, ['×']);

    const row = h('div', { class: 'set' + (set.done ? ' set--done' : '') }, [
      h('span', { class: 'set__n', text: String(set.n) }),
      fields, effBtn, doneBtn, rm
    ]);
    if (set.done && set.timestamp) {
      row.appendChild(h('div', { class: 'set__ts small muted', text: fmtTimeSec(set.timestamp, lang) }));
    }
    return row;
  }

  function prevHint(exerciseId) {
    const last = lastSetFor(exerciseId, s.id);
    if (!last) return h('div', { class: 'list__sub muted', text: '' });
    const best = last.sets.map((x) => x.weightKg ? `${x.weightKg}×${x.reps}` : (x.reps || x.seconds || x.distanceKm || '')).slice(0, 4).join(', ');
    return h('div', { class: 'list__sub', text: t('session.previous') + ': ' + best });
  }

  function nextSet(entry) {
    const prev = entry.sets[entry.sets.length - 1] || {};
    return { n: entry.sets.length + 1, reps: prev.reps ?? null, weightKg: prev.weightKg ?? null,
      seconds: prev.seconds ?? null, distanceKm: prev.distanceKm ?? null, minutes: prev.minutes ?? null,
      effort: null, done: false, timestamp: null };
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
    if (!target) { target = nextSet(entry); entry.sets.push(target); }
    applyToSet(target, sug);
    persist(); renderExercises();
  }

  renderExercises();

  // Footer
  wrap.appendChild(h('button', { class: 'btn btn--block', onclick: () => exercisePicker((ex) => {
    const set0 = freshSet();
    const sug = suggestNext(ex.id, s.id);
    if (sug) applyToSet(set0, sug);
    s.entries.push({ id: uid('en'), exerciseId: ex.id, sets: [set0] });
    persist(); renderExercises();
  }) }, ['＋ ' + t('session.addExercise')]));
  if (!finished) {
    wrap.appendChild(h('button', { class: 'btn btn--primary btn--block', onclick: finish }, [t('session.finish')]));
    wrap.appendChild(h('button', { class: 'btn btn--ghost btn--block', style: 'color:var(--danger)', onclick: discard }, [t('session.discard')]));
  } else {
    wrap.appendChild(h('button', { class: 'btn btn--danger btn--block', onclick: remove }, [t('common.delete')]));
  }

  root.appendChild(wrap);

  function freshSet() {
    return { n: 1, reps: null, weightKg: null, seconds: null, distanceKm: null, minutes: null, effort: null, done: false, timestamp: null };
  }
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

  function styleEffort(btn, effort) {
    btn.className = 'effort' + (effort ? ' effort--' + effort : '');
    btn.textContent = effort ? t('session.' + EFFORT[effort].label).slice(0, 1) : '–';
    btn.title = effort ? t('session.' + EFFORT[effort].label) : t('session.effort');
  }
}

function avgEffort(s) {
  const vals = [];
  (s.entries || []).forEach((e) => (e.sets || []).forEach((x) => { if (x.done && x.effort) vals.push(x.effort); }));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function unit(input, label) {
  return h('div', { class: 'set__unit' }, [input, h('span', { class: 'set__unit-label', text: label })]);
}
function tile(value, label) {
  return h('div', { class: 'stat' }, [h('div', { class: 'stat__value', text: String(value) }), h('div', { class: 'stat__label', text: label })]);
}

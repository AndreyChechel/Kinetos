// Active workout logging (sets, reps, weight, timestamps) + finished summary.
import { h, uid, toast, fmtDuration, fmtTime, fmtDate } from '../ui.js';
import { t, getLang } from '../i18n.js';
import { getSession, saveSession, deleteSession } from '../store.js';
import { getExercise, exName, svgPath } from '../data/db.js';
import { injectSVG } from '../svg.js';
import { exercisePicker, confirmDialog } from '../components.js';
import { lastSetFor, sessionDurationMs } from '../workout.js';
import { sessionVolume } from '../calc.js';

let timer = null;
window.addEventListener('hashchange', () => { if (timer) { clearInterval(timer); timer = null; } });

export default function renderSession(root, params, ctx) {
  if (timer) { clearInterval(timer); timer = null; }
  const s = getSession(params.id);
  if (!s) { ctx.navigate('/'); return; }
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

  // Summary (finished)
  if (finished) {
    const v = sessionVolume(s);
    wrap.appendChild(h('div', { class: 'grid2' }, [
      tile(fmtDuration(sessionDurationMs(s)), t('session.duration')),
      tile(v.sets, t('session.totalSets')),
      tile(v.volume.toLocaleString(lang) + ' ' + t('units.kg'), t('session.volume')),
      tile(v.reps, t('common.reps'))
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
    const thumb = h('div', { class: 'list__thumb' }); thumb.textContent = '🏋️';
    if (ex) injectSVG(thumb, svgPath(ex));

    const table = h('table', { class: 'sets' });
    const head = { reps: [t('session.set'), t('session.weight'), t('session.reps'), ''],
      time: [t('session.set'), t('session.time') + ' (' + t('common.sec') + ')', '', ''],
      distance: [t('session.set'), t('session.distance') + ' (' + t('units.km') + ')', t('session.time') + ' (' + t('common.min') + ')', ''] }[metric];
    table.appendChild(h('tr', {}, head.map((th) => h('th', { text: th }))));

    entry.sets.forEach((set, si) => table.appendChild(setRow(entry, set, si, metric)));

    const card = h('div', { class: 'card' }, [
      h('div', { class: 'row', style: 'margin-bottom:6px' }, [
        thumb,
        h('div', { class: 'list__body' }, [
          h('div', { class: 'list__title', text: ex ? exName(ex) : entry.exerciseId }),
          prevHint(entry.exerciseId)
        ]),
        finished ? null : h('button', { class: 'btn btn--icon btn--ghost', 'aria-label': t('session.removeExercise'),
          onclick: () => { s.entries.splice(idx, 1); persist(); renderExercises(); } }, ['🗑'])
      ]),
      table,
      finished ? null : h('button', { class: 'btn btn--sm btn--block', style: 'margin-top:8px',
        onclick: () => { entry.sets.push(nextSet(entry)); persist(); renderExercises(); } }, ['＋ ' + t('session.addSet')])
    ]);
    return card;
  }

  function setRow(entry, set, si, metric) {
    const numInput = (val, key, opts = {}) => {
      const inp = h('input', { class: 'input', type: 'number', inputmode: 'decimal', value: val ?? '', ...opts, style: 'min-height:38px;padding:6px' });
      inp.disabled = finished && false; // allow editing even finished
      inp.addEventListener('change', () => { const n = parseFloat(inp.value); set[key] = isNaN(n) ? null : n; persist(); });
      return inp;
    };
    const cells = [h('td', { text: '#' + set.n })];
    if (metric === 'reps') {
      cells.push(h('td', {}, [numInput(set.weightKg, 'weightKg', { step: '2.5' })]));
      cells.push(h('td', {}, [numInput(set.reps, 'reps', { step: '1' })]));
    } else if (metric === 'time') {
      cells.push(h('td', { colspan: 2 }, [numInput(set.seconds, 'seconds', { step: '5' })]));
    } else {
      cells.push(h('td', {}, [numInput(set.distanceKm, 'distanceKm', { step: '0.1' })]));
      cells.push(h('td', {}, [numInput(set.minutes, 'minutes', { step: '1' })]));
    }
    const doneBtn = h('button', {
      class: 'btn btn--icon btn--sm ' + (set.done ? 'btn--primary' : ''),
      'aria-label': t('session.done'),
      onclick: () => {
        set.done = !set.done;
        set.timestamp = set.done ? new Date().toISOString() : null;
        persist(); renderExercises();
      }
    }, [set.done ? '✓' : '○']);
    const tdDone = h('td', {}, [doneBtn]);
    if (set.done && set.timestamp) tdDone.appendChild(h('div', { class: 'small muted', text: fmtTime(set.timestamp, lang) }));
    cells.push(tdDone);
    return h('tr', {}, cells);
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
      seconds: prev.seconds ?? null, distanceKm: prev.distanceKm ?? null, minutes: prev.minutes ?? null, done: false, timestamp: null };
  }

  renderExercises();

  // Footer actions
  if (!finished) {
    wrap.appendChild(h('button', { class: 'btn btn--block', onclick: () => exercisePicker((ex) => {
      s.entries.push({ id: uid('en'), exerciseId: ex.id, sets: [nextSetFor(ex)] }); persist(); renderExercises();
    }) }, ['＋ ' + t('session.addExercise')]));
    wrap.appendChild(h('button', { class: 'btn btn--primary btn--block', onclick: finish }, [t('session.finish')]));
    wrap.appendChild(h('button', { class: 'btn btn--ghost btn--block', style: 'color:var(--danger)', onclick: discard }, [t('session.discard')]));
  } else {
    wrap.appendChild(h('button', { class: 'btn btn--danger btn--block', onclick: remove }, [t('common.delete')]));
  }

  root.appendChild(wrap);

  function nextSetFor(ex) {
    return { n: 1, reps: ex.metric === 'reps' ? null : null, weightKg: null, seconds: null, distanceKm: null, minutes: null, done: false, timestamp: null };
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
}

function tile(value, label) {
  return h('div', { class: 'stat' }, [
    h('div', { class: 'stat__value', text: String(value) }),
    h('div', { class: 'stat__label', text: label })
  ]);
}

// Exercise browser (list + detail) and custom-exercise creation.
import { h, uid, toast } from '../ui.js';
import { t, pick } from '../i18n.js';
import { byGroup, groups, exName, svgPath, getExercise } from '../data/db.js';
import { injectSVG } from '../svg.js';
import { sheet } from '../components.js';
import { addCustomExercise, getPlans, savePlan } from '../store.js';
import { activeSession, createEmptySession } from '../workout.js';
import { saveSession, getSession } from '../store.js';
import { suggestNext, formatSuggestion, suggestionReason } from '../suggest.js';

let filter = 'all';
let query = '';

export function renderExerciseList(root, params, ctx) {
  const search = h('input', { class: 'input', type: 'search', value: query, placeholder: t('exercises.searchPlaceholder') });
  const chips = h('div', { class: 'chips' });
  const listWrap = h('div', {});
  root.appendChild(h('div', { class: 'stack' }, [search, chips, listWrap]));

  function renderChips() {
    chips.innerHTML = '';
    const mk = (key, label) => h('button', {
      class: 'chip' + (filter === key ? ' is-active' : ''),
      onclick: () => { filter = key; render(); }
    }, [label]);
    chips.appendChild(mk('all', t('common.all')));
    groups().forEach((g) => chips.appendChild(mk(g, t('groups.' + g))));
  }

  function render() {
    renderChips();
    const grouped = byGroup(filter, query);
    listWrap.innerHTML = '';
    let total = 0;
    for (const [g, list] of Object.entries(grouped)) {
      if (!list.length) continue;
      total += list.length;
      listWrap.appendChild(h('div', { class: 'section-title', text: t('groups.' + g) }));
      const ul = h('ul', { class: 'list card card--pad-0' });
      list.forEach((ex) => ul.appendChild(exerciseRow(ex, () => ctx.navigate('/exercises/' + ex.id))));
      listWrap.appendChild(ul);
    }
    if (!total) listWrap.appendChild(h('p', { class: 'empty', text: t('exercises.none') }));
  }

  search.addEventListener('input', () => { query = search.value; render(); });
  render();

  root.appendChild(h('button', { class: 'fab', 'aria-label': t('exercises.addCustom'), title: t('exercises.addCustom'),
    onclick: () => openCustomSheet(render) }, ['＋']));
}

export function exerciseRow(ex, onClick) {
  const thumb = h('div', { class: 'list__thumb' });
  thumb.textContent = '🏋️';
  injectSVG(thumb, svgPath(ex));
  return h('li', { class: 'list__item', onclick: onClick }, [
    thumb,
    h('div', { class: 'list__body' }, [
      h('div', { class: 'list__title', text: exName(ex) }),
      h('div', { class: 'list__sub', text: (ex.primary || []).map((m) => t('muscles.' + m)).join(', ') })
    ]),
    h('span', { class: 'list__chev', text: '›' })
  ]);
}

export function renderExerciseDetail(root, params, ctx) {
  const ex = getExercise(params.id);
  if (!ex) { ctx.navigate('/exercises'); return; }
  ctx.setTitle(exName(ex));

  const illus = h('div', { class: 'illus' });
  illus.textContent = '🏋️';
  injectSVG(illus, svgPath(ex));

  const tags = h('div', { class: 'row wrap', style: 'gap:6px' }, [
    h('span', { class: 'tag', text: t('groups.' + ex.group) }),
    h('span', { class: 'tag', text: t('equipment.' + ex.equipment) })
  ]);

  const muscleTags = (arr, cls) => h('div', { class: 'row wrap', style: 'gap:6px' },
    (arr || []).map((m) => h('span', { class: 'tag ' + cls, text: t('muscles.' + m) })));

  const cues = pick(ex.cues) || [];

  root.appendChild(h('div', { class: 'ex-detail' }, [
    h('div', { class: 'ex-detail__media' }, [
      h('div', { class: 'card' }, [illus])
    ]),
    h('div', { class: 'ex-detail__info stack' }, [
      tags,
      ex.primary && ex.primary.length ? h('div', {}, [
        h('div', { class: 'section-title', style: 'margin-top:6px', text: t('exercises.primary') }),
        muscleTags(ex.primary, 'tag--muscle')
      ]) : null,
      ex.secondary && ex.secondary.length ? h('div', {}, [
        h('div', { class: 'section-title', text: t('exercises.secondary') }),
        muscleTags(ex.secondary, '')
      ]) : null,
      cues.length ? h('div', { class: 'card' }, [
        h('div', { class: 'card__title', text: t('exercises.howto') }),
        h('ol', { style: 'margin:0; padding-left:18px; line-height:1.6' }, cues.map((c) => h('li', { text: c })))
      ]) : null,
      suggestionCard(ex),
      h('div', { class: 'grid2' }, [
        h('button', { class: 'btn', onclick: () => addToPlan(ex, ctx) }, [t('exercises.addToPlan')]),
        h('button', { class: 'btn btn--primary', onclick: () => logNow(ex, ctx) }, [t('exercises.logNow')])
      ])
    ])
  ]));
}

function addToPlan(ex, ctx) {
  const today = new Date().toISOString().slice(0, 10);
  let plan = getPlans().find((p) => (p.date || '').slice(0, 10) === today);
  if (!plan) plan = { id: uid('plan'), name: '', date: today, notes: '', exercises: [] };
  plan.exercises = plan.exercises || [];
  plan.exercises.push({ exerciseId: ex.id, targetSets: 3, targetReps: ex.metric === 'reps' ? 10 : null, targetWeightKg: null });
  savePlan(plan);
  toast(t('toast.added'));
  ctx.navigate('/plan/' + plan.id);
}

function logNow(ex, ctx) {
  let s = activeSession();
  if (!s) { const id = createEmptySession(); s = getSession(id); }
  s.entries = s.entries || [];
  if (!s.entries.some((e) => e.exerciseId === ex.id)) {
    s.entries.push({ id: uid('en'), exerciseId: ex.id, sets: [{ n: 1, reps: null, weightKg: null, seconds: null, distanceKm: null, done: false, timestamp: null }] });
  }
  saveSession(s);
  ctx.navigate('/session/' + s.id);
}

function openCustomSheet(onDone) {
  const name = h('input', { class: 'input', placeholder: t('exercises.customName') });
  const group = h('select', { class: 'select' }, groups().map((g) => h('option', { value: g, text: t('groups.' + g) })));
  const content = h('div', { class: 'stack' }, [
    field(t('exercises.customName'), name),
    field(t('exercises.customGroup'), group),
    h('button', { class: 'btn btn--primary btn--block', onclick: save }, [t('common.save')])
  ]);
  const { close } = sheet(t('exercises.addCustom'), content);
  setTimeout(() => name.focus(), 250);
  const groupMuscle = { chest: 'chest', back: 'lats', legs: 'quads', shoulders: 'delts', biceps: 'biceps', triceps: 'triceps', core: 'abs', cardio: 'quads' };
  function save() {
    if (!name.value.trim()) { name.focus(); return; }
    const g = group.value;
    addCustomExercise({
      id: uid('ex'), group: g, view: g === 'back' ? 'back' : 'front', category: 'isolation',
      equipment: 'bodyweight', metric: 'reps', custom: true,
      primary: [groupMuscle[g] || 'abs'], secondary: [],
      names: { en: name.value.trim() }, cues: { en: [] }
    });
    toast(t('exercises.customSaved'));
    close();
    onDone && onDone();
  }
}

function suggestionCard(ex) {
  const sug = suggestNext(ex.id);
  if (!sug) return null;
  return h('div', { class: 'card' }, [
    h('div', { class: 'card__title', text: t('exercises.suggestedNext') }),
    h('div', { class: 'suggest', style: 'margin:0' }, [
      h('span', { text: '💡' }),
      h('div', { class: 'suggest__txt' }, [
        h('span', { class: 'suggest__val', text: formatSuggestion(sug, ex.metric) }),
        h('span', { class: 'suggest__reason', text: ' · ' + suggestionReason(sug) })
      ])
    ])
  ]);
}

function field(label, input) {
  return h('label', { class: 'field' }, [h('span', { text: label, style: 'display:block;font-size:.8rem;font-weight:600;color:var(--text-muted);margin-bottom:5px' }), input]);
}

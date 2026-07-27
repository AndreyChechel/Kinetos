// Exercise browser (list + detail), custom-exercise creation, per-exercise
// notes, hide/unhide and (soft) deletion.
import { h, uid, toast, fmtDate, todayISO } from '../ui.js';
import { t, pick, getLang } from '../i18n.js';
import { byGroup, groups, exName, getExercise, isCustom } from '../data/db.js';
import { injectExerciseSVG } from '../svg.js';
import { buildExerciseSVG, GROUP_VIEW, GROUP_MUSCLE } from '../exsvg.js';
import { sheet, confirmDialog, promptDialog, popoverMenu, attachLongPress } from '../components.js';
import {
  addCustomExercise, updateCustomExercise, removeCustomExercise, softDeleteCustomExercise,
  getPlans, savePlan, saveSession, getSession,
  isExerciseHidden, setExerciseHidden, getExerciseNotes, addExerciseNote, updateExerciseNote, deleteExerciseNote
} from '../store.js';
import { activeSession, createEmptySession, recentExercises, lastPerformedMap, exerciseUsedInHistory } from '../workout.js';
import { suggestNext, formatSuggestion, suggestionReason } from '../suggest.js';

let filter = 'all';
let query = '';
let showHidden = false;

export function renderExerciseList(root, params, ctx) {
  const search = h('input', { class: 'input', type: 'search', value: query, placeholder: t('exercises.searchPlaceholder') });
  const chips = h('div', { class: 'chips' });
  const recentWrap = h('div', {});
  const listWrap = h('div', {});
  root.appendChild(h('div', { class: 'stack' }, [search, chips, recentWrap, listWrap]));

  function renderChips() {
    chips.innerHTML = '';
    const mk = (key, label) => h('button', {
      class: 'chip' + (filter === key ? ' is-active' : ''),
      onclick: () => { filter = key; render(); }
    }, [label]);
    chips.appendChild(mk('all', t('common.all')));
    groups().forEach((g) => chips.appendChild(mk(g, t('groups.' + g))));
    chips.appendChild(h('button', {
      class: 'chip' + (showHidden ? ' is-active' : ''),
      onclick: () => { showHidden = !showHidden; render(); }
    }, ['👁 ' + t('exercises.showHidden')]));
  }

  function renderRecent() {
    recentWrap.innerHTML = '';
    if (filter !== 'all' || query) return;
    const recent = recentExercises(8).map((r) => getExercise(r.exerciseId)).filter((ex) => ex && !ex.deleted);
    if (!recent.length) return;
    recentWrap.appendChild(h('div', { class: 'section-title', text: t('exercises.recent') }));
    const shelf = h('div', { class: 'ex-shelf' });
    recent.forEach((ex) => {
      const thumb = h('div', { class: 'ex-shelf__thumb' });
      injectExerciseSVG(thumb, ex);
      shelf.appendChild(h('button', { class: 'ex-shelf__item', onclick: () => ctx.navigate('/exercises/' + ex.id) }, [
        thumb, h('span', { class: 'ex-shelf__name', text: exName(ex) })
      ]));
    });
    recentWrap.appendChild(shelf);
  }

  function render() {
    renderChips();
    renderRecent();
    const lastMap = lastPerformedMap();
    const grouped = byGroup(filter, query, { includeHidden: showHidden });
    listWrap.innerHTML = '';
    let total = 0;
    for (const [g, list] of Object.entries(grouped)) {
      if (!list.length) continue;
      total += list.length;
      listWrap.appendChild(h('div', { class: 'section-title', text: t('groups.' + g) }));
      const ul = h('ul', { class: 'list card card--pad-0' });
      list.forEach((ex) => ul.appendChild(exerciseRow(ex, {
        lastISO: lastMap[ex.id],
        onOpen: () => ctx.navigate('/exercises/' + ex.id),
        onLongPress: (anchor) => rowMenu(ex, anchor, render)
      })));
      listWrap.appendChild(ul);
    }
    if (!total) listWrap.appendChild(h('p', { class: 'empty', text: t('exercises.none') }));
  }

  search.addEventListener('input', () => { query = search.value; render(); });
  render();

  root.appendChild(h('button', { class: 'fab', 'aria-label': t('exercises.addCustom'), title: t('exercises.addCustom'),
    onclick: () => openCustomSheet(render) }, ['＋']));
}

function rowMenu(ex, anchor, refresh) {
  const hidden = isExerciseHidden(ex.id);
  const items = [{
    label: hidden ? t('exercises.unhide') : t('exercises.hide'),
    onClick: () => { setExerciseHidden(ex.id, !hidden); toast(hidden ? t('exercises.unhidden') : t('exercises.hidden')); refresh(); }
  }];
  if (isCustom(ex)) items.push({ label: t('common.delete'), color: 'var(--danger)', onClick: () => deleteCustom(ex, refresh) });
  popoverMenu(anchor, items, { title: exName(ex) });
}

export function exerciseRow(ex, { onOpen, onLongPress, lastISO } = {}) {
  const thumb = h('div', { class: 'list__thumb' });
  injectExerciseSVG(thumb, ex);
  const hidden = isExerciseHidden(ex.id);
  const sub = lastISO
    ? t('exercises.lastDone', { date: fmtDate(lastISO, getLang(), { month: 'short', day: 'numeric' }) })
    : (ex.primary || []).map((m) => t('muscles.' + m)).join(', ');
  const title = h('div', { class: 'list__title' }, [
    exName(ex),
    hidden ? h('span', { class: 'tag', style: 'margin-left:6px', text: t('exercises.hiddenTag') }) : null
  ]);
  const row = h('li', { class: 'list__item' + (hidden ? ' is-hidden-ex' : '') }, [
    thumb,
    h('div', { class: 'list__body' }, [title, h('div', { class: 'list__sub', text: sub })]),
    h('span', { class: 'list__chev', text: '›' })
  ]);
  attachLongPress(row, { onTap: () => onOpen && onOpen(), onLongPress: () => onLongPress && onLongPress(row) });
  return row;
}

export function renderExerciseDetail(root, params, ctx) {
  const ex = getExercise(params.id);
  if (!ex) { ctx.navigate('/exercises'); return; }
  ctx.setTitle(exName(ex));

  const illus = h('div', { class: 'illus' });
  injectExerciseSVG(illus, ex);

  const tags = h('div', { class: 'row wrap', style: 'gap:6px' }, [
    h('span', { class: 'tag', text: t('groups.' + ex.group) }),
    h('span', { class: 'tag', text: t('equipment.' + ex.equipment) }),
    isExerciseHidden(ex.id) ? h('span', { class: 'tag', text: t('exercises.hiddenTag') }) : null
  ]);

  const muscleTags = (arr, cls) => h('div', { class: 'row wrap', style: 'gap:6px' },
    (arr || []).map((m) => h('span', { class: 'tag ' + cls, text: t('muscles.' + m) })));

  const cues = pick(ex.cues) || [];
  const notesHost = h('div', {});
  drawNotes();

  root.appendChild(h('div', { class: 'ex-detail' }, [
    h('div', { class: 'ex-detail__media' }, [h('div', { class: 'card' }, [illus])]),
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
      notesHost,
      suggestionCard(ex),
      h('div', { class: 'grid2' }, [
        h('button', { class: 'btn', onclick: () => addToPlan(ex, ctx) }, [t('exercises.addToPlan')]),
        h('button', { class: 'btn btn--primary', onclick: () => logNow(ex, ctx) }, [t('exercises.logNow')])
      ]),
      h('div', { class: 'grid2' }, [
        h('button', { class: 'btn btn--ghost', onclick: () => { setExerciseHidden(ex.id, !isExerciseHidden(ex.id)); toast(isExerciseHidden(ex.id) ? t('exercises.hidden') : t('exercises.unhidden')); ctx.navigate('/exercises/' + ex.id); } },
          [isExerciseHidden(ex.id) ? t('exercises.unhide') : t('exercises.hide')]),
        isCustom(ex) ? h('button', { class: 'btn btn--ghost', style: 'color:var(--danger)', onclick: () => deleteCustom(ex, () => ctx.navigate('/exercises')) }, [t('exercises.deleteCustom')]) : null
      ])
    ])
  ]));

  function drawNotes() {
    notesHost.innerHTML = '';
    const notes = getExerciseNotes(ex.id);
    const list = h('div', { class: 'stack' });
    notes.forEach((n) => list.appendChild(h('div', { class: 'note' }, [
      h('div', { class: 'note__text', text: n.text }),
      h('div', { class: 'note__row' }, [
        h('span', { class: 'note__date small muted', text: fmtDate(n.ts, getLang(), { month: 'short', day: 'numeric' }) }),
        h('button', { class: 'btn btn--icon btn--ghost btn--sm', 'aria-label': t('common.edit'), onclick: () => editNote(n) }, ['✎']),
        h('button', { class: 'btn btn--icon btn--ghost btn--sm', 'aria-label': t('common.delete'), onclick: () => delNote(n) }, ['🗑'])
      ])
    ])));
    notesHost.appendChild(h('div', { class: 'card' }, [
      h('div', { class: 'row row--between', style: 'margin-bottom:8px' }, [
        h('div', { class: 'card__title', style: 'margin:0', text: t('exercises.notes') }),
        h('button', { class: 'btn btn--sm', onclick: addNote }, ['＋ ' + t('common.add')])
      ]),
      notes.length ? list : h('p', { class: 'muted small', style: 'margin:0', text: t('exercises.noNotes') })
    ]));
  }
  async function addNote() {
    const txt = await promptDialog(t('exercises.newNote'), { multiline: true, placeholder: t('exercises.notePlaceholder') });
    if (txt && txt.trim()) { addExerciseNote(ex.id, txt.trim()); drawNotes(); }
  }
  async function editNote(n) {
    const txt = await promptDialog(t('common.edit'), { multiline: true, value: n.text });
    if (txt != null && txt.trim()) { updateExerciseNote(ex.id, n.id, txt.trim()); drawNotes(); }
  }
  async function delNote(n) {
    if (await confirmDialog(t('exercises.deleteNote'), { danger: true, okText: t('common.delete') })) { deleteExerciseNote(ex.id, n.id); drawNotes(); }
  }
}

async function deleteCustom(ex, onDone) {
  const used = exerciseUsedInHistory(ex.id);
  const msg = used ? t('exercises.softDeleteConfirm') : t('exercises.hardDeleteConfirm');
  if (!(await confirmDialog(msg, { danger: true, okText: t('common.delete') }))) return;
  if (used) softDeleteCustomExercise(ex.id); else removeCustomExercise(ex.id);
  toast(t('toast.deleted'));
  onDone && onDone();
}

function addToPlan(ex, ctx) {
  const today = todayISO();
  let plan = getPlans().find((p) => (p.date || '').slice(0, 10) === today);
  if (!plan) plan = { id: uid('plan'), templateId: null, name: '', date: today, notes: '', exercises: [] };
  plan.exercises = plan.exercises || [];
  plan.exercises.push({ exerciseId: ex.id, targetSets: 3, targetReps: ex.metric === 'reps' ? 12 : null, targetWeightKg: null });
  savePlan(plan);
  toast(t('toast.added'));
  ctx.navigate('/plan/' + plan.id);
}

function logNow(ex, ctx) {
  let s = activeSession();
  if (!s) { const id = createEmptySession(); s = getSession(id); }
  s.entries = s.entries || [];
  if (!s.entries.some((e) => e.exerciseId === ex.id)) {
    s.entries.push({ id: uid('en'), exerciseId: ex.id, note: '', sets: [{ n: 1, reps: null, weightKg: null, seconds: null, distanceKm: null, minutes: null, effort: null, done: false, timestamp: null }] });
  }
  saveSession(s);
  ctx.navigate('/session/' + s.id);
}

function openCustomSheet(onDone) {
  const name = h('input', { class: 'input', placeholder: t('exercises.customName') });
  const group = h('select', { class: 'select' }, groups().map((g) => h('option', { value: g, text: t('groups.' + g) })));
  const equipment = h('select', { class: 'select' },
    ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'cardio', 'band'].map((eq) => h('option', { value: eq, text: t('equipment.' + eq) })));
  equipment.value = 'bodyweight';
  const preview = h('div', { class: 'illus illus--sm' });
  const draw = () => { preview.innerHTML = buildExerciseSVG(buildEx()); };
  function buildEx() {
    const g = group.value;
    return { id: 'preview', group: g, view: GROUP_VIEW[g] || 'front', equipment: equipment.value, metric: g === 'cardio' ? 'time' : 'reps',
      primary: [GROUP_MUSCLE[g] || 'abs'], secondary: [], names: { en: name.value || t('exercises.customName') } };
  }
  group.addEventListener('change', draw);
  equipment.addEventListener('change', draw);
  name.addEventListener('input', draw);

  const content = h('div', { class: 'stack' }, [
    h('div', { class: 'center' }, [preview]),
    field(t('exercises.customName'), name),
    field(t('exercises.customGroup'), group),
    field(t('exercises.equipment'), equipment),
    h('button', { class: 'btn btn--primary btn--block', onclick: save }, [t('common.save')])
  ]);
  const { close } = sheet(t('exercises.addCustom'), content);
  draw();
  setTimeout(() => name.focus(), 250);

  function save() {
    if (!name.value.trim()) { name.focus(); return; }
    const built = buildEx();
    addCustomExercise({
      id: uid('ex'), group: built.group, view: built.view, category: 'isolation',
      equipment: built.equipment, metric: built.metric, custom: true,
      primary: built.primary, secondary: [],
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

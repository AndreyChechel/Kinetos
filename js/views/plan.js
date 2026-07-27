// Plan list + plan editor (plan sessions in advance).
import { h, uid, fmtDate, toast } from '../ui.js';
import { t, getLang } from '../i18n.js';
import { getPlans, getPlan, savePlan, deletePlan } from '../store.js';
import { getExercise, exName, svgPath } from '../data/db.js';
import { injectSVG } from '../svg.js';
import { exercisePicker, stepper, confirmDialog } from '../components.js';
import { createSessionFromPlan, activeSession } from '../workout.js';

export function renderPlanList(root, params, ctx) {
  const lang = getLang();
  const today = new Date().toISOString().slice(0, 10);
  const plans = [...getPlans()].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const upcoming = plans.filter((p) => (p.date || '') >= today);
  const past = plans.filter((p) => (p.date || '') < today).reverse();

  const wrap = h('div', {});
  if (!plans.length) {
    wrap.appendChild(h('div', { class: 'empty' }, [
      h('div', { class: 'empty__icon', text: '🗓️' }),
      h('p', { text: t('plan.empty') }),
      h('p', { class: 'small', text: t('plan.emptyHint') })
    ]));
  } else {
    if (upcoming.length) section(wrap, t('plan.upcoming'), upcoming, ctx, lang, today);
    if (past.length) section(wrap, t('plan.past'), past, ctx, lang, today);
  }
  root.appendChild(wrap);
  root.appendChild(h('button', { class: 'fab', 'aria-label': t('plan.new'), onclick: () => ctx.navigate('/plan/new') }, ['＋']));
}

function section(wrap, title, list, ctx, lang, today) {
  wrap.appendChild(h('div', { class: 'section-title', text: title }));
  const ul = h('ul', { class: 'list card card--pad-0' });
  list.forEach((p) => {
    const isToday = (p.date || '').slice(0, 10) === today;
    ul.appendChild(h('li', { class: 'list__item', onclick: () => ctx.navigate('/plan/' + p.id) }, [
      h('div', { class: 'list__thumb', text: '🗓️', style: 'font-size:1.3rem' }),
      h('div', { class: 'list__body' }, [
        h('div', { class: 'list__title', text: p.name || t('plan.new') }),
        h('div', { class: 'list__sub', text: `${isToday ? t('plan.today') : fmtDate(p.date, lang)} · ${t('exercises.count', { n: (p.exercises || []).length })}` })
      ]),
      h('span', { class: 'list__chev', text: '›' })
    ]));
  });
  wrap.appendChild(ul);
}

export function renderPlanEditor(root, params, ctx) {
  const existing = params.id ? getPlan(params.id) : null;
  const plan = existing
    ? JSON.parse(JSON.stringify(existing))
    : { id: uid('plan'), name: '', date: new Date().toISOString().slice(0, 10), notes: '', exercises: [] };
  ctx.setTitle(existing ? (plan.name || t('plan.title')) : t('plan.new'));

  const nameInput = h('input', { class: 'input', value: plan.name, placeholder: t('plan.namePlaceholder') });
  const dateInput = h('input', { class: 'input', type: 'date', value: (plan.date || '').slice(0, 10) });
  const notesInput = h('textarea', { class: 'textarea', placeholder: t('common.notes') }, [plan.notes || '']);
  const exWrap = h('div', {});

  function renderExercises() {
    exWrap.innerHTML = '';
    if (!plan.exercises.length) {
      exWrap.appendChild(h('div', { class: 'card center muted', text: t('plan.noExercises') }));
      return;
    }
    plan.exercises.forEach((pe, idx) => {
      const ex = getExercise(pe.exerciseId);
      if (!ex) return;
      const thumb = h('div', { class: 'list__thumb' }); thumb.textContent = '🏋️';
      injectSVG(thumb, svgPath(ex));
      const sets = stepper(pe.targetSets ?? 3, { min: 1, max: 20 });
      const reps = stepper(pe.targetReps ?? 10, { min: 0, max: 100 });
      const weight = stepper(pe.targetWeightKg ?? 0, { min: 0, max: 500, step: 2.5, decimals: 1 });
      sets.input.addEventListener('change', () => { pe.targetSets = sets.get(); });
      reps.input.addEventListener('change', () => { pe.targetReps = reps.get(); });
      weight.input.addEventListener('change', () => { pe.targetWeightKg = weight.get(); });
      exWrap.appendChild(h('div', { class: 'card' }, [
        h('div', { class: 'row', style: 'margin-bottom:10px' }, [
          thumb,
          h('div', { class: 'list__body' }, [h('div', { class: 'list__title', text: exName(ex) })]),
          h('button', { class: 'btn btn--icon btn--ghost', 'aria-label': t('common.remove'),
            onclick: () => { plan.exercises.splice(idx, 1); renderExercises(); } }, ['🗑'])
        ]),
        h('div', { class: 'row', style: 'gap:8px' }, [
          labeled(t('plan.targetSets'), sets.el),
          labeled(t('plan.targetReps'), reps.el),
          labeled(t('plan.targetWeight') + ' (' + t('units.kg') + ')', weight.el)
        ])
      ]));
    });
  }

  const actions = h('div', { class: 'stack', style: 'margin-top:8px' }, [
    h('button', { class: 'btn btn--block', onclick: () => exercisePicker((ex) => {
      plan.exercises.push({ exerciseId: ex.id, targetSets: 3, targetReps: ex.metric === 'reps' ? 10 : null, targetWeightKg: null });
      renderExercises();
    }) }, ['＋ ' + t('plan.addExercise')]),
    h('button', { class: 'btn btn--primary btn--block', onclick: save }, [t('common.save')]),
    h('button', { class: 'btn btn--block', disabled: activeSession() ? true : null, onclick: startSession }, [t('plan.startSession')]),
    existing ? h('div', { class: 'grid2' }, [
      h('button', { class: 'btn btn--block', onclick: duplicate }, [t('plan.duplicate')]),
      h('button', { class: 'btn btn--danger btn--block', onclick: remove }, [t('common.delete')])
    ]) : null
  ]);

  root.appendChild(h('div', { class: 'stack' }, [
    labeled(t('common.name'), nameInput),
    labeled(t('common.date'), dateInput),
    h('div', { class: 'section-title', text: t('plan.exercises') }),
    exWrap,
    labeled(t('common.notes'), notesInput),
    actions
  ]));
  renderExercises();

  function sync() { plan.name = nameInput.value.trim(); plan.date = dateInput.value; plan.notes = notesInput.value.trim(); }
  function save() { sync(); savePlan(plan); toast(t('toast.planSaved')); ctx.navigate('/plan'); }
  function startSession() { sync(); savePlan(plan); const id = createSessionFromPlan(plan.id); ctx.navigate('/session/' + id); }
  function duplicate() { sync(); const copy = JSON.parse(JSON.stringify(plan)); copy.id = uid('plan'); copy.name = (copy.name || '') + ' ✧'; savePlan(copy); toast(t('toast.saved')); ctx.navigate('/plan/' + copy.id); }
  async function remove() {
    if (await confirmDialog(t('plan.deleteConfirm'), { danger: true, okText: t('common.delete') })) {
      deletePlan(plan.id); toast(t('toast.deleted')); ctx.navigate('/plan');
    }
  }
}

function labeled(label, node) {
  return h('label', { class: 'field', style: 'flex:1' }, [
    h('span', { text: label, style: 'display:block;font-size:.8rem;font-weight:600;color:var(--text-muted);margin-bottom:5px' }),
    node
  ]);
}

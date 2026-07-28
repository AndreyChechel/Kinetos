// Reusable workout templates (dateless blueprints). Separate from scheduling:
// a template can be started now, or scheduled onto a calendar date (which
// creates a plan) from here or from the Calendar screen.
import { h, uid, toast, todayISO } from '../ui.js';
import { t } from '../i18n.js';
import { getTemplates, getTemplate, saveTemplate, deleteTemplate, savePlan } from '../store.js';
import { exercisePicker, confirmDialog, sheet } from '../components.js';
import { createSessionFromTemplate, planFromTemplate, activeSession } from '../workout.js';
import { renderExerciseTargets, newTarget, labeled } from '../planedit.js';
import { setNavGuard, clearNavGuard } from '../router.js';
import { clickable } from '../ui.js';
import { icon } from '../icons.js';

export function renderTemplateList(root, params, ctx) {
  const templates = getTemplates();
  const wrap = h('div', {});
  if (!templates.length) {
    wrap.appendChild(h('div', { class: 'empty' }, [
      h('div', { class: 'empty__icon' }, [icon('clipboard', { size: 56 })]),
      h('p', { text: t('templates.empty') }),
      h('p', { class: 'small', text: t('templates.emptyHint') })
    ]));
  } else {
    const ul = h('ul', { class: 'list card card--pad-0' });
    templates.forEach((tpl) => {
      ul.appendChild(clickable(h('li', { class: 'list__item', onclick: () => ctx.navigate('/templates/' + tpl.id) }, [
        h('div', { class: 'list__thumb' }, [icon('clipboard', { size: 26 })]),
        h('div', { class: 'list__body' }, [
          h('div', { class: 'list__title', text: tpl.name || t('templates.untitled') }),
          h('div', { class: 'list__sub', text: t('exercises.count', { n: (tpl.exercises || []).length }) })
        ]),
        h('span', { class: 'list__chev' }, [icon('chevronRight', { size: 18 })])
      ])));
    });
    wrap.appendChild(ul);
  }
  root.appendChild(wrap);
  root.appendChild(h('button', { class: 'fab', 'aria-label': t('templates.new'), title: t('templates.new'),
    onclick: () => ctx.navigate('/templates/new') }, [icon('plus', { size: 28 })]));
}

export function renderTemplateEditor(root, params, ctx) {
  const existing = params.id ? getTemplate(params.id) : null;
  const tpl = existing
    ? JSON.parse(JSON.stringify(existing))
    : { id: uid('tpl'), name: '', notes: '', exercises: [] };
  ctx.setTitle(existing ? (tpl.name || t('templates.title')) : t('templates.new'));

  const nameInput = h('input', { class: 'input', value: tpl.name, placeholder: t('plan.namePlaceholder') });
  const notesInput = h('textarea', { class: 'textarea', placeholder: t('common.notes') }, [tpl.notes || '']);
  const exWrap = h('div', {});
  const rerender = () => renderExerciseTargets(exWrap, tpl.exercises, { onChange: rerender });

  const actions = h('div', { class: 'stack', style: 'margin-top:8px' }, [
    h('button', { class: 'btn btn--block', onclick: () => exercisePicker((ex) => { tpl.exercises.push(newTarget(ex)); rerender(); }) }, [icon('plus', { size: 16 }), ' ' + t('plan.addExercise')]),
    h('button', { class: 'btn btn--primary btn--block', onclick: save }, [t('common.save')]),
    h('div', { class: 'grid2' }, [
      h('button', { class: 'btn btn--block', onclick: schedule }, [t('templates.schedule')]),
      h('button', { class: 'btn btn--block', disabled: activeSession() ? true : null, onclick: startNow }, [t('templates.startNow')])
    ]),
    existing ? h('div', { class: 'grid2' }, [
      h('button', { class: 'btn btn--block', onclick: duplicate }, [t('plan.duplicate')]),
      h('button', { class: 'btn btn--danger btn--block', onclick: remove }, [t('common.delete')])
    ]) : null
  ]);

  root.appendChild(h('div', { class: 'stack' }, [
    labeled(t('common.name'), nameInput),
    h('div', { class: 'section-title', text: t('plan.exercises') }),
    exWrap,
    labeled(t('common.notes'), notesInput),
    actions
  ]));
  rerender();

  // Warn before leaving with unsaved edits (the editor works on a deep copy).
  const initialSnapshot = JSON.stringify(tpl);
  const guard = () => {
    sync();
    return JSON.stringify(tpl) === initialSnapshot || window.confirm(t('common.unsavedConfirm'));
  };
  setNavGuard(guard);

  function sync() { tpl.name = nameInput.value.trim(); tpl.notes = notesInput.value.trim(); }
  function save() { sync(); clearNavGuard(guard); saveTemplate(tpl); toast(t('templates.saved')); ctx.navigate('/plan'); }
  function startNow() { sync(); clearNavGuard(guard); saveTemplate(tpl); const id = createSessionFromTemplate(tpl.id); ctx.navigate('/session/' + id); }
  function duplicate() { sync(); clearNavGuard(guard); const copy = JSON.parse(JSON.stringify(tpl)); copy.id = uid('tpl'); copy.name = (copy.name || t('templates.untitled')) + ' (' + t('templates.copySuffix') + ')'; saveTemplate(copy); toast(t('toast.saved')); ctx.navigate('/templates/' + copy.id); }
  async function remove() {
    if (await confirmDialog(t('templates.deleteConfirm'), { danger: true, okText: t('common.delete') })) {
      clearNavGuard(guard); deleteTemplate(tpl.id); toast(t('toast.deleted')); ctx.navigate('/plan');
    }
  }
  function schedule() {
    sync(); clearNavGuard(guard); saveTemplate(tpl);
    const dateInput = h('input', { class: 'input', type: 'date', value: todayISO() });
    const { close } = sheet(t('templates.scheduleOn'), h('div', { class: 'stack' }, [
      labeled(t('common.date'), dateInput),
      h('button', { class: 'btn btn--primary btn--block', onclick: () => {
        const plan = planFromTemplate(tpl.id, dateInput.value || todayISO());
        savePlan(plan); close(); toast(t('templates.scheduled')); ctx.navigate('/plan/' + plan.id);
      } }, [t('templates.schedule')])
    ]));
  }
}

// Calendar (the "Plan" tab): a month grid marking planned sessions and
// completed workouts, a selected-day panel, and a Templates shelf on top.
// Also hosts the scheduled-session editor (a dated instance, optionally from a
// template) via renderPlanEditor.
import { h, uid, fmtDate, toast, todayISO, localISO } from '../ui.js';
import { t, getLang } from '../i18n.js';
import { getPlans, getPlan, savePlan, deletePlan, getTemplates, saveTemplate } from '../store.js';
import { completedSessions, createSessionFromPlan, planFromTemplate, activeSession } from '../workout.js';
import { exercisePicker, confirmDialog, sheet } from '../components.js';
import { renderExerciseTargets, newTarget, labeled } from '../planedit.js';

// Persist which month + day the user is looking at across visits.
const now = new Date();
let calState = { y: now.getFullYear(), m: now.getMonth(), sel: todayISO() };

const iso = (d) => localISO(d);
function monthDays(y, m) {
  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7)); // back up to Monday
  return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
}

export function renderCalendar(root, params, ctx) {
  const lang = getLang();
  const wrap = h('div', {});

  // ---- Templates shelf ----
  const templates = getTemplates();
  const shelf = h('div', { class: 'tpl-shelf' });
  templates.forEach((tpl) => shelf.appendChild(h('button', { class: 'tpl-chip', onclick: () => ctx.navigate('/templates/' + tpl.id) }, [
    h('span', { class: 'tpl-chip__name', text: tpl.name || t('templates.untitled') }),
    h('span', { class: 'tpl-chip__sub', text: t('exercises.count', { n: (tpl.exercises || []).length }) })
  ])));
  shelf.appendChild(h('button', { class: 'tpl-chip tpl-chip--new', onclick: () => ctx.navigate('/templates/new') }, ['＋ ' + t('templates.new')]));
  wrap.appendChild(h('div', { class: 'row row--between', style: 'margin:2px' }, [
    h('div', { class: 'section-title', style: 'margin:0', text: t('templates.title') }),
    templates.length ? h('a', { class: 'small', href: 'templates', 'data-route': '/templates', text: t('common.seeAll') }) : null
  ]));
  wrap.appendChild(shelf);

  // ---- Calendar ----
  const cal = h('div', { class: 'card cal' });
  wrap.appendChild(cal);
  const dayPanel = h('div', {});
  wrap.appendChild(dayPanel);
  root.appendChild(wrap);

  function renderCal() {
    cal.innerHTML = '';
    const plans = getPlans();
    const done = completedSessions();
    const planByDay = {}, doneByDay = {};
    plans.forEach((p) => { const k = (p.date || '').slice(0, 10); if (k) (planByDay[k] = planByDay[k] || []).push(p); });
    done.forEach((s) => { const k = s.startedAt ? localISO(new Date(s.startedAt)) : ''; if (k) (doneByDay[k] = doneByDay[k] || []).push(s); });

    const monthLabel = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(new Date(calState.y, calState.m, 1));
    cal.appendChild(h('div', { class: 'cal__head' }, [
      h('button', { class: 'btn btn--icon btn--ghost btn--sm', 'aria-label': t('common.back'), onclick: () => { shiftMonth(-1); } }, ['‹']),
      h('div', { class: 'cal__title', text: monthLabel }),
      h('button', { class: 'btn btn--sm btn--ghost', onclick: () => { const d = new Date(); calState = { y: d.getFullYear(), m: d.getMonth(), sel: todayISO() }; renderCal(); renderDay(); } }, [t('plan.today')]),
      h('button', { class: 'btn btn--icon btn--ghost btn--sm', 'aria-label': t('common.next') || 'Next', onclick: () => { shiftMonth(1); } }, ['›'])
    ]));

    const dow = h('div', { class: 'cal__dow' });
    const wd = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    wd.forEach((k) => dow.appendChild(h('span', { text: t('weekday.' + k) })));
    cal.appendChild(dow);

    const grid = h('div', { class: 'cal__grid' });
    const today = todayISO();
    monthDays(calState.y, calState.m).forEach((d) => {
      const k = iso(d);
      const other = d.getMonth() !== calState.m;
      const nPlan = (planByDay[k] || []).length;
      const nDone = (doneByDay[k] || []).length;
      grid.appendChild(h('button', {
        class: 'cal__day' + (other ? ' cal__day--other' : '') + (k === today ? ' cal__day--today' : '') + (k === calState.sel ? ' cal__day--sel' : ''),
        onclick: () => { calState.sel = k; renderCal(); renderDay(); }
      }, [
        h('span', { class: 'cal__day-num', text: String(d.getDate()) }),
        h('span', { class: 'cal__dots' }, [
          nPlan ? h('span', { class: 'cal__dot cal__dot--plan' }) : null,
          nDone ? h('span', { class: 'cal__dot cal__dot--done' }) : null
        ])
      ]));
    });
    cal.appendChild(grid);
  }

  function shiftMonth(dir) {
    const d = new Date(calState.y, calState.m + dir, 1);
    calState.y = d.getFullYear(); calState.m = d.getMonth();
    renderCal();
  }

  function renderDay() {
    dayPanel.innerHTML = '';
    const k = calState.sel;
    const plans = getPlans().filter((p) => (p.date || '').slice(0, 10) === k);
    const done = completedSessions().filter((s) => s.startedAt && localISO(new Date(s.startedAt)) === k);
    dayPanel.appendChild(h('div', { class: 'section-title', text: k === todayISO() ? t('plan.today') : fmtDate(k, lang, { weekday: 'long', day: 'numeric', month: 'long' }) }));

    if (!plans.length && !done.length) {
      dayPanel.appendChild(h('div', { class: 'card center muted', text: t('plan.nothingDay') }));
    } else {
      const ul = h('ul', { class: 'list card card--pad-0' });
      plans.forEach((p) => {
        ul.appendChild(h('li', { class: 'list__item' }, [
          h('div', { class: 'list__thumb', text: '🗓️', style: 'font-size:1.2rem', onclick: () => ctx.navigate('/plan/' + p.id) }),
          h('div', { class: 'list__body', onclick: () => ctx.navigate('/plan/' + p.id) }, [
            h('div', { class: 'list__title', text: p.name || t('plan.new') }),
            h('div', { class: 'list__sub', text: t('plan.planned') + ' · ' + t('exercises.count', { n: (p.exercises || []).length }) })
          ]),
          h('button', { class: 'btn btn--sm btn--primary', disabled: activeSession() ? true : null,
            onclick: () => { const id = createSessionFromPlan(p.id); ctx.navigate('/session/' + id); } }, [t('common.start')])
        ]));
      });
      done.forEach((s) => {
        ul.appendChild(h('li', { class: 'list__item', onclick: () => ctx.navigate('/session/' + s.id) }, [
          h('div', { class: 'list__thumb', text: '✓', style: 'font-size:1.2rem;color:var(--success)' }),
          h('div', { class: 'list__body' }, [
            h('div', { class: 'list__title', text: s.name || t('session.summary') }),
            h('div', { class: 'list__sub', text: t('plan.completed') + ' · ' + (s.entries || []).length + ' ' + t('nav.exercises').toLowerCase() })
          ]),
          h('span', { class: 'list__chev', text: '›' })
        ]));
      });
      dayPanel.appendChild(ul);
    }
    dayPanel.appendChild(h('button', { class: 'btn btn--block', onclick: () => scheduleSheet(k, ctx) }, ['＋ ' + t('plan.schedule')]));
  }

  renderCal();
  renderDay();
}

function scheduleSheet(dateISO, ctx) {
  const templates = getTemplates();
  const items = [
    h('button', { class: 'btn btn--block', onclick: () => {
      const plan = { id: uid('plan'), templateId: null, name: '', date: dateISO, notes: '', exercises: [] };
      savePlan(plan); close(); ctx.navigate('/plan/' + plan.id);
    } }, ['＋ ' + t('plan.emptySession')])
  ];
  if (templates.length) {
    items.push(h('div', { class: 'section-title', text: t('templates.fromTemplate') }));
    templates.forEach((tpl) => items.push(h('button', { class: 'btn btn--block', style: 'justify-content:space-between', onclick: () => {
      const plan = planFromTemplate(tpl.id, dateISO); savePlan(plan); close(); toast(t('templates.scheduled')); ctx.navigate('/plan/' + plan.id);
    } }, [tpl.name || t('templates.untitled'), h('span', { class: 'muted small', text: t('exercises.count', { n: (tpl.exercises || []).length }) })])));
  }
  const ctl = sheet(t('plan.schedule'), h('div', { class: 'stack' }, items));
  function close() { ctl.close(); }
}

export function renderPlanEditor(root, params, ctx) {
  const existing = params.id ? getPlan(params.id) : null;
  const dateParam = new URLSearchParams(location.search).get('date');
  const plan = existing
    ? JSON.parse(JSON.stringify(existing))
    : { id: uid('plan'), templateId: null, name: '', date: dateParam || todayISO(), notes: '', exercises: [] };
  ctx.setTitle(existing ? (plan.name || t('plan.scheduled')) : t('plan.schedule'));

  const nameInput = h('input', { class: 'input', value: plan.name, placeholder: t('plan.namePlaceholder') });
  const dateInput = h('input', { class: 'input', type: 'date', value: (plan.date || '').slice(0, 10) });
  const notesInput = h('textarea', { class: 'textarea', placeholder: t('common.notes') }, [plan.notes || '']);
  const exWrap = h('div', {});
  const rerender = () => renderExerciseTargets(exWrap, plan.exercises, { onChange: rerender });

  const actions = h('div', { class: 'stack', style: 'margin-top:8px' }, [
    h('button', { class: 'btn btn--block', onclick: () => exercisePicker((ex) => { plan.exercises.push(newTarget(ex)); rerender(); }) }, ['＋ ' + t('plan.addExercise')]),
    h('button', { class: 'btn btn--primary btn--block', onclick: save }, [t('common.save')]),
    h('button', { class: 'btn btn--block', disabled: activeSession() ? true : null, onclick: startSession }, [t('plan.startSession')]),
    h('div', { class: 'grid2' }, [
      h('button', { class: 'btn btn--block', onclick: saveAsTemplate }, [t('plan.saveAsTemplate')]),
      existing ? h('button', { class: 'btn btn--danger btn--block', onclick: remove }, [t('common.delete')]) : null
    ])
  ]);

  root.appendChild(h('div', { class: 'stack' }, [
    labeled(t('common.name'), nameInput),
    labeled(t('common.date'), dateInput),
    h('div', { class: 'section-title', text: t('plan.exercises') }),
    exWrap,
    labeled(t('common.notes'), notesInput),
    actions
  ]));
  rerender();

  function sync() { plan.name = nameInput.value.trim(); plan.date = dateInput.value; plan.notes = notesInput.value.trim(); }
  function save() { sync(); savePlan(plan); toast(t('toast.planSaved')); ctx.navigate('/plan'); }
  function startSession() { sync(); savePlan(plan); const id = createSessionFromPlan(plan.id); ctx.navigate('/session/' + id); }
  function saveAsTemplate() {
    sync();
    const tpl = { id: uid('tpl'), name: plan.name || t('templates.untitled'), notes: plan.notes || '', exercises: JSON.parse(JSON.stringify(plan.exercises || [])) };
    saveTemplate(tpl); toast(t('templates.saved')); ctx.navigate('/templates/' + tpl.id);
  }
  async function remove() {
    if (await confirmDialog(t('plan.deleteConfirm'), { danger: true, okText: t('common.delete') })) {
      deletePlan(plan.id); toast(t('toast.deleted')); ctx.navigate('/plan');
    }
  }
}

// Dashboard: greeting, active/today session, week stats, recent workouts, quick start.
import { h, fmtDate, fmtDuration, todayISO } from '../ui.js';
import { t } from '../i18n.js';
import { getProfile, getPlans } from '../store.js';
import { activeSession, createEmptySession, createSessionFromPlan, completedSessions, weekStats, sessionDurationMs } from '../workout.js';
import { sessionVolume } from '../calc.js';
import { volumeWeightOf } from '../data/db.js';
import { getLang } from '../i18n.js';

export default function renderHome(root, params, ctx) {
  const profile = getProfile();
  const lang = getLang();
  const wrap = h('div', {});

  // Greeting — personal and time-of-day aware
  const hour = new Date().getHours();
  const part = hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : hour < 22 ? 'evening' : 'night';
  const salutation = t('home.' + part);
  const greeting = profile.name ? `${salutation}, ${profile.name}` : salutation;
  wrap.appendChild(h('div', { class: 'row row--between', style: 'margin:2px 2px 12px' }, [
    h('div', {}, [
      h('h2', { style: 'margin:0', text: greeting }),
      h('div', { class: 'muted small', text: t('app.tagline') })
    ])
  ]));

  // Active session banner
  const active = activeSession();
  if (active) {
    wrap.appendChild(h('div', { class: 'card', style: 'border-color:var(--success)' }, [
      h('div', { class: 'row row--between' }, [
        h('div', {}, [
          h('span', { class: 'badge badge--live' }, ['● ' + t('home.activeSession')]),
          h('div', { class: 'small muted', style: 'margin-top:6px', text: active.name || fmtDate(active.startedAt, lang) })
        ]),
        h('button', { class: 'btn btn--primary', onclick: () => ctx.navigate('/session/' + active.id) }, [t('home.continueSession')])
      ])
    ]));
  }

  // Today's plan
  const today = todayISO();
  const todays = getPlans().filter((p) => (p.date || '').slice(0, 10) === today);
  wrap.appendChild(h('div', { class: 'section-title', text: t('home.todayPlan') }));
  if (todays.length) {
    todays.forEach((p) => {
      wrap.appendChild(h('div', { class: 'card' }, [
        h('div', { class: 'row row--between' }, [
          h('div', {}, [
            h('div', { style: 'font-weight:700', text: p.name || t('plan.new') }),
            h('div', { class: 'small muted', text: t('exercises.count', { n: (p.exercises || []).length }) })
          ]),
          h('button', {
            class: 'btn btn--primary btn--sm',
            disabled: active ? true : null,
            onclick: () => { const id = createSessionFromPlan(p.id); ctx.navigate('/session/' + id); }
          }, [t('home.startFromPlan')])
        ])
      ]));
    });
  } else {
    wrap.appendChild(h('div', { class: 'card center' }, [
      h('div', { class: 'muted', style: 'margin-bottom:10px', text: t('home.noPlanToday') }),
      h('button', { class: 'btn btn--sm', onclick: () => ctx.navigate('/plan/new') }, [t('home.planSomething')])
    ]));
  }

  // This week stats
  const ws = weekStats();
  wrap.appendChild(h('div', { class: 'section-title', text: t('home.thisWeek') }));
  wrap.appendChild(h('div', { class: 'grid2' }, [
    stat(ws.workouts, t('home.workouts')),
    stat(ws.volume.toLocaleString(lang) + ' ' + t('units.kg'), t('home.volume'))
  ]));

  // Recent workouts
  const recent = completedSessions().slice(0, 4);
  wrap.appendChild(h('div', { class: 'section-title', text: t('home.recent') }));
  if (recent.length) {
    const ul = h('ul', { class: 'list card card--pad-0' });
    recent.forEach((s) => {
      const v = sessionVolume(s, volumeWeightOf);
      ul.appendChild(h('li', { class: 'list__item', onclick: () => ctx.navigate('/session/' + s.id) }, [
        h('div', { class: 'list__thumb', text: '🏋️', style: 'font-size:1.4rem' }),
        h('div', { class: 'list__body' }, [
          h('div', { class: 'list__title', text: s.name || fmtDate(s.startedAt, lang) }),
          h('div', { class: 'list__sub', text: `${fmtDate(s.startedAt, lang)} · ${v.sets} ${t('common.sets')} · ${fmtDuration(sessionDurationMs(s))}` })
        ]),
        h('span', { class: 'list__chev', text: '›' })
      ]));
    });
    wrap.appendChild(ul);
  } else {
    wrap.appendChild(h('div', { class: 'card center muted', text: t('home.noRecent') }));
  }

  // Quick start FAB
  const fab = h('button', { class: 'fab', 'aria-label': t('home.startEmpty'), title: t('home.startEmpty'),
    disabled: active ? true : null,
    onclick: () => { const id = createEmptySession(); ctx.navigate('/session/' + id); } }, ['＋']);
  root.appendChild(wrap);
  if (!active) root.appendChild(fab);
}

function stat(value, label) {
  return h('div', { class: 'stat' }, [
    h('div', { class: 'stat__value', text: String(value) }),
    h('div', { class: 'stat__label', text: label })
  ]);
}

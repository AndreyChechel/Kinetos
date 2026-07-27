// Progress / analytics. Uses Chart.js from /vendor when available, else a
// lightweight built-in fallback so the page still works fully offline.
import { h, fmtDate, fmtDuration } from '../ui.js';
import { t, getLang } from '../i18n.js';
import { getExercise, exName } from '../data/db.js';
import { completedSessions, weekStats, sessionDurationMs, isThisWeek } from '../workout.js';
import { sessionVolume, oneRepMax } from '../calc.js';

let chartPromise = null;
function ensureChart() {
  if (window.Chart) return Promise.resolve(true);
  if (chartPromise) return chartPromise;
  chartPromise = new Promise((resolve) => {
    const sc = document.createElement('script');
    sc.src = 'vendor/chart.umd.js';
    sc.onload = () => resolve(!!window.Chart);
    sc.onerror = () => resolve(false);
    document.head.appendChild(sc);
  });
  return chartPromise;
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

export default async function renderProgress(root, params, ctx) {
  const lang = getLang();
  const sessions = completedSessions();

  if (!sessions.length) {
    root.appendChild(h('div', { class: 'empty' }, [
      h('div', { class: 'empty__icon', text: '📈' }),
      h('p', { text: t('progress.empty') }),
      h('p', { class: 'small', text: t('progress.emptyHint') })
    ]));
    return;
  }

  // ---- Stat tiles ----
  const ws = weekStats();
  let totalVol = 0, totalSets = 0, durSum = 0;
  sessions.forEach((s) => { const v = sessionVolume(s); totalVol += v.volume; totalSets += v.sets; durSum += sessionDurationMs(s); });
  const avgDur = fmtDuration(durSum / sessions.length);

  root.appendChild(h('div', { class: 'grid2', style: 'margin-bottom:12px' }, [
    tile(ws.workouts, t('progress.thisWeek') + ' · ' + t('progress.workouts')),
    tile(totalVol.toLocaleString(lang) + ' ' + t('units.kg'), t('progress.totalVolume')),
    tile(totalSets, t('progress.totalSets')),
    tile(avgDur, t('progress.avgDuration'))
  ]));

  const hasChart = await ensureChart();

  // ---- Volume over time (last 30 days) ----
  const since = new Date(); since.setDate(since.getDate() - 30);
  const byDay = {};
  sessions.filter((s) => new Date(s.startedAt) >= since)
    .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
    .forEach((s) => {
      const day = s.startedAt.slice(0, 10);
      byDay[day] = (byDay[day] || 0) + sessionVolume(s).volume;
    });
  const volLabels = Object.keys(byDay);
  const volData = Object.values(byDay);
  root.appendChild(card(t('progress.volumeOverTime') + ' · ' + t('progress.last30'),
    volLabels.length ? chartOrFallback(hasChart, 'line', volLabels.map((d) => fmtDate(d, lang, { month: 'short', day: 'numeric' })), volData)
      : muted(t('progress.noData'))));

  // ---- Sets by muscle group ----
  const groupSets = {};
  sessions.forEach((s) => (s.entries || []).forEach((e) => {
    const ex = getExercise(e.exerciseId); if (!ex) return;
    const done = (e.sets || []).filter((x) => x.done !== false && (x.reps || x.seconds || x.distanceKm)).length;
    groupSets[ex.group] = (groupSets[ex.group] || 0) + done;
  }));
  const gLabels = Object.keys(groupSets);
  root.appendChild(card(t('progress.byMuscle'),
    gLabels.length ? chartOrFallback(hasChart, 'bar', gLabels.map((g) => t('groups.' + g)), Object.values(groupSets))
      : muted(t('progress.noData'))));

  // ---- Estimated 1RM per exercise ----
  const repExercises = [...new Set(sessions.flatMap((s) => (s.entries || [])
    .filter((e) => (e.sets || []).some((x) => x.weightKg && x.reps))
    .map((e) => e.exerciseId)))];
  if (repExercises.length) {
    const select = h('select', { class: 'select' }, repExercises.map((id) => {
      const ex = getExercise(id); return h('option', { value: id, text: ex ? exName(ex) : id });
    }));
    const chartHost = h('div', {});
    const c = card(t('progress.est1rm'), h('div', { class: 'stack' }, [select, chartHost]));
    root.appendChild(c);
    const draw = () => {
      chartHost.innerHTML = '';
      const id = select.value;
      const points = sessions.slice().reverse().map((s) => {
        const e = (s.entries || []).find((x) => x.exerciseId === id);
        if (!e) return null;
        let best = 0;
        (e.sets || []).forEach((x) => { if (x.weightKg && x.reps) { const o = oneRepMax(x.weightKg, x.reps); if (o && o.avg > best) best = o.avg; } });
        return best ? { day: s.startedAt.slice(0, 10), val: Math.round(best) } : null;
      }).filter(Boolean);
      if (points.length < 1) { chartHost.appendChild(muted(t('progress.noData'))); return; }
      chartHost.appendChild(chartOrFallback(hasChart, 'line',
        points.map((p) => fmtDate(p.day, lang, { month: 'short', day: 'numeric' })), points.map((p) => p.val)));
    };
    select.addEventListener('change', draw);
    draw();
  }

  // ---- Recent sessions ----
  root.appendChild(h('div', { class: 'section-title', text: t('progress.recentSessions') }));
  const ul = h('ul', { class: 'list card card--pad-0' });
  sessions.slice(0, 8).forEach((s) => {
    const v = sessionVolume(s);
    ul.appendChild(h('li', { class: 'list__item', onclick: () => ctx.navigate('/session/' + s.id) }, [
      h('div', { class: 'list__thumb', text: '🏋️', style: 'font-size:1.3rem' }),
      h('div', { class: 'list__body' }, [
        h('div', { class: 'list__title', text: s.name || fmtDate(s.startedAt, lang) }),
        h('div', { class: 'list__sub', text: `${fmtDate(s.startedAt, lang)} · ${v.sets} ${t('common.sets')} · ${v.volume} ${t('units.kg')}` })
      ]),
      h('span', { class: 'list__chev', text: '›' })
    ]));
  });
  root.appendChild(ul);
}

function chartOrFallback(hasChart, type, labels, data) {
  if (hasChart) {
    const canvas = h('canvas', { height: 200 });
    setTimeout(() => {
      const primary = cssVar('--primary') || '#2f6df6';
      const grid = cssVar('--border') || '#ddd';
      const text = cssVar('--text-muted') || '#888';
      // eslint-disable-next-line no-undef
      new Chart(canvas.getContext('2d'), {
        type,
        data: { labels, datasets: [{ data, label: '', borderColor: primary, backgroundColor: type === 'line' ? 'transparent' : primary, fill: false, tension: 0.3, borderRadius: 6, pointRadius: 2 }] },
        options: { responsive: true, plugins: { legend: { display: false } },
          scales: { x: { grid: { color: grid }, ticks: { color: text, maxRotation: 0, autoSkip: true } },
            y: { grid: { color: grid }, ticks: { color: text }, beginAtZero: true } } }
      });
    }, 0);
    return canvas;
  }
  return fallbackBars(labels, data);
}

/** Simple offline bar chart with plain elements. */
function fallbackBars(labels, data) {
  const max = Math.max(1, ...data);
  return h('div', { class: 'stack', style: 'gap:6px' }, labels.map((lab, i) => h('div', { class: 'zone' }, [
    h('span', { style: 'width:64px;flex:none;font-size:.75rem', class: 'muted', text: lab }),
    h('div', { class: 'zone__bar', style: `background:var(--surface-2);position:relative` }, [
      h('div', { style: `position:absolute;inset:0;width:${Math.round(data[i] / max * 100)}%;background:var(--primary);border-radius:6px` })
    ]),
    h('span', { style: 'width:52px;flex:none;text-align:right;font-size:.75rem', text: String(Math.round(data[i])) })
  ])));
}

function card(title, node) {
  return h('div', { class: 'card' }, [h('div', { class: 'card__title', text: title }), node]);
}
function tile(value, label) {
  return h('div', { class: 'stat' }, [h('div', { class: 'stat__value', text: String(value) }), h('div', { class: 'stat__label', text: label })]);
}
function muted(txt) { return h('p', { class: 'muted small center', text: txt }); }

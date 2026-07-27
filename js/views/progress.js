// Progress / analytics with a Day / Week / Month / Year period selector.
// Uses Chart.js from /vendor when available, else a built-in fallback so the
// page works fully offline.
import { h, fmtDate, fmtDuration } from '../ui.js';
import { t, getLang } from '../i18n.js';
import { getExercise, exName, effectiveWeight, volumeWeightOf } from '../data/db.js';
import { completedSessions, sessionDurationMs, startOfWeek } from '../workout.js';
import { sessionVolume, oneRepMax } from '../calc.js';
import { ensureChart, chartOrFallback } from '../charts.js';
import { icon } from '../icons.js';

let period = 'week';           // day | week | month | year — persists across visits

// ---- date helpers ----
function windowFor(p) {
  const now = new Date();
  let start;
  const end = new Date(now);
  if (p === 'day') { start = new Date(now); start.setHours(0, 0, 0, 0); }
  else if (p === 'week') { start = startOfWeek(now); }
  else if (p === 'month') { start = new Date(now.getFullYear(), now.getMonth(), 1); }
  else { start = new Date(now.getFullYear(), 0, 1); }
  return { start, end };
}
function bucketsFor(p, lang) {
  const now = new Date();
  const out = [];
  const push = (label, start, end) => out.push({ label, start, end });
  if (p === 'day') {
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const e = new Date(d); e.setDate(e.getDate() + 1);
      push(fmtDate(d.toISOString(), lang, { day: 'numeric', month: 'short' }), d, e);
    }
  } else if (p === 'week') {
    const s0 = startOfWeek(now);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(s0); d.setDate(d.getDate() - i * 7);
      const e = new Date(d); e.setDate(e.getDate() + 7);
      push(fmtDate(d.toISOString(), lang, { day: 'numeric', month: 'short' }), d, e);
    }
  } else if (p === 'month') {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const e = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      push(fmtDate(d.toISOString(), lang, { month: 'short', year: '2-digit' }), d, e);
    }
  } else {
    for (let i = 4; i >= 0; i--) {
      const d = new Date(now.getFullYear() - i, 0, 1);
      const e = new Date(d.getFullYear() + 1, 0, 1);
      push(String(d.getFullYear()), d, e);
    }
  }
  return out;
}

export default function renderProgress(root, params, ctx) {
  const lang = getLang();
  const all = completedSessions();

  if (!all.length) {
    root.appendChild(h('div', { class: 'empty' }, [
      h('div', { class: 'empty__icon' }, [icon('trendingUp', { size: 56 })]),
      h('p', { text: t('progress.empty') }),
      h('p', { class: 'small', text: t('progress.emptyHint') })
    ]));
    return;
  }

  // Period selector
  const chips = h('div', { class: 'chips', style: 'margin-bottom:6px' });
  const content = h('div', {});
  root.append(chips, content);

  function renderChips() {
    chips.innerHTML = '';
    ['day', 'week', 'month', 'year'].forEach((p) => chips.appendChild(
      h('button', { class: 'chip' + (period === p ? ' is-active' : ''), onclick: () => { period = p; render(); } }, [t('progress.' + p)])
    ));
  }

  async function render() {
    renderChips();
    content.innerHTML = '';
    const { start, end } = windowFor(period);
    const inWin = all.filter((s) => { const d = new Date(s.startedAt); return d >= start && d < end; });

    // Tiles for the selected period
    let vol = 0, sets = 0, dur = 0, effSum = 0, effN = 0;
    inWin.forEach((s) => {
      const v = sessionVolume(s, volumeWeightOf); vol += v.volume; sets += v.sets; dur += sessionDurationMs(s);
      (s.entries || []).forEach((e) => (e.sets || []).forEach((x) => { if (x.done && x.effort) { effSum += x.effort; effN++; } }));
    });
    const tiles = [
      tile(inWin.length, t('progress.workouts')),
      tile(vol.toLocaleString(lang) + ' ' + t('units.kg'), t('progress.totalVolume')),
      tile(sets, t('progress.totalSets')),
      tile(inWin.length ? fmtDuration(dur / inWin.length) : '—', t('progress.avgDuration'))
    ];
    if (effN) tiles.push(tile((effSum / effN).toFixed(1) + ' / 3', t('progress.avgEffort')));
    content.appendChild(h('div', { class: 'grid2', style: 'margin-bottom:12px' }, tiles));

    const hasChart = await ensureChart();

    // Volume over time (bucketed to the period granularity)
    const bk = bucketsFor(period, lang);
    const volSeries = bk.map((b) => all.filter((s) => { const d = new Date(s.startedAt); return d >= b.start && d < b.end; })
      .reduce((sum, s) => sum + sessionVolume(s, volumeWeightOf).volume, 0));
    content.appendChild(card(t('progress.volumeOverTime'),
      volSeries.some((x) => x) ? chartOrFallback(hasChart, 'line', bk.map((b) => b.label), volSeries) : muted(t('progress.noData'))));

    // Sets by muscle group within the window
    const groupSets = {};
    inWin.forEach((s) => (s.entries || []).forEach((e) => {
      const ex = getExercise(e.exerciseId); if (!ex) return;
      const done = (e.sets || []).filter((x) => x.done !== false && (x.reps || x.seconds || x.distanceKm)).length;
      if (done) groupSets[ex.group] = (groupSets[ex.group] || 0) + done;
    }));
    const gLabels = Object.keys(groupSets);
    content.appendChild(card(t('progress.byMuscle'),
      gLabels.length ? chartOrFallback(hasChart, 'bar', gLabels.map((g) => t('groups.' + g)), Object.values(groupSets)) : muted(t('progress.noData'))));

    // Estimated 1RM per exercise (all-time trend)
    const repExercises = [...new Set(all.flatMap((s) => (s.entries || [])
      .filter((e) => (e.sets || []).some((x) => x.weightKg && x.reps)).map((e) => e.exerciseId)))];
    if (repExercises.length) {
      const select = h('select', { class: 'select' }, repExercises.map((id) => {
        const ex = getExercise(id); return h('option', { value: id, text: ex ? exName(ex) : id });
      }));
      const chartHost = h('div', {});
      content.appendChild(card(t('progress.est1rm'), h('div', { class: 'stack' }, [select, chartHost])));
      const draw = () => {
        chartHost.innerHTML = '';
        const id = select.value;
        const pts = all.slice().reverse().map((s) => {
          const e = (s.entries || []).find((x) => x.exerciseId === id);
          if (!e) return null;
          let best = 0;
          (e.sets || []).forEach((x) => { if (x.weightKg && x.reps) { const o = oneRepMax(effectiveWeight(id, x.weightKg, x), x.reps); if (o && o.avg > best) best = o.avg; } });
          return best ? { day: s.startedAt.slice(0, 10), val: Math.round(best) } : null;
        }).filter(Boolean);
        if (!pts.length) { chartHost.appendChild(muted(t('progress.noData'))); return; }
        chartHost.appendChild(chartOrFallback(hasChart, 'line', pts.map((p) => fmtDate(p.day, lang, { month: 'short', day: 'numeric' })), pts.map((p) => p.val)));
      };
      select.addEventListener('change', draw); draw();
    }

    // Recent sessions
    content.appendChild(h('div', { class: 'section-title', text: t('progress.recentSessions') }));
    const ul = h('ul', { class: 'list card card--pad-0' });
    all.slice(0, 8).forEach((s) => {
      const v = sessionVolume(s, volumeWeightOf);
      ul.appendChild(h('li', { class: 'list__item', onclick: () => ctx.navigate('/session/' + s.id) }, [
        h('div', { class: 'list__thumb' }, [icon('dumbbell', { size: 26 })]),
        h('div', { class: 'list__body' }, [
          h('div', { class: 'list__title', text: s.name || fmtDate(s.startedAt, lang) }),
          h('div', { class: 'list__sub', text: `${fmtDate(s.startedAt, lang)} · ${v.sets} ${t('common.sets')} · ${v.volume} ${t('units.kg')}` })
        ]),
        h('span', { class: 'list__chev' }, [icon('chevronRight', { size: 18 })])
      ]));
    });
    content.appendChild(ul);
  }

  render();
}

function card(title, node) { return h('div', { class: 'card' }, [h('div', { class: 'card__title', text: title }), node]); }
function tile(value, label) { return h('div', { class: 'stat' }, [h('div', { class: 'stat__value', text: String(value) }), h('div', { class: 'stat__label', text: label })]); }
function muted(txt) { return h('p', { class: 'muted small center', text: txt }); }

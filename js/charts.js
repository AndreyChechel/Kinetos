// Shared charting: loads Chart.js from /vendor when available, else renders a
// dependency-free fallback so charts still work fully offline. Used by the
// Progress screen and the finished-session stats.
import { h } from './ui.js';

let chartPromise = null;

export function ensureChart() {
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

export function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

// Chart.js instances are registered globally (with resize observers) and leak
// if their canvas is detached without destroy(). Track every instance we
// create and reap the orphans on re-render / navigation.
const liveCharts = new Set();
export function reapCharts() {
  liveCharts.forEach((c) => {
    if (!c.canvas || !c.canvas.isConnected) {
      try { c.destroy(); } catch (_) { /* already gone */ }
      liveCharts.delete(c);
    }
  });
}
if (typeof window !== 'undefined') window.addEventListener('route:change', reapCharts);

const PALETTE = ['--primary', '--accent', '--success', '--danger', '#f0b429', '#8b5cf6', '#14b8a6', '#ec4899'];
function palette(i) { const p = PALETTE[i % PALETTE.length]; return p.startsWith('--') ? (cssVar(p) || '#2f6df6') : p; }
// Canvas can't parse `var(--x)`; an unrecognised fillStyle is silently ignored
// (so two `var(...)` slices would draw in the same leftover color). Resolve any
// CSS-variable references to concrete values before handing them to Chart.js.
function resolveColor(c) {
  if (typeof c !== 'string') return c;
  const m = c.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  return m ? (cssVar(m[1]) || c) : c;
}

/** type: 'line' | 'bar' | 'doughnut'. colors: optional array (per-datapoint). */
export function chartOrFallback(hasChart, type, labels, data, { colors, height = 200 } = {}) {
  if (hasChart) {
    const canvas = h('canvas', { height });
    setTimeout(() => {
      if (!canvas.isConnected) return; // view re-rendered before we got here
      const primary = cssVar('--primary') || '#2f6df6';
      const grid = cssVar('--border') || '#ddd';
      const text = cssVar('--text-muted') || '#888';
      const multi = (colors ? colors.map(resolveColor) : (type !== 'line' ? labels.map((_, i) => palette(i)) : primary));
      const isPie = type === 'doughnut' || type === 'pie';
      // eslint-disable-next-line no-undef
      liveCharts.add(new Chart(canvas.getContext('2d'), {
        type,
        data: {
          labels,
          datasets: [{
            data,
            label: '',
            borderColor: type === 'line' ? primary : (isPie ? cssVar('--surface') : 'transparent'),
            backgroundColor: type === 'line' ? 'transparent' : multi,
            fill: false, tension: 0.3, borderRadius: type === 'bar' ? 6 : 0, pointRadius: 2, borderWidth: isPie ? 2 : 2
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: isPie, position: 'bottom', labels: { color: text, boxWidth: 12, font: { size: 11 } } } },
          scales: isPie ? {} : {
            x: { grid: { color: grid }, ticks: { color: text, maxRotation: 0, autoSkip: true } },
            y: { grid: { color: grid }, ticks: { color: text }, beginAtZero: true }
          }
        }
      }));
    }, 0);
    return canvas;
  }
  return fallback(type, labels, data);
}

function fallback(type, labels, data) {
  if (type === 'doughnut' || type === 'pie') {
    const total = data.reduce((a, b) => a + b, 0) || 1;
    return h('div', { class: 'stack', style: 'gap:6px' }, labels.map((lab, i) => h('div', { class: 'zone' }, [
      h('span', { style: `width:10px;height:10px;border-radius:3px;flex:none;background:${palette(i)}` }),
      h('span', { style: 'flex:1;font-size:.8rem', text: lab }),
      h('span', { style: 'font-size:.8rem;font-weight:700', text: `${Math.round(data[i] / total * 100)}%` })
    ])));
  }
  const max = Math.max(1, ...data);
  return h('div', { class: 'stack', style: 'gap:6px' }, labels.map((lab, i) => h('div', { class: 'zone' }, [
    h('span', { style: 'width:64px;flex:none;font-size:.75rem', class: 'muted', text: lab }),
    h('div', { class: 'zone__bar', style: 'background:var(--surface-2);position:relative' }, [
      h('div', { style: `position:absolute;inset:0;width:${Math.round(data[i] / max * 100)}%;background:var(--primary);border-radius:6px` })
    ]),
    h('span', { style: 'width:52px;flex:none;text-align:right;font-size:.75rem', text: String(Math.round(data[i])) })
  ])));
}

// Reusable UI pieces: bottom sheet, confirm dialog, exercise picker, stepper.
import { h, qs } from './ui.js';
import { t } from './i18n.js';
import { byGroup, groups, exName, svgPath } from './data/db.js';
import { injectSVG } from './svg.js';

/** Bottom sheet overlay. Returns { close }. */
export function sheet(titleText, contentNode, { onClose } = {}) {
  const panel = h('div', { class: 'sheet__panel' }, [
    h('div', { class: 'sheet__grab' }),
    h('div', { class: 'sheet__head' }, [
      h('h3', { class: 'sheet__title', text: titleText }),
      h('button', { class: 'btn btn--icon btn--ghost', 'aria-label': t('common.close'), onclick: () => close() }, ['✕'])
    ]),
    h('div', { class: 'sheet__body' }, [contentNode])
  ]);
  const overlay = h('div', { class: 'sheet' }, [panel]);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  function close() {
    overlay.classList.remove('is-open');
    setTimeout(() => { overlay.remove(); onClose && onClose(); }, 220);
  }
  return { close, panel };
}

/** Promise-based confirm dialog. */
export function confirmDialog(message, { danger = false, okText, cancelText } = {}) {
  return new Promise((resolve) => {
    const panel = h('div', { class: 'dialog__panel' }, [
      h('p', { class: 'dialog__msg', text: message }),
      h('div', { class: 'dialog__actions' }, [
        h('button', { class: 'btn btn--ghost', onclick: () => done(false) }, [cancelText || t('common.cancel')]),
        h('button', { class: 'btn ' + (danger ? 'btn--danger' : 'btn--primary'), onclick: () => done(true) }, [okText || t('common.confirm')])
      ])
    ]);
    const overlay = h('div', { class: 'dialog' }, [panel]);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    function done(v) { overlay.classList.remove('is-open'); setTimeout(() => overlay.remove(), 180); resolve(v); }
  });
}

/** Promise-based text/password prompt. Resolves to the string or null. */
export function promptDialog(message, { password = false, placeholder = '', okText, cancelText } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', type: password ? 'password' : 'text', placeholder, style: 'margin-bottom:16px' });
    const panel = h('div', { class: 'dialog__panel' }, [
      h('p', { class: 'dialog__msg', text: message }),
      input,
      h('div', { class: 'dialog__actions' }, [
        h('button', { class: 'btn btn--ghost', onclick: () => done(null) }, [cancelText || t('common.cancel')]),
        h('button', { class: 'btn btn--primary', onclick: () => done(input.value) }, [okText || t('common.ok')])
      ])
    ]);
    const overlay = h('div', { class: 'dialog' }, [panel]);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    setTimeout(() => input.focus(), 60);
    function done(v) { overlay.classList.remove('is-open'); setTimeout(() => overlay.remove(), 180); resolve(v == null ? null : v); }
  });
}

/** Exercise picker sheet. Calls onPick(exercise) when one is chosen. */
export function exercisePicker(onPick) {
  const search = h('input', { class: 'input', type: 'search', placeholder: t('exercises.searchPlaceholder') });
  const chips = h('div', { class: 'chips' });
  const listWrap = h('div', {});
  const content = h('div', { class: 'stack' }, [search, chips, listWrap]);
  const { close } = sheet(t('session.addExercise'), content);

  let filter = 'all';
  let query = '';

  function renderChips() {
    chips.innerHTML = '';
    const mk = (key, label) => h('button', {
      class: 'chip' + (filter === key ? ' is-active' : ''),
      onclick: () => { filter = key; query = search.value; render(); }
    }, [label]);
    chips.appendChild(mk('all', t('common.all')));
    groups().forEach((g) => chips.appendChild(mk(g, t('groups.' + g))));
  }

  function render() {
    renderChips();
    const grouped = byGroup(filter, query);
    listWrap.innerHTML = '';
    let any = false;
    for (const [g, list] of Object.entries(grouped)) {
      if (!list.length) continue;
      any = true;
      listWrap.appendChild(h('div', { class: 'section-title', text: t('groups.' + g) }));
      const ul = h('ul', { class: 'list card card--pad-0' });
      list.forEach((ex) => {
        const thumb = h('div', { class: 'list__thumb' });
        injectSVG(thumb, svgPath(ex));
        ul.appendChild(h('li', {
          class: 'list__item',
          onclick: () => { onPick(ex); close(); }
        }, [
          thumb,
          h('div', { class: 'list__body' }, [
            h('div', { class: 'list__title', text: exName(ex) }),
            h('div', { class: 'list__sub', text: (ex.primary || []).map((mk) => t('muscles.' + mk)).join(', ') })
          ]),
          h('span', { class: 'list__chev', text: '＋' })
        ]));
      });
      listWrap.appendChild(ul);
    }
    if (!any) listWrap.appendChild(h('p', { class: 'empty', text: t('exercises.none') }));
  }

  search.addEventListener('input', () => { query = search.value; render(); });
  render();
  setTimeout(() => search.focus(), 250);
}

/** Number stepper. Returns { el, get, set }. */
export function stepper(value, { min = 0, max = 999, step = 1, decimals = 0 } = {}) {
  const input = h('input', { class: 'input', type: 'number', inputmode: 'decimal', value: fmt(value), min, max, step });
  function fmt(v) { return decimals ? Number(v).toFixed(decimals).replace(/\.0$/, '') : String(v); }
  const dec = h('button', { type: 'button', 'aria-label': '−', onclick: () => set(get() - step) }, ['−']);
  const inc = h('button', { type: 'button', 'aria-label': '+', onclick: () => set(get() + step) }, ['+']);
  const el = h('div', { class: 'stepper' }, [dec, input, inc]);
  function get() { const n = parseFloat(input.value); return isNaN(n) ? 0 : n; }
  function set(v) { v = Math.max(min, Math.min(max, Math.round(v / step) * step)); input.value = fmt(v); input.dispatchEvent(new Event('change', { bubbles: true })); }
  return { el, get, set, input };
}

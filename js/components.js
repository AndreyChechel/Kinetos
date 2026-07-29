// Reusable UI pieces: bottom sheet, confirm dialog, exercise picker, stepper,
// long-press, popover menus, rep/weight choosers, set runner, swipe-to-delete.
import { h, clickable, fmtDuration } from './ui.js';
import { t } from './i18n.js';
import { byGroup, groups, exName, repPresets } from './data/db.js';
import { injectExerciseSVG } from './svg.js';
import { icon } from './icons.js';

/** Shared a11y wiring for modal overlays: Escape closes, focus moves in and is
 *  restored on close. Returns a teardown fn (call it from close()). */
function modalize(overlay, panel, close, focusEl) {
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const prevFocus = document.activeElement;
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey);
  if (!focusEl) { panel.tabIndex = -1; focusEl = panel; }
  setTimeout(() => { try { focusEl.focus(); } catch (_) { /* ignore */ } }, 60);
  return () => {
    document.removeEventListener('keydown', onKey);
    if (prevFocus && prevFocus.focus && document.contains(prevFocus)) { try { prevFocus.focus(); } catch (_) { /* ignore */ } }
  };
}

/** Bottom sheet overlay. Returns { close }. */
export function sheet(titleText, contentNode, { onClose } = {}) {
  const closeBtn = h('button', { class: 'btn btn--icon btn--ghost', 'aria-label': t('common.close'), onclick: () => close() }, [icon('x', { size: 18 })]);
  const panel = h('div', { class: 'sheet__panel', 'aria-label': titleText }, [
    h('div', { class: 'sheet__grab' }),
    h('div', { class: 'sheet__head' }, [
      h('h3', { class: 'sheet__title', text: titleText }),
      closeBtn
    ]),
    h('div', { class: 'sheet__body' }, [contentNode])
  ]);
  const overlay = h('div', { class: 'sheet' }, [panel]);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  const unmodal = modalize(overlay, panel, () => close());
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  function close() {
    unmodal();
    overlay.classList.remove('is-open');
    setTimeout(() => { overlay.remove(); onClose && onClose(); }, 220);
  }
  return { close, panel };
}

/** Promise-based confirm dialog. */
export function confirmDialog(message, { danger = false, okText, cancelText } = {}) {
  return new Promise((resolve) => {
    const okBtn = h('button', { class: 'btn ' + (danger ? 'btn--danger' : 'btn--primary'), onclick: () => done(true) }, [okText || t('common.confirm')]);
    const panel = h('div', { class: 'dialog__panel' }, [
      h('p', { class: 'dialog__msg', text: message }),
      h('div', { class: 'dialog__actions' }, [
        h('button', { class: 'btn btn--ghost', onclick: () => done(false) }, [cancelText || t('common.cancel')]),
        okBtn
      ])
    ]);
    const overlay = h('div', { class: 'dialog' }, [panel]);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    document.body.appendChild(overlay);
    const unmodal = modalize(overlay, panel, () => done(false), okBtn);
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    let settled = false;
    function done(v) {
      if (settled) return; settled = true;
      unmodal();
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 180);
      resolve(v);
    }
  });
}

/** Sentinel resolved by promptDialog when the optional Delete action is used.
 *  Compare by identity: `if (res === PROMPT_DELETE) …`. */
export const PROMPT_DELETE = Object.freeze({ promptDelete: true });

/** Promise-based text/password prompt. Resolves to the string, null (cancel),
 *  or PROMPT_DELETE when `deleteText` is given and that button is pressed.
 *  Pass multiline:true for a textarea (used by notes). value pre-fills it.
 *  Pass type (e.g. 'datetime-local', 'number') for a typed single-line input. */
export function promptDialog(message, { password = false, placeholder = '', value = '', okText, cancelText, multiline = false, type, deleteText } = {}) {
  return new Promise((resolve) => {
    const inputType = password ? 'password' : (type || 'text');
    const input = multiline
      ? h('textarea', { class: 'textarea', placeholder, style: 'margin-bottom:16px' }, [value])
      : h('input', { class: 'input', type: inputType, placeholder, value, style: 'margin-bottom:16px' });
    const panel = h('div', { class: 'dialog__panel' }, [
      h('p', { class: 'dialog__msg', text: message }),
      input,
      h('div', { class: 'dialog__actions' }, [
        // Destructive action lives on the far left, away from the confirm button.
        deleteText ? h('button', { class: 'btn btn--ghost', style: 'color:var(--danger);margin-right:auto', onclick: () => done(PROMPT_DELETE) }, [deleteText]) : null,
        h('button', { class: 'btn btn--ghost', onclick: () => done(null) }, [cancelText || t('common.cancel')]),
        h('button', { class: 'btn btn--primary', onclick: () => done(input.value) }, [okText || t('common.ok')])
      ])
    ]);
    const overlay = h('div', { class: 'dialog' }, [panel]);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) done(input.value); });
    document.body.appendChild(overlay);
    const unmodal = modalize(overlay, panel, () => done(null), input);
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    let settled = false;
    function done(v) {
      if (settled) return; settled = true;
      unmodal();
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 180);
      resolve(v == null ? null : v);
    }
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
        injectExerciseSVG(thumb, ex);
        ul.appendChild(clickable(h('li', {
          class: 'list__item',
          onclick: () => { onPick(ex); close(); }
        }, [
          thumb,
          h('div', { class: 'list__body' }, [
            h('div', { class: 'list__title', text: exName(ex) }),
            h('div', { class: 'list__sub', text: (ex.primary || []).map((mk) => t('muscles.' + mk)).join(', ') })
          ]),
          h('span', { class: 'list__chev' }, [icon('plus', { size: 18 })])
        ])));
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
  const dec = h('button', { type: 'button', 'aria-label': '−', onclick: () => set(get() - step) }, [icon('minus', { size: 22 })]);
  const inc = h('button', { type: 'button', 'aria-label': '+', onclick: () => set(get() + step) }, [icon('plus', { size: 22 })]);
  const el = h('div', { class: 'stepper' }, [dec, input, inc]);
  function get() { const n = parseFloat(input.value); return isNaN(n) ? 0 : n; }
  function set(v) { v = Math.max(min, Math.min(max, Math.round(v / step) * step)); input.value = fmt(v); input.dispatchEvent(new Event('change', { bubbles: true })); }
  return { el, get, set, input };
}

/** Distinguish a quick tap from a long-press on one element (touch + mouse).
 *  Movement beyond a small threshold cancels (so scrolling never triggers). */
export function attachLongPress(el, { onTap, onLongPress, ms = 450 } = {}) {
  let timer = null, longFired = false, sx = 0, sy = 0, moved = false;
  const isFormField = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  // Keyboard access: Enter/Space = tap; the context-menu key (and right-click
  // on non-fields) opens the long-press menu. Form fields keep their native
  // Enter/context-menu behavior — only the pointer long-press applies there.
  if (!isFormField) {
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && onTap) { e.preventDefault(); onTap(); }
      else if (e.key === 'ContextMenu' && onLongPress) { e.preventDefault(); onLongPress(e); }
    });
    if (onLongPress) el.addEventListener('contextmenu', (e) => { e.preventDefault(); onLongPress(e); });
  }
  if (onLongPress) el.setAttribute('aria-haspopup', 'true');
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    longFired = false; moved = false; sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => {
      longFired = true;
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) { /* ignore */ } }
      onLongPress && onLongPress(e);
    }, ms);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', cancel, { once: true });
  });
  function onMove(e) { if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) { moved = true; clearTimeout(timer); } }
  function onUp() { window.removeEventListener('pointermove', onMove); clearTimeout(timer); if (!longFired && !moved) onTap && onTap(); }
  function cancel() { window.removeEventListener('pointermove', onMove); clearTimeout(timer); }
}

/** Small floating menu anchored near an element. items: [{label,color,active,onClick}].
 *  opts.grid lays items out as wrapping pills (used by the rep chooser). */
export function popoverMenu(anchorEl, items, { title = '', grid = false } = {}) {
  const menu = h('div', { class: 'popover' + (grid ? ' popover--grid' : ''), role: 'menu', 'aria-label': title || undefined },
    (title ? [h('div', { class: 'popover__title', text: title })] : []).concat(
      items.map((it) => h('button', {
        class: 'popover__item' + (it.active ? ' is-active' : ''),
        role: 'menuitem',
        style: it.color ? `--swatch:${it.color}` : null,
        onclick: () => { close(); it.onClick && it.onClick(); }
      }, [it.color ? h('span', { class: 'popover__dot' }) : null, it.label]))
    ));
  const overlay = h('div', { class: 'popover-overlay' }, [menu]);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });
  const prevFocus = document.activeElement;
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  const firstItem = menu.querySelector('.popover__item');
  if (firstItem) setTimeout(() => { try { firstItem.focus(); } catch (_) { /* ignore */ } }, 30);
  // Position: prefer above the anchor; flip below if not enough room. Clamp to viewport.
  const r = anchorEl.getBoundingClientRect();
  const mr = menu.getBoundingClientRect();
  let top = r.top - mr.height - 8;
  if (top < 8) top = Math.min(window.innerHeight - mr.height - 8, r.bottom + 8);
  let left = r.left + r.width / 2 - mr.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - mr.width - 8));
  menu.style.top = Math.max(8, top) + 'px';
  menu.style.left = left + 'px';
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 150);
    if (prevFocus && prevFocus.focus && document.contains(prevFocus)) { try { prevFocus.focus(); } catch (_) { /* ignore */ } }
  }
  return { close };
}

/** Rep-count chooser popover. Options come from Profile → Rep presets.
 *  (No "custom" entry — long-press the field to type any value.) */
export function repChooser(anchorEl, current, onPick) {
  const items = repPresets().map((v) => ({ label: String(v), active: v === current, onClick: () => onPick(v) }));
  popoverMenu(anchorEl, items, { title: t('common.reps'), grid: true });
}

/** Quick weight chooser popover: values around `base` in `step` increments
 *  (or the first few multiples of `step` when there's nothing to anchor to).
 *  `title` lets the caller add context — the session view puts the barbell
 *  per-side plate breakdown there. */
export function weightChooser(anchorEl, base, step, onPick, { title } = {}) {
  const st = step > 0 ? step : 2.5;
  const round2 = (n) => Math.round(n * 100) / 100;
  const vals = [];
  if (base > 0) {
    for (let k = -3; k <= 3; k++) { const v = round2(base + k * st); if (v > 0) vals.push(v); }
  } else {
    for (let k = 1; k <= 8; k++) vals.push(round2(k * st));
  }
  const items = vals.map((v) => ({ label: String(v), active: v === base, onClick: () => onPick(v) }));
  popoverMenu(anchorEl, items, { title: title || `${t('common.weight')} (${t('units.kg')})`, grid: true });
}

/** Effort swatches, shared by the set runner, the effort menu and the stats charts. */
export const EFFORT_COLORS = Object.freeze({ 1: 'var(--success)', 2: '#f0b429', 3: 'var(--danger)' });
const EFFORT_LABEL_KEY = { 1: 'session.effortEasy', 2: 'session.effortMedium', 3: 'session.effortHard' };

/**
 * "Set in progress" panel — opened by tapping a pending set's done control.
 * Runs a stopwatch (so the set's real duration is recorded), offers a ±
 * adjuster for the set's value, and is closed by one of three effort buttons
 * (which finish the set) or cancel (which changes nothing).
 *
 * For metric 'time' the stopwatch *is* the value, so the ± row is hidden.
 *
 * onFinish({ effort, value, durationMs, startedAt }) — value is null when timed.
 */
export function setRunner({ title = '', metric = 'reps', value = null, step = 1, min = 0, max = 9999, decimals = 0, unitLabel = '', onFinish, onCancel } = {}) {
  const timed = metric === 'time';
  const startedAt = new Date();
  let val = Number.isFinite(value) ? value : 0;
  let settled = false;

  const fmtVal = (v) => (decimals ? Number(v).toFixed(decimals) : String(v));
  const clock = h('div', { class: 'runner__clock', role: 'timer', text: '0:00' });
  const valEl = h('div', { class: 'runner__value', text: fmtVal(val), 'aria-live': 'polite' });
  const bump = (d) => {
    val = Math.min(max, Math.max(min, Math.round((val + d * step) * 100) / 100));
    valEl.textContent = fmtVal(val);
  };
  // ± with hold-to-repeat (accelerating): getting from 0 to 120 stairs one tap
  // at a time would be unusable.
  const stoppers = [];
  const adj = (label, d) => {
    const btn = h('button', { class: 'runner__adj', type: 'button', 'aria-label': label }, [icon(d < 0 ? 'minus' : 'plus', { size: 26 })]);
    let rep = null, viaPointer = false;
    const stop = () => { if (rep) { clearTimeout(rep); clearInterval(rep); rep = null; } };
    stoppers.push(stop);
    btn.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      viaPointer = true; bump(d);
      rep = setTimeout(() => {
        let n = 0;
        rep = setInterval(() => { bump(d); if (++n === 8) { stop(); rep = setInterval(() => bump(d), 45); } }, 110);
      }, 400);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, stop));
    // Keyboard activation fires click without any pointer sequence.
    btn.addEventListener('click', () => { if (viaPointer) { viaPointer = false; return; } bump(d); });
    return btn;
  };

  const effortBtn = (e) => h('div', { class: 'runner__act' }, [
    h('button', {
      class: 'runner__circle runner__circle--eff', type: 'button', style: `--swatch:${EFFORT_COLORS[e]}`,
      'aria-label': t(EFFORT_LABEL_KEY[e]), onclick: () => finish(e)
    }, [icon('check', { size: 26 })]),
    h('span', { class: 'runner__act-label', text: t(EFFORT_LABEL_KEY[e]) })
  ]);

  const panel = h('div', { class: 'runner__panel', 'aria-label': title || t('session.setRunning') }, [
    h('div', { class: 'runner__title', text: title || t('session.setRunning') }),
    clock,
    timed
      ? h('div', { class: 'runner__unit', text: t('session.timeAutoHint') })
      : h('div', {}, [
          h('div', { class: 'runner__row' }, [adj('−', -1), valEl, adj('+', 1)]),
          h('div', { class: 'runner__unit', text: unitLabel })
        ]),
    h('div', { class: 'runner__hint', text: t('session.finishWithEffort') }),
    h('div', { class: 'runner__actions' }, [
      effortBtn(1), effortBtn(2), effortBtn(3),
      h('div', { class: 'runner__act' }, [
        h('button', { class: 'runner__circle runner__circle--cancel', type: 'button', 'aria-label': t('common.cancel'), onclick: () => cancel() }, [icon('x', { size: 26 })]),
        h('span', { class: 'runner__act-label', text: t('common.cancel') })
      ])
    ])
  ]);
  const overlay = h('div', { class: 'runner' }, [panel]);
  // Backdrop tap cancels — but only when the gesture *started* on the backdrop.
  // A finger sliding off a held ± button must not discard the set.
  let downOnBackdrop = false;
  overlay.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === overlay; });
  overlay.addEventListener('click', (e) => { if (downOnBackdrop && e.target === overlay) cancel(); });
  document.body.appendChild(overlay);
  const unmodal = modalize(overlay, panel, () => cancel());
  requestAnimationFrame(() => overlay.classList.add('is-open'));

  const tick = () => { clock.textContent = fmtDuration(Date.now() - startedAt.getTime()); };
  const int = setInterval(tick, 200);
  tick();
  // A navigation (hardware back) while the panel is open must not leave the
  // interval running against a detached node.
  const onRoute = () => cancel();
  window.addEventListener('route:change', onRoute);

  function teardown() {
    clearInterval(int);
    stoppers.forEach((fn) => fn());
    window.removeEventListener('route:change', onRoute);
    unmodal();
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 180);
  }
  function finish(effort) {
    if (settled) return; settled = true;
    const durationMs = Date.now() - startedAt.getTime();
    teardown();
    onFinish && onFinish({ effort, value: timed ? null : val, durationMs, startedAt: startedAt.toISOString() });
  }
  function cancel() {
    if (settled) return; settled = true;
    teardown();
    onCancel && onCancel();
  }
  return { close: cancel };
}

/** Bar-weight chooser popover — pick from the configured barbell weights only
 *  (no free-text entry; custom values are managed in Profile → settings). */
export function barChooser(anchorEl, current, weights, onPick) {
  const items = (weights || []).map((w) => ({ label: String(w), active: w === current, onClick: () => onPick(w) }));
  popoverMenu(anchorEl, items, { title: t('session.barWeight'), grid: true });
}

/** Swipe a row to the right past a threshold to delete it. Ignores gestures that
 *  begin on interactive controls and vertical scrolls. isEnabled() gates it. */
export function attachSwipeToDelete(rowEl, { onDelete, isEnabled } = {}) {
  let startX = 0, startY = 0, dragging = false, decided = false, horiz = false, w = 0;
  rowEl.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    if (isEnabled && !isEnabled()) return;
    if (e.target.closest('input,textarea,select,button,a')) return;
    startX = e.clientX; startY = e.clientY; w = rowEl.offsetWidth || 300;
    dragging = true; decided = false; horiz = false;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
  });
  function onMove(e) {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!decided) { if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return; decided = true; horiz = Math.abs(dx) > Math.abs(dy); }
    if (!horiz || dx < 0) return;
    rowEl.style.transition = 'none';
    rowEl.style.transform = `translateX(${dx}px)`;
    rowEl.style.opacity = String(Math.max(0.25, 1 - dx / w));
    rowEl.classList.add('is-swiping');
  }
  function onUp(e) {
    window.removeEventListener('pointermove', onMove);
    if (!dragging) return; dragging = false;
    const dx = (e.clientX || startX) - startX;
    rowEl.style.transition = '';
    rowEl.classList.remove('is-swiping');
    if (horiz && dx > w * 0.45) {
      rowEl.style.transform = `translateX(${w}px)`; rowEl.style.opacity = '0';
      setTimeout(() => onDelete && onDelete(), 160);
    } else {
      rowEl.style.transform = ''; rowEl.style.opacity = '';
    }
  }
}

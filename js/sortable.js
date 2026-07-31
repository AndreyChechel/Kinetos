// Minimal drag-to-reorder for a list of sibling elements, driven by a drag
// handle inside each item. Works with mouse, touch and pen via Pointer Events.
// The dragged item is lifted (position:fixed) and follows the pointer while a
// placeholder marks the drop slot; on release onReorder(from, to) fires so the
// caller can mutate its data and re-render.
//
// Two ways to start a drag:
//   - default: a small movement threshold must be crossed, so a plain tap/click
//     on the handle still behaves normally (e.g. a handle that is also a link
//     can navigate on tap and reorder on drag).
//   - holdMs > 0: press and hold the handle to arm the drag (with a haptic tick),
//     then move. Movement before the hold elapses cancels, so a handle that is
//     also a tap target stays comfortable to use.

export function makeSortable(listEl, { handle = '.drag-handle', onReorder, threshold = 6, holdMs = 0 } = {}) {
  if (!listEl) return () => {};
  let state = null;    // active drag (past the threshold / armed by hold)
  let pending = null;  // pointer is down on a handle but drag not yet started
  let holdTimer = null;

  function onDown(e) {
    if (e.button > 0) return;
    const hdl = e.target.closest(handle);
    if (!hdl || !listEl.contains(hdl)) return;
    const el = Array.from(listEl.children).find((c) => c.contains(hdl));
    if (!el) return;
    pending = { el, startX: e.clientX, startY: e.clientY };
    if (holdMs > 0) {
      const y = e.clientY;
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (!pending || state) return;
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) { /* ignore */ } }
        begin(pending.el, y);
      }, holdMs);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  function begin(el, clientY) {
    const rect = el.getBoundingClientRect();
    const placeholder = document.createElement(el.tagName);
    placeholder.className = 'sortable-placeholder';
    placeholder.style.height = rect.height + 'px';
    const fromIndex = Array.from(listEl.children).indexOf(el);
    el.classList.add('is-dragging');
    el.style.width = rect.width + 'px';
    el.style.position = 'fixed';
    el.style.left = rect.left + 'px';
    el.style.top = rect.top + 'px';
    el.style.zIndex = '1000';
    el.style.pointerEvents = 'none';
    listEl.insertBefore(placeholder, el.nextSibling);
    state = { el, placeholder, fromIndex, offsetY: clientY - rect.top };
  }

  function onMove(e) {
    if (!state) {
      if (!pending) return;
      const still = Math.abs(e.clientX - pending.startX) < threshold && Math.abs(e.clientY - pending.startY) < threshold;
      if (holdMs > 0) {
        // Waiting on the hold: any real movement means the user meant to scroll.
        if (!still) onCancel();
        return;
      }
      if (still) return;
      begin(pending.el, e.clientY);
    }
    e.preventDefault();
    state.el.style.top = (e.clientY - state.offsetY) + 'px';
    const sibs = Array.from(listEl.children).filter((c) => c !== state.el && c !== state.placeholder);
    let placed = false;
    for (const sib of sibs) {
      const r = sib.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { listEl.insertBefore(state.placeholder, sib); placed = true; break; }
    }
    if (!placed) listEl.appendChild(state.placeholder);
  }

  function unlift() {
    const { el } = state;
    el.classList.remove('is-dragging');
    el.style.width = el.style.position = el.style.left = el.style.top = el.style.zIndex = el.style.pointerEvents = '';
  }

  function onUp() {
    if (state) {
      const { el, placeholder, fromIndex } = state;
      unlift();
      listEl.insertBefore(el, placeholder);
      const finalItems = Array.from(listEl.children).filter((c) => c !== placeholder);
      const toIndex = finalItems.indexOf(el);
      placeholder.remove();
      state = null;
      // The handle often doubles as a tap target (the session view opens the
      // exercise on tap) — don't let the drag's pointerup turn into a click.
      swallowNextClick();
      if (toIndex !== fromIndex && typeof onReorder === 'function') onReorder(fromIndex, toIndex);
    }
    cleanup();
  }

  function onCancel() {
    if (state) {
      const { el, placeholder } = state;
      unlift();
      listEl.insertBefore(el, placeholder);
      placeholder.remove();
      state = null;
      swallowNextClick();
    }
    cleanup();
  }

  function cleanup() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    pending = null;
  }

  // A press-and-hold on a handle otherwise pops the OS text-selection / "Search"
  // menu on mobile, which hijacks the gesture. Swallow the context menu when it
  // originates on a handle so the hold can arm a drag instead.
  function onContext(e) {
    const hdl = e.target.closest(handle);
    if (hdl && listEl.contains(hdl)) e.preventDefault();
  }

  listEl.addEventListener('pointerdown', onDown);
  listEl.addEventListener('contextmenu', onContext);
  return () => { cleanup(); listEl.removeEventListener('pointerdown', onDown); listEl.removeEventListener('contextmenu', onContext); };
}

/** Eat the click that a finished drag would otherwise synthesise on the handle. */
function swallowNextClick() {
  const kill = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
  window.addEventListener('click', kill, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', kill, { capture: true }), 350);
}

// Minimal drag-to-reorder for a list of sibling elements, driven by a drag
// handle inside each item. Works with mouse, touch and pen via Pointer Events.
// The dragged item is lifted (position:fixed) and follows the pointer while a
// placeholder marks the drop slot; on release onReorder(from, to) fires so the
// caller can mutate its data and re-render.
//
// A small movement threshold must be crossed before a drag begins, so a plain
// tap/click on the handle still behaves normally (e.g. a handle that is also a
// link can navigate on tap and reorder on drag).

export function makeSortable(listEl, { handle = '.drag-handle', onReorder, threshold = 6 } = {}) {
  if (!listEl) return () => {};
  let state = null;    // active drag (past the threshold)
  let pending = null;  // pointer is down on a handle but drag not yet started

  function onDown(e) {
    if (e.button > 0) return;
    const hdl = e.target.closest(handle);
    if (!hdl || !listEl.contains(hdl)) return;
    const el = Array.from(listEl.children).find((c) => c.contains(hdl));
    if (!el) return;
    pending = { el, startX: e.clientX, startY: e.clientY };
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
      if (Math.abs(e.clientX - pending.startX) < threshold && Math.abs(e.clientY - pending.startY) < threshold) return;
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
    }
    cleanup();
  }

  function cleanup() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    pending = null;
  }

  listEl.addEventListener('pointerdown', onDown);
  return () => listEl.removeEventListener('pointerdown', onDown);
}

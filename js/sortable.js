// Minimal drag-to-reorder for a list of sibling elements, driven by a drag
// handle inside each item. Works with mouse, touch and pen via Pointer Events.
// The dragged item is lifted (position:fixed) and follows the pointer while a
// placeholder marks the drop slot; on release onReorder(from, to) fires so the
// caller can mutate its data and re-render.

export function makeSortable(listEl, { handle = '.drag-handle', onReorder } = {}) {
  if (!listEl) return () => {};
  let state = null;

  function onDown(e) {
    if (e.button > 0) return;
    const hdl = e.target.closest(handle);
    if (!hdl || !listEl.contains(hdl)) return;
    const el = Array.from(listEl.children).find((c) => c.contains(hdl));
    if (!el) return;
    e.preventDefault();
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

    state = { el, placeholder, fromIndex, offsetY: e.clientY - rect.top };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
  }

  function onMove(e) {
    if (!state) return;
    state.el.style.top = (e.clientY - state.offsetY) + 'px';
    const sibs = Array.from(listEl.children).filter((c) => c !== state.el && c !== state.placeholder);
    let placed = false;
    for (const sib of sibs) {
      const r = sib.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { listEl.insertBefore(state.placeholder, sib); placed = true; break; }
    }
    if (!placed) listEl.appendChild(state.placeholder);
  }

  function onUp() {
    if (!state) return;
    window.removeEventListener('pointermove', onMove);
    const { el, placeholder, fromIndex } = state;
    el.classList.remove('is-dragging');
    el.style.width = el.style.position = el.style.left = el.style.top = el.style.zIndex = el.style.pointerEvents = '';
    listEl.insertBefore(el, placeholder);
    const finalItems = Array.from(listEl.children).filter((c) => c !== placeholder);
    const toIndex = finalItems.indexOf(el);
    placeholder.remove();
    state = null;
    if (toIndex !== fromIndex && typeof onReorder === 'function') onReorder(fromIndex, toIndex);
  }

  listEl.addEventListener('pointerdown', onDown);
  return () => listEl.removeEventListener('pointerdown', onDown);
}

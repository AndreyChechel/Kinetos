// Shared editor for a list of {exerciseId, targetSets, targetReps, targetWeightKg}
// rows — used by both the Template editor and the scheduled-session (plan) editor.
// Provides steppers, a long-press rep chooser, drag-to-reorder and remove.
import { h } from './ui.js';
import { t } from './i18n.js';
import { getExercise, exName, isPerDumbbell } from './data/db.js';
import { injectExerciseSVG } from './svg.js';
import { stepper, repChooser, attachLongPress } from './components.js';
import { makeSortable } from './sortable.js';
import { icon } from './icons.js';

const DEFAULT_REPS = 12;

export function newTarget(ex) {
  return { exerciseId: ex.id, targetSets: 3, targetReps: ex.metric === 'reps' ? DEFAULT_REPS : null, targetWeightKg: null };
}

/** Render editable exercise rows into `wrap`. onChange() is called after any edit
 *  that mutates `list` (reorder/remove) so the caller can re-render + persist. */
export function renderExerciseTargets(wrap, list, { onChange, emptyText } = {}) {
  wrap.innerHTML = '';
  if (!list.length) {
    wrap.appendChild(h('div', { class: 'card center muted', text: emptyText || t('plan.noExercises') }));
    return;
  }
  list.forEach((pe, idx) => {
    const ex = getExercise(pe.exerciseId);
    if (!ex) return;
    const thumb = h('div', { class: 'list__thumb' });
    injectExerciseSVG(thumb, ex);
    const sets = stepper(pe.targetSets ?? 3, { min: 1, max: 20 });
    const reps = stepper(pe.targetReps ?? DEFAULT_REPS, { min: 0, max: 100 });
    const weight = stepper(pe.targetWeightKg ?? 0, { min: 0, max: 500, step: 2.5, decimals: 1 });
    sets.input.addEventListener('change', () => { pe.targetSets = sets.get(); });
    reps.input.addEventListener('change', () => { pe.targetReps = reps.get(); });
    weight.input.addEventListener('change', () => { pe.targetWeightKg = weight.get(); });
    // Long-press the reps field for the 6/8/10/12/15/custom chooser.
    if (ex.metric === 'reps') attachLongPress(reps.input, { onLongPress: () => repChooser(reps.input, reps.get(), (v) => reps.set(v)) });

    let fields;
    if (ex.metric === 'reps') {
      const weightField = labeled(t('plan.targetWeight') + ' (' + t('units.kg') + ')' + (isPerDumbbell(ex) ? ' · 2×' : ''), weight.el);
      weightField.classList.add('target-fields__wide');
      fields = h('div', { class: 'target-fields' }, [
        labeled(t('plan.targetSets'), sets.el),
        labeled(t('plan.targetReps'), reps.el),
        weightField
      ]);
    } else {
      const setsField = labeled(t('plan.targetSets'), sets.el);
      setsField.classList.add('target-fields__wide');
      fields = h('div', { class: 'target-fields' }, [setsField]);
    }

    const card = h('div', { class: 'card', dataset: { idx } }, [
      h('div', { class: 'row', style: 'margin-bottom:10px' }, [
        h('span', { class: 'drag-handle', 'aria-label': t('common.reorder'), title: t('common.reorder') }, [icon('grip', { size: 18 })]),
        thumb,
        h('div', { class: 'list__body' }, [h('div', { class: 'list__title', text: exName(ex) })]),
        h('button', { class: 'btn btn--icon btn--ghost', 'aria-label': t('common.remove'),
          onclick: () => { list.splice(idx, 1); onChange && onChange(); } }, [icon('trash', { size: 18 })])
      ]),
      fields
    ]);
    wrap.appendChild(card);
  });

  makeSortable(wrap, {
    handle: '.drag-handle',
    onReorder: (from, to) => { const [it] = list.splice(from, 1); list.splice(to, 0, it); onChange && onChange(); }
  });
}

export function labeled(label, node) {
  return h('label', { class: 'field', style: 'flex:1' }, [
    h('span', { text: label, style: 'display:block;font-size:.8rem;font-weight:600;color:var(--text-muted);margin-bottom:5px' }),
    node
  ]);
}

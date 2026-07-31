// Shared editor for a list of plan/template exercise target rows — used by both
// the Template editor and the scheduled-session (plan) editor.
//
// Two row shapes (model + invariants live in workout.js):
//   simple    one set of numbers for the whole exercise (the default)
//   detailed  one row per set — reps/weight (or seconds/km/count), a rest
//             override and a short cue, each prescribed individually
// The mode is per exercise, so a plan can pyramid the squat and keep the
// accessories simple. Provides steppers, a long-press rep chooser,
// drag-to-reorder of exercises and remove.
import { h } from './ui.js';
import { t } from './i18n.js';
import { getExercise, exName, isPerDumbbell, countUnit } from './data/db.js';
import { injectExerciseSVG } from './svg.js';
import { stepper, repChooser, attachLongPress, promptDialog, PROMPT_DELETE } from './components.js';
import { weightStepFor } from './suggest.js';
import { makeSortable } from './sortable.js';
import { icon } from './icons.js';
import {
  MAX_SET_TARGETS, isDetailedTarget, newSetTarget, syncTargetRow,
  toDetailedTarget, toSimpleTarget
} from './workout.js';

const DEFAULT_REPS = 12;
const MAX_SECONDS = 7200;
const MAX_MINUTES = 1440;
const MAX_COUNT = 99999;
const MAX_REST = 3600;

export function newTarget(ex) {
  return { exerciseId: ex.id, targetSets: 3, targetReps: ex.metric === 'reps' ? DEFAULT_REPS : null, targetWeightKg: null };
}

/** Render editable exercise rows into `wrap`. onChange() is called after any edit
 *  that changes the *structure* of `list` (reorder, remove, per-set add/remove,
 *  mode switch, note) so the caller can re-render + persist. Plain value edits
 *  mutate in place on `change` and deliberately do not re-render — that would
 *  drop focus mid-typing. */
export function renderExerciseTargets(wrap, list, { onChange, emptyText } = {}) {
  // Tear down the previous drag listener: `wrap` survives re-renders, and each
  // stacked listener would fire its own onReorder for a single drag, splicing
  // the list N times and silently scrambling the exercise order.
  if (wrap._unsort) { wrap._unsort(); wrap._unsort = null; }
  wrap.innerHTML = '';
  if (!list.length) {
    wrap.appendChild(h('div', { class: 'card center muted', text: emptyText || t('plan.noExercises') }));
    return;
  }
  const changed = () => { onChange && onChange(); };

  list.forEach((pe, idx) => {
    const ex = getExercise(pe.exerciseId);
    if (!ex) return;
    const detailed = isDetailedTarget(pe);
    const thumb = h('div', { class: 'list__thumb' });
    injectExerciseSVG(thumb, ex);

    // Icon button (was a text button) so the exercise title gets the space back.
    const modeBtn = h('button', {
      class: 'btn btn--icon' + (detailed ? ' btn--on' : ' btn--ghost'),
      'aria-pressed': detailed ? 'true' : 'false',
      'aria-label': t('plan.perSet'),
      title: t('plan.perSet') + ' · ' + t('plan.perSetHint'),
      onclick: () => {
        if (detailed) toSimpleTarget(pe, ex.metric); else toDetailedTarget(pe, ex.metric);
        changed();
      }
    }, [icon('sliders', { size: 18 })]);

    const card = h('div', { class: 'card', dataset: { idx } }, [
      h('div', { class: 'row', style: 'margin-bottom:10px' }, [
        h('span', { class: 'drag-handle', 'aria-label': t('common.reorder'), title: t('common.reorder') }, [icon('grip', { size: 18 })]),
        thumb,
        h('div', { class: 'list__body' }, [h('div', { class: 'list__title', text: exName(ex) })]),
        modeBtn,
        h('button', { class: 'btn btn--icon btn--ghost', 'aria-label': t('common.remove'),
          onclick: () => { list.splice(idx, 1); changed(); } }, [icon('trash', { size: 18 })])
      ]),
      detailed ? detailedBody(pe, ex, changed) : simpleFields(pe, ex)
    ]);
    wrap.appendChild(card);
  });

  wrap._unsort = makeSortable(wrap, {
    handle: '.drag-handle',
    onReorder: (from, to) => { const [it] = list.splice(from, 1); list.splice(to, 0, it); changed(); }
  });
}

// ------------------------------------------------------------ simple mode ----

function simpleFields(pe, ex) {
  const sets = stepper(pe.targetSets ?? 3, { min: 1, max: MAX_SET_TARGETS });
  sets.input.addEventListener('change', () => { pe.targetSets = sets.get(); });
  if (ex.metric !== 'reps') {
    const setsField = labeled(t('plan.targetSets'), sets.el);
    setsField.classList.add('target-fields__wide');
    return h('div', { class: 'target-fields' }, [setsField]);
  }
  const reps = stepper(pe.targetReps ?? DEFAULT_REPS, { min: 0, max: 100 });
  const weight = weightStepper(pe.targetWeightKg, ex);
  // 0 = "not prescribed" -> null, the same convention as the per-set fields.
  reps.input.addEventListener('change', () => { pe.targetReps = reps.get() || null; });
  weight.input.addEventListener('change', () => { pe.targetWeightKg = weight.get() || null; });
  // Long-press the reps field for the 6/8/10/12/15/custom chooser.
  attachLongPress(reps.input, { onLongPress: () => repChooser(reps.input, reps.get(), (v) => reps.set(v)) });

  const weightField = labeled(weightLabel(ex), weight.el);
  weightField.classList.add('target-fields__wide');
  return h('div', { class: 'target-fields' }, [
    labeled(t('plan.targetSets'), sets.el),
    labeled(t('plan.targetReps'), reps.el),
    weightField
  ]);
}

// ---------------------------------------------------------- detailed mode ----

function detailedBody(pe, ex, changed) {
  const host = h('div', { class: 'set-targets' });
  pe.setTargets.forEach((st, si) => host.appendChild(setTargetRow(pe, ex, st, si, changed)));
  host.appendChild(h('button', {
    class: 'btn btn--sm btn--block',
    disabled: pe.setTargets.length >= MAX_SET_TARGETS ? true : null,
    onclick: () => {
      pe.setTargets.push(newSetTarget(ex.metric, pe.setTargets[pe.setTargets.length - 1]));
      syncTargetRow(pe, ex.metric);
      changed();
    }
  }, [icon('plus', { size: 16 }), ' ' + t('plan.addSet')]));
  return host;
}

function setTargetRow(pe, ex, st, si, changed) {
  const fields = h('div', { class: 'target-fields' });
  // A stepper bound to one field of `st`. 0 means "not prescribed" -> null, so a
  // blank target never turns into a literal 0 kg / 0 s in the session. Every edit
  // re-syncs the row: the mirrored scalars are what older builds and any
  // setTargets-unaware reader see, so they must not go stale mid-edit.
  const bind = (label, key, opts) => {
    const sp = stepper(st[key] ?? 0, opts);
    sp.input.addEventListener('change', () => { st[key] = sp.get() || null; syncTargetRow(pe, ex.metric); });
    fields.appendChild(labeled(label, sp.el));
    return sp;
  };

  if (ex.metric === 'reps') {
    const reps = bind(t('plan.targetReps'), 'reps', { min: 0, max: 200 });
    attachLongPress(reps.input, { onLongPress: () => repChooser(reps.input, reps.get(), (v) => reps.set(v)) });
    const step = weightStepFor(ex);
    bind(weightLabel(ex), 'weightKg', { min: 0, max: 500, step, decimals: step % 1 ? 1 : 0 });
  } else if (ex.metric === 'time') {
    bind(t('common.sec'), 'seconds', { min: 0, max: MAX_SECONDS, step: 5 });
  } else if (ex.metric === 'distance') {
    bind(t('units.km'), 'distanceKm', { min: 0, max: 500, step: 0.5, decimals: 1 });
    bind(t('common.min'), 'minutes', { min: 0, max: MAX_MINUTES, step: 1 });
  } else {
    bind(countUnit(ex), 'count', { min: 0, max: MAX_COUNT, step: 5 });
  }
  // Rest AFTER this set; 0 falls back to the profile's rest timer.
  const restField = bind(t('plan.setRest') + ' (' + t('common.sec') + ')', 'restSeconds', { min: 0, max: MAX_REST, step: 5 });
  restField.input.title = t('plan.restDefault');

  const noteBtn = h('button', {
    class: 'btn btn--icon btn--ghost btn--sm' + (st.note ? ' btn--note-on' : ''),
    'aria-label': t('plan.setNote'), title: st.note || t('plan.setNote'),
    onclick: () => editSetNote(st, changed)
  }, [icon('note', { size: 16 })]);

  return h('div', { class: 'set-target' }, [
    h('div', { class: 'row', style: 'gap:6px;margin-bottom:6px' }, [
      h('span', { class: 'set__n', text: String(si + 1) }),
      h('div', { class: 'list__body' }, [st.note ? h('div', { class: 'small muted set-target__note', text: st.note }) : null]),
      noteBtn,
      h('button', {
        class: 'btn btn--icon btn--ghost btn--sm', 'aria-label': t('common.remove'),
        // The last set can't be removed — an empty setTargets would silently
        // drop the row back to simple mode on the next sync.
        disabled: pe.setTargets.length <= 1 ? true : null,
        onclick: () => { pe.setTargets.splice(si, 1); syncTargetRow(pe, ex.metric); changed(); }
      }, [icon('trash', { size: 16 })])
    ]),
    fields
  ]);
}

async function editSetNote(st, changed) {
  const had = !!st.note;
  const res = await promptDialog(t('plan.setNote'), {
    multiline: true, value: st.note || '', placeholder: t('exercises.notePlaceholder'),
    deleteText: had ? t('common.delete') : undefined
  });
  if (res == null) return;
  st.note = res === PROMPT_DELETE ? '' : String(res).trim();
  changed();
}

// ----------------------------------------------------------------- shared ----

function weightLabel(ex) {
  return t('plan.targetWeight') + ' (' + t('units.kg') + ')' + (isPerDumbbell(ex) ? ' · 2×' : '');
}

function weightStepper(value, ex) {
  const step = weightStepFor(ex);
  return stepper(value ?? 0, { min: 0, max: 500, step, decimals: step % 1 ? 1 : 0 });
}

export function labeled(label, node) {
  return h('label', { class: 'field', style: 'flex:1' }, [
    h('span', { text: label, style: 'display:block;font-size:.8rem;font-weight:600;color:var(--text-muted);margin-bottom:5px' }),
    node
  ]);
}

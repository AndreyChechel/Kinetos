// Profile: personal data, auto-calculated metrics, settings, data export/import.
import { h, toast } from '../ui.js';
import { t, getLang, SUPPORTED } from '../i18n.js';
import { getProfile, setProfile, getSettings, setSettings, exportJSON, importJSON, resetAll } from '../store.js';
import { completedSessions } from '../workout.js';
import { getExercise, exName } from '../data/db.js';
import { buildPrompt, getPromptOptions, defaultUserMessage, describeExample, parseSessions, importSessions, plansOnDate } from '../aiplan.js';
import { age, maxHR, hrZones, bmi, bodyFat, bmr, tdee } from '../calc.js';
import { sheet, confirmDialog } from '../components.js';
import { applyTheme, changeLanguage } from '../app.js';
import { canInstall, onInstallAvailability, promptInstall } from '../pwa.js';
import * as sync from '../sync/manager.js';
import { SYNC } from '../config.js';
import { fmtDate, fmtTime } from '../ui.js';
import { APP_VERSION } from '../version.js';
import { icon } from '../icons.js';

const ZONE_COLORS = ['#4b9cff', '#23a55a', '#f0b429', '#f5871f', '#e5484d'];

export default function renderProfile(root, params, ctx) {
  const p = getProfile();
  const st = getSettings();
  const lang = getLang();

  // ---------- Profile photo + identity ----------
  const avatar = h('div', { class: 'avatar' });
  renderAvatar();
  function renderAvatar() {
    avatar.innerHTML = '';
    if (p.photo) avatar.appendChild(h('img', { src: p.photo, alt: '', style: 'width:100%;height:100%;object-fit:cover' }));
    else if (p.name) avatar.textContent = p.name.slice(0, 1).toUpperCase();
    else avatar.appendChild(icon('user', { size: 40 }));
  }
  const photoInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  photoInput.addEventListener('change', async () => {
    const f = photoInput.files[0]; if (!f) return;
    try { const url = await resizeImage(f, 256); setProfile({ photo: url }); renderAvatar(); toast(t('toast.saved')); }
    catch { toast(t('toast.photoTooBig')); }
  });

  const nameInput = input(p.name, 'text', (v) => setProfile({ name: v }));
  nameInput.setAttribute('placeholder', t('profile.namePlaceholder'));

  root.appendChild(h('div', { class: 'card' }, [
    h('div', { class: 'row', style: 'gap:14px' }, [
      avatar,
      h('div', { style: 'flex:1' }, [
        field(t('common.name'), nameInput),
        h('div', { class: 'row', style: 'gap:8px' }, [
          h('button', { class: 'btn btn--sm', onclick: () => photoInput.click() }, [t('profile.changePhoto')]),
          p.photo ? h('button', { class: 'btn btn--sm btn--ghost', onclick: () => { setProfile({ photo: '' }); renderAvatar(); ctx.navigate('/profile'); } }, [t('profile.removePhoto')]) : null
        ])
      ])
    ]),
    photoInput
  ]));

  // ---------- Body parameters ----------
  const sexSel = select([['male', t('profile.male')], ['female', t('profile.female')]], p.sex, (v) => { setProfile({ sex: v }); renderMetrics(); });
  const birth = input((p.birthdate || '').slice(0, 10), 'date', (v) => { setProfile({ birthdate: v }); renderMetrics(); });
  const height = numField(p.heightCm, (v) => { setProfile({ heightCm: v }); renderMetrics(); }, t('units.cm'));
  const weight = numField(p.weightKg, (v) => { setProfile({ weightKg: v }); renderMetrics(); }, t('units.kg'));
  const rest = numField(p.restingHR, (v) => { setProfile({ restingHR: v }); renderMetrics(); }, t('units.bpm'));
  const activity = select([
    ['sedentary', t('profile.activitySedentary')], ['light', t('profile.activityLight')],
    ['moderate', t('profile.activityModerate')], ['active', t('profile.activityActive')],
    ['very', t('profile.activityVery')]
  ], p.activityLevel, (v) => { setProfile({ activityLevel: v }); renderMetrics(); });

  root.appendChild(h('div', { class: 'card' }, [
    h('div', { class: 'grid2' }, [
      field(t('profile.sex'), sexSel),
      field(t('profile.birthdate'), birth),
      field(t('profile.height') + ' (' + t('units.cm') + ')', height),
      field(t('profile.weight') + ' (' + t('units.kg') + ')', weight),
      field(t('profile.restingHR'), rest),
      field(t('profile.activity'), activity)
    ]),
    h('div', { class: 'small muted', text: t('profile.restingHRHint') })
  ]));

  // ---------- Metrics ----------
  const metricsCard = h('div', { class: 'card' });
  root.appendChild(metricsCard);
  function renderMetrics() {
    const pr = getProfile();
    metricsCard.innerHTML = '';
    metricsCard.appendChild(h('div', { class: 'card__title', text: t('profile.metrics') }));
    const a = age(pr.birthdate);
    if (a == null || !pr.heightCm || !pr.weightKg) {
      metricsCard.appendChild(h('p', { class: 'muted', text: t('profile.fillProfile') }));
      return;
    }
    const mhr = maxHR(a);
    const b = bmi(pr.weightKg, pr.heightCm);
    const bf = bodyFat(pr.weightKg, pr.heightCm, a, pr.sex);
    const bm = bmr(pr.weightKg, pr.heightCm, a, pr.sex);
    const td = tdee(pr.weightKg, pr.heightCm, a, pr.sex, pr.activityLevel);

    metricsCard.appendChild(h('div', { class: 'grid2', style: 'margin-bottom:12px' }, [
      metric(a, t('profile.age')),
      metric(mhr + ' ' + t('units.bpm'), t('profile.maxHR')),
      metric(b.value + ' · ' + t('bmi.' + b.category), t('profile.bmi')),
      metric(bf + ' %', t('profile.bodyFat')),
      metric(bm + ' ' + t('units.kcal'), t('profile.bmr')),
      metric(td + ' ' + t('units.kcal'), t('profile.tdee'))
    ]));

    // HR zones
    const z = hrZones(a, pr.restingHR);
    const names = ['zoneRecovery', 'zoneFatburn', 'zoneAerobic', 'zoneAnaerobic', 'zoneMaximal'];
    metricsCard.appendChild(h('div', { class: 'section-title', style: 'margin-top:0', text: t('profile.hrZones') }));
    metricsCard.appendChild(h('div', { class: 'zones' }, z.zones.map((zone, i) => h('div', { class: 'zone' }, [
      h('span', { style: 'width:90px;flex:none;font-size:.78rem;font-weight:600', text: t('profile.' + names[i]) }),
      h('div', { class: 'zone__bar', style: `background:${ZONE_COLORS[i]}` }),
      h('span', { style: 'width:96px;flex:none;text-align:right;font-size:.78rem', text: `${zone.low}–${zone.high} ${t('units.bpm')}` })
    ]))));
    metricsCard.appendChild(h('div', { class: 'small muted', style: 'margin-top:10px', text: t('calc.disclaimer') }));
  }
  renderMetrics();

  // ---------- Settings ----------
  const langSel = select(SUPPORTED.map((l) => [l.code, l.label]), lang, (v) => { setSettings({ lang: v }); changeLanguage(v); });
  const themeSel = select([['system', t('profile.themeSystem')], ['light', t('profile.themeLight')], ['dark', t('profile.themeDark')]],
    st.theme, (v) => { setSettings({ theme: v }); applyTheme(); });
  const unitSel = select([['metric', t('units.kg') + ' / ' + t('units.cm')]], st.units, () => {});
  const dumbbellSel = select([
    ['single', t('profile.dumbbellSingle')],
    ['pair', t('profile.dumbbellPair')]
  ], st.dumbbellInput || 'single', (v) => setSettings({ dumbbellInput: v }));
  const barbellSel = select([
    ['included', t('profile.barbellIncluded')],
    ['added', t('profile.barbellAdded')]
  ], st.barbellInput || 'included', (v) => { setSettings({ barbellInput: v }); drawBarWeights(); });
  const restInput = h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: '0', step: '5', value: st.restSeconds ?? 90 });
  restInput.addEventListener('change', () => {
    const n = parseInt(restInput.value, 10);
    setSettings({ restSeconds: isNaN(n) || n < 0 ? 0 : n });
    toast(t('toast.saved'));
  });
  const barWeightsHost = h('div', { style: 'margin-top:10px' });
  const platesHost = h('div', { style: 'margin-top:10px' });
  const repPresetsHost = h('div', { style: 'margin-top:10px' });
  root.appendChild(h('div', { class: 'card' }, [
    h('div', { class: 'card__title', text: t('profile.settings') }),
    h('div', { class: 'grid2' }, [
      field(t('profile.language'), langSel),
      field(t('profile.theme'), themeSel),
      field(t('profile.units'), unitSel),
      field(t('profile.dumbbellInput'), dumbbellSel),
      field(t('profile.barbellInput'), barbellSel),
      field(t('profile.restTimer'), restInput)
    ]),
    h('div', { class: 'small muted', text: t('profile.dumbbellHint') }),
    h('div', { class: 'small muted', style: 'margin-top:4px', text: t('profile.barbellHint') }),
    h('div', { class: 'small muted', style: 'margin-top:4px', text: t('profile.restTimerHint') }),
    barWeightsHost,
    platesHost,
    repPresetsHost
  ]));

  /** Editable list of numbers rendered as removable chips + an "add" row.
   *  Shared by bar weights, plate sizes and rep presets. `firstIsDefault`
   *  highlights entry 0 (the bar weights list treats it as the default). */
  function numberListEditor(host, { label, hint, key, unit = '', step = '0.5', placeholder, sort, firstIsDefault = false, fallback = [] }) {
    const draw = () => {
      host.innerHTML = '';
      const raw = getSettings()[key];
      let values = (Array.isArray(raw) && raw.length ? raw : fallback).slice();
      if (sort) values.sort(sort);
      host.appendChild(h('div', { class: 'field__label', style: 'display:block;font-size:.8rem;font-weight:600;color:var(--text-muted);margin-bottom:6px', text: label }));
      const chips = h('div', { class: 'chips' });
      values.forEach((v, i) => {
        const accent = firstIsDefault && i === 0;
        chips.appendChild(h('span', { class: 'tag', style: 'display:inline-flex;align-items:center;gap:6px;padding-right:5px' + (accent ? ';background:color-mix(in srgb, var(--accent) 20%, transparent);color:var(--accent)' : '') }, [
          unit ? v + ' ' + unit : String(v),
          h('button', { class: 'btn btn--icon btn--ghost btn--sm', style: 'width:20px;height:20px;min-height:0;padding:0', 'aria-label': t('common.remove'),
            onclick: () => { setSettings({ [key]: values.filter((_, j) => j !== i) }); draw(); } }, [icon('x', { size: 14 })])
        ]));
      });
      host.appendChild(chips);
      const inp = h('input', { class: 'input', type: 'number', inputmode: 'decimal', step, min: '0', placeholder: placeholder || t('profile.barbellAddWeight'), style: 'flex:1' });
      const add = () => {
        const n = parseFloat(inp.value);
        if (isNaN(n) || n <= 0) return;
        const arr = values.slice();
        if (!arr.includes(n)) arr.push(n);
        setSettings({ [key]: arr }); inp.value = ''; draw();
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      host.appendChild(h('div', { class: 'row', style: 'gap:8px;margin-top:8px' }, [
        inp, h('button', { class: 'btn btn--sm', onclick: add }, [icon('plus', { size: 16 }), ' ' + t('common.add')])
      ]));
      if (hint) host.appendChild(h('div', { class: 'small muted', style: 'margin-top:6px', text: hint }));
    };
    return draw;
  }

  // Bar weights — only relevant in "add bar weight" mode.
  const drawBarWeightList = numberListEditor(barWeightsHost, {
    label: t('profile.barbellWeights'), hint: t('profile.barbellWeightsHint'),
    key: 'barbellWeights', unit: t('units.kg'), step: '0.5', firstIsDefault: true, fallback: [20, 10, 5]
  });
  function drawBarWeights() {
    if ((getSettings().barbellInput || 'included') !== 'added') { barWeightsHost.innerHTML = ''; return; }
    drawBarWeightList();
  }
  drawBarWeights();

  // Available plate sizes (kg) — feeds the per-side plate calculator shown when
  // you tap a barbell weight field during a session.
  numberListEditor(platesHost, {
    label: t('profile.plates'), hint: t('profile.platesHint'),
    key: 'plates', unit: t('units.kg'), step: '0.25', sort: (a, b) => b - a,
    fallback: [25, 20, 15, 10, 5, 2.5, 1.25]
  })();

  // Quick-pick rep counts offered when you tap a set's reps field.
  numberListEditor(repPresetsHost, {
    label: t('profile.repPresets'), hint: t('profile.repPresetsHint'),
    key: 'repPresets', step: '1', placeholder: t('profile.repPresetsAdd'),
    sort: (a, b) => a - b, fallback: [6, 8, 10, 12, 15, 20]
  })();

  // ---------- Cloud sync ----------
  const syncCard = h('div', { class: 'card' });
  root.appendChild(syncCard);
  const unsub = sync.onStatus(() => { if (document.body.contains(syncCard)) renderSync(); });
  // Unsubscribe deterministically when this view unmounts — waiting for a later
  // status event to notice the card is gone leaked a callback per visit.
  window.addEventListener('route:change', function off() {
    unsub();
    window.removeEventListener('route:change', off);
  });
  renderSync();
  function renderSync() {
    const st = sync.getStatus();
    syncCard.innerHTML = '';
    syncCard.appendChild(h('div', { class: 'card__title', text: t('sync.title') }));
    syncCard.appendChild(h('p', { class: 'small muted', style: 'margin-top:-4px', text: t('sync.about') }));

    const provOpts = [['', t('sync.off')]];
    Object.entries(SYNC.providers).forEach(([id, cfg]) => { if (cfg.enabled !== false) provOpts.push([id, cfg.label]); });
    const providerSel = select(provOpts, st.provider,
      (v) => { if (!v) sync.disconnect(); else setSettings({ sync: { provider: v } }); renderSync(); });
    syncCard.appendChild(field(t('sync.provider'), providerSel));

    if (st.provider) {
      if (!st.configured) {
        syncCard.appendChild(h('p', { class: 'small', style: 'color:var(--danger)', text: t('sync.notConfigured') }));
      } else if (!st.connected) {
        syncCard.appendChild(h('button', { class: 'btn btn--primary btn--block', onclick: () => sync.connect(st.provider) }, [t('sync.connect')]));
      } else {
        syncCard.appendChild(h('div', { class: 'row', style: 'gap:8px' }, [
          h('button', { class: 'btn btn--primary', style: 'flex:1', onclick: () => sync.syncNow() }, [icon('refresh', { size: 16 }), ' ' + t('sync.syncNow')]),
          h('button', { class: 'btn', onclick: () => { sync.disconnect(); renderSync(); } }, [t('sync.disconnect')])
        ]));
      }
    }

    const statusText = {
      idle: t('sync.statusIdle'), syncing: t('sync.statusSyncing'), ok: t('sync.statusOk'),
      error: t('sync.statusError'), needsAuth: t('sync.statusNeedsAuth'), offline: t('sync.statusOffline')
    }[st.status] || '';
    const when = st.lastSyncedAt ? (fmtDate(st.lastSyncedAt, lang) + ' ' + fmtTime(st.lastSyncedAt, lang)) : t('sync.never');
    syncCard.appendChild(h('div', { class: 'row row--between small muted', style: 'margin-top:8px' }, [
      h('span', { text: statusText }),
      h('span', { text: t('sync.lastSynced', { when }) })
    ]));
    if (st.status === 'error' && st.message) {
      syncCard.appendChild(h('div', { class: 'small', style: 'color:var(--danger); margin-top:4px; word-break:break-word', text: st.message }));
    }
    if (st.provider && st.configured) {
      syncCard.appendChild(h('div', { class: 'small muted', text: t('sync.auto', { n: SYNC.autoEveryMinutes }) }));
    }
  }

  // ---------- Data ----------
  const dataCard = h('div', { class: 'card' }, [
    h('div', { class: 'card__title', text: t('profile.data') }),
    h('p', { class: 'small muted', text: t('profile.backupReminder') }),
    h('div', { class: 'stack' }, [
      h('button', { class: 'btn btn--primary btn--block', onclick: doExport }, [icon('download', { size: 16 }), ' ' + t('profile.exportData')]),
      h('button', { class: 'btn btn--block', onclick: doExportCSV }, [icon('download', { size: 16 }), ' ' + t('profile.exportCSV')]),
      h('button', { class: 'btn btn--block', onclick: doImport }, [icon('upload', { size: 16 }), ' ' + t('profile.importData')]),
      h('button', { class: 'btn btn--block', onclick: aiPromptSheet }, [icon('clipboard', { size: 16 }), ' ' + t('profile.aiPrompt')]),
      h('button', { class: 'btn btn--block', onclick: () => aiImportSheet(ctx) }, [icon('calendar', { size: 16 }), ' ' + t('profile.aiImport')]),
      h('div', { class: 'small muted', text: t('profile.aiHint') }),
      h('button', { class: 'btn btn--danger btn--block', onclick: doReset }, [t('profile.resetApp')])
    ])
  ]);
  root.appendChild(dataCard);

  // Install button (if available)
  const installBtn = h('button', { class: 'btn btn--block', onclick: async () => { await promptInstall(); } }, [icon('download', { size: 16 }), ' ' + t('profile.install')]);
  const installWrap = h('div', { class: 'card', style: canInstall() ? '' : 'display:none' }, [installBtn]);
  root.appendChild(installWrap);
  const offInstall = onInstallAvailability((ok) => { installWrap.style.display = ok ? '' : 'none'; });
  window.addEventListener('route:change', function off() {
    offInstall();
    window.removeEventListener('route:change', off);
  });

  // About
  root.appendChild(h('div', { class: 'card small muted' }, [
    h('div', { class: 'card__title', text: t('profile.about') }),
    h('p', { style: 'margin:0', text: t('profile.aboutText') }),
    h('p', { class: 'row row--between', style: 'margin:8px 0 0; font-weight:700; color:var(--text)' }, [
      h('span', { text: t('profile.version') }),
      h('span', { text: 'v' + APP_VERSION })
    ])
  ]));

  // ---- data actions ----
  function doExport() {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `kinetos-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t('toast.exported'));
  }
  // Flat one-row-per-set CSV — what people actually want for spreadsheets.
  function doExportCSV() {
    const q = (v) => { v = v == null ? '' : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = [['date', 'session', 'exercise', 'set', 'weightKg', 'barKg', 'reps', 'count', 'seconds', 'distanceKm', 'minutes', 'durationSec', 'effort', 'done']];
    completedSessions().slice().reverse().forEach((s) => {
      (s.entries || []).forEach((e) => {
        const ex = getExercise(e.exerciseId);
        (e.sets || []).forEach((set) => {
          rows.push([
            (s.startedAt || '').slice(0, 10), s.name || '', ex ? exName(ex) : e.exerciseId, set.n,
            set.weightKg ?? '', set.barKg ?? '', set.reps ?? '', set.count ?? '', set.seconds ?? '', set.distanceKm ?? '', set.minutes ?? '',
            set.durationMs > 0 ? Math.round(set.durationMs / 1000) : '', set.effort ?? '', set.done === false ? 0 : 1
          ]);
        });
      });
    });
    const csv = rows.map((r) => r.map(q).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }); // BOM so Excel detects UTF-8
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `kinetos-sets-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t('toast.exported'));
  }
  function doImport() {
    const fi = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
    fi.addEventListener('change', async () => {
      const f = fi.files[0]; if (!f) return;
      const text = await f.text();
      const content = h('div', { class: 'stack' }, [
        h('p', { class: 'muted', text: t('profile.importPrompt') }),
        h('button', { class: 'btn btn--primary btn--block', onclick: () => run(true) }, [t('profile.importMerge')]),
        h('button', { class: 'btn btn--block', onclick: () => run(false) }, [t('profile.importReplace')])
      ]);
      const { close } = sheet(t('profile.importData'), content);
      function run(merge) {
        try {
          importJSON(text, { merge });
          close();
          changeLanguage(getSettings().lang); applyTheme();
          toast(t('toast.imported'));
          ctx.navigate('/profile');
        } catch { toast(t('toast.importError')); }
      }
    });
    fi.click();
  }
  async function doReset() {
    if (await confirmDialog(t('profile.resetConfirm'), { danger: true, okText: t('common.delete') })) {
      resetAll(); applyTheme(); changeLanguage(getSettings().lang); toast(t('toast.deleted')); ctx.navigate('/');
    }
  }
}

// ---- AI planning bridge ----------------------------------------------------
// Two one-way doors: copy a prompt out to any AI agent, paste its JSON answer
// back in as calendar plans. No network, no vendor lock-in.

/** Copy to clipboard with an execCommand fallback (iOS / non-secure origins). */
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch (_) { /* fall through to the legacy path */ }
  try {
    const ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0', 'aria-hidden': 'true' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) { return false; }
}

function aiPromptSheet() {
  const saved = getPromptOptions();
  // 'plan'     = let the agent design the session from recent history.
  // 'describe' = the athlete writes the session out and the agent only transcribes
  //              it into importable JSON. Both prompts carry the same schema,
  //              conventions and exercise catalog, so the import side is unchanged.
  let mode = saved.mode;

  const msg = h('textarea', { class: 'textarea', rows: '4' });
  const desc = h('textarea', { class: 'textarea', rows: '8', placeholder: describeExample() }, [saved.description]);
  const count = h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: '0', max: '100', step: '1', value: String(saved.maxSessions) });

  const preview = h('textarea', { class: 'textarea', rows: '10', readonly: true, style: 'font-family:ui-monospace,monospace;font-size:.72rem' });
  const previewWrap = h('details', {}, [h('summary', { class: 'small muted', style: 'cursor:pointer', text: t('profile.aiPreview') }), preview]);
  const info = h('div', { class: 'small muted' });

  const about = h('p', { class: 'small muted', style: 'margin:0' });
  const msgField = field(t('profile.aiUserMessage'), msg);
  const resetMsg = h('button', { class: 'btn btn--sm btn--ghost', style: 'align-self:flex-start', onclick: () => { msg.value = defaultUserMessage(); } }, [t('profile.aiResetMessage')]);
  const descField = field(t('profile.aiDescription'), desc);
  const descHint = h('div', { class: 'small muted', text: t('profile.aiDescriptionHint') });
  const countField = field(t('profile.aiMaxSessions'), count);
  const countHint = h('div', { class: 'small muted' });

  const modeBtns = ['plan', 'describe'].map((m) => h('button', {
    class: 'btn btn--sm', style: 'flex:1', 'aria-pressed': 'false',
    onclick: () => {
      if (mode === m) return;
      // Remember the count the user typed for the mode they're leaving.
      const n = parseInt(count.value, 10);
      const keep = isNaN(n) || n < 0 ? 0 : Math.min(n, 100);
      if (mode === 'describe') { saved.describeSessions = keep; saved.extraMessage = msg.value; }
      else { saved.maxSessions = keep; saved.userMessage = msg.value.trim() || defaultUserMessage(); }
      mode = m;
      draw();
    }
  }, [t('profile.aiMode' + (m === 'plan' ? 'Plan' : 'Describe'))]));
  const modeRow = h('div', { style: 'display:flex;gap:8px', role: 'group', 'aria-label': t('profile.aiMode') }, modeBtns);

  function draw() {
    const describe = mode === 'describe';
    modeBtns.forEach((b, i) => {
      const on = (i === 0) === !describe;
      b.className = 'btn btn--sm' + (on ? ' btn--primary' : '');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    about.textContent = t(describe ? 'profile.aiDescribeAbout' : 'profile.aiPromptAbout');
    descField.hidden = descHint.hidden = !describe;
    // The free-text box stays in both modes but changes job: the request in plan
    // mode, optional extra instructions on top of the description in describe mode.
    // Each mode's text is held separately so switching doesn't lose either.
    msgField.firstChild.textContent = t(describe ? 'profile.aiExtraMessage' : 'profile.aiUserMessage');
    msg.placeholder = describe ? t('profile.aiExtraPlaceholder') : defaultUserMessage();
    msg.value = describe ? saved.extraMessage : saved.userMessage;
    resetMsg.hidden = describe;
    // Describe mode keeps its own history count: the description is the input, so
    // history is only a fallback for weights the athlete didn't state.
    count.value = String(describe ? saved.describeSessions : saved.maxSessions);
    countHint.textContent = t(describe ? 'profile.aiDescribeSessionsHint' : 'profile.aiMaxSessionsHint');
  }

  const read = () => {
    const n = parseInt(count.value, 10);
    const sessions = isNaN(n) || n < 0 ? 0 : Math.min(n, 100);
    const describe = mode === 'describe';
    return {
      mode,
      userMessage: describe ? saved.userMessage : (msg.value.trim() || defaultUserMessage()),
      extraMessage: describe ? msg.value : saved.extraMessage,
      description: desc.value,
      maxSessions: describe ? saved.maxSessions : sessions,
      describeSessions: describe ? sessions : saved.describeSessions
    };
  };

  async function copy() {
    const opts = read();
    if (opts.mode === 'describe' && !opts.description.trim()) { desc.focus(); toast(t('profile.aiDescriptionMissing')); return; }
    setSettings({ aiPrompt: opts });
    Object.assign(saved, opts);
    const text = buildPrompt({
      ...opts,
      userMessage: opts.mode === 'describe' ? opts.extraMessage : opts.userMessage,
      maxSessions: opts.mode === 'describe' ? opts.describeSessions : opts.maxSessions
    });
    preview.value = text;
    info.textContent = t('profile.aiPromptSize', { n: Math.round(text.length / 100) / 10 });
    const ok = await copyText(text);
    if (ok) toast(t('profile.aiCopied'));
    else { previewWrap.open = true; preview.focus(); preview.select(); toast(t('profile.aiCopyFailed')); }
  }

  const content = h('div', { class: 'stack' }, [
    modeRow,
    about,
    descField,
    descHint,
    msgField,
    resetMsg,
    countField,
    countHint,
    h('button', { class: 'btn btn--primary btn--block', onclick: copy }, [icon('clipboard', { size: 16 }), ' ' + t('profile.aiCopyPrompt')]),
    info,
    previewWrap
  ]);
  draw();
  sheet(t('profile.aiPrompt'), content);
}

function aiImportSheet(ctx) {
  const lang = getLang();
  const ta = h('textarea', { class: 'textarea', rows: '8', placeholder: '{ "kinetos": "sessions", ... }', style: 'font-family:ui-monospace,monospace;font-size:.75rem' });
  const status = h('div', {});
  const actions = h('div', { class: 'stack' });
  let parsed = null;

  const content = h('div', { class: 'stack' }, [
    h('p', { class: 'small muted', style: 'margin:0', text: t('profile.aiImportAbout') }),
    ta,
    h('button', { class: 'btn btn--block', onclick: check }, [t('profile.aiCheckJSON')]),
    status,
    actions
  ]);
  const ctl = sheet(t('profile.aiImport'), content);
  setTimeout(() => ta.focus(), 250);

  function check() {
    status.innerHTML = ''; actions.innerHTML = ''; parsed = null;
    let res;
    try { res = parseSessions(ta.value); }
    catch (e) {
      status.appendChild(h('div', { class: 'small', style: 'color:var(--danger);word-break:break-word', text: t('profile.aiInvalid') + ' ' + (e.message || '') }));
      return;
    }
    parsed = res.sessions;
    status.appendChild(h('div', { class: 'section-title', style: 'margin-top:0', text: t('profile.aiWillAdd', { n: parsed.length }) }));
    const ul = h('ul', { class: 'list card card--pad-0' });
    parsed.forEach((s) => {
      const existing = plansOnDate(s.date);
      ul.appendChild(h('li', { class: 'list__item' }, [
        h('div', { class: 'list__thumb' }, [icon('calendar', { size: 22 })]),
        h('div', { class: 'list__body' }, [
          h('div', { class: 'list__title', text: fmtDate(s.date, lang, { weekday: 'short' }) + (s.name ? ' · ' + s.name : '') }),
          h('div', { class: 'list__sub', text: t('exercises.count', { n: s.exercises.length })
            + ' · ' + t('profile.aiSetsTotal', { n: s.exercises.reduce((a, x) => a + (x.targetSets || 0), 0) })
            + (existing ? ' · ' + t('profile.aiDateBusy', { n: existing }) : '') })
        ])
      ]));
    });
    status.appendChild(ul);
    res.warnings.slice(0, 8).forEach((w) => status.appendChild(h('div', { class: 'small muted', style: 'word-break:break-word', text: '⚠ ' + w })));

    actions.appendChild(h('button', { class: 'btn btn--primary btn--block', onclick: add }, [
      icon('plus', { size: 16 }), ' ' + t('profile.aiAddToCalendar', { n: parsed.length })
    ]));
  }

  function add() {
    if (!parsed || !parsed.length) return;
    importSessions(parsed);
    ctl.close();
    toast(t('profile.aiImported', { n: parsed.length }));
    ctx.navigate('/plan');
  }
}

// ---- small builders ----
function input(value, type, onChange) {
  const el = h('input', { class: 'input', type, value: value ?? '' });
  el.addEventListener('change', () => onChange(el.value.trim()));
  return el;
}
function numField(value, onChange, suffix) {
  const el = h('input', { class: 'input', type: 'number', inputmode: 'decimal', value: value ?? '', placeholder: suffix || '' });
  el.addEventListener('change', () => { const n = parseFloat(el.value); onChange(isNaN(n) ? null : n); });
  return el;
}
function select(options, value, onChange) {
  const el = h('select', { class: 'select' }, options.map(([v, label]) => h('option', { value: v, text: label, selected: v === value ? true : null })));
  el.value = value;
  el.addEventListener('change', () => onChange(el.value));
  return el;
}
function field(label, node) {
  return h('label', { class: 'field' }, [
    h('span', { text: label, style: 'display:block;font-size:.8rem;font-weight:600;color:var(--text-muted);margin-bottom:5px' }),
    node
  ]);
}
function metric(value, label) {
  return h('div', { class: 'stat' }, [
    h('div', { class: 'stat__value', style: 'font-size:1.15rem', text: String(value) }),
    h('div', { class: 'stat__label', text: label })
  ]);
}
async function resizeImage(file, max) {
  const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), hh = Math.round(img.height * scale);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = hh;
  canvas.getContext('2d').drawImage(img, 0, 0, w, hh);
  return canvas.toDataURL('image/jpeg', 0.85);
}

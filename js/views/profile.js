// Profile: personal data, auto-calculated metrics, settings, data export/import.
import { h, toast } from '../ui.js';
import { t, getLang, SUPPORTED } from '../i18n.js';
import { getProfile, setProfile, getSettings, setSettings, exportJSON, importJSON, resetAll } from '../store.js';
import { completedSessions } from '../workout.js';
import { getExercise, exName } from '../data/db.js';
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
    platesHost
  ]));

  // Editable list of bar weights — only relevant in "add bar weight" mode.
  function drawBarWeights() {
    barWeightsHost.innerHTML = '';
    if ((getSettings().barbellInput || 'included') !== 'added') return;
    const weights = (getSettings().barbellWeights || []).slice();
    barWeightsHost.appendChild(h('div', { class: 'field__label', style: 'display:block;font-size:.8rem;font-weight:600;color:var(--text-muted);margin-bottom:6px', text: t('profile.barbellWeights') }));
    const chips = h('div', { class: 'chips' });
    weights.forEach((w, i) => {
      chips.appendChild(h('span', { class: 'tag', style: 'display:inline-flex;align-items:center;gap:6px;padding-right:5px' + (i === 0 ? ';background:color-mix(in srgb, var(--accent) 20%, transparent);color:var(--accent)' : '') }, [
        w + ' ' + t('units.kg'),
        h('button', { class: 'btn btn--icon btn--ghost btn--sm', style: 'width:20px;height:20px;min-height:0;padding:0', 'aria-label': t('common.remove'),
          onclick: () => { const arr = weights.filter((_, j) => j !== i); setSettings({ barbellWeights: arr }); drawBarWeights(); } }, [icon('x', { size: 14 })])
      ]));
    });
    barWeightsHost.appendChild(chips);
    const inp = h('input', { class: 'input', type: 'number', inputmode: 'decimal', step: '0.5', min: '0', placeholder: t('profile.barbellAddWeight'), style: 'flex:1' });
    const add = () => {
      const n = parseFloat(inp.value);
      if (isNaN(n) || n <= 0) return;
      const arr = weights.slice();
      if (!arr.includes(n)) arr.push(n);
      setSettings({ barbellWeights: arr }); inp.value = ''; drawBarWeights();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    barWeightsHost.appendChild(h('div', { class: 'row', style: 'gap:8px;margin-top:8px' }, [
      inp, h('button', { class: 'btn btn--sm', onclick: add }, [icon('plus', { size: 16 }), ' ' + t('common.add')])
    ]));
    barWeightsHost.appendChild(h('div', { class: 'small muted', style: 'margin-top:6px', text: t('profile.barbellWeightsHint') }));
  }
  drawBarWeights();

  // Available plate sizes (kg) — feeds the per-side plate calculator in the
  // session view (long-press a barbell weight field).
  function drawPlates() {
    platesHost.innerHTML = '';
    const plates = (getSettings().plates || []).slice().sort((a, b) => b - a);
    platesHost.appendChild(h('div', { class: 'field__label', style: 'display:block;font-size:.8rem;font-weight:600;color:var(--text-muted);margin-bottom:6px', text: t('profile.plates') }));
    const chips = h('div', { class: 'chips' });
    plates.forEach((w, i) => {
      chips.appendChild(h('span', { class: 'tag', style: 'display:inline-flex;align-items:center;gap:6px;padding-right:5px' }, [
        w + ' ' + t('units.kg'),
        h('button', { class: 'btn btn--icon btn--ghost btn--sm', style: 'width:20px;height:20px;min-height:0;padding:0', 'aria-label': t('common.remove'),
          onclick: () => { const arr = plates.filter((_, j) => j !== i); setSettings({ plates: arr }); drawPlates(); } }, [icon('x', { size: 14 })])
      ]));
    });
    platesHost.appendChild(chips);
    const inp = h('input', { class: 'input', type: 'number', inputmode: 'decimal', step: '0.25', min: '0', placeholder: t('profile.barbellAddWeight'), style: 'flex:1' });
    const add = () => {
      const n = parseFloat(inp.value);
      if (isNaN(n) || n <= 0) return;
      const arr = plates.slice();
      if (!arr.includes(n)) arr.push(n);
      setSettings({ plates: arr }); inp.value = ''; drawPlates();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    platesHost.appendChild(h('div', { class: 'row', style: 'gap:8px;margin-top:8px' }, [
      inp, h('button', { class: 'btn btn--sm', onclick: add }, [icon('plus', { size: 16 }), ' ' + t('common.add')])
    ]));
    platesHost.appendChild(h('div', { class: 'small muted', style: 'margin-top:6px', text: t('profile.platesHint') }));
  }
  drawPlates();

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
    const rows = [['date', 'session', 'exercise', 'set', 'weightKg', 'barKg', 'reps', 'seconds', 'distanceKm', 'minutes', 'effort', 'done']];
    completedSessions().slice().reverse().forEach((s) => {
      (s.entries || []).forEach((e) => {
        const ex = getExercise(e.exerciseId);
        (e.sets || []).forEach((set) => {
          rows.push([
            (s.startedAt || '').slice(0, 10), s.name || '', ex ? exName(ex) : e.exerciseId, set.n,
            set.weightKg ?? '', set.barKg ?? '', set.reps ?? '', set.seconds ?? '', set.distanceKm ?? '', set.minutes ?? '',
            set.effort ?? '', set.done === false ? 0 : 1
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

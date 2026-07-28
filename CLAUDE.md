# CLAUDE.md — Kinetos

Offline-first PWA to plan & track gym workouts. **Vanilla JS (ES modules), no build step, no backend, data in `localStorage`.** Mobile-first, responsive to desktop. Detailed context: `docs/*.html`.

## Hard constraints (don't break)
- No framework, no bundler, no npm build. Plain `<script type="module">`.
- All paths **relative** (must work at domain root *and* GitHub Pages `/repo/` subpath).
- Works fully offline. Only optional cloud sync makes network calls (Google APIs) at runtime.
- Units are metric. Calcs in `js/calc.js` are estimates only.

## Features already built
- **Exercises**: 42 built-in across groups `warmup, chest, back, legs, shoulders, biceps, triceps, core, cardio`; each has a muscle-map SVG + how-to cues, all names/cues in 5 languages. Users can add custom ones (custom exercises get a **runtime-generated** SVG from their group via `exsvg.js` — no file). Equipment: `barbell,dumbbell,cable,machine,bodyweight,cardio,band`. Exercises can be **hidden** (filter to show) and carry **notes** (CRUD); custom ones can be deleted (soft-delete if used in history). Hidden/notes live in `store.exerciseMeta[id]` (works for built-in + custom ids); soft-delete flags `customExercise.deleted`.
- **Templates**: reusable, dateless workout blueprints (`store.templates`), edited in `views/templates.js`. Start now, or schedule onto a date (creates a plan).
- **Calendar** (the Plan tab, `views/plan.js`): month grid marking planned sessions (`store.plans`, now dated instances) + completed workouts; day panel to start/edit; Templates shelf on top. A plan can be saved back as a template. Started plans (any session with that `planId`) show a "Started" tag instead of a Start button and drop off Home's today list. Plan/template editors set a **router nav guard** (`router.setNavGuard`) that confirms before discarding unsaved edits. A stale active session (>12 h, `workout.isStaleSession`) gets a Finish/Discard banner on Home (`autoFinishSession` ends it at the last set's timestamp).
- **Session logging**: sets with weight/reps or time or distance; **combined effort+done** control (tap = done/medium, long-press = menu: easy/medium/hard, mark-not-done, **delete set**); default **12 reps** prefill (long-press reps field for 6/8/10/12/15/20 — picking one records it as the set's explicit `targetReps`; the prefill alone does NOT); delete a set by **swiping right** (with an **Undo** toast) or via the done-button menu (confirm); **drag-reorder** exercises; per-entry notes; tap an exercise thumb to open its detail; add/collapse; live timer; **rest timer** (`settings.restSeconds`, default 90, 0=off) counts down after each done set (vibrates at 0); **plate calculator** — long-press a barbell weight field for the per-side breakdown (`settings.plates`, editable in Profile; `calc.platesPerSide` is pure). Done-taps repaint only their row (not the whole list).
- **Finished sessions** are **read-only** (explicit Edit mode to correct; notes stay editable); extended stats with charts (volume by exercise, sets by muscle doughnut, effort breakdown, best sets / est-1RM).
- **Suggestions** (`suggest.js`): next-set target from last session, modulated by effort AND whether target reps were hit (miss → back off; beat → push). Only **performed** sets count as history (`workout.js performed()`: `done !== false` + has data — plan-prefilled untouched sets are excluded). Weight step is per-equipment (`weightStepFor`: barbell/machine/cable 2.5, dumbbell 2) with a per-exercise override (`exerciseMeta[id].weightStep`, editable on exercise detail). Surfaced as a chip (Use fills the first pending set, never appends a duplicate) + prefill; also on exercise detail.
- **PRs & streak**: finishing a session detects new est-1RM personal records (toast + `PR` badge in finished stats via `workout.bestE1RMBefore`); Home shows a consecutive-training-weeks streak (`workout.weekStreak`) and per-set CSV export lives in Profile.
- **Progress**: Day/Week/Month/Year selector scoping tiles + volume chart; sets by muscle group; est-1RM trend; avg effort. Chart.js if vendored, else built-in fallback.
- **Profile**: body params + auto metrics (max HR + zones, 1RM, BMI/body-fat, BMR/TDEE); JSON export/import; theme; language; **dumbbell weight input** (`settings.dumbbellInput`: `single` default = user logs one dumbbell, counted ×2 in volume/1RM; `pair` = logs combined). Helpers in `js/data/db.js` (`usesDumbbell`, `isPerDumbbell`, `weightFactor`, `effectiveWeight`, `volumeWeightOf`); `calc.sessionVolume(session, weightOf)` takes an optional resolver so it stays pure. A `2×` badge (`.x2-badge`) shows on dumbbell weight fields in single mode. **Barbell weight** (`settings.barbellInput`: `included` default = logged weight already has the bar; `added` = log plates only, add the chosen bar). `settings.barbellWeights` (default `[20,10,5]`, first = default) is editable in Profile and drives the per-set bar chooser (`barChooser`, configured options only — no free entry); the chosen `set.barKg` is added in `effectiveWeight`. Helpers: `usesBarbell`, `barbellAdded`, `isBarbellAdded`, `barbellWeights`, `defaultBarKg`, `barKgOf`. A `+<bar>` badge/button (`.barbtn`) shows on barbell sets in added mode.
- **Cloud sync** (optional, OFF by default): see below.

## Layout
```
index.html  404.html  sw.js  manifest.webmanifest  docker-compose.yml  nginx.conf  run.bat
css/styles.css                 all styles (mobile-first; desktop @media >=900px = sidebar)
js/app.js                      bootstrap: theme, i18n, routes, chrome, sync.init()
js/{store,i18n,router,calc,workout,components,ui,svg,pwa,suggest,icons,version}.js   version.js = APP_VERSION (shown in Profile→About); icons.js = inline SVG line icons; pwa.js = SW registration + update toast + install prompt
js/exsvg.js                    runtime muscle-map SVG builder (JS port of tools/generate_svgs.py) — used for CUSTOM exercises
js/sortable.js                 pointer drag-to-reorder helper (used by session + plan/template editors)
js/charts.js                   shared Chart.js loader + fallback (used by progress + finished-session stats)
js/planedit.js                 shared exercise-targets editor (steppers, rep chooser, drag) for templates & plans
js/config.js                   sync config (Client IDs/secret); sync OFF until clientId set
js/sync/{manager,providers,secret}.js   optional cloud sync (Google Drive; OneDrive/Yandex disabled)
js/data/{db.js, exercises.json, muscles.json}   exercises.json = single source of truth
js/views/{home,exercises,plan,templates,session,progress,profile}.js   plan.js = Calendar + scheduled-session editor
locales/{en,de,fr,es,ru}.json  en.json is the key reference; keep all 5 in sync (377 keys)
assets/exercises/<id>.svg      generated muscle-map illustrations
tools/{generate_svgs.py, download-vendor.bat, publish.bat, encrypt-secret.html}
vendor/chart.umd.js            Chart.js (download-vendor.bat; app has a fallback)
docs/*.html                    index, architecture, data-model, extending, deploy, sync
```

## Cloud sync (docs/sync.html is the full guide)
- Only **Google Drive** is `enabled` in `config.js`; OneDrive/Yandex adapters exist but `enabled:false`.
- Scope `drive.file`: app creates/updates one `kinetos.json`, remembers its id in `localStorage`.
- OAuth code+PKCE in the browser; tokens in `localStorage` (never uploaded). Secret via `clientSecret` (plaintext) OR `clientSecretEnc` (AES-GCM; make blob with `tools/encrypt-secret.html`). `secret.js` resolves it: the passphrase is asked once, then the **decrypted secret** is remembered in `localStorage` under `kinetos.secret.<provider>` as `{secret,exp}` on a **sliding 30-day window** (each successful read re-stamps `exp`, at most daily), so re-prompting only happens after 30 days of no syncing. Stale/corrupt entries are swept and re-prompted; a legacy `sessionStorage` value is still honoured. The passphrase itself is never stored and the secret is never uploaded; `forgetSecrets()` (disconnect) and `store.resetAll()` (Reset app, prefix-sweeps `kinetos.secret.`) erase it.
- Triggers: on open, manual "Sync now", every `autoEveryMinutes` (10) if dirty, on `online`, and on tab-hide — always a **full pull+merge+push** (never a blind push), single-flight (concurrent triggers coalesce; `dirty` is cleared at snapshot time and restored on upload failure). Merge = union collections by id + last-write-wins scalars via top-level `updatedAt` (`store.mergeRemote`). **Deletes propagate via `store.tombstones`** (`{collection:{id:isoDeletedAt}}`): delete fns record a tombstone, save/add fns clear it AND stamp entity-level `updatedAt` (so `lastModOf` works for sessions/plans/custom exercises too), and `mergeRemote` unions tombstones (latest wins) and drops any re-appearing id unless it was edited after the deletion (`lastModOf` > tombstone). Tombstones prune after `TOMBSTONE_TTL_MS` (~6mo). OAuth: `redirectUri` derives from `<base href>` (always the app base) and the `state` param is verified on return; "Reset app" also forgets tokens/file id so the next sync can't restore erased data.
- NOTE: `config.js` currently holds the user's real clientId + an encrypted secret and IS published (encrypted-at-rest by design). `publish.bat` excludes `*.bat` but ships `config.js`.
- Can't be end-to-end tested in the sandbox (needs real OAuth + https origin); crypto & merge are unit-tested.

## Conventions
- Views export a render fn `(root, params, ctx)`; `ctx = {setTitle, setActions, navigate}`.
- Build DOM with `h()` from `ui.js`. State goes through `store.js` (persists immediately). `store.update(fn, {internal})` — internal skips bumping `updatedAt` (used by sync merge).
- Text via `t('dotted.key')`; localized data via `pick({en,...})`. Dynamic keys like `t('groups.'+g)` are common.
- Router: **History-API, clean URLs** (no `#`), patterns like `/plan/:id`. `/plan/new` is listed before `/plan/:id`. Base path read from `<base href>` in `index.html` (works at root *and* `/repo/`). Internal links use `data-route` + relative `href` (intercepted in `app.js`); `router.navigate()` uses `pushState`; views listen for the `route:change` event. Deep-link reloads work via `404.html` (GitHub Pages SPA bounce) + the SW navigation fallback (serves cached `index.html`) + nginx `try_files` locally. The base path is auto-detected (no hardcoded sub-path depth): both `index.html` and `404.html` find the first path segment that is a known top-level route and treat everything before it as the base — so **keep `TOP_ROUTES` in sync in both files** when you add a top-level route, and don't name the repo after a route.
- `store` key `kinetos.v1`; `migrate()` deep-merges `profile`/`settings` (nested collections pass through — `??`-guard new set/entry fields). Writes are **debounced ~250ms** (`flushPersist()` on pagehide/visibility-hidden/before sync push); quota failures dispatch `store:persist-error` (app.js shows a toast). A `storage` listener adopts newer state written by another tab. `importJSON` validates the file looks like a Kinetos backup and never adopts `settings.sync`. Schemas in `docs/data-model.html`.
- Dialogs/sheets/popovers are modal-accessible (role/aria-modal, Escape, focus restore — `components.modalize`); `attachLongPress` adds Enter/Space + context-menu keyboard paths on non-form elements; `ui.clickable(el)` makes list rows keyboard-operable — use it for any new clickable non-button. `ui.toast(msg, {action, onAction, duration})` supports an action button (used for Undo / update-Reload).

## When you change things
- New exercise → add to `exercises.json`, then `python tools/generate_svgs.py`. (SW auto-precaches every id.)
- New locale key → add to **all** `locales/*.json` (parity is verified; en is the reference).
- New view/screen/JS file/asset → add to `CORE` in `sw.js` **and bump `CACHE`** or clients won't update.
- On every deploy: bump `APP_VERSION` in `js/version.js` **and** set `sw.js` `CACHE` to `kinetos-<APP_VERSION>` (currently `1.8.0`). The version shows in Profile → About so you can confirm the loaded build. The SW no longer auto-`skipWaiting()`: clients see an "Update available → Reload" toast (pwa.js posts `SKIP_WAITING`, reloads on controllerchange). `vendor/chart.umd.js` is precached in `CORE`; install requests use `{cache:'reload'}`.

## Verify (no browser here; do this)
```
for f in $(find js sw.js -name '*.js'); do node --check "$f"; done   # syntax
# python: flatten locales, compare key sets to en (parity); check every exercise has an svg + cues in 5 langs
python3 -m http.server 8099                   # serve; curl key URLs for 200
```
Pure modules (`calc.js`, `suggest.js`, `store.mergeRemote`, `secret.js` decrypt) are unit-testable in node with a `localStorage` stub. Real browser click-through and OAuth can't run in this sandbox; rely on static checks + review, and ask the user to spot-check UI.

## Run / deploy
`run.bat` = `docker compose up` + open http://localhost:8080. Publish: `REPO_URL` in `tools/publish.bat` (set to the user's repo), run it, set Pages source to `gh-pages`.

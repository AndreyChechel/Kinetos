# CLAUDE.md — Kinetos

Offline-first PWA to plan & track gym workouts. **Vanilla JS (ES modules), no build step, no backend, data in `localStorage`.** Mobile-first, responsive to desktop. Detailed context: `docs/*.html`.

## Hard constraints (don't break)
- No framework, no bundler, no npm build. Plain `<script type="module">`.
- All paths **relative** (must work at domain root *and* GitHub Pages `/repo/` subpath).
- Works fully offline. Only optional cloud sync makes network calls (Google APIs) at runtime.
- Units are metric. Calcs in `js/calc.js` are estimates only.

## Features already built
- **Exercises**: 42 built-in across groups `warmup, chest, back, legs, shoulders, biceps, triceps, core, cardio`; each has a muscle-map SVG + how-to cues, all names/cues in 5 languages. Users can add custom ones. Equipment: `barbell,dumbbell,cable,machine,bodyweight,cardio,band`.
- **Plan**: create planned sessions (name/date/exercises with target sets/reps/weight); reorder exercises.
- **Session logging**: sets with weight/reps or time or distance; per-set **effort** (1/2/3), completion **timestamp** (seconds), add/remove sets, **collapse** & **reorder** exercises, live timer, target shown as faint `/8` on the row.
- **Suggestions** (`suggest.js`): next-set target from last session, modulated by effort AND whether target reps were hit (miss → back off; beat → push). Surfaced as a chip (Use) + prefill; also on exercise detail.
- **Progress**: Day/Week/Month/Year selector scoping tiles + volume chart; sets by muscle group; est-1RM trend; avg effort. Chart.js if vendored, else built-in fallback.
- **Profile**: body params + auto metrics (max HR + zones, 1RM, BMI/body-fat, BMR/TDEE); JSON export/import; theme; language.
- **Cloud sync** (optional, OFF by default): see below.

## Layout
```
index.html  sw.js  manifest.webmanifest  docker-compose.yml  nginx.conf  run.bat
css/styles.css                 all styles (mobile-first; desktop @media >=900px = sidebar)
js/app.js                      bootstrap: theme, i18n, routes, chrome, sync.init()
js/{store,i18n,router,calc,workout,components,ui,svg,pwa,suggest}.js
js/config.js                   sync config (Client IDs/secret); sync OFF until clientId set
js/sync/{manager,providers,secret}.js   optional cloud sync (Google Drive; OneDrive/Yandex disabled)
js/data/{db.js, exercises.json, muscles.json}   exercises.json = single source of truth
js/views/{home,exercises,plan,session,progress,profile}.js
locales/{en,de,fr,es,ru}.json  en.json is the key reference; keep all 5 in sync (276 keys)
assets/exercises/<id>.svg      generated muscle-map illustrations
tools/{generate_svgs.py, download-vendor.bat, publish.bat, encrypt-secret.html}
vendor/chart.umd.js            Chart.js (download-vendor.bat; app has a fallback)
docs/*.html                    index, architecture, data-model, extending, deploy, sync
```

## Cloud sync (docs/sync.html is the full guide)
- Only **Google Drive** is `enabled` in `config.js`; OneDrive/Yandex adapters exist but `enabled:false`.
- Scope `drive.file`: app creates/updates one `kinetos.json`, remembers its id in `localStorage`.
- OAuth code+PKCE in the browser; tokens in `localStorage` (never uploaded). Secret via `clientSecret` (plaintext) OR `clientSecretEnc` (AES-GCM, passphrase-unlocked once per session; make blob with `tools/encrypt-secret.html`). `secret.js` resolves it.
- Triggers: on open, manual "Sync now", and every `autoEveryMinutes` (10) if dirty. Merge = union collections by id + last-write-wins scalars via top-level `updatedAt` (`store.mergeRemote`).
- NOTE: `config.js` currently holds the user's real clientId + an encrypted secret and IS published (encrypted-at-rest by design). `publish.bat` excludes `*.bat` but ships `config.js`.
- Can't be end-to-end tested in the sandbox (needs real OAuth + https origin); crypto & merge are unit-tested.

## Conventions
- Views export a render fn `(root, params, ctx)`; `ctx = {setTitle, setActions, navigate}`.
- Build DOM with `h()` from `ui.js`. State goes through `store.js` (persists immediately). `store.update(fn, {internal})` — internal skips bumping `updatedAt` (used by sync merge).
- Text via `t('dotted.key')`; localized data via `pick({en,...})`. Dynamic keys like `t('groups.'+g)` are common.
- Router: hash-based, patterns like `/plan/:id`. `/plan/new` is listed before `/plan/:id`.
- `store` key `kinetos.v1`; `migrate()` deep-merges → adding fields is safe. Schemas in `docs/data-model.html`.

## When you change things
- New exercise → add to `exercises.json`, then `python tools/generate_svgs.py`. (SW auto-precaches every id.)
- New locale key → add to **all** `locales/*.json` (parity is verified; en is the reference).
- New view/screen/JS file/asset → add to `CORE` in `sw.js` **and bump `CACHE`** (currently `kinetos-v6`) or clients won't update.

## Verify (no browser here; do this)
```
for f in $(find js sw.js -name '*.js'); do node --check "$f"; done   # syntax
# python: flatten locales, compare key sets to en (parity); check every exercise has an svg + cues in 5 langs
python3 -m http.server 8099                   # serve; curl key URLs for 200
```
Pure modules (`calc.js`, `suggest.js`, `store.mergeRemote`, `secret.js` decrypt) are unit-testable in node with a `localStorage` stub. Real browser click-through and OAuth can't run in this sandbox; rely on static checks + review, and ask the user to spot-check UI.

## Run / deploy
`run.bat` = `docker compose up` + open http://localhost:8080. Publish: `REPO_URL` in `tools/publish.bat` (set to the user's repo), run it, set Pages source to `gh-pages`.

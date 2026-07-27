# CLAUDE.md — Kinetos

Offline-first PWA to plan & track gym workouts. **Vanilla JS (ES modules), no build step, no backend, data in `localStorage`.** Mobile-first, responsive to desktop. Detailed context: `docs/*.html`.

## Hard constraints (don't break)
- No framework, no bundler, no npm build. Plain `<script type="module">`.
- All paths **relative** (must work at domain root *and* GitHub Pages `/repo/` subpath).
- No backend / network dependency at runtime. Everything works offline.
- Units are metric. Calcs in `js/calc.js` are estimates only.

## Layout
```
index.html  sw.js  manifest.webmanifest  docker-compose.yml  nginx.conf  run.bat
css/styles.css                 all styles (mobile-first; desktop @media >=900px = sidebar)
js/app.js                      bootstrap: theme, i18n, routes, chrome
js/{store,i18n,router,calc,workout,components,ui,svg,pwa}.js
js/data/{db.js, exercises.json, muscles.json}   exercises.json = single source of truth
js/views/{home,exercises,plan,session,progress,profile}.js
locales/{en,de,fr,es,ru}.json  en.json is the key reference; keep all 5 in sync
assets/exercises/<id>.svg      generated muscle-map illustrations
tools/{generate_svgs.py, download-vendor.bat, publish.bat}
vendor/chart.umd.js            Chart.js (download-vendor.bat; app has a fallback)
docs/*.html                    architecture, data-model, extending, deploy
```

## Conventions
- Views export a render fn `(root, params, ctx)`; `ctx = {setTitle, setActions, navigate}`.
- Build DOM with `h()` from `ui.js`. State goes through `store.js` (persists immediately).
- Text via `t('dotted.key')`; localized data via `pick({en,...})`. Dynamic keys like `t('groups.'+g)` are common.
- Router: hash-based, patterns like `/plan/:id`. `/plan/new` is listed before `/plan/:id`.
- `store` key `kinetos.v1`; `migrate()` deep-merges → adding fields is safe. Schemas in `docs/data-model.html`.

## When you change things
- New exercise → add to `exercises.json`, then `python tools/generate_svgs.py`.
- New locale key → add to **all** `locales/*.json` (parity is verified).
- New view/screen/asset → add to `CORE` in `sw.js` **and bump `CACHE`** (else clients won't update).

## Verify (no browser here; do this)
```
node --check js/**/*.js                       # syntax
python3 -c "import json;[json.load(open(f)) for f in ...]"   # JSON valid + locale parity
python3 -m http.server 8099                   # serve; curl key URLs for 200
```
calc.js is pure → unit-testable in node. Real browser click-through can't run in this sandbox; rely on static checks + review, and ask the user to spot-check UI.

## Run / deploy
`run.bat` = `docker compose up` + open http://localhost:8080. Publish: set `REPO_URL` in `tools/publish.bat`, run it, set Pages source to `gh-pages`.

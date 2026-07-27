# Kinetos

Offline-first PWA to plan and track gym workouts. Vanilla JS, no build step, `localStorage` only, no backend.

## Run locally
1. Install Docker Desktop.
2. Double-click `run.bat` (starts nginx via `docker compose up` and opens http://localhost:8080).
3. Optional: run `tools\download-vendor.bat` once so charts work offline.

Or serve the folder with any static server (e.g. `python -m http.server 8080`).

## Publish to GitHub Pages
Edit `REPO_URL` in `tools\publish.bat`, then run it. Set Pages source to the `gh-pages` branch.

## Features
Exercise library grouped by muscle (with SVG illustrations), session planning, in-gym set/rep logging with timestamps, progress analytics, profile with auto-calculated metrics (max HR + zones, 1RM, BMI/body-fat, BMR/TDEE), JSON export/import, 5 languages (EN/DE/FR/ES/RU), light/dark themes, installable + fully offline.

## Docs
See `docs/index.html` for architecture, data model, and how to extend. These are written as context for future work sessions.

Third-party libraries live here so the app can run fully offline.

Run tools\download-vendor.bat to populate this folder. It downloads:
  - chart.umd.js   (Chart.js 4.x, used by the Progress screen)

If a vendor file is missing, the app still works — the Progress screen
falls back to a simple built-in chart renderer.

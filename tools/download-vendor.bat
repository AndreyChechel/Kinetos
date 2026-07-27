@echo off
REM Download third-party libraries into vendor\ so the app works fully offline.
REM Currently: Chart.js (used by the Progress screen). Re-run to update.
setlocal
cd /d "%~dp0.."

set "VENDOR=vendor"
set "CHART_URL=https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.js"
set "CHART_OUT=%VENDOR%\chart.umd.js"

if not exist "%VENDOR%" mkdir "%VENDOR%"

where curl >nul 2>nul
if errorlevel 1 (
    echo [ERROR] curl was not found. Windows 10 build 17063+ ships curl by default.
    pause
    exit /b 1
)

echo Downloading Chart.js...
curl -L --fail -o "%CHART_OUT%" "%CHART_URL%"
if errorlevel 1 (
    echo.
    echo [ERROR] Download failed. Check your internet connection.
    pause
    exit /b 1
)

echo.
echo Done. Vendor scripts saved to %VENDOR%\
echo   - %CHART_OUT%
echo (The Progress screen falls back to a built-in chart if this is missing.)
echo.

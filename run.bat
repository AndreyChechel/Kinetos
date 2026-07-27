@echo off
REM Kinetos — start the app locally with Docker and open it in your browser.
setlocal
cd /d "%~dp0"

echo ============================================
echo   Kinetos - starting local server
echo ============================================

where docker >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Docker was not found on your PATH.
    echo Install Docker Desktop from https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

echo Building and starting the container...
docker compose up -d
if errorlevel 1 (
    echo.
    echo [ERROR] "docker compose up" failed. Is Docker Desktop running?
    pause
    exit /b 1
)

REM Give nginx a moment to come up, then open the default browser.
timeout /t 2 /nobreak >nul
start "" "http://localhost:8080"

echo.
echo Kinetos is running at http://localhost:8080
echo Stop it any time with:  docker compose down
echo.

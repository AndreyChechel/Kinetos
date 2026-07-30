@echo off
REM ==========================================================================
REM  Publish Kinetos to GitHub Pages.
REM
REM  ONE-TIME SETUP:
REM   1. Create an empty repo on GitHub (e.g. github.com/yourname/kinetos).
REM   2. Fill in REPO_URL below.
REM   3. Make sure Git is installed and you can push to the repo.
REM   4. After the first publish, in the repo Settings > Pages, set the source
REM      branch to "gh-pages" (folder: / root). The site appears at
REM      https://yourname.github.io/kinetos/
REM
REM  The app uses relative paths, so it works under the /repo/ subpath.
REM ==========================================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0.."

REM ----------------------- CONFIG (edit these) ------------------------------
set "REPO_URL=https://github.com/AndreyChechel/Kinetos"
set "BRANCH=gh-pages"
set "COMMIT_MSG=Deploy Kinetos"
REM --------------------------------------------------------------------------

if "%REPO_URL%"=="https://github.com/USERNAME/REPO.git" (
    echo [ERROR] Please edit tools\publish.bat and set REPO_URL to your repository.
    pause
    exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Git was not found. Install it from https://git-scm.com/download/win
    pause
    exit /b 1
)

REM Initialise a git repo here if there isn't one yet.
if not exist ".git" (
    echo Initialising git repository...
    git init
    git add -A
    git commit -m "Initial commit"
    git branch -M main
    git remote add origin "%REPO_URL%"
    git push -u origin main
)

REM Ensure the origin remote points at REPO_URL.
git remote get-url origin >nul 2>nul
if errorlevel 1 ( git remote add origin "%REPO_URL%" ) else ( git remote set-url origin "%REPO_URL%" )

REM Disable Jekyll so all files (including folders) are served verbatim.
if not exist ".nojekyll" type nul > ".nojekyll"

echo Preparing a clean copy of the site in a temporary worktree...
if exist ".gh-pages-tmp" rmdir /s /q ".gh-pages-tmp"
git worktree prune
git worktree add -B %BRANCH% ".gh-pages-tmp" 2>nul
if errorlevel 1 (
    git worktree add ".gh-pages-tmp" 2>nul
)

echo Copying files...
REM gis-test.html is a throwaway local harness for the Google auth popup — never ship it.
robocopy "." ".gh-pages-tmp" /E /XD ".git" ".gh-pages-tmp" "node_modules" /XF "*.bat" "gis-test.html" >nul
REM robocopy exit codes 0-7 mean success; anything >=8 is a real error.
if %ERRORLEVEL% GEQ 8 (
    echo [ERROR] Copying files failed.
    pause
    exit /b 1
)

pushd ".gh-pages-tmp"
type nul > ".nojekyll"
git add -A
git commit -m "%COMMIT_MSG% (%date% %time%)" 2>nul
echo Pushing to %BRANCH%...
git push -f origin %BRANCH%
set "PUSH_RESULT=%ERRORLEVEL%"
popd

git worktree remove ".gh-pages-tmp" --force >nul 2>nul
if exist ".gh-pages-tmp" rmdir /s /q ".gh-pages-tmp"

if not "%PUSH_RESULT%"=="0" (
    echo.
    echo [ERROR] Push failed. Check your credentials and REPO_URL.
    pause
    exit /b 1
)

echo.
echo Published to the "%BRANCH%" branch.
echo Enable GitHub Pages (Settings ^> Pages ^> Branch: %BRANCH% / root) if you haven't yet.
echo.

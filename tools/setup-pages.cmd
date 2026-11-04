@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Run: winget install OpenJS.NodeJS.LTS & pause & exit /b 1)
where git >nul 2>nul || (echo Git is not installed. Run: winget install Git.Git  then open a new window and run this again. & pause & exit /b 1)
echo.
echo Create an empty GitHub repo first (e.g. pokebonk-builder), then paste its URL.
set /p REPO=GitHub repo URL: 
if "%REPO%"=="" (echo No URL given. & pause & exit /b 1)
set DEST=%~dp0..\site-repo
if not exist "%DEST%\.git" (
  git clone "%REPO%" "%DEST%"
  if errorlevel 1 (echo Clone failed - check the URL and that you are signed in to GitHub. & pause & exit /b 1)
)
node -e "require('fs').writeFileSync('config.json', JSON.stringify({repoDir:'../site-repo', branch:'main'}, null, 2))"
echo Publishing the builder site...
node update.mjs --publish
echo.
echo Last step: on GitHub open the repo ^> Settings ^> Pages ^> Source "Deploy from a branch" ^> main / (root).
echo Your site will be at https://YOUR-NAME.github.io/REPO-NAME/
pause

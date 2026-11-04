@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it once with:  winget install OpenJS.NodeJS.LTS
  echo then run this again.
  if /i not "%~1"=="--quiet" pause
  exit /b 1
)
node update.mjs %*
set RC=%ERRORLEVEL%
if /i not "%~1"=="--quiet" pause
exit /b %RC%

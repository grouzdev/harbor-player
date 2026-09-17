@echo off
setlocal
cd /d "%~dp0"
set "HARBOR_PLAYER_NO_OPEN=1"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 LTS is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\.bin\vite.cmd" (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Starting Harbor Player...
call node scripts\open-running.mjs
if not errorlevel 1 exit /b 0
echo Browser: http://127.0.0.1:5173
echo Close this window or press Ctrl+C to stop.
call npm.cmd run dev
if errorlevel 1 pause

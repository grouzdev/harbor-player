@echo off
setlocal
cd /d "%~dp0website"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 LTS is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\.bin\astro.cmd" (
  echo Installing website dependencies...
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo Starting Harbor Player website...
echo Browser: http://127.0.0.1:4321/harbor-player/
echo Russian version: http://127.0.0.1:4321/harbor-player/ru/
echo Close this window or press Ctrl+C to stop.
call npm.cmd run dev
if errorlevel 1 pause

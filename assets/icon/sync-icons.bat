@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-icons.ps1"
set "SYNC_EXIT_CODE=%ERRORLEVEL%"

if not "%SYNC_EXIT_CODE%" == "0" (
  echo.
  echo Icon synchronization failed with exit code %SYNC_EXIT_CODE%.
  pause
)

exit /b %SYNC_EXIT_CODE%

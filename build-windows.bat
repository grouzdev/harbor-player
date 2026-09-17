@echo off
setlocal
cd /d "%~dp0"

tasklist /fi "imagename eq Harbor Player.exe" /nh | findstr /i /c:"Harbor Player.exe" >nul
if not errorlevel 1 (
  set "HP_FAILURE_STEP=Checking for a running Harbor Player instance"
  set "HP_FAILURE_CODE=1"
  set "HP_FAILURE_HINT=Close every Harbor Player window, including a portable version, then run this file again."
  goto :fail
)

where node >nul 2>nul
if errorlevel 1 (
  set "HP_FAILURE_STEP=Checking Node.js 24"
  set "HP_FAILURE_CODE=1"
  set "HP_FAILURE_HINT=Install Node.js 24 from https://nodejs.org/"
  goto :fail
)

where npm >nul 2>nul
if errorlevel 1 (
  set "HP_FAILURE_STEP=Checking npm"
  set "HP_FAILURE_CODE=1"
  set "HP_FAILURE_HINT=Reinstall Node.js 24 from https://nodejs.org/"
  goto :fail
)

if not exist "node_modules\.bin\electron-builder.cmd" (
  set "HP_FAILURE_STEP=Checking project dependencies"
  set "HP_FAILURE_CODE=1"
  set "HP_FAILURE_HINT=Run npm install in this folder, then run this file again."
  goto :fail
)

for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set "HP_VERSION=%%V"
if not defined HP_VERSION (
  set "HP_FAILURE_STEP=Reading the application version"
  set "HP_FAILURE_CODE=1"
  set "HP_FAILURE_HINT=Check package.json and the Node.js installation."
  goto :fail
)

echo.
echo === Preparing Electron ===
set "HP_FAILURE_HINT="
call npm.cmd run desktop:prepare
if errorlevel 1 (
  set "HP_FAILURE_STEP=Preparing Electron"
  set "HP_FAILURE_CODE=%errorlevel%"
  goto :fail
)

echo.
echo === Building application ===
set "HP_FAILURE_HINT="
call npm.cmd run build
if errorlevel 1 (
  set "HP_FAILURE_STEP=Building the application"
  set "HP_FAILURE_CODE=%errorlevel%"
  goto :fail
)

echo.
echo === Generating smoke-test fixtures ===
set "HP_FAILURE_HINT="
call npm.cmd run fixtures
if errorlevel 1 (
  set "HP_FAILURE_STEP=Generating smoke-test fixtures"
  set "HP_FAILURE_CODE=%errorlevel%"
  goto :fail
)

echo.
echo === Building unpacked Windows x64 application ===
set "HP_FAILURE_HINT="
call npx.cmd electron-builder --config electron-builder.beta.yml --win --x64 --dir
if errorlevel 1 (
  set "HP_FAILURE_STEP=Building the unpacked Windows application"
  set "HP_FAILURE_CODE=%errorlevel%"
  goto :fail
)

echo.
echo === Smoke-testing unpacked application ===
set "HP_FAILURE_HINT=The unpacked application did not complete its packaged smoke test."
call node scripts\desktop-smoke.mjs
if errorlevel 1 (
  set "HP_FAILURE_STEP=Smoke-testing the unpacked application"
  set "HP_FAILURE_CODE=%errorlevel%"
  goto :fail
)

echo.
echo === Building Windows x64 installer and portable application ===
set "HP_FAILURE_HINT="
call npx.cmd electron-builder --config electron-builder.beta.yml --win nsis portable --x64
if errorlevel 1 (
  set "HP_FAILURE_STEP=Building the installer and portable application"
  set "HP_FAILURE_CODE=%errorlevel%"
  goto :fail
)

echo.
echo === Smoke-testing portable application ===
set "HP_FAILURE_HINT=The portable application did not complete its packaged smoke test."
set "HARBOR_PLAYER_SMOKE_EXPECT_PORTABLE=1"
call node scripts\desktop-smoke.mjs
if errorlevel 1 (
  set "HP_FAILURE_STEP=Smoke-testing the portable application"
  set "HP_FAILURE_CODE=%errorlevel%"
  goto :fail
)

echo.
echo Windows builds completed successfully:
echo   release\win-unpacked\Harbor Player.exe
echo   release\Harbor Player-%HP_VERSION%-x64-unsigned-Setup.exe
echo   release\Harbor Player-%HP_VERSION%-x64-unsigned-portable.exe
exit /b 0

:fail
echo.
echo === WINDOWS BUILD FAILED ===
echo Step: %HP_FAILURE_STEP%
echo Exit code: %HP_FAILURE_CODE%
if defined HP_FAILURE_HINT echo Hint: %HP_FAILURE_HINT%
echo.
echo Fix the error shown above, then run this file again.
pause
exit /b %HP_FAILURE_CODE%

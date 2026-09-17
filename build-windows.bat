@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 is required. Install it from https://nodejs.org/
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is required. Reinstall Node.js 24 from https://nodejs.org/
  exit /b 1
)

if not exist "node_modules\.bin\electron-builder.cmd" (
  echo Dependencies are missing. Run "npm install" in this folder, then run this file again.
  exit /b 1
)

for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set "MML_VERSION=%%V"
if not defined MML_VERSION (
  echo Could not read the application version from package.json.
  exit /b 1
)

echo.
echo === Preparing Electron ===
call npm.cmd run desktop:prepare
if errorlevel 1 exit /b %errorlevel%

echo.
echo === Building application ===
call npm.cmd run build
if errorlevel 1 exit /b %errorlevel%

echo.
echo === Generating smoke-test fixtures ===
call npm.cmd run fixtures
if errorlevel 1 exit /b %errorlevel%

echo.
echo === Building unpacked Windows x64 application ===
call npx.cmd electron-builder --config electron-builder.beta.yml --win --x64 --dir
if errorlevel 1 exit /b %errorlevel%

echo.
echo === Smoke-testing unpacked application ===
call node scripts\desktop-smoke.mjs
if errorlevel 1 exit /b %errorlevel%

echo.
echo === Building Windows x64 installer and portable application ===
call npx.cmd electron-builder --config electron-builder.beta.yml --win nsis portable --x64
if errorlevel 1 exit /b %errorlevel%

echo.
echo === Smoke-testing portable application ===
set "MYMUSICLIB_SMOKE_EXPECT_PORTABLE=1"
call node scripts\desktop-smoke.mjs
if errorlevel 1 exit /b %errorlevel%

echo.
echo Windows builds completed successfully:
echo   release\win-unpacked\MyMusicLib.exe
echo   release\MyMusicLib-%MML_VERSION%-x64-unsigned-Setup.exe
echo   release\MyMusicLib-%MML_VERSION%-x64-unsigned-portable.exe
exit /b 0

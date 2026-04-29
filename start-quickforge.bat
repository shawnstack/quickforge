@echo off
setlocal
cd /d "%~dp0"
title QuickForge

echo Starting QuickForge local app...
echo Project: %CD%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Please install Node.js first.
  echo https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Please reinstall Node.js with npm enabled.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto error
)

if not exist "dist\index.html" (
  echo Building web app...
  call npm run build
  if errorlevel 1 goto error
)

echo.
echo QuickForge will open at http://localhost:5176
echo Local data is stored in %%USERPROFILE%%\.quickforge\storage by default.
echo Keep this window open while using QuickForge.
echo.
call npm start
if errorlevel 1 goto error

echo.
echo QuickForge stopped.
pause
exit /b 0

:error
echo.
echo [ERROR] QuickForge failed to start.
pause
exit /b 1

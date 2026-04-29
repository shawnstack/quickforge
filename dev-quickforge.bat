@echo off
setlocal
cd /d "%~dp0"
title QuickForge Dev

echo Starting QuickForge development mode...
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

echo.
echo QuickForge dev server will open at http://localhost:5176
echo Keep this window open while developing.
echo.
call npm run dev
if errorlevel 1 goto error

echo.
echo QuickForge dev server stopped.
pause
exit /b 0

:error
echo.
echo [ERROR] QuickForge development mode failed to start.
pause
exit /b 1

@echo off
setlocal
cd /d "%~dp0"
title FastCode

echo Starting FastCode local app...
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
echo FastCode will open at http://localhost:5176
echo Local data is stored in %%APPDATA%%\FastCode\storage by default.
echo Keep this window open while using FastCode.
echo.
call npm start
if errorlevel 1 goto error

echo.
echo FastCode stopped.
pause
exit /b 0

:error
echo.
echo [ERROR] FastCode failed to start.
pause
exit /b 1

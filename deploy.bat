@echo off
setlocal
cd /d "%~dp0"
title QuickForge Deploy

echo ========================================
echo   QuickForge Local Deploy
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js first.
  echo https://nodejs.org/
  pause
  exit /b 1
)

echo [1/4] Installing dependencies...
call npm install
if errorlevel 1 goto error

echo.
echo [2/4] Building web app...
call npm run build
if errorlevel 1 goto error

echo.
echo [3/4] Uninstalling old version...
call npm uninstall -g quickforge 2>nul

echo.
echo [4/4] Installing globally...
call npm install -g .
if errorlevel 1 goto error

echo.
echo ========================================
echo   Deploy complete!
echo ========================================
echo.
echo Commands available anywhere:
echo   qf            Start background service
echo   quickforge    Same as qf
echo   qf stop       Stop service
echo   qf status     Check status
echo.
pause
exit /b 0

:error
echo.
echo [ERROR] Deploy failed!
pause
exit /b 1

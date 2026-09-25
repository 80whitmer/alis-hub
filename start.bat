@echo off
REM Double-click to start ALIS Hub. First run installs dependencies and asks
REM a few setup questions (saved to server\.env); every run after that just
REM starts the app. Close this window to stop the app.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't installed yet.
  echo Go to https://nodejs.org, download the LTS installer, run it, then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First-time setup — installing dependencies (a few minutes, text scrolling by is normal)...
  call npm install
)

if not exist server\.env (
  node scripts\first-run-setup.js
)

start "" cmd /c "timeout /t 4 >nul && start http://localhost:5173"

echo Starting ALIS Hub — leave this window open. Close it to stop the app.
call npm run dev

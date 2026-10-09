@echo off
REM ADD [Claude AI - Opus 5] (2026-10-08 14:52:30): dev loop. Vite rebuilds the UI
REM into public/ on every change; the server pushes a reload to the open page.
setlocal
cd /d "%~dp0"
start "skill-editor ui build" cmd /c "cd /d "%~dp0ui" && npm run dev"
node --watch serve.mjs --project="%~dp0.." %*
endlocal

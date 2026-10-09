@echo off
REM ADD [Claude AI - Opus 5] (2026-10-08 13:14:20): launch the Claude Skill Editor.
REM --watch restarts when serve.mjs or anything it imports changes; the open page
REM reloads itself. public/ changes are pushed straight to the page, no restart.
setlocal
cd /d "%~dp0"
node --watch serve.mjs --project="%~dp0.." %*
endlocal

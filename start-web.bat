@echo off
cd /d "%~dp0apps\web"
echo Iniciando frontend (backend na VPS api.syyck.store)...
echo Abra: http://localhost:3000
echo.
call pnpm dev
pause

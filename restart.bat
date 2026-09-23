@echo off
REM DeskApp restart script for Windows
REM Kills existing processes, then starts Electron

echo [DeskApp] Killing existing processes...
taskkill /F /IM electron.exe 2>nul
taskkill /F /IM python.exe /FI "WINDOWTITLE eq bridge*" 2>nul
timeout /t 1 /nobreak >nul

REM Remove singleton lock
if exist "%APPDATA%\deskapp\SingletonLock" del /F "%APPDATA%\deskapp\SingletonLock"

echo [DeskApp] Starting...
cd /d %~dp0
call npm run build
start "" .\node_modules\electron\dist\electron.exe .

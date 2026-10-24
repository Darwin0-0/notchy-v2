@echo off
cd /d "%~dp0"
node scripts\check-storage.cjs
pause

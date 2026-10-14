@echo off
if exist "%~dp0build\release\Notchy V2.exe" (
  start "" "%~dp0build\release\Notchy V2.exe" --data-root "%~dp0." --localsend
) else if exist "%~dp0build\debug\Notchy V2.exe" (
  start "" "%~dp0build\debug\Notchy V2.exe" --data-root "%~dp0." --localsend
) else (
  echo Compile Notchy avec Build-Notchy.ps1 avant de le lancer.
  pause
)

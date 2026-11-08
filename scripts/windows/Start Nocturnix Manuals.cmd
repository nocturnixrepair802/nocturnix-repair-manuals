@echo off
setlocal
where pwsh.exe >nul 2>&1
if errorlevel 1 (
  echo PowerShell 7 or newer is required. Install it, then run this launcher again.
  pause
  exit /b 1
)
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Nocturnix.ps1"
set "NOCTURNIX_EXIT=%ERRORLEVEL%"
if not "%NOCTURNIX_EXIT%"=="0" pause
endlocal & exit /b %NOCTURNIX_EXIT%

@echo off
setlocal
cd /d "%~dp0"

where pwsh.exe >nul 2>&1
if errorlevel 1 (
  echo PowerShell 7 was not found. Install PowerShell 7 and run this file again.
  pause
  exit /b 1
)

pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0gateway\start.ps1"
set "exitCode=%ERRORLEVEL%"
echo.
if "%exitCode%"=="0" (
  echo OmniBlock AI gateway is running on http://127.0.0.1:4000
) else (
  echo OmniBlock AI gateway failed to start. See the error above.
)
pause
exit /b %exitCode%

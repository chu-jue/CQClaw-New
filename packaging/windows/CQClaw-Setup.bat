@echo off
setlocal

title CQClaw Setup
pushd "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-cqclaw.ps1" %*
set "CQCLAW_SETUP_EXIT=%ERRORLEVEL%"

echo.
if "%CQCLAW_SETUP_EXIT%"=="0" (
  echo CQClaw setup finished.
  echo You can start it from the Desktop shortcut, Start Menu, or: cqclaw start
) else (
  echo CQClaw setup failed with exit code %CQCLAW_SETUP_EXIT%.
)

echo.
pause
popd
exit /b %CQCLAW_SETUP_EXIT%

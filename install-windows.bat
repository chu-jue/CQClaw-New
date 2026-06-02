@echo off
setlocal

title CQClaw Installer
pushd "%~dp0"

echo Installing CQClaw CLI...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set "AAS_INSTALL_EXIT=%ERRORLEVEL%"

echo.
if "%AAS_INSTALL_EXIT%"=="0" (
  echo Install finished.
  echo.
  echo If the cqclaw command is not found, close this window and open a new PowerShell or CMD.
  echo Then run:
  echo   cqclaw start
) else (
  echo Install failed with exit code %AAS_INSTALL_EXIT%.
  echo Please check the error message above.
)

echo.
pause
popd
exit /b %AAS_INSTALL_EXIT%

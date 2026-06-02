@echo off
setlocal

if "%QCLAW_HOME%"=="" (
  if "%AAS_HOME%"=="" (
    set "QCLAW_HOME=%~dp0.."
  ) else (
    set "QCLAW_HOME=%AAS_HOME%"
  )
)
set "AAS_HOME=%QCLAW_HOME%"

if not "%QCLAW_PYTHON%"=="" (
  "%QCLAW_PYTHON%" "%QCLAW_HOME%\tools\aas_cli.py" %*
  exit /b %ERRORLEVEL%
)
if not "%AAS_PYTHON%"=="" (
  "%AAS_PYTHON%" "%QCLAW_HOME%\tools\aas_cli.py" %*
  exit /b %ERRORLEVEL%
)
where py >nul 2>nul
if "%ERRORLEVEL%"=="0" (
  py -3 "%QCLAW_HOME%\tools\aas_cli.py" %*
  exit /b %ERRORLEVEL%
)
where python >nul 2>nul
if "%ERRORLEVEL%"=="0" (
  python "%QCLAW_HOME%\tools\aas_cli.py" %*
  exit /b %ERRORLEVEL%
)
echo Python was not found. Install Python 3 and try again.
exit /b 127
exit /b %ERRORLEVEL%

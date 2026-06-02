@echo off
setlocal

echo aas is deprecated. Please use cqclaw. 1>&2
if "%QCLAW_HOME%"=="" (
  if "%AAS_HOME%"=="" (
    set "QCLAW_HOME=%~dp0.."
  ) else (
    set "QCLAW_HOME=%AAS_HOME%"
  )
)
set "AAS_HOME=%QCLAW_HOME%"

where py >nul 2>nul
if "%ERRORLEVEL%"=="0" (
  py -3 "%QCLAW_HOME%\tools\aas_cli.py" %*
) else (
  where python >nul 2>nul
  if "%ERRORLEVEL%"=="0" (
    python "%QCLAW_HOME%\tools\aas_cli.py" %*
  ) else (
    echo Python was not found. Install Python 3 and try again.
    exit /b 127
  )
)

exit /b %ERRORLEVEL%

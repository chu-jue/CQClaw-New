param(
  [switch]$WithOcr
)

$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$InstallDir = Join-Path $env:USERPROFILE ".cqclaw\bin"
$CmdPath = Join-Path $InstallDir "cqclaw.cmd"
$PsPath = Join-Path $InstallDir "cqclaw.ps1"
$LegacyCmdPath = Join-Path $InstallDir "aas.cmd"
$LegacyPsPath = Join-Path $InstallDir "aas.ps1"

Set-Location $Root

function Get-HostPythonExecutable {
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    $Value = (& py -3 -c "import sys; print(sys.executable)" 2>$null) | Select-Object -First 1
    if ($LASTEXITCODE -eq 0 -and $Value) {
      return $Value.Trim()
    }
  }

  $uv = Get-Command uv -ErrorAction SilentlyContinue
  if ($uv) {
    $Value = (& uv python find 2>$null) | Select-Object -First 1
    if ($LASTEXITCODE -eq 0 -and $Value) {
      return $Value.Trim()
    }
  }

  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    $Value = (& python -c "import sys; print(sys.executable)" 2>$null) | Select-Object -First 1
    if ($LASTEXITCODE -eq 0 -and $Value) {
      return $Value.Trim()
    }
  }

  throw "Python was not found. Install Python 3, reopen PowerShell or CMD, then run install-windows.bat again."
}

function Invoke-HostPython {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PythonExe,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & $PythonExe @Arguments 2>&1 | ForEach-Object { Write-Host $_ }
  $ExitCode = $LASTEXITCODE
  return [int]$ExitCode
}

function Test-RequirementsHasPackages {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    return $false
  }

  foreach ($Line in Get-Content $Path) {
    $Trimmed = $Line.Trim()
    if ($Trimmed -and -not $Trimmed.StartsWith("#")) {
      return $true
    }
  }
  return $false
}

function Test-PathEntry {
  param(
    [string[]]$Entries,
    [string]$Target
  )

  $TrimChars = [char[]]@("\", "/")
  $NormalizedTarget = $Target.TrimEnd($TrimChars)
  foreach ($Entry in $Entries) {
    if ($Entry.TrimEnd($TrimChars) -ieq $NormalizedTarget) {
      return $true
    }
  }
  return $false
}

$BaseRequirements = Join-Path $Root "requirements.txt"
$PythonExe = Get-HostPythonExecutable
if (Test-RequirementsHasPackages -Path $BaseRequirements) {
  $Code = Invoke-HostPython -PythonExe $PythonExe -Arguments @("-m", "pip", "install", "--user", "-r", $BaseRequirements)
  if ($Code -ne 0) {
    throw "Failed to install base requirements. Exit code: $Code"
  }
}

$OcrRequirements = Join-Path $Root "requirements-ocr.txt"
if ($WithOcr -and (Test-RequirementsHasPackages -Path $OcrRequirements)) {
  $Code = Invoke-HostPython -PythonExe $PythonExe -Arguments @("-m", "pip", "install", "--user", "-r", $OcrRequirements)
  if ($Code -ne 0) {
    throw "Failed to install OCR requirements. Exit code: $Code"
  }
}

$CliPath = Join-Path $Root "tools\aas_cli.py"
$Code = Invoke-HostPython -PythonExe $PythonExe -Arguments @($CliPath, "python", "--set", $PythonExe, "--source", "install")
if ($Code -ne 0) {
  throw "Failed to save Python runtime configuration. Exit code: $Code"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

@"
@echo off
setlocal
set "QCLAW_HOME=$Root"
set "AAS_HOME=%QCLAW_HOME%"
set "QCLAW_PYTHON=$PythonExe"
"%QCLAW_PYTHON%" "%QCLAW_HOME%\tools\aas_cli.py" %*
exit /b %ERRORLEVEL%
"@ | Set-Content -Encoding ASCII $CmdPath

@"
`$ErrorActionPreference = "Stop"
`$env:QCLAW_HOME = "$Root"
`$env:AAS_HOME = `$env:QCLAW_HOME
`$env:QCLAW_PYTHON = "$PythonExe"
`$Cli = Join-Path `$env:QCLAW_HOME "tools\aas_cli.py"
& `$env:QCLAW_PYTHON `$Cli @args
exit `$LASTEXITCODE
"@ | Set-Content -Encoding ASCII $PsPath

@"
@echo off
echo aas is deprecated. Please use cqclaw. 1>&2
"%~dp0cqclaw.cmd" %*
exit /b %ERRORLEVEL%
"@ | Set-Content -Encoding ASCII $LegacyCmdPath

@"
Write-Warning "aas is deprecated. Please use cqclaw."
& (Join-Path `$PSScriptRoot "cqclaw.ps1") @args
exit `$LASTEXITCODE
"@ | Set-Content -Encoding ASCII $LegacyPsPath

$CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")
$PathParts = @()
if ($CurrentPath) {
  $PathParts = $CurrentPath -split ";"
}
if (-not (Test-PathEntry -Entries $PathParts -Target $InstallDir)) {
  $NewPath = if ($CurrentPath) { "$CurrentPath;$InstallDir" } else { $InstallDir }
  [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
  $env:Path = "$env:Path;$InstallDir"
}

Write-Host "CQClaw CLI installed."
Write-Host "Command: cqclaw"
Write-Host "Home: $Root"
Write-Host "Python: $PythonExe"
Write-Host "Try: cqclaw start"
if ($WithOcr) {
  Write-Host "OCR: installed"
} else {
  Write-Host "OCR: skipped. Install later with: cqclaw install-ocr"
}
Write-Host ""
Write-Host "If PowerShell blocks scripts, run:"
Write-Host "powershell -ExecutionPolicy Bypass -File .\install.ps1"
Write-Host "Restart the terminal if cqclaw is not found immediately."

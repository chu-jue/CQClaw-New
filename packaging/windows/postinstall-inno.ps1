param(
  [switch]$EnableAutostart,
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$InstallScript = Join-Path $Root "install.ps1"

if (-not (Test-Path $InstallScript)) {
  throw "install.ps1 not found in $Root"
}

Write-Host "Installing CQClaw CLI..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $InstallScript
if ($LASTEXITCODE -ne 0) {
  throw "CLI installer failed with exit code $LASTEXITCODE"
}

$PythonConfig = Join-Path $Root "data\runtime\cqclaw-python.json"
$PythonExe = ""
if (Test-Path $PythonConfig) {
  try {
    $Config = Get-Content $PythonConfig -Raw | ConvertFrom-Json
    $PythonExe = [string]$Config.python
  } catch {
    $PythonExe = ""
  }
}

if (-not $PythonExe) {
  $PythonExe = "python"
}

$Cli = Join-Path $Root "tools\aas_cli.py"

if ($EnableAutostart) {
  Write-Host "Enabling CQClaw autostart..."
  & $PythonExe $Cli autostart enable --no-open
}

if ($StartNow) {
  Write-Host "Starting CQClaw service..."
  & $PythonExe $Cli start --no-open
}

Write-Host "CQClaw post-install completed."

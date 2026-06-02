param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "CQClaw"),
  [switch]$WithOcr,
  [switch]$EnableAutostart,
  [switch]$StartNow,
  [switch]$NoShortcut
)

$ErrorActionPreference = "Stop"

function Find-SourceRoot {
  $Candidates = @(
    $PSScriptRoot,
    (Resolve-Path (Join-Path $PSScriptRoot "..") -ErrorAction SilentlyContinue).Path,
    (Resolve-Path (Join-Path $PSScriptRoot "..\..") -ErrorAction SilentlyContinue).Path
  )
  foreach ($Candidate in $Candidates) {
    if ($Candidate -and (Test-Path (Join-Path $Candidate "server.py")) -and (Test-Path (Join-Path $Candidate "tools\aas_cli.py"))) {
      return (Resolve-Path $Candidate).Path
    }
  }
  throw "Could not find CQClaw source root near $PSScriptRoot"
}

function Get-HostPythonExecutable {
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    $Value = (& py -3 -c "import sys; print(sys.executable)" 2>$null) | Select-Object -First 1
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

  throw "Python was not found. Install Python 3, reopen this installer, and try again."
}

function Get-PythonwExecutable {
  param([Parameter(Mandatory = $true)][string]$PythonExe)
  $PythonPath = [System.IO.FileInfo]$PythonExe
  $Pythonw = Join-Path $PythonPath.DirectoryName "pythonw.exe"
  if (Test-Path $Pythonw) {
    return $Pythonw
  }
  return $PythonExe
}

function Copy-CQClawTree {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $ExcludeDirs = @(".git", ".venv", "__pycache__", "dist", "build", ".pytest_cache")
  $ExcludeFiles = @("*.pyc", "*.pyo", ".DS_Store")
  $Args = @(
    $Source,
    $Destination,
    "/MIR",
    "/XD"
  ) + $ExcludeDirs + @(
    (Join-Path $Source "data\runtime"),
    (Join-Path $Source "data\tmp-scripts")
  ) + @(
    "/XF"
  ) + $ExcludeFiles + @(
    "/R:2",
    "/W:1",
    "/NFL",
    "/NDL",
    "/NJH",
    "/NJS"
  )
  & robocopy @Args | Out-Host
  $Code = $LASTEXITCODE
  if ($Code -gt 7) {
    throw "robocopy failed with exit code $Code"
  }
}

function New-CQClawShortcut {
  param(
    [Parameter(Mandatory = $true)][string]$ShortcutPath,
    [Parameter(Mandatory = $true)][string]$Pythonw,
    [Parameter(Mandatory = $true)][string]$AppDir
  )
  $Client = Join-Path $AppDir "desktop\cqclaw_client.py"
  $Shell = New-Object -ComObject WScript.Shell
  $Shortcut = $Shell.CreateShortcut($ShortcutPath)
  $Shortcut.TargetPath = $Pythonw
  $Shortcut.Arguments = "`"$Client`""
  $Shortcut.WorkingDirectory = $AppDir
  $Shortcut.WindowStyle = 1
  $Shortcut.Description = "Open CQClaw desktop client"
  $Icon = Join-Path $AppDir "static\adb-terminal-icon.svg"
  if (Test-Path $Icon) {
    $Shortcut.IconLocation = "$Pythonw,0"
  }
  $Shortcut.Save()
}

$SourceRoot = Find-SourceRoot
$InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
$PythonExe = Get-HostPythonExecutable
$Pythonw = Get-PythonwExecutable -PythonExe $PythonExe

Write-Host "CQClaw source: $SourceRoot"
Write-Host "CQClaw install: $InstallDir"
Write-Host "Python: $PythonExe"

Copy-CQClawTree -Source $SourceRoot -Destination $InstallDir

$InstallScript = Join-Path $InstallDir "install.ps1"
$InstallArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $InstallScript)
if ($WithOcr) {
  $InstallArgs += "-WithOcr"
}
& powershell.exe @InstallArgs
if ($LASTEXITCODE -ne 0) {
  throw "CLI installer failed with exit code $LASTEXITCODE"
}

if (-not $NoShortcut) {
  $Desktop = [Environment]::GetFolderPath("Desktop")
  $StartMenu = Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs"
  New-Item -ItemType Directory -Force -Path $StartMenu | Out-Null
  New-CQClawShortcut -ShortcutPath (Join-Path $Desktop "CQClaw.lnk") -Pythonw $Pythonw -AppDir $InstallDir
  New-CQClawShortcut -ShortcutPath (Join-Path $StartMenu "CQClaw.lnk") -Pythonw $Pythonw -AppDir $InstallDir
  Write-Host "Shortcuts: created"
}

$Cli = Join-Path $InstallDir "tools\aas_cli.py"
if ($EnableAutostart) {
  & $PythonExe $Cli autostart enable --no-open
}
if ($StartNow) {
  & $PythonExe $Cli start --no-open
}

Write-Host ""
Write-Host "CQClaw installed."
Write-Host "CLI: cqclaw"
Write-Host "Client: Desktop or Start Menu shortcut"
Write-Host "Web: cqclaw open"

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$env:QCLAW_HOME = $Root
$env:AAS_HOME = $Root

function Get-ConfiguredPython {
  $ConfigPath = Join-Path $Root "data\runtime\cqclaw-python.json"
  if (Test-Path $ConfigPath) {
    try {
      $Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
      if ($Config.python -and (Test-Path $Config.python)) {
        return [string]$Config.python
      }
    } catch {
    }
  }
  return ""
}

function Get-HostPythonExecutable {
  $Configured = Get-ConfiguredPython
  if ($Configured) {
    return $Configured
  }

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

  throw "Python was not found. Install Python 3 and try again."
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

$Python = Get-HostPythonExecutable
$Pythonw = Get-PythonwExecutable -PythonExe $Python
$Client = Join-Path $Root "desktop\cqclaw_client.py"

Start-Process -FilePath $Pythonw -ArgumentList @("`"$Client`"") -WorkingDirectory $Root

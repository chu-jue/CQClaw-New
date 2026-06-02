$ErrorActionPreference = "Stop"

if ($env:QCLAW_HOME) {
  $QclawHome = $env:QCLAW_HOME
} elseif ($env:AAS_HOME) {
  $QclawHome = $env:AAS_HOME
} else {
  $QclawHome = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$env:QCLAW_HOME = $QclawHome
$env:AAS_HOME = $QclawHome
$Cli = Join-Path $QclawHome "tools\aas_cli.py"

if ($env:QCLAW_PYTHON) {
  & $env:QCLAW_PYTHON $Cli @args
} elseif ($env:AAS_PYTHON) {
  & $env:AAS_PYTHON $Cli @args
} else {
  $Py = Get-Command py -ErrorAction SilentlyContinue
  if ($Py) {
    & py -3 $Cli @args
  } else {
    $Python = Get-Command python -ErrorAction SilentlyContinue
    if ($Python) {
      & python $Cli @args
    } else {
      Write-Error "Python was not found. Install Python 3 and try again."
      exit 127
    }
  }
}

exit $LASTEXITCODE

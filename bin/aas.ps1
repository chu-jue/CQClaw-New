$ErrorActionPreference = "Stop"

Write-Warning "aas is deprecated. Please use cqclaw."

if ($env:QCLAW_HOME) {
  $AasHome = $env:QCLAW_HOME
} elseif ($env:AAS_HOME) {
  $AasHome = $env:AAS_HOME
} else {
  $AasHome = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$env:QCLAW_HOME = $AasHome
$env:AAS_HOME = $AasHome
$Cli = Join-Path $AasHome "tools\aas_cli.py"

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

exit $LASTEXITCODE

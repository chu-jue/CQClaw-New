$ErrorActionPreference = "Stop"

$InstallDir = Join-Path $env:USERPROFILE ".cqclaw\bin"
$CmdPath = Join-Path $InstallDir "cqclaw.cmd"
$PsPath = Join-Path $InstallDir "cqclaw.ps1"
$LegacyCmdPath = Join-Path $InstallDir "aas.cmd"
$LegacyPsPath = Join-Path $InstallDir "aas.ps1"
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$RunValue = "CQClaw"
$LegacyRunValue = "Android Automation Studio"

function Same-PathEntry {
  param(
    [string]$Left,
    [string]$Right
  )

  $TrimChars = [char[]]@("\", "/")
  return $Left.TrimEnd($TrimChars) -ieq $Right.TrimEnd($TrimChars)
}

foreach ($Path in @($CmdPath, $PsPath, $LegacyCmdPath, $LegacyPsPath)) {
  if (Test-Path $Path) {
    Remove-Item $Path
    Write-Host "Removed $Path"
  }
}

$CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($CurrentPath) {
  $Parts = $CurrentPath -split ";" | Where-Object { $_ -and -not (Same-PathEntry $_ $InstallDir) }
  [Environment]::SetEnvironmentVariable("Path", ($Parts -join ";"), "User")
}

if (Get-ItemProperty -Path $RunKey -Name $RunValue -ErrorAction SilentlyContinue) {
  Remove-ItemProperty -Path $RunKey -Name $RunValue
  Write-Host "Removed autostart entry $RunValue"
}
if (Get-ItemProperty -Path $RunKey -Name $LegacyRunValue -ErrorAction SilentlyContinue) {
  Remove-ItemProperty -Path $RunKey -Name $LegacyRunValue
  Write-Host "Removed legacy autostart entry $LegacyRunValue"
}

Write-Host "Project files and local data were not removed."

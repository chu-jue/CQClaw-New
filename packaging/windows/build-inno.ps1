param(
  [string]$InnoCompiler = "",
  [string]$Script = ""
)

$ErrorActionPreference = "Stop"

if (-not $Script) {
  $Script = Join-Path $PSScriptRoot "CQClaw.iss"
}

function Find-InnoCompiler {
  param([string]$Explicit)
  if ($Explicit) {
    if (Test-Path $Explicit) {
      return $Explicit
    }
    throw "Inno compiler not found: $Explicit"
  }

  $Candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
    (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
  )
  foreach ($Candidate in $Candidates) {
    if ($Candidate -and (Test-Path $Candidate)) {
      return $Candidate
    }
  }

  $Command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($Command) {
    return $Command.Source
  }

  throw "ISCC.exe was not found. Install Inno Setup 6 or pass -InnoCompiler <path-to-ISCC.exe>."
}

function Test-AgentAssets {
  param([Parameter(Mandatory = $true)][string]$Root)

  $Assets = @(
    (Join-Path $Root "data\agent\CQClawAgent.apk"),
    (Join-Path $Root "data\agent\cqclaw-agent-server.jar")
  )
  $Missing = @()
  foreach ($Asset in $Assets) {
    if (-not (Test-Path $Asset)) {
      $Missing += $Asset
    }
  }
  if ($Missing.Count -gt 0) {
    Write-Warning "Agent assets are missing and will not be bundled:"
    foreach ($Asset in $Missing) {
      Write-Warning "  $Asset"
    }
    Write-Warning "Put CQClawAgent.apk and cqclaw-agent-server.jar in data\agent before publishing the installer."
  } else {
    Write-Host "Agent assets: bundled"
  }
}

$Compiler = Find-InnoCompiler -Explicit $InnoCompiler
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$VersionFile = Join-Path $Root "version.txt"
$AppVersion = "dev"
if (Test-Path $VersionFile) {
  $Value = (Get-Content -Path $VersionFile -TotalCount 1).Trim()
  if ($Value) {
    $AppVersion = $Value
  }
}
$TauriDir = Join-Path $Root "desktop\tauri-client"
$TauriExe = Join-Path $TauriDir "src-tauri\target\release\cqclaw-client.exe"
New-Item -ItemType Directory -Force -Path (Join-Path $Root "dist") | Out-Null
Test-AgentAssets -Root $Root

if (-not (Test-Path $TauriExe)) {
  Write-Host "Building Tauri client..."
  Push-Location $TauriDir
  try {
    if (-not (Test-Path "node_modules")) {
      if (Test-Path "package-lock.json") {
        npm ci
      } else {
        npm install
      }
      if ($LASTEXITCODE -ne 0) {
        throw "Node dependency install failed with exit code $LASTEXITCODE"
      }
    }
    npm run build
    if ($LASTEXITCODE -ne 0) {
      throw "Tauri build failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path $TauriExe)) {
  throw "Tauri executable was not produced: $TauriExe"
}

Write-Host "Inno compiler: $Compiler"
Write-Host "Tauri executable: $TauriExe"
Write-Host "Inno script: $Script"
Write-Host "App version: $AppVersion"
& $Compiler "/DAppVersion=$AppVersion" $Script
if ($LASTEXITCODE -ne 0) {
  throw "Inno Setup failed with exit code $LASTEXITCODE"
}

Write-Host "Installer output: $(Join-Path $Root 'dist')"

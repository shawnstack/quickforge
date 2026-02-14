param(
  [switch]$NoClean
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$baselineDir = Join-Path $repoRoot "docs"
$baselineFile = Join-Path $baselineDir "cold-start-baseline.jsonl"

function Require-Command([string]$Name, [string]$InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Write-Error "Missing prerequisite: $Name. $InstallHint"
    exit 1
  }
}

Require-Command "cargo" "Install Rust via https://rustup.rs"
Require-Command "rustc" "Install Rust via https://rustup.rs"

if (-not (Test-Path $baselineDir)) {
  New-Item -ItemType Directory -Path $baselineDir | Out-Null
}

$cleanTarget = -not $NoClean
if ($cleanTarget) {
  $targetDir = Join-Path $repoRoot "target"
  if (Test-Path $targetDir) {
    Remove-Item -Recurse -Force $targetDir
  }
}

$previous = $null
if (Test-Path $baselineFile) {
  $lastLine = Get-Content $baselineFile | Select-Object -Last 1
  if ($lastLine) {
    try {
      $previous = $lastLine | ConvertFrom-Json
    } catch {
      Write-Warning "Cannot parse previous baseline line, skipping comparison."
    }
  }
}

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
& cargo build
$stopwatch.Stop()

$elapsedSeconds = [math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
$nowUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$rustVersion = (& rustc --version).Trim()
$record = [ordered]@{
  timestamp_utc = $nowUtc
  platform = "windows"
  rustc = $rustVersion
  profile = "dev"
  clean_target = $cleanTarget
  elapsed_seconds = $elapsedSeconds
}

($record | ConvertTo-Json -Compress) | Add-Content -Path $baselineFile

Write-Host "Cold start build captured."
Write-Host "elapsed_seconds: $elapsedSeconds"
Write-Host "baseline_file: $baselineFile"

if ($previous -and $previous.elapsed_seconds) {
  $delta = [math]::Round(($elapsedSeconds - [double]$previous.elapsed_seconds), 3)
  $deltaPct = [math]::Round(($delta / [double]$previous.elapsed_seconds) * 100, 2)
  $trend = if ($delta -gt 0) { "slower" } elseif ($delta -lt 0) { "faster" } else { "unchanged" }
  Write-Host "previous_elapsed_seconds: $($previous.elapsed_seconds)"
  Write-Host "delta_seconds: $delta ($deltaPct`%, $trend)"
} else {
  Write-Host "previous_elapsed_seconds: n/a (this is the first baseline entry)"
}

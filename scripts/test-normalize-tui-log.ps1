Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    throw "Assertion failed: $Message"
  }
}

$root = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $PSScriptRoot 'normalize-tui-log.ps1'
$tmpDir = Join-Path $root 'target\normalize-script-tests'

if (Test-Path $tmpDir) {
  Remove-Item -Recurse -Force $tmpDir
}
New-Item -ItemType Directory -Path $tmpDir | Out-Null

$inputPath = Join-Path $tmpDir 'sample.log'
$eventsDefaultPath = Join-Path $tmpDir 'events-default.clean.log'
$eventsNoDedupePath = Join-Path $tmpDir 'events-nodedupe.clean.log'
$eventsShortPath = Join-Path $tmpDir 'events-short.clean.log'

$esc = [char]27
$longMessage = ('X' * 280)
$sample = @(
  "$esc[31mfastcode | mode: edit | status: idle | mcp: off r0 d0 | size: 80x24$esc[0m"
  "system: repeated-line"
  "system: repeated-line"
  "system: $longMessage"
) -join "`n"

Set-Content -Path $inputPath -Value $sample -Encoding utf8

powershell -ExecutionPolicy Bypass -File $scriptPath -InputPath $inputPath -OutputPath $eventsDefaultPath -Mode events | Out-Null
powershell -ExecutionPolicy Bypass -File $scriptPath -InputPath $inputPath -OutputPath $eventsNoDedupePath -Mode events -NoDedupe | Out-Null
powershell -ExecutionPolicy Bypass -File $scriptPath -InputPath $inputPath -OutputPath $eventsShortPath -Mode events -MaxEventLength 80 | Out-Null

$defaultLines = Get-Content $eventsDefaultPath
$noDedupeLines = Get-Content $eventsNoDedupePath
$shortLines = Get-Content $eventsShortPath

$defaultRepeatedCount = @($defaultLines | Where-Object { $_ -eq 'system: repeated-line' }).Count
$noDedupeRepeatedCount = @($noDedupeLines | Where-Object { $_ -eq 'system: repeated-line' }).Count

Assert-True -Condition ($defaultRepeatedCount -eq 1) -Message 'default events mode should dedupe adjacent repeated messages'
Assert-True -Condition ($noDedupeRepeatedCount -eq 2) -Message 'NoDedupe should keep adjacent repeated messages'
Assert-True -Condition (($shortLines | Measure-Object -Maximum Length).Maximum -le 84) -Message 'MaxEventLength 80 should cap output line length including truncation marker'
Assert-True -Condition (@($shortLines | Where-Object { $_ -like '* ...' }).Count -ge 1) -Message 'short output should contain a truncated line marker'

Write-Host 'normalize-tui-log script tests: PASS'

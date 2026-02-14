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
$eventsSummaryPath = Join-Path $tmpDir 'events-summary.json'
$eventsSummaryCompactPath = Join-Path $tmpDir 'events-summary.compact.txt'

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
powershell -ExecutionPolicy Bypass -File $scriptPath -InputPath $inputPath -OutputPath $eventsDefaultPath -Mode events -SummaryPath $eventsSummaryPath | Out-Null
powershell -ExecutionPolicy Bypass -File $scriptPath -InputPath $inputPath -OutputPath $eventsDefaultPath -Mode events -SummaryPath $eventsSummaryCompactPath -SummaryFormat compact | Out-Null

$defaultLines = Get-Content $eventsDefaultPath
$noDedupeLines = Get-Content $eventsNoDedupePath
$shortLines = Get-Content $eventsShortPath
$summary = Get-Content -Raw $eventsSummaryPath | ConvertFrom-Json
$summaryCompact = (Get-Content -Raw $eventsSummaryCompactPath).Trim()

$defaultRepeatedCount = @($defaultLines | Where-Object { $_ -eq 'system: repeated-line' }).Count
$noDedupeRepeatedCount = @($noDedupeLines | Where-Object { $_ -eq 'system: repeated-line' }).Count

Assert-True -Condition ($defaultRepeatedCount -eq 1) -Message 'default events mode should dedupe adjacent repeated messages'
Assert-True -Condition ($noDedupeRepeatedCount -eq 2) -Message 'NoDedupe should keep adjacent repeated messages'
Assert-True -Condition (($shortLines | Measure-Object -Maximum Length).Maximum -le 84) -Message 'MaxEventLength 80 should cap output line length including truncation marker'
Assert-True -Condition (@($shortLines | Where-Object { $_ -like '* ...' }).Count -ge 1) -Message 'short output should contain a truncated line marker'
Assert-True -Condition ($summary.mode -eq 'events') -Message 'summary mode should be events'
Assert-True -Condition ($summary.dedupe_enabled -eq $true) -Message 'summary should report dedupe enabled for default events run'
Assert-True -Condition ($summary.event_candidate_count -eq 4) -Message 'summary should report all extracted event candidates before dedupe'
Assert-True -Condition ($summary.event_output_line_count -eq $defaultLines.Count) -Message 'summary output line count should match normalized events output'
Assert-True -Condition ($summary.dedupe_suppressed_count -eq 1) -Message 'summary should report one suppressed duplicate line'
Assert-True -Condition ($summary.truncated_count -eq 1) -Message 'summary should report one truncated line'
Assert-True -Condition ($summaryCompact -match '(?:^| )mode=events(?: |$)') -Message 'compact summary should include mode=events'
Assert-True -Condition ($summaryCompact -match 'output_line_count=\d+') -Message 'compact summary should include output_line_count'
Assert-True -Condition ($summaryCompact -match 'dedupe_suppressed_count=1') -Message 'compact summary should include dedupe suppression count'
Assert-True -Condition ($summaryCompact -match 'truncated_count=1') -Message 'compact summary should include truncation count'

Write-Host 'normalize-tui-log script tests: PASS'

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
$eventsStrictPath = Join-Path $tmpDir 'events-strict.clean.log'
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
powershell -ExecutionPolicy Bypass -File $scriptPath -InputPath $inputPath -OutputPath $eventsStrictPath -Mode events -StrictEvents | Out-Null
powershell -ExecutionPolicy Bypass -File $scriptPath -InputPath $inputPath -OutputPath $eventsDefaultPath -Mode events -SummaryPath $eventsSummaryPath | Out-Null
powershell -ExecutionPolicy Bypass -File $scriptPath -InputPath $inputPath -OutputPath $eventsDefaultPath -Mode events -SummaryPath $eventsSummaryCompactPath -SummaryFormat compact | Out-Null
$emitCompactOutput = & powershell -ExecutionPolicy Bypass -File $scriptPath -InputPath $inputPath -OutputPath $eventsDefaultPath -Mode events -EmitSummary -SummaryFormat compact 2>&1
$emitCompactText = ($emitCompactOutput | ForEach-Object { $_.ToString() }) -join "`n"

$defaultLines = Get-Content $eventsDefaultPath
$noDedupeLines = Get-Content $eventsNoDedupePath
$shortLines = Get-Content $eventsShortPath
$strictLines = Get-Content $eventsStrictPath
$summary = Get-Content -Raw $eventsSummaryPath | ConvertFrom-Json
$summaryCompact = (Get-Content -Raw $eventsSummaryCompactPath).Trim()

$defaultRepeatedCount = @($defaultLines | Where-Object { $_ -eq 'system: repeated-line' }).Count
$noDedupeRepeatedCount = @($noDedupeLines | Where-Object { $_ -eq 'system: repeated-line' }).Count

Assert-True -Condition ($defaultRepeatedCount -eq 1) -Message 'default events mode should dedupe adjacent repeated messages'
Assert-True -Condition ($noDedupeRepeatedCount -eq 2) -Message 'NoDedupe should keep adjacent repeated messages'
Assert-True -Condition (($shortLines | Measure-Object -Maximum Length).Maximum -le 84) -Message 'MaxEventLength 80 should cap output line length including truncation marker'
Assert-True -Condition (@($shortLines | Where-Object { $_ -like '* ...' }).Count -ge 1) -Message 'short output should contain a truncated line marker'
Assert-True -Condition ($strictLines.Count -eq $defaultLines.Count) -Message 'strict mode should preserve canonical sample events'
Assert-True -Condition ($summary.mode -eq 'events') -Message 'summary mode should be events'
Assert-True -Condition ($summary.dedupe_enabled -eq $true) -Message 'summary should report dedupe enabled for default events run'
Assert-True -Condition ($summary.event_candidate_count -eq 4) -Message 'summary should report all extracted event candidates before dedupe'
Assert-True -Condition ($summary.event_output_line_count -eq $defaultLines.Count) -Message 'summary output line count should match normalized events output'
Assert-True -Condition ($summary.status_event_count -eq 1) -Message 'summary should report one status event in normalized output'
Assert-True -Condition ($summary.message_event_count -eq 2) -Message 'summary should report two message events in normalized output'
Assert-True -Condition ($summary.system_event_count -eq 2) -Message 'summary should report two system events in normalized output'
Assert-True -Condition ($summary.user_event_count -eq 0) -Message 'summary should report zero user events in normalized output'
Assert-True -Condition ($summary.assistant_event_count -eq 0) -Message 'summary should report zero assistant events in normalized output'
Assert-True -Condition ($summary.label_event_count_sum -eq 2) -Message 'summary should report per-label event count sum'
Assert-True -Condition ($summary.label_sum_matches_message_count -eq $true) -Message 'summary should report matching label sum invariant'
Assert-True -Condition ($summary.dedupe_suppressed_count -eq 1) -Message 'summary should report one suppressed duplicate line'
Assert-True -Condition ($summary.truncated_count -eq 1) -Message 'summary should report one truncated line'
Assert-True -Condition ($summaryCompact -match '(?:^| )mode=events(?: |$)') -Message 'compact summary should include mode=events'
Assert-True -Condition ($summaryCompact -match 'output_line_count=\d+') -Message 'compact summary should include output_line_count'
Assert-True -Condition ($summaryCompact -match 'status_event_count=1') -Message 'compact summary should include status event count'
Assert-True -Condition ($summaryCompact -match 'message_event_count=2') -Message 'compact summary should include message event count'
Assert-True -Condition ($summaryCompact -match 'system_event_count=2') -Message 'compact summary should include system event count'
Assert-True -Condition ($summaryCompact -match 'user_event_count=0') -Message 'compact summary should include user event count'
Assert-True -Condition ($summaryCompact -match 'assistant_event_count=0') -Message 'compact summary should include assistant event count'
Assert-True -Condition ($summaryCompact -match 'label_event_count_sum=2') -Message 'compact summary should include per-label event sum'
Assert-True -Condition ($summaryCompact -match 'label_sum_matches_message_count=True') -Message 'compact summary should include label-sum invariant flag'
Assert-True -Condition ($summaryCompact -match 'dedupe_suppressed_count=1') -Message 'compact summary should include dedupe suppression count'
Assert-True -Condition ($summaryCompact -match 'truncated_count=1') -Message 'compact summary should include truncation count'
Assert-True -Condition ($emitCompactText -match '(?m)^summary:$') -Message 'EmitSummary should print summary label to stdout'
Assert-True -Condition ($emitCompactText -match '(?:^| )mode=events(?: |$)') -Message 'EmitSummary compact stdout should include mode=events'
Assert-True -Condition ($emitCompactText -match 'event_candidate_count=4') -Message 'EmitSummary compact stdout should include event candidate count'
Assert-True -Condition ($emitCompactText -match 'event_output_line_count=3') -Message 'EmitSummary compact stdout should include output line count after dedupe'
Assert-True -Condition ($emitCompactText -match 'status_event_count=1') -Message 'EmitSummary compact stdout should include status event count'
Assert-True -Condition ($emitCompactText -match 'message_event_count=2') -Message 'EmitSummary compact stdout should include message event count'
Assert-True -Condition ($emitCompactText -match 'system_event_count=2') -Message 'EmitSummary compact stdout should include system event count'
Assert-True -Condition ($emitCompactText -match 'user_event_count=0') -Message 'EmitSummary compact stdout should include user event count'
Assert-True -Condition ($emitCompactText -match 'assistant_event_count=0') -Message 'EmitSummary compact stdout should include assistant event count'
Assert-True -Condition ($emitCompactText -match 'label_event_count_sum=2') -Message 'EmitSummary compact stdout should include per-label event sum'
Assert-True -Condition ($emitCompactText -match 'label_sum_matches_message_count=True') -Message 'EmitSummary compact stdout should include label-sum invariant flag'
Assert-True -Condition ($emitCompactText -match 'dedupe_suppressed_count=1') -Message 'EmitSummary compact stdout should include dedupe suppression count'
Assert-True -Condition ($emitCompactText -match 'truncated_count=1') -Message 'EmitSummary compact stdout should include truncation count'

Write-Host 'normalize-tui-log script tests: PASS'

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
$fixtureTemplatePath = Join-Path $PSScriptRoot 'fixtures\normalize-tui-log\noisy-mcp-fixture.template.txt'
$overlayFixtureTemplatePath = Join-Path $PSScriptRoot 'fixtures\normalize-tui-log\noisy-overlay-fixture.template.txt'
$resizeBurstFixtureTemplatePath = Join-Path $PSScriptRoot 'fixtures\normalize-tui-log\resize-burst-long-details.template.txt'
$tmpDir = Join-Path $root 'target\normalize-fixture-tests'

if (Test-Path $tmpDir) {
  Remove-Item -Recurse -Force $tmpDir
}
New-Item -ItemType Directory -Path $tmpDir | Out-Null

$inputPath = Join-Path $tmpDir 'noisy-mcp-fixture.log'
$outputPath = Join-Path $tmpDir 'noisy-mcp-fixture.clean.log'
$esc = [char]27

$template = Get-Content -Raw -Path $fixtureTemplatePath
$fixtureContent = $template.Replace('<ESC>', [string]$esc)
Set-Content -Path $inputPath -Value $fixtureContent -Encoding utf8

powershell -ExecutionPolicy Bypass -File $scriptPath -InputPath $inputPath -OutputPath $outputPath -Mode events | Out-Null
$lines = Get-Content $outputPath

Assert-True -Condition (@($lines | Where-Object { $_ -eq 'fastcode | mode: edit | status: idle | mcp: error r1 d0 | size: 80x24' }).Count -eq 1) -Message 'should extract first status snapshot exactly once'
Assert-True -Condition (@($lines | Where-Object { $_ -eq 'fastcode | mode: edit | status: idle | mcp: error r2 d1 | size: 80x24' }).Count -eq 1) -Message 'should extract second status snapshot exactly once'
Assert-True -Condition (@($lines | Where-Object { $_ -eq "system: MCP diagnostics failed: spawn error (code=5); path='C:/bad path'" }).Count -eq 1) -Message 'default dedupe should suppress adjacent duplicate system message'
Assert-True -Condition (@($lines | Where-Object { $_ -eq 'user: hi' }).Count -eq 1) -Message 'should preserve user event'
Assert-True -Condition (@($lines | Where-Object { $_ -eq 'assistant: received -> hi' }).Count -eq 1) -Message 'should preserve assistant event'
Assert-True -Condition (@($lines | Where-Object { $_ -match '^\?' }).Count -eq 0) -Message 'output should not retain mojibake placeholders at line start'

$overlayInputPath = Join-Path $tmpDir 'noisy-overlay-fixture.log'
$overlayOutputPath = Join-Path $tmpDir 'noisy-overlay-fixture.clean.log'
$overlayStrictOutputPath = Join-Path $tmpDir 'noisy-overlay-fixture.strict.clean.log'
$overlayTemplate = Get-Content -Raw -Path $overlayFixtureTemplatePath
$overlayContent = $overlayTemplate.Replace('<ESC>', [string]$esc)
Set-Content -Path $overlayInputPath -Value $overlayContent -Encoding utf8

powershell -ExecutionPolicy Bypass -File $scriptPath -InputPath $overlayInputPath -OutputPath $overlayOutputPath -Mode events | Out-Null
powershell -ExecutionPolicy Bypass -File $scriptPath -InputPath $overlayInputPath -OutputPath $overlayStrictOutputPath -Mode events -StrictEvents | Out-Null
$overlayLines = Get-Content $overlayOutputPath
$overlayStrictLines = Get-Content $overlayStrictOutputPath

Assert-True -Condition (@($overlayLines | Where-Object { $_ -eq 'fastcode | mode: edit | status: idle | mcp: error r1 d0 | size: 80x24' }).Count -eq 1) -Message 'overlay fixture should keep status snapshot'
Assert-True -Condition (@($overlayLines | Where-Object { $_ -eq 'user: hi' }).Count -eq 1) -Message 'overlay fixture should preserve user event'
Assert-True -Condition (@($overlayLines | Where-Object { $_ -eq 'assistant: received -> hi' }).Count -eq 1) -Message 'overlay fixture should normalize assistant label typo'
Assert-True -Condition (@($overlayLines | Where-Object { $_ -like 'system: MCP details:*' }).Count -eq 1) -Message 'overlay fixture should normalize system label typo'
Assert-True -Condition (@($overlayStrictLines | Where-Object { $_ -eq 'assistant: received -> hi' }).Count -eq 0) -Message 'strict events mode should drop assistant lines that start from corrupted labels'
Assert-True -Condition (@($overlayStrictLines | Where-Object { $_ -like 'system: MCP details:*' }).Count -eq 0) -Message 'strict events mode should drop system lines that start from corrupted labels'
Assert-True -Condition (@($overlayStrictLines | Where-Object { $_ -eq 'user: hi' }).Count -eq 1) -Message 'strict events mode should keep canonical user line'
Assert-True -Condition (@($overlayStrictLines | Where-Object { $_ -like 'fastcode | mode: edit | status: idle | mcp: error r1 d0 | size: 80x24' }).Count -eq 1) -Message 'strict events mode should keep status snapshot'

$resizeBurstInputPath = Join-Path $tmpDir 'resize-burst-long-details.log'
$resizeBurstOutputPath = Join-Path $tmpDir 'resize-burst-long-details.clean.log'
$resizeBurstSummaryPath = Join-Path $tmpDir 'resize-burst-long-details.summary.json'
$resizeBurstNoDedupeOutputPath = Join-Path $tmpDir 'resize-burst-long-details.nodedupe.clean.log'
$resizeBurstNoDedupeSummaryPath = Join-Path $tmpDir 'resize-burst-long-details.nodedupe.summary.json'
$resizeBurstTemplate = Get-Content -Raw -Path $resizeBurstFixtureTemplatePath
$resizeBurstContent = $resizeBurstTemplate.Replace('<ESC>', [string]$esc)
Set-Content -Path $resizeBurstInputPath -Value $resizeBurstContent -Encoding utf8

powershell -ExecutionPolicy Bypass -File $scriptPath -InputPath $resizeBurstInputPath -OutputPath $resizeBurstOutputPath -Mode events -StrictEvents -MaxEventLength 100 -SummaryPath $resizeBurstSummaryPath | Out-Null
powershell -ExecutionPolicy Bypass -File $scriptPath -InputPath $resizeBurstInputPath -OutputPath $resizeBurstNoDedupeOutputPath -Mode events -StrictEvents -NoDedupe -MaxEventLength 100 -SummaryPath $resizeBurstNoDedupeSummaryPath | Out-Null
$resizeBurstLines = Get-Content $resizeBurstOutputPath
$resizeBurstSummary = Get-Content -Raw $resizeBurstSummaryPath | ConvertFrom-Json
$resizeBurstNoDedupeLines = Get-Content $resizeBurstNoDedupeOutputPath
$resizeBurstNoDedupeSummary = Get-Content -Raw $resizeBurstNoDedupeSummaryPath | ConvertFrom-Json

Assert-True -Condition (@($resizeBurstLines | Where-Object { $_ -eq 'fastcode | mode: edit | status: idle | mcp: ok r1 d0 | size: 120x40' }).Count -eq 1) -Message 'resize burst fixture should keep first status snapshot'
Assert-True -Condition (@($resizeBurstLines | Where-Object { $_ -eq 'fastcode | mode: edit | status: idle | mcp: ok r2 d0 | size: 80x24' }).Count -eq 1) -Message 'resize burst fixture should dedupe adjacent duplicate status snapshot'
Assert-True -Condition (@($resizeBurstLines | Where-Object { $_ -eq 'user: open diagnostics' }).Count -eq 1) -Message 'resize burst fixture should keep user event'
Assert-True -Condition (@($resizeBurstLines | Where-Object { $_ -eq 'assistant: details rendered' }).Count -eq 1) -Message 'resize burst fixture should keep assistant event'
Assert-True -Condition (@($resizeBurstLines | Where-Object { $_ -like 'system: MCP details:* ...' }).Count -eq 1) -Message 'resize burst fixture should truncate long system details with marker'
Assert-True -Condition ($resizeBurstSummary.strict_events -eq $true) -Message 'resize burst summary should report strict events mode'
Assert-True -Condition ($resizeBurstSummary.status_event_count -eq 2) -Message 'resize burst summary should report two status events'
Assert-True -Condition ($resizeBurstSummary.message_event_count -eq 3) -Message 'resize burst summary should report three message events'
Assert-True -Condition ($resizeBurstSummary.system_event_count -eq 1) -Message 'resize burst summary should report one system event'
Assert-True -Condition ($resizeBurstSummary.user_event_count -eq 1) -Message 'resize burst summary should report one user event'
Assert-True -Condition ($resizeBurstSummary.assistant_event_count -eq 1) -Message 'resize burst summary should report one assistant event'
Assert-True -Condition ($resizeBurstSummary.label_event_count_sum -eq 3) -Message 'resize burst summary should report label event sum'
Assert-True -Condition ($resizeBurstSummary.label_sum_matches_message_count -eq $true) -Message 'resize burst summary should report matching label sum invariant'
Assert-True -Condition ($resizeBurstSummary.status_to_message_ratio_bps -eq 6667) -Message 'resize burst summary should report status/message ratio basis points'
Assert-True -Condition ($resizeBurstSummary.status_share_of_total_events_bps -eq 4000) -Message 'resize burst summary should report status share of total events basis points'
Assert-True -Condition ($resizeBurstSummary.dedupe_suppressed_count -eq 1) -Message 'resize burst summary should report one deduped duplicate'
Assert-True -Condition ($resizeBurstSummary.truncated_count -eq 1) -Message 'resize burst summary should report one truncated long detail line'
Assert-True -Condition (($resizeBurstSummary.system_event_count + $resizeBurstSummary.user_event_count + $resizeBurstSummary.assistant_event_count) -eq $resizeBurstSummary.message_event_count) -Message 'resize burst summary per-label totals should match message event count'
Assert-True -Condition (@($resizeBurstNoDedupeLines | Where-Object { $_ -eq 'fastcode | mode: edit | status: idle | mcp: ok r2 d0 | size: 80x24' }).Count -eq 2) -Message 'NoDedupe run should keep both duplicate status snapshots'
Assert-True -Condition ($resizeBurstNoDedupeSummary.strict_events -eq $true) -Message 'NoDedupe summary should report strict events mode'
Assert-True -Condition ($resizeBurstNoDedupeSummary.dedupe_enabled -eq $false) -Message 'NoDedupe summary should report dedupe disabled'
Assert-True -Condition ($resizeBurstNoDedupeSummary.status_event_count -eq 3) -Message 'NoDedupe summary should report three status events when duplicates are retained'
Assert-True -Condition ($resizeBurstNoDedupeSummary.message_event_count -eq 3) -Message 'NoDedupe summary should preserve message event count'
Assert-True -Condition ($resizeBurstNoDedupeSummary.label_event_count_sum -eq 3) -Message 'NoDedupe summary should report label event sum'
Assert-True -Condition ($resizeBurstNoDedupeSummary.label_sum_matches_message_count -eq $true) -Message 'NoDedupe summary should report matching label sum invariant'
Assert-True -Condition ($resizeBurstNoDedupeSummary.status_to_message_ratio_bps -eq 10000) -Message 'NoDedupe summary should report status/message ratio basis points'
Assert-True -Condition ($resizeBurstNoDedupeSummary.status_share_of_total_events_bps -eq 5000) -Message 'NoDedupe summary should report status share of total events basis points'
Assert-True -Condition ($resizeBurstNoDedupeSummary.dedupe_suppressed_count -eq 0) -Message 'NoDedupe summary should report zero deduped lines'
Assert-True -Condition ($resizeBurstNoDedupeSummary.truncated_count -eq 1) -Message 'NoDedupe summary should retain truncation count for long details'
Assert-True -Condition (($resizeBurstNoDedupeSummary.system_event_count + $resizeBurstNoDedupeSummary.user_event_count + $resizeBurstNoDedupeSummary.assistant_event_count) -eq $resizeBurstNoDedupeSummary.message_event_count) -Message 'NoDedupe summary per-label totals should match message event count'

Write-Host 'normalize-tui-log fixture tests: PASS'

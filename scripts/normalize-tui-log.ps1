param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [string]$OutputPath,

  [ValidateSet('strip', 'events')]
  [string]$Mode = 'events',

  [ValidateRange(40, 4000)]
  [int]$MaxEventLength = 240,

  [switch]$NoDedupe,

  [switch]$EmitSummary,

  [string]$SummaryPath,

  [ValidateSet('json', 'compact')]
  [string]$SummaryFormat = 'json',

  [switch]$StrictEvents
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-OutputPath {
  param(
    [string]$SourcePath,
    [string]$RequestedOutputPath
  )

  if ($RequestedOutputPath) {
    return $RequestedOutputPath
  }

  $directory = Split-Path -Parent $SourcePath
  if (-not $directory) {
    $directory = '.'
  }

  $filename = Split-Path -Leaf $SourcePath
  return (Join-Path $directory ($filename + '.clean.log'))
}

function Remove-AnsiSequences {
  param([string]$Text)

  $esc = [char]27
  $bel = [char]7
  $normalized = $Text

  $patterns = @(
    # ANSI CSI
    ([string]::Format('{0}\[[0-?]*[ -/]*[@-~]', [Regex]::Escape($esc))),
    # OSC
    ([string]::Format('{0}\][^{1}]*(?:{1}|{0}\\\\)', [Regex]::Escape($esc), [Regex]::Escape($bel))),
    # DCS
    ([string]::Format('{0}P[\\s\\S]*?{0}\\\\', [Regex]::Escape($esc))),
    # Single-char escape
    ([string]::Format('{0}[@-Z\\\\-_]', [Regex]::Escape($esc)))
  )

  foreach ($pattern in $patterns) {
    $normalized = [Regex]::Replace($normalized, $pattern, '')
  }

  # If an escape byte was dropped by shell redirection, strip residual cursor tokens.
  $normalized = [Regex]::Replace($normalized, '\[[0-9;?]*[A-Za-z]', '')

  # Apply backspace semantics.
  do {
    $before = $normalized
    $normalized = [Regex]::Replace($normalized, '.\x08', '')
  } while ($normalized -ne $before)

  # Remove remaining control bytes except tab/newline.
  $normalized = [Regex]::Replace($normalized, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '')

  return $normalized
}

function Extract-TuiEvents {
  param(
    [string]$Text,
    [int]$LineMaxLength,
    [bool]$DisableDedupe,
    [bool]$StrictMode
  )

  $events = [System.Collections.Generic.List[string]]::new()
  $candidateCount = 0
  $dedupeSuppressed = 0
  $truncatedCount = 0
  $statusEventCount = 0
  $messageEventCount = 0
  $systemEventCount = 0
  $userEventCount = 0
  $assistantEventCount = 0
  $normalized = [Regex]::Replace($Text, '[^\x09\x0A\x0D\x20-\x7E]', ' ')
  $statusPattern = 'fastcode\s*\|\s*mode:\s*[A-Za-z]+\s*\|\s*status:\s*[A-Za-z]+\s*\|\s*mcp:\s*[A-Za-z0-9\- ]+\s*\|\s*size:\s*\d+x\d+'
  $messageStartLabels = if ($StrictMode) { '(?:system|user|assistant)' } else { '(?:system|sytem|user|uer|assistant|asistant)' }
  $messageStopLabels = '(?:system|sytem|user|uer|assistant|asistant)'
  $tokenPattern = "(?<status>$statusPattern)|(?<message>${messageStartLabels}:\s*.*?)(?=(?:fastcode\s*\|\s*mode:|${messageStopLabels}:|$))"
  $matches = [Regex]::Matches($normalized, $tokenPattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)

  foreach ($match in $matches) {
    $line = $null
    if ($match.Groups['status'].Success) {
      $line = $match.Groups['status'].Value
    } elseif ($match.Groups['message'].Success) {
      $line = $match.Groups['message'].Value
    }

    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }

    $line = [Regex]::Replace($line, '\s+', ' ').Trim()
    $line = [Regex]::Replace($line, '[^\x20-\x7E]', '')
    $line = [Regex]::Replace($line, '\s+', ' ').Trim()
    $line = $line -replace '^(system|user|assistant):(?=\S)', '$1: '
    if (-not $StrictMode) {
      $line = $line -replace '\bsytem:', 'system:'
      $line = $line -replace '\basistant:', 'assistant:'
      $line = $line -replace '\buer:', 'user:'
    }

    $lineLabelPattern = if ($StrictMode) { '(?:system|user|assistant)' } else { '(?:system|sytem|user|uer|assistant|asistant)' }
    if ($line -match "^${lineLabelPattern}:") {
      $line = [Regex]::Match($line, "^(?:$lineLabelPattern):\s*.*?(?=\b(?:$messageStopLabels):|$)").Value
      $line = [Regex]::Replace($line, '\s+', ' ').Trim()
    }

    if ($StrictMode -and $line -notmatch '^fastcode\s*\|' -and $line -notmatch '^(?:system|user|assistant):') {
      continue
    }

    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }

    $candidateCount++

    if ($line.Length -gt $LineMaxLength) {
      $truncatedCount++
      $line = $line.Substring(0, $LineMaxLength) + ' ...'
    }

    if (-not $DisableDedupe) {
      $lastIndex = $events.Count - 1
      if ($lastIndex -ge 0 -and $events[$lastIndex] -eq $line) {
        $dedupeSuppressed++
        continue
      }
    }

    if ($line -match '^fastcode\s*\|') {
      $statusEventCount++
    } elseif ($line -match '^system:') {
      $messageEventCount++
      $systemEventCount++
    } elseif ($line -match '^user:') {
      $messageEventCount++
      $userEventCount++
    } elseif ($line -match '^assistant:') {
      $messageEventCount++
      $assistantEventCount++
    }

    $events.Add($line)
  }

  return [PSCustomObject]@{
    text = ($events -join [Environment]::NewLine)
    candidate_count = $candidateCount
    output_line_count = $events.Count
    dedupe_suppressed_count = $dedupeSuppressed
    truncated_count = $truncatedCount
    status_event_count = $statusEventCount
    message_event_count = $messageEventCount
    system_event_count = $systemEventCount
    user_event_count = $userEventCount
    assistant_event_count = $assistantEventCount
  }
}

function Format-Summary {
  param(
    [hashtable]$Summary,
    [string]$Format
  )

  if ($Format -eq 'compact') {
    $parts = [System.Collections.Generic.List[string]]::new()
    foreach ($key in $Summary.Keys) {
      $value = $Summary[$key]
      if ($null -eq $value) {
        continue
      }

      $parts.Add("$key=$value")
    }

    return ($parts -join ' ')
  }

  return ($Summary | ConvertTo-Json)
}

$resolvedInputPath = Resolve-Path $InputPath -ErrorAction Stop
$outputPath = Resolve-OutputPath -SourcePath $resolvedInputPath -RequestedOutputPath $OutputPath
$inputBytes = (Get-Item $resolvedInputPath).Length

$raw = Get-Content -Raw -Path $resolvedInputPath
$raw = $raw -replace "`r`n", "`n"
$raw = $raw -replace "`r", "`n"

$clean = Remove-AnsiSequences -Text $raw
$eventStats = $null
if ($Mode -eq 'events') {
  $eventStats = Extract-TuiEvents -Text $clean -LineMaxLength $MaxEventLength -DisableDedupe $NoDedupe.IsPresent -StrictMode $StrictEvents.IsPresent
  $clean = $eventStats.text
}

$directory = Split-Path -Parent $outputPath
if ($directory -and -not (Test-Path $directory)) {
  New-Item -ItemType Directory -Path $directory | Out-Null
}

Set-Content -Path $outputPath -Value $clean -Encoding utf8
$outputBytes = (Get-Item $outputPath).Length
Write-Host "normalized log written: $outputPath"
Write-Host "mode: $Mode"
if ($Mode -eq 'events') {
  Write-Host "max_event_length: $MaxEventLength"
  Write-Host "dedupe: $(-not $NoDedupe.IsPresent)"
  Write-Host "strict_events: $($StrictEvents.IsPresent)"
}

if ($EmitSummary.IsPresent -or $SummaryPath) {
  $summary = [ordered]@{
    mode = $Mode
    input_path = [string]$resolvedInputPath
    output_path = $outputPath
    input_bytes = $inputBytes
    output_bytes = $outputBytes
    output_line_count = @(($clean -split "`n") | Where-Object { $_.Length -gt 0 }).Count
  }

  if ($Mode -eq 'events' -and $null -ne $eventStats) {
    $labelEventCountSum = $eventStats.system_event_count + $eventStats.user_event_count + $eventStats.assistant_event_count
    $statusToMessageRatioBps = $null
    if ($eventStats.message_event_count -gt 0) {
      $statusToMessageRatioBps = [int][Math]::Round((10000.0 * $eventStats.status_event_count) / $eventStats.message_event_count)
    }
    $summary.max_event_length = $MaxEventLength
    $summary.dedupe_enabled = (-not $NoDedupe.IsPresent)
    $summary.strict_events = $StrictEvents.IsPresent
    $summary.event_candidate_count = $eventStats.candidate_count
    $summary.event_output_line_count = $eventStats.output_line_count
    $summary.status_event_count = $eventStats.status_event_count
    $summary.message_event_count = $eventStats.message_event_count
    $summary.system_event_count = $eventStats.system_event_count
    $summary.user_event_count = $eventStats.user_event_count
    $summary.assistant_event_count = $eventStats.assistant_event_count
    $summary.label_event_count_sum = $labelEventCountSum
    $summary.label_sum_matches_message_count = ($labelEventCountSum -eq $eventStats.message_event_count)
    $summary.status_to_message_ratio_bps = $statusToMessageRatioBps
    $summary.dedupe_suppressed_count = $eventStats.dedupe_suppressed_count
    $summary.truncated_count = $eventStats.truncated_count
  }

  $summaryContent = Format-Summary -Summary $summary -Format $SummaryFormat
  if ($EmitSummary.IsPresent) {
    Write-Host 'summary:'
    Write-Host $summaryContent
  }

  if ($SummaryPath) {
    $summaryDirectory = Split-Path -Parent $SummaryPath
    if ($summaryDirectory -and -not (Test-Path $summaryDirectory)) {
      New-Item -ItemType Directory -Path $summaryDirectory | Out-Null
    }

    Set-Content -Path $SummaryPath -Value $summaryContent -Encoding utf8
    Write-Host "summary written: $SummaryPath"
  }
}

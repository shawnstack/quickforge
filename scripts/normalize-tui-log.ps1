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

  [string]$SummaryPath
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
    [bool]$DisableDedupe
  )

  $events = [System.Collections.Generic.List[string]]::new()
  $candidateCount = 0
  $dedupeSuppressed = 0
  $truncatedCount = 0
  $normalized = [Regex]::Replace($Text, '[^\x09\x0A\x0D\x20-\x7E]', ' ')
  $statusPattern = 'fastcode \| mode: [A-Za-z]+ \| status: [A-Za-z]+ \| mcp: [A-Za-z0-9\- ]+ \| size: \d+x\d+'
  $tokenPattern = '(?<status>fastcode \| mode: [A-Za-z]+ \| status: [A-Za-z]+ \| mcp: [A-Za-z0-9\- ]+ \| size: \d+x\d+)|(?<message>(?:system|user|assistant):\s*.*?)(?=(?:fastcode \| mode:|system:|user:|assistant:|$))'
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

    $events.Add($line)
  }

  return [PSCustomObject]@{
    text = ($events -join [Environment]::NewLine)
    candidate_count = $candidateCount
    output_line_count = $events.Count
    dedupe_suppressed_count = $dedupeSuppressed
    truncated_count = $truncatedCount
  }
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
  $eventStats = Extract-TuiEvents -Text $clean -LineMaxLength $MaxEventLength -DisableDedupe $NoDedupe.IsPresent
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
    $summary.max_event_length = $MaxEventLength
    $summary.dedupe_enabled = (-not $NoDedupe.IsPresent)
    $summary.event_candidate_count = $eventStats.candidate_count
    $summary.event_output_line_count = $eventStats.output_line_count
    $summary.dedupe_suppressed_count = $eventStats.dedupe_suppressed_count
    $summary.truncated_count = $eventStats.truncated_count
  }

  $summaryJson = $summary | ConvertTo-Json
  if ($EmitSummary.IsPresent) {
    Write-Host 'summary:'
    Write-Host $summaryJson
  }

  if ($SummaryPath) {
    $summaryDirectory = Split-Path -Parent $SummaryPath
    if ($summaryDirectory -and -not (Test-Path $summaryDirectory)) {
      New-Item -ItemType Directory -Path $summaryDirectory | Out-Null
    }

    Set-Content -Path $SummaryPath -Value $summaryJson -Encoding utf8
    Write-Host "summary written: $SummaryPath"
  }
}

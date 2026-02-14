param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [string]$OutputPath,

  [ValidateSet('strip', 'events')]
  [string]$Mode = 'events',

  [ValidateRange(40, 4000)]
  [int]$MaxEventLength = 240,

  [switch]$NoDedupe
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

    if ($line.Length -gt $LineMaxLength) {
      $line = $line.Substring(0, $LineMaxLength) + ' ...'
    }

    if (-not $DisableDedupe) {
      $lastIndex = $events.Count - 1
      if ($lastIndex -ge 0 -and $events[$lastIndex] -eq $line) {
        continue
      }
    }

    $events.Add($line)
  }

  return ($events -join [Environment]::NewLine)
}

$resolvedInputPath = Resolve-Path $InputPath -ErrorAction Stop
$outputPath = Resolve-OutputPath -SourcePath $resolvedInputPath -RequestedOutputPath $OutputPath

$raw = Get-Content -Raw -Path $resolvedInputPath
$raw = $raw -replace "`r`n", "`n"
$raw = $raw -replace "`r", "`n"

$clean = Remove-AnsiSequences -Text $raw
if ($Mode -eq 'events') {
  $clean = Extract-TuiEvents -Text $clean -LineMaxLength $MaxEventLength -DisableDedupe $NoDedupe.IsPresent
}

$directory = Split-Path -Parent $outputPath
if ($directory -and -not (Test-Path $directory)) {
  New-Item -ItemType Directory -Path $directory | Out-Null
}

Set-Content -Path $outputPath -Value $clean -Encoding utf8
Write-Host "normalized log written: $outputPath"
Write-Host "mode: $Mode"
if ($Mode -eq 'events') {
  Write-Host "max_event_length: $MaxEventLength"
  Write-Host "dedupe: $(-not $NoDedupe.IsPresent)"
}

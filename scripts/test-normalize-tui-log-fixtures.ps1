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

Write-Host 'normalize-tui-log fixture tests: PASS'

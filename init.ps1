$ErrorActionPreference = "Stop"

function Require-Command([string]$Name, [string]$InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Write-Error "Missing prerequisite: $Name. $InstallHint"
    exit 1
  }
}

Require-Command "rustc" "Install Rust via https://rustup.rs"
Require-Command "cargo" "Install Rust via https://rustup.rs"
Require-Command "git" "Install Git via https://git-scm.com/download/win"

$env:CARGO_HTTP_CHECK_REVOKE = "false"
$env:CARGO_NET_GIT_FETCH_WITH_CLI = "true"
Write-Host "Configured Cargo TLS/workaround env: CARGO_HTTP_CHECK_REVOKE=false, CARGO_NET_GIT_FETCH_WITH_CLI=true"

Write-Host "[1/3] Fetching Rust dependencies..."
cargo fetch

Write-Host "[2/3] Building project..."
cargo build

Write-Host "[3/3] Running unit tests..."
cargo test

Write-Host "Environment bootstrap complete."
Write-Host "Run app: cargo run -- --mode edit"
Write-Host "Credentials placeholder: `$env:OPENAI_API_KEY = '<your-key>'"
Write-Host "Service endpoint placeholder: https://api.openai.com/v1"

#!/usr/bin/env sh
set -eu

if ! command -v rustc >/dev/null 2>&1; then
  echo "ERROR: rustc is required. Install Rust from https://rustup.rs" >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "ERROR: cargo is required. Install Rust toolchain from https://rustup.rs" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is required." >&2
  exit 1
fi

export CARGO_HTTP_CHECK_REVOKE=false
export CARGO_NET_GIT_FETCH_WITH_CLI=true
echo "Configured Cargo TLS/workaround env: CARGO_HTTP_CHECK_REVOKE=false, CARGO_NET_GIT_FETCH_WITH_CLI=true"

echo "[1/3] Fetching Rust dependencies..."
cargo fetch

echo "[2/3] Building project..."
cargo build

echo "[3/3] Running unit tests..."
cargo test

echo "Environment bootstrap complete."
echo "Run app: cargo run -- --mode edit"
echo "Credentials: export OPENAI_API_KEY=\"<your-key>\" (placeholder)"
echo "Service endpoint (placeholder): https://api.openai.com/v1"

# FastCode

Rust-native TUI coding assistant baseline for long-running autonomous development sessions.

## Project Goal
- Migrate HappyCode (TypeScript + Ink) architecture into Rust + Ratatui + Tokio.
- Keep workflows auditable across sessions via explicit handoff artifacts.
- Build a safe-by-default coding assistant with policy and approval controls.

## Architecture Overview
- `src/main.rs`: CLI entrypoint (bootstrap runtime mode argument).
- `src/lib.rs`: shared library surface for incremental module growth.
- `tests/`: integration and workflow test suite (to be expanded).
- `docs/`: architecture notes, migration details, and verification evidence.
- `scripts/`: automation helpers (future additions).

Authoritative workflow artifacts:
- `app_spec.txt`: requirement baseline.
- `feature_list.json`: single source of truth for execution/verification status.
- `claude-progress.txt`: cross-session continuity log.

## Prerequisites
- Rust toolchain (`rustc`, `cargo`) 1.92+
- Git

## Environment Setup
PowerShell:
```powershell
./init.ps1
```

POSIX shell:
```bash
sh ./init.sh
```

## Run
```bash
cargo run -- --mode edit
```

Launch TUI:
```bash
cargo run -- --mode edit --tui
```

Launch TUI with MCP diagnostics from config:
```bash
cargo run -- --mode edit --tui --mcp-config ./docs/mcp-servers.example.json
```

When `--mcp-config` is provided, TUI now refreshes MCP diagnostics continuously and shows status counters in the status bar (`mcp: <state> rN dN`, where `rN` is refresh cycles and `dN` is suppressed duplicate refresh summaries for the current MCP status label).
Long MCP diagnostics messages are compacted in the message area with a truncation marker (for example `... (+129 chars)`) to keep narrow terminals readable.
Consecutive identical MCP refresh summaries are deduplicated in the message area to avoid repeated spam while the status-bar refresh counter still advances.
If an MCP refresh cycle returns no summary text, TUI emits a fallback diagnostics message instead of dropping the refresh event.
Use `--mcp-refresh-ms <N>` to override the default refresh interval (800ms).
Allowed range is `50..=60000` milliseconds.
You can also set `FASTCODE_MCP_REFRESH_MS=<N>` for session-wide defaults (`--mcp-refresh-ms` takes precedence), using the same range.

```bash
cargo run -- --mode edit --tui --mcp-config ./docs/mcp-servers.example.json --mcp-refresh-ms 200
```

List MCP servers from config:
```bash
cargo run -- --mode edit mcp list --mcp-config ./docs/mcp-servers.example.json
```

Check MCP lifecycle (start, health, shutdown) from config:
```bash
cargo run -- --mode edit mcp check-lifecycle --mcp-config ./docs/mcp-servers.example.json
```

Check MCP lifecycle and append audit JSONL records:
```bash
cargo run -- --mode edit mcp check-lifecycle --mcp-config ./docs/mcp-servers.example.json --audit-log ./docs/mcp-lifecycle-audit.jsonl
```

TUI controls:
- Type to edit input.
- `Enter` submits message.
- `Up`/`Down` scroll message area.
- `v` appends full latest MCP diagnostics details into the message area.
- `q` quits TUI.

Scripted TUI verification (for deterministic CI/session evidence):
- `FASTCODE_TUI_SCRIPT` supports key tokens (`h`, `Enter`, `Up`, `Down`, `Backspace`, `q`), waits (`sleep80`/`wait80`), and resizes (`resize120x40`).
- Example:
```powershell
$env:FASTCODE_TUI_SCRIPT='h,e,l,l,o,Enter,sleep80,resize120x40,Up,Down,q'
cargo run -- --mode edit --tui
```

Normalize ANSI-heavy TUI logs into machine-parsable evidence:
```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/normalize-tui-log.ps1 -InputPath ./target/regression-ui-mcp-iter32.log -OutputPath ./target/regression-ui-mcp-iter32.clean.log -Mode events
```
Modes:
- `events` (default): extracts status/user/system/assistant snapshots and deduplicates adjacent duplicates.
- `strip`: removes ANSI/control sequences but keeps full text.
Options:
- `-MaxEventLength <N>`: line-length cap used in `events` mode (default `240`, range `40..4000`).
- `-NoDedupe`: disables adjacent-duplicate suppression in `events` mode.
- `-StrictEvents`: keeps only high-confidence canonical `system/user/assistant` message labels in `events` mode (drops overlay-corrupted labels such as `sytem/asistant/uer`).
- `-EmitSummary`: prints JSON normalization summary to stdout (bytes, output lines, and `events` mode counters).
- `-SummaryPath <path>`: writes the same JSON summary to a file for audit evidence.
- `-SummaryFormat <json|compact>`: selects summary encoding for `-EmitSummary` and `-SummaryPath` (`json` default; `compact` emits single-line `key=value` pairs for CI/grep).

Script-level behavior checks:
```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/test-normalize-tui-log.ps1
powershell -ExecutionPolicy Bypass -File ./scripts/test-normalize-tui-log-fixtures.ps1
```

## Test and Lint
Test:
```bash
cargo test
```

Fmt check:
```bash
cargo fmt -- --check
```

Clippy:
```bash
cargo clippy --all-targets --all-features -- -D warnings
```

Cold-start timing baseline (PowerShell):
```powershell
./scripts/measure-cold-start.ps1
```

## Debug
- Enable backtrace:
  - PowerShell: `$env:RUST_BACKTRACE = "1"`
  - POSIX: `export RUST_BACKTRACE=1`
- Run with verbose cargo output:
```bash
cargo run -v -- --mode edit
```

## Verification Workflow
1. Read `app_spec.txt` and `feature_list.json` first.
2. Pick highest-priority `passes=false` item.
3. Implement + gather evidence.
4. Update only status-related fields (`passes`, `evidence`, `notes`, `blocked`) unless explicitly changing scope.
5. Log results in `claude-progress.txt`.

## Troubleshooting
- `cargo: command not found`: install Rust via `rustup` and restart terminal.
- Build fails after dependency changes: run `cargo clean` then `cargo build`.
- Test mismatch across sessions: ensure latest `feature_list.json` and `claude-progress.txt` are committed.
- MCP listing fails with config error: validate JSON shape against `docs/mcp-servers.example.json`.
- TUI MCP diagnostics shows `invalid-config`: ensure the JSON file is valid UTF-8 JSON and follows `docs/mcp-servers.example.json` schema.
- MCP lifecycle check fails due missing config: run with `mcp check-lifecycle --mcp-config <path>`.
- MCP lifecycle audit missing: provide `--audit-log <path-to-jsonl>` when running lifecycle check.
- MCP lifecycle startup fails for one server: output now includes partial cleanup counts (`started N ... stopped M`); inspect `mcp_lifecycle:start:*` and `mcp_lifecycle:shutdown:*` records in the audit JSONL for exact failure stage.

## State Tracking Files
- Checklist: `feature_list.json`
- Progress log: `claude-progress.txt`
- Requirement baseline: `app_spec.txt`

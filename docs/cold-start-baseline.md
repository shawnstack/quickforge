# Cold Start Build Baseline

This baseline tracks clean `cargo build` times for optimization work.

Source of truth:
- `docs/cold-start-baseline.jsonl` (one JSON record per run)

Capture command (PowerShell):
```powershell
./scripts/measure-cold-start.ps1
```

Notes:
- Default behavior removes `target/` before timing.
- Use `-NoClean` to record a warm build.

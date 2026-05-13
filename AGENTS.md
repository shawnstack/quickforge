## Project instructions

- Do not assume requirements. If ambiguous, state assumptions or ask.
- Prefer the simplest solution that satisfies the request.
- Make surgical changes only. Do not refactor unrelated code.
- Match existing style.
- For multi-step work, use a brief plan.
- After code changes, verify with relevant tests, build, lint, or targeted commands.
- When the user says “发布一个小版本” / “发一个小版本” / “小版本发布”, follow `docs/architecture/patch-release-runbook.zh-CN.md`: bump patch version, update release docs, run build/lint, generate runtime/offline packages, create Git commit/tag/push, then provide npm publish commands instead of publishing npm by default.

## Project instructions

- After code changes, verify with relevant tests, build, lint, or targeted commands.
- When the user says “发布一个小版本” / “发一个小版本” / “小版本发布”, follow `docs/architecture/patch-release-runbook.zh-CN.md`: bump patch version, update release docs, run build/lint, generate runtime/offline packages, create Git commit/tag/push, then provide npm publish commands instead of publishing npm by default.

## Code Wiki

- 项目代码 Wiki 位于 `docs/wiki/README.md`。
- 在理解模块、定位入口、进行较大变更或新人接手类任务时，优先读取 `docs/wiki/README.md`，再按需读取对应子目录文档。
- Wiki 仅作为导航和背景资料，最终判断以源码、配置和测试结果为准。

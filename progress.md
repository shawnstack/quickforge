# Progress

## Current State

- Feature: `release-v1.7.7-prep`
- Status: `done`（v1.7.7 完整 test/lint/build 与打包已通过；本地 release commit c3771444... / annotated tag v1.7.7 已创建；远端 master 与 v1.7.7 tag push 完成并经 ls-remote 核验，均指向 c3771444...；npm publish 未执行）
- Goal: 将本地三个 fix 与 Cloud URL 改动纳入 v1.7.7 发布：版本提升、CHANGELOG 更新、test/lint/build 门禁、离线包生成与核验、远端 Git 发布。
- Files: package.json, package-lock.json, CHANGELOG.md, server/cloud/config.mjs, tests/server/cloud/*, scripts/prepare-patch-release.cjs, AGENTS.md, .github/PULL_REQUEST_TEMPLATE.md, docs/architecture/patch-release-runbook.zh-CN.md, docs/wiki/*, init.sh（纳入发布范围，无需修改）, feature_list.json, progress.md, session-handoff.md
- Blockers: 无。npm publish 未执行，仅待用户需要时手动执行。
- Next step: 无待办；如用户需要发布 npm 包，手动执行 `cd package-offline && npm publish --access public`（默认不执行）。
- Last Updated: 2026-08-12

## Completed Work

- 已有滚动压缩后，只要出现一条新消息即可再次执行阈值检查，不再固定等待三条新增消息。
- 压缩完成后忽略保留尾部中代表压缩前完整上下文的陈旧 provider usage，立即按 compact summary + tail 重新估算百分比。
- 压缩后出现新的 assistant provider usage 时自动恢复 provider 权威统计；兼容旧压缩元数据和 rollback 后重发场景。
- 补充自动压缩 usage、再次检查、legacy 时间戳和 rollback 重发回归测试。
- 同步更新 server Wiki。
- settings-tab-select-alignment：设置页下拉框宽度对齐（语言/默认 Harness 等行复用 quickforge-settings-row-control-wide）；并在 `.quickforge-settings-select-trigger-label` 显式设置 font-size: 0.9rem / line-height: 1.35，使收起态已选值与菜单选项字号一致。改动文件：src/index.css、src/lib/default-options-settings-tab.ts（保留此前两处 wide 修改）。

## Verification Evidence

- `npx vitest run tests/server/auto-compaction.test.mjs tests/server/agent-manager.rollback-compaction.test.mjs`：exit code 0，2 个测试文件、14 项测试通过。
- `npx eslint server/context-usage.mjs server/auto-compaction.mjs tests/server/auto-compaction.test.mjs`：exit code 0。
- `npm run test`：exit code 0，141 个测试文件、1088 项测试全部通过。
- `npm run lint`：exit code 0；仅 7 个既有 warning（desktop/nsis-patch/apply.mjs 的 no-console、server/cloud/identity.mjs 的 no-useless-assignment），无 error。
- `npm run build`：exit code 0；仅既有 KaTeX 字体解析与大 chunk warning。
- settings-tab-select-alignment 验证：`npm run lint` exit code 0，仅 7 个既有 warning（desktop/nsis-patch/apply.mjs no-console、server/cloud/identity.mjs no-useless-assignment），无 error；`npm run build` exit code 0，仅既有 KaTeX 字体与大 chunk warning。
- 独立 Explore 代码审查：两个修复无阻断问题；回滚后 provider usage 恢复边界已按建议修正并补测试。

## v1.7.7 发布准备与验证（2026-08-12）

- 版本：`npm version patch --no-git-tag-version`，package.json / package-lock.json（root 与 packages[""]）均为 1.7.7。
- CHANGELOG.md：Unreleased 整理为 `[1.7.7] - 2026-08-12`，含 Cloud URL 改动（HTTP 建议仅用于可信自建服务/内网网关，注明 Bearer token 明文风险）、三个 fix（auto-compaction 触发与 usage 刷新、settings select 对齐、NSIS 升级自愈）、Released 小节与 1.7.7 离线包命令；格式与 1.7.6 一致。
- README.md：核查无硬编码版本（无 1.7.x/v1.7/shawnstack-quickforge- 引用），未做改动。
- 已纳入发布的既有改动（审查通过）：Cloud 配置/路由/测试、prepare-patch-release.cjs（test 门禁）、runbook（手动流程优先）、AGENTS.md（Startup/Verification/DoD）、PR 模板（test 勾选）、wiki（root-config、scripts）。init.sh 纳入发布范围但内容无需修改。
- 排除项：`.qf_staging/`、`artifacts/`、空文件 `c` 未纳入，未删除任何用户文件。

## Notes

- 工作区存在与本任务无关的并发改动和未跟踪项，已保留且未主动修改。
- `dist/` 为 build 生成产物，未手工修改。

## v1.7.7 门禁与打包结果（2026-08-12）

- `npm run test`：exit code 0，141 个测试文件 / 1088 项测试全部通过（100%）。
- `npm run lint`：exit code 0，0 error，1 个既有 warning（server/cloud/identity.mjs no-useless-assignment）。
- `npm run build`：exit code 0，仅既有 KaTeX 字体未解析与大 chunk warning。
- 打包：`node scripts/prepare-runtime-package.cjs`、`node scripts/prepare-offline-package.cjs`、`cd package-offline && npm pack` 均 exit 0。
- tarball：`package-offline/shawnstack-quickforge-1.7.7.tgz`，25.1 MB，291 文件；核验无 .qf_staging、artifacts、`c`、临时/日志/.env/node_modules/.git 内容。
- 未执行 commit/tag/push/publish；`dist/`、`package-dist/`、`package-offline/` 未手工修改。

## v1.7.7 远端 Git 发布完成（2026-08-12）

- GitHub 连接恢复：`git ls-remote --heads --tags origin` 成功（第 1 次尝试）。
- `git push origin master`：`2f4ecbb..c377144 master -> master` 成功。
- `git push origin v1.7.7`：`* [new tag] v1.7.7 -> v1.7.7` 成功（annotated tag，tag 对象 093904e...，peeled c3771444...）。
- 远端核验（ls-remote）：refs/heads/master = `c3771444ad8da9bd1e2d870fcfe7de6562cb4a57`；refs/tags/v1.7.7^{} = `c3771444ad8da9bd1e2d870fcfe7de6562cb4a57`。
- 状态提交 `docs(handoff): mark v1.7.7 git release complete` 已创建并推送至 origin master。
- npm publish 未执行（默认不发布）。

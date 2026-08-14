# Progress

## Current State

- Feature: `workspace-same-file-tab-reuse`
- Status: `done`（工作区重复预览同一文件时复用已有 tab：Reader 复用分支激活并置 loading、清除 error，复用现有加载 effect 重新读取；Browser 按同一底层文件路径/精确 web URL 查找已有 tab，命中则激活并递增 reloadNonce 触发 iframe 重载，未命中才新建；仅同 kind 去重。针对性测试 22+12+3=37 项通过、lint 0 error、build 通过）
- Goal: 重复预览同一文件时复用已有 tab、刷新内容并激活；不同文件仍新建 tab。
- Files: src/components/workspace/WorkspaceInspector.tsx, src/components/workspace/workspace-inspector-tabs.ts, src/components/workspace/workspace-tab-file-path.ts, src/components/preview/WebPreviewContent.tsx, tests/frontend/workspace-tab-file-path.test.ts, docs/wiki/src/components/README.md, feature_list.json, progress.md, session-handoff.md
- Blockers: 无。
- Next step: 无待办；如后续发布，遵循 patch-release-runbook（发布前必须完整 test/lint/build 通过）。
- Last Updated: 2026-08-13

## Completed Work

- Reader 复用：`openFileTab` 命中已有 `file:${path}` reader tab 时，激活 panel/reader tab 的同时将该 reader tab 置为 `loading: true`、`error: undefined`，由既有的 reader 加载 effect（`loadingReaderKeysRef` 去重）重新读取最新内容；新建路径不变。
- Browser 复用：`openPanelTab('browser', { url })` 改为先经新增纯函数 `findBrowserTabToReuse` 在 browser tab 中按 `browserPreviewReuseKey` 查找（本地文件路径归一化为 file key，兼容 `D:\` 与 `D:/` 分隔符；其余 URL 精确比较），命中则激活并递增 `WorkspacePanelTab.reloadNonce`（不持久化），未命中才新建 tab；`+` 菜单空 URL 打开仍每次新建（与既有行为一致）。
- 外部 reload token：`WorkspacePanelTab` 增加可选 `reloadNonce`，仅运行时使用，`serializePanelTabs`/`normalizePersistedPanelTabs` 不变，localStorage 序列化格式无变化；`WebPreviewContent` 增加可选 `externalReloadToken` prop，纳入 previewCheckKey 与 iframe key，重复预览时强制 iframe 重载。
- 纯函数与测试：`workspace-tab-file-path.ts` 新增 `browserPreviewReuseKey`、`findBrowserTabToReuse`；`tests/frontend/workspace-tab-file-path.test.ts` 新增 10 项（同文件复用、不同文件不复用、Windows 路径分隔符归一化、web URL 精确匹配、web/本地不互匹配、跨 kind 不去重、空 URL 不匹配等）。
- 仅同 kind 去重，不做 reader/browser 跨类型合并；未新增依赖，未改生成产物（dist/ 由 build 正常再生成）。

- 已有滚动压缩后，只要出现一条新消息即可再次执行阈值检查，不再固定等待三条新增消息。
- 压缩完成后忽略保留尾部中代表压缩前完整上下文的陈旧 provider usage，立即按 compact summary + tail 重新估算百分比。
- 压缩后出现新的 assistant provider usage 时自动恢复 provider 权威统计；兼容旧压缩元数据和 rollback 后重发场景。
- 补充自动压缩 usage、再次检查、legacy 时间戳和 rollback 重发回归测试。
- 同步更新 server Wiki。
- settings-tab-select-alignment：设置页下拉框宽度对齐（语言/默认 Harness 等行复用 quickforge-settings-row-control-wide）；并在 `.quickforge-settings-select-trigger-label` 显式设置 font-size: 0.9rem / line-height: 1.35，使收起态已选值与菜单选项字号一致。改动文件：src/index.css、src/lib/default-options-settings-tab.ts（保留此前两处 wide 修改）。

## Verification Evidence

- `npm run test`（workspace-same-file-tab-reuse）：exit code 0，141 个测试文件、1109 项测试全部通过（100%）。
- `npm run lint`：exit code 0，0 error，仅 1 个既有 warning（server/cloud/identity.mjs no-useless-assignment）。
- `npm run build`：exit code 0，仅既有 KaTeX 字体解析与大 chunk warning。
- `npx vitest run tests/frontend/workspace-tab-file-path.test.ts tests/frontend/workspace-inspector-tabs.test.ts tests/frontend/workspace-inspector-request.test.ts`（workspace-same-file-tab-reuse）：exit code 0，3 个测试文件、37 项测试全部通过（含新增 browserPreviewReuseKey / findBrowserTabToReuse 10 项测试）。
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

## 智能体操作菜单首项文案统一（2026-08-13）

- 改动：设置 → 智能体中，智能体操作菜单首项文案由 `openMenuAgent.builtin ? t('builtinAgentModelSettings') : t('editTask')` 统一为 `t('editTask')`，使内置/自定义智能体均显示“编辑”（t('editTask') 为 en 'Edit' / zh '编辑'）；仅改显示文案，onClick（openEditAgentDialog）等行为及其他逻辑不变。
- 改动文件：src/components/agent-profiles/AgentProfilesPage.tsx（1 行）、feature_list.json、progress.md、session-handoff.md。
- 验证：`npm run lint` exit code 0，0 error，仅 1 个既有 warning（server/cloud/identity.mjs no-useless-assignment）；`npm run build` exit code 0，仅既有 KaTeX 字体与大 chunk warning。无对应组件测试（纯 JSX 文案改动，无测试文件）。未新增依赖、未提交 Git、未手工修改生成目录（dist/ 由 build 正常再生成）。

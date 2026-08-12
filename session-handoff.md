# Session Handoff

- Feature: `release-v1.7.7-prep`
- Status: `done`（v1.7.7 完整 test/lint/build 与打包已通过；本地 release commit c3771444... / annotated tag v1.7.7 已创建；远端 master 与 v1.7.7 tag push 完成并经 ls-remote 核验，均指向 c3771444...；npm publish 未执行）
- Current Objective: 完成 v1.7.7 发布：版本提升 1.7.6→1.7.7、CHANGELOG 更新、test/lint/build 门禁全通过、离线包生成并核验、远端 master/tag 推送完成。
- Files touched: package.json, package-lock.json, CHANGELOG.md, server/cloud/config.mjs, tests/server/cloud/config.test.mjs, tests/server/routes/cloud.test.mjs, scripts/prepare-patch-release.cjs, AGENTS.md, .github/PULL_REQUEST_TEMPLATE.md, docs/architecture/patch-release-runbook.zh-CN.md, docs/wiki/root-config.md, docs/wiki/scripts/README.md, init.sh（纳入发布，未改动）, feature_list.json, progress.md, session-handoff.md
- Blockers: 无。npm publish 未执行，仅待用户需要时手动执行。
- Recommended Next Step: 无待办；如用户需要发布 npm 包，手动执行 `cd package-offline && npm publish --access public`（默认不执行）。本地 release commit/tag 已推送至 origin。
- Last Updated: 2026-08-12
- Verification Evidence: `npm run test` 141 文件/1088 测试 100% 通过；`npm run lint` 0 error（1 个既有 warning）；`npm run build` exit 0（仅既有 KaTeX/大 chunk warning）；tarball `package-offline/shawnstack-quickforge-1.7.7.tgz` 25.1 MB / 291 文件，内容核验干净。
- Notes: 详见文末追加记录（release-v1.7.7-prep）。
- 追加记录（settings-tab-select-alignment）：宽度对齐 + 已选值字号与菜单一致。改动文件：src/index.css（仅 `.quickforge-settings-select-trigger-label` 加 font-size: 0.9rem; line-height: 1.35;）、src/lib/default-options-settings-tab.ts（沿用此前两处 quickforge-settings-row-control-wide，未改动）、feature_list.json、progress.md、session-handoff.md。未新增依赖、未触碰生成目录、未改 wiki。
- 追加验证（settings-tab-select-alignment）：`npm run lint` exit code 0，仅 7 个既有 warning（desktop/nsis-patch/apply.mjs no-console、server/cloud/identity.mjs no-useless-assignment），无 error；`npm run build` exit code 0，仅既有 KaTeX 字体与大 chunk warning。
- 追加记录（release-v1.7.7-prep，2026-08-12）：v1.7.7 发布准备与验证完成。版本 1.7.6→1.7.7（package.json/package-lock.json 一致）；CHANGELOG 新增 1.7.7 章节（Cloud URL 改动 + 三个 fix + Released/离线包命令）；README.md 无硬编码版本未改。纳入已确认改动（Cloud、测试、release 脚本、runbook、AGENTS、PR 模板、wiki）；init.sh 纳入但无需修改。排除 .qf_staging/、artifacts/、空文件 c。
- 追加验证（release-v1.7.7-prep）：`npm run test` 141 文件/1088 测试 100% 通过；`npm run lint` 0 error（1 个既有 warning：server/cloud/identity.mjs no-useless-assignment）；`npm run build` exit 0（仅既有 KaTeX/大 chunk warning）；tarball `package-offline/shawnstack-quickforge-1.7.7.tgz`（25.1 MB、291 文件）内容核验无排除项/临时/敏感文件。commit/tag/push/publish 未执行。
- 下一步（待用户确认）：`git add` 建议清单见下方；`git commit -m "chore(release): v1.7.7"`；`git tag v1.7.7`；`git push origin master --tags`；npm publish 默认不执行，指令：`cd package-offline && npm publish --access public`（需先 `npm whoami`/`npm login`）。
- 建议显式 git add 清单：package.json、package-lock.json、CHANGELOG.md、AGENTS.md、.github/PULL_REQUEST_TEMPLATE.md、docs/architecture/patch-release-runbook.zh-CN.md、docs/wiki/root-config.md、docs/wiki/scripts/README.md、scripts/prepare-patch-release.cjs、server/cloud/config.mjs、tests/server/cloud/config.test.mjs、tests/server/routes/cloud.test.mjs、init.sh；明确排除 .qf_staging/、artifacts/、c。
- 追加记录（v1.7.7 远端 Git 发布完成，2026-08-12）：GitHub 连接恢复（ls-remote 第 1 次成功）。`git push origin master`：`2f4ecbb..c377144`；`git push origin v1.7.7`：`[new tag]`（tag 对象 093904e...，peeled c3771444...）。ls-remote 核验远端 master 与 v1.7.7^{} 均指向 `c3771444ad8da9bd1e2d870fcfe7de6562cb4a57`。状态提交 `docs(handoff): mark v1.7.7 git release complete` 已创建并推送。npm publish 未执行。

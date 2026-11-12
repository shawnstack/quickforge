# Current Session Handoff

只保留最近一轮交接；更早轮次由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/handoffs/`（按月分文件）。
新一轮的「本轮」段落加在最上面。

## 本轮：上帝模块④ server/tools/index.mjs 职责拆分（2026-11-12 09:53）

- 目标：god-module-decomposition 子项④——把 1375 行的 `server/tools/index.mjs` 按职责拆到 `server/tools/` 模块，index 只留注册表/装配薄层，纯重构零行为变化。
- 结论：新增 9 模块（file-search / file-write / skill-resources / present-files / run-command / process-control / global-memory / todo-write / params）+ index.mjs 52 行薄层（`toolHandlers` 装配 + 原公开面全量再导出）；所有导入方 import 路径零改动；toolRunCommand、grepFilesWithRipgrep 段等逐字迁移，仅 3 处注册表调用改走 process-control 函数入口。
- 改动文件：`server/tools/{index,file-search,file-write,skill-resources,present-files,run-command,process-control,global-memory,todo-write,params}.mjs`；`docs/wiki/server/tools/README.md`；`docs/architecture/custom-agents-design.zh-CN.md`、`docs/architecture/quickforge-api-skill.zh-CN.md`；`skills/quickforge-api/references/endpoints.md`；`src/lib/tool-renderers/local-workspace-tool-renderer.tsx`（注释）、`src/components/workspace/BackgroundTasksTabContent.tsx`（注释）；`feature_list.json`（god-module 条目 summary 追加④）；`progress.md`；本文件。
- 验证：定向 6 files / 98 passed；eslint 0 problems；全量 `npm run test` 524 files / 5800 passed / 2 skipped / 0 failed；`npx tsc -b` 通过；`npm run build` 通过。
- 未完 / 下一步：①god-module ⑤（agent-manager.mjs，导出名被 tests/server/agent-manager-exports-contract.test.mjs 锁定，风险最高）、⑥（server-agent.ts）、⑦（App.tsx）未动；②未 commit；③archive-harness 未跑（progress/handoff 仍含并行 Bot 心跳会话的活段落，归档时机留给该轮或下轮，见 progress Notes）；④server 改动需重启 QuickForge 才生效。
- 未提交，无 commit / tag / push。

## 本轮：Bot 心跳指令模板化（自进化 + 防过拟合）（2026-11-12 09:35）

- 目标：心跳指令从硬编码改为 bot 可自我修改的模板文件，同时种子保持引导式（防场景过拟合）。
- 结论：`heartbeatInstruction` = 固定头（处境 + botPath + 自进化授权）+ `.bot/heartbeat.md` 模板（创建时播种、可自我修改、缺失回退种子）+ 固定尾（`[报告]`/不 commit/不提问）。bot 改得掉工作方式，改不掉契约。
- 改动文件：server/bot-runner.mjs、server/bots.mjs、tests/server/bots.test.mjs、docs/architecture/bot-proactivity.zh-CN.md（§3.2 重写为模板化）、docs/wiki/server/bots.md（§1 表 + §4.1 + 测试清单）、docs/wiki/README.md、feature_list.json、progress.md、本文件。
- 验证：定向 3 files / 43 passed；eslint 0；tsc -b 通过；build 通过；全量 npm run test 524 files / 5799 passed / 2 skipped / 0 failed。
- 未完 / 下一步：①重启 QuickForge 后实测：新建 bot 应有 `.bot/heartbeat.md`；存量 bot 被扫到一次（≤30s）后自动补上；让某 bot 改自己的模板，看下一跳是否生效；②`.bot/heartbeat.md` 无独立 UI 查看入口（走设置弹窗的记忆编辑或文件管理器），暂不做。
- 追加（同日）：存量回填已做——`runBotHeartbeat` 开头幂等 `ensureBotWorkspace`，补模板不动已有记忆/演化版本；新增 legacy 回填测试；定向 37 passed、eslint 0。
- 未提交，无 commit / tag / push。


# Current Session Handoff

只保留最近一轮交接；更早轮次由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/handoffs/`（按月分文件）。
新一轮的「本轮」段落加在最上面。

## 本轮：Bot 心跳指令模板化（自进化 + 防过拟合）（2026-11-12 09:35）

- 目标：心跳指令从硬编码改为 bot 可自我修改的模板文件，同时种子保持引导式（防场景过拟合）。
- 结论：`heartbeatInstruction` = 固定头（处境 + botPath + 自进化授权）+ `.bot/heartbeat.md` 模板（创建时播种、可自我修改、缺失回退种子）+ 固定尾（`[报告]`/不 commit/不提问）。bot 改得掉工作方式，改不掉契约。
- 改动文件：server/bot-runner.mjs、server/bots.mjs、tests/server/bots.test.mjs、docs/architecture/bot-proactivity.zh-CN.md（§3.2 重写为模板化）、docs/wiki/server/bots.md（§1 表 + §4.1 + 测试清单）、docs/wiki/README.md、feature_list.json、progress.md、本文件。
- 验证：定向 3 files / 43 passed；eslint 0；tsc -b 通过；build 通过；全量 npm run test 后台运行中。
- 未完 / 下一步：①等全量结果（如失败跟进修复）；②重启 QuickForge 后实测：新建 bot 应有 `.bot/heartbeat.md`；让某 bot 改自己的模板，看下一跳是否生效；③`.bot/heartbeat.md` 无独立 UI 查看入口（走设置弹窗的记忆编辑或文件管理器），暂不做。
- 未提交，无 commit / tag / push。


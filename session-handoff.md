# Current Session Handoff

只保留最近一轮交接；更早轮次由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/handoffs/`（按月分文件）。
新一轮的「本轮」段落加在最上面。

## 本轮：三条工作流合并单 commit 推送（2026-11-12）

- 目标：用户要求「提交代码并推送，用一个提交合并在一起」。
- 结论：工作区全部改动合成一个 commit 推送 dev，含三条工作流：
  ① **bot 主动干活与主动汇报**（并行会话，设计文档 `docs/architecture/bot-proactivity.zh-CN.md`）：心跳指令与 MEMORY 模板重写（提示词驱动，v4/v2 文案）、`[报告]` 首行契约 → `bot_heartbeat_notification` 全局通知（toast + 桌面）、侧栏「催一下」催醒按钮、`POST /api/bots/:id/inbox` 投喂端点 + 前端投喂 UI；
  ② **吉祥物表情与指针互动**（并行会话）：`mascot/{mascot-interactions,use-mascot-interactions}.ts` 新增互动控制器（点击/悬停表情、ambient 张望）、`BotMascot.tsx` 接线、`mascot-anim.css` 扩展、`expressions-preview.html` / `interactions-preview.html` 预览页、`tests/frontend/mascot-interactions.test.ts`；
  ③ **quickforge-api skill bot 六件套**（上一轮，详情随归档进 `docs/archive/handoffs/2026-11.md`）。
- 验证：推送前全量 `npm run test`（vitest run）与 `npm run lint` 通过；归档 `node scripts/archive-harness.mjs` 先行（活文件本已合规）。
- 未完 / 下一步：① bot-proactivity 涉及服务端改动，**需重启 QuickForge 才生效**；② 测试 bot「qf-api自测」留在 BOT 列表待用户删除；③ 吉祥物互动与 proactivity 通知均未实机肉眼确认。
- 已提交并推送 dev（单 commit，无 tag）。


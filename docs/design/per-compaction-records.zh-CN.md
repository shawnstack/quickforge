# 压缩记录：每次压缩都留过程，UI 不动

> 设计稿 · 2026-11-02 · 已落地
> 关联：`docs/wiki/server/README.md`（auto-compaction 条目；当前契约以它为准）

## 1. 目标（用户裁定）

**每次压缩都是一段独立过程，记录必须留下；界面不为此做任何改动。**

- 不做：新增序号 pill、统计行、`data-context-head`、删除「已并入后续摘要」文案、改动分割线视觉或交互。
- 要做：`contextCompaction.history` 每一次压缩一条记录，**不按条数丢弃**，且每条记录自带当次摘要与用量——即使对应的摘要消息被回滚删除，过程记录仍在。

## 2. 现状与根因

时间线上本来就是「一次压缩一条线」（摘要消息逐条 `append`），界面无需改动即满足「每次压缩可见」。缺的只是**过程不被截断**：

- `compactSessionInPlace` 之前写 `history: [...previousHistory, historyEntry].slice(-MAX_CONTEXT_COMPACTION_HISTORY)`，第 21 次压缩起最旧记录被丢弃。
- 记录本身是自足的（`{ compactedAt, occurredAtIndex, boundaryIndex, summaryMessage, sourceMessageCount, usageBefore, thresholdPercent }`），只是被上限砍掉。

## 3. 改动（唯一一处服务端逻辑）

`server/auto-compaction.mjs`

```js
history: [...previousHistory, historyEntry]   // 不再 slice(-MAX_CONTEXT_COMPACTION_HISTORY)
```

- 删除常量 `MAX_CONTEXT_COMPACTION_HISTORY` 及其注释，换成「不设上限」的设计说明。
- 同步修正三处文档注释里对该常量的引用（`server/routes/shared-conversation.mjs`、`server/session-state-service.mjs`、`src/lib/server-agent-types.ts`）。
- 前端、持久化结构、切点、`compactedUpToIndex`、`buildAutoCompactLoopMessages`、回滚判定、`history` 条目字段**全部不变**。

## 4. 体积与代价（明确接受）

- 每条记录含一份当次摘要，量级与一条摘要消息相当（几 KB）；`body_json` 随压缩次数**线性**增长，不再有上界。
- 摘要消息本身也留在 `messages` 里（时间线需要它），所以同一次压缩的正文在 body 中出现两次：一次作为消息、一次作为记录。这是「记录自足」的代价，按用户裁定接受。
- 分享页 `sanitizeContextCompaction()` 逐条脱敏，条数变多时分享 payload 同步变大。

## 5. 测试

- `tests/server/auto-compaction-history.test.mjs`：把原来的「上限截断」用例替换为「保留全部记录」——预置 25 条历史再压缩 → 26 条，最旧一条仍在且仍带自己的 `summaryMessage`，最新一条等于当前顶层 `summaryMessage`。

## 6. 未做（明确记录）

- 摘要消息 `details.quickforgeCompaction` 仍只有 `{ version, kind }`；当次统计只存在 `history` 条目里。
- 「已并入后续摘要」文案与 `data-merged-into-later` 保留（UI 不动）。
- 旧库不回填、不做迁移；`history` 之外没有任何地方记录压缩过程。

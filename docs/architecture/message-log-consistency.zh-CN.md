# 会话消息实时一致性：消息日志 + 双游标投影

> 目标：同一会话在多个客户端（PC 浏览器 / 手机 Tailscale / 桌面端）同时打开时，
> **消息内容实时一致**。本文记录契约、坐标系统与取舍，代码以本文为准。

## 1. 症状与根因

同一 session 在两个客户端显示的对话内容不同（典型：手机只有最近 200 条，PC 有完整历史）。
根因不是「前端渲染逻辑不同」，而是**没有消息游标这个一等概念**：

| 缺口 | 证据 | 后果 |
|---|---|---|
| 增量投递游标是**会话级单值** | 旧 `agent-session-events.mjs` 的 `session.deliveredMessageCount` | 两个客户端共享同一个投递位置：后加入者从别人的进度开始收增量，结构性漏消息 |
| `stateVersion` 是**事件计数器**（每个 token +1） | `nextSessionStateVersion` | 不能当快照版本用，也无法表达「版本 v 的完整状态」 |
| SSE 无 `id:` / 无重放；全局流连接时**零初始帧** | 旧 `writeSseEvent`、`handleGlobalStream` | 断线期间的事件永久丢失，非流式期间丢了也发现不了 |
| 只读视图只给尾部 200 条，补齐是**一次性且静默失败** | `session-view.mjs` + 旧 `hydrateFullHistory` | 手机经 Tailscale 拉 MB 级请求失败后，该端永久停在 200 条 |
| 两套合并函数并存 | 旧 `mergeIncrementalMessages`（假设本地从 0 开始）vs `mergeWindowedMessages`（唯一处理窗口偏移） | 三个 SSE 调用点走前者，窗口态必然写错位置 |
| 8 处「整体替换」只换数组、不换偏移 | 旧 `state.messages = ...` | 数组与 `baseSeq` 脱节，后续增量全部错位 |

## 2. 目标与非目标

**目标**

1. 任意两个客户端，在同一 `logVersion` 下持有相同的消息数组。
2. 断线重连后自动追平；无法追平时显式降级为「重取快照」，不静默不一致。
3. 全部消息写入只有一个入口，坐标只有一个来源。

**非目标**

- 不做多写者冲突解决：写仍走会话租约（单写），读侧一致由游标 + 重放保证。
- 不引入 CRDT / 操作变换：agent 会话本身是单线程回合制。

## 3. 服务端契约

### 3.1 消息日志版本（`logVersion`）

- 每会话单调递增，**只在消息数组真的变化时 +1**（append / replace / truncate）。
  判据是「条数 + 尾消息身份」的指纹（`server/message-log.mjs` 的 `sessionMessagesChanged`）。
- 与 `stateVersion` 分离：后者回答「帧新不新」（含 token delta），前者回答「消息变没变」。
- 对外出现在 `/state`、`/restore`、`/messages`、`/view` 和所有 SSE 帧上。

### 3.2 消息坐标

- 服务端权威数组的下标就是 **seq**，且帧里用 `messagesAfter` 标出该帧 `messages[0]` 的绝对 seq。
- 快照不删消息：`/state`、`/restore`、会话级 SSE 初始帧统一走
  `projectSessionSnapshot()` → `{ messages: 尾部窗口, messagesAfter, messagesSummary: { count, logVersion }, logVersion }`。
  客户端一次请求即可自洽渲染，不再依赖「先 state 再 messages」两次无版本校验的请求。

### 3.3 连接级投递游标

- `createConnectionProjector()`：**每个 SSE 连接一份**，按 `sessionId` 记录 `{ logVersion, deliveredSeq }`。
- 定稿帧（`message_end` / `agent_end` / `messages_replaced` / `turn_end` / `state`）
  只投递本连接尚未见过的后缀；新连接只拿尾部窗口（`SESSION_TAIL_LIMIT = 200`）。
- `messages_replaced` 或「服务端总数小于本连接已投递位置」→ 判定为替换/回滚，
  忽略游标、以尾部窗口重建，并置 `messagesReplaced: true`。
- 流式帧（`message_update` / `tool_execution_update`）原样透传且不推进游标。

### 3.4 统一读取

`GET /api/agents/:id/messages?from=<seq>&limit=N`（`after` 为同义参数）：

```json
{ "from": 0, "after": 0, "count": 1200, "total": 1200, "logVersion": 37, "hasMore": true, "messages": [...] }
```

首屏、补齐、重连、回滚后重拉全部走它，不再有第二套分页语义。

### 3.5 SSE 续传

- 每帧带 `id: <logSeq>`（全局单调，`server/event-log.mjs`）。
- 服务端保留 per-session 事件的**轻量环**（容量 1000，只存定位字段，不存消息体，
  流式帧不入环）。浏览器重连时自动带 `Last-Event-ID`，服务端据此补发。
- 游标早于环下界（断线太久 / 服务重启）→ 追加一帧 `resync`，
  客户端对所有活跃会话重取一次权威快照。

## 4. 客户端坐标系统

| 坐标 | 含义 | 使用者 |
|---|---|---|
| `seq` | 会话绝对位置（服务端下标） | `/messages` 的 `from`、goal 标记、压缩分割线、回滚 |
| `baseSeq` | 本地 `messages[0]` 的绝对 seq（`ServerAgent.messageOffset`） | `applyLog`、窗口换算 |
| `localIndex` | `seq - baseSeq` | 数组访问 |
| `renderIndex` | 渲染窗口内序号（`windowed-messages`） | 仅渲染层 |

**唯一写入入口**：`ServerAgent.applyLog(op)` → `applyMessageLogOp`（`src/lib/message-log.ts`）。
op 只有四种：`snapshot` / `append` / `replace` / `update`。

- `append` 遇到空洞（`after > baseSeq + length`）返回 `gap`，窗口保持不变并触发强制对账，
  **绝不猜测拼接**。
- 所有「整体替换」路径（state 帧、agent_end 全量、turn_end、messages_replaced、
  `/state` 刷新、补齐）都经由它，保证「数组 + baseSeq + logVersion」三者成对更新。

## 5. 一致性与收敛

- **实时**：同一会话的每个连接各自按游标投递，互不干扰。
- **重连**：`Last-Event-ID` 重放 + `resync` 兜底。
- **历史补齐**：`ensureFullHistory()`（幂等 + 退避 `[0, 1s, 3s, 8s, 20s]`），
  由首帧、`visibilitychange`、`online` 触发；拉取期间若有新帧落地，
  以服务端全量为基底、保留本地更新的尾部（不再整段丢弃）。
- **页面刷新**：IndexedDB 快照先行渲染，`/state` 对账。

一致性等级：**同一 logVersion ⇒ 相同消息数组**；不同 logVersion 之间允许短暂滞后，
但最终由 `append` / `gap` / `resync` 三条路径收敛。

## 6. 兼容与断代

按「前后端 / 桌面 / 安卓同版本发布」处理，不保留旧帧形状：

- 旧 `messagesSummary: { count }` 仍被读取（`logVersion` 缺省 0）。
- 旧服务端的全量帧（无 `messagesAfter`）按 `baseSeq = 0` 处理。
- `/messages?after=` 继续可用，语义等同 `from`。
- 已删除 `mergeIncrementalMessages` / `mergeWindowedMessages`：
  其能力由 `applyMessageLogOp` 覆盖（`tests/frontend/message-log.test.ts`）。

## 7. 测试矩阵

| 层 | 文件 | 覆盖 |
|---|---|---|
| 服务端消息日志 | `tests/server/message-log.test.mjs` | 尾部窗口、绝对 seq、markers、连接投影（双连接独立、无新消息、突发、回滚） |
| 服务端事件环 | `tests/server/event-log.test.mjs` | 全局 seq、轻量帧、流式不入环、重放、缺口检测 |
| 服务端事件出口 | `tests/server/agent-session-events.test.mjs` | emit 层不再裁剪、logVersion 只在消息变化时推进、已同步连接不重复收体 |
| 服务端只读视图 | `tests/server/routes/session-view.test.mjs` | `messagesSummary.logVersion`、`messagesAfter` |
| 客户端投影 | `tests/frontend/message-log.test.ts` | 四种 op、空洞、前缀跳过、替换、单条更新 |
| 客户端收敛 | `tests/frontend/server-agent-history-convergence.test.ts` | 拉取期间 SSE 落地不丢、失败返回 false、已全量早退、退避后收敛 |
| 客户端回归 | `tests/frontend/server-agent.test.ts` | 增量合并经统一入口、终态帧、回滚帧、goal/lease |

## 8. 已知边界

- 事件环在进程内存中：服务重启后首个客户端必然走 `resync`（一次全量 `/state` 校准）。
- 服务端仍是**单进程**假设：跨实例实时一致需要外部 pub/sub，不在本阶段范围。
- 渲染窗口（挂载轮数）仍与视口有关；它只影响「已经拿到多少条能滚到」，不影响数据一致性。

# 对话轨迹（Conversation Trace）设计

> 状态：已实现（2026-10-23）。视图、投影与测试均已落地；未改变服务端存储与事件协议。

## 1. 问题陈述

QuickForge 的对话区只能看到「工具卡片」——每个工具一行折叠加详情。用户要回答下面这些问题时没有抓手：

- 这轮对话一共跑了多少个工具、总共多久、哪些失败了？
- 哪个工具最慢？两个工具是真的串行，还是并行跑的？
- 每一步（一次模型请求）花了多少 token？
- 工具报错的具体输出是什么，为什么它「没生效」？

对话卡片把工具摊平在正文之间，既不能竖着比较耗时，也不能按轮次看整体。需要一个**单会话的只读运行时视图**。

## 2. 目标与非目标

### 目标

1. **对话区的第二种视图**：点顶部「轨迹」把对话区换成轨迹，点「对话」切回，不弹窗、不占侧栏。
2. **Turn → Step → Tool 三层结构**：轮次分组，每次模型请求是一步，工具挂在步骤下。
3. **时间总览三轨**（Input / Model / Tools）+ 三种投影模式（等宽 / 耗时 / 时钟）。
4. **每个记录看详情**：参数、输出、错误、起止时间、耗时、token、原始字段。
5. **不虚构数据**：没记录的时间就是「—」，进行中不编造结束时间。

### 非目标（明确不做）

| 不做 | 原因 |
|---|---|
| 新增 append-only 事件日志 | 现有 `messages` + `quickforgeTiming` 已能覆盖上表全部问题，见 §3 |
| 跨会话 / 全局轨迹 | 轨迹是会话维度的视图；跨会话检索是另一条线 |
| 轨迹内深链接（可分享到某条记录） | 与现有会话分享模型冲突，收益不足 |
| 虚拟滚动 | 单会话工具数级通常在 200 以内，全量渲染 + 轮次折叠足够 |
| 会话树 / 子代理嵌套节点 | 子代理是独立会话，父会话里只出现启动它的工具调用 |

## 3. 数据来源：为什么不加事件表

DSH 的 Trajectory 建立在 append-only 会话事件日志上。QuickForge 的等价数据已经在消息里：

| 轨迹需要的信息 | QuickForge 的现成来源 | 是否持久化 |
|---|---|---|
| 轮次边界 | `user` / `user-with-attachments` 消息 | ✅ |
| 步骤（模型请求） | 每条 `assistant` 消息 | ✅ |
| 模型名、token、成本、stopReason | `assistant.usage` / `model` / `stopReason` | ✅ |
| 工具调用与参数 | `assistant.content[]` 里的 `toolCall` part | ✅ |
| 工具结果与错误 | 配对的 `toolResult`（`content` / `isError`） | ✅ |
| 工具起止与耗时 | `toolResult.details.quickforgeTiming` | ✅ |
| 进行中的工具 | `agent.state.pendingToolCalls` | 运行时 |

关键事实（已核对）：

- `server/tool-wiring.mjs` 在**服务端**就把 `{ startedAt, finishedAt, durationMs }` 合并进 `details`，前端 `upsertToolResult` 只做兜底回填。
- `agent-session-events.mjs` 的 `tool_execution_start` 帧就带 `quickforgeTiming.startedAt`，所以 streaming 期间也有开始时间。
- 持久化走 canonical JSON，**不裁剪 `details`**（分享页只删 `contextReferences`），所以刷新/回放后时间戳仍在。

因此轨迹完全可以做成**纯客户端投影**：不上报、不落盘、不改协议。

## 4. 结构

```
agent.state.messages
        │
        ▼
src/lib/conversation-trace.ts        ← 纯函数投影（无 React、无 IO）
   buildConversationTrace()
        │  turns: Turn[] → steps: Step[] → tools: Tool[]
        │  + toolCount / errorCount / runningCount / tokens / cost
        │  traceRows() / traceBounds() / layoutTraceSpans() / traceTurnMarkers()
        ▼
src/components/chat/trace/ConversationTraceView.tsx
   Toolbar（模式 / 展开全部 / 搜索）
   Overview（三轨 × 三模式，拖选筛区间）
   Ledger（Turn → Step → Tool 行）
   Inspector（选中才出现）
```

### 4.1 轮次与步骤的划分规则

与 `panel-decoration/process-folding.ts` 的 `decorateProcessBlocks` **完全一致**，不引入第二套分组语义：

- 遇到 `user` / `user-with-attachments` → flush 上一轮，开新一轮。
- 之后所有 `assistant` 消息都归入该轮，每条是一步。
- 以 assistant 开头的会话（seeded / resumed）单独成轮，`userText` 为空。
- `artifact` 消息跳过（仅用于持久化）。

### 4.2 耗时口径

| 字段 | 定义 | 缺失时 |
|---|---|---|
| `tool.startedAt` | `details.quickforgeTiming.startedAt` | 回退到该 step 的 timestamp |
| `tool.durationMs` | `details.quickforgeTiming.durationMs` | `undefined` → UI 显示「进行中 — 尚无结束时间」 |
| `step.durationMs` | 到下一个 step / 下一轮 user 消息的间隔；尾步回退到最后一个已结束工具 | `undefined`（无任何记录时不猜） |
| `turn.endAt` | 该轮最后一个 step 的 `endAt` | `startAt` |

**唯一允许读时钟的地方**是投影入口的 `now`（默认 `Date.now()`，测试注入固定值），且只用于「运行中」的跨度延伸。视图内部不调 `Date.now()`（`react-hooks/purity` 会拦，行渲染改为接收 `now` 参数）。

### 4.3 工具状态

```
有 toolResult        → isError ? 'error' : 'done'
无 toolResult，且在 pendingToolCalls 中 → 'running'
无 toolResult，且不在 pendingToolCalls 中 → 'interrupted'（中止/崩溃）
```

`interrupted` 是刻意保留的状态：DSH 也会把已关闭步骤里没有结果的调用合成成 interrupted，而不是隐藏它。

## 5. 时间总览

固定三轨：`Input`（用户消息）/ `Model`（assistant 步骤）/ `Tools`（工具调用）。

三种投影模式，横向位置的语义各不相同，UI 必须说清：

| 模式 | 横向含义 | 用途 |
|---|---|---|
| 等宽 `sequence` | 按时间顺序等宽串行 | 看清顺序，不被长短差压扁 |
| 耗时 `duration` | 每轨内按实际耗时分配宽度 | 看清谁最慢 |
| 时钟 `time` | 真实时钟位置 | 看清并行与空档 |

**只有 `time` 模式允许拖选区间**——另外两种模式里 x 轴不代表时间，拖选会得到无法解释的筛选结果，所以代码在非 time 模式下直接不启动拖选，并在标题旁用 `traceHint*` 文案说明当前模式的含义。

实现契约（沿用 `WorkflowRunDetailContent.TimelineView`）：

- **DOM + 百分比定位**，不用固定 `viewBox` 的 SVG（viewBox 会把字号随面板宽度等比缩掉：640px 下面板里 9px 字实际约 5.8px）。
- 刻度、条形、文字都是绘图区的**绝对定位兄弟节点**，不是条形的子节点（否则会被面板裁掉）。
- 短调用保底 0.9% 宽度，避免消失。

## 6. 主视图（Ledger）

```
⊟ Turn 1   14:32:05   3 个步骤 · 4 个工具调用 · 24.2s
   ● USER  对话要加一个轨迹功能…
   ▾  MODEL  gpt-5.2   8.4k→612   2.2s        ← 步骤即组头
      │  TOOL  read_file   src/App.tsx   120ms
      │  TOOL  grep_files  quickforgeTiming  340ms
      │  TOOL  run_command npm run test  12.1s
```

- **Turn 头**：轮次号 + 起始时刻 + 「N 个步骤 · M 个工具调用 · 总时长」，可折叠。
- **Step 行**：`MODEL` 徽标 + 模型名 + 正文摘要 + token + 耗时。左侧 chevron 折叠其工具行；无工具的步骤 chevron 置灰禁用。
- **Tool 行**：`TOOL` 徽标 + 工具图标 + 人类可读名 + `并行` 标记 + 参数摘要 + 耗时；缩进 26px 并带 1px 弱连接线，表达「工具是这一步的执行细节」。
- 行状态：`done` / `error`（红色左侧规则条 + 红色耗时）/ `running`（绿色呼吸点 + `+4.1s`）/ `interrupted`（虚线规则条）。

### 联动

- 点轨迹行 → 展开右侧 Inspector（默认隐藏，不占宽度）。
- 点 `Inspector` 的「在对话中定位」→ 切回对话视图（对话本身未卸载，滚动位置仍在）。

## 7. 检查器（Inspector）

选中行才出现，按记录类型给不同页签：

| 记录 | 页签 |
|---|---|
| Tool | `概要` / `参数` / `结果` / `计时` |
| Step | `概要` / `输出` / `用量` / `原始` |
| User | `概要` / `原始` |

`计时` 页签直接展示 `details.quickforgeTiming` 原始 JSON 与三行字段表，并标注数据来源与「会话消息保留 details」——让「这个数字从哪来」可自证。

`Esc` 关闭；窄屏（≤48rem）从固定栏变为覆盖整块主体。

## 8. 挂载位置与「不卸载对话」

轨迹层是 `ChatConversationSurface` 内部的一个绝对定位同级视图，**覆盖**而不是替换 `SessionViewPool`：

```
<ChatConversationSurface>
  {conversationView === 'trace' ? <div className="quickforge-trace-layer">…</div> : null}
  <SessionViewPool>  ← 始终保持挂载
    <ChatPanelHost>  ← ChatSurface 的滚动位置 / 草稿 / 消息窗口都在这里
```

为什么不卸载：`ChatSurface` 里装着输入框草稿、滚动锚点与消息窗口，卸载后切回要整树重建，还会丢草稿。用一个不透明背景层覆盖即可达到「对话区换成轨迹」的观感，切回零成本。

### 视图状态的归属

`useUIState` 存 `conversationViewScope: { scopeId, view } | null`，**不是裸字符串**：

- App 派生 `conversationView = scope.scopeId === currentRuntimeScopeId ? scope.view : 'chat'`。
- 效果：切到别的会话自动回到对话视图，且不需要 `useEffect` 里 `setState` 重置（那会被 `react-hooks/set-state-in-effect` 判 error）。这与 `workspaceInspectorOpenScopeId` 的既有模式一致。

## 9. 视觉约束（对齐 DESIGN_LANGUAGE）

- 分割线：`1px` + `color-mix(in oklab, var(--border) 60%, transparent)`，与主结构同一配方。
- 内嵌卡片复用邻近工具卡强度（`border-border` 系列），不使用 `border-border/75 bg-muted/20` 这类会退化成过深边框的写法。
- 危险色克制：错误只染左侧规则条、图标与耗时，不铺底色。
- 动效：全部引用 `--quickforge-dur-*` / `--quickforge-ease-out`；`running` 流光复用既有 `shimmer`（方向契约 200% → -200%）；每一条 `@keyframes` 都有 `prefers-reduced-motion` 降级。
- 字号跟随 `--quickforge-message-font-size`，与对话正文同一缩放体系。

## 10. 完整度边界

- **不是原始事件浏览器**：只投影业务记录。要看未投影的事件（审批、goal、todo 等）需另建开发者视图。
- **搜索只覆盖当前会话已加载的消息**；更早历史需要会话分页加载。
- **没有虚拟滚动**：工具数级过大时（>500 行）首次渲染会变慢，属已知取舍。
- **不做 usage 的「已驻留 vs 磁盘全量」区分**：累计值等于 `agent.state.messages` 里的总和。

## 11. 测试与验证清单

| 层 | 文件 | 覆盖 |
|---|---|---|
| 投影纯函数 | `tests/frontend/conversation-trace.test.ts`（29 例） | 轮次边界、seeded 会话、附件消息、artifact 跳过、timing 读取、running/interrupted 判定、并行组、尾步不虚构、三模式布局、格式化、搜索匹配 |
| 组件渲染 | `tests/frontend/conversation-trace-view.test.ts`（10 例） | 空状态、三层行结构、四种状态标记、Inspector 默认隐藏与页签、模式切换、搜索淡化、轮次折叠、无工具步骤不可折叠 |
| 源码契约 | `tests/frontend/conversation-trace-contract.test.ts`（17 例） | 挂载在对话区内而非弹窗、覆盖而不卸载会话、scope 绑定视图、DOM+百分比而非 SVG、三轨三模式、拖选只在时钟模式、Inspector 默认隐藏、Esc 关闭、耗时只来自记录、CSS token 与 reduced-motion 降级 |

验证命令：

```bash
npx vitest run tests/frontend/conversation-trace.test.ts tests/frontend/conversation-trace-view.test.ts tests/frontend/conversation-trace-contract.test.ts
npx tsc --noEmit -p tsconfig.app.json
npm run lint
npm run build
```

## 12. 相关文件

| 文件 | 职责 |
|---|---|
| `src/lib/conversation-trace.ts` | 纯投影 + 布局计算 + 格式化 |
| `src/components/chat/trace/ConversationTraceView.tsx` | 视图、时间总览、Ledger、Inspector |
| `src/components/chat/trace/conversation-trace.css` | 轨迹样式（独立文件，组件自 import） |
| `src/hooks/useUIState.ts` | `conversationViewScope` 视图状态 |
| `src/App.tsx` | 顶部视图切换器、轨迹层挂载、scope 派生 |
| `src/lib/i18n.ts` | 64 个 `trace.*` 中英文案 key |
| `docs/design/conversation-trace-mockup.html` | 交互原型（设计阶段的对照物） |

参考实现：`src/components/workspace/WorkflowRunDetailContent.tsx`（时间轴 DOM+百分比契约）、`src/components/chat/panel-decoration/process-folding.ts`（轮次切分语义）、`src/lib/tool-execution-events.ts`（`quickforgeTiming` 契约）。

# 对话渲染性能与内存：评审与实施记录

> 状态：已实施（P0 / P1 / P2 全部落地，含 5 项经评估否决的候选）
> 前提：**不改变任何用户可见交互与体验**。所有改动都是等价实现或纯旁路优化，
> 红线清单见 §5。
> 基线文档：[会话打开快路径](session-open-fast-path.zh-CN.md)（M0–M5）、
> [渲染内存与附件边界](render-memory-and-attachment-boundary.zh-CN.md)（P0–P3）。
> 本文只记录**这两轮之后仍然存在**的成本，以及本轮的处理方式。

## 1. 成本画像（改动前）

| 场景 | 真实成本 | 证据 |
|---|---|---|
| 流式每帧（≤20fps） | 全量 Markdown re-parse + LaTeX 预处理 + 2 个 rehype 插件遍历 + 代码块全量 tokenize，**且不写缓存** | `Markdown.tsx:181-183`、`CodeBlock.tsx:394-397` |
| 流式每帧 | `MessageList` 每帧重建 `items`/`keys`/`rows`，成本 O(窗口行数) | `MessageList.tsx:134-186` |
| `tool_execution_update` | 服务端不合并；前端同一事件触发 **2 次 full decorate**（同步 `runDecorate()` + 调度器再排一次） | `agent.mjs:943`、`ChatPanelHost.tsx:1566-1569`、`decorate-pipeline.ts:125-137` |
| 每次 full decorate | 每条 assistant **≥6–7 次 `querySelectorAll`**，且在「无变化」短路判定**之前**就付了；同一 turn 的 `collectProcessTimeline` 调两次 | `process-folding.ts:918-965,1008-1019,1415-1422` |
| 每次 full decorate | 末尾至少 1 次强制 reflow（大量写 DOM 之后才 `getBoundingClientRect`） | `turn-navigation.ts:328-343,184-188` |
| artifact 卡 | 每个 idle pass 先建整棵卡片 DOM，再判 `unchanged` 丢弃 | `assistant-artifact-card.ts:667-686` |
| 缓存命中 | 每次 `get` 对完整字符串做 FNV-1a + 严格比较；只按条数限额 | `render-cache.ts:52-64` |
| 多端同看 | 每连接各自 `JSON.stringify` 全量帧 | `agent.mjs:723,980` |

## 2. 已实施

### 2.1 流式 Markdown 稳定块冻结（P2，核心）

`src/components/chat/surface/markdown-stream-chunks.ts` + `Markdown.tsx`。

流式内容只会在末尾增长，前面**已闭合**的 Markdown 块（空行分隔的段落、已闭合的
围栏代码块、标题…）渲染结果与后续追加无关。因此把内容切成：

- `blocks`：已闭合、可独立渲染的块 → 按块缓存元素树（`streamingBlockCache`，
  200 条 / 4MB），跨帧复用；
- `tail`：未闭合的活动尾部 → 每帧解析，长度有界。

成本从「每帧 O(已产出文本) 的完整解析」变成「每帧 O(已产出文本) 的哈希查表 +
O(tail) 的解析」。元素树对象相同 → React 直接 bailout，稳定块子树**不参与协调**，
其中的代码块也不会重新高亮。

**等价性由保守切分保证**：只在空行处切，且两侧都不处于会跨空行延续的结构里
（列表项 / 引用块 / 缩进代码 / 表格行 / setext 下划线 / HTML 块）；冻结前缀还必须
自身完整（数学定界符成对、无 HTML 块起始行）。任何一条不满足就返回 `null`，
调用方退回改动前的整段解析。

测试：
- `tests/frontend/markdown-stream-chunks.test.ts`：切分规则 + **渲染等价性**
  （`renderToStaticMarkup` 比较流式分块与定稿整段，5 类文档形态）。
- `tests/frontend/streaming-render-cache.test.ts`：spy `react-markdown`，断言
  第二帧只解析尾块（稳定块命中缓存）。

### 2.2 工具事件：去双 full pass + 服务端合并（P0）

- 前端：`tool_execution_update` 只走 `streaming` 模式装饰；结构性事件
  （`start` / `end` / `background_commands`）走一次 full pass。
  `scheduleToolInterfaceUpdate` 不再在 rAF 里直接 `runDecorate()`，而是交给
  同一个 `decorateScheduler`——旧实现一次工具事件在一帧里做两遍完整装饰。
- 服务端：`tool_execution_update` 纳入 50ms trailing 合并。两槽（`message_update`
  与 `tool_execution_update`）共享一个窗口计时器，避免单槽互相顶掉；
  非合并事件仍然先 flush 再写（顺序契约不变）。
- 测试：`tests/server/routes/agent.test.mjs` 新增「交错到达时两槽各自保留最后一帧
  且按首达顺序写出」。

### 2.3 装饰层固定成本（P0）

| 改动 | 说明 |
|---|---|
| artifact 卡签名前置 | 抽出 `resolveArtifactCardInputs` / `artifactCardSignatures`，先算签名再决定是否建 DOM。idle pass 命中时一个卡片元素都不创建。测试用顺序断言（签名计算必须先于 `buildCardPlans`）锁定 |
| turn-navigation 测量缓存 | 不再在每个 decorate pass 无条件清空缓存；失效判据改为「输入变化 + 锚点元素已脱离 DOM」。每个 pass 少一次 `getBoundingClientRect` 循环（该循环发生在大量 DOM 写入之后，必然强制 reflow） |
| 折叠时间线复用 | `collectProcessTimeline` 每个 turn 只调一次（指纹与可折叠项共用），从每 assistant 2 次 `querySelectorAll` 降到 1 次 |
| scroll 容器引用缓存 | `scroll-sync` 不再每个滚动事件 `querySelector` 一次；仅在缓存元素脱离 DOM 时重查 |

### 2.4 渲染列表的每帧分配（P1）

`MessageList`：
- `items`（`map` + `filter`）按 `messages` 记忆化；
- 已提交行的 key 序列按 `messages` 记忆化，流式行 key 用
  `createRenderKeyIndex(...).appendKey()` 单独推导（O(1)），不再每帧对
  `[...messages, streaming]` 整体求 key；
- 已提交行的 React 元素数组记忆化，每帧只新建流式尾行。

`appendKey` 与 `messageRenderKeys([...messages, message])[messages.length]`
逐字一致（同一套 occurrence 后缀规则），由
`tests/frontend/render-key-index.test.ts` 锁定——这是 `message_end` 原地复用 DOM
的前提。

### 2.5 渲染缓存（P1）

`src/lib/render-cache.ts`：
- **单槽快路径**：历史消息每次重渲染都用同一个字符串引用再查一次缓存，旧实现要
  对大段内容重算 FNV-1a。引用相等时直接返回上次结果。
- **字节预算**：`ContentCache(maxEntries, maxBytes)` 双限。按 key 片段估算字节
  （UTF-16 ×2），避免「300 条」的预算被几条 200KB 的代码块吃光。
  接入：Markdown 8MB / 高亮 12MB / KaTeX 4MB / 数学预处理 4MB / Mermaid 8MB。
- **in-flight 严格比较**：`memoizeContentAsync` 的去重也做 key 严格比较，
  摘要碰撞时不再复用另一段内容的渲染结果（缓存本身的约束是「碰撞只能退化为
  miss」）。

### 2.6 SSE 帧序列化共享（P1）

同一帧会被每个连接各写一次（PC + 手机同看是常态）。投影对无附件事件原样返回
同一对象，因此 `JSON.stringify` 结果按对象身份放进 `WeakMap` 复用——第二个连接
不再重复序列化 MB 级完整累积消息。WeakMap 随事件对象 GC，无需清理。

## 3. 经评估后否决

| 候选 | 否决理由 |
|---|---|
| **scroll 事件 rAF 合并** | 浏览器本来就把 `scroll` 事件合并到每帧派发一次，再套 rAF 只会把判定推迟一帧，收益≈0 且有「触底边沿丢失」风险。改为只消除每事件的 `querySelector` |
| **折叠装饰 turn 级指纹前置短路** | 要真正前置就需要「行结构签名」缓存（message 身份 + 子节点数），而折叠语义依赖「每轮重新确认节点仍在宿主末尾」。`goal-iteration-divider` 的短路曾因此被既有测试否决（见 session-open-fast-path §3 M1.6），风险高于收益。只做了无争议的时间线复用 |
| **流式自适应降频（渲染超预算就丢帧）** | 降频只线性减少帧数，**不改变单帧成本**（单帧成本随内容增长），峰值阻塞不变；而 §2.1 已经把单帧成本从 O(n) 降到 O(tail)，两者叠加没有额外收益。真正的收益来自分块冻结 |
| **保活视图改「字节权重」** | 保活预算是「渲染行数」（`DEFAULT_VIEW_WEIGHT_BUDGET = 1500`），与 DOM 成本对齐。改字节会改变预算语义且需要重新标定；大消息会话的 DOM 成本本来就不高，收益不明确 |
| **SSE delta 协议 / 虚拟列表库 / 裁 `state.messages`** | 与既有契约冲突（消息日志单一投影、`scroll-owner` 滚动事务、回滚/fork/派生依赖全量消息），维持既有决策 |

## 4. 验证

- 定向：`assistant-artifact-card` 20 例、`turn-navigation` 12 例、
  `process-folding` 63 例、`render-key-index` 3 例、`render-cache-bounds` 4 例、
  `markdown-stream-chunks` 11 例、`streaming-render-cache` 5 例、
  `routes/agent` 57 例全绿。
- 全量：`npm run test` → 465 files / 5373 passed / 2 skipped；`npm run lint` →
  0 problems；`npx tsc -b` → 0 错误；`npm run build` → 成功
  （`[precompress] 224 files: 12.66MB → 6.48MB`）。
- 未做真实浏览器 A/B：建议用 `PerformanceObserver({entryTypes:['longtask']})`
  在同一段含长代码块的长回答上对比流式期间的累计阻塞时间。

## 5. 交互红线（未触碰）

- 滚动四组阈值（脱离 50 / 重吸附 10 / 近底 80 / 回底按钮 280-120）、发送后
  12px 锚定、`scroll-owner` 的事务语义；
- 折叠分组规则、「终答常显」、`run_subagent`/`run_workflow` 不进折叠组；
- 过渡（280ms 遮罩淡出、`prefers-reduced-motion` 瞬时）、轮次导航显示阈值；
- DOM 契约（`.qf-chat-panel` / `data-message-index` / `data-window-start` 等）；
- 状态保留矩阵（草稿、滚动、折叠态、模型/权限跟随）；
- `message_end` 原地复用 DOM（key 一致性由测试锁定）。

## 6. 遗留

- `decorateProcessBlocks` 的 skip 路径仍要付 `hasTurnProcessSignals`（1 次/assistant）
  与 `updateEmptyProcessSources`（1 次/assistant）。要削掉它们需要「行结构签名」
  缓存，属 §3 否决项，需要先补折叠语义的回归网。
- `ChatPanelHost` 的 props 变化仍同步调 `runDecorate()`（绕过调度器合并）。
  改成调度需要确认「props 变化 → 首帧装饰」的时序契约，未在本轮改动。
- 客户端 `agent.state.messages` 仍是全量常驻（窗口只裁 DOM）。这是数据权威，
  不是泄漏；如需治理应单独立项（例如大工具输出的惰性化）。

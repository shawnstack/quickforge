# 会话打开快路径（Session Open Fast Path）

> 状态：M0 / M1 / M2 / M3 已实施；M4 可 React 化模块已全部落地（13 个，见「M4 实现」）。
> 目标：缩短「点击历史会话 → 内容可见且可交互」的时间，且**不改变任何用户可见交互**。

## 1. 问题陈述

打开一个历史会话的原始链路（一次点击）如下：

```
点击会话
  ├─ beginSessionTransition：显示遮罩
  ├─ scheduleAfterPaint（双 RAF，≈33ms）：之后才真正发出请求
  ├─ POST /api/agents/:id/restore
  │     └─ 服务端 restoreAgent → createAgent（完整 agent 运行时重建）
  │           buildSystemPrompt / createServerTools / readProjectConfig
  │           / readStore(settings) / MCP 工具集
  │     └─ split 会话再串行 fetchAllSessionMessages（每页 500）
  ├─ ChatSurface key 变更 → 整棵消息树卸载重建
  │     └─ 全部历史 Markdown 重新解析
  │        全部代码块重新高亮
  │        全部 Mermaid 重新渲染
  ├─ ChatPanelHost 首帧 decorate：全表 querySelectorAll + getBoundingClientRect
  └─ 4 道帧门 + 草稿 IO 之后才撤遮罩
```

三类浪费，全部与「用户想看到历史消息」这个目标无关：

| # | 浪费 | 性质 |
|---|---|---|
| 1 | 只为显示消息却重建 agent 运行时（system prompt / 工具集 / MCP） | 架构错配 |
| 2 | 会话切换整树 remount，渲染产物（解析/高亮/图形）跨 mount 全部失效 | 生命周期错配 |
| 3 | 同一份数据在一次调用内被重复读取与重复扫描 | 实现缺陷 |

## 2. 交互契约（不可改变的部分）

以下行为是本方案的红线。任何优化都不得改变它们：

### 2.1 滚动（四组阈值互不相同）
- 脱离自动跟随：距底 `> 50px`
- 重新吸附：距底 `< 10px`
- 「近底」判定：`80px`
- 回底按钮：显示 `280px` / 隐藏 `120px`（滞回）
- 发送后锚定：用户消息顶部留 `12px`，用透明 spacer 补偿，超时 1000ms 回落纯贴底
- 折叠控件的展开/收起视为「阅读意图」，必须解除自动跟随（`quickforge:reading-intent`）

### 2.2 过渡
- 遮罩 `role="status" aria-live="polite"`
- 遮罩淡出 `280ms`，内容淡入 `280ms`，并行
- 淡出期间 `pointer-events: none`
- 遮罩期间隐藏轮次导航 rail 与 tooltip
- `prefers-reduced-motion` 下所有过渡瞬时
- 同会话重复点击：不显示遮罩、不重复加载

### 2.3 折叠
- 以 user 轮次为分组边界，组内按「中间 Markdown」切二级 stage
- 每轮最后一段非空正文不折叠（终答常显）
- `run_subagent` / `run_workflow`、后台运行的 `run_command` 不进折叠组
- 正在流式的回合默认展开，历史回合默认收起
- 用户手动开合记忆在面板生命周期内有效

### 2.4 DOM 契约
装饰层与 CSS 依赖以下选择器与 data 属性，重写必须保留：
`.qf-chat-panel` / `.qf-scroll-container` / `.qf-message-list` /
`.qf-user-message` / `.qf-assistant-message` / `.qf-tool-message` /
`.qf-thinking-block` / `.qf-markdown-block` /
`.quickforge-composer` / `-shell` / `-dock` /
`data-message-index` / `data-window-start`

### 2.5 状态保留矩阵

| 维度 | 行为（保持不变） |
|---|---|
| 草稿 | 按 `session:<id>` / `new:project:<pid>` / `new:global` 保留并跨刷新恢复；发送即清 |
| 附件 | 不跨会话保留（仅面板内存） |
| 滚动位置 | 重置并贴底 |
| 折叠展开态 | 重置为默认 |
| 模型 / 权限模式 | 跟随会话值覆盖全局 |
| 项目上下文 | 项目会话自动切活跃项目，失败则放弃加载并提示 |

> **M3 之后这五行的实现机制变了，行为不变。** 之前「重置」是整树 remount 的副产品；
> 现在保活视图不 remount，所以草稿落盘、滚动贴底、折叠态显式迁移都由
> `session-view-activity` 的离开/回到回调重放（见 §4「M3 实现」）。上表是对外契约，
> 不是实现说明——保活**不得**用来改变其中任何一行。

### 2.6 只读 / 分享 / 侧聊
能力矩阵由 `chat-capabilities.ts` 定义，只读页移除 composer dock 与历史操作按钮，
分享页审批卡只读，侧聊全部能力关闭。优化不得放宽这些限制。

## 3. 已实施改动

### M0：可观测基线

`src/lib/session-open-timing.ts`

`performance.mark` 四段打点，DevTools Performance 面板直接可见：

| 阶段 | 打点位置 |
|---|---|
| `click` | `beginSessionTransition`（点击生效） |
| `load-start` | `scheduleSessionLoad` 的延迟回调内（真正发请求） |
| `first-paint` | `ChatPanelHost` 的 `scheduleAfterPaint` 就绪回调 |
| `ready` | `handleSessionInitialRenderReady` |
| `decorate`（耗时） | 首轮 `runDecorate` 结束（不在 ready 之前，但决定按钮/折叠何时可用） |

`readSessionOpenTiming(sessionId)` 返回 `clickToReadyMs` / `clickToFirstPaintMs` /
`loadToReadyMs` / `firstDecorateMs`。埋点是纯旁路：Performance API 不可用、
会话 id 非法、重复打点均静默处理。

**`decorate` 阶段是第二轮补上的。** 首版埋点只到 `ready`，而装饰在 ready 之后由 rAF
触发，导致 DevTools trace 到「已上屏」就结束，隐藏了真正阻塞首次交互的成本。
只记录第一轮装饰：流式期的后续装饰是常规开销，混入会掩盖打开会话的真实数字。

**没有这一步，后续优化只能靠主观感受，也无法防止性能回退。**

### M1：消除重复计算（可证明等价）

#### M1.1 内容寻址渲染缓存

新增 `src/lib/render-cache.ts`：有界 LRU，key 由 FNV-1a 摘要定位桶，
**命中时再用原字符串逐段严格比较**，因此摘要碰撞只会退化为 miss，
绝不会返回另一段内容的渲染结果。

接入三处纯函数：

| 模块 | 缓存对象 | 效果 |
|---|---|---|
| `chat-math.ts` | 定界符预处理结果（含 token Map） | 历史消息不再重复扫描 `\(…\)` / `\[…\]` |
| `code-highlight.ts` | `(language, code)` → 高亮 segment 数组 | 历史代码块不再重复 tokenize |
| `mermaid-renderer.ts` | 源码 → SVG（含 in-flight 去重） | 同一张图不重复渲染，并发请求合并 |
| `KatexMath.tsx` | `(display, latex)` → KaTeX html | 历史公式不再重复 `renderToString` |
| `Markdown.tsx` | `content` → react-markdown 元素树 | 历史消息不再重复走 unified 解析 + 插件流水线 |

> `Markdown.tsx` 这条依赖一个关键事实：`react-markdown` 的默认导出是**普通函数**
> （`Markdown(options)` → `post(processor.runSync(processor.parse(file)), options)`），
> 不是带 hook 的组件。因此在渲染期直接调用它就能拿到已解析的元素树并缓存，
> remount 时不再重新解析。`remarkPlugins` / `components` 是模块级常量，
> `rehypePlugins` 只携带由同一 `content` 决定的 math token 映射，所以键只需 `content`。

这三者的产物只取决于输入内容，与组件生命周期无关，因此缓存语义上安全。
返回值是共享只读产物，调用方不得原地修改。

> **更正（本轮推翻上一轮的结论）**：上一版这里写「缓存 `react-markdown` 的元素树
> 无效，因为 remount 时 React 会重新执行 `ReactMarkdown`」。这个判断是错的——
> 它假设 `ReactMarkdown` 必须是 JSX 组件。实际上 `react-markdown` 的默认导出是
> 普通函数，可以**在渲染期直接调用**拿到元素树再缓存，从而真正跳过 parse + 插件
> 流水线。已在 `Markdown.tsx` 落地并有测试锁定。
>
> 测试最初只断言「同一 content 两次渲染输出一致」——这个断言有缺陷：即使每次都
> 重新解析，输出也必然一致，它无法区分「命中缓存」与「重新解析」。现改为 spy
> `react-markdown` 模块并统计调用次数：命中时调用数不增、清空缓存后调用数增加，
> 这才是缓存生效的证据。

#### M1.2 `createServerTools` 消除重复技能扫描

原实现：`createSkillTools` 与 `loadSkillToolContext` 各自扫描同一批技能目录，
输入完全一致、输出完全一致，每次创建 agent 白扫两遍。

现实现：`loadSkillToolContext` 先把技能加载一次，`createSkillTools` 通过
`resolvedSkills` 复用；`loadSkillToolContext` 无条件执行（原来在
`includeSkillTools=false` 时被跳过），保证 toolContext 的字段形状与原先一致。

#### M1.3 配置读取加 (mtime, size) 校验缓存

`readProjectConfigData` 与 `readConfigStore` 位于 agent 创建热路径，
原实现每次 `fs.readFile` + `JSON.parse`，且一次 `createAgent` 会读 `projects.json`
三次、`settings.json` 四次。

现实现：按 `(mtimeMs, size)` 校验的缓存，命中时返回 `structuredClone`
（保持调用方「可以随意修改返回值」的既有语义）。`writeJsonAtomic` 成功 rename
后主动失效该条目，避免文件系统 mtime 粒度较粗时读到写入前的值。

外部直接编辑文件同样会被 `(mtime, size)` 变化捕获，与原先「每次都读盘」的
「新不敏感」程度一致。

#### M1.4 分页默认值对齐上限

`GET /api/agents/:id/messages` 默认 `limit` 由 `500` 提升到服务端上限 `5000`。

原因：前端 `fetchAllSessionMessages` 无论如何都会排空所有分页，
旧的 500 默认值让长会话付出 `⌈N/500⌉` 次**串行**往返。
显式传 `limit` 仍可降级到任意较小页，接口形状与语义不变。

### M1.5 MCP 渲染器按名字兜底

`ToolMessage` 在注册表未命中时，若工具名形如 `mcp__server__tool`，就地构造
`McpToolRenderer`（server 与原工具名从名字解析，不读 `tool.label`）。

原有的注册路径只在 `ChatPanelHost` 面板初始化 effect 里跑一次且依赖数组不含
`tools`，所以「工具集晚到」会让该会话所有历史 MCP 卡降级为通用 "Tool Call" 卡且
不会自愈。这条兜底同时解决该问题，并为 M2 的只读视图（不带 `tools`）提供保证。

刻意直接 import `tool-renderers/mcp-tool-renderer`，而不是经 `local-tools`：
后者在模块导入时注册全部内置渲染器，经它导入会改变「哪些卡能解析」的既有语义
（已有测试会红）。

### M1.6 装饰热路径的重复扫描削减

装饰层是 DOM 驱动的，但每帧的重复工作可以削减，且不改变任何可见行为：

| 位置 | 改动 | 等价性依据 |
|---|---|---|
| `message-actions.ts#getMessageElements` | `Array.from` + 两次 `filter` → 单遍遍历 + 提前 `continue` | 嵌套列表仍排除、流式 partial 仍排除，元素顺序不变 |
| `process-folding.ts#decorateProcessBlocks` | 用 `flushTurn` 闭包单遍分组 | 分组结果与原先逐字一致，只是少了每轮回调的新数组 |
| `scroll-sync.ts#scrollToBottom` | 先读 `scrollTop` 再读 `scrollHeight` | 只调整读取顺序，「已贴底」短路条件不变，四组阈值不变 |
| `ChatPanelHost.tsx#artifactsInputKey` | 按 `messages` 数组身份加 `WeakMap` 记忆 | 依赖既有不变量：`state.messages` 从不原地修改，写入方一律换新数组（已全仓核实无 `push`/`splice`/`pop`） |

**一处被测试否决的优化**：给 `goal-iteration-divider` 加「指纹相同就跳过」的
短路是错的——该装饰器的既有语义是**每周期重新确认分隔线仍挂在宿主末尾**
（另一个装饰器可能在它之后追加了内容），测试显式锁定了这一点。已回退。

## 4. 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| **M0** | 性能埋点基线 | 已实施 |
| **M1** | 消除重复计算（渲染缓存 / 技能扫描 / 配置读取 / 分页） | 已实施 |
| **M2** | 只读视图通道：`GET /api/sessions/:id/view` 不走 `restoreAgent`；`attachRuntime` 移出首屏关键路径 | 已实施 |
| **M3** | 会话视图保活池：切回已打开会话复用渲染子树，消除整树 remount | 已实施 |
| **M3.1** | 多实例作用域收敛：组件弹层按面板归属，不再取「文档中第一个」 | 已实施 |
| **M4** | 装饰层数据驱动化：命令式注入器逐个改 React 渲染 | 已实施（13 个可 React 化模块全部落地；拒因与剩余"必须命令式"清单见 §4 M4） |

### M2 实现（已落地）

原问题：`GET /state`、`GET /messages`、`POST /restore` 在服务端全部 fallback 到
`restoreAgent`，而 `restoreAgent` 会走 `createAgent` 全套（system prompt、工具集、
项目配置、模型解析、MCP）。**只是想把一段历史消息显示出来，却要重建 Agent 运行时。**

落地方式（`server/routes/session-view.mjs` + `ServerAgent.loadView`）：

```
点击会话
  ├─ GET /api/sessions/:id/view?tail=200   ← 只读存储 + 尾部窗口，不建运行时
  │     内存命中原样返回 getSessionState（活跃会话行为完全等价）
  │     未命中 → readSessionStateTail（SQLite 只取末 N 条 + total）
  ├─ 首帧渲染（窗口消息已到手）
  ├─ 后台 GET /state 校准 ←── 冷会话此时才 restore，用户已看到内容
  └─ 后台 hydrateFullHistory() ←── 补齐全量，界面才能滚到开头
```

#### 实测数据（本机，2026-10-21）

| 会话规模 | 路径 | 耗时 | 传输量 |
|---|---|---|---|
| 1179 条 | restore + messages（原链路） | 151ms（2 次串行） | 4.6MB |
| 1179 条 | `/view` 全量（第一版实现） | 57ms | 4.6MB |
| 1179 条 | `/view?tail=200`（修正后，冷会话） | **20ms** | **601KB** |
| 1279 条 | `/view?tail=200`（**内存命中**，修正后） | **7ms** | **592KB** |
| 1279 条 | 同上，修正前（内存命中直返全量） | 1946ms | 9.5MB |
| 361 条 | `/view?tail=200` | 24ms | 815KB |
| 1179 条 | `/view?tail=50` | 5ms | 128KB |

**第一版实现是错的，实测推翻了假设。** 最初的结论是「只读端点省掉一次串行往返」，
但字节数完全没降——`readSessionStateValue` 会全量物化消息。对大会话而言，瓶颈因此
从「服务端重建运行时」转移成「单次 4.6MB 响应 + 前端主线程解析」，实际上更糟。
改为尾部窗口后才同时获得时间与体积收益。

**内存命中分支也曾是错的（第二轮实测才发现）。** 活跃会话直接返回
`getSessionState`，它带着完整消息列表：1279 条会话 = 9.5MB / 1946ms，
首屏 `click → first-paint` 高达 **3202ms**。修正为「内存命中同样应用尾部窗口」后，
同一条链路降到 **608ms（−81%）**，同时保留 `tools` 等运行时字段。

#### 判定：只读视图的价值在哪

严格说，`/view` 并没有降低「服务端读取存储」的成本——冷会话全量与 restore 的
`/messages` 拉取字节数相当。它的真正收益是**把 agent 运行时重建移出关键路径**
（不跑 `buildSystemPrompt` / `createServerTools` / MCP 连接），以及**首屏只需要
尾部窗口**而不是整段历史。这两点叠加才有 3202ms → 608ms 的实测差距。

#### 三个设计决策

1. **响应形状与 `getSessionState` 对齐**，前端复用同一套解析与渲染，不引入第二套
   数据结构。`null`（而非 `undefined`）用于可空字段，保证 JSON 序列化后字段形状稳定
   （`undefined` 会被 `JSON.stringify` 丢掉，形状随会话状态漂移——这是实现中实际踩到
   并修正的问题）。
2. **内存命中同样应用尾部窗口**：活跃会话的待审批、流式状态、上下文用量只存在于
   进程内存，存储里本来就没有，所以内存命中分支必须复用 `getSessionState`；
   但它同时带着完整消息列表，直返会让 1279 条会话产生 9.5MB / 1946ms 的响应，
   首屏 `click → first-paint` 达 3202ms。现在内存命中也会裁剪出尾部窗口
   （并保留 `tools` 等运行时字段），降到 592KB / 7ms。
3. **不返回 `tools`**：存储层没有工具定义。工具卡图标/label/摘要来自静态渲染器
   注册表（按 `toolCall.name` 查），`state.tools` 只在 `AssistantMessage` 里做一次
   `find(name)` 且 `ToolMessage` 有 `toolCall.name` 兜底。唯一例外是 MCP 卡
   （应用期动态注册），已通过按名字构造渲染器兜底，并有测试锁定。

#### 尾部窗口引入的三个正确性问题（均已修复并加测试）

**问题一：前缀永远不会补回。** 只读视图只带 200 条，而增量对账按「服务端索引」
工作，它只会往后拉新消息、不会补前缀。若不处理，用户从完整 restore 的 361 条退化为
只能看到 200 条——**这是真实的可见回归**。修复：`hydrateFullHistory()` 在首屏后
显式做一次全量替换并把窗口偏移归零。

**问题二：增量对账的索引基准。** `mergeIncrementalMessages` 与所有
`summary.count === localCount` 比较都隐含「本地索引 == 服务端索引」。窗口场景下
本地只有 200 条而服务端有 361 条，这些比较会误判为「服务端截断」并触发无意义全量
重拉。修复：新增 `messageWindowOffset` 记录窗口起点，所有比较改用 `localEnd`，
合并改走 `mergeWindowedMessages`（丢弃落在被省略前缀里的尾部条目）。
`tests/frontend/server-agent-message-window.test.ts` 的 8 个用例锁定这些换算，
偏差一格就会让整段对话渲染错位。

**问题三：补齐把用户的阅读位置推走。** `hydrateFullHistory` 是在头部插入 100~200 行，
`scrollTop` 不变而上方变高，视口内容整体下跳——用户在补齐窗口期内向上滚动时必然踩中。
实测（886 条会话）：补齐后 `scrollTop` 完全不变而顶部可见行从「已测试完成」变成
「异步 shell 测试通过」。

修复过程本身有两次失败，都保留在代码注释里以免重蹈：

| 尝试 | 结果 |
|---|---|
| 在发起请求时捕获锚点 | 失败：补齐要走网络往返，用户可能在这期间滚动，用过期锚点会恢复到他早已离开的位置 |
| 用 `offsetTop` 算 delta | 失败：测量发生在插入行高度稳定之前，delta 错 |
| 用 DOM 节点身份 | 部分失败：折叠过程组会被重建，节点不存活 |
| **用视口偏移 + 绝对 `data-message-index`（回退 ordinal）** | **通过**：实测 `topText` 不变、`scrollTop` 精确从 258 调整到 404 |

锚点由 `hydrateFullHistory(beforeReplace)` 回调在**替换前一刻**同步捕获，
由 `ChatSurface` 的 layout effect 在提交时应用。

**问题四：补齐请求与首次交互抢主线程。** 精确归因测量（1279 条会话，点击链路）：

| 阶段 | 耗时 |
|---|---|
| click → first-paint | 275ms（首帧，已从最初 3202ms 降下来） |
| `/view` | 8ms / 592KB |
| `/state` | 18ms / 77KB |
| `/messages`（尾部对账） | 2ms / 2.4KB |
| **`/messages`（全量补齐）** | **141–186ms / 10MB** |

全量补齐原本在 first-paint 的**同一时刻**发起，正好卡在用户首次交互之前。
修复：改到 `requestIdleCallback`（`timeout: 2000` 兜底，无该 API 时 300ms 定时器），
并给它独立的取消句柄——最初复用了 `cancelInitialRenderReady`，会让首帧就绪通知
在卸载时无法取消。实测修复后补齐在首帧后 **270ms** 才启动。

### M3 实现（已落地）

原问题：`ChatSurface` 的 `key={agentRuntimeScopeId ?? agent.sessionId}` 把「渲染一段消息」
绑定在「agent 实例身份」上。切会话 = 整树卸载重建 = 全部历史 Markdown 重新解析。

#### 关键事实：保活视图不需要活的 agent

`ServerAgent.dispose()` 只清定时器、摘 SSE 订阅、清监听者，**不清 `state`**
（`server-agent.ts:1236` 明确注释「dispose 后 state 对象仍可安全读取」）。因此
「保留渲染结果」与「保留 agent 运行时」是两件可以分开的事：

| 决策 | 结果 |
|---|---|
| **不**调大 `MAX_IDLE_AGENT_TASKS` | agent 生命周期零改动，不会常驻 MB 级 messages，也不会引入跨项目 `workspaceRoot` 污染（`server/project-config.mjs` 是进程单值） |
| **只**保活渲染子树 | 切回时会话已是「冷」的，走既有 `/view` 快路径重新取数据；DOM 与 fiber 复用，渲染结果直接命中 |

这是本方案能与既有决策共存的原因：它优化的是**渲染产物**，不是数据副本。

#### 实现

```
App
 └─ SessionViewPool(activeKey = runtimeScopeId)
      ├─ <div display:contents data-quickforge-view="A">  ← 活跃，props 逐字节不变
      └─ <div display:none      data-quickforge-view="B">  ← 保活，元素冻结
```

四个必须同时成立的条件：

1. **每个视图的 wrapper 恒定**：只切 `display`，绝不换元素类型或 key。否则 React
   会卸载 wrapper，连带丢掉整棵子树——保活直接失效。
2. **视图位置恒定**：新视图追加到末尾，淘汰只从最旧的一端整槽移除。移动 keyed
   兄弟节点会让 React 搬动 DOM，在长滚动容器里这是最不该出现的抖动。
3. **活跃视图 props 不加工**：活跃子树收到的就是调用方当前这一帧的元素；只有**离开
   活跃**的视图才被冻结成当时那个元素对象。冻结态是 React 的 same-element bailout，
   保活的子树因此不参与后续渲染。
4. **活跃 wrapper 用 `display: contents`**：不产生盒子，`.qf-chat-panel` 仍然是
   conversation surface 的直接 flex 子元素，布局与改动前逐像素一致；保活 wrapper 用
   `display: none`，脱离布局与无障碍树。

#### 为什么池是一个类组件

冻结动作必须在**离开活跃的那一次 render 里**完成：如果等到 effect，React 已经在该
次提交中卸载了这棵子树，DOM 已经不在了。于是「上一个活跃元素」必须在 render 期间
读写，而这正是 hooks 规则禁止的两件事（render 期间读 ref、effect 里同步 setState）。
本轮两种 hooks 写法都试过并被实测否决：

| 写法 | 结果 |
|---|---|
| render 期间读 ref + `setState` | lint 直接报 `react-hooks/refs`；实测**丢失刚切入的槽位**（`keys: ["a"]` 但 `active: "b"`），视图消失 |
| `useEffect` 里补写快照 | lint 报 `react-hooks/set-state-in-effect`，且有级联渲染 |

实例字段是这类进程内簿记的正确归属：每池一份、跨 render 存活、不需要 state（父组件
在 activeKey 变化时必然重渲染）。类组件因此不是退让，而是这个语义的准确表达。

#### 保活视图必须停止装饰

隐藏视图的 `display: none` 让它没有布局盒：`getBoundingClientRect` / `offsetHeight`
全为 0。若继续装饰，读到的就是失真值，并会把失真结果写回（compact class、折叠态、
滚动位置）。

门控放在 `runDecorate` 开头，判据是**DOM 可见性**（`isInsideHiddenView(host)`），
而不是活跃性信号。这是实测踩出来的：信号在 `useLayoutEffect` 里发布，而在「本视图
刚变为可见」的那次提交上，信号可能仍指向上一个视图，导致**该视图唯一一次权威装饰被
跳过**——表现是切回后轮次导航轨道为空、而保活的那份有 8 个节点。用 DOM 判据则没有
这个时序窗口，因为 `data-quickforge-view-active` 在 render 阶段就已更新。

切回时由活跃性回调补一次 `decorateFnRef.current?.()`，把隐藏期间累积的变化补上。

同理，`ChatSurface` 的 layout effect 在「贴底」写 `scrollTop` 前也会跳过隐藏视图：
隐藏态 `scrollHeight` 为 0，写下去会把容器停到顶部。可见时该分支与改动前逐字节一致。

#### 为什么必须显式迁移「离开时」的行为

冻结 props 的代价是：保活视图**收不到 prop 更新**，无法通过 props 得知「我已经不在
屏幕上了」。而这些时刻原本由卸载 cleanup 承担，有两件真实的事必须补上（
`src/lib/session-view-activity.ts` 负责广播 activeKey）：

| 行为 | 原实现 | 不补会怎样 |
|---|---|---|
| 草稿末次落盘 | `ChatPanelHost` 卸载 cleanup | 输入只按 400ms 防抖落盘，切走前最后几个字符**直接丢失** |
| 回到前台复位 | remount 时 `resetToTail()` + layout effect 贴底 | 沿用旧 `scrollTop`；`[agent]` effect 不重跑就没人贴底 |
| 装饰层重扫 | remount 触发整条装饰管线 | 隐藏期 `display:none` 下测量值全为 0，切回后轮次导航**保持为空** |

三条都在 `ChatPanelHost` 的活跃性回调里显式重放。装饰那条是实测发现的；排查过程中
还出现过一次**误判**：切回后活跃视图的 `.quickforge-turn-navigation` 为空、而保活的
那份有 8 个节点，一度被判定为回归。实际原因是轮次导航有显示阈值
（`TURN_NAVIGATION_MIN_TURNS = 5`），被检查的会话只有 4 轮，**空轨道才是正确行为**。
教训与上轮一致：自动化检查给出的「异常」必须先用规则本身对照，再判断是不是自引入。

#### 第四条必须显式迁移的行为：就绪信号（回归，已修）

上表遗漏了一条，代价是**整页假死**：

| 行为 | 原实现 | 不补会怎样 |
|---|---|---|
| 首帧就绪通知 | remount 时 `ChatPanelHost` 主 effect 末尾的 `notifyInitialRenderReady` | 遮罩**永不下马**，停在「正在加载对话」直到刷新页面 |

触发条件只有两个同时成立才出现，所以前三轮的验收都没覆盖到：

1. **目标会话仍常驻 `taskMap`** —— 只在会话**正在生成**时发生。空闲会话切走时会被
   `selectAgentTaskEvictions` 直接 dispose（`MAX_IDLE_AGENT_TASKS = 0`），切回走
   `/view` + `restore`，拿到的是**新的 agent 对象**，主 effect 会重跑；运行中的会话
   留在 `taskMap`，`performLoadSession` 走 `attachTaskToView(runningTask)` 分支，复用
   **同一个 agent 对象**。
2. **视图被保活** —— M3 之后 `SessionViewPool` 让切回的路径只翻 `display`，不 remount。

两者叠加时 `[agent, agentRuntimeScopeId]` 依赖全都不变 → 主 effect 不重跑 →
`onInitialRenderReady` 一次都不发。而 `useAppLoadingTransitions` 的下马条件只有
`renderedLoadingSessionId === visibleLoadingSessionId`，后者只能由这个回调设置，于是
遮罩既不会被 ready 撤掉、也不会被 280ms 淡出撤掉（淡出本身以 ready 为前提），
**`agent_end` 也不碰 loading 状态**，因此这一轮生成结束后也不会自愈。

修复分两层，且刻意保持「一个发布者」：

1. **源头**：把就绪发布收敛成 `publishViewReady()`，既被面板初始化的
   `notifyInitialRenderReady` 调用，也被活跃性回调的「回到前台」分支调用。发布动作
   幂等——`handleSessionInitialRenderReady` 只在 `visibleLoadingSessionIdRef` 等于该
   会话时才生效，晚到或竞争的发布不会撤掉别人的遮罩。全量历史补齐（`hydrateFullHistory`）
   的开关 `pendingHistoryHydration` 只由初始化那条路径置位，重新激活**不会**重复补齐。
2. **兜底**：`useAppLoadingEffects` 增加 10s 过渡看门狗，把 `rendered` 直接置为当前
   `visible`（复用既有 280ms 淡出），并 `logger.warn` 记录会话 id。这是安全网不是第二条
   路径：任何实测打开都在 300ms 量级（1279 条会话首帧 275ms），10s 只会命中真正的信号
   丢失；而「单信号协议」永远离一次回归只差一步，其失败模式是**永久**卡死界面，
   比提前揭示未就绪内容更糟。

#### 实测数据（本机，2026-10-21，83 行会话 ↔ 16 行会话来回切换）

longtask 收集器（`PerformanceObserver`，`entryTypes: ['longtask']`）在 SPA 内切换，
每次切换前清空、切换后等 2.5s 取数：

| 切换方向 | longtask 数 | 累计阻塞 | 最大单项 |
|---|---|---|---|
| 离开大会话（→ 16 行） | 1 | 55ms | 55ms |
| 切回大会话（**保活命中**，83 行） | 4 | **249ms** | **83ms** |

作为对照，改动前的同链路（618 行 ↔ 171 行，见上文 M3 成本基线）是
大→小 1034ms、小→大 **2360ms** / 最大 854ms。两次测量会话规模不同，不能直接相减，
但可以确认**量级**：保活命中后不再有「整树卸载 + 重建」那一档 500–850ms 的单项尖峰，
剩余成本主要是数据重取（`/view`）与一次装饰 pass。

节点身份验证（切走 → 切回，同一 SPA 会话内）：

```json
{ "probeSurvived": "A", "groups": 4, "actions": 6, "msgRows": 83,
  "scroll": { "top": 1662.5, "distance": -0.5 }, "totalViews": 2 }
```

`probeSurvived` 是切走前打在 `.qf-scroll-container` 上的属性，切回后仍在——**同一个
DOM 容器**；装饰产物（4 个过程组、6 组消息动作）与行数与切走前完全一致，说明装饰在
切回后已重建而非留空。

#### 容量策略

`src/lib/session-view-pool.ts`：默认保活 **1 个**非活跃视图（覆盖 A↔B 来回切换这一
主路径），并设 1500「渲染行」总量预算。活跃视图先计入预算，所以超大会话会独占预算、
退化为「只保留活跃视图」——即该会话改动前的行为，不会变差。跳过超大视图时用
`continue` 而非 `break`，避免一个巨型会话把其他会话的保活全部饿死。

#### 顺带修掉的多实例缺陷

保活让「同时挂载两个 chat 面板」成为常态（主聊天 + 侧聊本来就可以并存），从而暴露
了一批**原本就存在**、只是被「始终只有一个面板」掩盖的全局查询：

| 位置 | 原行为 | 现在 |
|---|---|---|
| `thinking-level-controls.ts` | `removeThinkingLevelMenu()` 无参时删文档里第一个 thinking 按钮；`renderThinkingMenu` 用全局「有没有菜单」判重 | 菜单记录 `__quickforgeOwnerPanel`，按面板归属清理；跨面板仍互斥 |
| `model-controls.ts` | `aria-expanded` 取「文档里有没有 model 菜单」 | 只认属于本 trigger 的菜单 |
| `useModelActions.ts` | 读 `.qf-chat-panel .qf-message-editor`（**第一个**面板）的草稿与附件 | 从点击的 anchor `closest('.qf-chat-panel')` 取所属面板 |

`tests/frontend/composer-popover-panel-scope.test.ts` 锁定这些作用域语义。

### M3 遗留：跨项目 workspaceRoot

保活视图若继续跑工具，会受 `server/project-config.mjs` 的进程级 `activeProjectId`
影响。当前方案不涉及此风险（保活的是渲染产物，服务端 agent 仍随会话切换销毁/重建），
但若将来把 `MAX_IDLE_AGENT_TASKS` 调大，必须同时给 server agent 绑定 projectId，
而不是读全局 active。

### M4 实现（已落地）

`panel-decoration.ts` 有 20+ 个命令式注入器（审批卡、ask 卡、goal 条、todo 摘要、
消息队列、回底按钮、chip、错误行、产物卡…），靠 `querySelector` 找锚点、
靠幂等检查自愈、靠 `WeakMap` 记忆展开态、靠 `MutationObserver` 抑制重入。
这是全系统 bug 密度最高的区域，也是「渲染完还要再写一次 DOM」导致首帧强同步重排的根源。

#### 为什么不能整体 React 化

按「输入能否完全从 snapshot/props 得到」逐模块分类（36 个模块）后的结论：

| 类别 | 数量 | 说明 |
|---|---|---|
| 可 React 化 | 12 | 其中 5 个本就是纯函数/常量，无迁移成本 |
| 必须保留命令式 | 10 | 定位原语、DOM 枚举、尺寸测量、`body` 浮层、DOM 桥 |
| 混合 | 14 | 数据可 React 化，但插入点/测量必须命令式 |

**真正的阻塞不是代码量，是测试与契约**：

- 全仓 **232 条**「读源码文本 + `toContain`」的断言（`assistant-artifact-card` 独占 114 条）
  锁的是**命令式实现**（`hostElement.insertBefore(card, anchor)`、`rollbackButton.className = …`）。
  React 写不出这些字符串，改造等于**重写测试**而非修测试。
- 装饰层测试大多靠 `vi.stubGlobal('document', fake)` 的假 DOM（默认 `node` 环境）。
  假 DOM **无法承载 `createRoot().render()`**，任何 React 化的模块必须整文件切 jsdom
  （本轮新增的渲染测试都在文件头加 `// @vitest-environment jsdom`）。
- `process-folding.ts`（1718 行）与 `ChatSurface` 的所有权租约强耦合
  （`getSnapshotBeforeUpdate` → `releaseProcessGroups`），是「节点搬运 + 所有权移交」
  而非渲染，**不属于 M4 范围**。
- 文本锁的实际规模在改造中重新统计过：全仓 69 个测试文件同时使用 `readFileSync` + `toContain`，
  共约 1992 处（`assistant-artifact-card` 136、`message-queue` 55、`message-actions` 38）。
  本轮迁移的 9 个模块「零文本锁」的说法只在**模块自有**的断言上成立——宿主与 barrel 上
  仍有间接锁（例如 `side-chat-workspace-tab` 锁 `disableComposerControls` 的函数体），
  迁移时必须一起改。

#### 本轮已落地的模块（M4-3，10 个，含此前 2 个）

> 后续 M4-4 又追加 3 个（等待气泡 / 计划模式触发器 / Agent 权限选择器），见本节末尾。

全部满足「可证明等价」：行为逐条对应，测试改为断言**渲染结果**而非实现文本。
每个模块都同时完成了三件事：删掉装饰层文件、删掉宿主里的 decorate 调用、把源码文本锁
改成渲染断言。

| 模块 | 原实现（已删除） | 现实现 |
|---|---|---|
| 发送/停止按钮（`send-stop-button.ts`，50 行） | 每轮 decorate 找到 `button:last-child`，切 `--waiting` 类、写字面量 `Stop`、装捕获阶段 pointerdown/click 监听 | `MessageEditor` 直接渲染：`isWaiting` prop 控制等待环，`onPointerDownCapture` 中止（`stopImmediatePropagation`），`onBeforeAbort` 先收建议弹层 |
| 持久化降级提示（`persist-degraded-notice.ts`，37 行） | 每轮 decorate 找到或创建节点、手工同步文案、`prepend` 到消息列表首位 | `MessageList` 按 `persistDegraded` 渲染为列表首子；`persist_degraded` 加入 `SUBSCRIBED_EVENTS` |
| 模型触发器标签（`model-controls.ts`，24 行） | 扫右侧控制行找文本含 model id 的按钮，打 `quickforge-model-trigger`、`aria-haspopup`，`aria-expanded` 取文档级菜单查询 | `MessageEditor` 直接给按钮加类与 `aria-haspopup`；**`aria-expanded` 故意不由 React 声明**——菜单打开/关闭时自己写，否则每次流式重渲染都会把展开态抹掉 |
| 上下文压缩横线（`context-compaction.ts`，190 行） | find-or-create 节点、`innerHTML` 重建、`<details>` 手工绑 toggle、`insertNoticeAtBoundary` 走 DOM 找行 | `resolveCompactionBoundary`（纯函数）算出**行索引**，`MessageList` 按索引插入 keyed 兄弟；展开态是组件 state |
| TodoWrite 摘要胶囊（`todo-write-summary.ts` 控制器部分） | 建一次节点后不断 mutate `textContent`/`hidden`/`style`/`dataset`，靠 `insertBefore` 与建议菜单/队列/目标条争夺位置 | `TodoWriteSummary` 渲染同一结构；节点类型与 key 稳定，CSS 胶囊形变与进度弧仍能过渡。新增/进行中/完成态与「已更新」标记都是 state |
| SSE 重连 / 模型重试 / 不可达条（`reconnect-notice.ts` + `model-retry-notice.ts` + `unreachable-strip.ts`，共约 640 行） | 三个各自 find-or-create 的注入器，各自持有 `setInterval` 倒计时，列表重建后必须 `sync()` 重新挂回 | `surface/ConnectionNotices.tsx`：状态来自 `useSseConnectionStatus`，倒计时共用一个 tick，位置由 JSX 决定。Tier1→Tier2 的 30s 交接、重启文案 4s 停留、340ms 淡出全部保留 |
| 目标控制条（`goal-control-strip.ts` 控制器部分，约 520 行） | 手工建节点、每次 paint 用 `desired[]` 数组 diff 子节点顺序、删按钮后手工恢复焦点、按 session/goal 反复重订阅 | `surface/GoalControlStrip.tsx`：子节点顺序来自 JSX；编辑态/取消确认是 state；`goal-ui` 订阅是按 session+goal 的 effect。**锁、脏校验、错误仍在 `src/lib/goal-ui.ts`（未改）** |
| 本地路径链接（`local-file-path-links.ts` 的 DOM 部分） | TreeWalker 遍历已渲染文本，把匹配的文本节点换成按钮，用 message 上的 signature 防止重复走 | 拆成两半：**纯检测**留在 `panel-decoration/local-file-path-links.ts`（`splitLocalFilePaths`），**渲染**改为 rehype 插件 `rehype-local-file-paths.ts` + `LocalFilePathLink`。链接出现在首帧，不再需要 post-render 改写 |
| "+" 菜单（`composer-plus-menu.ts`，234 行） | `leftControls.prepend` 插触发器、`insertBefore(editor)` 插弹层、`innerHTML` 重建两级视图、document 捕获期 dismiss | `ComposerPlusMenu.tsx` 拆成两半共用一个 controller：触发器进 `MessageEditor` 的 `leadingControls`，弹层渲染在编辑卡片之前——**两个插入点与原实现一致** |
| 思考档位选择器（`thinking-level-controls.ts`，242 行） | 建按钮插到 model 按钮 `afterend`、菜单 append 到 `document.body`、`getBoundingClientRect`/`offsetHeight` 定位、捕获期四类监听、`aria-expanded` 镜像 | `ThinkingLevelControl.tsx` 渲染按钮与菜单；只有**定位测量**仍是命令式（fixed 弹层固有）。菜单位置按 trigger rect 计算，`resize`/`scroll` 重新测量 |

#### 三个等价性细节（想当然就会改坏可见行为）

1. **停止按钮的 `title` 必须是字面量 `"Stop"`**，不能用 `t('stop')`。装饰层一直写的是
   字面量，改成翻译值会在非英文环境改变可见 tooltip。
2. **等待环的清除时刻不等于 `isStreaming && !streamingMessage`**。宿主在 assistant 的
   `message_start` 就清除等待态，而 `streamingMessage` 要到第一个 `message_update` 才有值。
   从 snapshot 推导会让等待环多显示一段（像素相同、时刻不同），因此该状态仍由宿主显式提供。
3. **模型按钮的 `aria-expanded` 不能由 React 声明**。菜单（`lib/custom-model-selector.ts`）
   打开时写 `true`、关闭时写 `false`；React 一旦把这个属性放进渲染输出，每次流式快照
   重渲染都会把它写回声明值，展开高亮随即消失。

#### 本轮自我评审发现并修掉的三个真实缺陷

| 缺陷 | 症状 | 修复 |
|---|---|---|
| rehype 插件递归进自己的产物 | `qf-file-path` 的子文本仍是同一路径，插件再次拆分它 → 无限嵌套，最终 `RangeError: Maximum call stack size exceeded`（**Markdown 含任何本地路径就白屏**） | 把产物标签加入跳过集合，并让遍历只递归**原始**子节点；新增 `tests/frontend/local-file-path-markdown.test.ts` 用「无嵌套链接 + 能渲染出链接」双向锁定 |
| "+" 菜单弹层放错位置 | 弹层被渲染成触发器所在控制行的兄弟，而不是编辑卡片之前的独立块，`.quickforge-plus-popover` 的间距/宽度样式全部错位 | 拆成 trigger / popover 两个组件共用一个 controller，各自放回原插入点 |
| 侧聊控件不再禁用 | 装饰层删除后，侧聊里 "+"、思考档位、模型三个触发器仍然可点（原本由 `disableComposerControls` 置灰） | 加 `composerControlsDisabled` prop，三个控件渲染为 `disabled` 且忽略 pointerdown/keydown |

#### 明确回退的一个模块：goal 迭代分隔线

`goal-iteration-divider` 一度按 React 渲染实现，**最终回退为命令式**，原因是两个无法用
React 忠实表达的事实：

- **宿主在渲染后才知道**：分隔线挂在「本轮最后一条消息」上——通常是 assistant，
  但本轮**没有 assistant 时回退到该轮的 user 行**（`quickforge-goal-internal-user-message`）。
  两个不同组件负责同一节点。
- **顺序必须每轮重确认**：分隔线必须是根的**最后一个子元素**，而 `message-actions`
  在其后还会往同一根 append。这正是它当初需要「幂等重定位」的原因。

要 React 化就得把消息列表的兄弟顺序提升为共享状态，那是重写折叠/装饰模型，不是渲染迁移。

不过**决策逻辑已经抽出**：`readGoalIterationMarker`（校验）+ `buildGoalIterationDivider`
（文案 + 警示标记）成为唯一实现，`syncGoalIterationDivider` 只保留 DOM 写入。67 条既有
断言全部保留并通过，说明这次重构行为等价。

#### 结论

M4 的可 React 化模块至此**全部落地**（13 个）。剩下的是「必须保留命令式」与「混合」两类：

- `process-folding.ts`（1718 行）：与 `ChatSurface` 的所有权租约强耦合
  （`getSnapshotBeforeUpdate` → `releaseProcessGroups`），是**节点搬运 + 所有权移交**，
  不是渲染。React 化等于重写折叠模型。
- `message-actions.ts`（738 行）、`assistant-artifact-card.ts`（701 行）、
  `message-queue.ts`（617 行）：动作行/产物卡/队列需要「消息根的最后子元素」这一位置语义，
  且被 100+ 条源码文本锁保护；`message-queue` 还带指针拖拽排序（自带 ghost 与边缘滚动）。
  这三件的正确形态同样是「插入点仍命令式、内容 React 化」，收益低于风险。
- `scroll-to-bottom-button.ts`（167 行）：可见性由滚动容器的 `scrollHeight`/`scrollTop`/
  `clientHeight` 实时决定，带 280/120 滞回带与 unread 计数；没有「快照数据」可供 React
  推导，是**测量本身**驱动的 UI，留在命令式侧。
- `subagent-running-indicator.ts`（491 行）：`document.body` 浮层 + 菜单项就地 diff
  （复用元素、只改变化字段、乱序才移动），目的是流式期间 hover 不闪断；React 化的收益
  是代码量，代价是每次 150ms trace 更新都整体重渲染。
- `turn-error-row.ts`（240 行）：错误行/升级提示/详情三个伴随节点是**装饰层自建、挂在
  React 渲染根末端的兄弟节点**，且必须与 React 自己渲染的红块共存（红块只能是"被内联
  样式隐藏"，不能移除或改 className，否则 React 卸载会抛 `NotFoundError`）。要 React 化
  就得把这套兄弟顺序提升进 `AssistantMessage` 的渲染树——即把「错误呈现 + 重试升级态」
  整体搬进消息组件，属于消息渲染重构而非注入器替换。
- `editor-bindings.ts`（188 行）：`onInput`/`onSend`/`onFilesChange` 的桥接、plan-mode 包装、
  大段粘贴 POST、capture 期 paste/drop 守卫——全是 **DOM 桥语义**，没有可供 React 渲染的
  内容，只有事件接线。
- `drafts.ts`（129 行）：纯函数（读/写草稿快照），没有渲染产物。
- 审批卡 / ask 卡 / 回滚确认弹层：定位原语、`body` 浮层、尺寸测量。

#### M4-4（本轮续）追加落地的 3 个模块

| 模块 | 原实现 | 现实现 |
|---|---|---|
| 等待气泡（`assistant-waiting-bubble.ts`，113 行，已删除） | 全表扫描找最后一条 user 行，再用 DOM 探针判断「其后是否有可见 assistant 内容」（查 `.qf-thinking-block`/`.qf-tool-message`/`.qf-markdown-block`，并克隆节点剔除动作行），然后 `lastUserElement.after(bubble)` | `resolveAssistantWaitingRow` 用消息数组算出**行索引**，`AssistantWaitingBubble` 作为 keyed 兄弟插在列表里；判定改为读消息体（text / 非空 thinking / toolCall） |
| 计划模式触发器（`plan-mode-controls.ts` 的 `syncPlanModeButton`，已删除） | 创建按钮、`patchContent` 写两个图标、插到 access 按钮之后；planMode 关闭时 `remove()` | `PlanModeTrigger` 渲染，**仅 planMode 为 true 时渲染**（保持旧行为：关闭时不出现按钮）。Shift+Tab 快捷键仍留在装饰层（绑定在 textarea 上） |
| Agent 权限选择器（`agent-access-menu.ts` 的触发器与菜单渲染，已删除） | 建触发器追加到左栏、菜单 append 到 `document.body`、`getBoundingClientRect` 定位、四类捕获期监听 | `AgentAccessTrigger` + `AgentAccessMenu`；定位测量仍命令式，位置计算抽成纯函数 `positionAgentAccessMenu`。**关闭改为握手**：装饰层只调 `removeAgentAccessMenu` → 已注册的 closer → React 卸载节点 |

#### 本轮自我评审发现并修掉的问题

独立评审（只读复核 + 探针复现）找出两个**高危**缺陷，都属于「测试全绿但功能已坏」：

| 缺陷 | 症状 | 修复 |
|---|---|---|
| 压缩横线与等待气泡的插入索引错位 | 两者都是「按消息行计数的 keyed 兄弟」，却用两次 `splice` 插入。插入横线会把之后的每个位置推后一位，于是**横线在上方时气泡被挤到该行之前**（本该在最后一条 user 行之后）。任何发生过上下文压缩的会话，下一轮等待时都会命中 | 改成**单次正序构建**子节点数组；两者同索引时横线在前。新增两条测试锁定「横线在上方时气泡仍是最后一个子节点」与「同索引时顺序」 |
| 装饰层删除 React 拥有的菜单节点 | `removeAgentAccessMenu` 仍 `menu.remove()`。之后 React 卸载该节点抛 `NotFoundError: The node to be removed is not a child of this node`，被 error boundary 接管后**整块聊天区不可用**。触发链：主聊天打开权限菜单 → 点「+」或子代理指示器 → 装饰 pass 的 `dismissComposerMenus()` | 装饰层改为**只请求关闭**：`registerAgentAccessMenuCloser` 由 surface 注册，React 自己卸载。探针已确认「外部移除后再卸载必抛」，所以这是形态问题而非概率问题 |

同时修掉 4 处行为偏差：

1. **等待气泡丢了 `isStreaming` 前置条件**（旧实现要求 `isStreaming && isActive`）。现在
   `resolveAssistantWaitingRow` 接收 `streaming`，与停止按钮的等待环保持同步。
2. **空 thinking chunk 被算作「已输出」**：`content-parts` 会丢掉空 thinking（不渲染），
   但判定只看 `type === 'thinking'` → 气泡提前一帧消失。现在要求 `thinking.trim()` 非空。
3. **侧聊的 Agent 权限控件从「可见但禁用」变成完全不渲染**：门禁补上 `sideChatMode || …`，
   与旧 `disableComposerControls` 路径一致（`AgentAccessTrigger` 的 `disabled` 分支
   因此不再是死代码）。
4. **权限菜单在门禁变化后会自动重开**：门禁变 false 时菜单卸载但 `open` 状态仍为 true，
   门禁恢复就会自己弹出来。现在门禁变化时显式清掉 open 状态。

顺带清掉的死代码：`decorateEditor` 的 `agentAccessMode` / `onAccessModeChange` /
`onThinkingLevelChange` / `selectPluginCapability` / `availablePluginRows` 五个参数
（已无使用点）、`agent-access-menu.ts` 里的菜单渲染与 `createAgentAccessItem`、
`.quickforge-composer-left-controls` 这条无写入方的 CSS 规则。

装饰层仍是「数据来自 snapshot、DOM 由 React 渲染」的补充层，但渲染所有权已收敛：
新增 UI 先判断能否在 surface 里渲染，只有插入点/测量/DOM 桥才留在 `panel-decoration`。

### M5：流式装饰热路径（已实施，2026-10-22）

原问题：`ChatPanelHost` 在每次 `message_update` 都调用 `scheduleDecorate()`，rAF 合并后
跑完整 `decorate()`。服务端已把 `message_update` 合并到 50ms（20fps），而 618 行会话
单次完整装饰实测 12–17ms，意味着流式期间每秒约 240–340ms 花在装饰上；成本与会话
消息数线性相关，和「这一帧文本增长了多少」无关。

关键观察：`message_update` 只改变流式行的 React 内容。一个回合内，已提交消息行、
行级动作按钮、产物卡、Goal 分隔线、审批/ask 卡和 composer 绑定都不会变；只有过程
折叠（含 thinking hint）需要每帧重新对账，滚动贴底已有独立的 `scrollSync` 路径。

实现：

| 模块 | 改动 |
|---|---|
| `panel-decoration/decorate-scheduler.ts`（新增） | 每帧最多一次装饰；模式为 `streaming` / `full`，pending 的 full 覆盖 streaming；提供取消句柄 |
| `decorateStreamingMessages` | 只取已提交行 + 流式行，调用 `decorateProcessBlocks`；不跑行级动作、产物卡、Goal 分隔线、审批卡、editor、轮次导航与上下文用量 |
| `createMessageRowSnapshot` | 完整 pass 失效并重读行集合；流式 pass 复用已提交行（回合内顶层行稳定） |
| `scrollBottomButton.setup()` | 保留在流式 pass：内容增长可能跨过回底阈值，而用户未滚动时没有 scroll 事件 |
| 调度触发 | `message_update` 走 streaming；message/tool 边界、`messages_replaced`、props 变更、MutationObserver、视图重新激活仍走 full |

行为等价性：完整 pass 仍然覆盖所有结构变化与首次渲染；流式 pass 只重算原本每帧
也在重算的折叠/t hint。流式行在 `message_end` 原地提交时仍由 full pass 接管；保活
视图重新激活、审批卡、产物卡、轮次导航节点列表和回底按钮的冷绑定都未被截断。

同时移除了 `.user-message-container` 的 `backdrop-filter: blur(10px)`。气泡背景与
面板背景都是不透明主题 token，blur 在视觉上不产生效果，却会为每条用户消息建立
一个合成层；全量 DOM 下图层数随历史增长。该改动不改变像素，只减少合成开销
（移动端/长会话收益更明显）。

验证：新增 `tests/frontend/decorate-scheduler.test.ts`（5 例，覆盖 streaming/full 合并、
full 优先、取消）与 `tests/frontend/streaming-decoration.test.ts`（3 例，覆盖流式行追加、
行快照复用、非流式分支）；全量 `npm run test` 419 文件 4783 passed / 2 skipped；
`npm run lint` 0 error（仅既有 warning）；`npx tsc --noEmit` 与 `npm run build` 通过。
尚未做真实浏览器流式 A/B；下一步可用 longtask 基线确认收益。

仍未改动：`tool_execution_update` 仍触发完整装饰、流式 Markdown 仍按帧全量解析、
消息列表仍全量常驻 DOM。这三项分别需要事件合并、增量解析与等价窗口化。

> 后续（2026-10-28）：第三项已落地。`ChatSurface` 不再以 `enabled: false` 构造
> `createMessageWindow`，长会话默认只挂载最近 `WINDOW_TURNS`(3) 轮，向上滚动分页
> 加载更早轮次，并增加「窗口内容不足一屏时自动续扩」的兜底（否则容器不产生滚动，
> `onReachTop` 永远不触发）。轮次导航改为先 `showMessageIndex` 移窗、等布局提交后
> 再测量。数据层仍是全量取数（`agent.state.messages` 恒为全量），本节的目标
> 「不一次性挂载整段历史 DOM」已达成，内存侧的等价窗口化仍未做。


## 5. 重写原则

若要按本方案重写，遵守三条：

1. **重写实现，不重写规则。** 折叠分组规则、滚动阈值、能力矩阵是从需求推导出的
   领域知识，重写等于重推一遍需求，只会引入不一致。
2. **契约先行。** 先把第 2 节的行为固化为测试，再改实现。缺口（如
   `performLoadSession` 的竞态路径、`App.tsx` 级渲染、附件跨会话丢失）
   必须先补测试，否则「新旧一致性」无法判定。
3. **绞杀式替换。** 按能力逐项切换（渲染缓存 → 视图通道 → 实例池 → 装饰层），
   每步单独可回滚，不搞一次性全量替换。

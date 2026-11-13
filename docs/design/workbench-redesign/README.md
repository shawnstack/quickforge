# 工作台重设计设计稿

- 当前轮 **v8 · 塔台 TOWER**：[workbench-v8-proposal.html](./workbench-v8-proposal.html)（单文件，双击打开；顶部演示条可调流速 / 注入故障 / 切主题）
- 状态：**已落地**（2026-11-13）：产品实现 `src/components/workbench/Workbench.tsx` + `workbench.css`；入口为侧栏左上角 QuickForge logo（无单独 icon，开合状态入 ui-store）；tsc/eslint/vitest/build/check:wiki 与隔离实例浏览器实测全绿
- 日期：2026-11-13
- 上一轮 v7 · 班表：[workbench-v7-proposal.html](./workbench-v7-proposal.html)（已被 v8 取代为当前提案，保留作参考，见文末）

---

## v8 · 塔台 TOWER（当前轮，已落地）

### 落地与验证（2026-11-13）

- 产品实现：`src/components/workbench/Workbench.tsx` + `workbench.css`；`WorkbenchPortal` 签名不变；入口为侧栏左上角 QuickForge logo（`SidebarHeaderNav.tsx`，展开/收起两态均可点），顶栏不再放单独按钮，开合状态入 ui-store（`workbenchOpen`）；i18n 新增工作台键（en/zh 双份）、删 8 舞台键；测试改写到 v8 契约（15 例）。
- 评审精修（自评审一轮）：手动刷新按钮（旋转反馈 + 「更新于」tooltip）、搜索清除按钮、Esc 优先级（清搜索→关抽屉→关工作台）、抽屉焦点管理（开聚焦关闭、关归还触发元素）、focus-visible 焦点环、加载骨架屏、错误重试、统计互斥（异常>休眠>待醒）、右栏面板图标与带图标空态、进港行可点击回钻、toast 点击 dismiss、在跑时长「自观察起」tooltip、看板头部微光。
- 验证：tsc -b / 定向 eslint / vitest / build / check:wiki(bad=0) 全绿；隔离实例（临时数据目录 + 假 provider 指向本机 discard 端口，不花真实模型调用）Electron offscreen 实测桌面 1440×900 与窄屏 375×844、浅/深、bot/任务抽屉、NOTAM 渲染/忽略/自动解除、催醒/投喂/开关、进港累积、Esc/重开稳定，零 console/page error。
- 演示条（流速/快进/注入故障/重置）仅为设计稿 chrome，未进产品代码；产品版用真实端点轮询（20s）+ 1s 时钟。
- 已知服务端语义：PATCH heartbeat.lastError=null 不清空（normalize 回退旧值），NOTAM 自动解除依赖成功唤醒清空；跨刷新保留进港/NOTAM 需服务端环形记录（拍板项 4，另排）。
- TODAY 统计带（2026-11-13 晚追加）：通告与主区之间一条恒暗仪器带，`今天 TODAY · 会话 N · TOKEN X · 任务 N 成功率 Y%`。数据全走现成端点、零服务端改动：会话/token 来自 `GET /api/storage/sessions-metadata/index/lastModified`（倒序翻页到本地零点；**返回值为扁平 metadata，usage 在顶层**），任务来自 `GET /api/scheduled-tasks/runs` 的 `status=success/failed` 计数（`startedFrom/To` 为 UTC ISO，与库内 `startedAt` 同基准）。逻辑在 `src/lib/workbench-today-stats.ts`（纯函数 + 分源降级：单源失败该格显示 —）。token 为「今日活跃会话」累计用量近似（usage 按会话累计、无按日切片）；成功率只算已完成运行。验证：隔离库注入真实用量与成功运行后 Electron offscreen 复测，DOM 与独立重算逐格一致（61.1K / 10%），浅/深/窄屏零 console error。

### 一句话结论

工作台换成机场塔台的出港屏：一屏回答**接下来谁会醒（出港）、谁正在跑（在跑）、谁刚完成（进港）、哪里卡住了（通告 NOTAM）**，右栏附舰队名册。不再是一间「房间」或一张「班表」，而是一块面向「下一个事件」的仪表屏。

### 为什么再次换向（与 v1–v7 的关系）

- v1–v6 同属具象场景类（办公室 → 舞台），与 `DESIGN_LANGUAGE.md` 的工具感冲突；v7 换班表后主体仍是「每只 bot 的一天」，需要读懂轨道图例，首屏没有直接回答「接下来会发生什么」。
- v8 把主体换成**事件（班次）**：bot 心跳与定时任务合并成一条按 `nextRunAt` 排序的出港队列，带倒计时与 NEXT 标记。用户第一眼落在「下一件要发生的事」，而不是读图。
- 继承 v7 的诚实边界（心跳无历史端点、首屏不 N+1 拉 goal），并更严：**不外推**——每个班次只展示真实 `nextRunAt`，不画预测点。

### 三屏分工（信息架构）

| 区域 | 回答的问题 | 内容 |
|---|---|---|
| 出港屏 DEPARTURES（主屏） | 接下来谁会醒 | bot 心跳 + 定时任务合并班次，按 `nextRunAt` 排序；时间 / 倒计时 / 班次（身份+项目）/ 状态；筛选 全部/心跳/任务 + 搜索；首行 NEXT 标记 |
| 右栏三段 | 谁在跑 / 谁刚完成 / 名册 | 在跑 NOW（busy bot + running 普通会话 + 已跑时长）；进港 ARRIVALS（bot/任务/普通会话最近完成，会话内累积）；舰队 FLEET（全部 bot 状态点 + 上次醒来） |
| 通告 NOTAM（顶栏下） | 哪里卡住了 | error/warn 通告：心跳连续失败、跳过；动作 催醒重试 / 进入会话 / 忽略；下次成功自动解除 |
| TODAY 统计带（通告下） | 今天干了多少 | 今日会话数（createdAt 今日）/ 今日 token（活跃会话用量累计近似）/ 任务已完成运行数 + 成功率；恒暗仪器条，翻牌铂金数字 |
| 抽屉（点行 / 点通告） | 单只深挖 | 状态 kv、心跳开关（启用 / 间隔 / 到点必醒）、立即催醒 / 进入对话 / 打开目录、投喂收件箱、MEMORY.md 摘要、goal 按需拉取 |

### 签名视觉（克制，仅三处）

1. **翻页琥珀钟**（split-flap）：分钟翻牌动效；看板与时钟**双主题恒暗**——「仪器恒暗，房间随主题」：看板是仪器，房间（顶栏 / 通告 / 右栏 / 抽屉）跟随全局 token。
2. **跑道灯带**：顶栏与通告之间一条 12px 追光灯分隔线，唯一氛围装饰。
3. **状态点 + 等宽倒计时**：不用背景色块、不堆徽章；琥珀 = 倒计时 / warn，红 = error，绿 = 在跑 / ok。

### 数据映射与诚实边界

| 界面元素 | 数据来源 | 现状 |
|---|---|---|
| 出港班次（bot） | `GET /api/bots` → `heartbeat.nextRunAt / enabled / intervalMinutes` | 现成 |
| 出港班次（任务） | `GET /api/scheduled-tasks` → `nextRunAt / scheduleType` | 现成 |
| 倒计时 / NEXT | 前端对 `nextRunAt` 做差 | 现成 |
| 在跑 NOW | `GET /api/bots` → `busy`；`GET /api/agents` → `status==='running'` 的普通会话（排除 bot/任务会话） | 现成（时长为会话内累积） |
| 进港 ARRIVALS | 前端会话内累积完成事件（bot busy→idle、任务 run 完成、普通会话 running→结束）+ `lastWakeAt` | **会话级**，刷新即清空，无历史端点 |
| 通告 NOTAM | `heartbeat.lastError / lastIdleReason` + 会话内累积失败 | 最近一次快照 + 会话累积 |
| 抽屉 goal | `GET /api/agents/:sessionId/status` → `goal` | 按需单拉 |
| 抽屉记忆 | `GET /api/bots/:id/memory` | 按需 |
| 舰队状态 | 复用 `botStatusSummary()` 优先级 | 现成 |
| TODAY 会话 / token | `GET /api/storage/sessions-metadata/index/lastModified?direction=desc`（扁平 metadata：`createdAt / lastModified / usage.totalTokens`），翻页到本地零点 | 现成（token 为活跃会话累计近似） |
| TODAY 任务运行 / 成功率 | `GET /api/scheduled-tasks/runs?status=success|failed&startedFrom&startedTo&pageSize=1` 取 `total` | 现成（只算已完成运行） |

**反面清单（刻意不做的假能力）：**

- 不外推未来班次：每个班次只展示一条真实 `nextRunAt`，不画「预测点」（比 v7 更严）。
- 不做心跳历史热力带 / 趋势图：没有历史端点，画出来只能是编的。
- 不在首屏逐 bot 拉 goal（N+1）。
- 进港明确标注「本次会话」，不冒充服务端历史。

### 演示说明（设计稿 chrome，不属于产品）

- 顶部演示条：流速 ×1 / ×60 / ×600（默认 ×60）、快进 10 分钟、注入故障、重置、说明 ?、◐ 主题。
- 模拟引擎以 200ms 步进推进 simNow：到点唤醒 → 在跑 → 完成走进港；失败起 NOTAM、下次成功自动解除；toast 广播关键事件。
- 注入故障优先作用于抽屉当前查看的 bot，演示因果可控。
- 演示控件全部位于 docbar，与产品顶栏视觉分离；落地时这些 chrome 不进产品代码。

### 与 DESIGN_LANGUAGE 的对照

| 约束 | 本方案 |
|---|---|
| 工具感、不拟物 | 仪表屏隐喻但无场景 / 角色 / 氛围光；签名仅翻页钟、跑道灯、状态点三处 |
| 背景保持干净 | 房间区吃全局 token；看板恒暗属仪器例外，**需拍板** |
| 分割线统一 | 全部 `color-mix(in oklab, var(--border) 60%, transparent)` |
| 辅助信息弱化 | 等宽 10–11px + muted |
| 阴影只给输入框 / hover / 浮层 | 看板一条外阴影（仪器悬浮感）属例外，**需拍板**；其余零阴影 |
| 动效 token + `prefers-reduced-motion` | 120 / 180 / 200ms；翻牌与追光在 reduced-motion 下全关 |
| 不引新依赖 | 单文件原生 HTML/CSS/JS；落地零新增依赖 |

### 落地拆解（评审通过后）

1. 重写 `src/components/workbench/Workbench.tsx` + `workbench.css`；`WorkbenchPortal` 对外签名不变，`ConversationHeader.tsx` 零改动。
2. 房间区吃全局 token；看板恒暗用独立 `--bd-*` 仪器变量（需拍板）。
3. 复用 `src/components/bots/bots-data.ts` 的 `botStatusSummary()`；出港队列 = bots.heartbeat.nextRunAt + tasks.nextRunAt 合并排序。
4. 入口不单独占 icon：点击侧栏左上角 QuickForge logo（favicon）打开；开合状态入 ui-store（`workbenchOpen`），顶栏仅保留 `WorkbenchPortal`。沿用 `workbenchTitle` 文案键。
5. i18n 新增约 18 键；删除舞台专用键（`workbenchPhaseDawn/Day/Dusk/Night`、`workbench24hAgo` 等）。
6. 进港 / NOTAM 的会话累积放 workbench 级 store（关闭即清），不改服务端；可选第二轮加服务端心跳环形记录。
7. 验证：`npx tsc -b`、`npx eslint .`、`npm run test`；浅色 / 深色 / 移动窄屏各看一遍。

### 已知取舍

- **恒暗看板在浅色主题里是一块「暗岛」**——这是签名，也是与 DESIGN_LANGUAGE 的最大偏离，需拍板。
- **进港是会话级**：刷新后右栏为空，需空态文案（「本次会话暂无进港」）。
- **出港只展示每单位下一跳**：interval 任务看不到「全天计划」（v7 轨道的长处），换首屏直接性。

### 需要拍板

1. 方向：塔台出港屏（v8）vs 班表（v7）vs 保留 v6。
2. 仪器恒暗（看板 + 时钟双主题恒暗）vs 完全跟随 token。
3. 入口图标 `Theater` → `TowerControl`。
4. 本轮是否加服务端心跳环形记录（决定 NOTAM / 进港能否跨刷新保留）。

---

## 上一轮 v7 · 班表（参考，已被 v8 取代为当前提案）

- 设计稿：[workbench-v7-proposal.html](./workbench-v7-proposal.html)（单文件，直接双击打开；右上角可切浅色/深色）
- 状态：待评审 → 被 v8 取代为当前提案
- 日期：2026-11-13

### 一句话结论

工作台从「一间办公室」换成「一张班表」：一屏回答三个问题——**谁在干活、接下来谁会醒、哪里卡住了**。

### 现状与问题

现有实现：`src/components/workbench/Workbench.tsx` + `workbench.css`，由 `ConversationHeader.tsx` 的 `Theater` 图标打开，portal 到 `document.body` 全屏。

历史提案 `docs/design/bot-office-workbench/` 共 6 版，全部属于同一类：剖面办公室 → 俯视桌面 → 夜班 → 深夜工作室 → 丁达尔舞台 → 四时段 + 24h 时间轴。每次都在该类内变得更精致，但类没换过。当前实现对应 v6。

这套方向有三个结构性问题：

1. **与项目设计语言冲突。** `DESIGN_LANGUAGE.md` 明确要求「工具感——不做过度拟物或娱乐化视觉」「背景保持干净」「为了"高级感"加入不必要的渐变属于设计禁忌」；而工作台是硬编码深色 `#0e1015` + 丁达尔体积光 + 天空四层 crossfade + 尘埃粒子。
2. **装饰结构反过来决定了信息结构。** `ACTOR_SLOTS` 只有 4 个表演位，第 5 只 bot 会挤进第 4 个位置与它重叠——布局先被"舞台"定死，bot 数量只能迁就舞台。
3. **深浅主题割裂。** 工作台不吃全局 token，切主题时像另一个产品。

### 三个方案

| | 形态 | 适合 | 主要短板 |
|---|---|---|---|
| **主方案 · 班表** | 行 = bot；左侧身份与状态，右侧 6h/24h 排程轨道 | 日常巡检、5–12 只 bot | 轨道需要读懂一次图例 |
| 备选 A · 网格墙 | 卡片网格，每卡一条 12h 节拍条 | bot 多（8+）、扫一眼走人 | 单卡信息量少；卡片化与「避免重卡片」有张力 |
| 备选 B · 指挥台 | 左列表 / 中详情 / 右待办三栏 | 深挖单只 bot | 与设置页三栏观感重复；先让用户选一只 bot，答错了问题 |

**推荐：主方案。** 也是实现成本最低的——一张 grid + 一条绝对定位轨道，不需要图表库。

主方案的三个设计要素：

1. **轨道双语义**：实心点 = 已发生（按 `lastWakeAt` 回推），空心点 = 按 `nextRunAt + intervalMinutes` 外推的预测。左边是事实，右边是计划，一眼分开。
2. **状态只用一个 6px 圆点 + 一行文字**，不用背景色块，不用徽章堆叠。
3. **mascot 保留但降级**：22px 身份标记，不再是舞台演员。

### 信息架构与数据映射

| 界面元素 | 数据来源 | 现状 |
|---|---|---|
| 状态 / 心跳参数 / 下次唤醒 | `GET /api/bots` → `busy, status, heartbeat.*` | 现成 |
| 已发生心跳点 | `lastWakeAt` 按 `intervalMinutes` 向前回推 | **近似**（非真实历史） |
| 预测心跳点 | `nextRunAt` 按间隔外推 | 现成 |
| 失败 / 跳过标记 | 只有最近一次的 `lastError` / `lastIdleReason` | **需补**：服务端加环形记录，或前端会话内累积 |
| 定时任务条 | `GET /api/scheduled-tasks`（含最近 5 条 runs）、`/api/scheduled-tasks/runs` | 现成 |
| 展开区的目标 | `GET /api/agents/:sessionId/status` → `goal` | 现成 |
| 展开区的记忆 | `GET /api/bots/:id/memory` | 现成 |

**反面清单（设计中刻意避免的假能力）：**

- 不做「24 小时活动热力带」——心跳没有历史端点，画出来只能是编的。
- 不在首屏渲染 goal：`/api/bots` 不含 goal，5 只 bot 会变成 5 次额外请求（N+1）。只在展开某行时按需拉取。
- 不用 `/api/scheduled-tasks/runs` 做趋势图：它是分页明细，不是聚合时序。

### 与 DESIGN_LANGUAGE 的逐条对照

| 约束 | 本方案 |
|---|---|
| 工具感、不拟物 | 无场景、无角色站位、无氛围光 |
| 背景保持干净 | 直接用 `--background`，深浅主题自动跟随 |
| 分割线统一 | 全部 `color-mix(in oklab, var(--border) 60%, transparent)` |
| 辅助信息弱化 | 时间、间隔、统计一律 `--muted-foreground` + 11–11.5px |
| 阴影只给输入框/hover/浮层 | 看板零阴影；只有 segmented 选中态用 1px 内阴影级强度 |
| 状态点全圆 | 6px 圆点，唯一的状态色载体 |
| 动效 120/180/140ms + `prefers-reduced-motion` | 只做 hover 背景与展开淡入 |
| 不引新视觉模式 | 复用 `.quickforge-settings-badge` 的徽章写法语义（内联为 `.chip`） |

### 落地拆解（评审通过后）

1. 重写 `src/components/workbench/Workbench.tsx` 与 `workbench.css`；`WorkbenchPortal` 对外签名不变，`ConversationHeader.tsx` 零改动。
2. 颜色改吃全局 token，删除 `--wb-*` 硬编码；深色主题自动跟随。
3. 复用 `src/components/bots/bots-data.ts` 的 `botStatusSummary()` 出状态文案与色档，不新增状态判定逻辑。
4. 入口图标 `Theater` → 调度语义（`LayoutList` / `GanttChart`），沿用 `workbenchTitle` 文案键。
5. i18n 新增约 12 个键；删除 `workbenchPhaseDawn/Day/Dusk/Night` 与 `workbench24hAgo` 等舞台专用键。
6. 服务端（可选，第二轮）：给 bot 心跳加最近的环形记录（如 `recent: [{at, ok, reason}]` 取 12 条），让失败/跳过点变成真实数据而不是推断。
7. 验证：`npx tsc -b`、`npx eslint .`、`npm run test`；涉及 UI 需在浅色与深色下各看一遍。

### 已知取舍

- **心跳历史只能近似。** 前端回推点在视觉上会被读成"真实记录"。若这轮不做服务端记录，界面上要明确写"按间隔推算"，不能默认用户知道。
- **24h 视图点会过密。** 30 分钟间隔在 24h 内是 48 个点，设计稿里做了抽稀（超过 26 个点按步进降采样），抽稀后每个点不再严格对应一跳。
- **工作台不再是"异质空间"。** 它会有意长得像应用的一部分。如果产品需要保留"打开一个小世界"的仪式感，这个方案会削掉它——这是本次换向的主要代价。

### 需要拍板

1. 方向：班表 / 网格墙 / 指挥台，还是「班表为主 + 行展开吸收指挥台」。
2. 工作台是否继续保留独立深色：建议跟随主题。
3. 心跳历史：先接受近似点，还是这轮就加服务端环形记录。
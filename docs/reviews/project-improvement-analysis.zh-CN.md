# QuickForge 项目健康度与改进机会分析报告

> 生成时间：2026-09-15 · 基线：HEAD a21d3bc（v2.1.0 之后）· 调研方式：5 路并行只读调研（代码质量 / 架构 / 测试 / 依赖工程化 / 文档遗留）+ 父 Agent 对关键断言逐一亲读核实
> 性质：纯分析报告，未修改任何生产代码；本文件是本次任务唯一交付物（feature_list/progress/session-handoff 未登记，遵用户「先不要修改代码」指示）

---

## 0. 摘要

QuickForge 当前处于**功能迭代高速期、质量基建滞后**的状态：

- **强项**：测试规模可观（325 文件 / 3669 用例，0 跳过）；TODO/FIXME 类注释为 0；console/eslint-disable 纪律良好；分层清晰（src 不 import server）；sqlite 迁移链、backup/tunnel 等集成测试扎实；lint 全绿（仅 1 个 warning）；版本卫生（lockfile 与 package.json 一致）。
- **核心矛盾**：**改动节奏快 + 无浏览器/组件级验证手段** → 「浏览器未实测」验收积压已达 29/109 个 done feature（27%）；测试大量退化为「源码字符串断言」（2248 处 toContain），对重构高误报、对行为回归低拦截。
- **最高性价比的三件事**：① 采纳并实施 subagent trace 修复方案 A（两份独立调研同向推荐，直接解决用户报告过的真实痛点）；② 用一次浏览器会话批量消化验收积压；③ 落地 goal-display 评审 P1 中的三个小改动（取整口径 / 键盘可达 / tone 收敛）。
- **最值得的结构性投资**：继续 agent-manager 拆分并消除 2 个静态循环依赖；建立最小 E2E 冒烟；让 test:coverage 真正可用。

---

## 1. 项目快照

| 维度 | 数据 |
|---|---|
| 版本 | 2.1.0（2026-09-13 发布，npm publish 待用户执行） |
| 前端 | src/ 260 文件 / 68,469 行（components 135 / lib 103 / hooks 19） |
| 服务端 | server/ 154 文件 / 45,231 行（routes 25 文件 8,772 行） |
| 测试 | 325 文件 / 3669 用例，全绿，0 skip |
| CI | ci.yml（ubuntu + node 22.19.x：lint+test+build）+ desktop-build.yml（tag 触发，仅 build 不跑 test） |
| 工作树 | 23 个 M（goal-mode-i18n-chinese 的完整交付，未提交）+ 7 个 untracked（含 2 个垃圾文件） |
| 提交节奏 | 2026-09-10 至 09-14 共 15 个提交，日均 2-4 个 |

---

## 2. 发现详述

### 2.1 待决策的修复方案：subagent 失败后刷新丢过程（用户痛点，两份报告同向）

这是**当前唯一已被用户实际报告、且修复方案已调研完毕但未实施**的功能缺陷。

- 根因链已双报告交叉验证（`docs/reviews/subagent-failed-run-trace-refresh-loss.zh-CN.md` 与 `subagent-failure-trace-recovery.zh-CN.md`）：
  - **P1**：置顶摘要「智能体·已结束」行是轻量载荷（`subagent-run-detail.ts:644/:744-748`），点击时 `WorkspaceInspector.tsx:1042` 依赖纯内存 store（刷新即空、100 条 FIFO）兜底——store 未命中即详情无 trace；而聊天卡入口（`local-tools.ts:626/785`）从持久化 details 现场重建永远完整。这正是用户「有些正常有些丢失」的来源。
  - **P2**：timing-only 终态 details 阻止 SSE 回填（`subagent-run-detail.ts:798-804` 判「任意 metadata」而非 messages 存在性）。
  - **P3**：残缺终态 store 遮蔽完整历史（`:489-507` 终态→终态不覆盖）。
- **两份报告一致推荐方案 A**（打开/回填完整度统一规则：store 未命中从 state.messages 重建 + 允许完整历史补齐残缺终态 + SSE 回填判断改为 messages 存在性），改动集中在少数纯函数。
- 配套已有 7 个诊断测试（`tests/frontend/subagent-failure-trace-recovery.test.ts`）锁定当前丢失行为，实施时应转为恢复契约。
- feature 状态：`subagent-failed-run-trace-refresh-loss-review` = needs-review，等待用户拍板。

### 2.2 浏览器验收积压：29 项（结构性风险）

- 109 个 done feature 中 **29 个（27%）** boundaries 明确标注「浏览器未实测/未验收」。
- 根因：项目**没有任何浏览器测试能力**——无 Playwright/Puppeteer/jsdom/happy-dom 依赖，React 组件 0 渲染测试，vitest 默认 node 环境（`vitest.config.ts` 无 environment 配置）。
- 积压可归并为 9 类验收场景（goal 中文文案 / goal_report 历史卡观感 / 设置页新行 / 置顶摘要展开 / ？ 浮层 / 重试保留工具历史 / 多会话并行 goal / ticker 递增 / 图标 aria），**多数可合并进 1-2 次浏览器会话消化**。
- 风险：每个「done 但未实测」的 UI 改动都可能是潜伏的视觉/交互回归；且该债务按当前迭代速度只增不减。

### 2.3 代码质量与技术债

生产代码卫生极好（TODO/FIXME 0 处、无注释掉的代码、console 残留仅 2 处且正当、eslint-disable 11 处全部窄化带理由）。技术债集中在两处：

**① Goal 显示层的历史遗留（有评审文档对照，`docs/reviews/goal-display-interaction-review.zh-CN.md`）**

| 项 | 证据 | 状态 |
|---|---|---|
| accept 通道「活逻辑 + 死按钮」 | `goal-card.ts:191` 硬编码 `accepting: false` → `:696-707` 的 accept 按钮分支与 `GoalInspectorContent.tsx:268` 的按钮分支**永远不可达**；而 `goal.ts:317` 的 `goalAcceptanceCheck` 逻辑仍在计算（父 Agent 亲读核实） | P2 未决策：恢复门禁或删除整条通道 |
| 8 个死 i18n key | `goalPlanConfirm/goalPlanConfirmed/goalPlanConfirming/goalPlanWait/goalNeedsReviewNote/goalNeedsReviewAcceptNote/goalMoreActions/goalSummaryDetails`（i18n.ts:894-897/:2730-2733 等，en/zh 各一份）；被 `tests/frontend/goal-card.test.ts:370-395` 双语齐全性测试**固化**，清理须同步改测试 | 评审 ND-02 的 14+ 个已自然消化一半，剩 8 个 |
| STATUS_ICON 双副本 | `goal-card.ts:246-255` 与 `goal-control-strip.ts:143-151`，5 个 SVG 逐字符一致，仅靠注释「Keep in sync」人工维持 | 同目录，提取共享模块成本极低 |
| goal-card.ts 847 行 | 较评审时 +25 行仍在增长；`localizedGoalBlockerHint`（:123）导出无外部消费者 | 随上述清理一并瘦身 |
| 取整口径矛盾 | `src/lib/goal.ts:336` 用 `Math.round(ms/60_000)`，而运行条侧契约（wiki components/README.md:148）声明「向下取整」 | P1-ND-07，几行改动 |
| 错误行无键盘入口 | `goal-control-strip.ts:374-375` error 仍是 `span`，无 button/tabIndex | P1-ND-13 |
| tone 色值重复定义 | `--quickforge-goal-tone` 在 index.css:6847/:6863-6867 与 :6970/:6991-6995 两组重复 | P1-C-01 |
| 唯一 lint warning | `server/cloud/identity.mjs:92` no-useless-assignment（`record` 赋值后被 :94 无条件覆盖；消警告前需确认 `ensureInstallation()` 是否依赖 rotate 落盘状态） | 低 |

**② 巨型文件（Top 行数）**

| 行数 | 文件 | 判断 |
|---|---|---|
| 2544 | `src/components/workspace/WorkspaceInspector.tsx` | **高**：单文件 3 个组件（InlineReader:325 / WorkspaceOverview:549 / WorkspaceInspector:689）+ 15 个辅助函数，面板/阅读器/总览/布局计算混杂 |
| 2782 | `src/lib/server-agent.ts` | 中：类型定义 + SSE 传输 + 状态合并 + ServerAgent 类（约 1833 行单类）混排 |
| 2619 | `src/App.tsx` | 中：35 useState / 42 useEffect / 85 useCallback，hook 编排 + 残余状态混合体（自定义 hook 已抽出 19 个，方向正确） |
| 2196 | `src/components/sidebar/ChatSidebar.tsx` | 中 |
| 2148 | `server/agent-manager.mjs` | 见 2.4 |
| 1948 | `server/routes/workspace.mjs` | 中低：≥6 职责（git 执行器/状态/目录/搜索/预览/外部打开） |
| 7953 | `src/index.css` | 中低：CSS 聚合常见，但已近 8k 行 |

### 2.4 架构与耦合

**分层是健康的**：src → server 零代码级 import（grep 验证），全靠 HTTP/SSE 契约；public-api 入口面收敛（desktop 只 import start/stop 两个符号）。

**核心问题 1：agent-manager.mjs 是全图耦合中心，且拆分运动未完成**

- 2148 行 / 44 个导出 / 12 个生产消费者（8 个路由 + ACP + index + share-store 动态 import）；自身管辖 ≥10 个域（会话生命周期、运行循环、工具装配、Goal、Subagent、压缩、审批、持久化 facade、SSE 锁、会话配置、标题生成、shutdown）。
- 项目内已有明确进行中的「agent-manager-module-split」运动：agent-compaction / agent-persistence / agent-session-events / agent-prompt-commands / agent-approval-orchestrator / agent-subagent-runner 头部注释均自证「从 agent-manager.mjs 逐字符搬移，本体继续作 facade」。

**核心问题 2：2 个真实静态循环依赖（父 Agent 亲读核实）**

```
agent-manager.mjs ──▶ agent-subagent-runner.mjs ──▶ agent-manager.mjs   (runner 回 import hasFullAccess/createServerTools/currentSessionTurnId)
agent-manager.mjs ──▶ agent-compaction.mjs ──▶ agent-manager.mjs        (compaction 回 import createAgent/resetIdleTimer)
```
- 目前靠 ESM 函数声明提升侥幸安全；直接后果是 8+ 个测试文件被迫 vi.mock（plugins.lifecycle / routes/agent.goal / routes/agent / ai-timeout-budgets / shared-conversation.model-visibility / side-chat / scheduled-tasks.execution / share-store.rollback-atomic）。
- 解法已明确：把 createServerTools / currentSessionTurnId / hasFullAccess / createAgent 下沉到低层 runtime 模块。

**核心问题 3：goal 契约 server/src 双份手工维护**

- `GOAL_STATUSES`（server/agent-goal-state.mjs:18 13 态 vs src/lib/goal.ts:110）、`GoalAction`、预算扩展语义（goal.ts:98 复刻服务端 goalBudgetExhausted）、`GOAL_BUDGET_HINT` 文案镜像（goal-card.ts:118 注释直接承认「按值复制」）。漂移风险有据可查（近期 i18n feature 就是为弥合文案漂移而做）。

**其他**：routes/workspace.mjs（1948 行 6 职责，git() 包装即 350 行）；index.mjs 路由分发 if-chain（:356-589）；storage.mjs 1160 行 49 导出；android 侧 RemoteTunnelService.kt 1331 行。

### 2.5 测试体系

| 发现 | 证据 | 风险 |
|---|---|---|
| `npm run test:coverage` 名存实亡 | vitest.config.ts 无 coverage 配置；package.json 无 @vitest/coverage-* 依赖，运行即报 provider not found | **中高**：项目没有任何覆盖率反馈回路，盲区只能靠人工盘点 |
| 字符串断言锁定「源码文本」而非行为 | 2248 处 toContain（136/325 文件）；66 个文件 readFileSync 直接读生产源码断言。实例：goal-report-renderer.test.ts:152-153 断言 SVG 坐标字面量、:141 锁死注册语句精确写法、workspace-inspector-width-range.test.ts:8-19 断言常量声明原文 | **高**：对重构高误报、对视觉/行为回归低拦截，与「改 UI → 改断言字符串变绿」模式互相强化 |
| server 侧盲区（0 测试引用） | routes/instructions.mjs、routes/mcp.mjs、routes/static.mjs、routes/terminal.mjs、plugins/loader.mjs、plugins/manifest.mjs、channels/channel-logs.mjs、cloud/index.mjs；另有 agent-subagent-runner.mjs（555 行）仅 1 处字符串断言、routes/scheduled-tasks.mjs（1149 行）仅 2 个测试 | 中 |
| 前端侧盲区 | server-agent.ts（2782 行枢纽仅 8 个测试引用）、App.tsx 9 个测试全为源码字符串断言零执行、custom-providers-only-tab.ts(932)/shared-server-agent/cloud-remote-client/remote-tunnel、mobile 两页面(624+501)、ScheduledTasksPage(1043)、TerminalDock(662)、AgentProfilesPage(777)、6 个 hooks 0 引用 | 中 |
| 正面 | 0 skip/todo；vm+transpileModule+模板 spy 精细范式已有 6 个文件先例（goal-report-renderer.test.ts:20-42 等）；tunnel-host 真进程集成测试质量高 | — |

### 2.6 依赖与工程化

| 项 | 证据 | 风险 | 说明 |
|---|---|---|---|
| xlsx 来自第三方 CDN tgz | package.json:105 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`；registry 上限 0.18.5，0.20.x 只在 CDN 发版 | **中** | integrity 锁定保证内容可复现，但 CDN 不可用/被替换即破坏所有 `npm ci`（含 CI）。可选：参照 vendor/node-pty 成熟先例 vendor 化 |
| desktop-build.yml tag 触发但不跑 test/lint | .github/workflows/desktop-build.yml:4-7 触发 v* tag；job 内仅 npm ci + desktop:build | **中** | 直接打 tag 而未经 main CI 验证的 commit，桌面产物只过 build 门禁；npm 发布产物无任何 CI 校验 |
| 发布流程人工占比高 | runbook 3.2 自动脚本已因 Windows `spawnSync npm.cmd EINVAL` 被弃用（runbook:41-43），实际默认全手动：CHANGELOG 编辑、4 条验证/打包命令、Git 四步、npm publish | 中 | scripts/prepare-patch-release.cjs(352 行) 功能完整且支持 --dry-run，修好 Windows 兼容即可恢复自动化 |
| CI 仅 ubuntu 单平台 | ci.yml:11-24 | 低 | 无 mac/win 矩阵、无 coverage 上传 |
| @emnapi/core+@emnapi/runtime 根级 devDep 疑似冗余 | package.json:93-94；src/ 零引用，真正使用者是 wasm 传递依赖（自带嵌套解析） | 低 | 可做移除试验（卸载后跑 build 验证） |
| node-pty 在 devDependencies | 但 desktop 打包用 vendor/node-pty（electron-builder.config.cjs asarUnpack + terminal-manager.mjs:39-60 vendor 优先加载），闭环自洽 | 低 | 设计正确，无需动作 |
| android:build Windows-only | package.json:67 `gradlew.bat` | 低 | 本地辅助脚本，CI 无 android 任务 |
| 可升级空间 | pi-agent-core/pi-ai 0.80.3 → 0.85.1（pi-web-ui 0.75.3 已是其最新版，非错位）；pdfjs-dist 5.4.394 → 6.x major | 低 | 套件统一升级 + 全量回归，非紧急 |

### 2.7 文档与状态卫生

| 项 | 证据 | 建议 |
|---|---|---|
| wiki 行数漂移 2 处 | docs/wiki/server/README.md:39 写 index.mjs「883 行」（实际 1080，:89 另写 1031 自相矛盾）；:40/:127 写 agent-manager「约 1966 行」（实际 2148） | 顺手修正或改为不带行数 |
| 滞后 feature 条目 2 个 | pinned-summary-subagent-finished-review（needs-review，但其方案 A 已由后续 feature 落地，commit a2f24e0）；goal-changes-commit（in_progress，目标提交链早已完成） | 关闭并更新状态 |
| 未提交工作 | 23 个 M = goal-mode-i18n-chinese 完整交付（已全量验证通过）+ subagent trace 双报告等 5 个 untracked | 建议尽快 commit（按项目规则由用户执行或授权） |
| 垃圾文件 | 根目录 untracked 的 `')'` 与 `' )))'` 两个空文件（疑似误创建） | 删除 |
| 唯一记录在案的「无关问题」 | progress.md:180：前端 retryFromMessage 允许对任意 user 消息重试 vs 服务端始终取最后一条 user 消息的口径不一致 | 低优先统一口径 |
| 历史评审未实施建议总量 | goal-display P1 6 项 / P2 9 项；goal-design-review X2/D1/D2/D3/B1/B3/E1；goal-ux-ui G 系列；goal-auto-complete-validation S2/S3/U2-U6 等 | 见第 3 节取舍建议 |

---

## 3. 优先级路线图（建议）

### 第一梯队：高性价比、立即可做（用户痛点 + 小改动）

1. **采纳 subagent trace 修复方案 A 并实施**（2.1）——两份独立调研同向推荐，改动集中在 `subagent-run-detail.ts` / `WorkspaceInspector.tsx` 的纯函数与兜底逻辑；直接消灭用户报告过的「刷新丢过程」缺陷；配套把 7 个诊断测试转为恢复契约。
2. **一次浏览器会话批量消化验收积压**（2.2）——按 9 类场景清单（中文文案 / goal_report 卡 / 设置页 / 置顶摘要 / 浮层 / 重试 / 并行 goal / ticker / aria）逐项过一遍，把 29 个「未实测」正式关闭或打回。**不依赖任何新工具，是当前风险收益比最高的动作。**
3. **goal-display P1 三个小项**（2.3-①）——ND-07 取整口径统一（几行）、ND-13 错误行键盘可达（span→button）、C-01 tone 色值收敛（CSS 去重）。均低风险。
4. **状态卫生一揽子**（2.7）——关闭 2 个滞后条目、删除 2 个垃圾文件、修正 wiki 2 处行数漂移、提交 23 个 M（需用户授权 Git 操作）。

### 第二梯队：结构性投资（止住债务增长）

5. **建立最小 E2E 冒烟**（2.2/2.5）——Playwright 覆盖 3-5 条链路（启动→发消息→工具卡渲染→设置页切换），此后新 UI feature 至少跑一次冒烟再标 done；这是止住「浏览器未实测」积压增长的根本手段。引入新依赖需按项目规则说明理由并审批。
6. **让覆盖率可用**（2.5）——安装 @vitest/coverage-v8（同样需依赖审批）或干脆移除 test:coverage 脚本消除误导；先把「盲区可见性」建立起来。
7. **补 server 盲区冒烟**（2.5）——routes/mcp|terminal|static|instructions、plugins/loader|manifest、channels/channel-logs、cloud/index 各加一个 fake req/res 路由级测试（仓库已有成熟范式可复制）。
8. **继续 agent-manager 拆分 + 消除 2 个静态环**（2.4）——沿用项目既定「逐字符搬移 + facade」模式，把 createServerTools/currentSessionTurnId/hasFullAccess/createAgent 下沉；直接减少 8+ 个测试文件的 vi.mock 负担。
9. **accept 通道决策 + 死代码清理包**（2.3-①）——ND-01 二选一（恢复 accepting 门禁或删除 accept 按钮分支与配套 key），同步收缩 goal-card.test.ts 固化清单、合并 STATUS_ICON 副本、清理 8 个死 i18n key。建议独立 feature（涉及契约测试）。

### 第三梯队：按需/观察

10. goal 契约单源化（GOAL_STATUSES 等共享定义，2.4）——可在下一次 goal 契约变更时顺带做。
11. desktop-build tag 门禁（打 tag 前强制 test 通过，或 runbook 明确 release commit 必须先过 main CI，2.6）。
12. 修复 prepare-patch-release.cjs 的 Windows EINVAL，恢复发布自动化（2.6）。
13. xlsx vendor 化评估（2.6）；@emnapi/* devDep 移除试验；pi-agent-core/pi-ai 套件升级（0.80.3→0.85.1）。
14. 巨型文件渐进拆分：WorkspaceInspector.tsx（最高优先）、server-agent.ts 类型/SSE 剥离、routes/workspace.mjs 按 git/列表/预览分域（2.3-②/2.4）。
15. 其余历史评审遗留（goal-design-review X2/D 系列、retryFromMessage 口径、CI 多平台等）按用户节奏排期。

### 明确不建议现在做的

- 全面重写 toContain 字符串断言——成本过高；正确路径是「新测试用执行式、存量按触碰时改造」，并把 goal-report-renderer 的 vm+模板 spy 范式推广到新写的渲染器测试。
- 大规模 i18n.ts / index.css 拆文件——属数据/聚合文件，当前规模可接受。
- 手工修改 dist/、package-dist/、package-offline（项目规则禁止）。

---

## 4. 调研方法与证据索引

- 五路并行只读 explore：①代码质量与技术债；②架构与模块结构（含静态 import 图 154 节点/556 边的环检测）；③测试体系与覆盖盲区（生产→测试静态映射）；④依赖与工程化（含 lockfile/npm view 实测）；⑤文档一致性与遗留盘点（含 git status/log）。
- 父 Agent 对以下关键断言逐一亲读核实：goal-card.ts:191/696 accepting 死按钮、agent-compaction.mjs:29 与 agent-subagent-runner.mjs:31/34 反向 import（循环依赖）、server/index.mjs 1080 行 / agent-manager.mjs 2148 行 / WorkspaceInspector.tsx 2544 行、wiki server/README.md:39-40 行数漂移、git status 的 23 M + 7 untracked（含垃圾文件 `')'` 与 `' )))'`）。
- 所有「无测试引用」结论为静态分析（import/vi.mock/readFileSync/spawn 全形式检索），个别间接覆盖无法排除，已标注为「无直接引用」。
- 本报告未运行 npm test/lint/build（零生产改动，无测试影响面）。

## 5. 本次任务边界

- 未修改任何生产代码、测试、依赖、生成产物；无 Git 操作。
- 本报告文件是唯一新增交付物；按用户指示未登记 feature_list.json / progress.md / session-handoff.md（如需纳入项目流程，可补一次状态文件更新）。
- 行数/行号引用基于当前工作树（含 goal-mode-i18n-chinese 未提交改动），快照日期 2026-09-15。

# QuickForge 项目自主分析报告（2026-09-15）

> 生成方式：4 路并行只读 explore 调研（架构 / 代码质量 / 测试与 CI / 文档与工作流）+ 父 Agent 对关键断言亲验（根目录清单、coverage provider、大文件行数、git status 等）。
> 基线：HEAD `a21d3bc`（v2.1.0 之后），工作树含多个并行会话的未提交改动（分析期间仍在动态变化）。
> 性质：**纯分析报告，未修改任何生产代码**。
> 与同日另一份报告的关系：`docs/reviews/project-improvement-analysis.zh-CN.md`（并行会话交付，189 行）与本报告独立调研、核心结论**同向交叉验证**；本报告另含一批其未覆盖的新发现，以及「并行会话已开始清理」的最新状态更新（见 §2），两份可互补阅读。

---

## 0. 摘要

QuickForge 处于**功能迭代高速期、质量基建滞后**的典型阶段：

- **底子很好**：325+ 测试文件全绿、TODO/FIXME≈0、console/eslint-disable 纪律严、前后端分层干净（src 零 import server）、发布有完整 runbook。
- **三个最痛的点**：
  1. **用户已报告、方案已调研、只待拍板**：subagent 失败后刷新丢执行过程（两份独立报告同向推荐方案 A）；
  2. **无浏览器级验证手段**：约 27% 的 done feature 标注「浏览器未实测」，测试大量退化为源码字符串断言（2248 处 toContain）；
  3. **40+ 文件长期未提交且多 feature 混叠**：约 4 个 feature 的全部成果只存在于工作区，无法干净拆分 commit，也阻塞下次发布。
- **最高性价比动作**（详见 §6 路线图）：采纳方案 A 修 subagent trace → 一次浏览器会话消化验收积压 → 补一个 10 行的 i18n key 对称测试（本次新发现的最大盲区之一）→ 分批提交工作区。

---

## 1. 项目快照（亲验数据）

| 维度 | 数据 |
|---|---|
| 版本 | 2.1.0（2026-09-13 发布；npm publish 待用户手动执行） |
| 前端 | src/ 260 个 ts/tsx（components 57 / lib 103 / hooks 19） |
| 服务端 | server/ 154 个 .mjs（routes 25 文件 8,772 行） |
| 测试 | 333 个测试文件（frontend 163 + server 170），全量约 36–38s，0 skip |
| CI | ci.yml（ubuntu + 单 Node 22.19.x：lint+test+build）+ desktop-build.yml（v* tag 触发，仅 build） |
| 工作树 | 28 个 M + 13 个 ??（≥4 个 feature 混叠，详见 §5.6） |
| 状态文件 | feature_list 36 条活跃 + docs/archive/ 归档 85 条（2026-09-15 刚执行归档） |

**超大文件 Top（亲验行数）**：index.css 7953 · i18n.ts 4000 · server-agent.ts 2782 · App.tsx 2619 · WorkspaceInspector.tsx 2544 · ChatSidebar.tsx 2196 · agent-manager.mjs 2148 · routes/workspace.mjs 1948 · agent-goal-runner.mjs 1485。

---

## 2. 重要状态更新：并行会话的清理已在进行（影响优先级判断）

分析期间发现同日有并行会话在共享工作树上推进清理工作，**部分历史欠账已被消化**，采纳建议时请以最新状态为准：

| 项 | 状态更新 |
|---|---|
| server 测试盲区 | `tests/server/cloud/index.test.mjs`、`tests/server/plugins/`（loader/manifest）、`routes/{mcp,terminal,static,instructions}.test.mjs`、`channels/channel-logs.test.mjs` 已作为未跟踪新文件出现——此前报告列出的 8 个 server 盲区大部分**正在补齐** |
| goal 死代码 | 8 个死 i18n key、STATUS_ICON 双副本**已清理/合并**（grep 零残留）；但 `createGoalCardController`（约 575 行，≈70% 的 goal-card.ts）生产零消费者、26 行空壳 `goal-plan-confirmation.ts`、恒不可达的 accept 通道**仍在** |
| identity.mjs:92 lint warning | 工作区 diff **已修复**（去掉无用赋值），但**未提交**；提交前建议复核 `ensureInstallation()` 是否依赖 `rotateInstallation()` 的落盘返回值 |
| 三状态文件膨胀 | 2026-09-15 已执行 `status-files-archive`（121→36 条，85 条 done 移入 `docs/archive/`），但归档本身无脚本、无上限（见 §5.5） |
| 根目录垃圾文件 | `')'`、`' )))'` 等误创建文件已消失；`$null`（PowerShell 重定向产物）与 74 个 `.goal-runtime-*` 目录**仍在**（亲验） |

---

## 3. 健康面（值得保持的做法）

1. **代码卫生罕见地好**：TODO/FIXME/HACK ≈ 0（server 仅 1 处为 prompt 文案中的中文字样）；console.log 残留仅 1 处且正当；`@ts-ignore` 0 处；eslint-disable 仅 11 处全部窄化带理由。
2. **分层纪律**：src/ 零 import server/，前后端仅靠 HTTP/SSE 契约；`public-api.mjs` 入口面收敛（desktop 只 import start/stop 两个符号）。
3. **架构演进有既定模式**：agent-manager 拆分运动采用「逐字符搬移 + facade」头部注释自证，可审计、可回滚。
4. **测试基建部分扎实**：vm+transpileModule+模板 spy 的执行式测试范式已有先例；tunnel-host 真进程集成测试质量高；0 skip。
5. **依赖卫生**：node-pty vendor 化（devDep 为构建源 + `vendor/node-pty` prebuilds 运行时加载）是处理原生依赖的正确取舍，无需动作。
6. **文档意识强**：DESIGN_LANGUAGE.md 定位清晰；wiki 14 个 README 覆盖主要目录；reviews 目录保留完整决策链。

---

## 4. 新发现清单（本轮独有或深化的发现，按主题）

### 4.1 i18n 双语手工维护无对称防护 🔴

- **证据**：`src/lib/i18n.ts` 4000 行，en 块 1,810 keys、zh 块 1,810 keys 纯手工成对；zh 块**没有** `satisfies Record<AppTextKey, string>` 约束（`:3668` 仅 `} as const`）；`t()` 为 `?? en[key]` 静默回退（`:3958`）。现有防护只有 per-key 零散断言；goal-mode-i18n-chinese 验证时的一次性 node 断言（en/zh 各 1,820 对称）**未固化为测试**。
- **影响**：zh 漏加/拼错 key 时 TS 与 CI 均无告警，中文用户直接看到英文回退；当前恰好对称是靠人肉维持的巧合。
- **建议**：加一个 ~10 行测试做 `Object.keys(en)` vs `Object.keys(zh)` 双向 diff（或给 zh 块加 `satisfies`）。**成本极低、收益极高**。

### 4.2 跨端硬编码集中爆发 🟡

| 项 | 证据 | 风险 |
|---|---|---|
| 隧道地址 `127.0.0.1:18080` | server/index.mjs:666,675,752 · capacitor.config.ts:13 · RemoteTunnelService.kt:48 · mobile-server.ts:175 · remote-tunnel.ts:59-60 · CloudRemotePage.tsx:7-8,619 · RemoteTunnelOverlay.tsx:10-11（TS/Kotlin/server 三种语言 8+ 处） | 改端口需人肉找全跨端文件，漏改即隧道静默不通 |
| 云服务默认地址 | `src/lib/cloud-remote-client.ts:7` 硬编码公网 IP `http://42.194.187.88:8080`（无 TLS） | 服务器迁移必须发版；裸 IP 无加密，运维+安全双隐患 |
| 琥珀色 `#d97706` | index.css 26 处 + goal-inspector.css 2 处共 28 处散布 | 违反 DESIGN_LANGUAGE token 方向；调色/暗色适配逐点漂移 |
| `GOAL_BUDGET_HINT` 文案 | 同一英文句子镜像于 agent-goal-runner.mjs:70、goal-card.ts:119、i18n.ts:878 **三处**，且前端靠 `hint === GOAL_BUDGET_HINT_TEXT` **全等匹配**决定本地化 | 服务端改一个标点即静默失效（中文用户回退英文），无契约测试守护 |

- **建议**：hint 改为按稳定 code 匹配（服务端已有 errorCode 模式可复用）；端口/IP 提常量并加跨端同值契约测试；色值提升为语义 token。

### 4.3 类型绕过与吞错规模 🟡

- `as unknown as` 双重断言 **74 处**（src/），重灾区 server-agent.ts（约 35 处，典型 :2004-2108 连续自造事件对象）、shared-server-agent.ts:218-290、ChatPanelHost.tsx:1678-1792——比 `any` 更隐蔽，事件 schema 演进时编译期无感。
- server/ 456 个 catch 中 **85 个为空块或仅注释**（约 20+ 处纯 `// ignore` 无错误对象记录），排障时完全静默；建议至少 debug 级 logger 落一笔。
- 巨型函数：`createAgent` 单函数 **444 行**（agent-manager.mjs:578-1021）、`runPrompt` 162 行、`finishGoalRun` 137 行。

### 4.4 CI / 构建工程化缺口 🟡

| 项 | 现状 | 缺口 |
|---|---|---|
| coverage | `test:coverage` 脚本存在，但 `@vitest/coverage-v8` **未安装**（亲验 node_modules） | 运行即报 provider not found；要么装（需依赖审批）要么删脚本消除误导 |
| ci.yml | 单 job、矩阵仅 `22.19.x` 单值（形同虚设） | 无 timeout-minutes、无 concurrency 取消旧 run、无测试结果上报 |
| desktop-build.yml | `v*` tag 触发 | **tag 发布路径不跑 test/lint**——未经 main CI 验证的 commit 可直接产出桌面安装包（与并行报告同向） |
| Android | 有 android:build 脚本 | 完全无 CI 覆盖 |
| vite build | manualChunks 设计良好（monaco 不设 chunk 有注释说明） | KaTeX 字体/大 chunk warning 长期「已知放行」；可显式处理消噪，让新 warning 可见 |
| xlsx 依赖 | `cdn.sheetjs.com` tarball（0.20.x 不发 npm registry） | `npm ci` 依赖该 CDN 可达（国内镜像不代理），供应链单点；可参照 vendor/node-pty 先例 vendor 化 |
| 发布脚本 | prepare-patch-release.cjs（304 行）功能完整 | 因 Windows `spawnSync npm.cmd EINVAL` 被弃用（runbook §3.2），发布退化为纯手工；修好兼容即可恢复自动化 |
| husky | pre-commit 仅 `npm run lint` | 不含 tsc（可接受；类型错误要等 build/CI 才暴露） |

### 4.5 测试形态与验收积压 🔴（与并行报告同向，补充量化）

- **无浏览器测试能力**：无 Playwright/Puppeteer/jsdom/happy-dom；vitest 默认 node 环境；React 组件 0 渲染测试 → 「浏览器未实测」积压约 29/109 done feature（27%），可归并为 9 类场景、1–2 次浏览器会话消化。
- **源码字符串断言**：2,248 处 toContain、66 个文件 readFileSync 直接读生产源码断言（如断言 SVG 坐标字面量、常量声明原文）——对重构高误报、对行为回归低拦截。
- **组织**：tests/frontend 163 个文件全扁平无子目录（server 侧有子目录），检索成本上升；fixtures/ 4 个 worker 脚本不参与 vitest 执行（合理但无说明）。
- **残余盲区**：`tool-wiring.mjs`、`reasoning-cache.mjs`、`agent-subagent-runner.mjs`（555 行）在 tests/server 无直接引用；`server-agent.ts`（2,782 行前端枢纽）仅 8 个测试引用；App.tsx 9 个测试全为源码字符串断言零执行。

### 4.6 文档体系与工作流 🟡

- **wiki 系统性漂移（量化）**：server 72 个 .mjs 中 17 个（24%）未被 server/README 提及（含 `public-api.mjs` 四端入口之一）；src/lib 101 个 .ts 中 31 个（31%）未提及（含 mobile-server/remote-tunnel/cloud-remote-client）；scripts 9 个中 3 个。无 last-verified 标注、无漂移自检。
- **wiki 巨型化**：server/README 116KB、components/README 119KB、lib/README 67KB——单文件消耗数万 token，与「低成本导航」定位矛盾；wiki/README.md:1-3 头部直接嵌入 Goal 运行时契约快照，且 Goal 契约散落 3 处需多点同步。
- **docs/ 无索引**：docs/README.md 仅 7 行只链 user-guide；architecture/ 29 篇文档（含已实施/spike/废弃混合状态）完全不可发现；reviews/ 10 篇中 4 篇 Goal UI 评审高度重叠无主从关系。
- **CHANGELOG 无 `[Unreleased]` 段**：2.1.0 后已有 1 提交 + 大量未提交工作，下次发布需翻 git log 重建变更清单。
- **三状态文件 + 归档双增长**：归档刚执行（好），但 docs/archive/ 三文件已达 477/443/184KB（合计 1.1MB）且按同样模式无限追加、归档靠 agent 手工搬移无脚本；同一 feature 在三文件重复记录（冗余 60%+），每会话 startup 固定消耗大量 token。
- **根目录卫生**：74 个 `.goal-runtime-*` 运行时目录未被 .gitignore 覆盖（git 不可见但污染目录/IDE 索引）；`$null` 文件；`design-mockups/`(33 文件)/`design-review/`(6) 与 `docs/design/`(19) 职责重叠；`goal-test-demo.md` 在根目录应归 docs/。

### 4.7 未提交改动：丢失与不可回滚风险 🔴

- **现状**（git status 亲验）：28 M + 13 ??，横跨 ≥4 个独立工作流（dead-code-cleanup、goal-mode-i18n-chinese、subagent-failure-trace ×2、status-files-archive）。
- **归属混乱已发生**：两个 done feature（如 goal-card.ts、i18n.ts、goal-card.test.ts 同时出现在两份 files 清单）同文件叠加，**已无法按 feature 干净拆分 commit**。
- **风险**：① 约 4 个 feature 成果无任何 git 快照，一次误操作即蒸发；② 无法单独 revert/review；③ patch-release-runbook 要求发布前工作区干净，当前状态**阻塞下次发布**；④ 10 个 needs-review feature 的评审产物也未入库。
- **建议**：按「归档/纯新增 → 混合改动」分批提交（叠加部分如实描述，不强求完美拆分）；流程上把「done 后提醒 commit」加入 Definition of Done；多会话场景改用 `git worktree` 隔离或约定会话结束必须 commit/stash。

---

## 5. 与并行报告同向确认的核心结论（不赘述，仅索引）

以下结论经本轮独立调研**交叉验证一致**，采信度高：subagent trace 修复方案 A 推荐（P1 轻量载荷/store 未命中、P2 timing-only 阻断回填、P3 残缺终态遮蔽）；agent-manager 为全图耦合中心 + 2 个静态循环依赖（↔agent-subagent-runner / ↔agent-compaction，致 8+ 测试文件 vi.mock，解法为下沉 createServerTools/currentSessionTurnId/hasFullAccess/createAgent 四符号）；goal 契约 server/src 双份手工维护；goal-display 评审 P1 小项（取整口径/键盘可达/tone 收敛）；桌面 tag 发布无测试门禁；@emnapi/* 冗余 devDep 试验；pi-agent-core 0.80.3→0.85.1 升级空间。

---

## 6. 建议路线图（按性价比）

### 第一梯队：立即做（小改动、高收益）

1. **拍板并实施 subagent trace 修复方案 A**——用户已报告的真实痛点，两份报告同向，改动集中在 subagent-run-detail.ts / WorkspaceInspector.tsx 纯函数与兜底；配套把 7 个诊断测试转为恢复契约。
2. **补 i18n en/zh key 对称测试**（~10 行）——消除 1,810 key 人肉同步风险（§4.1，本轮新发现）。
3. **一次浏览器会话批量消化 9 类验收积压**——不依赖新工具，风险收益比最高的动作。
4. **分批提交工作区**（需用户授权 Git）——先纯新增（报告/新测试/goal-command-messages.mjs），后混合改动；同时复核 identity.mjs 修复语义后一并入库。
5. **状态卫生一揽子**：CHANGELOG 补 `[Unreleased]` 段；删 `$null`；.gitignore 加 `.goal-runtime-*/`；关闭已滞后的 feature 条目（pinned-summary-subagent-finished-review 方案已落地、goal-changes-commit 已完成）。

### 第二梯队：结构性投资（止住债务增长）

6. **goal 死代码清理包**（更新后剩余项）：createGoalCardController ≈575 行 + 空壳 plan-confirmation + 恒不可达 accept 通道 + 配套 CSS——独立 feature，同步契约测试。
7. **让覆盖率可用**：安装 @vitest/coverage-v8（需依赖审批）或删除 test:coverage 脚本。
8. **建立最小 E2E 冒烟**（Playwright 3–5 条链路）——止住「浏览器未实测」积压增长的根本手段。
9. **继续 agent-manager 拆分 + 消除 2 个循环依赖**——沿用「逐字符搬移 + facade」既定模式。
10. **desktop-build tag 前置 test 门禁**；ci.yml 加 timeout/concurrency、矩阵要么删要么真加版本。

### 第三梯队：按需排期

11. 跨端硬编码治理（§4.2：hint 改 code 匹配、18080 端口/IP 提常量、#d97706 token 化）。
12. wiki 紧凑化改造 + 漂移自检脚本（目录清单 vs wiki 提及对比）；Goal 契约收敛单一权威文件。
13. 三状态文件瘦身契约（approach/verification 限长、细节移 docs/reviews 链接化）+ 归档脚本化分片。
14. 修复 prepare-patch-release.cjs 的 Windows EINVAL，恢复发布自动化。
15. 巨型文件渐进拆分：WorkspaceInspector.tsx（4 组件分文件，最优先）→ server-agent.ts 类型/SSE 剥离 → routes/workspace.mjs 按 git/fs/preview 分域；`as unknown as` 热点收敛；空 catch 补 debug 日志。
16. xlsx vendor 化评估；根目录设计资产归位 docs/design/；tests/frontend 子目录化。

### 明确不建议现在做的

- 全面重写存量 toContain 字符串断言（成本过高；新测试走执行式、存量按触碰时改造）。
- 大规模拆分 i18n.ts / index.css（数据/聚合文件，规模可接受）。
- 手工修改 dist/、package-dist/、package-offline（项目规则禁止）。

---

## 7. 调研方法与边界

- **方法**：4 路并行 explore（架构与模块结构 / 代码质量与技术债 / 测试·CI·构建·依赖 / 文档与工作流）+ 父 Agent 亲验关键断言（根目录文件清单、`$null`、74 个 .goal-runtime-*、`@vitest/coverage-v8` 不存在、Top10 大文件行数、git status 28 M + 13 ??、与并行报告逐节比对）。
- **边界**：① 行号基于含未提交改动的当前工作树快照，并行会话持续写入会造成漂移；② 「无测试引用」为静态分析（import/vi.mock/readFileSync 全形式检索），不排除间接覆盖；③ 空块 catch / `as unknown as` 计数含少量合法场景，为量级参考；④ 未运行 npm test/lint/build（零生产改动，无测试影响面）；⑤ 本报告未登记 feature_list/progress/session-handoff（遵用户「先不要修改代码」指示，报告文件本身为唯一交付物）。

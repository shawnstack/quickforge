# QuickForge 项目健康体检报告

> **勘误与阶段更新（2026-09-15）**：正文保留原始静态调研快照；除下述复核事实及状态文件中的验证证据外，其余未经验证结论仅为静态建议，不代表已证实缺陷。
> - C1 对测试缺口的表述有误：`conversation-compaction.test.mjs`、`auto-compaction.test.mjs`、`network-proxy.test.mjs` 原本已由 Git 跟踪并直接测试对应模块，并非只有间接覆盖。新增后端保护为 8 个测试文件、108 用例（原 104，supervisor 隔离加强后 6→10），另有 2 个 helper 夹具；244 是混合前后端定向总数，不能记作后端新增用例。
> - C3 错误：`vite.config.ts` 没有 test 段，不存在所称重复配置。A2 coverage provider 与 A5 测试目录残留已完成治理，详见 `feature_list.json` / `progress.md`。
> - B7 是进行中而非全部完成：`server-agent.ts` 2782→2236 行，已提取 types（245）、HTTP（16）、SSE（340）模块并保留旧入口兼容；删除 11 处冗余 AgentEvent 断言，仍有 20 处事件边界断言待收敛。新增前端 HTTP/SSE 2 文件 13 用例，10 文件定向 293 通过；其余四个巨石拆分仍 planned。
> - 父 Agent 于 2026-09-15 03:59 UTC 执行 `npm run test && npm run lint && npm run build`，exit 0；截断日志未取得全量用例总数，不补写推测值。构建仍有既有 KaTeX/font/chunk warning。后续并行清理与完整边界以状态文件为准。

- **日期**：2026-09-15
- **方式**：只读调研（未修改任何代码）
- **范围**：server/ 后端、src/ 前端、测试与 CI、工具链与构建、依赖与安全、文档一致性
- **背景**：`feature_list.json` 为空（历史已归档），处于全新状态，适合做一次全局体检后规划下一批改进

---

## 一、总体评价

**整体健康度高于典型水平。** 后端资源管理严谨（子进程全清理、定时器 `unref`、完整 shutdown 序列）、并发写有"per-store FIFO 队列 + 原子 rename + SQLite per-row CAS"三层防护、全库零真实 TODO/FIXME、日志实践统一（42 个文件用 `utils/logger`）。测试规模可观（332 个测试文件，server 侧测试:源码 ≈ 1.1:1）。安全架构成熟：realpath 双层路径防护、fail-closed 审批（超时默认拒绝）、token 哈希存储、限速锁定、敏感 header 脱敏均已到位。

主要改进空间集中在四类：

1. **类型与工具链配置硬伤**（tsconfig 未开 strict、coverage 脚本坏、Windows-only 脚本）
2. **少数巨型模块**（server-agent.ts / App.tsx / agent-manager.mjs / routes/workspace.mjs）与系统性类型逃逸（74 处 `as unknown as`）
3. **少量安全放宽点**（run_command 整机权限、Host 白名单、capacitor `allowNavigation: '*'`）
4. **文档行数大面积漂移**（约 30+ 处，且存在文档内部自相矛盾）

---

## 二、规模概览

| 维度 | 数据 |
|------|------|
| server/ | 154 个 .mjs，约 40.8k 行 |
| src/ | 259 个 ts/tsx，约 61.3k 行；另 index.css 7,567 行 |
| 测试 | 332 个文件（tests/server 170、tests/frontend 161、内联 1） |
| CI | ci.yml（lint+test+build，ubuntu，Node 22.19.x）；desktop-build.yml（三平台矩阵，tag 触发，不跑 lint/test） |
| 版本 | 2.1.0（npm 已发），git 工作区有约 40 个未提交修改 + 13 个未跟踪文件（goal 特性进行中） |

**server/ 最大文件**：agent-manager.mjs (2148 行/41 导出)、routes/workspace.mjs (1948)、agent-goal-runner.mjs (1481)、tools/index.mjs (1180)、routes/scheduled-tasks.mjs (1149)、storage.mjs (1027)、index.mjs (1080)

**src/ 最大文件**：i18n.ts (3972)、server-agent.ts (2782)、App.tsx (2619，MainApp 单组件 ~2350)、WorkspaceInspector.tsx (2544，主组件 ~1855)、ChatSidebar.tsx (2196)、ChatPanelHost.tsx (1895)

---

## 三、发现清单

### A. 高优先级（建议尽快处理）

| # | 发现 | 位置 | 严重度 |
|---|------|------|--------|
| A1 | **两个 tsconfig 均未开启 `strict`**：`strictNullChecks`、`noImplicitAny` 全部关闭。React 19 + TS 6 前端缺少最基础的类型严格度，也是前端 74 处 `as unknown as` 得以存在的土壤 | tsconfig.app.json / tsconfig.node.json | 🔴 高 |
| A2 | **`test:coverage` 脚本实际不可用**：实测报 `Cannot find dependency '@vitest/coverage-v8'`，vitest.config.ts 也无 coverage 配置段，覆盖率无法量化 | package.json:57、vitest.config.ts | 🟡 中 |
| A3 | **`android:build` 仅 Windows 可用**：`cd android && gradlew.bat assembleDebug`，Unix 上 `gradlew.bat` 不存在 | package.json:67 | 🟡 中 |
| A4 | **Win 桌面构建路径不完整**：`desktop:build` 与 `desktop:build:all` 均不执行 `nsis-patch/apply.mjs`，仅 `desktop:build:win` 执行——在 Windows 上跑默认/all 构建会产出**未打覆盖安装自愈补丁**的安装器 | package.json:59-63 | 🟡 中 |
| A5 | **根目录堆积 74 个 `.goal-runtime-*` 测试残留目录**：来自 `tests/server/agent-goal-runtime.test.mjs:82` 用 `process.cwd()` 建 temp 目录；未被 `.gitignore` 显式忽略，只因内部全是 `*.log` 恰好被全局规则掩盖，一旦测试写入非 log 文件会全部变为 untracked | .gitignore、tests/server/agent-goal-runtime.test.mjs:82 | 🟡 中 |
| A6 | **capacitor 安全敏感组合**：`allowNavigation: '*'`（任意域名）+ `useLegacyBridge: true`（向每页注入 androidBridge）+ `cleartext: true`——任意被导航页面都能拿到原生 bridge；另含硬编码公网 IP 占位 | capacitor.config.ts:10-21 | 🔴 高（安全） |
| A7 | **run_command `shell:true` 全机权限**：workspace 防线对 shell 无效，命令可读取 `~/.quickforge/storage/provider-keys.json`（设计如此，依赖审批门/YOLO 信任兜底）。可选改进：结果/日志侧对存储目录路径增加告警或可选拦截 | server/tools/index.mjs:922-928 | 🔴 高（设计固有面） |
| A8 | **审批安全链路无后端专属测试**：approval-store.mjs、agent-approval-orchestrator.mjs（审批 5 分钟超时默认拒绝等 fail-closed 逻辑）仅被间接覆盖 | server/approval-store.mjs、server/agent-approval-orchestrator.mjs | 🟡 中 |
| A9 | **LAN 分享开启时 Host 白名单放通任意 hostname**（`index.mjs:651-654` 把请求 Host hostname 动态加入白名单），弱化 DNS rebinding 防御；建议改为放通本机实际网卡 IP 集合 | server/index.mjs:647-658 | 🟡 中 |
| A10 | **ESLint 对 tests/**、scripts/*、bin/*.mjs 零规则覆盖**：实测 `--print-config` 返回空 rules，lint 对约 40k 行的服务端测试与构建脚本完全不生效 | eslint.config.js:20-49 | 🟡 中 |

### B. 架构与代码质量（中优先级，渐进式）

**后端：**

| # | 发现 | 位置 |
|---|------|------|
| B1 | agent-manager.mjs 是上帝模块：会话生命周期、运行控制、工具装配、SSE 管理、审批编排、标题生成混杂，41 个导出、头部 100 行 import。已有拆分意识（依赖注入避免循环导入），建议按域继续抽离 SSE/审批/标题，目标 ~800 行 | server/agent-manager.mjs |
| B2 | routes/workspace.mjs 混合 ≥5 个域（文件浏览/git 全家桶/AI commit 生成/ripgrep 搜索/预览 ETag），建议拆为 git / workspace-files / workspace-search | server/routes/workspace.mjs |
| B3 | **进程树终止逻辑存在 4 个平行实现且细节不一致**（信号语义、是否等待退出）：workspace.mjs:97、tools/index.mjs:835、process-channel.mjs:41、qf-agent-process.mjs:202（最完善：优雅→超时→强杀）。建议收敛到 `utils/process-tree.mjs`，改动小收益明确 | 见左列 |
| B4 | agent-goal-runner.mjs (1481) 与 routes/scheduled-tasks.mjs (1149) 各自是"状态机+执行器+AI 解析"巨石，优先级低于 B1/B2 | 同左 |
| B5 | 跨文件重复小 helper：`getApiKey`（2 处逐字符相同）、`poolMap`（2 处）、`writeSseEvent`（3 处）、`requestError`（13 个文件各自定义）。可机械收敛到 utils | 见 subagent 报告 |
| B6 | cutover 三兄弟（share/lan-access/scheduled-runs JSON→SQLite 迁移）为计划内技术债，迁移收尾后整体删除即可，不建议现在重构 | server/*-cutover.mjs |

**前端：**

| # | 发现 | 位置 |
|---|------|------|
| B7 | server-agent.ts 是 god module：SSE 客户端 + ~30 个类型 + 1800 行 ServerAgent 类；36 处 `as unknown as`，其中 `{...} as unknown as AgentEvent` 系统性出现 17+ 次（自定义事件与上游 AgentEvent 联合类型不兼容，靠断言绕过）。建议拆 3 模块并用声明合并/窄化 emitToListeners 消除断言 | src/lib/server-agent.ts |
| B8 | App.tsx MainApp ~2350 行：35 useState / 42 useEffect / 85 useCallback，effect 竞态与依赖维护成本高；建议按域（终端/Git/splash）收拢为 hook 或 context 切片 | src/App.tsx |
| B9 | WorkspaceInspector 主组件 ~1855 行：39 useState + 30 useRef，树加载/搜索防抖/diff 展开/双 resize/全屏动画/移动端 overlay 混杂；建议拆 reducer/context 或至少抽 resize hook | src/components/workspace/WorkspaceInspector.tsx |
| B10 | 外部可变存储未用 `useSyncExternalStore`（全项目 0 处），靠 "bump revision + 强制重渲染" 模式（21 处），直接导致 App.tsx 4 处 `exhaustive-deps` eslint-disable。迁移后可顺带消掉 4 处抑制 | App.tsx、hooks/* |
| B11 | 87 处原生 `fetch(` 散布 ~40 个文件，超时/错误归一化/baseUrl 前缀各自实现；EventSource 有 3 套独立实现。建议抽共享 `apiFetch` 并评估 SSE 客户端复用 | src/ 多处 |
| B12 | ChatSidebar 会话行 JSX 内联重复 4 份（timeline/project/global/search 四处渲染结构高度相似），行内交互态变化会重渲染所有可见行；全 src 仅 1 处 `memo()`。建议抽取 SessionRow memo 组件 | src/components/sidebar/ChatSidebar.tsx |
| B13 | ChatPanelHost ~45 个 props 重 prop drilling，建议聚合为 actions 对象或 context | src/components/chat/ChatPanelHost.tsx:266-314 |
| B14 | 设置页双范式并存：10 个 Lit 模板 tab（~5400 行）vs React tab，桥接机制已就绪（react-settings-tabs.tsx）；可约定新页一律 React，按迭代迁移最大的两个 | src/lib/*-settings-tab.ts |

### C. 测试与 CI

| # | 发现 | 说明 |
|---|------|------|
| C1 | server 核心模块测试覆盖总体良好（agent-manager 11 个专项、goal 13+13 用例含失败分支、sqlite/repository/ACP/share-store 均有较深覆盖），但缺口集中在：**approval-store / approval-orchestrator**（安全链路，见 A8）、**mcp/config.mjs、mcp/tool-name.mjs**（仅间接覆盖）、**restart-supervisor / update-supervisor / network-proxy**、**compaction 族**（仅 manager 层间接涉及） | — |
| C2 | desktop-build.yml 不跑 lint/test，仅构建上传；无 Android CI | .github/workflows/desktop-build.yml |
| C3 | vitest.config.ts 与 vite.config.ts 的 test 段内容完全重复，存在双源漂移风险 | vitest.config.ts |
| C4 | frontend 侧测试:源码 ≈ 0.6:1，弱于 server 侧（1.1:1），巨型组件（B7-B9）缺测试保护会加大拆分风险 | — |

### D. 依赖与体积

| # | 发现 | 严重度 |
|---|------|--------|
| D1 | `@emnapi/core` + `@emnapi/runtime` 为**零源码引用的死依赖**，可移除 | 低 |
| D2 | `@mariozechner/mini-lit` 仅为一个 Select 组件引入，三套 UI 运行时并存（React + Lit + mini-lit） | 低 |
| D3 | monaco-basic-languages.ts 引入约 80+ 门语言 contribution，是最大体积可裁剪项（monaco/pdfjs/docx/xlsx/mermaid 均已懒加载 ✓） | 低 |
| D4 | node-pty 在 devDependencies 是正确设计（作为 vendor 源，运行时加载 vendor/），但升级 devDep 后忘记重跑 `scripts/vendor-node-pty.mjs` 会导致 vendor 滞后 | 低（流程风险） |
| D5 | `xlsx` 走 CDN tgz：lockfile 有 integrity 完整性校验，供应链完整；但源脱离 npm registry，离线重建依赖 offline 包机制。属可接受的有意选择 | 信息 |
| D6 | `node-pty` 在 devDependencies 而 `files` 发布 vendor——划分正确（构建期工具同理） | 信息 |

### E. 安全（其余项）

| # | 发现 | 严重度 |
|---|------|--------|
| E1 | 敏感文件黑名单未覆盖 `.htpasswd`、`*.kdbx`、`*.ppk`、`id_ecdsa`、GCP service-account JSON、`.npmrc` 等，且仅 workspace 内生效 | 低 |
| E2 | Tailscale 手机限制（`.ts.net`/100.64.0.0/10）仅客户端强制，服务端不校验来源网段，密码门是唯一防线；SECURITY.md 措辞可补充说明 | 低 |
| E3 | SECURITY.md Supported Versions 仅列 1.0.x，实际已是 2.1.0；漏洞报告走公开 issue，建议改用 GitHub 私密漏洞报告 | 低 |
| E4 | ✅ 正面确认：监听绑定与文档一致、认证/鉴权质量高、路径穿越防护扎实、AI HTTP 日志脱敏、生产代码零硬编码密钥、根目录无 .env | — |

### F. 文档一致性

**✅ 核心语义已验证一致**（逐条核对源码）：Goal 预算恢复契约（默认 20 轮/clamp 1-100/extend_resume CAS 与 409）与 patch 发布 runbook 与脚本步骤。

**❌ 失同步清单：**

| # | 发现 | 位置 |
|---|------|------|
| F1 | src/README.md 行数大面积过期且**文档内部自相矛盾**（App.tsx 写 625/684 两处 vs 实际 2380；lib/ 写 87 个模块实际 101） | docs/wiki/src/README.md:18-31 |
| F2 | server/README.md 抽查 15 个模块行数**全部漂移**且多处内部矛盾（storage 707→1027、share-store 432→704 等十余处） | docs/wiki/server/README.md |
| F3 | routes/README.md 行数漂移 + `## workspace.mjs` 两个重复小节（L288/L305）、`## backup.mjs` 两个同标题小节 | docs/wiki/server/routes/README.md |
| F4 | wiki 缺 desktop/ 与 android/ 目录页（nsis-patch 用途、electron-builder/capacitor 配置仅存在于代码注释） | docs/wiki/ |
| F5 | scripts/README.md 行数自相矛盾（prepare-runtime-package 表 19 行/章节 13 行） | docs/wiki/scripts/README.md |

### G. 其他工程细节

- `.nvmrc` 只写 `22`，与 `engines.node: ">=22.19.0"` 粒度不一致（装到低于 22.19 的 22.x 会违反 engines）
- android `versionCode 1` / `versionName "1.0"` 硬编码，与 npm 2.1.0 脱钩，发布需手工 bump
- 缺 `typecheck` 独立脚本（类型检查只能借道 build）；`start`/`preview` 完全重复
- 根目录有 `$null`/`nul` 重定向事故产物（已被 gitignore 覆盖，可本地清理）
- 硬编码 hex 色 19 处（TerminalPane ×8、startup-splash-icon ×6、App.tsx ×5，品牌/终端配色建议收敛为令牌）；静态任意值 Tailwind 类可逐步提为令牌
- i18n.ts 3972 行单文件字典、index.css 7567 行单文件，可按域拆分（低优先级）

---

## 四、亮点（无需整改，值得保持）

1. **后端资源管理**：所有子进程有 timeout/abort/进程树清理；~20 处定时器 `unref`；shutdown 序列完整（qf-agent→scheduler→agent→MCP→channels→terminal→HTTP→sqlite）
2. **并发写三层防护**：config store FIFO 队列 + 原子 rename（含 Windows AV 重试）+ session per-row revision CAS + 快照冻结 + 跨进程 fencing token
3. **fail-closed 设计**：审批超时默认拒绝、unlock 限速锁定、token 存储异常时拒绝服务
4. **性能**：重依赖全家桶懒加载、自研长会话窗口化渲染（设计文档完善）、SSE watchdog/重连上限
5. **测试深度**：goal/goal-runner 测试覆盖持久化失败、malformed body、不可验证 criteria 等失败分支
6. **零真实 TODO/FIXME**、统一结构化日志、单一 console.log 且有充分理由

---

## 五、建议行动清单（按 ROI 排序）

| 优先 | 行动 | 对应发现 | 预估量级 |
|------|------|----------|----------|
| P0 | `.gitignore` 增加 `.goal-runtime-*` + 测试改用 `os.tmpdir()` 与 afterAll 清理 | A5 | 小 |
| P0 | 修复或移除 `test:coverage`（需新增 `@vitest/coverage-v8` devDep，属"确有必要"，需按项目约束说明理由并保持 lockfile 一致） | A2 | 小 |
| P0 | `desktop:build`/`desktop:build:all` 的 Win 路径接入 nsis-patch；`android:build` 跨平台化 | A3/A4 | 小 |
| P1 | 评估开启 tsconfig `strict`（建议先 `strictNullChecks` 渐进过渡，先跑全量诊断量化存量错误再决策） | A1 | 大（分阶段） |
| P1 | 补审批链路后端测试（approval-store + orchestrator：白名单、超时默认拒绝、/plan 只读强制） | A8 | 中 |
| P1 | capacitor `allowNavigation` 收敛白名单 + 评估 legacy bridge 暴露面（需产品侧确认远程壳业务边界） | A6 | 小 |
| P1 | Host 白名单改为放通本机网卡 IP 集合而非任意 hostname | A9 | 小 |
| P2 | ESLint 补 tests/scripts/bin 规则块 | A10 | 小 |
| P2 | 进程树终止收敛到 `utils/process-tree.mjs`（以 qf-agent-process 语义为基准） | B3 | 小 |
| P2 | server-agent.ts 拆分 + 事件类型收敛（消除断言）；这是前端风险最集中点，建议配测试保护 | B7 | 中-大 |
| P2 | 文档"去行数化"一次性改造（30+ 处漂移逐处手工同步成本高且会再次漂移），合并 routes README 重复小节；更新 SECURITY.md 版本表 | F1-F5/E3 | 中 |
| P3 | useSyncExternalStore 迁移（消 revision 模式与 4 处 eslint-disable）；统一 apiFetch；SessionRow 抽取 | B10-B12 | 中 |
| P3 | 巨石模块渐进拆分（agent-manager / workspace.mjs / App.tsx / WorkspaceInspector），随 feature 迭代进行 | B1/B2/B8/B9 | 大（渐进） |
| P3 | 依赖卫生：移除 @emnapi/*、评估 mini-lit 与 monaco 语言包裁剪；android 版本号脚本化注入；`.nvmrc` 写全版本 | D1-D3/G | 小 |
| P3 | 补 restart-supervisor / update-supervisor / network-proxy / mcp config 测试 | C1 | 中 |

> 注：涉及新增依赖（如 coverage provider）的建议需按项目约束评估必要性；涉及 UI 的建议需遵循 DESIGN_LANGUAGE.md；所有建议均未实施，等待用户选择方向。

---

## 六、风险与未知（调研局限性）

- B7-B9 的 re-render 热点为静态分析推断，未运行 profiler 实证
- 开启 strict 的存量错误量未量化（需单独跑全量诊断）
- A6/A7 的处置依赖产品侧对"远程壳业务边界"与"shell 全机权限信任模型"的决策
- 文档行数漂移只抽查了主要文件，未逐一核对全部声明
- 按项目约束未检查 dist/、package-dist/、package-offline/ 生成产物，未运行完整 test/lint/build（工作区有进行中变更）

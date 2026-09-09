## 当前交接：chat-task-launcher 模板插件替换与办公产物 Prompt（done，待父 Agent 审查）

- 目标：只替换模板自动插件，保留手动已有与重选；办公 Prompt 直接请求真实文件产物，周报不强制 DOCX。
- 改动：src/components/chat/{capability-suggestions,task-launcher}.ts、src/lib/i18n.ts、tests/frontend/{capability-suggestions,task-launcher}.test.ts、docs/wiki/src/components/README.md、feature_list.json、progress.md、本文件。并行产物卡内容保留。
- 实现：controller 单个内存 owner key + replaceTemplatePlugin 同步提交，手动重选转用户所有，chip/consume/restore 清来源，完整 key 与四项上限，不改持久化。launcher 冲突或过期零选择变更，restore 前 controller 与 draft 一致；仅 enabled+loaded 插件，未调用 enable API。
- 验证：vitest 8 files / 65 tests passed；修改 TS ESLint 与 tsc -b --pretty false 通过。未 build/改生成产物/新增依赖/commit。
- Blocker：无自动检查阻塞；未浏览器或 Office 文件生成实测。下一步父 Agent 审查并冒烟；真实 runtime/工具/审批边界及不可用提示保持，不将 Prompt 目标误述为新增能力。

---

## 当前交接：chat-task-launcher 显示范围修正（done，待父 Agent 审查）

- 目标：仅主动新建成功后的未落盘空页显示，已有零消息会话/自动初始化不显示；项目切换继承资格，发送/历史切换失效，无紧凑版。
- 本次局部编辑：App、ChatPanelHost、task-launcher.ts、index.css、Wiki、侧栏路由/DOM 测试和三份状态；新增 task-launcher-visibility.ts 及对应测试。所有并行产物/撤销改动保留。
- 已验证：vitest 7 files / 47 tests passed，修改 TS 文件 ESLint、tsc -b 通过；未 build、未改生成产物、未 commit。
- Blocker：无自动检查阻塞；未浏览器实测。下一步父 Agent 审查新建异步 race 与项目自动选择，验证发送失败也不恢复、零消息历史及隐藏无占位。

---

## Feature：chat-task-launcher（done，待父 Agent 审查）

- 用户已批准正式实现；App 显式开启，Side Chat/shared 不受影响。开发/办公各四入口，空态描述卡片/已有对话紧凑，响应式主题 token、中英文及键盘 Tab。
- 点击只填模板，不发送；冲突内联保留/替换，确认重新读正文、附件、引用及无关插件。复用真实 capability controller，仅 enabled + loaded 插件选择，无启用 API；不支持 runtime 仍填模板。
- 初始草稿恢复前禁用；旧恢复取消，异步新操作/取消/发送/会话卸载失效；空态 ResizeObserver 根据真实 dock 高度定位项目选择器。
- 修改清单详见 feature_list.json；Wiki 已更新。保留原型与历史状态记录，未改生成产物、依赖，未提交。
- 验证：vitest 5 files / 38 tests passed；变更文件 ESLint、tsc -b、独立 Vite 生产构建与 git diff --check 通过，临时构建目录已清理。构建仅既有 KaTeX 字体/大 chunk warnings。
- Notes：初次只读命令误用了 PowerShell/系统 rg，当前 shell 无此工具；后续使用 cmd 与 dedicated grep。没有因此修改源码或依赖。
- Blocker/风险：未浏览器实测空态项目选择器、窄屏/矮屏、焦点及真实插件运行；不承诺 Office 导出。父 Agent 应审查初始恢复与 Lit 装饰/布局。
- 下一步：父 Agent 审查及浏览器冒烟；无需发布或提交。

---

## 当前交接摘要：chat-task-launcher-design-preview（needs-review）

- 当前目标：独立聊天开发/办公任务入口 HTML 设计对齐，等待用户确认，不实现正式功能。
- 改动文件：`design-mockups/chat-task-launcher.html`（新增）、`feature_list.json`、`progress.md`、本文件；保留全部既有任务记录。
- 已完成：浅色聊天空态与对话中紧凑预览、两类各四卡、可编辑完整 Prompt、草稿内联保留/替换、可取消演示插件 chip、模拟附件与发送、响应式和键盘 Tab 语义。
- 验证：内联 JS `node --check`、Node VM 模拟 DOM 交互断言、静态唯一 ID/无外部资源与网络调用检查通过。未进行浏览器视觉/交互实测；检查命令兼容性及 SVG 命名空间误报已修正后重跑通过。
- Blocker：待用户确认视觉与交互；无真实 API、插件或 Office 文件生成能力接入。
- 边界：未改正式源码、依赖、产物，未提交；无需更新 Wiki（纯独立设计原型）。
- 下一步：直接打开 HTML，检查空态/对话中、开发/办公切换、草稿保护与窄屏，再根据用户反馈调整原型。未经授权不实现正式功能。

---

## 历史交接摘要：safe-single-file-rollback（done，正式实现完成）

- 当前目标：在既有安全撤销弹窗内完成单文件撤销；安全行新增“撤销此文件”，独立 `POST rollback-file` 传 `{path, revision}`，不触碰冲突文件。`partial` 成功后剩余文件可继续单撤/整批，最后 `completed` 才整体标记完成；整批仍须全部剩余文件安全。
- 改动文件：后端 `server/session-file-backups.mjs`、`server/routes/agent.mjs`；前端 `src/lib/server-agent.ts`、`src/components/chat/file-rollback-state.ts`、`FileRollbackDialog.tsx`、仅弹窗 CSS、i18n；对应 server/frontend 测试及三份状态文件。完整清单见 `feature_list.json`。外部文件卡、`src/App.tsx`、Demo 本轮未改。
- Wiki：五份已同步：`docs/wiki/server/README.md`、`docs/wiki/server/routes/README.md`、`docs/wiki/server/tools/README.md`、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`。
- 验证（父 Agent 已核实）：`npm run test` **300 files / 2999 tests passed**；`npm run lint` **0 errors / 1 个既有 warning**（`server/cloud/identity.mjs:92`，`no-useless-assignment`）；`npm run build -- --outDir .safe-single-undo-build-check` 通过类型检查与生产构建，独立目录已删除，仅既有 KaTeX 字体解析/大 chunk warnings。独立只读审查未发现阻塞。
- 边界：仅既有 QuickForge write/edit 安全回滚范围；文件系统操作非原子事务，失败 intent 保留且不重试，不误报完成。未动 `package-dist/`、`package-offline/`，无新依赖、未提交。
- Blocker：无已知实现阻塞；未浏览器实测，不宣称视觉验证。
- 下一步：浏览器冒烟混合安全单撤且不动冲突文件、连续单撤/剩余整批/最后完成、窄屏。用户授权后已执行 `npm run build`，生产 `dist/` 已刷新为含单文件撤销的最新前端产物（仅既有 KaTeX 字体解析与大 chunk warnings）。

---

## 历史交接摘要：safe-undo-file-rollback（done，正式实现完成）

- 当前目标：用户已确认安全撤销弹窗方案，正式文件回滚已实现；外层 Demo 不带入正式实现。外部文件卡/按钮的 class、布局、文案保持，旧消息回滚浮层未改。
- 实现：专用文件撤销弹窗与结构化前端状态；GET preview、POST revision 的 200/409/500 处理；before/pending/after 连续性、文件锁、Windows 大小写路径别名、预览及执行前全批校验、旧备份拒绝、失败保留。
- 重要文件：后端 `server/session-file-backups.mjs`、新增 `server/session-file-lock.mjs`、`server/tools/index.mjs`、`server/agent-manager.mjs`、`server/routes/agent.mjs`；前端新增 `src/components/chat/FileRollbackDialog.tsx` / `file-rollback-state.ts`，以及 `assistant-artifact-card.ts`、`src/App.tsx`、`src/lib/server-agent.ts`、i18n/CSS；相关 server/frontend 测试与三份状态文件。完整清单见 `feature_list.json`。
- Wiki：五份已同步：`docs/wiki/server/README.md`、`docs/wiki/server/routes/README.md`、`docs/wiki/server/tools/README.md`、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`。
- 验证（父 Agent 已核实）：`npm run test` **300 files / 2930 tests passed**；最终前端文案测试另跑 **4 files / 48 tests passed**。`npm run lint` 0 errors，未修改文件 `server/cloud/identity.mjs:92` 的既有 `no-useless-assignment` warning 未扩大修复。`npm run build -- --outDir .safe-undo-build-check` 通过类型检查与生产构建，独立输出已删除；随后按用户要求执行 `npm run build` 成功，已刷新当时整批撤销版本的 `dist/`（不含后续单文件最新版）；仅 KaTeX 字体解析和大 chunk warnings；未动 `package-dist/`、`package-offline/`。
- 边界：仅 QuickForge write/edit 文件工具（含归属父会话的子工具），不覆盖 shell/OpenCode 原生改动；全批检查不是外部文件系统原子事务，中途失败如实计数并保留备份，不误报完成；旧备份不支持安全回滚。
- Blocker：无已知实现阻塞；未真机浏览器冒烟、无截图，不宣称视觉实测。未 commit，保留其他历史/并行内容。
- 下一步：用户点击原撤销入口确认新窗；检查外部修改混合场景整批禁用、安全恢复/新建文件删除、ESC 关闭及深浅色/窄屏。本 feature 当时版本的生产 `dist` 已按用户后续要求构建；后续单文件撤销由 `safe-single-file-rollback` 承接，最新版已按用户后续授权的 `npm run build` 进入生产 `dist/`。

---

## 历史交接摘要：safe-undo-interaction-demo（done，用户已确认）

- 目标：按用户截图调整安全撤销 HTML Demo：点击直接弹撤销文件改动窗口，安全/不安全文件分组、原因、右上关闭、右下撤销；任一不安全整批不执行，确认前全量复查。取消部分撤销/单文件重试，不接真实接口。
- 改动文件：`design-mockups/safe-undo.html`、`feature_list.json`、`progress.md`、本文件（仅新增记录，保留并行任务内容）。
- 验证：内联脚本语法检查及主 Agent Node VM 断言通过：全冲突/混合/不可用整批零写入，全安全恢复5个删除1个，执行前新增冲突零写入，重复执行保护。尚未浏览器实测。
- 确认与承接：用户已确认弹窗方案，外层 Demo 不带入正式实现；真实安全撤销已由正式 feature `safe-undo-file-rollback` 承接并实现，见顶部摘要。Demo 自身保持独立原型，无需更新 Wiki；正式实现五份 Wiki 已更新。未提交。

---

## 当前交接摘要：sidebar-session-row-hit-area——会话行整行可点修复（2026-09-09）

- 目标：用户发现侧栏会话行边缘点击无响应（同 2026-09-08 项目行 hit-area 问题模式），经调研确认 4 处会话行渲染（置顶/时间线/项目分组/全局）行容器 div 均无 onClick，选中只挂在内层标题按钮上，行上下留白、左右 padding、gap 与 hover 时右侧 overlay 全高区域均为死区。用户确认：整行可点、4 处全修、补回归测试。
- 实现（与 sidebar-project-row-hit-area 同模式但更简，会话行无拖拽故无 suppressRef）：① 4 处行容器 div 统一加 `onClick={() => onLoadSession(session.id)}`；内层标题元素（置顶 div[role=button] + 其余三处 <button>）移除各自 onClick，click 冒泡行级统一处理（aria-busy/role/tabIndex 保留）；置顶行 onKeyDown 保留（原生 div 键盘 Enter/Space 不派发 click，防止破坏键盘可达性）。② `toggleSessionPinFromActions` 补 `event.stopPropagation()`（requestDelete/confirmDelete 原已具备），防点 pin 误触选中。③ deleting 行已有 pointer-events-none 隔离，无需额外守卫。
- 文件：`src/components/sidebar/ChatSidebar.tsx`（+8/-4）、`tests/frontend/session-row-hit-area.test.ts`（新 4 用例，源码字符串契约）、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 vitest 5 files / 47 tests 全过（含 4 个既有 hit-area/对齐/排序测试，断言零修改）；eslint 两改动文件 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 通过（dist 已刷新，仅既有警告）。
- Blocker：无。未 commit。
- 下一步：真机冒烟——点击会话行上下留白/左右边缘即选中；hover 行点 pin/归档不误触选中；置顶行键盘 Enter/Space 可打开；deleting 行不可点。注：工作区可能还含其他并行会话未提交改动，提交前先 `git status` 确认归属。

---

## 当前交接摘要：简化自定义模型的推理/思考模型标签（2026-09-09）

- 目标：去掉自定义模型设置标签中的 DeepSeek V4/Qwen 示例。
- 实现：`src/lib/i18n.ts` 的 `reasoningModel` 中英文分别简化为“推理/思考模型”和“Reasoning / Thinking model”；功能与调用方不变。
- 文件：`src/lib/i18n.ts`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：i18n 快照测试 1 file / 2 tests 全过；`src/lib/i18n.ts` ESLint 通过；旧 UI 长文案无残留；`git diff --check` 通过。
- Blocker：无。已纳入本次本地提交，未 push。
- 边界：独立用户指南说明保留；无需更新 Wiki；未修改生成产物。

---

## 当前交接摘要：v2.0.0 发布准备（2026-09-09，完成）

- 目标：按用户确认以当前 `dev` 全量发布 2.0.0；两个 `needs-review` 功能按现状纳入；不含 Android。
- 远端/基线：已运行 `git fetch --prune --tags origin`；准备阶段分支为 `dev`，`HEAD == origin/dev == 7cd79018e76d84a54b6f852a7347fcb5f567356c`，准备前工作区干净，远端无 `v2.0.0` 标签。
- 已改：`package.json`、`package-lock.json` 版本升至 2.0.0；`CHANGELOG.md` 新增 2.0.0 的 Added/Changed/Fixed/Breaking Changes/Upgrade Notes；`README.md` 当前版本升至 2.0.0；`feature_list.json`、`progress.md`、本文件同步完成状态。
- 发布范围：`pinned-summary-draggable-capsule`、`workspace-inspector-header-alignment` 保持 `needs-review`，但已按用户确认纳入本次发布；Android 明确不纳入。
- 发布硬门禁（全部通过）：`npm run test` 全量 296 files / 2847 tests 全过；`npm run lint` 0 errors；`npm run build` 成功。
- 打包核验：runtime/offline 包已生成并核验——`shawnstack-quickforge-2.0.0.tgz` 版本 2.0.0、无 scripts/devDependencies、ripgrep 位于 optionalDependencies。
- git 收尾：`master` 已快进同步至 `dev`；release commit（`chore(release): v2.0.0`）与 `v2.0.0` tag 已创建并推送至 origin（dev + master + tag）。
- Blocker：无。
- 待办：npm publish 留给用户手动执行（本会话不执行）。
- 边界：未修改 `android/`、`docs/wiki/`、`dist/`、`package-dist/`、`package-offline/`。仅发布元数据变化，无需更新 wiki。

---

## 当前交接摘要：git 读接口（file-diff/branches/log）客户端断开取消传播（2026-09-09）

- 目标：P2 收尾——4 个 git 读接口取消语义统一（此前仅 status 有）。
- 实现：`server/routes/workspace.mjs` 的 isGitRepository/currentGitBranch/listGitBranches/listGitLog/readGitFile 加可选 signal（完整传播，其余调用方不变）；handleGitBranches/handleGitLog/handleGitFileDiff 接 `createRequestAbortState`（AbortError 静默 + finally dispose；file-diff 的 controller 建在 path 校验后，listGitStatus 与 readGitFile 两处传播，fs 读取不中止）。
- 文件：`server/routes/workspace.mjs`、`tests/server/routes/workspace-git.test.mjs`（describe 扩名 workspace git routes abort + it.each 3 新用例）、`docs/wiki/server/routes/README.md`（file-diff 详细/简版、branches、log、路径边界句共 5 处）、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 4 files / 43 tests 全过；eslint 0 error；`node --check`；`npm run test` 全量 296 files / 2847 tests 全过；`git diff --check` 通过。
- Blocker：无。未 commit。**本会话累计 4 个 feature 未提交**（git-status 取消+light / LLM 超时预算 / search 换 rg / git 读接口取消传播），全部验证全绿。
- 下一步：真机冒烟清单——① 分支徽标更快（light）；② 不可达模型点「测试连接」~60s 失败；③ 大仓库文件树过滤搜索明显变快、连续输入旧扫描中止；④ 关页/刷新时服务端日志无 git/rg 白跑。剩余候选：前端 branches/log 超时与卸载 abort、workspace children/file 读超时、MCP 增量重连、storage/quota 缓存、backup 流式导出。

---

## 当前交接摘要：workspace/search 切换 ripgrep 优先（保真 + 兜底 + 超时/取消）（2026-09-09）

- 目标：P2——search（原栈式 DFS 无超时不可取消）底层遍历切 ripgrep，复用超时/取消能力；前端防抖 abort 后服务端不再白跑。
- 实现：① 新建 `server/utils/ripgrep.mjs`（从 tools/index.mjs 逐字抽 rg 解析三函数，tools 改 import）；② `server/routes/workspace.mjs` 新增 `searchWorkspaceWithRipgrep`（`rg --files --hidden --no-ignore --glob '!node_modules/**' --glob '!.git/**'` + Node 侧子串匹配 + 父目录推导目录条目 + 路径归一化 + 60s 超时/504 + 200k 行护栏 + signal 取消；失败返回 null 回退原 DFS），`handleWorkspaceSearch` 接入 req aborted/res close 取消；③ 新增共享 `createRequestAbortState`/`isAbortError`，`handleGitStatus` 内联模式迁移复用。
- 文件：`server/utils/ripgrep.mjs`（新）、`server/tools/index.mjs`、`server/routes/workspace.mjs`、`tests/server/routes/workspace-search-ripgrep.test.mjs`（新 3 用例）、`docs/wiki/server/routes/README.md`（search 条目 + 简版 + 路径边界句）、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 5 files / 88 tests 全过（现有 search 测试 21 用例零改动全绿）；eslint 0 error；`node --check` ×3；tests/server 全量 156 files / 1385 tests 全绿。
- Blocker：无。未 commit。已接受差异：空目录/工作区内 symlink 目录在 rg 路径不可见、超载前 limit 条可能不同。
- 下一步：F2——file-diff/branches/log 三个 git 读接口接入 abort 传播（复用 createRequestAbortState；readGitFile/listGitBranches/listGitLog/isGitRepository/currentGitBranch 加可选 signal；测试 it.each 参数化）；真机冒烟大仓库搜索。

---

## 当前交接摘要：同步等待 LLM 的 4 个路由接口场景化 total 超时预算（2026-09-09）

- 目标：接口超时/慢接口调研的 P1——「HTTP 响应同步等 LLM 跑完」的 4 个接口不再沿用 20min 默认 total 档。
- 实现：`server/ai-provider-options.mjs` 新增 4 个场景化常量（AI_TEST_CONNECTION_TOTAL_TIMEOUT_MS=60s / AI_AGENT_PROFILE_FILL_TOTAL_TIMEOUT_MS=3min / AI_SCHEDULED_TASK_PARSE_TOTAL_TIMEOUT_MS=2min / AI_GIT_COMMIT_MESSAGE_TOTAL_TIMEOUT_MS=2min），`server/routes/models.mjs`、`agent-profiles.mjs`、`scheduled-tasks.mjs`、`workspace.mjs`（generateGitCommitMessage）的 streamSimpleWithAiHttpLogging options 各加一行 `totalTimeoutMs`。不改 wrapper、不动 idle/firstEvent 默认档与透明重试语义。
- 文件：上述 5 个 server 文件 + `tests/server/ai-provider-options.test.mjs`（+4 常量契约）+ 新建 `tests/server/routes/ai-timeout-budgets.test.mjs`（4 用例：HTTP handler 级 mock 断言 options 传参）+ `docs/wiki/server/routes/README.md`（4 条目）、`docs/wiki/server/README.md`（超时治理段 + ai-provider-options 小节）、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 vitest 6 files / 57 tests 全过；eslint 7 文件 0 error；`node --check` ×5；`npm run test` 全量 295 files / 2841 tests 全过（首次 1 例 runtime-diagnostics elapsedMs 计时 flaky，重跑全绿）；`git diff --check` 通过。
- Blocker：无。未 commit（工作区含本 feature 与上一 feature「git status 取消传播 + light」两组未提交改动，均验证全绿）。
- 下一步：真机冒烟——不可达模型点「测试连接」~60s 返回失败。后续候选（P2）= workspace/search 换 ripgrep、其余 git 读接口接入 abort、LLM 调用的客户端断开传播（side-chat 模式可参照）。

---

## 当前交接摘要：git status 取消传播 + ChatPanelHost 分支探测接入 light（2026-09-09）

- 目标：接口超时/慢接口调研的 P0 收尾——ChatPanelHost 分支探测降耗（light）与「前端 abort 后服务端继续白跑 git 子进程」的取消传播。
- 实现：① `ChatPanelHost.tsx` 的 getGitStatus 调用加 `{ light: true }`（只消费 isGitRepository/branch，独立缓存键 projectId::light，与标题栏 full 分离）；② `server/routes/workspace.mjs` 的 git() 封装支持 `options.signal`（已中止不 spawn 直接 AbortError；运行中 abort → killProcessTree + reject AbortError；所有结算路径移除 listener），listGitStatus 透传 signal 至 status/collectNumstat/currentGitHead（后两者加可选 signal 参数），handleGitStatus 仿 side-chat 先例建 AbortController（`req` aborted / `res` 提前 close），AbortError 静默结束、finally 清理监听。
- 文件：`server/routes/workspace.mjs`、`src/components/chat/ChatPanelHost.tsx`、`tests/server/routes/workspace-git.test.mjs`（+路由 abort 用例；mockRes 升级 EventEmitter + spawnControl 透传式 mock）、`tests/server/routes/workspace-git-process.test.mjs`（+3 个 git() abort 用例）、`tests/frontend/git-status-request-lifecycle.test.ts`（断言同步）、`docs/wiki/server/routes/README.md`、`docs/wiki/src/components/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 vitest 5 files / 67 tests 全过；改动文件 eslint 0 error；`node --check`；`npx tsc -b`；`npm run build` 通过（仅既有警告）；`npm run test` 全量 294 files / 2836 tests 全过；`git diff --check` 通过。
- Blocker：无。未 commit。
- 下一步：真机冒烟——分支徽标应更快出现（走 light）；DevTools 断开 status 请求或大仓库 20s 超时后，服务端不应再有后续 git 子进程耗时。后续候选（P1）= 同步 LLM 接口传超时预算、workspace/search 换 ripgrep、其余 git 接口接入 abort。

---

## 当前交接摘要：产物卡「审查」打开卡死修复（2026-09-09）

- 目标：用户报告点击产物卡「审查」后若审查内容已被删除，会一直显示「打开中」并拖住其他请求。
- 根因：服务端 `/api/git/file-diff`（server/routes/workspace.mjs handleGitFileDiff）所有分支有界且必回复（删除文件 404→7157293 友好空态 / tracked 删除 200 删除 diff / git 子进程 2min 硬超时）；挂死在前端——`getGitFileDiff` 是 workspace-api 里唯一无超时的 git 请求，连接池排队/服务端极慢时永不 settle，reader tab 永远 loading「打开中」且占一个同源连接池槽位拖住其他请求；`openDiffTab` 对已存在 diff tab 只激活不重拉，卡死后无法恢复。
- 实现：`workspace-api.ts` getGitFileDiff 加 `GIT_FILE_DIFF_TIMEOUT_MS=10s`（TimeoutError AbortController，成功清 timer；覆盖 openDiffTab 与 toggleReviewDiff 两调用点）；`WorkspaceInspector.tsx` openDiffTab 抽共享 `loadDiffIntoReaderTab`，已存在 diff reader 在途仅激活、终态（diff/error/noChanges）重置 loading 重拉——再次点「审查」可恢复/刷新。
- 文件：`src/components/workspace/workspace-api.ts`、`src/components/workspace/WorkspaceInspector.tsx`、`tests/frontend/workspace-diff-review-recovery.test.ts`（新 6 用例）、`docs/wiki/src/components/README.md`（Review tab 条目）、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 vitest 6 files / 71 tests 全过；误触发全量 `npm run test` 294 files / 2832 tests 全过；eslint 三改动文件 0 error；`npx tsc -b`；`npm run build` 通过（dist 已刷新）；`git diff --check` 通过。
- Blocker：无。未 commit。
- 下一步：真机冒烟——删除/回滚产物文件后点「审查」出空态或删除 diff；断网/挂起 10s 后出超时红错、再点「审查」可恢复；其他请求不被拖住。Notes 待办见 progress.md（首次点「审查」双 review tab；其余 git/workspace 读无超时）。

---

## 当前交接摘要：置顶摘要分支菜单旁挂弹出（2026-09-09）

- 目标：用户反馈置顶摘要（小浮层）里点 git 分支在面板内部再嵌一个小下拉太挤；先按「屏蔽一下」做成只读行，后按最终指令「不要移除 不要在里面打开、从旁边打开」改为旁挂弹层。
- 实现：`GitToolsPinnedSummary.tsx` 桌面分支菜单从「panel 内容流内 `md:absolute md:top-full md:w-full` 下拉」改为 desktop widget 直接子节点旁挂：默认左侧 `right-full mr-1 origin-top-right`，左侧空间不足 340px 翻右侧 `left-full ml-1 origin-top-left`；打开时测量（`rowRect`/`widgetRect` 差定 top、viewport 12px 安全区定 maxHeight，22rem 上限/160px 下限），拖动/收起/suspend/`desktopDraggable` 变化（queueMicrotask）即关闭；移动端保持原 fixed `top-[9.25rem]` 契约（实例加 `!desktopDraggable` 守卫）。`GitBranchMenu.tsx` 新增可选 `style` prop 透传到根节点承接动态定位。`App.tsx` 的 `onCheckout`/`onCreated`/`onOpenGraph` 接线恢复（中间只读版本曾移除）。
- 文件：`src/components/git/GitToolsPinnedSummary.tsx`、`src/components/git/GitBranchMenu.tsx`、`src/App.tsx`、`tests/frontend/git-tools-pinned-summary.test.ts`（新「旁挂弹出」契约用例替换只读用例；恢复 queueMicrotask/9.25rem 断言；commitCallback 锚点 `mobileShell={mobileShell}`）、`docs/wiki/src/components/README.md`（6 处）、`progress.md` Notes、`session-handoff.md`。
- 验证：定向 vitest 2 files / 38 tests 全过；eslint 4 文件 0 error；`npx tsc -b` 通过。未跑全量。
- Blocker：无。未 commit。
- 下一步：真机冒烟——置顶摘要展开后点分支行，菜单从面板左侧弹出并对齐行位置；把面板拖到屏幕左缘再打开应翻到右侧；切换分支/打开图谱/收起摘要后菜单关闭；移动端菜单仍固定在原位置；标题栏分支 chip 与提交弹窗内的菜单回归正常。

---

## 当前交接摘要：对话报错重试一行式轻量错误行（2026-09-09）

- 目标：把对话回合失败的终态错误（pi-web-ui 红块 + icon-only「继续生成」+ hover 重试入口分裂）改为一行式轻量错误行：`⚠ 生成失败 · 译文或原文 [重试] [详情]`，重试中转「⟳ 正在重试…」，连续失败追加琥珀「已重试 n 次仍失败 · 切换模型」。设计稿 `design-mockups/conversation-error-retry.html`（已用户确认并浏览器实操验证）。
- 实现：新模块 `src/components/chat/panel-decoration/turn-error-row.ts`（红块原地改写为轻量行：常显「重试」/「详情」就地展开 mono 原文/升级行；呈现签名幂等，语言切换与新错误自动收起详情）与 `turn-error-state.ts`（per-panel 重试循环状态机：noteRetryClicked 计数、observe 驱动 retrying/escalated，流式恢复或放弃清零）。`message-actions.ts` 移除「继续生成」按钮与终态错误常显操作行，deps 以 `onRetryAfterError(errorMessage, fallbackRetry)` / `onSwitchModel` / `turnErrorTracker` 替代 `onContinueAfterError`；`ChatPanelHost.tsx` 主 effect 内创建 tracker（随 agent 重建重置），重试统一语义：`retryFailedPrompt` stash 命中先原样重发、否则 fallbackRetry 走 `retryFromMessage` 最后用户消息裁剪重生成；`onSwitchModel` → `props.onModelSelect(anchor)`。i18n 中英成对新增 `errorLinePrefix/errorRetryingLabel/errorRetryEscalate/errorSwitchModel/errorDetailsLabel`、移除 `errorContinueAction`（保留 `errorContinueMessage`）；`index.css` 新增 `quickforge-error-line/-retry/-details(-toggle)/-escalate/-switch-model/-retrying`（复用 reconnect enter/spinner、persist-degraded 琥珀 #d97706、reduced-motion 降级）。
- 文件：上述新模块 + `message-actions.ts`、`icons.ts`（errorWarningIcon/errorDetailsChevronIcon）、`panel-decoration.ts`、`ChatPanelHost.tsx`、`src/lib/i18n.ts`、`src/index.css`、`tests/frontend/message-actions.test.ts`（turn error row 用例组重写）、`tests/frontend/turn-error-state.test.ts`（新）、`tests/frontend/error-messages.test.ts`（契约改写）、`docs/wiki/src/components/README.md`、`design-mockups/conversation-error-retry.html`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 vitest 4 files / 62 tests 全过；相关回归 14 files / 186 tests 全过；`npm run test` 全量 292 files / 2799 tests 全过；`npm run lint` 0 error / 5 个 server/ 既有 warnings（改动文件 0 warning）；`tsc -b`；`npm run build` 通过（仅既有 chunk 提示）；dist 抽查含新样式与 zh 文案。
- Blocker：无。未 commit/tag/push。
- 下一步：真机弱网验证——回合失败出错误行（译文+就地重试+详情原文）；重试转「正在重试…」→ 恢复淡出 / 再失败第二次起出琥珀升级行，「切换模型」打开模型选择；发送失败点「重试」原样重发 stash。备选后续：subagent 错误原因卡（`local-tools.ts` 的 quickforge-subagent-error 红卡）对齐同款轻量行词汇。

---

## 当前交接摘要：SSE 流式帧节流 + 背压保护（2026-09-09）

- 目标：处理第一轮调研发现的 SSE 开销（每 token 全量 partial、无背压）。
- 调研结论：帧内 `message` 与 `assistantMessageEvent.partial` 是同一份完整消息（≈2× 累积 JSON，一回合 O(N²)）；前端全量替换 + rAF 批处理，不依赖每个 delta；`writeSseEvent` 从不检查 `res.write` 返回值。
- 实现：`message_update` 50ms trailing 合并（`SSE_MESSAGE_UPDATE_THROTTLE_MS`，非 message_update 事件先 flush 保序，cleanup dispose）；`writeSseEvent` 加 `SSE_BACKPRESSURE_BYTES=4MB` 阈值丢弃可丢弃帧（终态帧永不丢弃）。
- 验证：定向 39 tests（新增 5）全过；eslint 0 error；`npx tsc -b`；`npm run test` 293 files / 2825 tests 全过；`npm run lint` 0 errors / 5 个既有 warnings；`npm run build` 通过。
- Blocker：无。未 commit/tag/push。
- 下一步：真机观察长对话帧量；剩余候选 = ChatPanelHost 接入 light（等并行会话收尾）、settings/custom-providers 批量化、`message_update` 增量 delta（高风险）。

---

## 当前交接摘要：/api/git/status 单次耗时优化（合并 git 子进程 + light 模式）（2026-09-09）

- 目标：继续降低 `/api/git/status` 的 400-670ms 单次耗时（连接池优化后它成为最大单一负担）。
- 根因：4 次串行 git 子进程（`rev-parse` 65ms + `status` 82ms + `numstat` 125ms + `branch` 65ms ≈337ms）。
- 实现：①`status` 加 `--branch`，从 `## ` 头解析 branch/detached，删除独立 branch spawn；②用 status 退出码判仓库，删除 `rev-parse` spawn；③新增 light 模式（跳过 numstat + 行数统计），路由 `light=1` + 前端 `{ light }` + 独立缓存键。
- 实测：full **419.3→256.7ms**（-38.8%，子进程 4→2）；light **106.2ms**（-74.7%）；重启后真机复测 full **276/272/295ms**、light **107/111/109ms**（改前真机 400-670ms）。
- 验证：定向 27 tests 全过；eslint 0 error；`npx tsc -b`；`npm run test` 293 files / 2820 tests 全过；`npm run lint` 0 errors / 5 个既有 warnings；`npm run build` 通过。
- ⚠️ 注意：App 标题栏**未**启用 light——`titleGitStatus` 被 `GitToolsPinnedSummary` / `GitCommitPushDialog` 共享，需要 `additions/deletions`；light 能力已就绪待 ChatPanelHost 分支探测接入（该文件正被另一会话改动，未触碰）。
- Blocker：无。未 commit/tag/push。
- 下一步：刷新页面观察 git status 耗时是否降到 ~250ms；可选后续：ChatPanelHost 接入 light（-150ms/次）、settings/custom-providers 逐 key 请求批量化、服务端 abort 传播（前端 20s 超时后 kill git 子进程）。

---

## 当前交接摘要：会话列表重复请求收敛（refreshSessions 合并 + /api/agents 收敛）（2026-09-09）

- 目标：继续降低浏览器 6 连接池压力。
- 实测：重启后 2.5 分钟内 `lastModified` 23 次、`pinnedAt` 13 次、`/api/agents` 16 次（单请求 1-5ms，但数量占满连接池）。
- 根因与修复：①`agent_end` 双路 `refreshSessions`（`App.tsx:1139` + `useAgentManager.ts:179`）→ `useSessionPagination` 新增 `REFRESH_SESSIONS_MERGE_MS=250` in-flight 合并（窗口内重复调用复用同一 Promise，`broadcast` 需求合并到轮尾只触发一次）；②`useVisibleRuntimeStatuses` 刷新 effect 依赖每次重建的 Set 身份 → 收敛为只依赖 `visibleSessionKey`，用 ref 持有最新回调。
- 验证：定向 45 tests + 新增 1 test（含变异验证）全过；eslint 0 error；`npx tsc -b`；`npm run test` 293 files / 2813 tests 全过；`npm run lint` 0 errors / 5 个既有 warnings；`npm run build` 通过。
- Blocker：无。未 commit/tag/push。
- 下一步：刷新页面后观察请求频率；剩余候选 = `git status` 单次 400-670ms 的服务端耗时优化、settings/custom-providers 逐 key 请求批量化。

---

## 当前交接摘要：浏览器连接池压力缓解（git status 去重 + SSE 合并）（2026-09-09）

- 目标：解决「对话流式输出正常，但其他普通 API 经常卡住」。
- 实测结论：服务端无阻塞（lag p99 33.62ms、89% 请求 <50ms、6 并发压测下 health 45ms）；瓶颈是浏览器 HTTP/1.1 同源 6 连接池——2 条被常驻 SSE 占死，服务端观测普通请求并发峰值 6 → 需 8 条连接 → 必然排队。放大器：页面加载静态 chunk、切回窗口数十个并发请求、`/api/git/status` 3 个互不协调调用点（峰值 3 并发、每个 400-500ms）。
- 修复 A（git status 收敛）：`workspace-api.ts` 的 getGitStatus 模块级 `Map<projectId>` 在途共享 + 引用计数 abort（调用方 abort 不取消其他等待者，最后一个等待者退出才 abort）+ 1s 缓存 + `{ force }` 绕过；`gitPostJson` 在 11 处写操作失效缓存；`App.tsx` 的 `onProjectsChanged` 改为走 15s 缓存。
- 修复 B（省 1 条常驻连接）：`sessions-changed` 并入 `/api/agents/events`——`server/routes/agent.mjs` 的 handleGlobalStream 监听 channelEvents 且只转发该类型（过滤 log/status/qrcode）；`registry.mjs` 加 `setMaxListeners(100)`；`server-agent.ts` 事件名清单加 `sessions-changed` 且 handleSseEvent 提前 return；`App.tsx` 的 channels EventSource 换成 `subscribeToAgentEvents`（保留 ready 门禁与全部既有逻辑）。
- 文件：见 feature_list.json 同 id 条目。
- 验证：定向 vitest 36 + 87 tests 全过；改动文件 eslint 0 error；`npx tsc -b`；`npm run test` 292 files / 2809 tests 全过；`npm run lint` 0 errors / 5 个既有 warnings；`npm run build`；`git diff --check`。
- 真机验证：08:28 通过 `POST /api/system/restart` 重启（新 pid 28120）。重启后 2.5 分钟窗口：`/api/channels/events` 请求 0 次、inFlight 仅 1 条 `/api/agents/events`、`git status` maxOverlap 从最多 3（压测 6-7）降到 1、sockets 7→3。
- Blocker：无。未 commit/tag/push。
- 下一步：真机使用观察。若仍感觉卡，下一候选是首屏数十个 settings/custom-providers 逐个请求批量化。

---

## 当前交接摘要：运行时诊断采集——event loop lag / 在途请求 / 浏览器连接池排队（2026-09-09）

- 目标：用户反馈「对话流式输出正常，但其他普通 API 经常卡住」（CLI/npm start + 浏览器）。本次会话只交付诊断能力，用数据定位主因，不直接改阻塞路径。
- 实现：服务端新增 `server/runtime-diagnostics.mjs`（251 行）——`monitorEventLoopDelay` 每 5s 采样 p50/p99/max/mean、p99≥100ms 打 WARN（30s 节流）；`begin/endHttpRequest` 幂等记录在途请求与耗时，路径折叠动态段后聚合（上限 200 key）；非流式请求≥1000ms 打 `Slow HTTP request` WARN 并进最近 20 条缓冲；SSE/NDJSON 不计慢请求只累计 `streamingSettledCount`。`server/index.mjs` 在 `createServer` 回调加 begin/finish/close 埋点（原 `reqLogger.info` 行逐字未改）、`handleApi` 加 `GET /api/diagnostics`（非本机 403）、启动链末尾 `startRuntimeDiagnostics()`、`shutdownRuntime()` 内 `stopRuntimeDiagnostics()`。前端新增 `src/lib/browser-connection-diagnostics.ts`（631 行）——`PerformanceObserver` 采同源资源计时（排队 = `requestStart - startTime`）、包装 `window.fetch` 统计 in-flight 与常驻长连接（仅 SSE/NDJSON `clone()` 后台读流，已验证 tee 不影响原响应体）、排队≥500ms `console.warn`（同 path 30s 节流）；`main.tsx` 启动采集并挂 `window.__quickforgePerf()`（返回浏览器侧报告并异步打印服务端快照）。
- 开关：`QUICKFORGE_DIAGNOSTICS=0` 关闭服务端采集（默认开启）；`QUICKFORGE_DIAGNOSTICS_INTERVAL_MS` / `_LAG_WARN_MS` / `_SLOW_REQUEST_MS` 调阈值；前端 `VITE_QUICKFORGE_DIAGNOSTICS=0` 关闭。
- 文件：`server/runtime-diagnostics.mjs`、`server/index.mjs`、`src/lib/browser-connection-diagnostics.ts`、`src/main.tsx`、`tests/server/runtime-diagnostics.test.mjs`、`tests/frontend/browser-connection-diagnostics.test.ts`、`docs/wiki/server/README.md`、`docs/wiki/src/lib/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 vitest 4 files / 42 tests + 前端 1 file / 15 tests 全过；改动文件 eslint 0 error 0 warning；`node --check`；`npm run build` 通过（仅既有 KaTeX 字体与 chunk 体积警告）；`npm run test` 292 files / 2799 tests 全过；`npm run lint` 0 errors / 5 个既有 warnings；`git diff --check` 通过；真机冒烟（独立实例 127.0.0.1:5999）：本机 `GET /api/diagnostics` → 200，隧道头 → 403，隧道头 `/api/health` 仍 200。
- Blocker：无。未 commit/tag/push。工作区内另有并行会话 conversation-error-retry 改动（`src/components/chat/*`、`src/lib/i18n.ts` 等），本 feature 未触碰。
- 下一步：真机冒烟——打开应用后在 DevTools 执行 `window.__quickforgePerf()`：①「最大排队大 / 耗时接近」且 `activeLongLived` 接近 6 → 浏览器连接池耗尽；②服务端 `eventLoop.p99Ms` 高且所有请求耗时同步变长 → 事件循环阻塞；③个别 path `totalMs` 突出而 lag 正常 → 单 handler 慢。据此决定后续优化 feature（SSE 背压 / 连接池治理 / 同步 SQLite 下放）。

---

## 当前交接摘要：diff 无工作区变更时友好空态 + 产物卡 ±0 统计隐藏（2026-09-08）

- 目标：文件被 commit/revert/撤销后，点产物卡「审查」不再显示红色英文 "File has no working tree changes"，改为友好空态 + 降级入口；产物卡净变化 0 时不再显示 `+0 -0`。
- 根因：产物卡「N 个文件已更改」是会话累计（工具调用）口径，diff 是 Git 工作区实时口径；`/api/git/file-diff` 对无变更文件返回 404（服务端固定 message），前端 `openDiffTab`/`toggleReviewDiff` 原样把 `err.message` 显示为红色错误。
- 实现：`workspace-api.ts` fetchJson/postJson 抛错附加 HTTP `status`（`WorkspaceApiError`）；`WorkspaceInspector.tsx` 新增 `isNoWorkingTreeChangesError`，`openDiffTab` 404 → readerTab `noChanges` 空态（i18n `workspaceFileNoWorkingTreeChanges` + `workspaceOpenCurrentFile` 按钮经 `openFileTab` 降级打开 file reader）；`toggleReviewDiff` 内联路径经 `expandedDiffNoChanges` → `WorkspaceChangesList(expandedNoChanges)` → `WorkspaceInlineDiffPreview(noChanges)` 渲染纯文案空态；`ReaderTab` +`noChanges`；`assistant-artifact-card.ts` 头部统计条件 `hasDiff && (total.added > 0 || total.removed > 0)` 净 0 隐藏。
- 文件：`src/components/workspace/workspace-api.ts`、`workspace-inspector-tabs.ts`、`WorkspaceInspector.tsx`、`WorkspaceChangesList.tsx`、`WorkspaceInlineDiffPreview.tsx`、`src/components/chat/panel-decoration/assistant-artifact-card.ts`、`src/lib/i18n.ts`、`tests/frontend/assistant-artifact-card.test.ts`、`tests/frontend/workspace-diff-no-changes.test.ts`（新）、`docs/wiki/src/components/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 vitest 4 files / 45 tests 全过；eslint 改动文件 0 error；`npx tsc -b --pretty false` 通过；`git diff --check` 通过。
- Blocker：无。未 commit/push。
- 下一步：真机冒烟——让 Agent 改文件后 commit，再点产物卡「审查」：diff tab 应显示灰色「该文件当前没有工作区变更，可能已提交或还原。」+「查看文件当前内容」按钮（点击打开文件预览）；Changes 列表内联展开同文案无红字；净变化 0 的卡片标题不再显示 `+0 -0`；真实错误（如路径不存在）仍显示红色错误。

---

## 当前交接摘要：聊天消息队列流式发送时无变化重渲染闪烁修复（2026-09-08）

- 目标：流式生成期间队列可见状态未变化时，不再因队列 DOM 被全量替换而闪烁。
- 根因：decorate 流程随每个 agent delta 高频调用队列 `render()`，旧实现无条件执行 `root.replaceChildren()`。
- 实现：`message-queue.ts` 新增 `renderedSignature`，覆盖队列项、暂停态、流式态、steer 能力、跳转态和编辑态；root 已连接且签名相同时跳过重建，状态变化、首次创建或 root 脱离后仍完整渲染。签名在 DOM 重建完成后提交；拖拽发生位移后主动失效签名，确保取消拖拽时恢复权威顺序。
- 文件：`src/components/chat/panel-decoration/message-queue.ts`、`tests/frontend/message-queue.test.ts`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：`npx vitest run tests/frontend/message-queue.test.ts`（1 file / 15 tests）通过；相关 ESLint 0 error；`npm run build` 通过（仅既有警告）；`git diff --check` 通过。
- Blocker：无。无需更新 wiki；已提交（当前提交），未 push。
- 下一步：真机冒烟——流式生成过程中观察已有队列行保持稳定、无闪烁；聚焦队列编辑框时输入值/光标不被无变化 delta 重置；新增、删除、立即发送、暂停/恢复以及流式结束时队列仍能立即更新。

---

## 当前交接摘要：手动停止的助手消息显示灰色「已停止」（2026-09-08）

- 目标：手动终止生成后，部分回答末尾显示灰色「已停止」，且用户自己中止的回合不再出现「错误：请求已中止。」红块与重试按钮。
- 对齐：两轮设计稿（design-mockups/assistant-stopped-message-preview.html）——v1 假气泡三方案被否，v2 镜像真实 DOM 后用户确认方案①（灰色、与正文同号、与正文左缘对齐、常显不依赖 hover）执行。
- 实现：`message-actions.ts` 新增 `decorateAssistantStoppedText`（decorateAssistantErrorText 同款先例）：`stopReason==='aborted'` 的 assistant 消息，发现路径限定渲染根 div 直接子级 `span.text-sm.text-destructive.italic`（不误伤 tool 卡内同款标签），移除红/斜体类挂 `quickforge-message-stopped-label`，dataset 记录文案幂等、语言切换即时更新；i18n +`messageStoppedLabel`（zh 已停止 / en Stopped）；`index.css` +`.quickforge-message-stopped-label`（block、6px 上间距、0 1rem 缩进、muted 色）。pi-web-ui 零改动。
- Revision（用户中止去失败痕迹）：服务端 `agent-manager.mjs` agent_end 对 `signal.aborted` 的运行跳过 `appendAssistantErrorMessageOnce`（此前会在 aborted 终态消息后再合成 `stopReason:'error'` 的「错误：请求已中止。」红块）并清 `state.errorMessage`；非用户中止失败（超时/HTTP 等）仍照常合成。前端 `message-actions.ts` 新增 `trailingTurnAborted` 门控（尾部 assistant `stopReason='aborted'`）：用户中止回合最后一条 user 消息隐藏重试按钮（回滚/复制/错误终态「继续生成」不受影响，重装饰随回合状态恢复）。
- 文件：`src/components/chat/panel-decoration/message-actions.ts`、`src/lib/i18n.ts`、`src/index.css`、`server/agent-manager.mjs`、`tests/frontend/message-actions.test.ts`（+4 用例）、`tests/server/agent-manager.abort.test.mjs`（+2 用例）、`design-mockups/assistant-stopped-message-preview.html`、`docs/wiki/src/components/README.md`、`docs/wiki/server/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 vitest abort 3 + message-actions 34 + error-messages 14 + i18n-snapshot 2 + routes/agent 21 全过；eslint 改动文件 0 error；`node --check`、`npx tsc -b --pretty false`、`npm run build` 通过（仅既有警告）；产物 CSS 已含新类；`git diff --check` 通过。
- Blocker：无。已提交（当前提交），未 push。
- 下一步：真机冒烟——对话中途点停止：末尾只有灰色「已停止」，无「错误：请求已中止。」红块、无重试/继续按钮（亮/暗主题各一次）；hover 最后一条 user 消息仍有回滚、无重试；真实失败（如断网/超时）仍有红块错误与「继续生成」；发新消息后重试按钮恢复；切语言后历史停止消息文案跟随。注意：历史会话里已持久化的「错误：请求已中止。」是存量数据，不做迁移。

---

## 当前交接摘要：桌面侧栏默认宽度略微收窄（2026-09-08）

- 目标：将左侧项目/对话区域从默认 320px 略微收窄到 304px。
- 实现：`ChatSidebar.tsx` 的 `sidebarDefaultWidth` 与 `sidebarMinWidth` 均改为 304；`sidebarMaxWidth=520`、拖拽、收缩态 `w-14`、移动端 `w-full` 不变；Wiki 已同步说明。
- 文件：`src/components/sidebar/ChatSidebar.tsx`、`docs/wiki/src/components/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 vitest 2 files / 9 tests 全过（workspace-inspector-width-range、mobile-fullscreen-adaptation）；ChatSidebar ESLint 通过；`npm exec tsc -- --noEmit` 通过；`git diff --check` 通过。
- Blocker：无。未 commit/tag/push。

---

## 当前交接摘要：右侧 Inspector 拖动保留对话区最小宽度（2026-09-08）

- 目标：右侧 Inspector 向左拖动时，中间对话区至少保留 440px，避免被无限压缩。
- 实现：`ChatSidebar` 桌面根 aside 用 `ResizeObserver` 回报实际宽度；`App.tsx` 保存侧栏宽度并传 `conversationMinWidth={440}` / `leftSidebarWidth`；`WorkspaceInspector.tsx` 将 1200px、75vw、`viewport - sidebar - 440px - 1px` 纳入统一动态上限，覆盖初始化恢复、拖动、window resize、侧栏变化、640px 自动展开、`maxWidth`、`aria-valuemax`。
- 文件：`src/App.tsx`、`src/components/sidebar/ChatSidebar.tsx`、`src/components/workspace/WorkspaceInspector.tsx`、`tests/frontend/workspace-inspector-width-range.test.ts`、`docs/wiki/src/components/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 vitest 2 files / 9 tests 全过；相关 ESLint 0 error；`npm exec tsc -- --noEmit` 通过；`git diff --check` 通过。
- 边界：窄视口无法同时满足侧栏、对话区 440px、Inspector 340px 时保留 Inspector 最小宽度；移动 fullscreen/overlay 与 Inspector 内部导航拖动不变。未 commit/tag/push。
- 下一步：建议在桌面宽窗口实际拖动 Inspector 左边缘确认对话区停在约 440px；再确认侧栏展开/收起或拖宽时 Inspector 上限同步收紧。

---

## 当前交接摘要：字号滑块松手后统一应用并保存（2026-09-08）

- 目标：界面字号、消息字号拖动时不再全局实时缩放，松手后才保存并应用。
- 实现：两个滑块共用语义——input 只 normalize、更新 Lit 本地字号状态并 `requestUpdate`，badge/progress 即时变化；change 继续走 `saveFontSize`，当下先 apply，再由 `saveFontSizeSettings` 持久化，避免网络延迟阻塞松手后的视觉反馈；持久化成功后的重复 apply 会被 dirty-check 跳过。已删除无调用方的 `scheduleFontSizePreview` 与对应测试。
- 验证：`npx vitest run tests/frontend/appearance-settings-tab.test.ts tests/frontend/font-size-settings-apply.test.ts tests/frontend/settings-normalizers.test.ts` → 3 files / 13 tests 全过；相关 `npx eslint` 0 error；`npm run build` 通过（仅既有警告）；`git diff --check` 通过。首次单独 tsc 曾碰到并行 App.tsx 中间态，后续 build 内 tsc 已通过。
- 文件：`src/lib/appearance-settings-tab.ts`、`src/lib/font-size-settings.ts`、`tests/frontend/appearance-settings-tab.test.ts`、`tests/frontend/font-size-settings-apply.test.ts`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Blocker：无。无需更新 wiki；未 commit/tag/push。建议真机拖动两个滑块确认页面其余区域拖动中不缩放、松手后一次变化。

---

## 当前交接摘要：Inspector Tab 下拉列表 hover / 选中态背景修复（2026-09-08）

- 目标：让右侧 Inspector 的 ChevronDown Tab 下拉列表在 hover 非选中项时显示背景，同时让当前选中项保持更明确的 active 背景。
- 实现：`WorkspaceInspector.tsx` 的列表项条件样式从未生成的 `bg-muted/55` / `hover:bg-muted/34` 改为既有 `--quickforge-sidebar-active-bg` / `--quickforge-sidebar-hover-bg`；`workspace-inspector-tab-list-scroll.test.ts` 增加防回归契约。
- 验证：定向 vitest 1 file / 2 tests 全过；相关 ESLint 0 error；`npx tsc -b --pretty false`、`npm run build`、`git diff --check` 均通过。构建只有既有 KaTeX 字体与 chunk 体积提示。
- 文件：`src/components/workspace/WorkspaceInspector.tsx`、`tests/frontend/workspace-inspector-tab-list-scroll.test.ts`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Blocker：无。无需更新 wiki；已提交（当前提交），未 push。下一步真机检查亮/暗主题下非选中项 hover、选中项背景，以及关闭按钮 hover/点击是否保持正常。

---

## 当前交接摘要：侧栏任务分组新建对话按钮默认隐藏（2026-09-08）

- 目标：任务分组右侧的新建对话按钮默认隐藏，在标题行 hover 或 focus-within 时显示。
- 实现：`ChatSidebar.tsx` 的任务分组新建按钮改用既有 `sectionActionButtonClass`；点击、阻止冒泡、aria-label 与图标均未改变。`sidebar-section-header-hit-area.test.ts` 增加类复用及 hover/focus-within 契约。
- 验证：定向 vitest 2 files / 29 tests 全过；eslint 改动源码/测试 0 error；`npx tsc -b --pretty false` 与 `npm run build` 通过（仅既有构建警告）。
- 文件：`src/components/sidebar/ChatSidebar.tsx`、`tests/frontend/sidebar-section-header-hit-area.test.ts`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Blocker：无。无需更新 wiki（纯组件内样式复用）；未 commit/push。建议真机检查鼠标 hover、键盘 focus-within 与点击新建对话。

---

## 当前交接摘要：Inspector 顶栏回归 56px 对齐 + 顶部按钮组高度与 hover 统一（2026-09-08）

- 目标：修复 Revision 17 引入的两个回归——① Inspector 顶栏底部横线与对话区 header 底部横线不齐（44px vs 56px）；② `+`/全屏按钮与右上角浮动工具栏的终端/关闭右侧边栏按钮高度不一致。并修复用户反馈的「最左侧 ChevronDown 下拉按钮 hover 无背景」。
- 方案（用户确认「统一回 56px」）：Inspector 顶栏 `h-11`→`h-14`，与 `src/App.tsx:2152` 对话区 header 及浮动工具栏同高（13px 根字号下均 45.5px，两条底线对齐）；`+`/全屏/终端/关闭四个 `Button` 去掉 `size-8` 覆盖，回到 `size="icon"`（29.25px）与浮动工具栏按钮同尺寸；左侧下拉按钮 `size-8`→`size-9`（保留 `rounded-xl`）；两处下拉菜单 `top-10`→`top-12`（按钮变高后恢复原有间距）。Tab 条保留 Revision 17 的紧凑 `h-8` + 隐藏滚动条。
- hover 结论：`hover:bg-[var(--quickforge-sidebar-hover-bg)]` 已存在于产物 CSS 且实测生效（headless Chrome + CDP，四个按钮 hover 均得 `rgb(229,231,235)`）；用户看到的「没有 hover」应为改动前旧产物或页面未强刷。顺带把 `App.tsx` 右上角浮动工具栏的终端/关闭右侧边栏按钮从**未生成**的 `hover:bg-muted/45` 换成同一 token（此前这两个按钮完全没有 hover 反馈），对应两处硬编码类名断言同步更新。
- 验证：headless Chrome 实测两条 header 底线均 45.5px、六个按钮均 29.25px、四个按钮 hover 背景均生效；`npm run test` 287 files / 2742 tests 全过；`npm run lint` 0 error（5 个既有 warning）；`npm run build` 通过。
- 文件：`src/components/workspace/WorkspaceInspector.tsx`、`src/App.tsx`、`tests/frontend/mobile-fullscreen-adaptation.test.ts`、`tests/frontend/side-chat-workspace-tab.test.ts`、`docs/wiki/src/components/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。未 commit、未 push。
- Blocker：无。下一步：真机强刷（Ctrl+Shift+R）后确认——两条顶栏横线齐平、`+`/全屏与终端/关闭四个按钮等高、最左侧 ChevronDown hover 有浅灰背景（亮/暗各看一次）、两处下拉菜单定位正常、多 Tab 溢出不上下跳且拖拽排序/滚轮横向滚动仍可用。

---

## 历史记录：WorkspaceInspector 顶部 Tab 条收窄 + 滚动条高度跳动修复（Revision 17，已被 Revision 18 回归修正）

- 目标：右侧 Inspector 顶部 Tab 条在溢出出滚动条时不再上下跳动，并整体收窄。
- 改动：顶栏 56→44px、Tab 40→32px + `rounded-xl`；横向滚动容器固定 32px，并用 `src/index.css` 的 unlayered 类 `.quickforge-inspector-tab-strip` 隐藏原生滚动条（Tailwind arbitrary 类会被 pi-web-ui 的 unlayered `*{scrollbar-width:thin}` 压过）；左侧下拉按钮与右侧图标按钮统一 32px；两处下拉菜单 `top-12`→`top-10`。顶部工具栏 hover 背景从失效的 `hover:bg-muted/45`（该类未生成）改为 `hover:bg-[var(--quickforge-sidebar-hover-bg)]`。
- 回归与修正：顶栏 44px 导致与对话区 header 56px 底线不齐、按钮 32px 与浮动工具栏 36px 不等高——Revision 18 已把顶栏恢复 `h-14`、按钮恢复 `size-9`、下拉菜单恢复 `top-12`，Tab 条紧凑 `h-8` 与隐藏滚动条保留。
- 验证：定向 vitest `workspace-inspector` 6 files / 46 tests、eslint 改动文件 0 error、`npm run build` 通过；产物 CSS 已确认 `.quickforge-inspector-tab-strip{scrollbar-width:none}` 为 unlayered 且在全局 thin 规则之后，hover 背景类已生成。

---

## 当前交接摘要：侧栏置顶分区独占展示 + 产物卡文件图标与打开方式（2026-09-08）

- 目标：完成两项 feature 的本地提交收尾并交接真机验证。
- 提交：`70a587a feat: 置顶会话改为分区独占展示并收紧悬停操作`；`b39c120 feat: 完善产物卡文件图标与打开方式`；`7a0ecae fix: 侧栏运行状态指示器贴齐时间槽`。均未 push。
- 完整门禁全绿：`npm run test` 287 files / 2742 tests 全过；`npm run lint` 0 errors、5 个既有 warnings；`npm run build` 成功（仅既有 KaTeX 字体与大 chunk warnings）；`git diff --check` 通过。后续 spinner 补丁定向 vitest 1 file / 9 tests、相关 ESLint 与 diff-check 通过。
- Blocker：无。下一步：真机冒烟侧栏置顶/hover 交互与产物卡图标、分裂按钮及资源管理器/VS Code/IDEA 打开方式。

---

## 当前状态：sidebar-pin-hover-alignment Revision 4——hover 浮层紧凑贴尾（已完成，已提交 70a587a，未 push）

- 需求：用户反馈 hover 置顶/归档按钮太靠前、分太开。
- 修复：静置 pin 已删后 44px Archive 胶囊失去对齐意义，`overlayArchiveButtonClass` 改回 `size-6` 与 Pin 同槽——图标间距 24→14px、Archive 图标中心右移 10px、渐变收窄 20px，右锚仍 8px。4 处浮层共用一处生效，测试同步。
- 验证：定向 vitest 2 files / 31 tests、eslint 0 error、`npx tsc -b`、`npm run build` 全过（dist 已重建）。
- 下一步：真机冒烟——hover 时 [置顶/PinOff][归档] 两按钮紧凑靠右，观感确认；其余冒烟项见 Revision 3 条目。已提交 `70a587a`，未 push。

---

## 当前状态：assistant-reply-artifact-card Revision 16——打开下拉扩展 VS Code/IDEA 目标（已完成，Rev12-16 已提交 b39c120，未 push）

- 背景：用户要求打开下拉提供 IDEA/资源管理器/VSCode 选项且带 icon。
- 实现：下拉菜单四项带图标——预览打开（eye 描边 SVG）+ 资源管理器定位 + 在 VS Code 中打开 + 在 IntelliJ IDEA 中打开（品牌图标复用 ProjectOpenMenu 同款资源）；`onRevealFile` 签名扩为 `(relativePath, target?)`（artifact-card/ChatPanelHost 类型同步），App 按 target 转发 `openWorkspaceExternal`、失败 toast 按目标区分（既有 i18n key 零新增）；菜单项 flex 图标槽布局。服务端零改动。
- 验证：定向 vitest assistant-artifact-card 18 + message-actions 30（新增外部打开契约）；eslint 四改动文件 0 error；`npx tsc -b`、`npm run build` 通过（dist 已重建）；wiki 菜单描述同步。
- 文件：`assistant-artifact-card.ts`、`ChatPanelHost.tsx`、`App.tsx`、`src/index.css`、`tests/frontend/assistant-artifact-card.test.ts`、docs/wiki/src/components/README.md、feature_list/progress/session-handoff。
- 下一步：真机冒烟——下拉四项图标/文案（资源管理器/VS Code/IDEA）、VS Code 与 IDEA 可打开文件（本机装了对应 CLI 时）、失败 toast 按目标区分、readOnly/全局会话菜单仅预览项。已提交 `b39c120`，未 push。

---

## 当前状态：sidebar-pin-hover-alignment Revision 3——置顶分区独占展示（已完成，已提交 70a587a，未 push）

- 需求（用户决策）：置顶会话只在置顶分区展示（项目/时间线/全部会话列表全部隐藏）；hover 浮层保留归档按钮；置顶区取消置顶用 PinOff。
- 实现：服务端 `pinned=exclude` 三态查询（storage.mjs + session-index-repository，与 archived 对称，保分页口径）；前端三个列表加载带 exclude、`upsertSessionMetadata` 置顶只进 pinnedPage；ChatSidebar 删全部静置 pin 按钮/占位 span（时间槽成最右元素），置顶区浮层 PinOff、三列表浮层恒 pinSession；搜索结果不动。
- 验证：定向 5 files / 58 tests、eslint 0 error、tsc、node --check、`npm run build`（dist 已重建）全过；全量 test 286/287 files（2740/2742 tests）——仅剩 `sidebar-new-chat-routing.test.ts` 2 用例失败，属并行会话 hit-area 重构致契约过时（progress Notes 已记），非本 feature。
- 下一步：真机冒烟——① 置顶会话不再出现在项目分组/时间线/全部会话，仅置顶分区显示；② 项目列表行 hover 显示 [置顶 Pin][归档]（静置无 pin 图标，时间贴右）；③ 置顶分区行 hover 显示 [PinOff][归档]，点 PinOff 取消置顶后会话回到原列表；④ 置顶/取消置顶后各列表刷新正确、分页"显示更多"正常；⑤ running/未读行状态右对齐时间列。已提交 `70a587a`，未 push。

---

## 当前状态：assistant-reply-artifact-card Revision 15——打开/审查按钮感升级描边档（已完成，已提交 b39c120，未 push）

- 背景：用户觉得按钮感不够强，三档选型（软填充/描边/主色淡底）确认**描边 outline 档**；审查同步、撤销保持 ghost。
- 实现：`src/index.css`——open/review 常显 1px var(--border) 边框 + var(--background) 底 + 前景文字（hover 仍 muted 45% 浮底、active/focus 不变）；分裂接缝改描边实现（主区 border-right:0、箭头区 border-left 即分隔线；single 退化整圆角完整描边）；撤销零改动。
- 验证：定向 vitest assistant-artifact-card 17 tests（split 契约更新 + 新增 outline 分层契约）；`npx tsc -b`、`npm run build` 通过（dist 已重建）；wiki 按钮档位描述同步。
- 文件：`src/index.css`、`tests/frontend/assistant-artifact-card.test.ts`、docs/wiki/src/components/README.md、feature_list/progress/session-handoff。
- 下一步：真机冒烟——打开/审查常显边框+底色的按钮感（light/dark）、hover/按压、分裂接缝分隔线视觉连续、撤销仍 ghost hover 红、行内 compact 与单文件卡观感。已提交 `b39c120`，未 push。

---

## 当前状态：assistant-reply-artifact-card Revision 14——「打开」改分裂按钮（已完成，已提交 b39c120，未 push）

- 背景：用户确认设计后执行——「打开｜▾」分裂按钮：主区点击直接预览，箭头区弹菜单（预览打开/在文件管理器中显示，选择即执行）；行内 compact 同样分裂；无预览能力时退化整颗弹菜单。
- 实现：`createOpenMenuControl` 重构（主区 `-open-main` 直连 onOpenFilePreview + 箭头区 `-open-menu-zone` 弹菜单，`-open-single` 退化标记）；CSS 胶囊分裂（左/右圆角 + 细分隔线 + 各自 hover，compact 收窄，single 恢复整圆角）；i18n +`assistantArtifactOpenMenu`；菜单 fixed 定位/互斥/即关机制不变。
- 验证：定向 vitest assistant-artifact-card 16 + message-actions 30 + i18n-language-snapshot 2；eslint 三改动文件 0 error；`npx tsc -b`、`npm run build` 通过（dist 已重建）；wiki 打开控件描述同步。
- 文件：`assistant-artifact-card.ts`、`src/index.css`、`src/lib/i18n.ts`、`tests/frontend/assistant-artifact-card.test.ts`、docs/wiki/src/components/README.md、feature_list/progress/session-handoff。
- 下一步：真机冒烟——单文件卡与折叠卡行内「打开」主区点击直接出预览、箭头弹菜单选择即执行、分隔线/hover 两区独立、全局会话（无预览）退化整颗菜单、Escape/滚动关菜单。已提交 `b39c120`，未 push。

---

## 当前状态：assistant-reply-artifact-card Revision 13——产物图标对齐文件管理 Material 图标（已完成，已提交 b39c120，未 push）

- 背景：用户希望产物卡片文件图标用「文件管理」同款。原为按 kind 的单色 SVG + primary chip 底；文件管理用 Material Icon Theme 彩色图标按路径解析。
- 实现：新 `src/components/workspace/file-icon-assets.ts`（fileIconUrls/directoryIconUrls + `fileIconUrl(path)`，自 file-icon.tsx 拆出，避免 tsx 混出非组件导出触发 react-refresh 规则）；`assistant-artifact-card.ts` 删旧 kind 图标体系，`createFileIcon` 以 img + `fileIconUrl(artifact.path)` 渲染两处图标槽；CSS 改裸 img（单文件卡 1.25rem、行内 1rem），删 chip 底/svg 描边规则。文件树/变更列表渲染零改动。
- 验证：定向 vitest assistant-artifact-card 15 + message-actions 30；eslint 四改动文件 0 error；`npx tsc -b`、`npm run build` 通过（dist 已重建）；wiki components README 两处措辞同步。
- 文件：`file-icon-assets.ts`（新）、`file-icon.tsx`、`assistant-artifact-card.ts`、`src/index.css`、`tests/frontend/assistant-artifact-card.test.ts`、docs/wiki/src/components/README.md、feature_list/progress/session-handoff。
- 下一步：真机冒烟——present 单文件卡与折叠卡行内显示彩色 Material 图标（与文件树同款：md/ts/tsx/json/pdf/docx 等各得其所，package.json 等特例名也对）、light/dark 观感、卡片布局无错位。已提交 `b39c120`，未 push。

---

## 当前状态：assistant-reply-artifact-card Revision 12——审查关闭 ambiguous unicode 提示（已完成，已提交 b39c120，未 push）

- 背景：用户反馈审查页面每次弹 “This document contains many ambiguous unicode characters / Disable Ambiguous Highlight”——Monaco unicodeHighlight 对中文/全角内容默认检测。
- 实现：`MonacoDiffViewer.tsx` options 增加 `unicodeHighlight: { ambiguousCharacters: false }`（IDiffEditorOptions extends IEditorOptions，作用于两栏）；monaco-local.test.ts 新增契约。
- 验证：定向 vitest monaco-local 8 tests；eslint 0 error；`npx tsc -b`、`npm run build` 通过（dist 已重建）。
- 文件：`src/components/workspace/MonacoDiffViewer.tsx`、`tests/frontend/monaco-local.test.ts`、feature_list/progress/session-handoff。
- 下一步：真机冒烟——审查含中文/全角的 diff 不再弹提示；文件预览（MonacoCodeViewer）如也弹可同款处理。已提交 `b39c120`，未 push。

---

## 当前状态：assistant-reply-artifact-card Revision 11——审查 diff 单列行号（已完成，未提交；Rev10 收起右侧文件列表同批未提交）

- 背景：用户反馈审查视图「序号有 2 列，只需要 1 列」——MonacoDiffViewer `renderSideBySide: true` 左右两栏各带一列行号。
- 实现：`MonacoDiffViewer.tsx` 挂 `onMount`（DiffOnMount），`editor.getOriginalEditor().updateOptions({ lineNumbers: 'off' })` 隐藏左栏（原文件）行号，仅保留右栏（新文件）一列；左右两栏 diff 布局与高亮不变；`key={status:path}` 重挂载时 onMount 重新生效。
- 验证：定向 vitest monaco-local 7 tests（含新增单列行号契约）；eslint 两改动文件 0 error；`npx tsc -b --pretty false` 通过；`git diff --check` 干净。
- 文件：`src/components/workspace/MonacoDiffViewer.tsx`、`tests/frontend/monaco-local.test.ts`、feature_list/progress/session-handoff。
- 下一步：真机冒烟——审查 diff 仅右栏一行号列、左栏无序号、两栏高亮正常；换文件重开仍单列。未 commit。

---

## 当前状态：assistant-reply-artifact-card Revision 10——审查视图纯 diff（已完成，未提交）

- 背景：用户反馈产物卡片更改区域点「审查」打开后只想要 diff，右边不要有别的——WorkspaceInspector diff tab 右侧默认挂着「更改文件列表」导航面板（readerNavigationVisible 默认 true）。
- 实现：`WorkspaceInspector.tsx` 请求处理 effect——带 `path` 的 review 请求（仅产物卡「审查」，App.tsx `reviewFileChangesFromArtifactCard`）直达 diff tab 时同步 `setReaderNavigationVisible(false)` 收起右侧文件列表；reader 头部文件夹按钮可随时切回；无 `path` 的 review 请求与其他面板不受影响；状态沿既有 per project+session 持久化。
- 验证：定向 vitest 4 files / 47 tests（新增 workspace-inspector-on-demand-source 契约 + assistant-artifact-card 断言同步）；eslint 三改动文件 0 error；`npx tsc -b --pretty false` 通过。
- 文件：`src/components/workspace/WorkspaceInspector.tsx`、`tests/frontend/workspace-inspector-on-demand-source.test.ts`（新契约）、`tests/frontend/assistant-artifact-card.test.ts`（断言同步）、feature_list/progress/session-handoff。
- 事故与修复：中途用 node 正则替换 feature_list.json 把 artifact-card 条目嵌套成 `{id:{原条目}}`，已用解析方式修复并复核 diff（现仅剩并行 sidebar 会话既有改动 + 本轮 Revision 10 增量）。
- 下一步：真机冒烟——产物卡「审查」打开后仅显示 diff（无右侧文件列表）、点 reader 头部文件夹按钮可恢复列表、顶部入口打开 Review 面板行为不变。未 commit。

---

## 当前状态：sidebar-project-row-hit-area Revision——项目行 + 三个分区头整行可点（已完成，未提交）

- 目标：修复侧栏可点死区。上轮项目行整行可点已修；本轮 Revision 按用户复查反馈补齐置顶/项目/任务三个分区头（标题按钮外整行点击无反应）。
- 实现（分区头，与项目行同款模式）：新增 `suppressSectionHeaderClickRef`（与项目行 ref 相邻）；三个 header div（`className={sectionHeaderClass}`）各挂 `onPointerDown` 清位（listeners 在内层标题按钮上冒泡触发，无需转发）+ 带守卫 `onClick`（`onTogglePinnedCollapsed()` / `toggleProjectsCollapsed()` / `toggleConversationsCollapsed()`）；三个标题按钮移除各自 onClick（activator ref/{...listeners}/{...attributes}/aria-expanded 保留，键盘 Enter 冒泡生效）；`handleSectionDragStart` 与 `finishSectionDrag`（dragEnd/dragCancel 共用）置抑制 ref；右侧 4 个 action Button（openViewSortMenu / toggleAllProjectsExpanded / onSelectProjectDirectory / onStartNewGlobalChat）onClick 包 `event.stopPropagation()` 原调用保留。
- 验证：定向 vitest 5 files / 50 tests 全过（新增 sidebar-section-header-hit-area 6 + project-row-hit-area 5 + project-drag-boundary 10 + sidebar-section-order 22 + sidebar-session-action-alignment 7）；sidebar-section-order.test.ts 一处用例锚点同步（旧锚绑定标题按钮自带 onClick，断言语义不变）；eslint 三改动文件 0 error；`npx tsc -b --pretty false` 通过。
- 文件：`src/components/sidebar/ChatSidebar.tsx`、`tests/frontend/sidebar-section-header-hit-area.test.ts`（新）、`tests/frontend/sidebar-section-order.test.ts`（锚点同步）、feature_list/progress/session-handoff。
- 下一步：真机冒烟——三个分区头留白/右侧按钮间空隙点击应展开收起；点右侧筛选/展开全部/添加项目/新建会话按钮不触发展开收起；拖拽分区排序后不误触发展开收起，Escape 取消后下一次点击正常；键盘 Tab 到标题按钮 Enter 仍可切换；项目行冒烟项见下段。未 commit。

---

## 当前状态：sidebar-pin-hover-alignment Revision 2——状态并入时间槽（已完成，未提交）

- 背景：Revision 1 修复无状态行 8px 偏差后，用户追加要求——运行/未读状态时可以不显示时间，但 pin 位置也要与 hover 一致。
- 根因：状态指示器插在 pin 与时间之间单独占位（running 静置 pin 左移 16px/未读 10px），且项目/全局行状态时时间槽整体省略（偏差最大 ~30px）。
- 修复：`sessionStatusIndicator` → `sessionTimeSlotContent(session, timeText)`——spinner/emerald 点/时间三选一进固定 `w-11 text-right` 槽，槽恒渲染，置顶区/项目行/全局行 3 处统一；dot 补 `inline-block`（槽非 flex）。任何状态静置 pin 中心恒 68px 与 hover pin 重合；状态随槽 hover 淡出。置顶区行为变化：状态优先替代 pinnedAt 时间。
- 验证：定向 vitest 2 files / 30 tests（alignment 8 含新契约 + section-order 22）；eslint 0 error；`npx tsc -b --pretty false`、`npm run build` 通过（dist 已重建，仅既有警告）。
- 下一步：真机冒烟——① running/未读行 pin 位置与无状态行一致、spinner/点右对齐时间列、hover 随槽淡出；② 置顶区 running 显示 spinner 不显示时间、点开会话后恢复时间；③ Archive 胶囊（44px）覆盖状态槽。未 commit。

---

## 当前状态：sidebar-pin-hover-alignment（已完成，未提交）

- 背景：用户反馈项目会话行的置顶 icon 与 hover 时的置顶 icon 位置不一致（hover 时向右跳 8px）。
- 根因：静置态 pin 中心距行右缘 68px（流式 [pin 24][gap 4][时间槽 w-11=44] + padding 8），hover 态 60px（浮层 right-2 [Pin 24][gap 4][Archive w-9=36]）；偏差 = 时间槽 44 与 Archive 胶囊 36 的宽度差。
- 修复：`overlayArchiveButtonClass`（ChatSidebar.tsx）`w-9`→`w-11`，4 处会话列表共用生效，两 pin 中心重合；测试 `sidebar-session-action-alignment.test.ts` 注释/描述/断言同步 + `not.toContain('w-9')` 防回归。
- 验证：定向 vitest 2 files / 29 tests 全过；eslint 两文件 0 error；`npx tsc -b --pretty false` 通过。
- 下一步：真机冒烟——项目分组/置顶区/时间线/全局会话行 hover 时 pin 图标原地淡入淡出、无横向跳动；Archive 胶囊略宽（36→44px）观感可接受；未 commit（与工作区其他并行未提交改动按 feature 拆分提交）。

---



## 当前状态：assistant-reply-artifact-card Revision 9——会话累计口径（已完成，未提交）

- 背景：用户反馈产物和修改应为当前 session 的总和而非单次/单轮。
- 实现：提取改 `extractSessionArtifacts(messages)`（全会话跨轮求和），卡片挂最后一条 assistant；流式不清卡、新轮无产物签名一致原地不动、有产物增量更新；卡片迁移新宿主时展开态回退读旧卡；与「撤销」会话级回滚口径对齐；`extractArtifactsFromMessages` 收回内部。
- 验证：定向 44；全量前端 132 files / 1379 tests；eslint 0 error；`npx tsc -b`、`npm run build` 通过（dist 已重建）。
- 文件：`assistant-artifact-card.ts`、`tool-artifacts.ts`、`tests/frontend/assistant-artifact-card.test.ts`、feature_list/progress/session-handoff/wiki。
- 下一步：真机冒烟——多轮写不同文件后卡片应累计所有文件与 ±；纯问答轮不动卡片；重启应用加载新 dist。未 commit。

---

## 当前状态：assistant-reply-artifact-card Revision 6 + 刷新回归修复（已完成，未提交）

- 背景：用户反馈①发送新消息卡片即消失（应为新轮有新产物才消失）②刷新页面后卡片消失。
- 实现：Revision 6 生命周期——sync 流式分支改纯 return 不清卡；`findLastArtifactTurn` 从新向旧按 user 边界扫描取最近产物轮，卡片挂该轮最后一条 assistant；新轮无产物保留旧卡、有产物流式结束后换轮重建、全无产物轮才清卡。刷新回归修复——Revision 6 初版误把提取源换成 displayEntries（不含 toolResult，提取恒空），改回完整 `messages` 扫描 + 对象引用映射 display 元素，deps 恢复 `messages` 字段；服务端持久化/restore（含 toolResult+details）核实无问题。
- 验证：定向 44；全量前端 132 files / 1379 tests；eslint 0 error；`npx tsc -b`、`npm run build` 通过。
- 文件：`assistant-artifact-card.ts`、`tool-artifacts.ts`（导出 extractArtifactsFromMessages）、`message-actions.ts`、`tests/frontend/assistant-artifact-card.test.ts`、feature_list/progress/session-handoff/wiki。
- 下一步：真机冒烟——写文件出卡 → 刷新页面卡片仍在（restore 后出卡）→ 发纯问答新消息（流式中与结束后卡片保留）→ 再发改文件消息（流式结束后换新轮卡片）；未 commit（工作区有 provider-keys-cache 等并行未提交改动，commit 时按 feature 拆分）。

---

## 当前状态：provider-keys-send-cache——发送路径 provider keys 前端内存缓存（已完成，已提交）

- 目标：消除发送消息路径上的 `providerKeys.get` HTTP 往返（pi 库 AgentInterface.sendMessage 乐观上屏前 await 该调用，HttpStorageBackend 每次发无缓存 GET /api/storage/provider-keys/key/:provider，服务端忙时可感知卡顿）。
- 实现：新增 `src/lib/provider-keys-cache.ts`（模块级 Map：provider→key / null=已确认无 key；in-flight 并发去重；BroadcastChannel('quickforge-sync') 'provider-keys-changed' 跨标签互失效，sourceTabId 自忽略；通道惰性建立 + Node unref 兜底 + clear 关闭重置，不可用静默降级）；`http-storage-backend.ts` 仅对 provider-keys store 挂接（get 读穿命中零 HTTP、has 命中短路不回填、set/delete/clear 写通 + 广播，均位于 fakeProviderKeys/storeOverrides/assert 短路之后，transaction legacy 自动继承）；`backup-settings-tab.ts` 导入成功后统一失效 + 广播。
- 验证：定向 vitest 3 files / 33 tests 全过（新模块 10 + backend 新增 8 + app-settings-cache 回归 6 + backend 既有 9）；eslint 5 改动文件 0 error；`npx tsc -b --pretty false`、`npm run build` 通过（仅既有警告）；提交前全量前端 132 files / 1379 tests 复跑通过。
- 文件：`provider-keys-cache.ts`（新）、`http-storage-backend.ts`、`backup-settings-tab.ts`、`tests/frontend/provider-keys-cache.test.ts`（新）、`tests/frontend/http-storage-backend.test.ts`、docs/wiki/src/lib/README.md、feature_list/progress/session-handoff。
- 下一步：真机验证——发送消息即时乐观上屏（无感知延迟）；设置页改 key / 删 key 后发送立即用新值（get 不再回旧值）；备份导入（含/不含 providerKeys sections）后发送取导入后 key；双标签 A 改 key B 标签发送取新值；已提交（assistant-reply-artifact-card Rev2-6 已同批先行单独提交）。

---

## 当前状态：assistant-reply-artifact-card Revision 6——卡片生命周期（流式保留旧产物）（已完成，已提交）

- 背景：用户反馈发送新消息卡片即消失，应在新轮产出新产物时才消失。
- 实现：sync 流式分支改纯 return 不清卡；新增 `findLastArtifactTurn`（displayEntries 从新向旧按 user 边界扫描，取最近一个有 write/edit/present 产物的轮，卡片挂该轮最后一条 assistant，`extractArtifactsFromMessages` 自 tool-artifacts 导出）；新轮有产物 → 流式结束后 idle sync 换轮重建，无产物 → 签名一致跳过保留旧卡；全无产物轮才清卡；deps 删 `messages` 字段。恢复旧会话时历史产物轮也会出卡（语义一致）。
- 验证：定向 44；全量前端 132 files / 1371 tests；eslint 0 error；`npx tsc -b`、`npm run build` 通过（tsc 曾被并行会话 http-storage-backend 中间态阻塞，其完成后自愈）。
- 文件：`assistant-artifact-card.ts`、`tool-artifacts.ts`（导出 extractArtifactsFromMessages）、`message-actions.ts`（调用点删 messages）、`tests/frontend/assistant-artifact-card.test.ts`、feature_list/progress/session-handoff/wiki。
- 下一步：真机冒烟——写文件出卡 → 发纯问答新消息（流式中与结束后卡片都保留）→ 再发一条改文件的消息（流式结束后卡片换到新轮）→ 撤销置灰在无产物新轮后保持；未 commit（工作区仍有 provider-keys-cache 等并行未提交改动，commit 时按 feature 拆分）。

---

## 当前状态：assistant-reply-artifact-card Revision 5——字体统一 + 浮层遮挡修复（已完成，未提交）

- 背景：用户复查字体大小与弹窗遮挡。三个实际问题：Revision 4 明细动画层 `overflow:hidden` 裁掉行内打开菜单；消息列表 `overflow-y-auto` 裁剪 absolute 浮层（卡片常在最后一条消息底部，撤销弹层/菜单向下弹最易撞）；行内 ± 统计与按钮继承正文 ~14px 大于卡片 12px 档。
- 实现：新增 `panel-decoration/floating-position.ts`（`positionFixedDropdown`：fixed 视口定位 + clamp + 上翻）；打开菜单与共享撤销弹层（含 message-actions 消息级回滚）改 fixed 定位、scroll(capture)/resize 即关、弹层 `-up` 箭头变体；`-file-stats` 与按钮基础字号统一 0.75rem（`font: inherit` → family/size/line-height 显式）；`removeArtifactCards` 统一 `closeActiveOpenMenu()` 清监听。
- 验证：定向 43；全量前端 131 files / 1360 tests；eslint 0 error；`npx tsc -b`、`npm run build` 通过。
- 文件：`floating-position.ts`（新）、`assistant-artifact-card.ts`、`rollback-confirm-popover.ts`、`index.css`、`tests/frontend/assistant-artifact-card.test.ts`（+2 it）、feature_list/progress/session-handoff/wiki。
- 下一步：真机冒烟——展开聚合卡后最后几行打开菜单完整可见、撤销弹层近输入框时向上翻/不被裁、滚动即关、± 与按钮字号观感；未 commit（工作区有 settings-select-reactive-shadowing 等并行未提交改动，commit 时按 feature 拆分）。

---

## 当前状态：assistant-reply-artifact-card Revision 4——样式定稿（已完成，未提交）

- 背景：功能（拆分两类卡/审查/打开▾/撤销）已确认，本轮按用户要求做样式对齐；先出 `design-mockups/assistant-reply-file-card-v2.html` 对齐稿（红绿 ±、对话宽度、比例条、ghost 按钮、折叠头右排、展开动画 6 项），用户确认「就这么干」后全部落地。
- 实现：`index.css` 卡片段——± 红绿（`-added/-removed` 与 `.quickforge-diff-stats-add/del` 同源 light/dark 色值）、`-diffbar` GitHub 比例条（5px、段宽 flex 占比、`-add/-del` 段）、容器 `width:100%`（原 620px 上限，与对话正文同宽）、`-header-stats`（margin-left:auto + mono tabular-nums）、按钮 Ghost（去边框、hover 中性浮底、撤销 hover 红）、details `grid-template-rows 0fr→1fr` + visibility 延迟切换 + `-details-body/-details-list` 三层（reduced-motion 关闭）。`assistant-artifact-card.ts`——新增 `createDiffBar`、折叠头统计移入 `-header-stats` 组、行 stats 先条后数、details 三层包装。
- 验证：定向 41；全量前端 131 files / 1358 tests；eslint 0 error；`npx tsc -b`、`npm run build` 通过。
- 文件：`assistant-artifact-card.ts`、`index.css`、`tests/frontend/assistant-artifact-card.test.ts`（+2 it：红绿/比例条契约、头部布局/展开动画契约）、`design-mockups/assistant-reply-file-card-v2.html`（新对齐稿）、feature_list/progress/session-handoff/wiki。
- 下一步：真机冒烟（红绿/比例条浅深色、宽度与正文同边、折叠头 +N 不推标题、展开动画、ghost hover、撤销 hover 红）；未 commit（工作区有 settings-select-reactive-shadowing 等并行未提交改动，commit 时按 feature 拆分）。

---

## 当前状态：settings-select-reactive-shadowing（已完成，未提交）

- 现象：设置页自定义下拉（默认模型/思考等级/语言/默认运行时/终端 Shell）选择后触发按钮不立即回显，再点一次才显示；保存与重开设置显示正常。
- 根因：`src/lib/quickforge-settings-select.ts` static properties 与真实类字段初始化混用——tsconfig target es2023 + useDefineForClassFields 默认 true 下，原生字段在实例上创建 own property，永久遮蔽 Lit 在 prototype 生成的响应式 accessor，父组件 `.value=...` 属性绑定不触发 requestUpdate；再点一次显示来自 `_openMenu`/`_close` 手动 requestUpdate。
- 修复：8 个 reactive 属性改 `declare` + constructor 默认值（Lit 官方模式，走 accessor），对齐 info-tip.ts/local-tools.ts 项目范式；行为不变。
- 测试：新增 `tests/frontend/quickforge-settings-select.test.ts`（6 用例：ES2023 transpile AST 契约 + Node stub 最小 DOM 实例化验证 accessor 调度/change 派发/开关周期回显；bug 复发形态实测 4/6 失败）。定向 vitest 3 files / 10 tests、eslint 改动文件 0 error、`npx tsc -b` 全过。
- 下一步：真机冒烟——设置页五个下拉选择后触发按钮立即回显、Portal 菜单定位/键盘/搜索不受影响；未 commit（工作区还有 assistant-reply-artifact-card Revision 3 等并行未提交改动，commit 时按 feature 拆分）。

---

## 当前状态：assistant-reply-artifact-card Revision 3——完全对齐截图两类卡（已完成，未提交）

- 背景：用户第二张截图确认最终形态：present 文件各自单文件卡（类型图标 + 「类别 · KIND」副标题 + 打开▾），write/edit 聚合为默认折叠「N 个文件已更改 +X -Y」条，要求一次做完且交互一致。
- 实现：① `assistant-artifact-card.ts` 重写为 CardPlan 体系——单文件卡 + 折叠聚合卡（header role=button chevron 展开、展开态持久在宿主消息元素 dataset），行内类型图标/名字路径同行/+N -N/审查/打开▾；② 「打开▾」下拉 = 预览打开（onOpenFilePreview）+ 在文件管理器中显示（onRevealFile → `openWorkspaceExternal(…,'explorer')` 既有路由，服务端零改动），模块级互斥 `closeActiveOpenMenu`；③ 「审查」→ `onReviewFileChanges(path)` → requestWorkspaceInspector review/changes+`path`（`WorkspaceInspectorOpenRequest` review 分支加可选 path，workspace-types.ts + WorkspaceInspector.tsx 直达 `openDiffTab` 单文件 Monaco diff，git 工作区口径）；④ 幂等改签名跳过重建（`dataset.quickforgeArtifactSignature` 一致仅校正位置），确认弹层/下拉/展开态跨装饰周期存活；⑤ 头部「撤销」沿用 Revision 2 链路（rollback-confirm-popover → ServerAgent.rollbackFiles）。i18n 删旧增类别/菜单 key；index.css 重写两类卡段。
- 验证：全量前端 vitest 130 files / 1350 tests 全过（含顺带修复既有 sidebar-session-action-alignment 陈旧 w-9 断言→w-11）；eslint 改动 11 文件 0 error；`npx tsc -b`、`npm run build` 通过。
- 文件：`assistant-artifact-card.ts`、`message-actions.ts`、`rollback-confirm-popover.ts`（Revision 2 新增）、`ChatPanelHost.tsx`、`App.tsx`、`server-agent.ts`、`workspace-types.ts`、`WorkspaceInspector.tsx`、`index.css`、`i18n.ts`、`tests/frontend/assistant-artifact-card.test.ts`、`tests/frontend/sidebar-session-action-alignment.test.ts`（顺带修复）、wiki components README 及三状态文件。
- 下一步：真机冒烟——present 出单文件卡、write/edit 出折叠条（默认收起，展开后流式刷新不回折）、打开▾ 两项分流、审查直达单文件 diff、撤销全链路；未 commit（工作区同有 docs/reports/ 未跟踪等其他改动，commit 时按 feature 拆分）。

---

## 当前状态：sidebar-session-time-nowrap（已完成，已提交 dev，未 push）

- 现象：中文界面侧栏会话时间「15小时」在固定 36px 时间列内断成两行并撑高行；「2天」等短文案不受影响。
- 修复：`src/components/sidebar/ChatSidebar.tsx` `timeClass`（:500）一行——`w-9`→`w-11`（36→44px）+ 补 `whitespace-nowrap`。4 处引用共用该变量；固定宽度保证整列右对齐；`formatSessionTime` 最长 zh 输出「23小时」，44px 足够；i18n 仅 zh/en。
- 验证：eslint ChatSidebar.tsx 0 error；npm run build 通过（仅既有警告）（纯 className 改动，无对应单测，未跑全量）。
- 下一步：真机复核中文界面侧栏时间单行显示、各列表（Pinned/项目/时间线）行高一致；英文界面不受影响。已提交 dev，未 push。

---

## 当前状态：assistant-reply-artifact-card（已完成，已提交 dev，未 push）

- 目标：仅在最后一条已完成 assistant 回复底部显示按设计稿重做的本轮文件产物卡片；流式中、user、历史 assistant 或无 artifact 时移除。
- 实现：复用 `extractCurrentTurnArtifacts`，纳入有 path 的 `write_file`/`edit_file`/`present_files`；卡片显示文件图标、标题/说明、总 +N/-N、类型徽标、文件名、路径/类型辅助信息、每文件差异、统一「打开」预览按钮、底部变更范围及详情展开/收起。旧 change-summary-strip 前端文件、接线、CSS、i18n key 与测试已删除；服务端 `session-file-backups.mjs`、工具备份和 file-changes/rollback 路由保留。
- 测试/验证：定向前端测试与 `npx tsc -b --pretty false` 通过；提交前全量 `npm run test`（283 files / 2688 tests 全过）、`npm run lint`（0 error，仅既有 warning）、`npm run build`（仅既有警告）、`git diff --check` 均通过。
- 文件：`src/components/chat/panel-decoration/assistant-artifact-card.ts`、`message-actions.ts`、`panel-decoration.ts`、`ChatPanelHost.tsx`、`src/index.css`、`src/lib/i18n.ts`、`tests/frontend/assistant-artifact-card.test.ts`、`design-mockups/assistant-reply-file-card.html` 及三状态文件。
- 已提交/阻塞：feature commit 见 git log（dev 分支）；阻塞：无。

---

## 当前状态：split-commit-4-features（已完成）

- 本轮目标：把工作区 4 个并行 feature 的未提交改动按 feature 拆分提交。
- 提交结果（dev 分支，领先 origin/dev 6 commits，未 push）：`5d1b518` fix: 切回页面时无置顶会话的 Pinned 区块闪现；`92a094d` fix: 切回页面时侧栏显示更多按钮 spinner 闪烁；`0e7fc48` feat: 长文本粘贴自动转为附件并支持系统打开；`40450c2` feat: 会话代码变更摘要条与影子备份回滚。交叉文件（App.tsx/agent.mjs/agent.test/ChatSidebar/sidebar-section-order.test/index.css/三状态文件/wiki）按 hunk/条目块归属拆分，总量核对 c30d3c5..HEAD = 36 文件 +1778/−47 与拆分前工作区一致。
- 提交前修复：① `tests/server/routes/side-chat.test.mjs` storage mock 补 `cacheDir`（F2 的 text-attachments 顶层导入破坏该测试 16 用例，随 0e7fc48 提交）；② 6 个被 CRLF 污染文件转回 LF（App.tsx/agent-subagent-runner.mjs/session-pagination-bootstrap.test.ts/feature_list.json/progress.md/session-handoff.md，App.tsx 的 CRLF 曾致 4 个源码契约测试失败）。
- 验证：全量三件套通过（npm run test 2691 tests 全绿 / lint 0 error / build ✓ 仅既有 chunk 警告）；提交后 git diff 为空、status 仅剩 `.zcode/` untracked（不属于任何 feature，勿提交）。
- 下一步：真机冒烟——F1 摘要条/回滚/预览分流、F2 重启桌面应用后粘贴附件、F3/F4 切回闪烁；按需 push dev。

---

## 当前状态：session-change-summary-rollback（已完成，已提交 40450c2，待真机冒烟）

- 目标：对话底部常驻摘要条——显示本会话修改的代码文件数与对账真实 +N/−N 行数，支持安全回滚（影子备份恢复到会话首次修改前、删除会话新建文件）与文件预览。用户确认：影子备份机制、整会话粒度、真实 diff 口径；Revision 后预览对齐产物体系（html/md/txt/word 等全类型）。
- 实现：`server/session-file-backups.mjs`（新）+ write_file/edit_file 写盘前备份接入（`server/tools/index.mjs`）+ subagent 写入归因父会话（`agent-subagent-runner.mjs` 工具上下文补 sessionId）+ 路由 GET `/api/agents/:id/file-changes`、POST `/api/agents/:id/rollback-files`（`server/routes/agent.mjs`）；前端新 `panel-decoration/change-summary-strip.ts`（两步确认回滚、流式禁用）、ChatPanelHost/App/panel-decoration 接线、i18n +7 key、index.css 新增 `.quickforge-change-summary-strip` 段。预览：类型判定复用 `artifactPreviewMode`（html/图片→Browser、markdown/代码→Reader、pdf/docx/excel→Document），回调 `onOpenFilePreview` 在 App 直调产物预览统一入口 `openArtifactPreview(projectId, relativePath)`，与产物列表同源（含 tab 复用/重载；全局会话无项目上下文不显示按钮）。
- 验证：定向 vitest 5 个新/扩测试文件 + 回归（session-file-backups 5、routes/agent 21、tools 68、agent-manager.subagents 16、前端契约 10）全过；eslint 改动 ts 0 error；node --check；tsc -b；npm run build ✓（仅既有 chunk 警告）。Revision 复验：契约测试 10、eslint、tsc -b。未跑全量 test/lint。
- 边界：run_command / OpenCode 产生的文件改动不纳入（progress Notes 有记录）；备份 7 天 TTL；Side Chat/readOnly 不挂条；未 commit、未新增依赖、未触碰生成产物。
- 下一步：真机冒烟（Agent 编辑+新建 md/txt/html/docx → 摘要条/展开列表/预览分流 Reader/Browser/Document/回滚后文件复原、新建文件被删、流式中回滚禁用）；工作区还有多个并行 feature 未提交改动，commit 时按 feature 拆分。

---


## 当前状态：large-paste-text-attachment Revision（真机冒烟报错修复 + UI 微调，已完成，未提交）

- 背景：用户真机点击粘贴文本附件报「无法打开文件 Path is outside the selected project: C:\Users\...\.quickforge\cache\global\tmp\conversations\pending-...」。只读排查结论：该报错只能来自 App.tsx `openLocalFilePathFromChat` 的 resolveWorkspacePath 回退分支，而当前代码（含 16:34 dist）的 `/cache/global/tmp/conversations/` 检测对该路径必然命中——即用户渲染进程跑的是 feature 中间态旧 bundle（编辑器粘贴已有、App.tsx 专用分支 15:07 才写入），**重启桌面应用加载新 dist 即不复现**；但当前代码另有两个真实缺陷，本轮一并修复。
- 修复①（服务端）：`openPathInFileManager` 原仅接受目录（`stat.isDirectory()` 否则 400），open-text-attachment 路由传入 .txt 文件必然失败。现支持文件定位：参数构造抽为纯函数 `createFileManagerOpenArgs`（win32 `explorer /select,<file>`、darwin `open -R`、Linux `xdg-open <父目录>`；目录行为不变），缺失/类型非法统一报 `Path does not exist`（原 Directory does not exist）。
- 修复②（前端装饰）：message-actions 附件装饰重写为 `decorateTextAttachmentTiles`——Lit index-keyed 复用 user-message DOM 下原实现每装饰周期重复 append `.quickforge-text-attachment-path` 行、叠加 once 点击监听，且多附件 `:last-of-type` 全绑最后一个 tile；现 tile 按 attachment 下标对齐、每 tile 仅安装一个读取当前 dataset 路径的持久 capture 监听（路径变化自动跟随、点击永远生效且拦截 pi 自带 AttachmentOverlay）。editor-bindings 编辑器 chip 点击监听同步去 `once` + 同款两标记去重。
- 修复③（UI 微调，用户反馈"顶部不要显示完整路径"）：消息内不再展示 `.quickforge-text-attachment-path` 路径行（CSS 两条规则删除，装饰函数保留旧残留清理）；完整路径仅在附件 tile hover 提示（title），点击打开行为不变。方案 A（三选一问题未作答按推荐执行），如需"只显示文件名/中间省略路径"再微调即可。
- 文件：server/utils/platform.mjs、src/components/chat/panel-decoration/{message-actions,editor-bindings}.ts、src/index.css（-路径行样式）、tests/server/utils/platform.test.mjs（+2）、tests/server/routes/agent.test.mjs（+3，mock text-attachments/platform）、tests/frontend/message-actions.test.ts（+3，FakeNode 扩展 listeners/addEventListener）、docs/wiki/server/utils/README.md、feature_list.json、progress.md、session-handoff.md。
- 验证：定向 vitest message-actions 30 / routes/agent 19 / utils/platform 5 / text-attachments+message-converters+editor-bindings+routes/channels 17 全过；UI 微调轮 message-actions+editor-bindings 32 全过；改动文件 eslint 0 error；tsc -b；node --check；npm run build 通过（仅既有 chunk 警告，dist 已刷新）。
- 下一步：用户**重启桌面应用**后冒烟——粘贴 ≥3000 字符 → 消息内只见附件块（无路径文字行，hover 显示完整路径）；点击输入框附件 chip 与消息附件 tile 均在资源管理器中定位到该 .txt；多次点击持续生效；连续两次粘贴多附件时各 tile 打开各自文件。
- Notes：open 路由未校验会话归属（`isSessionTextAttachmentPath` 导出未用，任何合法 qf 附件路径可经任意会话 URL 打开，本地单用户影响小，留观）；`.zcode/` 未跟踪目录与并行会话改动（sidebar-pinned-refocus-flash 等）不属于本 feature，commit 时按 feature 拆分。

---

## 当前状态：sqlite-heavy-op-worker-thread（已完成，待提交）

- 目标：会话持久化的消息编码+同步大事务不再阻塞主事件循环（"保存设置被 persist 拖住"治本），所有运行时（desktop fork/inline、qf CLI/npm web、ACP stdio）统一受益。
- 架构：方案 A 双连接分区——新 `server/sqlite/session-state-worker{,-client,-protocol}.mjs`，worker 自开 DatabaseSync 执行白名单重 op（save/replaceMessages/appendMessages/applyBatch/replaceAll/exportSnapshot/verifyIntegrity/checkpointWal/delete/readMessagesPage 等），小读留主线程；`QUICKFORGE_SQLITE_WORKER=0` kill-switch；service 注入 repository 恒优先；错误序列化保 CAS 控制流属性；closeSqliteStorage 经新关闭钩子先关 worker。
- 修复的连带缺陷：`atomicSessionMetadataStateUpdate` 缺 `return await`（异步 conflict 逃逸重试）；storage.mjs pin 路径补 maxRetries=3 新鲜桶重算（异步交错窗口）；writePlan rename 补 AV 重试。
- 验证：worker 单测 6×3 稳定；sqlite+session-state 全族 97×4 稳定；受影响面 25 files/212 tests；全量 2662 中 2642 过（剩 20 失败均属并行会话未提交改动：3 前端源码契约 + side-chat 16 个 vi.mock 缺 cacheDir，见 progress.md）；eslint/node --check/build 全过。
- 下一步：真机验证（长会话运行中保存设置不卡顿，desktop + npm web 各一次；日志无 WORKER_CRASHED）；可选后续：share/lan/scheduled-runs 域评估迁移、session-state-import 迁移、设置页加载链优化（catalog 重复请求 + Cloud 2s，另行立项）。

---

## 当前状态：desktop-fork-default（已完成，已提交 5cf2d6e）

- 目标：桌面端默认以独立子进程运行 server，inline 变 `QUICKFORGE_DESKTOP_INLINE=1` 显式 opt-in；消除同步 SQLite 大事务/GC 停顿冻结 Electron 主进程窗口的问题。
- 实现：electron-main.mjs 默认判定翻转 + dev stdio inherit；public-api.mjs 新增 stopChildProcess 升级链（SIGTERM→等 exit 10s→SIGKILL 5s）；新契约测试 desktop-fork-default.test.ts；wiki 两处同步（README 桌面运行时隔离、server README 代理矩阵）。
- 验证：定向 vitest 3 files / 16 tests、eslint 3 文件、node --check、npm run build 全过。
- 接受项：默认模式自定义 PAC URL 需 opt-in inline；Windows fork 退出硬杀（WAL 可恢复）；同版本端口复用为 fork 既有语义。
- 下一步：同会话继续 sqlite-heavy-op-worker-thread（worker_threads 双连接分区，方案已批准）；真机冒烟清单见 progress.md。

---

## 当前状态：sidebar-show-more-refocus-spinner（调研+修复，已完成，未提交）

- 背景：用户在 Pinned 闪烁修复后报告「显示更多按钮也闪烁一下」。调研实测确认（120ms 延迟复现、本地快时 React 合批掩盖——闪烁时有时无）：切回 → refreshSessions 把各列表置 `loading:true` → SessionDisplayControls `loading ? spinner : 文字` + `disabled` 误切换。
- 修复：`SessionPage` 增加可选 `appending` 字段（offset>0 用户追加才置 true，静默 offset=0 刷新 false）；四个 loader 置位/成功/失败/timeline 收尾同步维护；hook 导出 `projectTimelineAppending`/`globalAppending`/`projectAppending`；ChatSidebar 三处 SessionDisplayControls 改读 appending；`*Loading` getter 保留给空态 spinner 与 LoadMoreSentinel 防重复门控；ChatSidebar/App 的 `globalLoading` 死链移除（hook 导出保留）。
- 测试与验证：bootstrap 新增 2 用例（静默 refresh `loading:true+appending:false`、loadMore `appending:true`）+ 3 处断言补 appending；section-order 新增按钮接线契约。定向 vitest 5 files / 47 tests、eslint 6 文件 0 error、`npx tsc -b` 全过；浏览器复验同延迟条件 `svgChanges:[]`、`disabledFlips:0`。
- 文件：`src/lib/session-list-updates.ts`、`src/hooks/useSessionPagination.ts`、`src/App.tsx`、`src/components/sidebar/ChatSidebar.tsx`、两份测试、feature_list.json、progress.md、session-handoff.md。
- 下一步：用户真机切走/切回确认按钮静止、点「显示更多」确认 spinner 反馈正常；未 commit。

---

## 当前状态：sidebar-pinned-refocus-flash（调研+修复，已完成，未提交）

- 背景：用户报告「切回浏览器到页面，左边项目的列表闪烁一下」。调研实测定位（dev server + MutationObserver 两次复现）：切回 → `useCrossTabSync` visibilitychange → `refreshSessions` → `loadPinnedSessions(0)` 先 `setPinnedPage({...prev, loading:true})`（空 items 保留）→ 无置顶会话时 `ChatSidebar.tsx:1299` 挂载条件 `length > 0 || pinnedLoading` 因 loading 短暂成立 → Pinned 区块整体闪现 42-62ms 后随空数据卸载，把下方项目列表挤下再弹回。触发条件 = 无置顶会话。
- 修复：挂载条件收紧为 `pinnedSessionItems.length > 0`（内容驱动）；删除不可达的区块内 loading spinner 死分支；`pinnedLoading` 仍保留于 `LoadMoreSentinel` 门控，分页/loading 语义零改动。
- 测试与验证：`sidebar-section-order.test.ts` 新增防回归契约 4 断言；定向 vitest 3 files / 33 tests、eslint 2 文件 0 error、`npx tsc -b` 全过；修复后浏览器复验切回事件 Pinned 区块插拔消失。
- 文件：`src/components/sidebar/ChatSidebar.tsx`、`tests/frontend/sidebar-section-order.test.ts`、feature_list.json、progress.md、session-handoff.md。
- 下一步：用户真机切走/切回确认；未 commit。调研中其余工作区级候选（rAF 补跑滚动跳变、SSE 重连提示条插拔、watchdog 全量替换、scrollbar-gutter）见 progress.md Notes 备查，未扩大范围。

---

## 当前状态：sidebar-session-running-unread-status（已完成，未提交）

- 目标：侧栏会话行尾显示运行 icon；成功完成后以绿色点表示未读。
- 实现：`useVisibleRuntimeStatuses` 监听 agent_start/agent_end，维护当前前端生命周期内的完成未读集合；`ChatSidebar` 三类会话行使用 Loader2/emerald 点；点击会话清除未读。预览：`design-review/sidebar-session-status.html`。
- Revision（移除标题左侧加载 spinner）：删除 `ChatSidebar.tsx` 的 `sessionLoadingIndicator` 定义及 5 处渲染（置顶/时间线/项目分组/全局会话/搜索结果列表），消除加载时标题文字被 icon 挤动的抖动；`aria-busy` 保留，行尾运行中/未读状态不受影响。验证：ESLint、tsc -b、定向 vitest 6 files / 52 tests 通过。
- 验证：tsc、相关 ESLint、git diff --check 通过。
- 未新增依赖，未修改 dist/package-dist/package-offline，未 commit/tag/push。

---

# Session Handoff

## 当前状态：large-paste-text-attachment（已完成，未提交）

- 目标：一次粘贴大量文字时自动写入 qf 临时目录，以附件方式发送；附件位于输入框内部，点击附件打开系统文件管理器，记录显示完整路径。
- 当前规则：单次粘贴 `>= 3000` 字符触发；小于阈值按普通正文粘贴；最大 2,000,000 字符。
- 实现：`server/text-attachments.mjs` 写入与路径校验；`server/routes/agent.mjs` 提供文本附件创建/系统打开接口；`server/message-converters.mjs` 读取安全路径；`editor-bindings.ts` 接入粘贴；`App.tsx` 将 qf 临时附件交给系统打开；`message-actions.ts` 显示完整路径并绑定附件点击。
- 验证：文本附件与消息转换测试 9/9；tsc、相关 ESLint、npm run build、git diff --check 通过。仅有既有构建 warnings。
- 未完成/风险：尚未做真实桌面端手工冒烟；OpenCode path-only 附件链路尚需单独确认；工作区存在 `.zcode/` 未跟踪目录，不要误加入本 feature。
- 未 commit/tag/push。

---


## 当前状态：backup-settings-only-and-snapshot-fast-path（已完成，已提交 dev）

- 本轮已完成：消息队列、活跃 Agent destroy-first、scheduled task updater、IndexedDB 事件收窄、`exportSnapshot` keys/has/identity 优化，以及用户 HTTP backup settings-only boundary。
- 提交前定向验证发现并修复新增并行用例两处缺陷（mock `continue()` 不结算、sessionId 同毫秒冲突，见 progress.md Revision）：定向 vitest 8 files / 131 tests 全过，scheduled-tasks.execution 连跑 3 次稳定，eslint 改动文件 0 error。
- 本会话已创建 commit（dev 分支，未 push）；`docs/reports/` 12 份分析报告按用户决策保持未跟踪，待后续整理（报告自身建议保留 3 份、9 份移 docs/archive/）。
- 未处理项：既有 Notes 候选保持原状；未跑全量 test/lint/build（非发布）。

## 当前状态：desktop-memory-session-idle-eviction（已完成，未提交）

- 目标：用户报告桌面端「内存爆炸卡死」，全链路排查并修复第一根因（会话永不淘汰）。
- 排查结论：①会话级 SSE keepAlive 每 15s `touchSession` 重置 10 分钟闲置计时器，前端全局 SSE 常开 → 本次运行打开过的所有会话连同全量消息历史永久驻留内嵌主进程堆（本条已修复）；②渲染端消息窗口化被 `ChatPanelHost.tsx:600` `{enabled:false}` 禁用 + 流式期每 rAF 全量装饰扫描 → 长会话卡死主因（未处理，见 progress.md Notes）；③desktop inline 内嵌 server、SSE 无背压、storage 全库物化、ACP idleRetention:'always'、pdfjs/xlsx 预览问题等候选（未处理）。
- 实现：`server/routes/agent.mjs` keepAlive 心跳移除 `touchSession(sessionId)`（connect 单次 arm 保留）。删除安全性已核实：数据路由与 runPrompt→syncSessionFromStorage 均自动 restore；running 会话闲置计时器自动续命；sseConnected 随 session 对象销毁无 409 死锁；前端只用全局流 `/api/agents/events`（模块级 emitter 不受销毁/恢复影响），会话级 `/stream` 无消费方；`8e75c78` 引入该 touch 时前端尚用会话级流，现已不适用。
- 验证：定向 vitest `tests/server/routes` 24 files / 183 tests（含 agent.test.mjs）+ agent-manager.abort / acp.prompt-cleanup / exports-contract 全过；eslint server/routes/agent.mjs 0 error。
- 文件：server/routes/agent.mjs、progress.md、session-handoff.md。
- Revision（前端空闲副本清零）：`agent-task-retention.ts` MAX_IDLE_AGENT_TASKS 5→0 + `useAgentManager.ts` startDeferredSession 视图切换后补 pruneIdleTasks(undefined)。taskMap 仅剩当前会话 + 后台 running/streaming 任务；切回空闲会话走服务端 restore（比内存缓存多一个网络往返，用户决策以内存优先）。验证：定向 vitest 5 files / 26 tests、eslint 3 文件、tsc -b、build 全过。
- Blocker：无。边界：销毁不丢数据（历史在 SQLite，下次访问自动 restore）；未 commit/tag/push；未跑全量 test/lint/build。
- 下一步：可选真机验证（开多个长会话后放 10 分钟，观察主进程内存回落；再对被淘汰会话发消息确认无感恢复；来回切换会话确认切回路径正常）；后续候选按 progress.md Notes 顺序（渲染端窗口化/装饰增量化、desktop fork 隔离、SSE 背压等）。

---

## 当前状态：subagent-capability-inheritance（已完成，未提交）

- 目标：在 Subagent Profile 设置中增加“允许使用 MCP 工具”和“允许使用 Agent Skills”两个开关；开启后子 Agent 继承主 Agent 当前实际工具集中的对应能力，默认关闭。
- 实现：Profile/API/Markdown 新增 `allowMcpTools` / `allowAgentSkills`；自定义 QuickForge Profile 可编辑，外部只读 Profile 不可编辑，内置 `general` / `explore` 通过 `agent-profile-overrides` 保存两个开关。临时 Profile schema 也支持显式传入两个字段。
- 子 Agent：从父会话 `agent.state.tools` 中按工具名取交集，避免从全局 MCP registry 获得父 Agent 未拥有的额外 MCP；Skills 只继承 `activate_skill` / `read_skill_resource`；构建和执行前均校验 effective tools；MCP 仍沿用父会话审批/完全访问规则；禁止递归 subagent；关闭 Skills 时移除父 prompt 中的 `<available_skills>`。
- 文件：相关 server Profile、tool definitions、subagent runner、设置页、i18n、测试、Wiki、`feature_list.json`、`progress.md`。
- 验证：定向 Vitest 7 files / 64 tests 全过；相关 ESLint 0 error；`npx tsc -b --pretty false`、相关 `node --check`、`npm run build` 全通过（仅既有 KaTeX 字体与 chunk size warnings）。
- Blocker：无。未新增依赖，未修改生成产物，未 commit/tag/push。
- 下一步：可选真机验证：在主会话启用 MCP/Skill 后，Profile 开启对应开关，运行 general/explore，确认子 Agent 工具列表和审批行为；工作区其他未提交 feature 仍需按 feature 拆分。

> 归档说明（2026-09-04）：更早的 85 个条目已移至 docs/archive/session-handoff-archive.md；feature 条目对应归档在 docs/archive/feature-list-archive.json。

## 当前状态：composer-borderless-thinking-control（已完成，未提交）

- 目标：用户分步驱动 Composer 底栏视觉与交互重构——①「完全访问权限」→「完全访问」+ 琥珀文字色；②「+」/模型/权限按钮完全去框（方案 A）；③思考等级拆为独立选择器（模型右侧、发送左侧，大脑 icon + 等级文字 + 下拉箭头），模型选择纯文字 + 下拉小箭头、不设 max-width；④模型选择弹层不含思考等级，桌面端合并为单一模型列表（无二级子菜单）；⑤「完全访问」hover/展开底色为中性（与其他控件一致），仅文字琥珀。
- 实现：新 `src/components/chat/panel-decoration/thinking-level-controls.ts`（五档菜单：关/低/中/高/超高；与 Agent 权限菜单共用样式选择器组、互斥、Escape/点外关闭）；`model-controls.ts` 去后缀；`panel-decoration.ts` 接线 `onThinkingLevelChange`；`ChatPanelHost.tsx` 回调写 `agent.state.thinkingLevel` + `updateThinkingLevel` + 重跑装饰；`icons.ts` +thinkingBrainIcon/thinkingChevronIcon；`i18n.ts` agentAccessFullLabel 改「完全访问」；`index.css` 去框（含「+」）、琥珀文字/中性底、chevron/盒形 icon 切换、紧凑 icon-only、模型名去 max-width。`custom-model-selector.ts`：移除思考区与 thinking 相关选项、桌面单一列表（删 renderModelSubmenu/positionModelSubmenu/.quickforge-model-submenu CSS，恢复 .quickforge-model-menu-note 空态提示），`useModelActions.ts` / `SharedConversationPage.tsx` 调用点清理（保留非推理模型自动归零守卫）。设计稿 design-mockups/composer-borderless.html 同步。
- 验证：此前全量 `npm run test` 276 files / 2626 tests 的唯一失败为 `local-tool-running-sweep.test.ts` CSS 解析误报；现已修复测试解析器并完成全量 277 files / 2638 tests 全通过。npm run build ✓；eslint 0 error（1 个既有 warning）；chat-compact-controls / composer-control-hover 断言同步。**中途事故**：Python 正则批量删 CSS 误吞 4638 行，已从 HEAD 恢复并逐块重放（详见 progress.md 事故记录），最终 diff 复验干净。
- 文件：src/lib/i18n.ts、src/index.css、src/lib/custom-model-selector.ts、src/hooks/useModelActions.ts、src/components/share/SharedConversationPage.tsx、src/components/chat/panel-decoration/{thinking-level-controls.ts,model-controls.ts,icons.ts,panel-decoration.ts}、src/components/chat/ChatPanelHost.tsx、tests/frontend/{chat-compact-controls,composer-control-hover,custom-model-selector}.test.ts、design-mockups/composer-borderless.html（新）、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。
- 备注：紧凑模式模型 icon 经 6 候选对比页（design-mockups/model-compact-icon-options.html）评审后决定维持立方体 Box，并补齐 mask 内部棱线使显示与设计稿一致；icon-only 形态按钮行改 flex-start + gap 0.5rem，图标控件连续排列间距统一（权限/模型/思考之间不再有 justify-between 弹性空隙），发送/停止按钮 margin-left auto 保持右缘。
- 下一步：可选真机冒烟（切档发送生效、非推理模型按钮隐藏、窄屏 icon-only、模型菜单单列表、窗口缩放模型名不截断）；工作区还有 sidebar-pin-hover-alignment / motion-design 两批等未提交改动，commit 时按 feature 拆分。
- 本轮修订：紧凑态控件行保持 `justify-content: space-between`，左/右控件组继续分开；右侧模型、思考等级、发送/停止内部连续排列，右侧组 `gap: 0.5rem`，模型/思考等级各 2rem，发送/停止 `margin-left: auto` 贴右。更新 `src/index.css` 与 `tests/frontend/chat-compact-controls.test.ts`，并同步 feature/progress 状态；定向 Vitest 12/12、ESLint、tsc -b、git diff --check 通过。
- Revision 4：上下文用量环在模型按钮前插入 `quickforge-context-usage-slot` 32px flex 槽位，环本身固定 14px 且居中；不改变百分比/数据计算。`chat-compact-controls.test.ts` 与 `context-usage.test.ts` 锁定 CSS 槽位、DOM 顺序和 compact 布局；定向 2 files / 24 tests、ESLint、tsc -b、build、git diff --check 通过。未 commit/tag/push。
- Revision 6：模型选择弹窗（桌面与移动端共用）选中勾改为复用 `agentAccessCheckIcon` SVG，勾选槽位移至左侧并与思考等级菜单统一 1rem 栅格、13px 图标和前景色；新增 `custom-model-selector.test.ts` 契约断言。定向模型选择器 8/8、ESLint、git diff --check 通过；待运行 tsc/build。未 commit/tag/push。
- Revision 7（运行中 Subagent 控件去框）：完成 `src/components/chat/panel-decoration/subagent-running-indicator.ts` 的运行中控件去框，并同步 `tests/frontend/subagent-running-indicator.test.ts` 与 `tests/frontend/composer-control-hover.test.ts` 契约覆盖。定向 2 files / 15 tests、ESLint、tsc、build、git diff --check 均通过。
- Blocker：无。
- 下一步：如确认视觉效果，可提交并推送。

---

## 当前状态：sidebar-pin-hover-alignment（已完成，未提交）

- 目标：用户反馈「hover 时候置顶时候的按钮有点对不齐」——修复侧栏会话行置顶按钮在静置/hover 两态间的位置与尺寸跳变。
- 根因：静置 pin（in-flow、可变宽度时间文本左侧、size-5/12px）与 hover 浮层 pin（absolute right-1、size-6/14px）几何不一致，hover 跳位 5-20px 且放大、过渡期双影；pinnedSessionButtonClass 的双 transition 工具类被 twMerge 去重导致 opacity 瞬变；全局行归档图标误用 size-4；浮层 right-1 与行内容缘 px-2 错位。
- 实现：镜像槽位几何——静置 [pin 槽 size-6][gap-1][时间槽 w-9 右对齐]（未置顶行 size-6 空 span 占位），hover 浮层 right-2 + [Pin size-6][gap-1][Archive h-6 w-9] 完全镜像静置簇：pin 原位交叉淡入淡出零位移零缩放、归档胶囊精确覆盖时间槽、时间列/标题列跨行对齐；图标统一 size-3.5；pin 过渡改 transition-[color,opacity]；会话浮层与行内主按钮间距统一 gap-1（用户反馈 gap-2 太宽后收窄，两态必须一致以保持镜像）、项目行浮层保持 gap-px（共享 right-2）；四处行结构同步（Pinned 分区/时间线/项目子会话/全局会话）。
- 验证：定向 vitest 4 files / 44 tests（含新增 sidebar-session-action-alignment 7 契约）+ 回归 3 files / 21 tests 全过；eslint 2 文件 0 error；tsc -b；npm run build 通过（仅既有 chunk 警告）。未跑全量。
- 文件：src/components/sidebar/ChatSidebar.tsx、tests/frontend/sidebar-session-action-alignment.test.ts（新）、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。
- 下一步：真机冒烟（置顶/未置顶行 hover pin 原位淡入淡出、归档落位、跨行对齐、pin/unpin 无挤压；确认归档与 hover 提示回归）。工作区仍有 motion-design 两批等其他 feature 未提交改动，commit 时按 feature 拆分。

---

## 当前状态：motion-design-batch-2（已完成，未提交）

- 目标：动效第二批——大弹窗复用 / 菜单展开 / Toast 调优 / 列表项淡入 / 侧栏删除退出 retune（方案与交互演示见 design-review/motion-design-demo-batch2.html，用户已确认执行）。
- 改动：四个大弹窗（skills-dialog / GitGraphDialog / ShareConversationDialog / project-directory-picker）挂 dialog-backdrop-in / panel-in；index.css 新增 `--quickforge-dur-exit: 140ms` + `quickforge-menu-in` / `quickforge-list-item-in` 原语（reduced-motion 守卫同步扩展）；GitBranchMenu / ProjectOpenMenu 挂 menu-in（origin-top-left/right）；ui/toast.tsx 改 `transition-[translate,opacity]` + 两分支 duration（base/exit）+ toastExitMs=140；WorkspaceChangesList 行挂 list-item-in；ChatSidebar 删除退出 deleteSessionFadeMs=140 且 5 处配对类 token 化；motion-design.test.ts 扩至 13 用例；DESIGN_LANGUAGE.md 动效章节补 exit token 与菜单/列表/toast 范式。
- 验证：定向 vitest 3 files / 42 tests 全过；eslint 10 文件 0 error；tsc -b 通过；npm run build 通过（仅既有警告）；产物 CSS 抽查全部正确编译（exit token 压缩为 .14s 属正常归一化）。未跑全量，未 commit。
- Blocker：无。
- 下一步：真机冒烟（弹窗/菜单/toast/变更列表/删除退出 + reduced-motion）；如观感 OK 可与第一批一起随下次发布提交。

---

## 当前状态：agent-manager-module-split（已完成，已提交）

- 目标：把 server/agent-manager.mjs（4014 行上帝模块）按职责无损拆分，纯机械搬移、零行为变更，agent-manager 保留 facade re-export，消费方零改动。
- 结果：agent-manager 约 1966 行（会话编排 + facade）；新模块 agent-session-store / agent-session-events / agent-harness / agent-compaction / agent-prompt-commands / agent-approval-orchestrator / agent-subagent-runner / agent-persistence。函数逐字符搬移。
- 提交序列（每块独立 commit）：b55c3d8 安全网+状态收口、557b748 事件核心、61d316d harness+compaction、9fe9758 prompt-commands、e841aad approvals、f33e70b subagent-runner、1f7a8fd persistence。
- 验证：每块全量 npm run test 与基线一致（275 files / 2612 tests，唯一失败为既有前端 CSS 契约 local-tool-running-sweep，拆分前即存在、与 server 无关）；eslint 0 error（仅既有 identity.mjs:92 warning）；npm run build 通过；tests/server/agent-manager-exports-contract.test.mjs 锁定 47 个消费面符号 + INTERNAL_SHARED_EXPORTS（现余 resetIdleTimer/createServerTools，后续块迁移后收回）。
- 文档：docs/wiki/server/README.md 模块地图已同步；feature_list.json 标 done；progress.md 有完整条目。
- 下一步（可选）：① 真机冒烟（会话创建/prompt/审批/subagent//compact//plan/持久化恢复/OpenCode）；② 前端 App.tsx/ChatPanelHost.tsx 上帝组件拆分另立 feature；③ 工具构建与 SSE 路由仍留 agent-manager，可后续继续拆。

---

## 当前状态：motion-design-batch-1（已完成，未提交）

- 目标：动效统一第一批——按用户确认的方案落地 0 token / 1 弹窗 / 6 侧栏文字淡入 / 7 按钮按压 / 8 扫光纳管 五项（编号对应 design-review/motion-design-demo.html 演示章节）。
- 改动：`src/index.css`（`:root` 动效 token `--quickforge-dur-fast/base/slow` + `--quickforge-ease-out`；新增 `quickforge-dialog-backdrop-in` / `quickforge-dialog-panel-in` / `quickforge-sidebar-label-in` 三个进入原语 + reduced-motion 守卫；扫光注释纳管）；`prompt-dialog.tsx` / `confirm-dialog.tsx` 挂弹窗进入类；`ChatSidebar.tsx` 的 `sidebarSessionTitleClass` 与 `sectionHeaderClass` 挂标签淡入；`ui/button.tsx` cva 基类加 `transition-[background-color,color,border-color,scale] duration-(--quickforge-dur-fast) ease-(--quickforge-ease-out) active:scale-[0.97]`；新增 `tests/frontend/motion-design.test.ts`（7 用例）并同步 `sidebar-section-order.test.ts` 既有断言；`DESIGN_LANGUAGE.md` 新增「动效」章节；`design-review/motion-design-demo.html` 交互演示。
- 验证：定向 vitest 2 files / 27 tests 全过；eslint 6 文件 0 error；`npx tsc -b` 通过；`npm run build` 通过（仅既有警告）；产物 CSS 抽查（token var、scale 属性编译、keyframes）通过。未跑全量 test/lint，未 commit。
- Blocker：无。
- 下一步：真机冒烟（弹窗/侧栏/按压 + 减弱动态效果降级）；后续第二批可做 toast/菜单展开/列表项 enter-exit 与大型功能弹窗（skills/GitGraph/ShareConversation）复用同名进入类。

---

## 1.10.2 发布状态（2026-09-04）

- 已由父 Agent bump 版本至 1.10.2；当前发布目标为用户确认纳入的 dev 分支全部待发布提交。
- 文档已更新；`npm run test`（273 files / 2602 tests）、`npm run lint`（0 error，1 个既有 warning）、`npm run build` 均已通过。
- qf-agent 测试夹具已最小修复：Windows `taskkill` mock 正确触发 exit，并在每个测试前恢复 real timers；定向测试 28/28 通过。
- runtime/offline 包已生成并复核，`package-offline/shawnstack-quickforge-1.10.2.tgz` 约 7.4 MB，包内版本为 1.10.2。
- v1.10.2 Git 发布已完成：release commit `40deadb`、tag `v1.10.2` 已创建，并已推送 `origin/dev`；npm publish 未执行。
- `pinned-summary-draggable-capsule` 当前仍为 needs-review，但已按用户确认纳入本次发布。

---

## 当前状态：dead-code-cleanup-round-1（已完成，未提交）

- 目标：清理僵尸代码——删除全仓库零引用的导出符号与遗留文件（仅高置信度项，删前逐符号复核）。
- 改动：前端 7 个文件（icons/workspace-api/workspace-types/api-cache/input-clamp/pi-chat/types）删 6 个零引用导出；server 13 个文件删 19 个零引用导出（skills.mjs 占 5 个旧包装）+ share-service.mjs 级联死链（jsonAdapter 只写变量与 configureShareService 的 json 参数、share-lifecycle 测试 json:null）；删除遗留文件 dev-server.log、3 张 oom-*.svg、artifacts/、design-preview/、tests/fixtures/ 5 个零引用 electron-smoke 脚本；文档同步 4 处（browser-cache-strategy、server wiki README、server utils wiki、feature_list browser-oom-first-aid files 数组）。
- 验证：`npm run test` 273 files / 2602 tests 全过；`npm run lint` 0 error（identity.mjs:92 既有 warning）；`npm run build` 通过；node --check 与 feature_list JSON parse 通过。未 commit。
- Blocker：无。
- 下一步（可选，未开始）：中置信度清理轮——约 200 项"仅文件内使用的冗余 export"可去 export 关键字；前端约 10 处"仅测试引用"的生产僵尸（message-queue/cloud-client/session-message-cache 等）需连测试一起评估；scripts/ 下 sqlite-synchronous-benchmark、prune-offline-package、session-index-query-benchmark 三个仅文档引用的一次性脚本可归档。注意勿删 restart/update-supervisor 与 maintenance/*-v1（运行时动态加载）。

---

## 当前状态：sidebar-collapse-zoom-width（已完成，未提交）

- 目标：修复桌面侧栏收缩后浏览器缩放/`window.resize` 重新写入展开宽度，以及收缩/移动清理遗漏遗留内联 `width` 的问题。
- 改动：`src/components/sidebar/ChatSidebar.tsx` 的 resize effect 增加 `if (isMobile || !sidebarOpen) return`；`finishResizing()` 无 `finalWidth` 时调用 `asideRef.current?.style.removeProperty('width')`。展开拖拽、reset、移动端语义保持不变。
- 测试：`tests/frontend/sidebar-section-order.test.ts` 新增源码契约，锁定 `!sidebarOpen` 守卫、resize listener 与 `removeProperty('width')` 清理。
- 文档：`docs/wiki/src/components/README.md` ChatSidebar 条目补充收缩态不会因 window.resize/浏览器缩放恢复展开宽度。
- 验证：定向 `npx vitest run tests/frontend/sidebar-section-order.test.ts` → 1 file / 20 tests 全过；相关 ESLint 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 通过（仅既有 KaTeX 字体与 chunk size 警告）；`git diff --check` 通过。
- Blocker：无。未新增依赖，未触碰生成产物，未 commit/tag/push；工作区其他未提交改动保留。

---

## 当前状态：manual-compact-adaptive-retention（已完成，未提交）

- 目标：实现主动 `/compact` 放宽方案：不看 80% 阈值，取消 1600 字符门槛，固定 `keepRecentTurns: 0`，直接压缩全部当前可压缩历史，不保留最近 n 轮；同时自动压缩设置默认 `keepRecentTurns: 0` 且支持 `0-20`；`/summary` 不变。
- 已改文件：`server/auto-compaction.mjs`（默认 `keepRecentTurns: 0`，设置归一化支持 `0-20`，保留 keep=0 tailStart 与 in-place 支持）、`server/agent-manager.mjs`（手动 compact 固定 `keepRecentTurns: 0` + `minSourceChars: 0`）、`server/conversation-compaction.mjs`（可选 `minSourceChars` 贯通短历史）、`src/lib/auto-compact-settings.ts`、`src/lib/default-options-settings-tab.ts`、`src/components/chat/ChatPanelHost.tsx`、`src/components/chat/panel-decoration/approval-card.ts`、`src/lib/i18n.ts`、相关测试、Wiki 与状态文件。
- 当前验证：定向 Vitest 6 files / 39 tests 全部通过；相关 ESLint、`node --check server/auto-compaction.mjs`、`npx tsc -b --pretty false`、`npm run build`、`git diff --check` 与 `feature_list.json` JSON parse 均通过。build 仅有既有 KaTeX 字体与 chunk size 警告。
- Blocker：无。当前未补 agent-manager 契约测试，入口仅固定传入 keep=0 和 0 门槛，核心行为由 tail 边界与压缩器测试覆盖。

- 边界：不改 `/summary`，自动压缩的阈值、字符门槛、确认、间隔与保护逻辑保持不变，仅调整 `keepRecentTurns` 默认值为 0 并开放 0；不触碰生成产物、不新增依赖、未 commit。

---

## 当前状态：known-exception-i18n（已完成，未提交）

- 目标：用户实测「错误：Request was aborted.」英文原文，要求把已知的代码异常做好国际化。
- 实现：新增 `src/lib/error-messages.ts`（translateErrorMessage 规则表：pi-ai 'Request was aborted'/流异常结束、ai-http-logger 'AI stream idle/total timeout after Nms'、undici 'fetch failed'、server-agent 'Failed to send prompt: HTTP N' → i18n key，ms/status 插值，句点/大小写/空白容忍，未匹配透传）；展示层两处接入——message-actions.ts `decorateAssistantErrorText` 改写 pi-web-ui 错误红块动态文本（保留 strong、dataset 幂等、译文===原文不改写）、local-tools.ts subagent 错误原因卡（renderSubagentRunBody，聊天摘要卡与 Inspector 共用）；i18n 中英 +7 key。数据层保持英文原文（持久化/去重/trace 去重依赖），服务端零改动。
- 验证：定向 vitest 6 files / 193 tests 全过（error-messages 新建含映射与接线契约）；eslint 5 文件 0 error；tsc -b；npm run build ✓（仅既有警告）。未跑全量 test/lint。
- 文件：src/lib/error-messages.ts（新）、src/lib/i18n.ts、src/lib/local-tools.ts、src/components/chat/panel-decoration/message-actions.ts、tests/frontend/error-messages.test.ts（新）、docs/wiki/src/lib/README.md、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。边界：动态正文（provider 错误、OpenCode ACP、subagent 超时复合句）不在映射表原样显示；规则表按需追加；未 commit、未触碰生成产物。
- 下一步：真机冒烟（中文下中止/超时/发送失败错误的本地化显示，英文界面不变，未知错误仍原文）。注：本会话稍早完成的 error-continue-retry-button（错误旁继续按钮）也未提交。

---

## 当前状态：todo-summary-completed-icon-emerald（已完成，未提交）

- 目标：用户反馈「对话上方的 todo 显示，完成的 icon 换一下绿色的，和摘要的保持一致」——把对话顶部 todo-write-summary 行级完成项图标由灰色改为与置顶摘要（GitToolsPinnedSummary 的 CheckCircle2 + text-emerald-600）一致的绿色。
- 实现：仅 `src/index.css`——`.quickforge-todo-summary-item--completed .quickforge-todo-summary-status-icon` color 从 `var(--muted-foreground)` 改为本组件「全部完成」圆环对勾既有 emerald 配方（light `rgb(4 143 101)`，新增 `html.dark` 变体 `rgb(110 231 183)`，复用 slash agent chip 语义色不新增颜色体系）；完成项文字保持 muted+删除线；ring-check 上方注释措辞同步。`tests/frontend/todo-write-renderer.test.ts` emerald 契约用例扩展断言行级完成项图标 light/dark 绿色。
- 验证：定向 vitest todo-write-renderer 10 tests 全过；回归 todo-write-summary 26 + git-tools-pinned-summary 24 全过；eslint 测试文件 0 error（css 被 lint 配置忽略）；feature JSON parse；`npm run build` 通过（仅既有 chunk size 警告）。纯 CSS 改动未跑 tsc/全量。
- 文件：src/index.css、tests/frontend/todo-write-renderer.test.ts、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。边界：不改图标形状/完成项文字样式/in_progress/pending 图标与置顶摘要本体；无架构变化故 wiki 未更新（纯视觉微调）；未 commit、未触碰生成产物。
- 下一步：真机复核 light/dark 下对话上方 Todo 摘要完成项绿色图标与置顶摘要一致。

---

## 当前状态：error-continue-retry-button（已完成，未提交）

- 目标：用户希望「在错误的旁边设计一个重试按钮」；调研给方案后用户确认改语义为「重试 = 发送一条继续用户消息」（保留失败轮部分进度、不重放工具副作用），并要求处理 HTTP 层发送失败与 continue 语义不符的问题（重发原始消息）。
- 实现：`message-actions.ts` 终态错误（会话最后一条消息为 stopReason:'error' assistant 错误）挂常显弱化操作行（runIcon「继续生成」icon-only + 时间戳，无 hover 依赖；创建/快路径两处管理；历史错误与流式中不显示；门控 allowRetry/readOnly/historyActionsDisabled）；`ChatPanelHost.tsx` 接 `onContinueAfterError`（stash 优先 retryFailedPrompt，否则 prompt(t('errorContinueMessage'))）；`server-agent.ts` prompt HTTP 失败合成错误时挂客户端专用 `quickforgeFailedPrompt`，新增 `retryFailedPrompt`（预置 stash 的 capabilities/contextReferences 回 nextPrompt*、移除错误条目后原样重发）；i18n 中英 +2 key。安全前提（已核验）：pi-ai transform-messages 整条跳过 error/aborted assistant 消息、孤儿 toolCall 自动合成 toolResult，「继续」链路与用户手动打字恢复同路径。
- 验证：定向 vitest 3 files / 84 tests 全过（message-actions 新增 10 用例、server-agent 新增 4 用例、i18n snapshot）；回归 3 files / 32 tests；eslint 6 文件 0 error；tsc -b；npm run build ✓（仅既有警告）。附带修复 message-actions.test.ts 假 DOM harness querySelectorAll 的文档顺序问题。未跑全量 test/lint。
- 文件：src/components/chat/panel-decoration/message-actions.ts、src/components/chat/ChatPanelHost.tsx、src/lib/server-agent.ts、src/lib/i18n.ts、tests/frontend/message-actions.test.ts、tests/frontend/server-agent.test.ts、docs/wiki/src/components/README.md、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。边界：仅终态错误有按钮；OpenCode/Side Chat/readOnly 沿用现有门控（OpenCode 的 prompt 语义支持留作后续）；错误消息不进 LLM 上下文；消息队列 error 暂停行为不变；未 commit、未触碰生成产物。
- 下一步：真机冒烟（错误→▶ 按钮→「继续」消息从失败前进度接着做；断网发送失败→重发原始消息含插件/文件 chip；流式禁用；OpenCode 无按钮）。

---

## 当前状态：sidebar-drag-vertical-boundary（已完成，未提交）

- 目标：用户反馈「项目和任务拖动的时候注意不能无限向下拖动」——限制侧栏拖拽的纵向边界。
- 根因：项目条目拖拽已有 clamp（restrictProjectDragToViewport，d07f18a），但 72ac7e0 后加的「项目/任务」顶层区块标题拖拽（section DndContext）没有 modifier，`SortableSidebarSection` 仅锁横向，纵向 transform 无界。
- 实现：`ChatSidebar.tsx` 新增 `sectionsDragBoundaryRef`（区块排序容器 div）+ `sectionDragStartScrollTopRef`（dragStart 记录起始 scrollTop）+ `restrictSectionDragToViewport` modifier（复用 `src/lib/project-drag-boundary.ts` 的 visibleProjectDragBoundary/clampProjectDragTransform，含滚动补偿），接入区块 DndContext `modifiers`；区块拖拽预览夹取在区块容器与共享滚动视口的可见交集内。`clampProjectDragTransform` fallback 收紧 fail-closed：rect 缺失/退化时 x/y 同时锁定（原仅锁横向、纵向无界），两条拖拽路径共用。
- 验证：定向 vitest 4 files / 37 tests 全过（fallback 用例改写 + 新增区块边界 wiring 契约 + ChatSidebar 回归）；eslint 4 文件 0 error；tsc -b；npm run build 通过（仅既有警告）。未跑全量。
- 文件：src/components/sidebar/ChatSidebar.tsx、src/lib/project-drag-boundary.ts、tests/frontend/project-drag-boundary.test.ts、tests/frontend/sidebar-section-order.test.ts、docs/wiki/src/components/README.md、docs/wiki/src/lib/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。边界：section autoScroll 仍为 false、KeyboardSensor 不受影响；dnd-kit 碰撞检测用 modifier 后 transform，落点同步受限；未 commit。
- 下一步：真机冒烟（区块标题向下拖停在可见区底部、向上不越过 Pinned、换位正常；项目条目拖拽回归）。

---

## 当前状态：subagent-timeout-structured-progress（已完成，未提交）

- 目标：① 用户反馈「错误原因: Subagent general timed out after 60 minutes.」超时报错只有一行纯文本，要求报错时把 subagent 已完成工作结构化输出（父模型能大概知道做了什么）；② 子 Agent 默认超时改为 2 小时。
- 实现：`server/agent-manager.mjs`——超时错误首句不变，其后追加 `Progress before timeout: N tool calls; still running: …; last assistant message: …`（工具计数、pending×消息交集的被中断工具名、lastAssistantText 截断 600 字符）；抛错前把与成功终态同构的 `quickforgeSubagentDetails`（含 `timedOut:true`、全量 messages）挂到 error；`wrapSubagentToolDefinition.execute` catch 后按 toolCallId 存入模块级 stash（即取即删 + 6h TTL）；主 Agent 构造点新增 `afterToolCall` 把 stash 注入错误 toolResult.details 持久化（前端 `details.timedOut→error` 既有判定生效，UI 零改动）。超时默认/上限：`SUBAGENT_DEFAULT_TIMEOUT_MS`/`SUBAGENT_MAX_TIMEOUT_MS` = 2 小时（两处 clamp），`server/subagents.mjs`（内置 explore/general + markdown 回落）、`server/agent-profiles.mjs`、`server/agent-profile-files.mjs` 默认值同步上调。Revision：父运行中止复用同一机制——`aborted with parent run.` 首句 + `Progress before abort:` 摘要，details 以 `aborted:true` 注入（用户停止后 toolResult 持久化、下一回合模型可见、刷新后 Inspector 保留 trace）；摘要分段抽为 subagentProgressSegments、终态 details 抽为 buildTerminalSubagentDetails 闭包共用。Revision 2：内层 catch 为所有未携带 details 的运行期失败（模型流错误等）统一挂同构 quickforgeSubagentDetails（无标记、错误正文保持上游原文以维持 stripTerminalErrorFromTrace 去重），修复"只要报错就看不到执行过程"；外层失败（prompt 前无进度）不挂。
- 验证：Revision 2 复验 2 files / 106 tests 全过（新增通用失败用例与前端恢复契约；父中止用例锁定 aborted 正文/details/注入）；此前定向 5 files / 121 tests、回归 agent-manager.* 9 files / 31 tests + routes/agent 16 tests；eslint 0 error；node --check；`npm run build` 通过（仅既有 chunk 警告）。未跑全量 test/lint。
- 文件：server/agent-manager.mjs、server/subagents.mjs、server/agent-profiles.mjs、server/agent-profile-files.mjs、tests/server/agent-manager.subagents.test.mjs、tests/frontend/subagent-run-detail.test.ts、docs/wiki/server/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。边界：外层失败（模型解析/工具创建等 prompt 前）无进度不挂 details；旧持久化空 details 无法回溯补全；日志仍只记元数据；scheduled-tasks runtimeLimitMs 与 run_command 1h 为独立语义未动（见 progress Notes）；未 commit、未触碰生成产物。
- 下一步：真机冒烟（超时后父 Agent 能转述部分进度、摘要卡错误原因显示进度、刷新后 Inspector 仍可见完整 trace）。

---

## 当前状态：pinned-summary-draggable-capsule（普通任务置顶摘要一致性验收修订，needs-review，本次修订已提交）

- 目标：修复普通 global 会话虽具备 `todo_write`，但基础提示词只在 `For project tasks:` 语境指导使用，导致普通任务置顶摘要不一致的问题；不让无内容入口常驻。
- 实现：`server/system-prompt.mjs` 仅把 `todo_write` 通用规则移到 `For project tasks:` 之前，文案、权限与项目任务其他规则不变；所有具备该工具的非简单多步骤任务现在均适用。
- 测试：`tests/server/system-prompt.test.mjs` 改为结构性契约——规则必须存在且索引早于 `For project tasks:`，该专属段之后不得再包含规则，全文只出现一次。
- UI/文档：未改 `App.tsx` 或 `GitToolsPinnedSummary.tsx`，继续按实际 Todo/Git/Subagent 内容挂载，无内容不显示入口。`docs/wiki/server/README.md` 与 `docs/wiki/src/components/README.md` 仅同步本次作用域和空态边界。
- 验证：`npx vitest run tests/server/system-prompt.test.mjs` → 1 file / 7 tests 全过；`npx eslint server/system-prompt.mjs tests/server/system-prompt.test.mjs`、`node --check server/system-prompt.mjs`、`feature_list.json` JSON parse、`git diff --check` 全过。
- 文件：`server/system-prompt.mjs`、`tests/server/system-prompt.test.mjs`、`docs/wiki/server/README.md`、`docs/wiki/src/components/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Blocker：无。边界：feature 保持 needs-review；未改前端契约、未新增依赖、未触碰生成产物；本次修订已提交，临时未跟踪文件已清理。
- 下一步：普通全局会话真机发起非简单多步骤任务，确认 Todo 产生后既有置顶摘要出现；无 Todo 时入口仍隐藏。

---

## 当前状态：diff-display-optimization（最终视觉收口，done，未提交）

- 目标：按用户连续反馈把 `write_file` / `edit_file` 工具 Diff 收敛到极简：`+N/−N` 仍有颜色区分，正文只显示一列智能行号，并减少说明性文字；不改通用过程折叠。
- 实现：摘要统计改为默认可见静态彩色文字（`+N` 绿色、`−N` 红色），无 badge/背景/边框；删除 `diff-counter` 里程计模块、自定义元素、动画和对应测试。展开区删除重复标题/路径/统计 chip 与字符级 token/LCS/mark；正文采用单列智能行号（del=oldNo、add=newNo、ctx=newNo），共享 grid 为“行号 + 代码”两列，保留浅色整行背景和长行横向滚动；gap 可见内容仅为 `⋯`。状态短文案为“新文件 / 已截断 / 无变化”。
- Partial/OpenCode：count-only partial 仅显示摘要计数，无完整 text 不渲染正文。`parseDiffRows` 支持标准 unified、OpenCode 无 hunk pseudo-unified 与 raw；raw 不丢首字符且从 1 编号。OpenCode 服务端统一换行、修正尾随换行统计和相同内容语义，真实截断设置 `truncated:true`；尾 marker 仅在显式 truncated 时移除，合法正文不误删。
- 文件：`src/lib/local-tools.ts`、`src/lib/diff-view.ts`、`src/index.css`、`src/lib/i18n.ts`、`server/opencode-acp-agent.mjs`、`tests/frontend/diff-view.test.ts`、`tests/server/opencode-acp-agent.test.mjs`、`docs/wiki/src/lib/README.md`；删除 `src/lib/diff-counter.ts`、`tests/frontend/diff-counter.test.ts`；同步三个状态文件。
- 验证：此前全量 `npm run test` 272 files / 2559 tests 全过；本轮最终视觉收口定向 Vitest 5 files / 119 tests 全过；定向 ESLint 4 文件 0 error；`npx tsc -b --pretty false`、`npm run build`、`git diff --check` 全过。build 仅既有 KaTeX/chunk warnings。
- Blocker：无。未 commit/tag/push，未新增依赖，未手改生成产物；工作区仍有其他 feature 的未提交改动，提交时需按 feature/片段拆分。
- 下一步：真机冒烟 light/dark、edit/write、新建空文件、长行横向滚动、OpenCode raw/pseudo-unified；若视觉符合预期即可结束，无需再改架构文档。历史设计稿不代表当前规格，当前以源码与 Wiki 为准。

---

## 当前状态：pinned-summary-draggable-capsule（desktop stay + 向下展开，needs-review，未提交）

- 目标：desktop panel/capsule 外点均保持，Escape 无摘要动作；仅显式 Minimize 进入 capsule，capsule 主体打开 panel，X/List 完全关闭；capsule→panel 保持同一 top 向下增长。mobile/mobileShell 原 overlay close 行为不变。
- 实现：`pinned-summary-drag.ts` 的 outside API 简化为 desktop `stay` / mobile `close`，删除 desktop minimize action；组件结构上仅 `!desktopDraggable` 时安装 outside pointerdown/Escape listener。desktop `minimizeDesktopPanel` 仅接在 panel Minimize；两种 X 与 List 走 `closeSummary`。branch menu 不因摘要外点改变形态。
- 布局：新增 `resolvePinnedSummaryLayout`，12px viewport inset，`PINNED_SUMMARY_PANEL_MIN_HEIGHT=180`。panel 优先保留 position.y，动态 max-height=`viewport bottom inset - y`，内容区继续 flex + `overflow-y-auto`；只有下方不足 180px 才上移到刚好容纳该高度，极矮 viewport 用全部安全区域。首次锚点、形态切换、resize、drag 过程/结束、Inspector resume 复用该策略；header rect 只在首次无 position 时读取。
- CSS/测量：widget inline CSS 变量传 `--quickforge-pinned-summary-panel-max-height`，且 `panelMaxHeight` 只在 panel mode 更新/消费；panel 展开态用 `scrollHeight + (offsetHeight - clientHeight)` 记录含边框自然高度，避免 2px morph 误差。`ResizeObserver` 在拖动中以 `dragRef.current.current` 解析 panel 布局，不再用拖动起点 `positionRef` 覆盖 max-height；结束/取消继续由 `finishDrag` 收敛。删除无效 `height: min(max-content, ...)`，依赖 auto + max-height/widget 变量。panel 内容区始终 `overflow-y-auto overscroll-contain`；desktop branch menu 在受限 panel 内向下展开、宽度随 panel、设置 viewport 约束 max-height 与自身滚动，不再切换整个内容区为 overflow-visible。panel/capsule `transform-origin: top right`，width/height 220ms 和 reduced-motion 保留。
- 图标：按用户确认的原型推荐 B，capsule 主体末端由 `ChevronUp` 改为 `Maximize2`，与 panel 标题栏现有 `Minimize2` 配对。图标位于主体 button 内约 28px 透明圆形视觉槽（`aria-hidden`、非独立 button），默认弱化，仅随主体 hover/focus 用现有 Tailwind `group-*` 克制增强；顶部 `List`、独立 `X` 及全部点击/拖动/关闭链路不变，不新增 CSS 模式。
- 测试：`pinned-summary-drag.test.ts` 真实覆盖 desktop/mobile outside、top 保持、自然高度超限、必要上移、极矮 viewport；`git-tools-pinned-summary.test.ts` 锁定 desktop 无 outside/Escape listener、mobile close、Minimize 唯一收缩、capsule `Maximize2` 非独立提示槽、X/List close、动态 max-height/top transform-origin、resume 复用布局。Inspector/mobile 回归保留。
- 文档：components/lib wiki 已同步；design mockup 与当前语义差异较大，保留为历史稿，本轮不做小修，源码/wiki 为准；无新视觉模式，DESIGN_LANGUAGE 不改。
- 验证：图标终审后定向 `npx vitest run tests/frontend/git-tools-pinned-summary.test.ts` → 24 tests 全过（`Maximize2`/`Minimize2` 配对、约 28px 非 button/`aria-hidden` 槽、独立 X、无 `ChevronUp`）；定向 ESLint 2 文件 0 error；`npx tsc -b --pretty false`、`npm run build`、feature JSON parse、`git diff --check` 全过。此前终审修复 5 files / 52 tests 与 ESLint 4 文件结果继续有效；build 仅既有 KaTeX/chunk warnings，生成产物无 Git 状态变化。
- Blocker：无。边界：feature 保持 needs-review；未提交/tag/push、未手改生成产物；其他未提交 feature 改动保留。
- 下一步：完成最终门禁，真机复核 desktop 外点/Escape stay、Minimize 唯一 panel→capsule、capsule 展开 top 不上浮且下方内容滚动；通过前不标 done。

---

## 当前状态：pinned-summary-draggable-capsule（首次 header 锚点调整，needs-review，未提交）

- 目标：仅修改无历史位置的首次 desktop 锚点，使胶囊/面板默认出现在主对话顶部栏下方、从主内容右缘内缩，不遮挡顶部栏；拖动与 Inspector 恢复语义不变。
- 实现：`App.tsx` 为主对话 `<header>` 增稳定 `conversationHeaderRef: RefObject<HTMLElement | null>`，以 `initialAnchorRef` 传入摘要；`pinned-summary-drag.ts` 新增纯函数 `resolvePinnedSummaryInitialPosition`，使用 `PINNED_SUMMARY_INITIAL_GAP=10` / `PINNED_SUMMARY_INITIAL_RIGHT_INSET=12`，首次坐标 `y=ceil(header.bottom)+10`、`x=header.right-targetWidth-12`，header 不可用时先回退 toolbar root rect，toolbar root 也不可用时再回退 widget rect，最终仍按 12px viewport 安全区 clamp。
- 生命周期：header rect 仅在 desktop mounted 且 `positionRef.current` 不存在的分支读取一次；用户拖动后、panel/capsule 形态切换、resize、Inspector suspend/resume 都只 clamp 当前 position，不重新锚定。mobile/mobileShell 不变；无 querySelector/Tailwind selector，无 28/32/56 titlebar 定位魔法常量。
- 测试/文档：纯函数测试覆盖 header bottom+gap/right inset 与传入 fallback rect；源码契约覆盖 ref 接线、conversation header → toolbar root → widget rect 回退顺序、单次读取、Inspector resume 不重锚。components wiki 两处与 lib wiki 已同步；DESIGN_LANGUAGE 无需改。
- 验证：定向 Vitest 5 files / 48 tests 全过（pinned summary 32 + Inspector/mobile 回归 16）；定向 ESLint 5 文件 0 error；`npx tsc -b --pretty false`、`npm run build`、feature JSON parse、`git diff --check` 全过。build 仅既有 KaTeX 字体与 chunk size warnings，生成产物无 git 状态变化。本次 fallback 措辞收尾另跑相关 Vitest 2 files / 32 tests、feature JSON parse、`git diff --check` 全过；按要求未再次 build。
- 文件：`src/App.tsx`、`src/components/git/GitToolsPinnedSummary.tsx`、`src/lib/pinned-summary-drag.ts`、两份 frontend 测试、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- Blocker：无。边界：未新增依赖/持久化，未触碰生成产物，未 commit；工作区其他 feature 的未提交改动保留。
- 下一步：用户真机复核首次 panel/capsule 位置；通过前 feature 保持 needs-review。

---

## 当前状态：browser-oom-first-aid（已完成，未提交）

- 目标：用户确认"页面一直开着导致 OOM"发生在浏览器渲染进程；调研定位后按用户决策"两步走"完成第一步零体验风险止血（IndexedDB 缓存去全量序列化/物化 + subagent 运行期 trace 截尾），体验无损。
- 调研结论：浏览器侧 OOM 主因为消息只增不减 + DOM 无窗口化全量渲染（ChatPanelHost.tsx:600 `createMessageWindow({enabled:false})` 禁用了窗口化；pi-web-ui MessageList 无原生虚拟化，code-block base64 属性 + hljs span 树放大多份驻留）；高频放大器为 IndexedDbCache 每次 put 全量 JSON.stringify + 每次 evict getAll 全量物化，以及 run_subagent trace 每 150ms 全量 messages 重发（O(N²)）。三张分析图：oom-analysis-diagram.svg / oom-browser-renderer.svg / oom-plain-words.svg（工作区根目录）。
- 实现：① src/lib/indexeddb-cache.ts — estimateBytes 递归粗估（string length+2、number 8、布尔空 4、节点 +2/键 +1、深度 16 + seen 防循环、异常 0）；实例私有 metaIndex（null 起步，首次 evict 单次 getAll 重建后纯内存维护，put/get 写回成功/delete/clear 同步，非数组容错）；磁盘格式/LRU/API/schema 零改动。② server/agent-manager.mjs — SUBAGENT_TRACE_MESSAGES_LIMIT=50，emitSubagentTrace details.messages=slice(-50)+messagesTotal（全部 update 路径统一），终态 toolResult（:1799）全量不动。前端消费方只依赖尾部，运行中 Inspector 最近 50 条、结束全量恢复。
- 验证：定向 vitest 5 files / 47 tests 全过（新增 3：getAllCallCount===1、冷启动重建淘汰、MockAgent 真实驱动 61 条消息窗口 50/total 61/终态 61）；ESLint 4 文件 0 问题；node --check；tsc -b；git diff --check；feature JSON parse。explore 独立复核 26/26 复跑通过（索引生命周期闭环、无 off-by-one、终态未截尾、前端无全量假设）。
- 文件：src/lib/indexeddb-cache.ts、server/agent-manager.mjs、tests/frontend/indexeddb-cache.test.ts、tests/server/agent-manager.subagents.test.mjs、docs/wiki/src/lib/README.md、docs/wiki/server/README.md、三张 SVG、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。边界：未跑全量 test/lint/build；未 commit；唯一可感知差异为运行中刷新页面恢复的 running 快照只含尾部 50 条（终态后全量恢复）；多 tab 依赖现有 Web Locks 单窗口守卫（与改动前等价）。
- 下一步：① 建议真机长会话 + 长 subagent 运行观察渲染进程内存曲线确认止血效果；② 第二步"智能货架"（恢复消息窗口化 + turn 导航/跳转/decorate/process-folding 适配）另行立项，立项时先 explore windowed-messages.ts 能力边界与全量 DOM 依赖面；③ 工作区仍有多批并行会话未提交改动（pinned-summary Revision 3 已复核通过待 commit、project-picker、subagent UI 族、p0-subagent-observability 等），commit 时按 feature 拆分。

---

## 当前状态：project-picker-mkdir-and-roots（已完成，未提交）

- 目标：项目目录选择器「快捷入口」移除 QuickForge 安装目录入口，并新增「新建目录」功能（当前路径行右侧按钮 + 内联输入，成功后直接进入新目录；端点不加 local-only 守卫，Android 远程客户端可用）。
- 实现：`server/routes/filesystem.mjs`（172 行）删 `addRoot('QuickForge', ...)`、提取 `isPathWithinRoots`/`getAllowedRootPaths()`、新增 `POST /api/filesystem/mkdir`（400/403/404/409 校验链，mkdir recursive:false）；`src/components/project-directory-picker.tsx` 新建按钮 + 内联输入 form + creatingFolder 禁用传播；`src/lib/i18n.ts` +4 key 中英成对；新建 `tests/server/routes/filesystem.test.mjs`（12）与 `tests/frontend/project-directory-picker.test.ts`（9 契约）；wiki server/routes（修正过时 list→directories、补 mkdir）与 src/README picker 条目同步。
- 验证：定向 vitest 2 files / 21 tests、ESLint 5 文件 0 error、node --check、tsc -b、git diff --check 全过；未跑全量 test/lint/build；未 commit。
- 文件：server/routes/filesystem.mjs、src/components/project-directory-picker.tsx、src/lib/i18n.ts、tests/server/routes/filesystem.test.mjs（新）、tests/frontend/project-directory-picker.test.ts（新）、docs/wiki/server/routes/README.md、docs/wiki/src/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。Notes：① assertDirectory 原生抛 400，本端点内映射为 404（父目录不存在语义），共享函数未动；② Windows 越界 403 测试为条件用例（需存在未挂载盘符），POSIX 跳过已注释说明；③ 工作区另有 pinned-summary-draggable-capsule（needs-review）等未提交改动及 oom-analysis-diagram.svg 未跟踪文件，与本 feature 无关，commit 时需分开。
- 下一步：真机冒烟（快捷入口无 QuickForge；新建目录全流程：成功进入/重名 409/非法名 400/失败保留输入行；创建期间禁用态）。

---

## 当前状态：pinned-summary-draggable-capsule（已完成，用户复核通过，Revision 3 未提交）

- 目标：保持既有顶部 List + desktop closed/capsule/panel 三态与可靠拖动，并修复打开/关闭右侧 WorkspaceInspector 后摘要状态与位置丢失。
- 实现：App 以与 Inspector 相同的 `(min-width: 1024px)` 判定 `canSuspendPinnedSummaryOnInspectorOpen`（未来打开 Inspector 是否具备 desktop sidebar suspension/preserve 能力），仅 `workspaceInspectorOpen && capability` 时继续挂载摘要并传 `suspended`；`<1024px` 和 `mobileShell` 保持原卸载与 fullscreen overlay。PanelRight 直接打开、Git Changes/智能体入口统一按该 capability 分支：真实桌面保留 panel，窄屏/mobileShell 在打开 Inspector 前先关闭摘要；PanelRight 关闭分支不改 summary；Commit/Push 始终关闭。suspended 保留 panel/capsule/position、Todo 展开和智能体折叠；toolbar root 与 desktop widget 同时 `hidden` + `inert` + `aria-hidden`。
- 暂停清理：暂停时 outside pointerdown/Escape、resize/clamp、ResizeObserver/形态定位均不运行；进入暂停只结束 drag，清 window pointer move/up/cancel、capture、body userSelect、drag/responsive rAF，关闭 branchMenu 和 pending focus。不会取消已代表用户明确关闭意图的 160ms close timer，也不使用可被 cleanup 取消的 rAF 去归一化 closing/mounted；timer 在隐藏期间自然完成 `closed => unmounted`。组件最终 unmount 时既有 cleanup 仍清 timer。不清其余持久逻辑状态、不自动回焦。恢复时用当前 panel/capsule 目标布局尺寸按 12px 安全区重新 clamp 原 position，不调用 open/minimize、不聚焦。
- 竞态/路径：PanelRight 按钮提供 `data-pinned-summary-inspector-toggle=true` marker，summary document pointerdown 无条件优先忽略，desktop 避免 panel 先 outside→capsule；小屏/mobileShell 的 onClick 打开分支会显式关闭摘要。键盘 Button 激活走同一 click。desktop Git Changes/Subagent 打开 Inspector 保留 panel，`<1024px`/mobileShell overlay 路径仍先关闭；Commit/Push 仍先关闭。
- 测试边界：`pinned-summary-drag.test.ts` 为真实纯函数测试（suspension 判定、future capability 的 desktop preserve/mobile close、clamp/outside/4px threshold）；`git-tools-pinned-summary.test.ts` 为源码契约测试（PanelRight 打开 desktop preserve/mobile close、关闭不改 summary、摘要 action 条件接线、hidden/inert/aria-hidden、suspension 不清 close timer/不归一化 closing/mounted、unmount 仍清 timer、marker、恢复 clamp、focus cleanup），不是 React 挂载交互测试。
- 文件：`src/App.tsx`、`src/components/git/GitToolsPinnedSummary.tsx`、`src/lib/pinned-summary-drag.ts`、两份相关测试、`tests/frontend/todo-write-renderer.test.ts`（提交门禁修复 CSS 提取上界）、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`（对齐检查补 pinned-summary-drag 条目）、`feature_list.json`、`progress.md`、`session-handoff.md`。suspension 轮未改依赖/i18n/CSS/设计稿/生成产物（i18n/index.css 的未提交改动属本 feature 更早轮次，一并入库）。
- 验证：Revision 3 最终收口相关 Vitest 8 files / 165 tests 全过（summary 23、drag 6、Inspector tabs/width/request、mobile fullscreen、side chat、subagent detail）；定向 ESLint（App/摘要组件/纯函数/两测试）0 error；`npx tsc -b --pretty false`、`npm run build`、feature JSON parse、`git diff --check` 全过，`git status` 仅有本 feature 的 10 个预期文件。build 仅既有 KaTeX/chunk warnings，未改生成产物。前轮完整 npm test/lint 记录不变：2530 passed + 1 个 HEAD 同样失败的 qf-agent-process 定时器用例、lint 0 errors。
- Blocker/Risk：无；用户已按真机验收矩阵复核通过。
- 真机矩阵：closed→sidebar→closed（含 closing 160ms 竞态无幽灵 capsule）；capsule 拖后原位恢复；panel 拖后原位恢复且 Todo/智能体折叠保持；PanelRight 鼠标/键盘不预先 minimize；desktop Git Changes/Subagent 打开并关闭后 panel 恢复；`<1024px`/mobileShell 同路径关闭后不自动重开；Commit/Push 关闭；隐藏时 Escape/外点/resize 不改状态；drag 中打开 Inspector 后监听/capture/userSelect/rAF 全清；视口变化后恢复保持 12px 安全区且不抢焦点。
- 下一步：无；用户复核通过已收尾。基线实现已在 `639aef4`，本次 Revision 3 修复未 commit、未 push。

---

## 当前状态：p0-subagent-observability（已完成，未提交）

- 目标：实现 P0 Subagent 可观测性，不改 timeout 语义、UI 或 SSE 协议，不记录用户/模型/工具正文。
- 实现：① `server/agent-manager.mjs` 透传 `run_subagent` toolCallId；profile/task/workspace/model 等前置校验通过后立即生成 subagentSessionId 并记录 started，模型解析、工具创建、system prompt、Agent 构造或 prompt 任一失败由终态守卫只记录一个 failed；timeout_triggered/parent_aborted/settled_after_abort/completed 语义不变，关联父/子 session、toolCallId、subagent、timeout/duration/toolCalls，abort 后 settle 记录等待耗时和 outcome。② `server/ai-http-logger.mjs` 增仅内部 `quickforgeInternalLogContext` 白名单提取，Provider 前删除，AI stream retry/timeout 带 Subagent 关联字段。③ `server/routes/agent.mjs` 为 session/global SSE 写失败和 socket error 增结构化 WARN，并以连接级幂等守卫确保一次故障只 WARN 一次、cleanup/release/end 一次；正常 close 不记 failure；初始 session state 写失败 release，日志不带 payload，协议保持。④ agent-manager 测试真实调用 MockAgent streamFn 锁定内部上下文接线，新增 Agent 构造初始化失败日志用例；SSE 测试补重复 error 幂等断言。
- 验证：`npx vitest run tests/server/agent-manager.subagents.test.mjs tests/server/ai-http-logger.test.mjs tests/server/routes/agent.test.mjs` → 3 files / 47 tests 全过（10+21+16）；定向 ESLint 6 个相关源码/测试文件 0 error；`node --check server/{agent-manager,ai-http-logger}.mjs server/routes/agent.mjs` 通过；`git diff --check` 通过。未跑全量 test/lint/build；未 commit。
- 文件：`server/agent-manager.mjs`、`server/ai-http-logger.mjs`、`server/routes/agent.mjs`、三份对应测试、`docs/architecture/logging-design.zh-CN.md`、`docs/wiki/server/README.md`、三个状态文件。
- Blocker：无。边界：不记录 task/context/expectedOutput/messages/system prompt/tool args/results/profilePath/完整错误正文；不修 timeout/abort settle 语义；无前端/协议改动，故无需 src/lib/routes Wiki。
- 注意：工作区已有未提交 Subagent UI 改动及未跟踪设计稿/异常文件，本 feature 未改写；提交时需按文件/片段拆分（本轮用户明确不要 commit）。
- 下一步：可选真机观察日志链和断线时单连接仅一次 SSE WARN/cleanup。

---

## 当前状态：subagent-running-icon-badge（已完成，未提交）

- 目标：将 Composer「完全访问权限」旁的 Subagent 运行指示器由「绿色 spinner+数字+运行中」胶囊改为静态 Bot 图标 + 右上角 emerald 数量角标（用户确认：无动画、角标绿色），并修复悬停展开的智能体列表时界面闪烁（根因：renderMenuItems 每轮 decorate 全量 replaceChildren 重建菜单项；Lit 重建 leftControls 时 trigger 换新导致旧菜单被整体拆除）。
- 实现：trigger 子结构改为 icon（内联 Bot SVG）+ badge（数量），按类名复用 DOM 仅更新数字，删除 TriggerLabel 文案；Bot SVG 与项目 lucide-react v1.11.0 Bot 节点及聊天 run_subagent 摘要卡（local-tools.ts:539）完全同款（天线+方头+双耳+双眼，14×14，currentColor）——Revision：初版误用 lucide 旧版 bot path，用户反馈「机器人 icon 不对，应复用智能体的 icon」后对齐，vitest/eslint/tsc 复验通过。`renderMenuItems` 改按 runId 就地 diff（heading/list 复用、字段仅变化时更新、insertBefore 仅乱序移动、消失 runId 删除），hover 元素身份稳定不闪断；trigger 新建时不再拆菜单，同步 `__quickforgeOwnerTrigger` 为新 trigger 并继续 renderMenuItems，dismiss/positionMenu 改读菜单当前 ownerTrigger；CSS trigger 改 relative/2rem/padding 0，删 spinner/count 样式，新增 icon/badge（badge 参照 scroll-bottom-badge，emerald + dark 变体），移动端/compact 的 label 规则随 label 删除；i18n 删 TriggerLabel（en/zh）；测试更新断言并新增 3 个防回归用例（item 身份保持、runId 增删排序、trigger 重建菜单保留）。
- 验证：定向 Vitest 3 files / 109 tests；定向 ESLint（ts）0 error（css 被配置忽略）；`npx tsc -b --pretty false`；`npm run build`（仅既有 KaTeX/chunk 警告）；JSON parse；`git diff --check` 全过。未跑全量 test/lint；未 commit。
- 文件：`src/components/chat/panel-decoration/subagent-running-indicator.ts`、`src/index.css`、`src/lib/i18n.ts`、`tests/frontend/subagent-running-indicator.test.ts`、`docs/wiki/src/components/README.md`（L20 目录树注释 + L88 详述条目）、三个状态文件。
- Blocker：无。边界：静态图标无动画；未改后端/公共入口/生成产物；未新增依赖。
- Revision（文案）：TriggerAria/MenuTitle/MenuAria 改更简短且中文统一「智能体」——「{count} 个智能体运行中」「智能体运行中 · {count}」「智能体运行中」，英文 '{count} agents running'/'Agents running · {count}'/'Agents running'；复验 vitest/eslint/tsc 通过。
- 下一步：用户复核视觉（Bot 图标、emerald 角标、Light/Dark）；真机冒烟流式期间 hover 菜单不闪、leftControls 重建后菜单保留。

---

## 当前状态：pinned-summary-subagent-sections（已完成，已提交）

- 目标：按用户确认的简约双小节设计，把 `GitToolsPinnedSummary` 的 Subagent 分组改为「运行中」（默认展开）+「已结束 · N」（默认折叠、标题行整行切换）；后续文案修订：分组标题 i18n「智能体 / Agents」，Git 分组标题「Git 工具 / Git Tools」。
- 实现：组件 Props 新增 `runningSubagentRuns`，空态判断与 App 挂载条件纳入运行中列表；Subagent 分组重写为双小节——运行中行用弱色 `Loader2 animate-spin` + 名称 + task 弱副行（无耗时），已结束行保持 ✓/✗ + 名称 + 静态耗时（Bot fallback）+ task 副行；已结束标题行 `aria-expanded` + ChevronRight/Down（size-3.5 弱色）整行切换，组件 `useState(true)` 不持久化，关闭弹层三路径均恢复折叠；两组全空隐藏整组；分组顺序/分割线/`aria-labelledby` 不变；删除「最近优先」。数据层新增 `extractRunningSubagentRuns()`（复用与终态提取共用的 `collectRunSubagentToolCalls` + `buildSubagentRunPayload(args, undefined, true, …)`，pending 集合过滤、天然去重）；App 新增 `pinnedSummaryRunningSubagentRuns` 同一 revision 计算并传入；`openSubagentRun` → Inspector 已支持 running 快照，无需适配。i18n：`pinnedSubagentsTitle`='Subagent'，新增 `pinnedSubagentsRunningSection`/`pinnedSubagentsFinishedSection`，删 `pinnedRecentFirst`。
- 验证：定向 Vitest 3 files / 113 tests（git-tools-pinned-summary 11、subagent-run-detail 90 含新增 3、model-retry-notice 12）；定向 ESLint 6 文件 0 error；`npx tsc -b`；`feature_list.json` JSON parse；`git diff --check` 全过。未跑全量 test/lint/build。
- 文件：`src/App.tsx`、`src/components/git/GitToolsPinnedSummary.tsx`、`src/lib/i18n.ts`、`src/lib/subagent-run-detail.ts`、`tests/frontend/git-tools-pinned-summary.test.ts`、`tests/frontend/subagent-run-detail.test.ts`、`docs/wiki/src/components/README.md`（三处同步：L28 目录树注释 / L95 详述 / L224 组件条目）、三个状态文件。
- Blocker：无。边界：已结束仍最近 3 项；运行中行无耗时/定时器；pending 中的 run 即使残留旧 toolResult 也按运行中展示；折叠不持久化；未 commit。docs/wiki 三处已同步（实现时曾误判无需同步，冒烟时发现并修正）。
- 下一步：用户复核设计还原度；真机冒烟运行中→已结束迁移、两种行点击打开 Inspector、弹层重开恢复折叠、两组全空隐藏、中英文。

---

## 当前状态：pinned-execution-summary-groups（已完成）

- 目标：将 Git、任务清单和已结束 Subagent 分组显示在右上角现有 `GitToolsPinnedSummary` 置顶摘要中；运行中 Subagent 继续留在 Composer 胶囊。用户视觉修订要求移除展开浮层顶部总标题/描述，Git 排首位并使用浅分割线。
- 实现：摘要在 Todo/终态 Subagent/Git 任一存在时挂载，非 Git 会话也可见任务与 Subagent。展开浮层不再渲染顶部总标题/描述，只保留 absolute 右上角 X；实际分组顺序为 Git → Todo → 已结束 Subagent，首个实际分组无顶部间距/分割线，后续分组使用紧凑浅色 0.5px 分割线，标题行预留 X 空间，Git 中英文标题均为 `Git`。Todo 复用当前消息分支最新合法快照；新增 `extractLatestTerminalSubagentRuns()`，用当前 messages + pendingToolCalls 配对并排除运行中临时结果，按终态时间排序、canonical ID 去重、最近 3 项。App 订阅当前 agent 相关事件刷新；点击已结束项先关闭摘要再打开 Workspace Inspector Subagent Tab。Todo 展开、Subagent“最近优先”、Git changes/branch/menu/commit-push 保持；桌面 overflow visible 避免分支菜单裁剪，移动端 fixed 滚动且分支菜单 top/max-height 按 Git 首位成对调整。
- 验证：用户视觉修订后定向 Vitest 4 files / 125 tests、ESLint、`npx tsc -b --pretty false`、JSON parse、`git diff --check` 全过；按要求未运行 build，未跑全量 test/lint。
- 文件：`src/App.tsx`、`src/components/git/GitToolsPinnedSummary.tsx`、`src/lib/i18n.ts`、`src/lib/subagent-run-detail.ts`、两份测试、wiki components/lib、三个状态文件；本轮视觉修订仅修改 GitToolsPinnedSummary、i18n、对应测试、components wiki 与三个状态文件，未改 `docs/wiki/src/lib/README.md`。
- Blocker：无。边界：Inspector 打开时摘要入口仍隐藏；终态最近 3 项；任务“查看全部”仅浮层内展开；未 commit。
- 下一步：真机冒烟 Git/非 Git、done/error 点击、回滚/会话切换、移动/主题/中英文和分支菜单。

---

## 当前状态：subagent-running-indicator（已完成）

- 目标：将已确认的 HTML 设计实现到主聊天 Composer：在「完全访问权限」旁显示当前会话运行中的 Subagent 数量，点击具体运行打开 Workspace Inspector 详情 Tab。
- 实现：新增 `panel-decoration/subagent-running-indicator.ts`；以当前 `agent.state.pendingToolCalls` + `subagentRunStore.get(toolCallId)` 筛选 running，避免全局 store 跨会话污染。胶囊位于 access 后、plan 前；重复装饰复用 spinner/count/label DOM，避免旋转动画被重启造成闪烁；0 项移除，compact/mobile 收成 spinner+数字。body-level 菜单展示名称/任务/递增耗时，支持菜单互斥、外部点击/Escape、resize/scroll、DOM 重挂和 timer/listener cleanup；点击使用最新 payload 派发现有 `quickforge:open-subagent-run`。Side Chat/readOnly/disabled 不显示。
- 验证：Vitest 5 files / 111 tests；ESLint 0 error；`npx tsc -b --pretty false`；`npm run build`；`git diff --check` 全过。build 仅既有 KaTeX/chunk warnings，未跑全量 test/lint。
- 文件：`src/components/chat/panel-decoration/subagent-running-indicator.ts`、`src/components/chat/panel-decoration.ts`、`src/components/chat/ChatPanelHost.tsx`、`src/index.css`、`src/lib/i18n.ts`、`tests/frontend/subagent-running-indicator.test.ts`、`docs/wiki/src/components/README.md`、三个状态文件。
- Blocker：无。边界：store 缺失当前 pending id 的实时快照时不显示；菜单保持名称/任务/耗时的轻量信息，工具详情由 Inspector 承担；未 commit。
- 下一步：真机并行启动多个 subagent，验证数量递增/递减、Inspector 跳转、0 时消失和窄宽度紧凑态。

---

## 当前状态：model-stream-safe-retry-policy（已完成）

- 目标：修复用户真机反馈的模型回复“中途重复运行”。根因是已有实质内容后发生 idle timeout 时仍从零重建模型流，造成生成/工具调用重复执行、内容重写和重复计费；用户决策改为仅首个实质事件前透明重试。
- 实现：`server/ai-provider-options.mjs` 默认首事件 90s、已有内容 idle 180s、total 20min；`server/ai-http-logger.mjs` `MAX_STREAM_RETRIES=2`，且仅 `!hasSubstantiveEvent` 时重试，已有内容后超时直接失败；三份测试与 wiki server/src/components 同步。
- 验证：定向 7 files / 60 tests 全过；定向 ESLint 0 error；两模块 `node --check`；`npx tsc -b`；`npm run build` 均通过（仅既有 KaTeX/chunk warnings）；`git diff --check` 通过。未跑全量 npm test/lint。
- 文件：server/ai-provider-options.mjs、server/ai-http-logger.mjs、tests/server/ai-provider-options.test.mjs、tests/server/ai-http-logger.test.mjs、tests/frontend/model-retry-notice.test.ts、docs/wiki/server/README.md、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。边界：首事件前请求可能已被上游处理但尚未返回，重试仍可能重复计费；首事件后停滞直接报 idle timeout；total timeout 不重试；未 commit。
- 下一步：真机观察弱网/大上下文/长工具回合，确认不再中途重复运行，并评估 90s/180s 两档预算。

---

## 当前状态：subagent-running-indicator-design（设计稿已完成）

- 目标：在聊天 Composer 左下角「完全访问权限」旁显示正在运行的 Subagent 数量；点击胶囊展开运行列表，点击具体运行跳转 Workspace Inspector 详情 Tab。
- 产出：新增 `design-mockups/subagent-running-indicator.html` 自包含 HTML。包含 light/dark、中英、0/1/2/3 运行数、宽/窄模式；胶囊与现有 access 控件视觉对齐；列表展示 agent/任务/当前工具/耗时；点击项模拟 Inspector 面板滑入。
- 验证：Node 必要结构/无外链/内嵌脚本语法检查通过；`git diff --check` 通过；Playwright 验证弹层、Inspector、0 数量隐藏、Dark、窄模式均正常。
- Blocker：无。边界：本轮只做设计稿，未改功能源码；docs/wiki 无需更新；未 commit。实现时若要求指示器紧贴 access（位于 plan 前），需调整 `src/components/chat/panel-decoration/agent-access-menu.ts` 的现有 plan 排序逻辑。
- 下一步：用户复核设计稿；确认后另行实现运行中集合/当前会话过滤、Composer 控件挂载、`quickforge:open-subagent-run` 跳转与测试。

---

## 当前状态：sse-unreachable-tiered-notice（已完成）

- 目标：用户实测不可达提示后要求更友好的交互。经设计稿（design-mockups/unreachable-notice.html）与确认：方案 A 分层升级、30s 阈值、恢复指引按环境排序。
- 实现：server-agent reconnecting 广播带 unreachableSince；reconnect-notice Tier1 琥珀双行+立即重试按钮，≥30s 让位；新 unreachable-strip.ts Tier2 常驻条（composer dock 前、role=alert、断开时长/倒计时/立即重试/恢复指引两行=环境过滤+日志、sync 重挂保留展开）；ChatPanelHost 挂载对齐 reconnect-notice（仅主聊天）；index.css 复用琥珀配方；i18n +8/-1 key（精修删除 HelpAuto）。
- 验证：vitest 3 files / 82 tests（unreachable-strip 12 新例）；eslint 0 error；tsc -b；npm run build ✓。
- 文件：见 feature_list.json 的 sse-unreachable-tiered-notice.files（15 个，含 design-mockups/unreachable-notice.html）。
- Blocker：无。Notes：Tier2 直接移除无离场动画；i18n/wiki×2/feature_list 为混合文件（含并行会话未提交改动），commit 时需拆分暂存（同 e1f439d 做法）；本 feature 未 commit，上一 feature sse-health-probe-notice 已提交（e1f439d）。
- 下一步：真机冒烟分层升级全流程。

---

## 当前状态：chat-compact-composer-on-narrow-chat-area（已完成）

- 目标：用户需求中间对话区被左右侧栏拖宽挤压变窄时（viewport 宽度不变，`@media` 视口查询覆盖不到）Composer 输入框控件收起文字只留 icon，复用移动端 icon-only 紧凑形态。
- 实现：`src/components/chat/ChatPanelHost.tsx` 新增模块常量 `CHAT_COMPACT_WIDTH_THRESHOLD=640` / `CHAT_COMPACT_WIDTH_RELEASE=672`（32px 滞回）与 useEffect——ResizeObserver（typeof 防御）监听宿主 contentRect 宽度，<640 挂 `quickforge-chat-compact`、≥672 摘除、区间内保持现状；`src/index.css` 在移动端 @media 块（:5318 `}`）之后新增 `.quickforge-chat-panel-host.quickforge-chat-compact` 段（+68 行）：agent-access/model-trigger 照抄移动端规则（收 2rem、label/chevron 隐藏、span.ml-1 sr-only、thinking 徽标隐藏），补齐 plan（`> span` 隐藏无 class 文字 span）、opencode-config（label+chevron 隐藏）、opencode-mode（label 隐藏）三控件收 2rem；@media 块内既有规则零改动，三 class 特异性保证双态值一致无回归。新测试 `tests/frontend/chat-compact-controls.test.ts`（9 用例源码契约，ruleFor 前剥 CSS 注释、`:is()` 规则用精确文本断言）；wiki `docs/wiki/src/components/README.md` panel-decoration 段补一条。
- 验证：定向 npx vitest run 8 files / 48 tests 全过（新增 9：3 ChatPanelHost 契约 + 5 CSS 契约 + 1 移动端 @media 回归守卫；回归 composer-control-hover/composer-plus-menu/send-stop-button/opencode-config-menu/custom-model-selector/side-chat-composer-menu-scope/mobile-fullscreen-adaptation 共 39）；npx eslint 2 改动文件 0 error；npx tsc -b ✓；npm run build ✓（仅既有 KaTeX 字体与 chunk size warnings）。
- 文件：src/components/chat/ChatPanelHost.tsx、src/index.css、tests/frontend/chat-compact-controls.test.ts（新）、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。Notes：+ 按钮、send/stop 本就 2rem 纯 icon 无需处理；side chat 复用同一宿主，窄 Inspector 面板下同样进入紧凑（合理）；640-672 区间保持现状是滞回设计；progress.md/session-handoff.md 顶部另有并行会话的 workspace-inspector-dynamic-width 条目，本条目插于其上，未触碰其内容；未跑全量 test/lint。
- 下一步：真机冒烟（拖宽侧栏压对话区 <640px 控件收 icon-only、拖回 ≥672px 恢复；移动端窄视口行为不变）。

---

## 当前状态：workspace-inspector-dynamic-width（已完成）

- 目标：用户需求右侧 Workspace Inspector 拖动范围更大。确认方案：最小宽度 340 不变；拖动上限改为动态 max(340, min(1200, 视口宽*0.75))，超宽屏绝对封顶 1200px；自动展开（打开 browser/terminal/document/subagent/reader 时拉宽）保持 640 不变。
- 实现：`src/components/workspace/WorkspaceInspector.tsx`——常量区 WORKSPACE_INSPECTOR_MAX_WIDTH 640→1200，新增 WORKSPACE_INSPECTOR_MAX_VIEWPORT_RATIO=0.75、WORKSPACE_INSPECTOR_AUTO_EXPAND_WIDTH=640；新增模块级 getInspectorMaxWidth()/clampInspectorWidth()（照抄 ChatSidebar 模式）；readPersistedInspectorWidth 与 resize() 拖动 clamp 统一走 clampInspectorWidth；expandInspectorToMax 改用 AUTO_EXPAND_WIDTH；全屏退出恢复 style.maxWidth、aside 行内 maxWidth（保持 `visible && !fullscreen && !mobileOverlay ? {` 三元结构，mobile-fullscreen-adaptation 契约）、separator aria-valuemax 均改 getInspectorMaxWidth()；新增 window resize 同步 effect（syncWidthToViewport，fullscreen/mobileOverlay 跳过）。新测试 `tests/frontend/workspace-inspector-width-range.test.ts`（6 用例源码契约）；`docs/wiki/src/components/README.md` 同步宽度描述。Storage key 沿用 quickforge_workspaceInspectorWidth_v2。
- 验证：定向 npx vitest run workspace-inspector-width-range + mobile-fullscreen-adaptation 2 files / 9 tests 全过；workspace-inspector-tabs 回归 19 tests 过；eslint 2 改动文件 0 error；npx tsc -b ✓；npm run build ✓（仅既有 KaTeX 字体与 chunk size warnings）。
- 文件：src/components/workspace/WorkspaceInspector.tsx、tests/frontend/workspace-inspector-width-range.test.ts（新）、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。Notes：窄视口 mobileOverlay/全屏模式不参与宽度 clamp（维持全屏覆盖布局）；自动展开目标固定 640 而非动态上限；progress.md/session-handoff.md 顶部另有并行会话的 browser-single-window-guard 条目（编写期间被并行插入，本条目插于其上，未触碰其内容）；工作区有多个并行会话未 commit 改动，本 feature 未触碰；未跑全量 test/lint。
- 下一步：可选真机冒烟（宽屏拖到 >640、窗口缩窄自动收缩、打开内容仍展开到 640）。

---

## 当前状态：browser-single-window-guard（已完成）

- 目标：用户问「浏览器打开能否只允许开一个窗口？开多个 SSE 会堵塞的吧」。调研澄清：服务端 SSE 无互相阻塞（EventEmitter 广播），堵塞根因是浏览器 HTTP/1.1 同源 6 连接池被每窗口 2-4 条常驻长连接占满致普通 API 排队。用户决策：Web Locks 严格单窗口（无接管逃生门）、检测到第二窗口时尽力自动聚焦已有窗口（window.focus() 由已有窗口自行调用 + 标题闪烁兜底）。
- 实现：新增 `src/lib/window-guard.ts`（acquireAppWindowGuard：ifAvailable 抢锁、acquiredPromise race 成功判定、刷新竞态 400ms×2 重试、降级 unsupported；startWindowFocusResponder 监听 quickforge-window-guard 频道 → focus + 标题闪烁 5s；requestExistingWindowFocus 广播）+ `src/components/WindowGuardNotice.tsx`（全屏拦截页，内联 SVG、t() 双语、复用既有 token、不 import App、零 /api）；`src/main.tsx` bootstrap 渲染前 await 守卫，blocked 先自动广播一次 focus 再渲染拦截页；i18n 中英成对 3 key；wiki 3 处同步。
- 验证：定向 vitest window-guard 10 tests（主 Agent 复核重跑通过）；i18n 回归 3 文件 31 tests；eslint 5 文件 0 error；tsc -b ✓；npm run build ✓（仅既有警告）。未跑全量。
- 文件：src/lib/window-guard.ts（新）、src/components/WindowGuardNotice.tsx（新）、src/main.tsx、src/lib/i18n.ts、tests/frontend/window-guard.test.ts（新）、docs/wiki/{src, src/lib, src/components}/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。Notes：① 拦截页语言用浏览器默认（i18n import 时同步初始化，零 /api 代价的小妥协）；② Electron/Android/隐身/不同 profile 为独立锁空间天然隔离；③ 同根因的设置页额外 channels/events SSE（channels-settings-tab.ts:179）记为潜在后续优化，未动；④ progress.md 顶部另有并行会话条目，未触碰。Revision 轨迹：用户反馈点击切换不跳转（浏览器硬限制）→ 中间做过通知聚焦方案 → 用户决策回归极简（删切换/通知/闪烁/BroadcastChannel 链路，window-guard.ts 收缩为 118 行纯锁守卫）→ 又实测关闭按钮无效（window.close() 对手动开的标签页必然失败）→ 最终 Revision 3：拦截页纯静态提示（34 行，无按钮无 state，仅图标 + 双语标题/描述），i18n 最终仅保留 windowGuardTitle/Description 两 key。复验 vitest/eslint/tsc/build 全过。
- 下一步：真机复测（第二个窗口只见纯提示卡片；关第一个窗口后刷新第二个可接管；旧浏览器降级放行）。

---

## 当前状态：sse-health-probe-notice（已完成）

- 目标：用户反馈后台被杀后前端只显示「重新连接中… 3/10」，应明确告知健康检查失败。用户确认：A（重连失败尽早探测 /api/health，不可达则切换提示且持续自动重试）+ 恢复后对比 bootId 提示「服务已重启」。
- 实现：server-agent.ts 新增 probeHealth/probeHealthInBackground/probeBootIdAfterConnect（5s 超时、single-flight、竞态防护、baseUrl 跟随直连/代理切换）；serverUnreachable=true 时豁免 MAX_SSE_RECONNECT_ATTEMPTS=10 上限（退避封顶 30s 持续自动重试），onopen/retryNow/disconnect 复位；SseConnectionStatus 增量扩展 reconnecting.unreachable?/connected.restarted?；reconnect-notice.ts unreachable 文案 sseServerUnreachableLabel（隐藏 n/10、保留倒计时）+ restarted 补播升级文案 sseReconnectedRestarted（重置淡出计时器，已移除则忽略）；i18n 中英 +2 key；wiki src/lib、src/components 同步。
- 验证：定向 vitest 2 files / 67 tests（新增 8 例）；model-retry-notice 回归 12 tests；eslint 0 error；tsc -b ✓。
- 文件：src/lib/server-agent.ts、src/lib/i18n.ts、src/components/chat/panel-decoration/reconnect-notice.ts、tests/frontend/server-agent.test.ts、tests/frontend/reconnect-notice.test.ts、docs/wiki/src/lib/README.md、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。Notes：「不可达」不区分进程死/断网（浏览器端不可分）；restarted 补播在恢复提示已淡出后忽略；首连多一次 /api/health 请求；工作区有多个并行会话未 commit 改动，本 feature 未触碰。
- 下一步：真机验证（杀后端→不可达提示+持续重试；重启后端→自动恢复+已重启提示；弱网→维持 n/10）。

---

## 当前状态：session-switch-no-auto-preview-tab（已完成）

- 目标：用户反馈「切换项目内 session 时 tab 自动打开」。定位两条机制：① 面板开合按 (projectId, sessionId) localStorage 恢复（useWorkspaceInspectorOpenState），切回曾展开的 session 自动开面板；② 自动预览 effect 对恢复会话的全部历史 present_files 自动弹 tab + 强制开面板（sessionStorage 去重只覆盖浏览器标签页生命周期，冷启动首次切换仍弹）。用户决策：②不自动预览历史 present_files、①恢复 tab 列表但不强制打开面板。
- 实现：① 删除 `src/hooks/useWorkspaceInspectorOpenState.ts` 与 `tests/frontend/workspace-inspector-open-state.test.ts`，App.tsx `workspaceInspectorOpen` 改 `useState(false)`（默认收起，仅用户手动或自动预览请求打开；tab 列表仍按会话持久化恢复）；② `artifact-preview-utils.ts` 新增纯函数 `collectToolResultToolCallIds` / `isNewlyPresentedArtifact`，App.tsx 自动预览 effect 前新增附着时刻快照 effect（autoPreviewHistoryRef，restore 返回时消息已同步填充），历史门控仅放行附着后新发生的 present_files；删除 sessionStorage 去重机制，保留 autoPreviewSignatureRef 内存去重；`workspace-inspector-tabs.test.ts` 删除 openStateSource 源码断言。
- 验证：定向 vitest 4 files / 50 tests 全过（新 `tests/frontend/auto-preview-fresh-present.test.ts` 8 tests）；eslint 改动 src 2 文件 0 error；tsc -b ✓；build ✓（仅既有警告）。
- 文件：src/App.tsx、src/components/workspace/artifact-preview-utils.ts、src/hooks/useWorkspaceInspectorOpenState.ts（删）、tests/frontend/auto-preview-fresh-present.test.ts（新）、tests/frontend/workspace-inspector-open-state.test.ts（删）、tests/frontend/workspace-inspector-tabs.test.ts、docs/wiki/{src, src/components, src/lib}/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。Notes：缓存命中后台校准补尾 toolResult 视为新产物（可接受）；live present 仍强制开面板（预期）；工作区含并行会话未 commit 改动（persist-skip-message-deep-clone / mcp-restore-nonblocking / sse-reconnect-notice / ai-stream-idle-fast-detect-retry / model-stream-retry-notice / update-check-async-snapshot 等），本 feature 未触碰。
- 下一步：可选真机冒烟（切回曾展开面板的 session 不再自动开；冷启动后首次切含 present_files 的旧 session 不再弹；新会话 AI present 当次仍弹）。

---

## 当前状态：persist-skip-message-deep-clone（已完成）

- 目标：/restore 偶发慢优化之二——消除持久化路径对全量 messages 的两次 structuredClone 深拷贝（纯 CPU 削减，事务边界/锁/CAS 不变，DB 写入字节级等价）。
- 实现：`server/session-state-service.mjs` synchronize() 改「body 深拷贝 + messages 浅拷贝」；savePairChunked() 入口浅拷贝冻结快照防编码 yield 间隙 torn read；`server/sqlite/session-state-repository.mjs` normalizeRecord() 预编码旁路不再深拷贝 messages（仅同步读长度对齐，写库内容为编码瞬间不可变字符串）。新增 2 用例（不可克隆探针 + torn-read 防护）。
- 验证：定向 5 files / 95 tests 全过；eslint 0 error；node --check；全量 npm run test 264 files / 2427 tests、lint、build 全过。
- 文件：server/session-state-service.mjs、server/sqlite/session-state-repository.mjs、tests/server/session-state-repository.test.mjs、tests/server/session-state-service.test.mjs、docs/wiki/server/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。下一步：观察慢日志 persist took 分布；残余集中在 COMMIT 段时再评估 worker 线程（记录在案待定项）。

---

## 当前状态：mcp-restore-nonblocking（已完成）

- 目标：/restore 偶发慢优化之一——MCP（重）连接不再挡在 restore 关键路径（原 error+过冷却会同步等待 ≤15s+15s，single-flight 扩散到所有并发方）。
- 实现：registry.mjs 增加 waitForConnections:false 快照模式、reconnectDisconnected、subscribeMcpToolsetChanged 签名变更通知；agent-manager.mjs 透传 mcpToolsMode（restoreAgentUnlocked 走 cached），模块级订阅变化后调现成 refreshAllSessionTools()（无死循环）；index.mjs listen 回调 fire-and-forget 预热（覆盖 CLI/SDK/Desktop/Android 全入口，经只读调研确认）。新会话/subagent//api/tools/callMcpTool 保持 await 语义。
- 验证：定向 12 files / 63 tests 全过（registry 3 新用例 + restore cached 行为断言，11 个测试文件 mock 补导出）；eslint 0 error；node --check；全量 264 files / 2427 tests、lint、build 全过。
- 文件：server/mcp/registry.mjs、server/agent-manager.mjs、server/index.mjs、tests/server/mcp-registry.test.mjs、tests/server/agent-manager.persist-session-state.test.mjs 等 15 个文件（见 feature_list.json 的 mcp-restore-nonblocking.files）、docs/wiki/server/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。Notes：① restore 后首个回合若恰好用到尚未重连完成的 MCP 工具，按现状 503 报错自愈（重连完成后工具集通知自动重建会话工具）；② 本会话与并行会话（server-process-error-guards、agent-idle-timeout-10min）共享工作区，各自 feature 未 commit，commit 时按 feature 分开。
- 下一步：真机观察 restore durationMs 不再出现 MCP 量级长尾；两 feature 均未 commit。

---

## 当前状态：agent-idle-timeout-10min（已完成）

- 目标：用户反馈 agent 空闲缓存 30 分钟太长，10 分钟足够（30 分钟 idle 被 destroyAgent 踢出内存 → 冷恢复走完整重建）。
- 实现：`server/agent-manager.mjs:270` `IDLE_TIMEOUT_MS` 30*60*1000 → 10*60*1000（唯一消费点 `resetIdleTimer()`，逐出日志自动跟随）；ACP `idleRetention='always'` 会话不受影响。
- 验证：node --check / eslint 0 error / 动态 import 冒烟 / git diff 仅 1 行；无测试断言该值，未跑全量。
- 文件：server/agent-manager.mjs、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。Notes：工作区另有并行会话未提交的 MCP warmup/agent-manager 一族改动（本改动仅 +1/-1 行常量，无冲突，commit 时勿混入）；终端 PTY 30 分钟保留与 ask_user 30 分钟超时为独立语义未动。
- 下一步：无；未 commit。

---

## 当前状态：server-process-error-guards（已完成）

- 目标：用户报告后台服务无声退出（8/27 23:10:29 日志断档、无错误无优雅关闭标记）。根因：无 uncaughtException/unhandledRejection 处理器，且 detached + stdio:'ignore' 启动导致崩溃零痕迹。
- 实现：新增 `server/utils/process-error-guards.mjs`（fatal：记录含 stack → best-effort 优雅关闭 5s 上限 → flushLogger → exit(1)，re-entrancy 守卫；rejection：仅记录继续运行，不 flush 不退出）；`server/index.mjs` 启动早期（:101，模块级状态声明后）`installProcessErrorHandlers({onFatalError: () => stopQuickForgeServer()})`；同步 wiki server/README、server/utils/README 与 logging-design §5 埋点表。
- 验证：定向 6/6 + tests/server/utils/ 回归 9 files / 157 tests 全过；eslint 3 文件 0 告警；npm run build 通过；定向验证 + build，未跑全量测试。
- 文件：server/utils/process-error-guards.mjs（新）、server/index.mjs、tests/server/utils/process-error-guards.test.mjs（新）、docs/wiki/server/README.md、docs/wiki/server/utils/README.md、docs/architecture/logging-design.zh-CN.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。Notes：① 并行会话同期在工作区推进 MCP warmup/agent-manager 改动（server/agent-manager.mjs、server/mcp/registry.mjs、tests/server/agent-manager.*、tests/server/mcp-registry.test.mjs 等），与本 feature 无关，未触碰、commit 时勿混入；② update/check 弱网 500 修复（fdd7115）未随 v1.10.0 发布，全局安装版本复现属预期。
- 下一步：可选真机触发未捕获异常验证日志落盘；本 feature 未 commit；工作区另有并行会话的 MCP warmup 未 commit 改动。

---

## 当前状态：update-check-async-snapshot（已完成）

- 目标：用户报告 `GET /api/system/update/check` 500（控制台 Failed to load resource）且指出更新检查应异步。根因：路由同步 await 外部 npm registry（5 秒超时），弱网失败抛 500。
- 实现：`server/utils/package-update.mjs` npm 检查改状态机——`getUpdateCheckState(projectRoot, {force})` 同步返回 `{status:'checking'|'ok'|'error', ...结果, checkError?, checkedAt}` 快照、后台刷新（5 分钟冷却 / 30 秒失败退避 / force 跳过），`checkForUpdates` 保留可等待语义供更新流程；路由 `server/routes/system.mjs` 改 `sendJson(200, 快照)` + `?force=1`；`server/index.mjs` context 接线。前端新 `src/lib/update-check-poll.ts`（有界轮询 10×1s，可注入 fetch/sleep，失败不抛出，兼容旧 payload）；`src/hooks/useUpdateCheck.ts`（启动静默）与 `src/lib/about-settings-tab.ts`（手动 force）接入。
- 验证：定向 3 files / 29 tests、eslint 0 error、build ✓、全量 npm run test 263 files / 2415 tests 全过。
- 文件：server/utils/package-update.mjs、server/routes/system.mjs、server/index.mjs、src/lib/update-check-poll.ts（新）、src/hooks/useUpdateCheck.ts、src/lib/about-settings-tab.ts、tests/server/utils/package-update.test.mjs、tests/server/routes/system.test.mjs、tests/frontend/update-check-poll.test.ts（新）、docs/wiki/{server, server/routes, server/utils, src/lib, src/hooks}/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。Notes：`/api/system/update/desktop`（checkDesktopRelease）仍为阻塞形态但前端无调用方，未纳入本次；identity.mjs:92 lint warning 为既有问题。
- 下一步：可选真机弱网验证（无 500、About 手动检查失败文案/恢复重查）；本会话累计四组未 commit 改动（sse-reconnect-notice / ai-stream-idle-fast-detect-retry / model-stream-retry-notice / update-check-async-snapshot）。

---

## 当前状态：model-stream-retry-notice（已完成）

- 目标：用户实测反馈本机弱网只看到「AI stream idle timeout after 60000ms」错误、没有重连文字（SSE 走 localhost 不断，前端 SSE 重连提示覆盖不到上游模型流层）。把上游故障做成可见恢复体验。
- 实现：server/ai-http-logger.mjs 重试放宽到任意 idle 超时（MAX_STREAM_RETRIES=10 已导出；有内容时新流从零重放、hasSubstantiveEvent 重置回首事件档；onStreamRetry 上报进度与 recovered）；server/agent-manager.mjs 主 Agent + subagent 两处 streamFn 闭包注入回调 → `model_stream_retry` SSE 事件；前端 server-agent eventTypes + 新 panel-decoration/model-retry-notice.ts（居中「模型连接重试中… n/10」，CSS 与 quickforge-reconnect 并列复用）+ ChatPanelHost 事件驱动 show/hide/sync/destroy（仅主聊天）；i18n 双语 1 key。
- 验证：服务端 2 files / 19 tests、前端 2 files / 57 tests、消费方回归全过；eslint 0；tsc -b；build ✓。
- 文件：见 feature_list.json 的 model-stream-retry-notice.files（17 个）。
- Blocker：无。
- 下一步：真机弱网验证重试递增与恢复重写体验；本会话累计三组未 commit 改动（sse-reconnect-notice / ai-stream-idle-fast-detect-retry / model-stream-retry-notice）。

---

## 当前状态：ai-stream-idle-fast-detect-retry（已完成）

- 目标：解决用户报告的「AI stream idle timeout after 300000ms」——弱网下服务端→模型 API 上游流卡死 5 分钟才报错且无恢复。经链路分析与方案对比（SDK 层/pi-ai 注入点不可达、全局 fetch patch 过重），按用户确认在 QuickForge 包装层简单实现。
- 实现：`server/ai-provider-options.mjs` idle 默认 300s→60s + 新增首事件档（初版 120s，经用户决策统一收紧为 60s；显式 idle/deadline 配置时两档同值）；`server/ai-http-logger.mjs` 的 wrapStreamWithTimeouts 工厂化 + 零内容透明重试（限 1 次）：按「有无实质事件」分档计时，零内容超时内部重建底层流——独立 attempt AbortController、托管云换新幂等键、吞重复 start、result() 跟随当前流迁移、外部 next() 等待者跨重试存活；用户 abort/有内容/重试耗尽走原报错路径。
- 验证：定向 2 files / 19 tests 全过 + 消费方回归（compaction/side-chat/agent-manager 族）全过 + eslint 0 + node --check + build ✓。调试修复三个自引入 bug（waiter.resolve 笔误、combineAbortSignals 多参、result() 流跟随），均有用例锁定。
- 文件：server/ai-provider-options.mjs、server/ai-http-logger.mjs、tests/server/ai-provider-options.test.mjs、tests/server/ai-http-logger.test.mjs、docs/wiki/server/README.md（新增 ai-http-logger 条目）、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。与 sse-reconnect-notice（前端 SSE 重连提示）分属两层互补，均未 commit。
- 下一步：可选真机弱网验证（60s 快速检出 + 零内容无感重试 + 大上下文 prefill 不误杀）；发布门禁时全量重跑 test/lint/build。

---

## 当前状态：sse-reconnect-notice（已完成）

- 目标：弱网重连期间在对话中显示「重新连接中… 8/10」。先出 `design-mockups/reconnect-indicator.html` 设计稿（三方案 × 三状态 × 深浅主题 + 交互演示），用户确认方案 A（消息流末尾居中轻量行）后落地实现。
- 实现：`src/lib/server-agent.ts` — `GlobalAgentSseClient` 新增尝试计数与上限 `MAX_SSE_RECONNECT_ATTEMPTS=10`、`SseConnectionStatus` 广播（reconnecting{attempt,maxAttempts,nextRetryAt} / connected{recovered} / failed{maxAttempts}），导出 `subscribeSseConnectionState` / `getSseConnectionState` / `requestSseReconnectNow`；`disconnect()` 统一重置。新 `src/components/chat/panel-decoration/reconnect-notice.ts`（197 行）controller：`message-list` 末尾居中行，重连中 spinner+计数+每秒倒计时、恢复绿色提示约 2.2s 自动淡出、上限后琥珀失败+「立即重试」；decorate 周期 `sync()` 重挂、`destroy()` 清理。`ChatPanelHost.tsx` 仅主聊天挂载（`sideChatMode` 不挂）；`panel-decoration.ts` 桶导出；`i18n.ts` 双语 5 key（sseReconnectingLabel/sseReconnectNextRetry/sseReconnectedLabel/sseReconnectFailedLabel/sseReconnectRetryNow）；`index.css` 新增 `.quickforge-reconnect*` 段（TodoWrite 注释之前，reduced-motion 关动画）。
- 验证：定向 vitest reconnect-notice + server-agent → 2 files / 58 tests 全过；回归 6 files / 70 tests 全过；eslint 0 error；tsc -b 通过；build ✓（dist 含样式与 key）。中途误改 `SSE_SILENCE_RECOVERY_MS` 15015 一事已恢复原值（最终 diff 不含）。
- 文件：design-mockups/reconnect-indicator.html（新）、src/lib/server-agent.ts、src/components/chat/panel-decoration/reconnect-notice.ts（新）、src/components/chat/panel-decoration.ts、src/components/chat/ChatPanelHost.tsx、src/lib/i18n.ts、src/index.css、tests/frontend/reconnect-notice.test.ts（新）、tests/frontend/server-agent.test.ts、docs/wiki/src/lib/README.md、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- Blocker：无。
- 下一步：可选真机弱网验证；未跑全量 test/lint（发布门禁时按 runbook 全量重跑）。未 commit/tag/push。

---

## 当前状态：release-v1.10.0（已完成）

- 目标：按用户指令「发布一个版本」，以 `v1.9.1` tag 之后 dev 的待发布内容为基线（新功能 chat-message-queue dfb2bcc + plugins/lan-access 两个文案精简提交），经用户选型确认按 **minor** 发布 **v1.10.0**。
- 已完成：`npm version minor` 1.9.1→1.10.0；CHANGELOG.md 新增 `[1.10.0] - 2026-08-27` 章节（Added/Changed/Released）；README.md 当前版本徽章 → 1.10.0。
- 门禁：完整 `npm run test` → **260 files / 2365 tests 全部通过**（硬门禁）；`npm run lint` → 0 errors / 1 既有 warning（identity.mjs:92）；`npm run build` 成功（仅既有 chunk size warnings）。
- 打包：runtime/offline 包已生成，`package-offline/shawnstack-quickforge-1.10.0.tgz`（unpacked 24.2MB / 453 files）；元数据校验 version 1.10.0、8 运行时 deps + @vscode/ripgrep optional、无 devDeps/scripts。
- 文件：package.json、package-lock.json、CHANGELOG.md、README.md、feature_list.json、progress.md、session-handoff.md。
- 发布序列：本变更构成 release commit（在 dev 上），随后 master `--ff-only` 快进、`v1.10.0` tag、原子推送 `master`/`dev`/tag。
- Blocker：无。剩余人工步骤：GitHub Desktop Release 与 `npm publish ./package-offline/shawnstack-quickforge-1.10.0.tgz --access public`（用户执行，需 npm 登录）。
- 下一步：无。可从 feature_list.json 选择下一个 feature。

---

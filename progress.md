## scheduled-tasks-ui-optimization（done，2026-09-16）

- 目标：定时任务页面 UI 布局优化——任务列表由 2 列卡片网格改为紧凑行列表，编辑表单/详情/历史筛选按 DESIGN_LANGUAGE.md 去除透明度 hack 并收紧密度；i18n/状态机/API 不变。
- 改动文件：src/components/scheduled-tasks/ScheduledTasksPage.tsx（单文件重构）、docs/wiki/src/components/README.md、feature_list.json、progress.md、session-handoff.md。
- 验证：定向 npx vitest run tests/frontend/scheduled-tasks-page.test.ts 18/18 通过；tsc --noEmit 通过；ScheduledTasksPage.tsx ESLint 通过。
- 第二轮（用户反馈修复）：层级修复——任务行 MoreHorizontal 菜单由 absolute z-20 内联改为 createPortal(document.body)+fixed z-50+锚点定位（视口钳制/上方翻转/click/blur/scroll/resize/Escape 关闭），对齐 AgentProfilesPage，修复被 4 层 overflow 祖先裁剪；编辑表单对齐 AgentProfilesPage 表单模式——AI 解析弱化为辅助块（outline sm 按钮+解析结果上移）、模型/思考/项目/智能体由 icon-only 工具条升格为标准 label 字段、预览收紧行、操作按钮入卡内 footer、返回按钮左移。仍仅改 src/components/scheduled-tasks/ScheduledTasksPage.tsx。
- 第二轮验证：vitest tests/frontend/scheduled-tasks-page.test.ts 18/18、tsc --noEmit、eslint 全部通过，测试断言零改动。
- Notes：无新依赖、无生成产物修改、无 Git 操作。仓库存在大量历史会话未提交改动（server/、tests/、docs/wiki/ 等约 18 个文件），非本次改动，未触碰。

---

## scheduled-task-frequency-select（done，2026-09-16）

- 目标：定时任务编辑器「执行频次」由六枚分段按钮（aria-pressed button 组）改为原生下拉框，控件形态与执行模式等既有 select 一致，行为与数据不变。
- 实现：ScheduledTasksPage 复用 taskExecutionMode select 结构——`<label className="block text-sm font-medium text-foreground">{t('taskFrequency')}<select className={scheduleInputClass} aria-label={t('taskFrequency')}>`；frequencyOptions 原样渲染为 `<option>`，cron label 改用新 i18n key `taskFrequencyCron`（en/zh 成对，值均为 'Cron'），不再硬编码；移除原 legend（可见名称改由 label 提供），保留外层 fieldset 的 `disabled={loading}` 分组（测试仍断言 pending 时 fieldset 禁用）。updateForm 的 scheduleType 切换逻辑（once/interval 日期草稿保存恢复、清 nextRunAt/scheduleRule、清 AI 解析态）与按频次子字段渲染零改动。
- 测试：tests/frontend/scheduled-tasks-page.test.ts 11 处频次切换由 `button('taskFrequencyX').props.onClick?.()` 改为 `change('taskFrequency', '<type>')`，经 select onChange 触发同一 updateForm；其余断言不变。
- 验证：定向 vitest 3 文件 49/49 通过（scheduled-tasks-page 18、scheduled-task-form 29、i18n-language-snapshot 2）；全量 npm run test 355 files / 4111 passed + 1 skipped、npm run lint 0 error（仅既有 coverage 3 warnings）、npm run build 成功（仅既有 KaTeX/chunk warnings），均 exit 0。
- Notes：无新依赖、无生成产物手工修改（build 正常生成 dist）、无 Git 操作；docs/wiki/src/components/README.md「手动频次分段按钮」同步改为「频次下拉框」。i18n 快照测试不校验 key 清单，en/zh 成对新增即可。

---

## cold-session-operation-restore（done，2026-09-16）

- 用户已批准目标：修复普通会话 idle 回收后 continue/rollback/access/yolo/model/thinking 误报 Session not found；限定本 feature，不改 idle、Goal 或重试历史语义。
- 实现：manager 按 updateSessionTitle 模式先用内存、缺失 await restoreAgent；model/thinking 转 async，主路由/shared/ACP 所有生产调用补 await。主 model 先恢复再取 currentModel/解析 binding，保留当前隐藏模型规则。restore 只有读到无记录才 null，503 原样保留，其他异常记录原日志并抛安全500/SESSION_RESTORE_FAILED（cause 保留内部原因）。pending single-flight 与 finally 清除不变。
- 调用链复核：所有 restore 调用均 await 或由 async 返回；主 SSE GET/HEAD 与 shared SSE 在发送头前 await，上层已有错误传播，无需额外修改。share-store 的仅404存储fallback不变，新增500/503不得fallback测试。Wiki 两处补短文字，无需SVG。
- 验证：工作区 `.tmp-session-restore` 作为所有验证 TEMP/TMP/TMPDIR。最终十文件定向 vitest 143/143通过（新增35例）；包含真实SQLite持久化→destroy→内存为空→直接操作、continue两模式历史、压缩点前后rollback、设置不启动生成、冷Goal409、缺失404、存储/构建故障500、原503、并发失败后重试、热setter不读存储、主model冷隐藏模型及异步setter/SSE传播。9个改动源码/测试定向ESLint无warning；npm run lint退出0（既有coverage3 warnings）；npm run build退出0（既有KaTeX/chunk warnings）。独立只读审查通过，无阻塞；父Agent已接受审查结论，确认143项定向测试与lint/build通过足够本次范围，feature标记done。未跑全量test、真实模型或浏览器验收，未重启运行实例。
- Notes：首轮新故障注入用vi.spyOn冻结repository导致2例夹具失败，已改用既有spread wrapper模式并全部复跑通过。一次git grep单引号在Windows shell失败，已用兼容-e参数复核。测试异步日志/Node缓存产生的本次专用临时目录残留已清理，仅删除本轮创建目录，不涉及用户数据；无其他无关故障需扩范围。
- 边界：不承诺真实模型永不重复调用工具；无新依赖、无UI改动、无commit/tag/push；未手工编辑生成目录，正常build产物不纳入diff；用户 `.playwright-mcp/` 保留未跟踪。改动文件见feature_list，本次未提交。

---

## desktop-portable-exe（done，2026-09-16）

- 用户直接需求：Windows 桌面打包时同时产出免安装 portable exe。方案：electron-builder win target 增加 `portable`，随 `desktop:build:win` 自动产出，无需改 package.json / CI（`desktop-dist/*.exe` 通配已覆盖，Release 资产名不冲突）。
- 改动文件：`desktop/electron-builder.config.cjs`（`win.target: ['nsis','portable']` + `portable.artifactName: 'QuickForge-Portable-${version}.exe'`）；`docs/wiki/root-config.md`（Desktop 脚本条目补 portable 说明）；三状态文件。
- 验证：配置 require 加载字段正确；本地 `npm run desktop:build:win` 完整通过，产出 `QuickForge Setup 2.1.0.exe`（109,371,633 B）与 `QuickForge-Portable-2.1.0.exe`（109,129,258 B）双产物；`npx eslint desktop/electron-builder.config.cjs` exit 0。未跑全量 test（无源码/测试改动，构建链已含 `npm run build`）。
- 行为说明：portable 免安装、双击即用，与安装版共享 `%APPDATA%` 用户数据；不经过 `nsis-patch/apply.mjs` 与 `installer.nsh`（仅 NSIS 安装器路径）。CI tag 构建将自动把 portable exe 上传至 GitHub Release。
- Notes：无新依赖、无 UI 改动、未触碰 dist/package-dist/package-offline（desktop-dist 为 electron-builder 生成物）；无 Git 操作。

---

## scheduled-tasks-goal-support（done，2026-09-16）

- 当前 feature：定时任务可触发 Goal，并复用既有 `runPrompt`→runner，不新增执行器；主聊天与 scheduled 支持，ACP/channel/shared 仍拒绝。
- 契约：`waitForGoalCompletion` 复用 runner 持久化终态屏障与 idle，只有 `completed` 才 schedule 成功；`paused`/`blocked`、预算耗尽与 awaiting 仍为 running 并保留 serial。关联聊天可 resume/cancel，静止后的 cancelled/failed 才失败。
- Goal 豁免普通 1h/Profile 墙钟超时；审批、轮次、工具超时不提升或取消。普通任务不变；重启沿用 stale-run failed，Goal paused 不自动重放。Profile 获准的 `goal_report` 不受 workspace 白名单滤除，但不扩展 workspace 能力；goal waiter 避免 idle eviction。
- 父 Agent 最终验证：8 文件 309 tests 全过（commands 24、runner 146），7 个相关源/测试 ESLint 零 warning、`tsc -b --pretty false` 通过。包含真实自动 tick 与手动 Goal、多轮不提前完成、persist 延迟/失败、暂停恢复、取消等底层 idle、独立并行、普通/Profile 超时区分及销毁注册竞态。未跑全量 test/build、未调用真实模型，自动入口测试使用真实 scheduler/manager/runner/storage 与模拟 Agent。
- 实现文件见 feature_list：runner 增加可复用 completion waiter，manager 保活与 Profile 控制工具接通，scheduled 仅适配完整 Goal 等待；补消息快照与结束前禁止替换 Goal，避免结果污染。销毁前后/缺失 session 注册已补 5 项边界测试。
- Notes：未新增依赖、未改 UI 或生成产物、未在当前仓库 commit/tag/push。保留并行指令/附件改动及全部历史记录，旧拒绝契约由本节覆盖。原 timer/active-ID/手动请求 pending 不扩展修复。既有 ai-timeout-budgets 夹具会在系统临时目录 Git init/commit，subagent 首次执行后发现并停止复跑；本次仅补依赖 mock 并 lint，不宣称该文件修复后测试通过。父验证将 TEMP/TMP/TMPDIR 指向工作区。旧 waitForGoalIdle 的底层 wait 无硬 deadline、外部存储直接同步 terminal 不登记 completion 属后续评估，不在此扩展。
- Wiki 已同步；考虑 SVG 后采用紧凑文字契约，无需新增图。下一步可重启所运行的源码服务后用 `/goal 刚刚提交了什么代码` 做实际模型验收；本轮不主动重启当前服务。

---

## scheduled-tasks-command-support（done，2026-09-15）

- 目标已完成：定时触发与手动运行均走统一 `runPrompt`，支持既有内置 slash command、Skill 与项目自定义命令；解析、权限和可用性规则沿用普通 prompt 链，Goal 仍拒绝，工具审批不变。
- 生产改动仅 `server/routes/scheduled-tasks.mjs`：去掉首消息预 append/persist，改用 `runPrompt`；首消息由统一 prompt 流程持久化，不再保证 `onStarted` 前落盘。
- 测试：更新 `tests/server/scheduled-tasks.execution.test.mjs`（44 tests）；新增 `tests/server/scheduled-tasks.commands.test.mjs`（10 tests），使用真实 manager/resolver/storage，仅 mock 底层 Agent。覆盖普通消息仅一次、plan 权限、custom 参数、skill、help/goal、clear/summary/compact 短路与 prompt reject。
- 验证：父 Agent 定向 7 文件 196 tests 全部通过；父 Agent 对 3 个改动源/测试文件最终定向 ESLint 通过（0 warning）。本次未跑全量 test/build，不将并行会话的全量结果认领为本次验证。
- 文档：routes Wiki 仅补简洁指令执行契约；几句文字足够，无需 SVG 或文档重构。三状态新增本 feature，保留并行与历史章节。
- Notes：此前 timer 恢复、active ID、手动请求悬挂问题按用户要求未修，不扩大范围。无 UI、依赖、生成产物修改或 Git 写操作，改动未提交。

---

## ui-ux-review-optimization（done，2026-09-16）

- 目标：全面评审并优化 UI 与交互设计（视觉/交互/状态完整性/无障碍/操作安全性），问题明确、风险可控的直接实施。
- 评审：以真实用户数据实例（本地 5176 + Playwright MCP）实测主界面、设置 17 tab、定时任务、MCP、确认弹窗与移动 375px 视口，产出分级问题清单 docs/reviews/app-ui-ux-review-2026-09-15.zh-CN.md（B01-B12，6 张截图 review-01~06 佐证）；B12（任务卡片整卡 div onClick 键盘不可达）有更多操作菜单补偿，保留现状。
- 修复（11 项）：confirm-dialog 模块级互斥 + focus trap + 关闭后焦点恢复；备份替换导入 destructive；移动 drawer Escape/焦点移入/恢复；ReactSettingsTab 延迟卸载（消除设置 tab 切换的 React sync-unmount 报错）；switch 可访问名称（MCP/定时任务）；toast 语义分级（error=alert 其余 status/polite）；常规页 3 数字输入 aria-label；执行模式下拉 label 与冒号统一；折叠项目不暴露 loading 占位。i18n en/zh 成对新增（mcpEnabledSwitchLabel/executionAgentLabel 等）。
- 验证：父 Agent 亲读全部 diff 复审；定向 vitest 4 文件 32/32（新增 tests/frontend/confirm-dialog.test.ts 6 例）、tsc -b、11 文件 ESLint exit 0；Playwright 复查：弹窗初始焦点取消/Enter 走取消/Tab 循环/Escape 关闭、4 次 tab 切换 0 console error、switch 标签语义一致、375px 无溢出、drawer 焦点与 Escape 正常；全量 test 355 files/4053 passed+1 skipped、lint 0 error（既有 3 coverage warning）、build 成功（既有 chunk warning）。
- 边界：破坏性流程（备份替换导入、真实删除）只打开弹窗后取消，未在真实数据执行确认；toast 成功态未触发真实任务通知；pi-web-ui 外部包不可控部分未纳入；对比度抽样。docs/wiki/src/components/README.md 已同步 confirm-dialog 行为契约与 toast 语义。
- Notes：工作区存在多路并行未提交改动，本 feature 不认领不回退——server/routes/scheduled-tasks.mjs + tests/server/scheduled-tasks.execution.test.mjs（runPrompt 分发，另一会话）、goal-attachment-missing-marker 系列；两者均含于全量 4053 通过内。评审期 vite dev 进程后期异常终止（404/CONNECTION_RESET）属环境问题；实际验证改用运行中的生产实例（服务 dist）。B12 与「项目删除语义待确认」记录在评审文档，不做扩大修改。

---
## goal-attachment-missing-marker（done，2026-09-15）

- 自主选题（用户授权休息期间推进一项低风险高价值改进）：并行 Explore 三候选后选定本项。未选理由：审批迟到 approve（生产不可达：超时即删 Map 条目，路由 404 + goal 状态机双守卫）、/plan 权限前置缺口（所有赋值路径均设置 permissions，不可达）、MCP 名称 lowercase（纯 UX 文案级）价值不足；subagent 测试缺口"评审高-2"系静态检索误判（见下方勘误）。本项为可复现正确性问题且是 goal-persisted-attachment-paths 明确遗留的边界。
- 修复：`server/agent-goal-runner.mjs` 的 goalAttachmentPrompt 注入前 `existsSync` 检查：文件缺失 → `(attachment file no longer available: <原路径>)`；path 空 → 原 `(no readable path recorded)`；存在 → 原样注入路径。新增 `import { existsSync } from 'node:fs'`。
- 测试：`tests/server/agent-goal-runner.test.mjs` 既有附件用例改用 `os.tmpdir()` 真实临时文件（原假路径 `C:\Users\test\notes.txt` 不测可读性）；新增文件缺失失效标注用例（断言精确标注 + `not.toContain` 防可用形式裸注入）与空 path 用例（固化既有行为）；夹具 mkdtemp + 登记 + afterAll rmSync force，不触碰 process.cwd()。
- 验证：父 Agent 亲读全部 diff 复审后独立重跑；定向 vitest 141/141、两文件 node --check、npx eslint 0 error 均 exit 0；测试后 os.tmpdir() 与仓库根 goal-attachment-* 零残留（仓库根仅存 .goal-runtime-refactor-baseline 为前次 Goal 特意保留基线，非本次产生）；package.json/package-lock.json 无 diff；无 Git 操作。
- Notes（遗留与勘误）：① 附件文件存在但位于 workspace 外（`~/.quickforge/cache/global/tmp/conversations/...`）时模型 read_file 必然 403（`server/utils/workspace.mjs` resolveWorkspacePath 无附件豁免）——沙箱豁免 vs 内容内联需产品决策，未做；② 失效状态持久化进 goal.attachments 需动 schema，未做；③ `server/message-converters.mjs` 普通消息附件内联读取失败静默返回空串，独立范围；④ 勘误：zombie-code-safe-cleanup Notes 中"可选补强 agent-subagent-runner 行为测试与 SQLite worker 冒烟（评审高-2）"大部分为静态检索误判——`tests/server/agent-manager.subagents.test.mjs`（14 用例）已通过 createAgent→run_subagent tool.execute() 真实驱动 runner 本体，`tests/server/sqlite/session-state-worker.test.mjs`（6 用例）已是真实 worker_threads+SQLite 冒烟；残余缺口仅 subagent 工具审批编排（type:'subagent' 元数据）、maxToolCalls 超限 block、前置校验 400 三项，价值中低，未补。

---

## batch-commit-push-2026-09-15（done，多会话成果汇总提交推送与发布收尾）

- 按用户指令将此前多个并行会话的全部未提交成果以单个汇总提交落地并推送：提交 `ace9930`（142 文件，+17132/−9840）已同步 origin/dev；推送前全量 test 353 files / 4037 passed + 1 skipped、lint 0 error（仅既有 coverage 3 warning）、build 成功（仅既有 KaTeX/chunk warning）。
- 推送 rebase：远端 dev 含 v2.1.0 发布 4 提交，三状态文件冲突按「本仓归档后版本为主体 + 远端 release 收尾记录插回主文件」解决，其余远端历史条目本已在 docs/archive；冲突解决后定向复跑远端改动两测试文件 46/46 通过。
- 发布收尾：npm 2.1.0 已确认发布成功，2026-09-15 实查 registry `version=2.1.0`、`dist-tags.latest=2.1.0`；下方 release-v2.1.0 段的「npm 等待双重验证」为当时状态，已闭环。
- Notes：`.playwright-mcp/`、`server.name`、`test-screenshot.png` 本地产物未提交也未 ignore；远端 master 落后 dev 1 提交待按需快进；此前历史记录中「未提交/无 Git 操作」表述已被 ace9930 覆盖，不逐段改写。

---

## retry-error-only-continue（done，2026-09-15）

- 用户报告：普通对话点「重试」按钮实际发送的是「继续」。调研确认根因：`retryFromMessage`（useChatActions.ts）用 `hasToolResultsAfter` 判定——回合只要跑过工具就追加发 i18n `errorContinueMessage`（『继续』），成功回合也命中，与按钮语义错位（该分支随 commit 835bebc「重试保留工具历史」引入，原为防副作用重放）。
- 用户决策：正常对话重试→裁剪历史重发原消息；回合报错后的重试→保留历史追加「继续」。
- 实现：`message-utils.ts` 删 `hasToolResultsAfter`、新增 `turnEndedWithError`（回合边界止于下一条 user 消息，谓词与 turn-error-row `isErrorMessage` 一致：stopReason==='error' 且 errorMessage 非空）；`useChatActions.ts` 换判定并改注释；`turn-error-state.ts` 仅同步模块头注释（逻辑零改动）。
- 测试：`message-utils.test.ts` 旧 3 用例替换为新 6 用例（错误+工具、纯文本错误、成功含工具 false、旧回合错误不计、回合边界、aborted false）；`turn-error-state.test.ts` 仅注释。
- 验证：父 Agent 亲读 diff；定向 vitest 4 文件 195/195、相关 5 文件 ESLint、`tsc -b` 全部 exit 0。
- Notes：成功回合含写工具的重试现在会裁剪重试，模型可能重复执行副作用——用户明确接受。服务端 `/continue` 两种模式未改；docs/wiki 无相关记载无需更新；未跑全量，无 Git 提交。

---

## release-v2.1.0（done：Git/CI/npm 发布全部完成）

- 最终状态（覆盖初始发布记录，初始阶段记录已随 2026-09-15 全量归档移入 docs/archive/progress-archive.md）：本轮实时核验远端 dev/master/v2.1.0 与 HEAD 为 `baaa041cc2a37e49038da46cec4c7d2ca6272f59`；本地 master 仍为 `9ded6c0`，并非四 ref 同步。发布提交 `6ad3489`，CI 测试修复 `6252e2d`（固定中文）及 `baaa041`（sleep 5→20ms，保留 >=5 断言）。
- 当前 HEAD 重跑硬门禁：test 323 文件 / 3649 全过，lint/build 退出 0；仅既有 identity.mjs:92、KaTeX/chunk warning。CI [34797256759](https://github.com/shawnstack/quickforge/actions/runs/34797256759) 与 Desktop Build [34797259067](https://github.com/shawnstack/quickforge/actions/runs/34797259067) 网页 Success，完整 SHA 匹配；API 限流。
- 包核验：`package-offline/shawnstack-quickforge-2.1.0.tgz`，7486125 bytes / 471 文件，SHA1 `7c952caa07a39971fdd4dbf74acd899238495d0c`；402 个 dist/server/bin 文件与当前构建逐字节一致，无需重打。
- npm：已登录 shawnstack，用户明确授权发布；当时 publish 退出 1（EOTP）。（已闭环：用户完成双重验证后发布成功，2026-09-15 实查 registry version=2.1.0、latest=2.1.0。）
- Notes：三状态文件更新当时未提交（后随汇总提交 rebase 并入 dev），未再次移动 tag；未知零字节文件 `x[1])` 未触碰。无架构/公共入口变化，无需同步 Wiki。

---

## builtin-playwright-mcp（done，最新：UI/API 内置删除保护）

- 保留 `npx -y @playwright/mcp@latest` 原样、默认关闭、已有同名配置及启用状态；未新增依赖或修改 Desktop。
- 读取为规范化名称 playwright 派生 `builtin: true`，不信任输入、不落盘；删除在 normalize 后、`atomicUpdate` 前返回 409。普通 MCP 删除行为不变；批量 replace 遗漏 playwright 后仍读到关闭预置。
- 卡片展示中性“内置”标签，隐藏删除，保留编辑、启停和重连。README、server Wiki 与三状态已同步。
- 改动文件：`server/mcp/config.mjs`、`src/components/mcp/mcp-server-card.tsx`、`src/lib/types/mcp.ts`、`src/lib/i18n.ts`、MCP config/routes/card 测试及上述五份文档；文件清单见 feature_list.json。
- 验证：父 Agent 已执行 MCP config/registry/routes/card 四文件定向测试、定向 lint、build 整链，exit 0；当前定向测试全部通过，未取得用例总数，不推测，不冒称本次全仓 test/lint。
- Notes：本次 General 意外清空未跟踪的 `tests/server/mcp-config.test.mjs`；父 Agent 依据本会话已读取的测试内容重建覆盖并补行为测试，不声称逐字恢复。本次文档子任务仅编辑五份文档，不触碰任何源/测试文件。无 Git 操作或全局配置变更；不继续旧 Desktop/离线方案，不声称浏览器端到端验收。
- blocker：无。下一步可重启运行中的源码版检查设置卡片；以下为历史记录，不代表当前行为或待办。

---

## 历史完成记录：goal-persisted-attachment-paths（done）\n\n- Goal 创建时将原始用户消息中的附件元数据持久化到 Goal，兼容旧快照；规划与后续执行提示词均追加文件名和完整路径。\n- 改动：agent-prompt-commands、agent-goal-runner、agent-goal-state、src/lib/goal，以及 Goal runner 回归测试。\n- 验证：定向 Goal 测试 4 files / 206 tests 通过；相关 ESLint 与 `tsc -b --pretty false` 通过。\n- 边界：未改变附件文件生命周期、workspace 权限或普通消息转换；附件文件若过期/不可读仍需后续独立处理。\n\n---\n\n## 历史阶段：builtin-playwright-mcp（done，npx 简化；删除行为已由顶部保护方案替代）

- 已撤回过度实现：Playwright production dependency、浏览器资源发现/安装脚本、Desktop资源打包与环境注入、UI内置标签和编辑删除限制。本任务新增五个独有文件删除；package/lock通过npm同步，其他未提交成果保留。
- 最终仅在 config.mjs 动态预置 `npx -y @playwright/mcp@latest`，默认关闭、上游默认可见浏览器。已有同名完整优先，首次启停原子落盘；允许编辑，删除用户配置后读到关闭预置。满50服务时首次落盘返回409且store不变。
- 验证：MCP三个测试文件62 tests通过；定向ESLint、父Agent全仓lint/build通过（既有coverage/font/chunk warning保留）。未再次运行浏览器或改全局配置；README/Wiki和三状态已同步。
- Notes：旧Desktop下载/打包阻塞不再属于新范围，不重复执行。此前生成/下载目录未清理，避免误删；无Git提交。旧Goal的运行时状态未修改，不声称其原验收通过。

## 历史方案（已撤回）：builtin-playwright-mcp（2026-09-15）

- 已完成第一阶段：固定安装 `@playwright/mcp@0.0.81` production dependency，并新增 `server/mcp/builtin.mjs`：Playwright 服务使用当前 Node + 包内 `cli.js`，不再依赖 npx/@latest，默认 disabled、`--isolated`；已有同名配置保留启用选择但强制使用内置入口。
- 设置卡片已识别内置服务，显示“内置”并隐藏编辑/删除，保留启停/重连；MCP 类型增加 builtin 字段。README 已补充默认关闭、隔离 headed Chromium 与浏览器二进制/离线边界。
- 验证：官方 npm 元数据确认 0.0.81 及 Playwright 1.64 alpha 依赖；MCP config/registry/routes 定向 43 tests 通过，内置配置单测和定向 eslint 通过，`npm pack --dry-run --json` 成功。尚未完成 Desktop 浏览器资源打包、真实 QuickForge 内置服务连接冒烟、完整 test/lint/build 与 Wiki/三状态最终同步。
- 本轮补充：内置定义使用 Playwright `chromium.executablePath()`，存在时传入 `--executable-path`；浏览器缺失时 registry 返回明确安装提示。真实内置配置独立 smoke 仍成功（tools/list 26、about:blank、close）。MCP 定向 44 tests、定向 eslint、build/lint、npm pack --dry-run 均通过；lint 仅既有 coverage warning。
- 本轮补充：完成 Desktop `extraResources` 可选浏览器资源契约（通过 QUICKFORGE_PLAYWRIGHT_BROWSERS_PATH 注入，未配置时不改变现有构建）；新增 packaging contract 2 tests；Wiki server MCP 导航补充内置服务、固定入口和缺失诊断。全量 test 352 files / 4015 passed + 1 skipped，build/lint 仍通过（既有 coverage 3 warnings）。
- blocker/risk：浏览器资源 helper 当前按配置目录直接复制，尚未完成跨平台浏览器目录结构映射与真实 Desktop 安装包运行验证；因此仍不能宣称完整离线可用。浏览器资源下载与 Desktop 构建此前超时；本轮最终链路 `npm run test && npm run lint && npm run build && npm pack --dry-run` 全部通过（354 files / 4021 passed + 1 skipped，lint 仅既有 coverage 3 warnings）。由于资源未实际落盘，仍无离线运行证据。

## configure-playwright-mcp（done，2026-09-15）

- 用户授权为当前 QuickForge 实例全局配置 Playwright MCP，选择可见窗口；核对本地实例及当前项目后，通过单服务 PUT 新增 playwright，stdio / npx / `-y @playwright/mcp@latest`，保留其他配置。
- 验证：官方 help 确认默认 headed；实例状态 connected、enabled=true、26 tools、无错误。同参数独立 SDK 客户端成功打开 about:blank 并关闭浏览器；不是当前聊天直接调用工具的端到端验收。
- 仓库仅补充 feature_list/progress/session-handoff；无源码、依赖或生成产物修改，无 Git 提交。真实连接/浏览器检查替代无关全仓 test/lint/build；未改变架构或入口，既有 MCP Wiki 无需更新。
- Notes：工作区大量既有未提交改动保持不动、不认领。General 空返回后父 Agent 检查服务仍不存在，再亲自完成配置与验证；最初分号串联诊断不兼容当前命令环境，拆为单命令后成功，不影响配置结果。无 blocker。

## 四项拆分最终核验汇总

- 实现顺序已落实：manager访问模式/状态SSE查询/审批应答；workspace Git/浏览搜索/文件预览/请求控制；App终端/Git/加载过渡；Inspector布局/tab/Git review。四feature均done，具体文件见feature_list.json；未声称主入口所有职责均已拆尽。
- 最后源码验证：07:50UTC完整npm run test、npm run lint、npm run build成功。此前cloud/qf-agent-process计时失败隔离与默认全量复跑通过；旧runtime-diagnostics等失败历史保留如下。构建字体/chunk warning仍在。原/新Inspector相同16行为、App14行为对照均过；无DOM测试不等同浏览器/StrictMode验收。
- 最终范围：相对05:10UTC的791文件执行hash基线，42个本Goal相关路径（含新增）全部属于四feature文件清单；9个并行scheduled路径、3个历史cleanup删除、7个初始hash未收录的报告/reviews/mockup/archive明确排除，不回退、不认领。共享Wiki和三状态保留并行章节。package.json/package-lock.json和HEAD未变，无tracked生成物diff；build只正常生成dist，未手工改产物、未commit/tag/push/发布。
- 范围审计保存在忽略目录 `.goal-runtime-refactor-baseline/final-scope-audit.json`，原四源码快照及baseline.json保留用于可选重放与审计；不是测试泄漏，不在此处删除。已确认的0字节单引号命令残留已清理。后续清理快照会让显式QF_*_BASELINE_TEST模式不可用，但不影响默认CI。
- 文档：五个相关Wiki保留模块职责和phase调用/owner边界，修正四feature验证栏中的过时“待下一步”；没有全库去行数化或视觉重设计。最终补记前的全部progress/handoff和无关feature以hash验证保留。无剩余实现待办；测试时序波动、构建warning及浏览器验收局限如实保留，不扩大本Goal。

<!-- final-audit-history -->
## refactor-workspace-inspector-split（done，三域实现与验证完成）

### Git阶段/完整验证追加
- 新useInspectorGit229行，入口1872行；按需review/status/filters/actions/inline diff迁移，共享projectGuard/跨域reset与卸载abort、diff reader跨tab留入口。props/格式/UI不变。
- Git搬前5原AST+39关联44过；最终原Inspector与实际三域hooks同16例分别通过，21effects同序/同回调，4 JSX+props逐字相同、27actions体归一一致。
- 完整test/lint/build最终通过（07:50UTC命令exit0）；首次全量仅cloud/qf-agent-process重启计时失败（runtimeChildren期望2实际1），隔离及默认全量重跑通过，未改无关实现。构建仍有既有font/chunk warning。成功日志截断未确认总数，不猜测。
- 失败修复：一次cmd解析失败，源码未写；机械unused清理跨函数误删同名isGitRepository state被tsc拦住，已还原；2旧源码断言改读真实Git模块保留强度；稳定setter/ref deps补齐，applyGitStatus原project-only callback身份通过局部有理由lint例外保留。
- 范围初审：基线hash变化除四feature外还有并行scheduled与cleanup后三个死文件删除，不回退/认领；package与lock不在基线差异列表。发现0字节单引号命令残留（05:39时间）核实后删除。原快照目录保留，最终范围证据与Wiki/四状态终验待下一步。

### 前阶段历史

### tab阶段追加
- 新useInspectorTabs181行，state/effects/actions真实接入，入口2048行。tab复用/排序/关闭/运行时订阅及project+session持久化抽离；request/scope guard和共享updatePanelTab仍在入口，文件缓存/树不动。
- 搬前5原AST行为+31关联共36通过；搬后同36通过，最新全前端171文件2093用例、tsc -b、定向eslint零warning通过。原快照布局/tab同11例重放通过；21effect原序/回调、4JSX逐字相同、18action体归一一致，updater原样。
- 失败修复：首次字符串唯一匹配发现子组件同名menu状态，assert失败未写文件，改Main组件AST精确匹配。多余import清理；4旧源码契约失配改指真实tab模块未弱化断言。自动dep建议曾加入不稳定updatePanelTab，经复核恢复原project-only缓存callback身份，局部说明并禁用该一行deps检查；新hook mount-only ref初始化保留原模式，仅该段refs lint例外（不全文件禁用）。
- 本阶段另改inspector-tabs-hooks测试、inspector-domain-fixture扩展props、workspace-inspector-tabs与side-chat-workspace-tab源码定位；wiki与三状态。测试非DOM非StrictMode；无提交/依赖/产物修改。Git review仍须先保护后抽离，最终全仓验收待后续。

### 布局阶段历史

- 已搬迁：新增useInspectorLayout.ts，state/viewport/visibility/width/actions按phase调用；双面板resize、全屏动画、宽度持久化/viewport clamp从Inspector抽离，入口2544→2194行。tab与Git review未搬，c4尚未通过。
- 文件：Inspector、useInspectorLayout、inspector-layout-hooks.test.ts、helpers/inspector-domain-fixture.ts；width-range和mobile-fullscreen源码断言改定位真实模块（保留断言），components wiki和三状态。
- 验证：搬前13文件97基线及6原AST行为用例通过后才移动；搬后14文件103通过，原快照重放同6通过；21effect回调归一同序，4外层JSX及props逐字一致。定向eslint零warning/tsc -b通过，全前端170文件2088用例通过。未运行最终全仓test/lint/build。
- 失败记录：3次Explore空返回，父直接读源码/测试/docs完成调研。机械生成多余解构被lint拦住，NAV宽度常量未导出被tsc拦住，均修复；一次cmd嵌套引号语法失败未写文件，改专用edit/短命令完成。没有修改生产行为以规避测试。
- Notes：布局测试无DOM同步harness，覆盖resize边界/RAF合并与取消、body恢复、180ms关闭、640自动展开、mobile跳过clamp、240ms全屏/Escape/afterExit；不宣称浏览器或StrictMode验收。保留原nav结束清空body样式、全屏RAF既有语义，未额外修复边界。
- 下一步：当前Inspector feature继续tab持久化/复用/scope编排，随后Git按需review，各自先补搬前测试。原快照.goal-runtime-refactor-baseline/Inspector-before-split.tsx不能清理；QF_INSPECTOR_BASELINE_TEST=1仅本地显式布局审计，默认CI测真实hook。无提交/依赖变更/手工产物修改。

---

## refactor-app-main-split（done，Goal第三项）

- App 2618→2362行；新增useAppTerminal74/useAppGit148/useAppLoadingTransitions136行，分phase hook保留effect相对顺序；共享project ref与scope invalidation留App，基础hooks/URL owner未动，10段最外层JSX逐字相同。
- 文件：App、三个hooks、app-domain-hooks.test.ts、hook-lifecycle-harness.test.ts、helpers/{hook-lifecycle,app-domain-fixture}.ts；git-status-request-lifecycle及workspace-inspector-tabs仅适配真实实现/稳定ref依赖断言；wiki/src与hooks导航、三状态。
- 验证：先11文件93基线；原App AST抽取14行为先通过后搬迁；父最终将相同14例对原App快照和真实hooks各跑全过，加2例harness自身验证。覆盖终端确认/旧回执/监听清理、Git旧结果/400ms刷新/菜单、1350/280ms及双RAF过渡/token隔离。父07:05UTC完整test/lint/build exit0，截断未确认全量总数，不猜测。
- 失败/修复：前期fixture漏toolName、CRLF和scope源码位置断言失配已修；harness no-this-alias早期lint问题已处理（并行scheduled历史记录不改写），最终全仓lint通过。独立review发现harness cleanup/setup交错，父改为分阶段并增加自测；无生产行为修复。
- 边界：测试无DOM，不等于React StrictMode/并发/浏览器验收。QF_APP_BASELINE_TEST=1仅本地审计显式读保存快照，常规CI只测真实hook。保留既有font/chunk warning，不新增依赖、不提交、不手工改产物；并行scheduled成果保留。
- 下一项Inspector三域先Explore与搬前保护；全部完成后再最终全量及执行基线范围验收。.goal-runtime-refactor-baseline含App原快照请保留。

---

## refactor-routes-workspace-split（done，Goal第二项）

- 原workspace入口1948→594行；新增workspace-git-service681行、workspace-browser-service527行、workspace-file-service193行、workspace-request-control42行。17个原出口不变，120个顶层函数体和常量逐字一致且仅一份，调用新模块无反向facade环。
- 验证：搬迁前9文件76基线及新增7契约测试通过，搬迁后10文件83通过；AST/语法/零warning lint通过，独立Explore未发现阻断。默认最终全量347文件3946 passed+1 skipped，npm run lint/build通过（既有字体/chunk warning）。
- 失败历史：机械脚本误多self re-export导致duplicate exports，删一行后测试全过；格式脚本cmd引号解析失败未改文件，修正重跑。全量另发现第一feature遗留session-index-lifecycle源码断言位置失配，改读实际queries实现保留断言；随后复跑遇runtime-diagnostics elapsedMs4<5ms既有flake，隔离通过再默认全绿，未改无关实现。
- 范围：本Goal没改其他生产功能/依赖/样式，无提交；并行scheduled-tasks feature已完成，保留其状态及文件，不认领。workspace原文快照保存.goal-runtime-refactor-baseline/workspace-before-split.mjs供最终比对。
- 下一项App，随后Inspector；最终验证须在全部完成后再次运行。本节全量结果仅当前两个后端阶段。

---

## refactor-agent-manager-split（done，Goal第一项）

- 已抽离访问模式、状态/SSE查询、审批/ask应答三个域，facade实际接入且保留出口。主文件1946行；新模块agent-access-mode18、agent-session-queries139、agent-approval-responses73行。
- 新增agent-manager-domains测试11用例；状态/应答搬迁前后相同19文件297用例通过；函数体AST归一比对、node语法检查、零warning定向lint、diff check通过。
- query factory依赖注入避免新增反向manager环；唯一store不变，SSE未设置返回undefined、abort UI掩码与raw busy区别、ask截断/错误均保留。
- 失败记录：general空返回半成品曾误增4个facade出口；contract检测失败后父Agent修复，未放宽测试。未接入模块曾含错误abort替代，已用原函数搬迁覆盖且abortToolCall留主文件。后续两次general空返回无进展，父Agent完成测试与AST搬迁。
- 基线：`.goal-runtime-refactor-baseline/baseline.json`记录791文件SHA256和初始Git状态；目录为本Goal诊断产物而非测试泄漏，后续范围验收前保留。另存manager-before-domain-move.mjs用于函数体比对。初次分号串联命令在cmd失败，后用单Node脚本记录成功。
- Notes：并行scheduled-tasks源码/UI/测试正在变更；不回退、不认领。原Goal/server-agent/zombie等成果保留；未新加依赖/提交/手工生成产物修改。
- 下一项：routes/workspace.mjs；其后App、Inspector。最终全量test/lint/build和全Goal范围检查待后续。

---

> 归档说明（2026-09-15 全量）：主文件已按用户要求清空为全新状态，全部历史条目（含 Notes）在 docs/archive/progress-archive.md；feature 条目对应归档在 docs/archive/feature-list-archive.json；会话交接归档在 docs/archive/session-handoff-archive.md。新 feature 记录从本文件重新开始。

## scheduled-tasks-manual-frequency（done，2026-09-15）

### 复审收尾（06:03 UTC，以下覆盖本节早期验证结论）
- 补同步 parse/save 互斥、taskId action 去重与忙态、失效解析响应保护、单次/间隔独立日期草稿；保留历史锚点秒毫秒。
- 补 interval 首次锚点+间隔的 Date 溢出防护；新 Cron 严格验证与历史运行兼容分离；真实 30 秒 scheduler tick 测试覆盖 parallel 开始推进、serial 长任务越槽、pause/resume 不补跑。
- 验证：前端2文件47、后端2文件93、扩大10文件177 tests通过（非全新增）；父06:00全量347文件3982 passed+1 skipped；06:02本功能9源/测试ESLint零warning、独立build通过（既有font/chunk warning）。
- Notes：最终全仓lint失败于无关并行 `tests/frontend/helpers/hook-lifecycle.ts:33` no-this-alias，另coverage3 warning；未扩大修复。此前05:42全量链式通过仅代表第一版，不冒充最终全绿。
- 边界：实现保留现有页内编辑而非HTML抽屉；准确nextRunAt保存后返回；未做浏览器E2E或视觉验收、不承诺100%覆盖。未新增依赖/提交；build正常产生dist，未手工修改生成产物。

### 第一阶段记录

- 当前目标：用户确认后实现手动六频次；本轮只推进该 feature，不处理其他计划中的拆分。
- 前端：分段频次选择 + 动态字段（单次、分钟/小时/天间隔与首次时间、每日时间、星期多选、1–31 月日期、五字段 Cron）；默认每天，无需 AI 解析；规则摘要、设备/服务端时区提示、表单校验、解析/提交禁用、失败保留草稿；AI 回填可编辑 Cron，手改清除过期解析结果。
- 后端：结构化 intervalValue/intervalUnit/executeAt；以原始锚点计算下一槽位，跳过错过时间、不按完成时间漂移。weekDays 非空整数组合并兼容 weekDay；类型切换清理旧字段；Cron 支持列表与数字起点步长并拒绝部分非法字段。旧中文 interval rule 可兼容读取。
- 文件：ScheduledTasksPage.tsx、新 scheduled-task-form.ts、i18n.ts、server/routes 与 utils 的 scheduled-tasks.mjs；前端两测试、后端两测试；components/routes wiki 与三状态。
- 验证：定向 Vitest 4 files / 104 tests 通过；扩大 `npx vitest run scheduled` 9 files / 137 tests 通过；相关 ESLint 无 warning、tsc -b、相关 git diff --check 与状态 JSON 检查通过。6 页面用例使用 hook-state harness 调用真实交互 handler，另 26 表单、41 工具和 31 API/执行用例；不是浏览器 E2E。首次新增 API fixture 使用字符串 stream 导致 10 fail，改为实际 Buffer 请求体后全绿，无生产规避。
- 文档：同步频次字段、时区、月末/错过槽位语义和兼容边界；已考虑 SVG，字段表比流程图更适合此契约，未新增装饰图。
- 边界：未新增依赖、未修改生成物、未提交 Git；未跑全量 test/build，采用定向测试+lint+tsc 防止写入生成目录。保留前序/并行修改。准确 nextRunAt 由服务端保存计算，界面只即时预览规则；Cron 沿用日/周 AND 和 366 天搜索窗口；间隔天=24小时。

---

## p0-goal-runtime-testdir-hygiene（done，残留治理与测试修复完成）

- 目标：消除 `.goal-runtime-*` 测试目录污染。
- 实现：`.gitignore` 增加 `.goal-runtime-*`；`agent-goal-runtime.test.mjs` 改用 `os.tmpdir()`，增加 `afterAll` 延迟兜底清理；删除仓库根目录现存 109 个测试残留目录。
- 验证：定向 Vitest 15/15 通过（复跑 2 次），ESLint 通过；修复后仓库根目录与系统临时目录均无新残留。
- 边界：未修改生产日志器；无 Git 提交。

---

## p0-coverage-provider（done，coverage 脚本修复完成）

- 目标：修复既有 `test:coverage` 脚本。
- 实现：新增 `@vitest/coverage-v8@4.1.8`；`vitest.config.ts` 增加 V8/text+HTML coverage 配置；`.gitignore` 忽略 `coverage`；`package-lock.json` 已同步。
- 验证：`npm run test:coverage` 全量 331 files、3718 passed、1 skipped；总行覆盖率 49.98%。
- 边界：未设置 coverage threshold；`vite.config.ts` 经核实无 test 段，因此未修改；无 Git 提交。

---

## backend-test-gaps-fill（done，后端缺口测试完成）

- 目标：补齐审批/MCP/supervisor/network-proxy/compaction 测试。
- 实现：新增 8 个测试文件，覆盖审批状态与超时 fail-closed、MCP 配置与工具名、compaction、network proxy 运行时、restart/update supervisor。
- 验证：定向 Vitest 9 files、244 tests 全部通过；定向 ESLint 通过。
- 边界：测试按当前源码行为固化，记录但未修复潜在行为问题；未运行全量验证。

---

## server-agent-guard-tests（done，拆分保护网评估完成）

- 目标：为 `server-agent.ts` 拆分确认现有行为保护覆盖。
- 结论：已有 `server-agent.test.ts` 140 用例覆盖 SSE 退避、重连上限、手动重试、health timeout、状态恢复与事件派发；无需重复新增大量测试。
- 验证：`server-agent.test.ts`、`file-rollback-api.test.ts`、`deferred-session-agent.test.ts` 共 188 tests 通过；TypeScript 检查通过。
- 边界：`fetchActiveAgentStatuses`、部分订阅资源释放及若干审批 API 的直接断言仍有限，作为后续拆分风险点。

---

## refactor-server-agent-split（in_progress，第一阶段）

- 目标：按行为保持优先，拆分 `server-agent.ts` 并逐步收敛事件类型。
- 当前完成：新增 `src/lib/server-agent-types.ts`，迁移 18 个公共类型及 `GoalIterationMarkerSnapshot`；原 `server-agent.ts` 通过 type import/re-export 保持公共导出路径兼容，未移动 SSE、fetch helper、ServerAgent 类或事件逻辑。
- 验证：相关 3 个前端测试文件 188 tests 通过；`tsc -b`、定向 ESLint、`git diff --check` 通过。
- 下一步：先抽离无运行时循环的 SSE/HTTP 基础边界，再处理 ServerAgent 事件类型收敛；每一步保持现有公共导出与测试契约。

- 本轮追加：新增 `src/lib/server-agent-http.ts` 与 `src/lib/global-agent-sse-client.ts`，迁移 `fetchJsonWithTimeout`、GlobalAgentSseClient、全局单例及 SSE 连接状态 API；`server-agent.ts` 保持原公共导出路径并增加兼容导航注释。6 个相关前端测试文件共 249 tests 通过，tsc、ESLint、git diff --check 通过。

---

## zombie-code-safe-cleanup（done，三 Phase 清理与全量验证完成；2 个既有 flake 已隔离复跑确认）

- 当前目标：接续本轮僵尸代码只读评审，用户授权处理「可安全处理、不影响功能」的部分；新增独立 feature 无依赖，不推进其他事项。
- 方法：三路 explore 只读评审 → 父 Agent 逐条亲验 → 三个 Phase 由 general subagent 顺序实施（每步删除前重新 grep，防并行会话写入导致引用变化）→ 父 Agent 亲读关键 diff + 终验。
- Phase 1（零风险）：删 server 死导出 isGoalRunActive / isGoalInFlightStatus / isValidGoalId 及孤儿常量 GOAL_ID_PATTERN；删 src/lib/goal.ts 死薄包装 goalCanAccept（goalAcceptanceCheck 保留）；删 Android Capacitor 模板遗留 ×2 + icon-preview.png；goal-test-demo.md 归档 docs/archive/；修复 scripts/session-index-query-benchmark.mjs 悬空 import（现行 API 重写，smoke run equivalent:true）。server/cloud/index.mjs 因并行会话新增 tests/server/cloud/index.test.mjs 引用而保留。
- Phase 2（Goal 计划确认死代码簇，净删约 1200 行）：goal-card.ts 821→212（仅留 viewmodel）；删 goal-plan-confirmation.ts 空壳 + goal-card-controller.test.ts（19 用例全测死代码）+ goal-plan-confirmation.test.ts；ChatPanelHost 三处死接线；local-tools 空 mount；index.css 死区 -386 行；i18n goal 域扫描删 14 对死 key（goalConfirm 活引用保留）；goal-card.test.ts/goal-report-renderer.test.ts 同步（viewmodel 断言与 goal-mode-i18n 未提交断言完整保留）。
- Phase 3（非 goal 域 i18n 死 key）：动态消费穷举（唯一动态前缀 migration.phase.* 保留）→ 带引号精确匹配扫描 → 删 175 对死 key（1810→1635，-350 行）；同步 assistant-artifact-card.test.ts 2 处死断言（含 1 处冒号形式盲点，测试运行暴露后补扫确认仅此 1 处）。
- wiki：components README「Goal 聊天计划确认」改记已移除；lib README 回归清单去 goal-card-controller。
- 已验：全量链式 test+lint+build 退出码 0；复跑全量出现 2 个时序 flake（persist-session-state beforeEach 10s 超时、runtime-diagnostics elapsedMs 4<5ms），隔离复跑 28/28 全过含原失败用例、与改动面无交集；分 Phase 定向 192/374/1034 tests 全过 + tsc/eslint 0 error + 残留 grep 零命中 + i18n en/zh 对齐（1796/1635 两阶段均相等）。
- Notes/边界：有意不做（待产品决策）：confirm 恒假链、6 个零调用路由（wiki 记载兼容旧客户端）、isSessionTextAttachmentPath 接线、SignalReconnectBackoff、82 个 export 冗余。Android 未跑 gradle（仅 grep 零引用验证，模板遗留风险极低）。根目录垃圾文件已被并行会话先行清除。工作树并行/前序未提交改动完整保留无冲突。未新增依赖，无 Git 提交。
- 下一步：待用户决策项见 Notes；可选补强 agent-subagent-runner 行为测试与 SQLite worker 冒烟（评审高-2）；改动未提交。

---

## refactor-server-agent-split（in_progress，2026-09-15 本阶段收尾与事实勘误）

> 本节更新此前本文件中后端用例计数、保护网仅评估及全量尚未执行等阶段性记录；保留旧记录与并行 zombie-code-safe-cleanup 全部成果，不代表五个巨石已全部完成。

- 已完成拆分：`server-agent.ts` 2782→2236 行；新增 `server-agent-types.ts` 245 行（18 个原公共 type + 1 个内部 marker snapshot）、`server-agent-http.ts` 16 行、`global-agent-sse-client.ts` 340 行。旧入口 type/value re-export 保持兼容，抽离模块无反向主类依赖；watchdog、状态/消息对账及业务事件仍在 `ServerAgent`。
- 事件类型：删除 11 处冗余 AgentEvent 断言，剩余 20 处原始 SSE / 自定义事件 / 轻通知边界尚未完整收敛，当前 feature 保持 **in_progress**。伪源码注释已删除，相关源码契约测试已改为定位真实模块，不再用注释伪装原入口中存在实现。
- 前端保护网勘误：`server-agent-guard-tests` 不仅评估既有 140 用例；新增 `server-agent-http.test.ts`、`global-agent-sse-client.test.ts` 共 13 用例。最新前端定向 10 文件 293 tests 通过。
- 后端计数与隔离勘误：新增 8 测试文件原为 104 用例；supervisor 使用 fail-closed preload 后由 6→10，现为 **108 个后端新增用例**，另新增 `tests/server/helpers/supervisor-fixture.mjs` 与 `supervisor-preload.mjs` 两个夹具。此前 244 是含前端的混合定向数量，不能计为后端新增。supervisor 测试拦截 spawn，绝不启动真实 npm/server；失败 finally 等待唯一真实 Node 子进程 close 后才删除 fixture。
- 最新验证：父 Agent 于 **2026-09-15 03:59 UTC** 执行 `npm run test && npm run lint && npm run build`，exit 0；截断日志未取得全量用例数，不填推测数量。此前阶段 tsc、定向 ESLint 与 diff check 均通过。
- 文档/状态：wiki 最小补三模块职责、单向依赖、兼容入口与 watchdog 所属；考虑后无需 SVG，不全 wiki 清理行数。健康报告仅顶部补勘误；从既有 progress/handoff 证据恢复 feature_list 缺失的 `zombie-code-safe-cleanup` done 条目，其余 feature 和历史交接完整保留。本次收尾只改文档/状态，不改源码测试，无提交。文档轮 JSON parse、10 个 feature 唯一性/状态断言、旧交接保留检查与五文件 `git diff --check` 通过；未跟踪报告另做空白/冲突标记检查通过。
- 下一步：继续当前 feature 的事件边界收敛及相关验证，之后按顺序 **agent-manager → workspace → App → Inspector**；这四项仍为 planned，不能自动宣称全部完成。

---

## refactor-server-agent-split（done，2026-09-15 事件边界收尾）

- 本阶段限定成果：完成类型/HTTP/SSE 拆分与事件边界明确化。`server-agent.ts` 当前 2271 行；`server-agent-types.ts` 266 行；HTTP 16 行；SSE 340 行。新增 `ServerAgentLocalEvent` 标准和本地明确轻通知联合，`ServerAgentWireEvent` 仅为 `readonly type?: unknown`，无万能索引。
- `subscribeEvents` 是诚实入口；旧 `subscribe` 保持原签名，仅在 legacy wrapper 一个 `event as AgentEvent` 兼容边界，不声称 wire 已校验。12 处 wire 原样转发与本地 typed emit 分离；订阅 Map 保持原 Set identity、插入顺序、live iteration、异常隔离、dispose 语义。20 处散布 AgentEvent 断言收敛为 1 处有意兼容边界，不等于所有其他 cast 消除。
- 新增 `tests/frontend/server-agent-events.test.ts`（14 用例）、`server-agent-events-types.test.ts`（1 个实际 compiler 用例）及 `server-agent-events.typecheck.ts` 负例夹具（非运行时测试）。子 agent 27 文件/694 定向通过，独立 review 155 通过。
- 验证：父 Agent 2026-09-15 04:38 UTC 默认 `npm run test` 通过（343 files / 3854 passed + 1 skipped）；04:37 UTC `npm run lint` 与 `npm run build` 通过，构建仅有既有 font/chunk warning。保留失败历史：首全量 Worker fork unexpected exit 原因未确定；maxWorkers=2 复跑仅 runtime-diagnostics elapsedMs 4<5 的既有同类 flake，隔离两文件通过，默认最终全绿；无源码/测试修复掩盖问题。
- 边界：不宣称主类所有职责已细分、运行时 schema 校验或全库 strict 完成；未改报告、生产、测试、依赖、生成产物，不提交。下一步 `agent-manager`；其他四个巨石保持 planned。

### Notes（本阶段勘误与风险）

- 健康报告 C1 所称 compaction/network-proxy 无专属测试有误：`conversation-compaction.test.mjs`、`auto-compaction.test.mjs`、`network-proxy.test.mjs` 原本已 Git 跟踪并直接覆盖对应模块。新增测试是补缺口，不是从零覆盖整族。
- 报告 C3 所称重复 test 配置有误：`vite.config.ts` 没有 test 段。报告其余未经验证结论仅是静态建议，不视为已证实问题；不扩展当前 feature。
- 构建仍有既有 KaTeX/font/chunk warning。自动测试通过不等于真实浏览器或现场 SSE 弱网验收；剩余 20 处事件断言仍是当前工作的未完成边界。
- 并行 zombie cleanup 的历史 flake、Android 未验证及产品待决策事项继续按原节保留；本轮不修改其代码、测试或状态结论。工作树含大量并行/前序未提交改动，无 Git commit/tag/push。

---

## goal-runtime-residue-sweep（done，2026-09-16 存量一次性清理）

- 现状：仓库根发现 162 个 `.goal-runtime-*` 残留目录（09-11: 85 / 09-12: 22 / 09-14: 55），每个仅 `data/logs/server-*.log`（共约 116KB）。全部早于修复提交 `ace9930`（09-15 23:41），修复后无新增。
- 处置：一次性删除全部 162 个，删除后仓库根与 `os.tmpdir()` 均验证 0 残留；无源码/测试改动，无需跑验证命令；Git 状态无新增变化（`.gitignore:28` 已忽略该模式）。
- 勘误：`feature_list.json` p0-goal-runtime-testdir-hygiene（done）中"删除 109 个、repo root 与 os.tmpdir() 均为 0 残留"的验证记录与事实不符——本次实际清理出 162 个，说明当时的删除/验证未覆盖全部。
- Notes：仓库根另发现 0 字节未跟踪文件 `x[1])`（09-14 9:57 创建，疑似命令转义事故产物），未删除，待后续决策。

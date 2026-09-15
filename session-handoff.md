## 当前交接：release-v2.1.0（Git/CI 完成；npm 等待双重验证）

- 最终提交：`baaa041cc2a37e49038da46cec4c7d2ca6272f59`；本轮实时 `git ls-remote` 确认远端 dev/master/v2.1.0 均为该提交，本地 dev/HEAD/tag 一致；本地 master 仍为 `9ded6c0`，未移动。
- 发布提交 `6ad3489`；CI 修复 `6252e2d` 固定测试中文，`baaa041` 将 runtime-diagnostics 等待 5ms 改为 20ms，保留 elapsedMs >= 5 断言。
- 当前 HEAD 重新验证：npm run test 323 文件 / 3649 测试全部通过；lint/build 均退出 0。既有 warning：identity.mjs:92、KaTeX 字体和大 chunk。
- GitHub 网页核验完整 SHA 匹配且 Success：[CI](https://github.com/shawnstack/quickforge/actions/runs/34797256759)、[Desktop Build](https://github.com/shawnstack/quickforge/actions/runs/34797259067)。公开 API 限流，以上依据 run 网页。
- 离线包：`package-offline/shawnstack-quickforge-2.1.0.tgz`，7,486,125 bytes、471 文件，SHA-1 `7c952caa07a39971fdd4dbf74acd899238495d0c`；其中 402 个 dist/server/bin 文件与当前构建逐字节一致，未重打包。
- npm：whoami 已成功（shawnstack），用户已明确授权；实际 publish 退出 1，报 EOTP，需要用户在本地完成双重验证，尚未确认发布成功。
- 下一步：用户本地执行 `npm publish ./package-offline/shawnstack-quickforge-2.1.0.tgz --access public --registry=https://registry.npmjs.org/` 并输入验证码，然后用 `npm view @shawnstack/quickforge version` 和 `npm view @shawnstack/quickforge dist-tags` 核验。验证码不应发送到聊天。
- 本轮仅补三份状态记录（当时未提交，后随汇总提交 rebase 并入 dev）、未再次移动 tag；未知零字节文件 `x[1])` 未触碰。无架构或公共入口变化，无需更新 Wiki。

---

## 历史交接：release-v2.1.0-retag（以下为 6252e2d 阶段记录，已被上方最终状态取代）

- 目标：用户指令「发布 2.1.0 版本」，确认 v2.1.0 上轮已发布 Git 但远端 tag 实际未推成功（远端最新 tag 仅 v2.0.0），用户选择「移动 tag 到最新提交」将 a21d3bc（？ 浮层修复）纳入 2.1.0 重新发布；随后用户报「单元测试没过」，核实为 GitHub Actions CI（Linux）失败，修复后再次移动 tag。
- CI 失败根因：`tests/frontend/git-tools-pinned-summary.test.ts` 两个用例断言中文文案（`执行中`/`已结束 · 5`），而 `src/lib/i18n.ts:3852` 默认语言跟随 `navigator.language`——本地 Windows zh-CN 渲染中文通过，CI Linux en-US 渲染英文失败（node ≥21 全局 navigator 按系统 locale）。属测试对宿主语言的隐式依赖，非产品缺陷；该失败自 22fe294（上轮发布提交）即存在。
- 改动（1+2 文件）：`CHANGELOG.md`（[2.1.0] Fixed 补 ？ 浮层修复一行，commit 6ad3489）；`tests/frontend/git-tools-pinned-summary.test.ts`（import `applyAppLanguageFromSnapshot` + describe 级 beforeAll 固定 'zh'，commit 6252e2d）；本交接条目。
- 验证：两轮 `npm run test` 323 files / 3649 tests 全过；`npm run lint` 0 error（仅既有 identity.mjs:92 warning）；`npm run build` 成功；定向 31/31。`package-offline/shawnstack-quickforge-2.1.0.tgz` 于 6ad3489 生成（7.5 MB / 471 files / shasum 7c952caa…），测试文件不进 npm 包（files 不含 tests/），tarball 无需重打。
- Git：`6ad3489`（chore(release)）+ `6252e2d`（test 修复）；tag v2.1.0 两移（22fe294→6ad3489→6252e2d），第二次远端 +v2.1.0 强推；dev/master/tag 均指向 6252e2d。
- Blocker：待确认本次 push 后 CI 转绿（推送时间 01:44 UTC，CI 约 3-5 分钟；上两次 CI 结论：6ad3489/22fe294 failure、9ded6c0 success）。npm 未登录（E401），publish 留给用户。
- Notes：Desktop Build 由 v2.1.0 tag 触发，6ad3489 那次已 success 并创建 GitHub Release（"Create GitHub Release" success），tag 强推会再次触发；旧 Release 对象仍存在，必要时人工核对 GitHub Release 页面内容与资产。CI annotations API（check-runs）可匿名定位失败测试，无需 admin。
- 下一步：确认 CI 绿后，用户手动 `npm login` + `npm publish`（命令见本轮会话总结）；继续下一个 feature。（goal-inspector-hint-popover-width 的交接正文已随全量归档移入 docs/archive/session-handoff-archive.md。）

---

## 最新交接：retry-error-only-continue（done，2026-09-15）

- 目标已完成：修复「普通对话重试按钮发送『继续』」。行为契约：回合以错误结束（回合内 assistant stopReason='error' 且 errorMessage 非空）→ 重试保留全量历史并追加「继续」；正常回合 → 重试裁剪历史重发原消息。
- 改动文件：`src/lib/message-utils.ts`（删 hasToolResultsAfter、新增 turnEndedWithError）、`src/hooks/useChatActions.ts`（retryFromMessage 换判定+注释）、`src/components/chat/panel-decoration/turn-error-state.ts`（仅头注释）、`tests/frontend/message-utils.test.ts`（6 新用例）、`tests/frontend/turn-error-state.test.ts`（仅注释）及三状态文件。
- 验证：父 Agent 亲读全部 diff；定向 vitest 4 文件 195/195、5 文件 ESLint、`tsc -b` exit 0。
- Blocker：无。
- Notes：成功回合含写工具的重试会裁剪重试（副作用可能重放），用户明确接受；服务端 /continue 未改；未跑全量 test/build，无 Git 操作。重启源码版后可在普通对话验证：成功回合点重试应重发原消息，报错回合点重试发送「继续」。下方旧记录仅供历史追溯。

---

## 历史交接：builtin-playwright-mcp（done，UI/API 内置删除保护）

- 当前目标已完成：Playwright 继续使用默认关闭的 `npx -y @playwright/mcp@latest` 预置，已有同名配置和启用状态保留；增加内置标记及不可删除保护，不改变命令、依赖或 Desktop。
- 读取按规范化名称派生 `builtin: true`，不信任输入且不落盘；删除在 normalize 后、`atomicUpdate` 前拒绝并返回 409。普通 MCP 删除不变，批量 replace 遗漏 playwright 后读取恢复关闭预置。
- 设置卡片显示中性“内置”标签并隐藏删除，仍可编辑、启停、重连。
- 改动文件：`server/mcp/config.mjs`、`src/components/mcp/mcp-server-card.tsx`、`src/lib/types/mcp.ts`、`src/lib/i18n.ts`、`tests/server/mcp-config.test.mjs`、`tests/server/routes/mcp.test.mjs`、`tests/frontend/mcp-server-card.test.ts`；同步 README、server Wiki、feature_list/progress/session-handoff 五份文档。
- 验证：父 Agent 的 MCP config/registry/routes/card 四文件定向测试、定向 lint、build 整链 exit 0；当前定向测试全部通过，不推测用例总数，不声称本次全仓 test/lint 或浏览器端到端验收。
- Notes：本次 General 意外清空未跟踪的 `tests/server/mcp-config.test.mjs`，父 Agent 依据本会话已读取内容重建覆盖并补行为测试，未声称逐字恢复。后续文档子任务严格只编辑五份文档，未触碰源/测试。无 Git 操作或全局配置变更。
- blocker：无。下一步可重启运行中的源码版检查设置卡片；仍需后端机器 Node/npm、首次网络和可用浏览器，不继续旧 Desktop/离线方案。改动未提交，以下旧记录仅供历史追溯，以本节为当前契约。

---

## 历史交接：goal-persisted-attachment-paths（done）\n\n- 已完成 Goal 附件路径修复：`/goal` 创建时从原始消息复制附件元数据到 Goal，规划/续跑提示词携带文件名与完整路径，旧 Goal 快照兼容空附件。\n- 改动文件：`server/agent-prompt-commands.mjs`、`server/agent-goal-runner.mjs`、`server/agent-goal-state.mjs`、`src/lib/goal.ts`、`tests/server/agent-goal-runner.test.mjs`，并同步三状态文件。\n- 验证：定向 4 files / 206 tests 通过；相关 ESLint 与 `tsc -b --pretty false` 通过。\n- 限制：仅解决 Goal 上下文中的附件路径持久化/提示词注入；未处理附件缓存清理、路径权限及普通消息附件读取失败的静默问题。\n\n---\n\n## 历史交接：Playwright MCP npx 预置简化完成（删除行为已由顶部保护方案替代）

- 用户明确确认只预置 `npx -y @playwright/mcp@latest`，撤回先前复杂runtime/Chromium/Desktop方案。当前feature done按新范围，旧离线Goal不声称完成。
- 最终源码变化集中于server/mcp/config.mjs：默认关闭、已有同名完整优先、首次启停原子持久化、满50项拒绝挤掉其他服务；设置沿用普通可编辑/删除/重连服务。删除自定义配置后恢复关闭预置。
- 已撤回本任务package/lock的Playwright依赖、UI限制、registry分支、Desktop打包与浏览器脚本；无关改动保留。新增/调整配置测试、README、server Wiki和三状态。
- 验证：MCP 3 files/62 tests、定向lint、父Agent全仓lint/build通过。未再次启动浏览器、改全局MCP配置、提交Git或清理旧下载/生成目录。
- 下一步：用户重启所运行的源码版后检查设置即可；已有全局Playwright保持原配置。当前简化范围无blocker，勿继续旧Desktop/离线任务。

## 历史交接：Playwright MCP 配置完成（2026-09-15）

- 当前目标已完成：用户授权的当前 QuickForge 实例全局 Playwright MCP，可见窗口。运行时服务 playwright：stdio，command `npx`，args `-y @playwright/mcp@latest`，enabled=true。
- 实例已连接并发现 26 tools，无错误；同参数独立 SDK 客户端打开 about:blank 后关闭成功。浏览器操作验证不是当前聊天工具调用验收；工具若未显示，可在设置 → MCP 服务检查或刷新聊天页面。
- 改动：实例全局 MCP store（通过本地 API，非手工覆盖配置）；仓库仅 feature_list.json、progress.md、session-handoff.md 三状态记录。无业务源码/依赖/生成产物修改，无提交；既有未提交成果保留。
- blocker：无。该历史配置目标已结束；当前新目标 builtin-playwright-mcp 仍在执行。下方旧交接完整保留。

## 历史交接：builtin-playwright-mcp（旧 Desktop/离线方案，已撤回）

- 已固定 `@playwright/mcp@0.0.81` production dependency；内置服务入口为当前 Node + 包内 `cli.js`，`--isolated`，默认 disabled，不依赖 npx/@latest。读取 Playwright Chromium executablePath，存在则传入路径，缺失时返回明确安装提示。
- 设置卡片展示“内置”，隐藏编辑/删除，保留启停/重连；类型增加 builtin。MCP 定向 44 tests、定向 lint、build/lint、npm pack dry-run 通过；真实内置 smoke 已完成 tools/list/about:blank/close。
- 本轮新增：Desktop electron-builder 增加可选 `extraResources`，由 `QUICKFORGE_PLAYWRIGHT_BROWSERS_PATH` 指定浏览器资源；新增 packaging contract 2 tests；server Wiki 已说明内置 Playwright。全量 test 352 files/4015 passed+1 skipped，build/lint 通过（既有 coverage 3 warnings）。
- 本轮新增：Electron packaged runtime 改为设置 `QUICKFORGE_PLAYWRIGHT_BROWSERS_PATH=process.resourcesPath/playwright-browsers`，由内置 helper 递归寻找平台 Chromium 可执行文件；新增资源根目录测试。定向测试 28/28、相关 lint、build 通过。
- 未完成：跨平台资源实际打包、真实 Desktop 安装包运行、最终状态同步。最终链路 `npm run test && npm run lint && npm run build && npm pack --dry-run` 通过（354 files/4021 passed+1 skipped，lint 仅既有 coverage 3 warnings）；浏览器资源下载和 Desktop 构建仍超时，当前不能宣称离线内置。

## 最新交接：四项拆分实现与最终核验

- 四feature均done；manager1946、workspace facade594、App2362、Inspector1872行。原公开入口/props/持久化保留，三个前端phase hooks模块族真实接入；测试及模块清单见feature_list.json。
- 最后完整test/lint/build已通过（07:50UTC）。cloud重启计时失败未改代码，隔离及默认完整复跑过；字体/chunk warning保留。App14及Inspector16原快照/真实hook对照通过；无DOM同步harness不代表StrictMode/真实浏览器验收。无剩余实现任务，不继续顺带重构。
- 范围核验：42个Goal路径、9个并行scheduled路径、3个历史cleanup删除、7个初始hash未收录背景文件全部分类。package/lock与基线一致，HEAD未变，无tracked生成物diff；没有commit/tag/push/发布。并行/前序文件不回退、不认领；完整历史保留在下方。
- 诊断目录 `.goal-runtime-refactor-baseline/` 保留baseline.json、四原源码、final-scope-audit.json、final-doc-preservation.json。保留原因是原快照重放及scope审计依赖，默认CI无需该目录。不要把它当新测试残留自动删掉。0字节命令垃圾已清理。
- 后续仅可按新需求单独评估时序flaky、构建warning或浏览器验证；这些不是当前Goal扩展范围。最终文档更新只改五Wiki的既有相关模块导航及四feature状态，不改无关历史。具体失败和修复证据以下方阶段记录为准。

<!-- final-audit-history -->
## 当前交接：四项实现及最终运行验证已完成，待范围/Wiki状态终验

- c1–c5已passed；c6/c7待严格最终核验。Inspector feature已done；新useInspectorGit229行，入口1872行，三域均真实调用，guard/reset/updater与diff reader跨tab留入口。
- Git先原AST5行为+39关联44过再搬迁；最终同16三域行为原快照/真实hooks各过；21effect原序同回调，4 JSX+props逐字相同、27action体归一一致。完整test/lint/build于07:50UTC链式成功；首次cloud/qf-agent-process重启计时失败，隔离及默认完整复跑通过未改无关代码。构建仅既有font/chunk warning。
- 新文件useInspectorGit.ts、inspector-git-hooks.test.ts；改Inspector/inspector-domain-fixture props/workspace-diff-no-changes源码定位，wiki/components与三状态。一次cmd解析失败；unused脚本跨函数误删同名state，tsc发现后修复。局部dep例外保留原applyGitStatus缓存闭包身份及卸载时最新controller读取。
- 下一步只终验，不继续重构：执行基线.goal-runtime-refactor-baseline/baseline.json存791文件hash、head a21d3bc；比较已列29个改变文件，其中scheduled两后端/UI/form/i18n/两server测试是并行feature，三个goal-plan-confirmation源/两test删除是并行cleanup历史，不认领；其余是四拆分及直接测试/wiki/状态。new未列入baseline还包含旧报告/reviews/mockup/archive（初始baseline覆盖有限），不能把它们当本Goal新增或删掉。package/lock与执行基线一致，head未变。0字节单引号垃圾（05:39时间）已确认后清理。
- 需输出可验证scope白名单/排除并行分类，验证相关docs模块导航/四done/历史保留/JSON/diff。目前c6/c7不能冒充通过。原4快照+baseline保留；测试QF_INSPECTOR_BASELINE_TEST=1可手动重放原快照，默认CI不依赖忽略目录。无依赖变更/commit/tag/push/手工产物修改，build正常刷新dist。

---

## 历史交接：Inspector布局和tab完成，下一步Git按需review

- feature仍in_progress，c4–c7未完成；入口现2048行，useInspectorTabs181行。state/effects/actions已接入，tab request/scope guard、updatePanelTab留入口；不可更改缓存callback的原project-only依赖身份。
- 新tab5原AST保护搬前通过后迁移真实hook，相关36过；全前端171文件2093、tsc、零warning定向lint过。21effect回调原序相同，4JSX逐字相同，18布局/tab action体归一一致；原快照11布局/tab例重放通过。最后全仓test/lint/build尚待所有域完成。
- 文件：Inspector、新useInspectorTabs、inspector-tabs-hooks.test.ts、inspector-domain-fixture props扩展、workspace-inspector-tabs/side-chat-workspace-tab源码断言定位；wiki/components与三状态。refs初始化局部lint例外保持基线模式，cache callback局部deps例外保持身份，勿自动修复加入每render updater依赖。
- 下一步Git域原快照范围：694–705/728/764/770 state；825–921派生/actions、949–956清diff effect、1174–1194load、1277–1280按需effect、1607–1691diff reader+inline；共享projectGuard和1304–1323跨域reset留入口，维持scope失效/abort原顺序。按需先补真正load/force/旧响应/404空态行为再抽hook，functions hoist依赖需注意。当前源码行号已变，用原statement AST匹配，避免子组件同名误替换。
- 首次唯一字符串assert发现子组件menu重复，未写文件，改Main AST后成功；4源码测试失配已修定位不弱化。自动deps建议加入不稳定updater已撤回，最终检查通过。无外部blocker/提交/依赖/手工产物修改，原snapshot与基线仍保留供最终范围审计。

---

## 历史交接：Inspector布局域完成，tab/Git review待继续

- 当前feature refactor-workspace-inspector-split=in_progress；c1–c3保持passed，c4–c7未完成。不要进入其他feature或宣称Inspector done。
- 新useInspectorLayout.ts含state/viewport/visibility/width/actions phase hooks，调用留原effect位置；Inspector2544→2194行，21effect回调原序/原内容（归一），4段最外层JSX和props逐字一致。layout仅原代码搬迁及稳定setter/ref依赖补齐，不改变持久化/时长。
- 文件：Inspector+新layout hook；tests/frontend/inspector-layout-hooks.test.ts、helpers/inspector-domain-fixture.ts；workspace-inspector-width-range与mobile-fullscreen测试定位真实模块；wiki/components和三状态。
- 证据：搬前13文件97基线、原AST6布局行为先过后移动；搬后14文件103过，原快照重放6过；零warning定向eslint、tsc -b，全前端170文件2088过。未跑全仓最终test/lint/build。生成多余解构与遗漏NAV常量出口已修；cmd引号失败未写文件。Explore空返回不算调研成果，父直接阅读完成。
- 下一步：优先Explore（若仍空返回则父读源码）定位tab与Git。原快照行号供定位：tab715–728/730/751–756、1342–1359 effects、1432–1541 create/open/reorder/close、1587–1604 document/ref；request1013–1048含scope guard可保留入口。Git694–705/728/764/770 state、825–921派生/actions、949–956清diff、1174–1194load、1277–1280按需effect、1607–1691diff。当前源码行号已变化，必须按函数名或AST比对而非直接旧行号切当前文件。共享projectGuard owner/1304–1323跨域reset留入口，不新增scope reset行为。
- 先补原行为测试再抽离各域；可复用HookLifecycle（无DOM，不等同ReactStrictMode）和originalInspectorDomain AST工具，后者当前仅布局props解构，扩展时勿手写镜像业务逻辑。布局测试通过QF_INSPECTOR_BASELINE_TEST=1读取原快照，默认CI仅真实hook。
- 基线目录保留baseline.json及4份原源码；无外部blocker、提交/依赖变更/手工生成物修改。最终c5–c7需要最后全量、范围审计和四feature状态/Wiki核验。并行scheduled/前序文件和历史均保留。

---

## 历史交接：四巨石 Goal — App三域完成，下一项Inspector

- c1/c2/c3已通过，c4–c7待后续。App2618→2362行；useAppTerminal74、useAppGit148、useAppLoadingTransitions136行，phase调用保留原effect顺序，共享project ref/App owner不变；10段JSX逐字相同、URL基础hooks不改。
- 文件：App与三个hooks；tests/frontend/app-domain-hooks.test.ts、hook-lifecycle-harness.test.ts、helpers/hook-lifecycle.ts、helpers/app-domain-fixture.ts；git-status-request-lifecycle与workspace-inspector-tabs只改真实实现/稳定ref依赖断言；wiki/src与hooks及三状态。
- 验证：搬前11文件93基线，14 AST行为保护先过再搬；父最后重放原App快照与真实hooks同14例均通过，另2 harness清理顺序/稳定身份验证；07:05UTC完整test/lint/build exit0（截断未确认总数），定向eslint及JSX/diff检查通过。既有字体/chunk warning保留。
- 无外部blocker。早期fixture/CRLF/源码位置测试失败已修，独立review无生产阻断；harness改为先全部cleanup再setup且补自测。测试是无DOM同步harness，不代表React StrictMode/浏览器验收。并行scheduled早期lint blocker记录保留，但本阶段最终全仓lint已通过。
- 下一步：只推进refactor-workspace-inspector-split（仍planned），先Explore定位tab持久化/scope、双resize/fullscreen、Git按需review，先搬前行为保护再抽离；最终全部完成后重跑全量、核验相对baseline范围、同步c5–c7。不要把当前全量当最终Goal验收。
- 保留.goal-runtime-refactor-baseline/baseline.json和3份搬前源码；App测试QF_APP_BASELINE_TEST=1可显式重放App-before-split.tsx，默认CI无需忽略目录。无提交/新依赖/手工产物修改；全部未提交且保留并行scheduled及前序成果。

---

## 历史交接：四巨石 Goal — 后端两项完成，下一项 App

- 本轮workspace实现完成：HTTP facade594行，Git681/浏览搜索527/文件预览193/请求控制42行。旧17出口/120原函数体和常量完全保留，无新反向环；四服务由入口实际调用。
- 文件：server/routes/workspace.mjs及workspace-{git-service,browser-service,file-service,request-control}.mjs；新增tests/server/routes/workspace-exports-contract.test.mjs；tests/server/session-index-lifecycle.test.mjs改读真实queries实现；wiki/routes与三状态。
- 验证：先9文件76基线+7新增保护通过，搬迁后10文件83，AST逐字唯一性/语法/零warning lint通过；最终全量347文件3946 passed+1 skipped，lint/build过。失败self re-export已删除；源码位置断言已适配；runtime-diagnostics4<5ms既有flake隔离后默认全过。无未处理本项失败。
- 已完成c1/c2；下一按序App终端/Git/启动会话过渡，需先Explore精确hook生命周期和现有harness，然后测试保护/抽离；再Inspector三域。c3-c7待后续实际证据。不要把本阶段全量当最终全Goal验收。
- 基线目录.goal-runtime-refactor-baseline内保存baseline.json和两个后端搬迁前源码，不要清除直到最终范围验收。并行scheduled-tasks已done，保留其文件/历史，非本Goal改动。无提交/依赖新增/手工生成物修改。

---

## 历史交接：scheduled-tasks-manual-frequency（done，2026-09-15）

### 复审完成 / 最新交接（06:03 UTC）
- 同一改动文件范围，补parse/save同步互斥、action按taskId去重、解析失效保护、独立日期草稿、Date溢出保护、严格新Cron/历史运行兼容以及真实scheduler tick测试。
- 最新验证：前端47、后端93 tests；扩大10文件177通过。父全量347文件3982 passed+1 skipped；本功能9源/测试eslint零warning；独立build通过（既有font/chunk warning）。
- Blocker/Notes：全仓lint被无关并行 `tests/frontend/helpers/hook-lifecycle.ts:33` no-this-alias阻断，coverage另3warning；不修改他人功能。不能宣称最终全仓lint全绿。
- 下一步：浏览器视觉/交互验收尚未做；实现保留现有页内编辑而非HTML抽屉，准确nextRunAt只保存后返回。无Git提交/依赖新增/手工生成物改动，build正常产生dist。以下为较早阶段记录，验证状态以上述为准。

- 目标：实现用户已确认的手动六频次、结构化 interval、weekDays 兼容 weekDay，完成测试/wiki/状态。
- 改动文件：src/components/scheduled-tasks/ScheduledTasksPage.tsx；src/lib/scheduled-task-form.ts（新增）、i18n.ts；server/routes/scheduled-tasks.mjs、server/utils/scheduled-tasks.mjs；tests/frontend/scheduled-task-form.test.ts、scheduled-tasks-page.test.ts（新增）；tests/server/scheduled-tasks.test.mjs、scheduled-tasks.execution.test.mjs；docs/wiki/src/components/README.md、docs/wiki/server/routes/README.md；三状态文件。
- 完成：手动六频次动态控件、即时规则摘要、校验/忙态/错误草稿；AI 可选回填 Cron；保存原类型并清理非当前字段；interval 锚点不漂移、旧中文 rule 回填、weekDays 多选兼容 weekDay、Cron 列表与步长范围校验。
- 验证：2026-09-15 05:21 UTC 定向 4 files / 104 tests 通过，05:23 UTC 扩大 scheduled 域回归 9 files / 137 tests 通过；相关 ESLint 无 warning、tsc -b、相关 git diff --check 与状态 JSON 检查通过。6 页面测试是 hook-state harness 真实 handler，不是浏览器 E2E；没有跑全量 test/build。
- Blocker：无。边界：准确 nextRunAt 由服务端保存后返回，不伪造客户端时区预估；间隔天=24h、错过槽位跳过；Cron 保留 AND 日/周与 366 天窗口。不添加依赖，不碰 dist/package-dist/package-offline，不提交 Git。
- 下一步：父 Agent 复审改动及按需补浏览器视觉验收。当前全部未提交，叠加既有大量前序/并行工作树修改；本轮没有处理其他 feature。历史交接保留如下。

---

## 当前交接：四巨石 Goal — agent-manager 三域完成

- 目标顺序：agent-manager → routes/workspace → App → WorkspaceInspector；本次仅完成第一项，后续自动执行按顺序推进。
- 本项改动：server/agent-manager.mjs、新agent-access-mode.mjs、agent-session-queries.mjs、agent-approval-responses.mjs、tests/server/agent-manager-domains.test.mjs、docs/wiki/server/README.md及三状态。
- 验证：搬迁前后19文件297用例通过，含11个新增行为保护与出口契约；原函数体归一比对、语法、零warning定向lint、diff check通过。c1证据已登记Goal。最终全Goal全量验证尚待完成。
- 修复记录：代理半成品出口多4个导致契约失败已修，未放宽测试；错误未接线abort实现已丢弃，实际abortToolCall留原处。不要把空subagent返回算完成。
- 边界：三个域实际接入，无新store或新反向循环；标题/工具装配/生命周期留manager，不承诺800行。前序Goal和并行scheduled-tasks改动保留，非本Goal成果。
- 基线：.goal-runtime-refactor-baseline/baseline.json（791文件hash）与manager-before-domain-move.mjs供后续范围及搬迁核验，请不要在Goal完成前当残留清除；最终清理前先登记证据。
- 下一步：Explore聚焦workspace路由，先跑9类既有workspace测试并补缺口，再按Git/浏览搜索/预览搬迁；完成前不得推进App。无外部blocker，无提交。

---

## 历史交接：refactor-server-agent-split（in_progress，2026-09-15 阶段文档/状态收尾）

- 当前目标：完成 `server-agent.ts` 拆分与事件类型收敛；本轮只同步 wiki、报告勘误与状态，不修改源码/测试。原 zombie cleanup 与全部旧交接条目保留在下方，其 done 不代表当前拆分已完成。
- 本轮改动文件：`docs/wiki/src/lib/README.md`、`docs/reports/project-health-check-2026-09-15.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。wiki 最小补三新模块职责、单向依赖及兼容入口，无需 SVG，不全库清行数；feature_list 从旧 progress/handoff 证据恢复缺失的 `zombie-code-safe-cleanup` done 条目，保留其他 feature。
- 已完成实现事实：`server-agent.ts` 2782→2236 行；types 模块 245 行（18 公共 + 1 内部类型）、HTTP helper 16 行、SSE 模块 340 行；旧入口保留 type/value re-export。会话 watchdog 与状态/消息对账仍在主类。已删 11 处冗余 AgentEvent 断言，仍剩 20 处原始 SSE / 自定义 / 轻通知边界；伪源码注释已删，测试改为定位真实模块。
- 保护测试：新增前端 HTTP/SSE 2 文件 13 用例，最新前端定向 10 文件 293 tests 通过，不是仅评估已有 140 用例。后端新增 8 测试文件原 104 用例，supervisor 从 6→10 后现 108；另新增 2 个 helpers 夹具。244 是含前端的混合数量。supervisor fail-closed preload 拦截 spawn，绝不运行真实 npm/server；失败 finally 等待唯一真实 Node 子进程 close 再删 fixture。
- 最新验证：父 Agent **2026-09-15 03:59 UTC** 执行 `npm run test && npm run lint && npm run build` exit 0；截断日志未获取全量用例数，不推测。既有 KaTeX/font/chunk 构建 warning 仍在。本文档轮 JSON parse、10 个 feature 唯一性/状态断言、旧交接保留检查、文档 diff check 与未跟踪报告空白/冲突标记检查均通过，不重复运行生产验证。
- Blocker / 未完成：无外部阻塞；事件边界尚未完整收敛，所以保持 **in_progress**，不能自动称拆分已全部完成。源码/测试与并行改动均未提交。
- Notes / 勘误：`conversation-compaction.test.mjs`、`auto-compaction.test.mjs`、`network-proxy.test.mjs` 本来已 Git 跟踪并直接覆盖对应模块；`vite.config.ts` 无 test 段。报告顶部已标明勘误，其余未经验证结论仅是静态建议，不是已证实问题。并行 cleanup 的历史 flake、Android 未验证及产品待决策项继续保留，未扩展处理。
- 下一步：先继续当前 **refactor-server-agent-split 的事件边界**，完成相应验证后按顺序 **agent-manager → workspace → App → Inspector**；四个后续巨石 feature 仍 planned，本轮未推进。无 Git commit/tag/push。

---

## 当前交接：refactor-server-agent-split（done，2026-09-15 事件边界收尾）

- 本轮仅同步 wiki/三状态；实际成果为类型/HTTP/SSE 拆分与事件边界明确化。源码当前行数：`server-agent.ts` 2271、`server-agent-types.ts` 266、HTTP 16、SSE 340。
- API 边界：`ServerAgentLocalEvent` 为本地标准及轻通知联合；`ServerAgentWireEvent` 仅 `readonly type?: unknown`，无万能索引；`subscribeEvents` 为诚实入口。旧 `subscribe` 保持原签名，仅 legacy wrapper 一个 `event as AgentEvent`，未声称已校验。12 处 wire 原样转发与 typed emit 分离；Map 的原 Set identity/插入顺序/live iteration/异常隔离/dispose 保留。20 处散布断言收敛为 1 处有意兼容边界，不代表所有其他 cast 消除。
- 测试/验证：新增 3 个 events 相关测试/夹具文件（14 用例、1 compiler 用例、负例夹具）；子 agent 27 文件/694 定向通过，独立 review 155 通过。父最终测试 04:38 UTC：343 files、3854 passed + 1 skipped；lint/build 04:37 UTC 通过，保留既有 font/chunk warning。
- 失败历史必须保留：首全量 Worker fork unexpected exit 原因未确定；maxWorkers=2 复跑仅 runtime-diagnostics elapsedMs 4<5 既有同类 flake，隔离两文件通过，默认最终全绿，无源码/测试修复掩盖问题。
- 边界/下一步：done 仅限本次类型/HTTP/SSE 拆分和事件边界明确化，不宣称主类全职责细分、运行时 schema 校验或全库 strict；其他四巨石仍 planned，下一步 `agent-manager`。本轮不改报告/生产/测试/依赖/生成产物，不提交。

---

## 当前交接：zombie-code-safe-cleanup（done，三 Phase 清理与全量验证完成；2 个既有 flake 已隔离复跑确认）

- 目标：接续本轮僵尸代码只读评审，用户授权「处理可安全处理、不影响功能」的代码；三 Phase 完成，纯删除/修复，无功能行为变化预期。
- 改动（22 个源码/测试/资产 + 2 wiki + 三状态文件）：Phase 1——server/agent-goal-runner.mjs（删 isGoalRunActive）、server/agent-goal-state.mjs（删 isGoalInFlightStatus/isValidGoalId/GOAL_ID_PATTERN）、src/lib/goal.ts（删 goalCanAccept，goalAcceptanceCheck 保留）、tests/frontend/goal-state.test.ts（同步）、scripts/session-index-query-benchmark.mjs（悬空 import 修复，现行 API 重写，smoke run equivalent:true）、Android 删 Capacitor 模板遗留 ×2 + icon-preview.png、goal-test-demo.md→docs/archive/；Phase 2——goal-card.ts 821→212（仅留 viewmodel buildGoalCardViewModel）、panel-decoration.ts barrel 收缩、删 goal-plan-confirmation.ts + 两测试文件（goal-card-controller 19 用例/goal-plan-confirmation）、ChatPanelHost.tsx 三处死接线、local-tools.ts 空 mount、index.css 死区 -386 行、i18n goal 域 14 对死 key、goal-card.test.ts/goal-report-renderer.test.ts 同步；Phase 3——i18n 非 goal 域 175 对死 key（1810→1635，-350 行）+ assistant-artifact-card.test.ts 2 处死断言同步；wiki components/lib README 两处。
- 验证：全量链式 npm run test && lint && build 退出码 0（build 仅既有 KaTeX/chunk warning）；复跑全量 2 个时序 flake（persist-session-state beforeEach 10s hook 超时、runtime-diagnostics elapsedMs 4<5ms）隔离复跑 28/28 全过、与改动面无交集；分 Phase 定向 192/374/1034 tests 全过；tsc -b 0 error；eslint 0 error；残留 grep（createGoalCardController/goal-plan-confirmation/currentGoalPlan/GoalPlanCandidate/data-quickforge-goal-plan-action/死 CSS 类族/死 key）零命中；i18n en/zh 集合相等（1796/1635 两阶段）。
- Blocker：无。
- Notes：有意不做（待产品决策）：confirm 恒假链（前端 goalCanConfirm 恒 false + Inspector confirmable 分支，server API 保留）、6 个零调用路由（workspace/tree、system/status、system/update/desktop、mention-search、mcp/config、lan-access/logout——wiki 记载兼容旧客户端）、isSessionTextAttachmentPath 安全预留、SignalReconnectBackoff.kt、82 个 export 冗余。server/cloud/index.mjs 因并行会话新增契约测试引用保留未删；根目录 0 字节垃圾文件已被并行会话先行清除；Android 未跑 gradle（仅 grep 零引用验证）。工作树有大量并行/前序未提交改动（goal-mode-i18n 等），本轮全部叠加其上且 goal-card.ts 等未提交断言/实现完整保留。未新增依赖，无 Git 提交。
- 下一步：可选——待决策项落定后另开 feature（confirm 链/死路由收敛）；测试补强建议 agent-subagent-runner 行为测试与 SQLite worker 冒烟（评审高-2）；本轮改动未提交。

---

## 上一轮交接：status-files-full-archive-2026-09-15（全部归档，主状态文件保持全新）

- 目标：应用户要求把主状态文件剩余全部条目归档：feature_list.json 全部条目（含 10 个 needs-review 与 1 个 in_progress）移入 docs/archive/feature-list-archive.json 前部；progress.md 全部历史段（含 ## Notes）移入 docs/archive/progress-archive.md；session-handoff.md 全部旧交接段移入 docs/archive/session-handoff-archive.md。主文件清空为全新空状态，从头开始记录。
- 改动文件（6 个）：feature_list.json、progress.md、session-handoff.md、docs/archive/feature-list-archive.json、docs/archive/progress-archive.md、docs/archive/session-handoff-archive.md。纯记录搬移，未动生产代码/测试/wiki。
- Blocker：无。
- Notes：未完成项（goal-changes-commit in_progress 及各 needs-review）的完整记录在 archive 中可查；共享工作树存在并行会话未提交 WIP，归档基于当时文件内容原子读改写，若并行会话稍后再写主文件属正常新记录；此前 2026-09-15 的部分归档交接段已随历史入档。
- 下一步：无待办；下个会话从全新状态开始，新 feature 直接追加到 feature_list.json 顶部。

---

# Session Handoff

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

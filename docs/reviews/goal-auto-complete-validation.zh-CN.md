# Goal 自动完成与迭代分隔线：审查及验证报告

## 1. 范围与结论

本次用户授权的是验证与报告，不是缺陷修复。评审基线为当前 `goal-auto-complete-iteration-divider` 实现，覆盖服务端完成结算、历史消息 marker，以及规划、控制条、摘要和 Inspector 的完整用户流程。

- `goal-auto-complete-validation`：**done 仅表示审查与自动验证完成**；浏览器验收 **needs-review**，检查项 c6 待人工。
- 父 Agent 本次定向运行 **16 files / 472 tests，退出码 0**。这不等于所有场景无缺陷，也不等于真实模型/浏览器验收通过。
- 本次核实 **高 1、中 5、低 3** 项问题；S1 为纯函数复现，S2/S3 为静态时序风险，U1 为源码确定的导航错位，U2/U3 为待浏览器验证的布局/组合装饰风险。
- **发现不代表已修复**。不修改生产源码、测试、依赖或生成产物，不改变其他 feature 的 done/needs-review 状态。旧评审未重新验证的问题不计入本次结论。
- 已考虑 SVG：本任务重点是证据分级、问题表与验收清单，表格比新增状态图更合适，不新增图。报告不改变架构、公共入口或现行契约，无需修改 Wiki。

## 2. 自动验证与复跑

在工作区根目录、使用现有已安装依赖运行（单行命令适用于当前命令环境）：

```text
npx vitest run tests/server/agent-goal-state.test.mjs tests/server/agent-goal-runner.test.mjs tests/server/agent-goal-manager.test.mjs tests/server/routes/agent.goal.test.mjs tests/frontend/goal-state.test.ts tests/frontend/server-agent.test.ts tests/frontend/goal-iteration-divider.test.ts tests/frontend/message-actions.test.ts tests/frontend/assistant-artifact-card.test.ts tests/frontend/process-folding.test.ts tests/frontend/goal-control-strip.test.ts tests/frontend/goal-summary-section.test.ts tests/frontend/goal-inspector-lifecycle.test.ts tests/frontend/goal-budget-inspector.test.ts tests/frontend/goal-edit.test.ts tests/frontend/goal-ui.test.ts
```

结果来源：父 Agent 本次实际执行，不是本报告子任务重跑。

| 测试文件（相对 tests/） | 通过数 |
| --- | ---: |
| server/agent-goal-state.test.mjs | 19 |
| server/agent-goal-runner.test.mjs | 88 |
| server/agent-goal-manager.test.mjs | 13 |
| server/routes/agent.goal.test.mjs | 8 |
| frontend/goal-state.test.ts | 34 |
| frontend/server-agent.test.ts | 103 |
| frontend/goal-iteration-divider.test.ts | 1 |
| frontend/message-actions.test.ts | 39 |
| frontend/assistant-artifact-card.test.ts | 20 |
| frontend/process-folding.test.ts | 49 |
| frontend/goal-control-strip.test.ts | 24 |
| frontend/goal-summary-section.test.ts | 6 |
| frontend/goal-inspector-lifecycle.test.ts | 5 |
| frontend/goal-budget-inspector.test.ts | 7 |
| frontend/goal-edit.test.ts | 32 |
| frontend/goal-ui.test.ts | 24 |
| **合计** | **472** |

本次不将历史全量 test/lint/build 的结果当作新执行结果；文档变更使用 JSON、路径及 diff 检查，不需要生成构建产物。

### 已有测试确认的正常边界

- **末轮可以完成**：`tests/server/agent-goal-runner.test.mjs:221-228`，第 8 轮验证成功正常结束可 completed；轮次预算阻止的是下一轮，不误杀最后一轮成功。
- **异常不完成**：同文件 `:210-239` 覆盖完成持久化期间 abort/cancel/失败，以及末轮 error/aborted/时长超限/双预算/未完成，不续跑且不误 completed。这不覆盖 S2 的 needs_review 分支或 S3 的 refreshTools reject。
- **SQLite marker 恢复**：`tests/server/agent-goal-manager.test.mjs:372-416` 覆盖正常轮末完成、数据库保存 completed、恢复会话后相同 `details.quickforgeGoalIteration`。属于真实 SQLite 自动集成测试，不是浏览器刷新实测。
- **前端元数据恢复与装饰**：goal-iteration-divider 测试覆盖重复装饰、根末尾位置与 JSON 历史恢复；message-actions/process-folding/artifact 测试通过不代表 U3/U6 的整链组合已被专门断言。

## 3. 本次问题清单

行号对应本次读取的工作区源码；后续修复可能改变行号。严重程度是修复优先级，不代表所有风险已动态发生。

| ID / 级别 | 证据与触发路径 | 影响与建议 | 验证级别 |
| --- | --- | --- | --- |
| S1 / 高 | `server/agent-goal-state.mjs:394-409` 未提供 evidenceIds 时沿用旧绑定，降为 failed 不使旧证据失效；`:507-534` 完成检查只看 passed 与证据绑定，不校验失败后的新验证。passed → failed → passed 可不提交新 evidence。 | 失败后能复用旧成功工具证据重新满足完成门禁；自动完成使其更值得优先修复。建议明确证据有效期/失败后重新验证契约并补回归，不能仅在 UI 隐藏旧证据。 | **父 Agent Node 纯函数复现**，goalCompletionCheck 返回 ok:true；不是实际模型作弊或真实目标错误完成的 E2E 复现。 |
| S2 / 中 | `server/agent-goal-runner.mjs:824-834` needs_review 等非 completed disposition 走普通 commitGoal；`:238-282` persist 后没有 abort generation 复核。`:1238-1250` settling 期间 abort 记录 pauseRequested/intent/generation 后直接返回。 | 若 abort 落在 needs_review 最终 persist await 内，可能仍落 needs_review 而不是 paused/user_aborted。不同于已有完成分支的 canPersist 守卫，不宣称取消分支也同样失效。建议 gated persist 用例先行，再统一结算意图复核。 | **静态时序推断**，未动态注入。 |
| S3 / 中 | `server/agent-goal-runner.mjs:305-328` 已成功持久化且把内存置为 completed 后，`:326` await refreshTools 无局部 catch；后续 goal_updated 与 syncMessages 位于其后。普通 commitGoal `:273-280` 则捕获刷新失败。 | refreshTools reject 可阻断该路径的完成/消息通知，前端暂时停留旧状态，待后续对账；不声称数据库完成状态丢失。建议把工具刷新失败与完成通知解耦，补 reject 回归。 | **静态异常路径推断**，未动态注入。 |
| U1 / 中 | `src/components/chat/panel-decoration/goal-control-strip.ts:271-275` openSummary 固定请求 edit；`:403-406` 预算耗尽的继续按钮也复用它。`src/components/workspace/GoalInspectorContent.tsx:195-247,257` 预算与追加确认/动作属于 progress。 | 用户想追加预算却先到目标编辑器，多一次找入口且易误解。建议预算出口显式导航 progress，编辑 icon 仍去 edit。 | **源码确定**；浏览器点击待人工。 |
| U2 / 中 | `src/components/workspace/goal-inspector.css:110-128` 浮层绝对定位且 width:min(290px,100%)；相对定位容器是问号 span，问号按钮宽 18px（`:89-95`；`GoalInspectorContent.tsx:69-72`）。 | 百分比参照问号父容器而非侧栏，可能极窄、过度换行或被滚动祖先裁切。建议按侧栏/视口约束定位，先测实际 containing block 与滚动裁切。 | **静态 CSS 风险**；没有浏览器测宽，不声称已看到 18px 浮层。 |
| U3 / 中 | `src/components/chat/panel-decoration/process-folding.ts:1033-1039` 判空列表不含 divider；`message-actions.ts:630-634` 先折叠/判空再插 divider；`src/index.css:3361-3362` 空宿主 display:none!important。 | 最后一个 assistant 仅含工具、工具被归并到前一 assistant 时，marker 所在空宿主可能连同分隔线被隐藏。建议以含 marker 的工具-only 末消息补完整装饰链回归，明确 marker 迁移或宿主可见规则。 | **静态组合路径风险**，未浏览器复现。 |
| U4 / 低 | `goal-control-strip.ts:342-351` 按钮 aria-label/title 为 goalOpenSummary，实际 `:275` 打开 edit。 | 辅助技术名称与目的地不一致。建议编辑动作采用编辑语义，预算导航与摘要导航分别命名。 | **源码**，屏幕阅读器待人工。 |
| U5 / 低 | `goal-control-strip.ts:329-334` 错误节点为 span + role=alert + click，无可聚焦/键盘激活行为。 | 鼠标能点错误导航，键盘不能等价触发。建议使用正确语义按钮/链接，保留独立错误播报。 | **源码**，键盘待人工。 |
| U6 / 低 | `message-actions.ts:504-507` 每次将 actions 移至末尾；`goal-iteration-divider.ts:33` 又把 divider 移至末尾。 | 两者共存且再次装饰时会产生无意义 DOM 移动：分隔线函数单独幂等不等于整链无 mutation。建议稳定 actions/divider 相对位置并测第二次装饰零移动。 | **静态**；`ChatPanelHost.tsx:1394-1408,1574-1576` 已抑制装饰期间 observer，**不能据此声称无限循环**。 |

### S1 最小纯函数复跑

下面只构造状态对象并调用纯函数，不运行模型、不调用 API、不写持久化存储。初始 evidence 代表已存在的旧成功工具证据，复现重点是失败后仍能复用，不是绕过工具结果接纳器伪造证据。

```text
node --input-type=module -e "import { applyGoalCriterionUpdates, goalCompletionCheck } from './server/agent-goal-state.mjs'; let goal = { criteria: [{ id: 'c1', required: true, status: 'passed', evidenceIds: ['e1'] }], evidence: [{ id: 'e1', toolCallId: 'old-success', toolName: 'run_command' }] }; for (const status of ['failed', 'passed']) { const result = applyGoalCriterionUpdates(goal, [{ id: 'c1', status }]); if (result.errors.length) throw new Error(result.errors.join('; ')); goal = { ...goal, criteria: result.criteria }; } console.log(JSON.stringify({ criteria: goal.criteria, completion: goalCompletionCheck(goal) }));"
```

预期当前代码输出：c1.status 为 passed，evidenceIds 仍为 `["e1"]`，completion 为 `{"ok":true,"reason":null}`。父 Agent 本次纯函数复现得到 ok:true；上面给出等价可复跑最小命令。

## 4. 全流程验收清单

“测试通过”仅指第 2 节相关自动测试；下面每项仍需相应真实浏览器步骤，不把源码阅读当作人工通过记录。

| 检查项 | 步骤 / 预期 | 当前证据 / 待办 |
| --- | --- | --- |
| c1 规划与确认 | 新主会话 `/goal` → 只读规划 → 展示准则/范围/预算；未确认不得执行写入，确认一次才开始；审批与提问仍需用户操作。 | **源码** runner/GoalInspectorContent；**测试** runner、manager、routes/agent.goal、goal-state；**待人工** 真实模型规划与确认、审批允许/拒绝、问题回答/跳过。 |
| c2 执行进度 | 执行中摘要、运行条与 progress 状态一致；证据可展开、预算累计不重置；每轮分隔线与对应轮结果一致。 | **源码** control-strip、GoalInspectorContent、divider；**测试** goal-control-strip、goal-summary-section、goal-state、server-agent、divider；**待人工** SSE 更新、长内容滚动和工具-only 末消息（U3）。 |
| c3 暂停 / 取消 | pause → pausing → paused 不再续跑；resume 保留进度；取消内联确认、继续工作/Escape 返回，确认后 cancelled 不回滚文件。完成持久化窗口停止也不能误完成。 | **源码** runner 结算、control-strip 确认；**测试** runner、goal-control-strip、goal-ui；**待人工** 真正执行中停止及焦点回填；S2 needs_review persist 时序另需可控回归。 |
| c4 预算追加 | 分别耗尽轮次/时长/双维度；点击继续应看到真实 usage 和追加确认；仅耗尽维度 +8 轮/+120 分钟，goalId 不变；旧 revision/重复确认不得重复加额，仍耗尽不续跑。 | **源码** runner/goal.ts/Inspector；**测试** runner、routes、goal-budget-inspector、goal-state、server-agent；**待人工** 控制条入口，当前有 U1，应记录实际 edit 错位而非勾选通过。 |
| c5 编辑目标 | edit 保留 dirty；运行中保存先确认暂停，等权威 paused 且非 streaming 才 revise；关闭侧栏取消未发保存，已发 POST 不承诺撤回；冲突保留草稿，不自动 confirm/resume。 | **源码** goal-edit.ts、goal-ui.ts、GoalInspectorContent；**测试** goal-edit、goal-ui、goal-inspector-lifecycle；**待人工** 中文 IME、Ctrl/Cmd+Enter、光标/选区、跨关闭/重开、外部目标更新。非 extend_resume 动作不能泛称有 revision CAS。 |
| c6 浏览器整体验收 | 亮/暗主题、320/340/420px 窄屏侧栏、矮视口、长准则/证据/目标；预算、底部动作可滚动可达；问号浮层可读且不裁切；Tab/Shift+Tab、Enter/Space、Escape、屏幕阅读器名称与焦点返回一致。 | **源码** Inspector CSS、control-strip；**测试** 生命周期/动作只覆盖部分逻辑；**needs-review / 待人工**，重点 U2/U4/U5。不以 fake DOM 或 CSS 静态阅读替代视觉验收。 |
| c7 自动完成 / 人审 | 真实成功证据 → complete 报告时仍 verifying → 正常轮末且持久化成功才 completed；末轮成功允许完成，error/abort/时长耗尽/存储失败不误完成；需要人工判断仍 needs_review，accept/继续可达。 | **源码** runner:305-328,824-834；**测试** runner、manager、goal-state；**待人工** 真实模型端到端与三 surface 通知；S1/S3 尚未修复，应单独记录。 |
| c8 历史恢复 / 新 Goal | 完成后刷新、重启会话再开；旧 marker 的轮次/结果保留；新建 Goal 不改写旧轮分隔线；无本轮 assistant 时 user 锚点不污染前轮；无本轮消息不借用前轮。 | **源码** runner:285-302、divider；**测试** manager SQLite 恢复、runner 锚点、divider JSON 恢复；**待人工** 真实浏览器刷新/新 Goal、折叠与产物卡组合后 divider 仍可见；不把单函数幂等泛化为整链幂等（U6）。 |

## 5. 环境边界与下一步

本会话无可用专用 browser 工具。子 Agent 环境探查反馈：playwright、puppeteer、jsdom、happy-dom 均不可 resolve；electron 可用但未启动。因此没有安装依赖、没有新建浏览器 harness，没有截图、布局测量或真实浏览器 E2E 结果。c6 与其他表内人工步骤统一保留 needs-review。

建议后续由用户选择独立修复 feature：优先 S1（证据失效与新验证策略），其次 S2/S3 可控异步失败测试、U1 导航修复与 U2/U3 浏览器复现；U4/U5/U6 随相应局部修复补无障碍/整链幂等断言。本文只记录，不实施这些建议。历史评审的其他开放项保留在原记录，不合并为本轮重新确认的问题。

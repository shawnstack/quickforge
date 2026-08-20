# Session Handoff

## 当前状态：fix-workspace-inspector-subagent-trace-outer-card（已完成）

- 本会话目标：移除 Workspace Inspector 中完整 subagent 执行区域的最外层圆角边框与弱背景，使其融入消息流。
- 最终状态：**已完成并验证**。`src/lib/local-tools.ts` 的 `.quickforge-subagent-trace` 根容器由 `quickforge-subagent-trace rounded-lg border border-border bg-background/60 p-2.5` 收敛为 `quickforge-subagent-trace p-2.5`；内部 `message-list`、状态/耗时、process summary 分隔线、思考正文、工具统计、折叠交互及聊天摘要未改。
- 改动文件：`src/lib/local-tools.ts`、`tests/frontend/local-tools-lit-reactivity.test.ts`；增量更新 `feature_list.json`、`progress.md`、`session-handoff.md`，新增独立 done bugfix，未改其他 feature 状态。
- 测试覆盖：从源码提取命中 `.quickforge-subagent-trace` 的 class 属性并拆分 token，断言保留 `p-2.5`，且不含 `rounded-lg`、`border`、`border-border`、`bg-background/60`；未使用脆弱的大段模板字符串断言。
- 验证：`npx vitest run tests/frontend/local-tools-lit-reactivity.test.ts` → 1 file / 2 passed；`npx eslint src/lib/local-tools.ts tests/frontend/local-tools-lit-reactivity.test.ts` → 0 error；`npx tsc -b --pretty false` → exit 0；`npm run build` → exit 0（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` → exit 0。
- 文档：未修改 `docs/wiki`，因为这是纯视觉外框 bugfix，不改变行为契约、模块职责、公共入口或可配置行为。
- 遗留：可选真机目视；本会话未创建 commit/tag/push，未新增依赖，未手工修改生成目录。

---

## 前轮会话：fix-subagent-marquee-width-reconnect（已完成，要点归档）

## 当前状态：fix-subagent-marquee-width-reconnect（已完成）

- 本会话目标：实施 subagent 跑马灯最小修复——摘要标题占据剩余宽度；custom element 断开再连接不重复追加双视图。
- 最终状态：**已完成并验证**。普通 `.quickforge-tool-title` 行为保持 `flex: 0 1 auto`，仅 `.quickforge-subagent-title` 使用 `flex: 1 1 auto`；`QuickForgeToolMarquee` 重连优先复用现有两组完整 view，仅异常 DOM 才清理重建，attribute 同步和现有动画/ResizeObserver 行为不变。
- 改动文件：`src/index.css`、`src/lib/local-tools.ts`、`tests/frontend/tool-marquee.test.ts`；增量更新 `feature_list.json`、`progress.md`、`session-handoff.md`。保留了工作区既有 `src/index.css`、input-clamp、wiki 与簿记改动，未覆盖或改写其他 active/done feature 状态。
- 测试覆盖：① CSS 源码契约断言普通 title 仍 `flex: 0 1 auto`、subagent title 为 `flex: 1 1 auto`；②执行转译后的 custom element 生命周期，覆盖 connect→disconnect→reconnect 后仍恰好两组原 view、控制器重建复用节点，并继续响应 `text`/`running` 属性。
- 验证：`npx vitest run tests/frontend/tool-marquee.test.ts tests/frontend/local-tools-lit-reactivity.test.ts` → 2 files / 16 passed；`npx eslint src/lib/local-tools.ts tests/frontend/tool-marquee.test.ts` → 0 error；`npx tsc -b --pretty false` → exit 0；`git diff --check` → exit 0。
- 文档：未修改 `docs/wiki`，因为本次仅修复布局与生命周期幂等缺陷，没有改变模块职责、公共入口、动画语义或用户可配置行为。
- 遗留：可选真机目视；本会话未创建 commit/tag/push，生成目录未修改。

---

## 前轮会话：input-clamp-expand（已完成，要点归档）

## 当前状态：input-clamp-expand（已完成）

- 本会话目标：长输入内容定高收起——聊天用户消息与 subagent 详情任务块统一用户消息气泡视觉并定高收起（设计稿两轮迭代获用户确认后实现：`好的先执行吧`）。
- 最终状态：**已完成并验证**。追加真机反馈修复：① `white-space: pre-wrap` 仅作用于 task/context/expectedOutput 三个值节点，保留原始换行且不再把 Lit 模板缩进渲染成字段间大空白；②共享收起盒增加 30px 流内按钮安全区，仅 overflowing 内容显示，收起/展开态均不覆盖正文，fits 内容不留额外空白。`npx vitest run tests/frontend/input-clamp.test.ts` → 20/20 通过。
- 改动文件：本次追加 `src/lib/input-clamp.ts`（六行正文阈值与含按钮安全区的收起高度分离，注入流内 safe-area 节点）、`src/lib/local-tools.ts`（三字段值级 wrapper）、`src/index.css`（值级 pre-wrap、安全区/fade 样式）、`tests/frontend/input-clamp.test.ts`（20 用例，覆盖高度口径、字段值换行作用域与安全区接线）、`docs/wiki/src/lib/README.md`（行为说明）及簿记三件套。
- 关键决策：状态走 data 属性而非 class（Lit 重渲染重写 class，data 属性与注入节点可跨 SSE 实时更新存活，无需按 runId 持久化展开态，重开 Tab 回落收起）；浅色浓度 3%（浅色 token --background 纯白，混灰易显脏）、深色 6%；边框浓度用户反馈后再调淡——`primary 18%→12% 混 border`（气泡/任务块/展开按钮三处同步，按钮 hover 34%→26%，设计稿同步），测试与 feature 记录已验证/更新。
- 遗留：真机目视确认（长用户消息与详情任务块收起/展开、深浅主题气泡浓度观感；设计稿可对照）留待用户。本会话改动未提交 git。预览服务 `python -m http.server 8791 --bind 127.0.0.1 --directory D:/quickforge` 仍在后台（IAB 内核点击通道本会话中后期失效属环境问题，渲染正常）。

---

## 前轮会话（并行）：ask-user-history-review-style（已完成，要点归档）

- 本会话目标：ask_user 提交/跳过后的历史工具消息展开体复用回执确认步样式（所见即所提交，非 detailed 省略 output 文本块已获用户批准）。
- 最终状态：**已完成并验证**（定向 vitest 23/23、eslint 0 error、tsc -b 通过）。
- 改动文件：`src/lib/local-tools.ts`（新增导出纯函数 `askUserReviewRowsFromDetails`——自包含防御解析持久化 toolResult.details 的 questions/answers/skipped/skipReason，answers 对齐补 undefined、choices/custom 只收 string，坏形状返回 null；`ASK_USER_SKIP_REASON_KEYS` + `askUserSkipReasonText` 四映射；`AskUserToolRenderer` 非 detailed 且 review 非 null 时渲染 `quickforge-ask-review` 只读行——复用 `buildAskAnswerText` 合并答案、未答/跳过显示 `askUserUnanswered`、跳过态行区顶部加跳过原因行、无修改按钮，此态省略 input 问题清单与 output 文本块；detailed 一律维持 input JSON + output 原文，review null（pending/旧消息）维持原问题清单视图；import `buildAskAnswerText` 自 ask-user-card.ts，无循环依赖）、`src/lib/i18n.ts`（新增 askUserSkipReasonTimeout/Aborted/NoQuestions/User 双语）、`tests/frontend/ask-user-card.test.ts`（+7 用例：纯函数 4——经 ts.transpileModule 提取函数体单测（同 local-tools-lit-reactivity 惯例，规避模块级副作用）；源码断言 3——回执行渲染/无 edit 按钮、output 与问题清单门控、skip reason 映射与 i18n 双语文案）、`docs/wiki/src/lib/README.md`（local-tools 段补 ask_user 渲染器描述 + 工具清单加 ask_user）；簿记三件套。
- 验证记录：`npx vitest run tests/frontend/ask-user-card.test.ts tests/frontend/local-tools-lit-reactivity.test.ts` → `Tests 23 passed (23)`；`npx eslint src/lib/local-tools.ts src/lib/i18n.ts tests/frontend/ask-user-card.test.ts` → 0 error；`npx tsc -b` → exit 0。未跑全量（小改动定向验证，符合项目规则）。
- 遗留：真机目视确认（触发一次 ask_user 提交与跳过、重载会话后展开历史工具消息观察回执行/跳过原因行；detailed 模式对照）留待用户。本会话改动未提交 git。

---

## 前轮会话：diff-display-optimization（已完成，要点归档）

- 本会话目标：优化对话区 write_file/edit_file 工具的 diff 显示（用户要求：调研 + 设计稿预览，确认后按推荐方案 B 落地）。
- 最终状态：**已完成并验证**（定向 vitest 35/35、eslint 0 error、tsc -b 通过）。
- 改动文件：`src/lib/diff-view.ts`（新增，unified diff 结构化解析纯函数：行号双侧/前缀剥离/hunk 间隙省略/配对删加行 token LCS 字符级变化段/路径与新文件判定）、`src/lib/local-tools.ts`（renderDiff 改结构化行渲染，删内联样式双保险与 diffLineClass/diffLineStyle/styleMap）、`src/index.css`（diff 行号/gap/mark/path/newfile 样式 + html.dark 亮绿/亮红文字覆盖，含徽章与里程计 side；**追加修复**：用户反馈横向滚动后行背景缺失——块改单一 grid `3.1rem 3.1rem minmax(max-content,1fr)` + 行 display:contents + gap 跨全列，第三列取 max(剩余宽,最宽行) 使所有行背景铺满整个横向滚动区，设计稿同步修复并加长行示例）、`src/lib/i18n.ts`（diffOmittedLines/diffNewFile 双语）、`tests/frontend/diff-view.test.ts`（新增 16 用例）、`docs/wiki/src/lib/README.md`（diff-view 模块行 + local-tools 段同步）、`design-mockups/diff-display-optimization.html`（对比设计稿留档）；簿记三件套。
- 验证记录：`npx vitest run tests/frontend/diff-view.test.ts tests/frontend/local-tools-lit-reactivity.test.ts tests/frontend/tool-artifacts-and-events.test.ts tests/frontend/diff-counter.test.ts` → 35 passed；`npx eslint` 四改动文件 0 error；`npx tsc -b` exit 0；修复后 `npm run build` 通过 + 无头 Edge 截图像素级验证（临时页复制 index.css 规则并预置 scrollLeft 最大：绿/红行背景延伸至块右缘、上下文行保持块底色，临时页已删）。未跑全量（小改动定向验证，符合项目规则）。
- 遗留：真机目视确认（触发一次 edit/write 任务观察新 diff 块、亮暗两主题、多 hunk 省略行）留待用户；预览用本地静态服务 `python -m http.server 8941 --directory D:/quickforge/design-mockups`（后台运行中，设计稿也可直接双击打开）。本会话改动未提交 git。

---

## 并行会话：input-clamp-expand（设计阶段，待用户定稿）

- 本会话目标：subagent 阅读详情时顶部输入（任务说明块）定高收起 + 框底展开按钮；按用户第二轮反馈（与聊天用户消息样式统一、用户消息也定高、背景调浅）迭代出 v2 设计稿（input-clamp-expand）。
- 最终状态：**设计阶段完成，待用户定稿**。v2 设计稿 `design-mockups/input-clamp-expand.html`：聊天用户消息与 subagent 详情任务块统一复用用户消息气泡视觉（对齐 `src/index.css` user-message-container 公式：背景 primary 混 card、边框 primary 18% 混 border、圆角 1.125rem 右下 0.375rem、同款轻阴影、14px/1.625 文字）；长内容定高裁切不滚动 + 底部渐隐（渐隐色=气泡背景色）+ 居中「展开/收起」pill 按钮；气泡背景浓度默认 6%（比应用现状 primary 10% 浅，工具栏可切 4/6/8/10%）；收起高度可切 3/6/10 行；深浅色、列宽 380–960 可调；内容不足定高时按钮与渐隐整体不渲染。
- 改动文件：`design-mockups/input-clamp-expand.html`（新增）；`design-mockups/subagent-task-clamp-expand.html`（v1 样稿，被 v2 取代后删除）；簿记三件套（feature_list.json 登记 input-clamp-expand 为 in_progress）。
- 验证记录：浏览器打开样稿——初始四状态正确（短内容 fits 自动隐藏按钮 / 长消息收起 / 初始展开 / 任务块收起，类名与 aria-expanded 断言全过）；展开↔收起点击交互在 v1（同款交互 JS）端到端验证通过（expanded ↔ 收起 ↔ 展开）。预览服务：`python -m http.server 8791 --bind 127.0.0.1 --directory D:/quickforge`（后台运行中）；样稿零外部依赖，也可直接双击打开。
- 遗留/Blocker：等用户定稿两处选档——气泡背景浓度（4/6/8/10%）、收起高度（3/6/10 行）；确认后实现：共用 clamp 组件（max-height 裁切 + 渐隐 + 展开按钮）、聊天 user-message 装饰链路与 `renderSubagentRunBody` 任务块接入、气泡浓度调浅落 index.css。备注：本会话 IAB 自动化点击通道后期整体失效（顶部复选框也点不动，新标签页/重置面板不恢复），属环境问题非设计稿问题。本会话改动未提交 git。

---

## 前轮会话：fix-ask-user-nav-row-and-enter-confirm（已完成，要点归档）

- 本会话目标：修复 ask_user 卡片真机反馈两问题：①自由输入展开后无就近确认入口（「下一问」在选项区与 toggle 之间、位于 textarea 上方）；②上一问/下一问不在同一行（上一问在底部 actions 行、下一问在 body 内）。
- 最终状态：**已完成并验证**（定向 vitest 15/15 全过、eslint 改动文件 0 error）。
- 改动文件：`src/components/chat/panel-decoration/ask-user-card.ts`（nextBtn 提升为注入时创建、常驻底部 .quickforge-ask-actions 行与 backBtn 同行，append 顺序 back/next/submit/skip/note；一次性绑定 isAskAnswered 校验 + advance；renderStep 按 `!isReview && (multiSelect || allowCustom)` 控制显隐，单选且无自由输入隐藏、点选自动前进不变；setSubmitting 补 nextBtn.disabled；body 模板删内联 next 按钮与逐次 querySelector/绑定；customInput 增 keydown——Enter 且 !shiftKey 时 preventDefault，isAskAnswered 通过则 advance 否则提示 askUserNeedAnswer，Shift+Enter 保持换行）、`src/index.css`（删 .quickforge-ask-next { align-self:flex-start } 规则；.quickforge-ask-actions 补 flex-wrap:wrap 防窄屏溢出）、`tests/frontend/ask-user-card.test.ts`（Next 用例按新实现重写：append 顺序/显隐条件/一次性绑定断言 + 反向断言模板与 CSS 不再含 quickforge-ask-next；新增 keydown Enter 用例）、`docs/wiki/src/components/README.md`（ask-user 段同步：导航按钮统一底部操作行、textarea Enter 确认前进 Shift+Enter 换行）；簿记三件套。
- 验证记录：`npx vitest run tests/frontend/ask-user-card.test.ts` → `Tests 15 passed (15)`；`npx eslint src/components/chat/panel-decoration/ask-user-card.ts tests/frontend/ask-user-card.test.ts` → 0 error；`npm run build`（tsc -b + vite build）通过（主 Agent 补跑）。未跑全量测试（小改动定向验证，符合项目规则）。
- 遗留：评审其余发现（⑤–⑩，见 progress.md Notes）待用户定夺；真机目视确认留待用户。该会话改动未提交 git。

---

## 前轮会话：subagent 跑马灯工具切换上下滚动过渡（已完成，要点归档）
- 最终状态：**已完成并验证**（tool-marquee 13/13、前端全量 85 文件 778 用例全过、eslint 0 error、tsc -b 通过）。
- 改动文件：`src/lib/tool-marquee.ts`（控制器双视图重写：text 切换旧视图 translateY 0→-100% 滚出、新视图自 +100% 滚入 260ms，滚动期间旧横向动画不中断、结束后按 400ms 起始延迟重建，滚动中遇新文本先就地结算再重滚；同值刷新不打断 + 静止自愈排程；reduced-motion/首次出现/终态直切）、`src/lib/local-tools.ts`（QuickForgeToolMarquee 构建双视图，非当前视图整体 aria-hidden）、`src/index.css`（容器定高 1.125rem + .quickforge-marquee-view 绝对铺满规则）、`tests/frontend/tool-marquee.test.ts`（重写 13 用例）、`docs/wiki/src/lib/README.md`（tool-marquee 与 local-tools 两行同步）、`design-mockups/subagent-tool-marquee-impl.html`（标注 v1 参考）；设计稿 `design-mockups/subagent-marquee-roll-switch.html`；簿记三件套。
- 效果：工具摘要切换时旧摘要上滚出、新摘要自下滚入（与横向滚动两轴独立），间隙保持与终态消失行为不变。
- 遗留：真机目视确认（触发多工具 subagent 任务观察切换滚动与窄列宽表现）留待用户。本会话改动未提交 git。

---

## 前轮会话（并行）：ask_user 卡片评审遗留 ③④ 修复（已完成，要点归档）

- 本会话目标：修复 ask_user 卡片评审遗留 ③④（fix-ask-user-custom-mix-and-review-edit：③展开自由输入清空已选 choices，与「选项 + 补充」数据模型矛盾；④回执步仅 backBtn 逐题回退，回改成本高）。
- 最终状态：**已完成并验证**（定向 vitest 14/14 全过、eslint 改动文件 0 error、tsc -b 通过）。
- 改动文件：`src/components/chat/panel-decoration/ask-user-card.ts`（删除 customToggle 展开分支清空 choices 与移除勾选两行；review 每行末尾新增 quickforge-ask-review-edit 按钮，点击 message 复位 + disarmSkip + step=index + renderStep 直达该题，isReview 分支内重新绑定）、`src/index.css`（.quickforge-ask-review-edit 复用 ghost 视觉模式紧凑样式 + hover；review-row 改 content 列 + 右侧按钮行布局）、`src/lib/i18n.ts`（askUserCustomToggle/askUserCustomPlaceholder 双语改补充语义，新增 askUserEdit en『Edit』/zh『修改』）、`tests/frontend/ask-user-card.test.ts`（+3 用例：清空模式不存在、review-edit 绑定与样式、四条双语文案）、`docs/wiki/src/components/README.md`（ask-user 段同步）；簿记三件套。
- 遗留：评审其余发现（⑤–⑩，见 progress.md Notes）待用户定夺；真机目视确认（展开补充说明不清空已选、回执点「修改」直达对应题）留待用户。该会话改动未提交 git。

---

## 前轮会话：subagent 跑马灯工具间隙保持（已完成，要点归档）

- 本会话目标：优化 subagent 运行卡跑马灯——工具间隙（上一个工具已结束、下一个尚未开始）不要让工作过程显示消失（subagent-marquee-hold-between-tools）。
- 最终状态：**已完成并验证**（定向 vitest 91/91 全过、eslint 0 error、tsc -b 通过）。
- 改动文件：`src/lib/subagent-run-detail.ts`（新增 `SubagentToolSummaryMemory` 有界记忆 + `currentSubagentToolSummariesWithMemory` 带记忆数据源）、`src/lib/local-tools.ts`（`renderSubagentRunSummary` 改用带记忆版本，模块级单例）、`tests/frontend/subagent-run-detail.test.ts`（+5 用例：间隙回放与切换、终态恒空不污染、runId 隔离、空入参/clear、有界淘汰）、`docs/wiki/src/lib/README.md`（local-tools 与 subagent-run-detail 两处描述同步）；簿记三件套。
- 效果：running 期间跑马灯持续展示——pending 间隙回放该 run 最近一次非空摘要（元素保持挂载、text 不变动画不中断），下一个工具摘要出现即切换，运行结束照常消失；首个工具出现前行为与旧版一致。
- 验证记录：`npx vitest run tests/frontend/subagent-run-detail.test.ts tests/frontend/tool-marquee.test.ts` → 91 passed；`npx eslint` 三改动文件 0 error；`npx tsc -b` exit 0。未跑全量（小改动定向验证，符合项目规则）。
- 遗留：真机目视确认（触发一次多工具 subagent 任务，观察工具间隙跑马灯保持显示）留待用户。本会话改动未提交 git。

---

## 前轮会话：ask_user 卡片两交互缺陷修复（已完成，要点归档）

- 本会话目标：修复 ask_user 卡片两个交互缺陷（fix-ask-user-skip-and-custom-forward，评审定案①跳过语义失真②单选+自由输入无前进路径）。
- 最终状态：**已完成并验证**（定向 vitest 11/11 全过、eslint 改动文件 0 error）。
- 改动文件：`src/components/chat/panel-decoration/ask-user-card.ts`（skip 两步确认 + disarmSkip 助手；Next 条件 multi→multi||allowCustom）、`src/lib/i18n.ts`（askUserSkip 双语改『跳过全部提问』+ 新增 askUserSkipConfirm）、`tests/frontend/ask-user-card.test.ts`（+3 组源码断言）、`docs/wiki/src/components/README.md`（L156 向导交互描述同步）；簿记三件套。
- 验证记录：`npx vitest run tests/frontend/ask-user-card.test.ts` → `Tests 11 passed (11)`；`npx eslint` 三个改动 src/tests 文件 → 0 error。未跑全量（小改动定向验证，符合项目规则）。
- 遗留：评审其余发现（③–⑩，见 progress.md Notes）待用户定夺；真机目视确认（跳过两步确认、单选自由输入点「下一问」）留待用户。本会话改动未提交 git。

---

## 前轮会话：session-import 元数据桶韧性修复（已完成，要点归档）

- 本会话目标：修复 24h 变更风险审查发现的 M1——单个损坏的 `sessions-metadata.json` 阻断整个启动（fail-closed 扩大化）。
- 最终状态：**已完成并验证**（定向测试 + 相关存储测试全过、eslint 0 error）。

## 实现要点（速览）

- `server/session-state-import.mjs`：桶级 `readMetadataBucket` 读取 + `isPlainObject` 形状校验纳入 try/catch——失败（损坏 JSON SyntaxError / Windows EACCES/EBUSY / 非对象内容）时该桶降级为**空 metadata 继续**导入，不再上抛置 `STARTUP_FAILED`。正文文件照常导入（走既有 body-only `deriveMetadata` 推导，title/时间戳取自正文），仅 metadata-only 条目丢失（本就不含消息、按设计 dropped）。记 `diagnostics`（`kind: 'metadata-bucket-error'`，含 scope/projectId/message）+ `logger.warn`，与模块既有单条目韧性语义对齐。
- 头部 Resilience 注释与 `docs/architecture/session-storage-v2.zh-CN.md` §5 导入清单同步补充该语义。

## 本会话改动文件

- 修改：`server/session-state-import.mjs`、`tests/server/session-state-import.test.mjs`（新增双桶降级用例：global 损坏 JSON + project 合法 JSON 但数组）、`docs/architecture/session-storage-v2.zh-CN.md`
- 簿记：`feature_list.json`（done）、`progress.md`、`session-handoff.md`

## 验证记录

- 定向：vitest `tests/server/session-state-import.test.mjs` 4 用例全过（新用例断言降级导入 2 会话、diagnostics 2 桶错 + 2 body-only、metadata 由正文推导）。
- 相关面：backup.authoritative-session / session-state-offline-export / session-state-lifecycle / storage.session-recovery 共 18 用例全过。
- `npx eslint` 改动文件 0 error。

## 遗留与下一步

- 本会话改动未提交 git（遵循约定）。
- 风险审查其余发现（本轮 progress.md Notes 已记）：H1 存储 v2 就地升级 backup 表零读取者/零告警、M2 导入 count>0 永不重跑、benchmark 脚本悬空 import、前端 diff-counter `?running` 布尔绑定失效 + className 覆写——均未处理，待用户定夺。
- 前轮遗留（不变）：v1.7.11 npm publish 待用户执行；根目录空目录 design-preview/ 重启后可删；既有 lint warning server/cloud/identity.mjs:92。

---

## 前轮会话：ask-user-tool（已完成，要点归档）

- 服务端：`server/tools/definitions.mjs` 新增 `askUserTool`（questions 1-4，每问 options≤4 / multiSelect / allowCustom）；`server/ask-store.mjs`（pendingAsks Map、ASK_TIMEOUT_MS=30min、`normalizeAskQuestions` 兼容单问简写、`formatAskResult` 超时/跳过/abort→按默认方案继续）；`server/agent-manager.mjs` `wrapAskUserToolDefinition` + `createAskUserPromise`（SSE `ask_user_required`/`ask_user_answered`）+ `answerAsk` + state `pendingAsk` + 免审批；`server/approval-store.mjs` planAllowedTools 加 ask_user；`server/routes/agent.mjs` `POST /api/agents/:id/answer-ask`。
- 前端：`src/lib/server-agent.ts` 事件与 pendingAsk 全套、`answerAsk()`；`panel-decoration/ask-user-card.ts` 向导式卡（单选自动前进、末步统一提交、可跳过/回改，`data-ask-id`+displaySignature 去重）；ChatPanelHost/App 接线；i18n en/zh 各 18 键；`.quickforge-ask-*` 样式。
- 真机反馈修复：①propsRef effect 漏 `onAnswerAsk` 致卡片误禁用（已补+回归断言）；②ask_user 工具消息新增 `AskUserToolRenderer` 纳入工具显示模式（summary「N 问 · 首问」、output=回答文本）。
- 验证：全量 test 217 文件 1795 用例 / lint 0 error / build 通过；真实会话目视确认留待用户（可要求"用 ask_user 问我一个问题"触发）。
- 前轮未提交改动（diff-odometer-counter / scroll-to-bottom-button / marquee / thinking-cap 等）仍保持未提交状态。

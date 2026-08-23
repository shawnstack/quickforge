# Session Handoff

## 当前状态：file-reference-root-browser（已完成）

- 目标：Composer 输入 `@` 时从当前项目根目录一级开始浏览；目录可点击或用 Enter/Tab 逐层进入；文字只筛选当前目录；当前层全部展示并滚动浏览；文件继续使用既有结构化 context reference。
- 服务端：`server/routes/workspace.mjs` 新增 `listWorkspaceMentionChildren` 与 `GET /api/workspace/mention-children?projectId&path`。路由严格调用 `registeredProjectContextFromId`，未知/删除项目 404 `PROJECT_NOT_FOUND`，不回退默认 workspace；当前目录与每个子节点均走 mention 级 `allowSensitive:false` validator 和 realpath 复查，排除敏感项、项目外/敏感真实目标链接。审查修正补齐解析后 `SKIP_DIRS` 过滤：普通 `node_modules`、名为 `node_modules` 的目录链接、以及安全别名指向任意 `node_modules` 子树均不返回；普通安全目录符号链接继续允许。一次返回当前层全部直接子文件/目录，目录优先；不递归、不分页。`server/index.mjs` 已接入 dispatcher。旧 `mention-search` 保留兼容。
- 前端：`file-reference-suggestions.ts` 裸 `@` 立即加载根目录；目录行用独立 folder 图标，点击/Enter/Tab 只进入目录且不产生引用；文件选择继续复用原 token 删除、最多 8 个引用去重、chip/草稿/发送链。输入文字按当前层 `name` 大小写不敏感本地过滤，无 debounce/递归搜索请求；菜单不做 entries slice，全部行由既有 max-height/overflow-y 滚动。菜单关闭后重置到根目录；保留 IME、Esc、Arrow、菜单互斥和 context chip 行契约。审查补测确认旧目录请求迟到不会覆盖当前根目录，`remove()` 会中止 in-flight 请求，`cleanupTextareaHandler()` 会移除 keydown/composition listeners。
- 测试：前端覆盖裸 `@` 根目录加载、当前层筛选不追加请求、Enter 进入目录 + Tab 选文件、25 项不截断、请求竞态/Abort/cleanup、既有引用/chip 共存；服务端覆盖 205+ 当前层全部返回、直接子节点、不递归、普通与链接/别名 `node_modules` 过滤、安全普通目录链接、敏感项与链接过滤、路径拒绝、严格项目上下文及 dispatcher。
- 文档：更新 `docs/wiki/server/routes/README.md` 与 `docs/wiki/src/components/README.md`；`DESIGN_LANGUAGE.md` 无需修改（复用既有浮层、滚动与轻量图标模式，未引入新视觉范式）。
- 验证：审查收口 `npx vitest run tests/server/routes/workspace-tree-on-demand.test.mjs tests/frontend/file-reference-controller.test.ts` → 2 files / 29 tests 全通过；目标 `npx eslint` 0 error；`npx tsc -b --pretty false` 通过；`git diff --check` 通过（仅既有 CRLF→LF warning）。完整门禁：`npm run test` → 238 files / 2062 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）。

---

## 当前状态：并行插件标签功能已提交（commit-only 会话）

- 本会话任务：用户要求提交工作区代码；未修改任何功能代码。
- 新增提交：`4f0182f fix(ui): 点击 slash chip 不再露出命令原文`（slash-invocation-chip.ts + 测试 + index.css 专属 pointer-events hunk，经 `git apply --cached` hunk 级拆分）；`abbc7cd feat(chat): 插件标签链路与用户消息插件回显`——composer-plugin-chips-inside-editor 与 user-message-selected-plugin-chips 两功能在 capability-suggestions / i18n / composer-drafts / chat-utils 等文件内改动交织，无法按文件干净拆分，合并为一笔，含 selected-capabilities 前后端新模块、服务端 canonical 权威链、用户消息/分享回显与三份 Wiki 同步；状态记录随后以独立 docs commit 收口。
- 提交前完整门禁（最终工作树）：`npm run test` → 238 files / 2043 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（server/cloud/identity.mjs:92）；`npm run build` 成功（仅既有 KaTeX/chunk warnings）。两个 commit 的 hook lint 均通过（同一既有 warning）。
- 未提交项：`package-lock.json` 仍为 npm 11.6.2 的 43 行 peer 元数据噪音，沿前几轮会话约定未提交也未丢弃，待用户在统一 npm 版本策略下定夺。
- 下一步：未 tag、未 push（除非用户明确要求）；可选真机验证项见各 feature 记录（slash chip 点击光标落末尾、插件/文件混合标签、分享页插件标签）。

---

## 当前状态：slash-chip-click-keeps-chip（已完成）

- 目标：修复用户真机反馈——选中 agent 后 Composer 内的小 tab（slash chip）被点击时直接露出 `/agent <name>` 命令原文，用户不希望点击显示文字。
- 根因：`.quickforge-slash-overlay` 整体 `pointer-events:none`，点击 chip 穿透到 textarea 的 `/skill|/agent` 前缀区，光标进入前缀触发 document selectionchange 的降级逻辑（隐藏覆盖层 + 卸透明 class → 原文可见）。
- 实现：`src/index.css` 新增 `.quickforge-slash-overlay .quickforge-slash-chip { pointer-events: auto; }`（仅输入框覆盖层内 chip 可点击，消息流 chip 保持纯展示）；`src/components/chat/slash-invocation-chip.ts` 的 `renderChipContent` 为覆盖层 chip 挂 `pointerdown` 监听（项目惯例同 capability-suggestions × 按钮）：preventDefault 吃掉默认行为后聚焦 textarea 并把光标移到文本末尾，chip 保持显示、不降级。共享工厂 `createSlashChipElement` 未改、不挂监听。键盘方向键进入前缀区的降级/自愈、IME composition、自愈重建逻辑均未触碰。
- 测试：`tests/frontend/slash-invocation-chip.test.ts` 新增 1 用例——chip 恰好 1 个 pointerdown 监听、preventDefault 调用、focus + 光标落文本末尾、选中态保留不降级（overlay 可见 + 透明 class 保留），并断言 CSS 只有覆盖层内 chip 开启 pointer-events。
- 验证：定向 vitest slash-invocation-chip + command-suggestions → 2 files / 36 tests；相邻 message-actions / composer-plus-menu / slash-catalog → 3 files / 29 tests；改动源码/测试 eslint 0 error；`npx tsc -b --pretty false` 通过。
- 文档：同步 `docs/wiki/src/components/README.md`（模块树与章节行数 528→541、交互契约补点击行为）；DESIGN_LANGUAGE 无需更新（无新视觉模式，仅 pointer-events 与既有交互习惯）。
- 边界：未新增依赖，未创建 commit/tag/push，未手工修改生成目录；工作区并行未提交改动（plugin-chips 会话等）全部保留。
- 下一步：可选真机验证点击 skill/agent chip 光标落末尾、原文不露出（含触屏与深浅主题）。

---

## 当前状态：user-message-selected-plugin-chips（已完成）

- 目标：发送后在用户消息气泡显示本轮已选插件标签；retry/continue 复用原插件；分享页保留插件标签。依赖未提交但已完成的 `composer-plugin-chips-inside-editor`，其差异完整保留。
- 数据规范：前端 `src/lib/selected-capabilities.ts` 与服务端 `server/selected-capabilities.mjs` 使用匹配规则——只收合法对象/字符串，type 限定 plugin/skill/tool/command，裁剪字段长度，按 `type+pluginName+name` 去重、保持顺序、最多 4 项。`details.selectedCapabilities` 快照仅持久化 type/pluginName/name/label；服务端历史读取 `selectedCapabilitiesFromMessage` 与前端 `selectedCapabilitiesFromDetails` 均再次投影快照字段，因此历史 `details.description` 即使伪造也会被丢弃，retry/continue prompt 不可读取。description 仅可来自新发送请求顶层 selectedCapabilities，参与该当前轮临时 capability prompt。未知插件不依赖 registry，可历史展示。
- 实时/权威链：ServerAgent、Deferred 首条乐观 user message 都写入快照，可与 `details.contextReferences` 共存；请求体继续发送 canonical selectedCapabilities，一次消费后下一轮不泄漏。`runPrompt` 不信任客户端消息 details，以顶层 canonical 数组覆盖；空数组删除伪造/陈旧字段但保留其他 details。activeCapabilityPrompt 使用同一 canonical 结果，message converter 仍剥离 details，正文/复制/标题不受标签污染。
- 历史/重试/分享：message-actions 只从 details 读取，在现有 context chip 行中插件在文件前，复用 createCapabilityChip 与三类专用图标/未知 fallback；只读调用不传 onRemove，无 ×，三态 aria、replaceChildren 幂等及空数据清理保留。审查收口仅最小导出 `decorateUserContextChips` 供 fake DOM 行为测试，实际覆盖混合顺序、二次调用不重复、混合→空删除、历史无 remove、三态 aria；另通过真实 `decorateMessages` copy 点击确认复制仍走原始 `draftTextFromUserMessage`。continueSession 从最后用户消息恢复 capability prompt，同时保留文件引用重校验，但 description 已由历史快照边界剥离。分享输出只删除 contextReferences，保留 selectedCapabilities。
- 文档：已同步 `docs/wiki/src/lib/README.md`、`docs/wiki/src/components/README.md`、`docs/wiki/server/README.md`；未改 DESIGN_LANGUAGE（复用既有 chip 视觉模式）。
- 验证：审查收口定向 Vitest 9 文件 / 87 用例全通过；目标 eslint 0 error；`npx tsc -b --pretty false` 通过；完整 `npm run test` 238 文件 / 2043 用例 100% 全通过；`npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` 成功（仅既有 KaTeX/chunk warnings）；`git diff --check` 与 feature JSON 解析通过。
- 边界：未新增依赖，未创建 commit/tag/push，未手工修改生成目录；build 仅重建被忽略的 `dist/`。`package-lock.json` 最终 blob hash 仍为 `a7f0bb9fcb4de96f8953024be8ac588435dcc3ab`，仅任务前既有 peer 元数据差异，本 feature 未修改/还原。严格未触碰并行 slash feature 的 `src/components/chat/slash-invocation-chip.ts`、其测试及专属逻辑；共享 Wiki/状态文件仅精确修正本 feature 记录并保留并行 feature 状态。

---

## 当前状态：composer-plugin-chips-inside-editor（已完成）

- 目标：把 Composer 用户界面的“能力”入口改为“插件”，并把插件/文件共享标签行稳定放进 `message-editor` 真正输入卡片内、textarea 上方；内部 capability 协议不重命名。
- 实现：`src/lib/i18n.ts` 保持 Plugins/插件、Selected plugins/已选插件、Remove plugin/移除插件，并新增混合态 `Selected plugins and referenced files / 已选插件和引用的文件`。`chat-utils.ts` 的 `ensureComposerContextChips` 继续以 textarea 父元素定位输入卡片，DOM/mock 不完整时安全返回 null；新增 `syncComposerContextChipsAriaLabel`，由 capability/file 两个控制器完成自身 chip 增删后统一调用：仅插件用已选插件、仅文件复用引用的文件、混合明确表达插件和文件，空容器移除。两类 chip 在任一同步/删除顺序下互不删除。插件标签按 `pluginName` 为 documents/spreadsheets/presentations 使用现有 document/spreadsheet/presentation 图标，未知插件回退 plugin 图标；多选、去重、草稿恢复、显式 × 删除和发送一次性消费保持。
- 样式/文档：`src/index.css` 仅收紧卡片内标签布局并降低有标签时 textarea 顶部 padding，未改 `.quickforge-composer > div:first-child` 根卡片选择器，文件标签语义色保留；组件 Wiki 已将 `chat-utils.ts` 更新为真实 340 行，并记录共享容器三态 aria-label/空容器契约。`DESIGN_LANGUAGE.md` 未修改（无新视觉模式）。
- 测试：真实近似双控制器 harness 参数化覆盖 file-first/plugin-first 两种同步顺序、同步不互删、分别删除后保留另一类、最后一项删除移除空容器，以及仅文件/仅插件/混合 aria-label；同时保留输入卡片位置、专用图标、插件文案、文件 helper、Composer drafts/恢复、Skill/Agent Slash 回归。定向 9 files / 77 tests 通过。
- 完整门禁：目标 eslint 0 error；`npx tsc -b --pretty false` 通过；`npm run test -- --reporter=dot` 236 files / 2024 tests 全通过；`npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX/chunk warnings）；`git diff --check` 通过。
- 边界：feature 保持 done，无 blocker；未创建 commit/tag/push，未新增依赖。`package-lock.json` 仍是任务前既有 43 行 peer 元数据差异，本次未修改/还原。未手工修改 `dist/`、`package-dist/`、`package-offline/`；build 仅重建被忽略的 `dist/`。
- 下一步：可选真机目视深浅主题、窄宽度、多插件与文件混合标签、× 删除、发送后消费及读屏名称。

---

## 当前状态：工作区剩余功能已安全拆分提交

- 分支/基线：`dev`，起始 HEAD `72ac7e09`，无 upstream；未 amend 既有提交，未 tag、未 push。
- 新增提交：`d66a3e7 feat(ui): 按会话隔离 Workspace Inspector 状态`；`924e8c5 feat(ui): 优化 Slash 菜单名称与图标`；`b64a4b2 fix(ui): 调整 Composer 控件悬停反馈`；本状态记录将以独立 docs commit 收口。
- 完整门禁：`npm run test` → 236 files / 2020 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` → 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check`、`feature_list.json` / `package.json` / `package-lock.json` JSON 解析通过。每个 commit 前均复核 cached diff/stat/check，commit hook lint 也均通过（同一既有 warning）。
- 未提交项：`package-lock.json` 只有 npm `peer` 元数据变化，`package.json` 无依赖或版本变化；当前 npm 11.6.2 对 HEAD 锁文件隔离重算可产生相同结果，因此判定为工具链噪音。未擅自提交，也未 restore/checkout 丢弃，后续需在统一 npm 版本策略下决定是否单独规范化。
- 生成产物：`dist/`、`package-dist/`、`package-offline/` 均由 `.gitignore` 忽略，未纳入提交。
- 下一步：如需彻底干净工作树，请用户确认是否接受单独提交 npm 11.6.2 的 lockfile peer 元数据规范化；否则保留现状即可。不要 push，除非用户另行明确要求。

---

## 当前状态：sidebar-section-title-drag-collapse（已完成）

- 目标：移除 Projects / Tasks 专用六点拖拽按钮，改为直接拖动标题主 toggle；拖动任一区块时两个区块都临时收缩，结束/取消后恢复原折叠状态。
- 实现：`SortableSidebarSection` 的 `setActivatorNodeRef`、attributes、listeners 仅绑定 Projects / Tasks 标题 toggle；标题保留原 `onClick` 折叠回调，并通过独立 `draggableSectionTitleClass` 增加 `touch-none`、`cursor-grab` 与 dragging 时 `cursor-grabbing`。共享 `sectionToggleClass` 恢复普通折叠标题样式，Pinned 不使用 draggable class、activator 或 listeners，继续保持默认 pointer/触摸行为。外层 PointerSensor 保持 6px 激活阈值，KeyboardSensor 接线保留；右侧筛选、展开全部、添加、新建等 action buttons 未绑定 listeners。
- 临时折叠：`draggingSectionId !== undefined` 派生 `projectsVisuallyCollapsed` / `conversationsVisuallyCollapsed`，任一区块拖动时两者同时为 true；Chevron、`aria-expanded`、`SortableSidebarSection.collapsed` 与实际内容 grid 全部使用派生状态，内容收缩增加 `transition-none`。`finishSectionDrag` 同时服务 cancel/end，仅清空 dragging state，不调用 `onToggleProjectsCollapsed` / `onToggleConversationsCollapsed`，因此恢复各自原状态。
- 保留边界：折叠 `shrink-0`、展开 Tasks `flex-1`、展开 Projects `max-h-[55%]`、顶层 flex/min-h-0/overflow-hidden、设置区 `mt-auto shrink-0`、Projects 内部嵌套 DnD/MeasuringStrategy/视口边界/排序持久化均未改。
- 测试与文档：更新 `tests/frontend/sidebar-section-order.test.ts`（移除专用 handle 契约，覆盖标题 activator、Pinned 与 draggable class 隔离、action 隔离、双派生折叠、视觉恢复接线与 transition-none）；同步 `docs/wiki/src/components/README.md`。`DESIGN_LANGUAGE.md` 无需修改，未新增视觉模式。
- 验证：定向 vitest 2 files / 21 tests；目标 eslint 0 error；`npx tsc -b --pretty false` 与 `git diff --check` 通过；前一轮完整 `npm run test` 236 files / 2020 tests 全通过、`npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）、`npm run build` 成功（仅既有 KaTeX/chunk warnings），本次极小局部修复未重复全量门禁。
- 边界：未新增依赖，未手工修改生成目录，未创建 commit/tag/push；工作区并行未提交改动全部保留。

---

## 当前状态：sidebar-collapsed-sections-compact-layout（已完成）

- 目标：修复 Projects / Tasks 顶层排序区块折叠后仍占据展开高度，导致按 Tasks→Projects 排序时两个折叠标题之间出现巨大空白。
- 根因：`SortableSidebarSection` 只按 ID 固定分配尺寸——Projects 始终 `max-h-[55%]`、Tasks 始终 `flex-1`，未考虑折叠状态；Tasks 折叠后仍吞掉排序容器剩余高度。
- 实现：`SortableSidebarSection` 新增 `collapsed` 参数，由调用处按 `sectionId` 在 `projectsCollapsed` / `conversationsCollapsed` 间推导。折叠统一使用 `shrink-0`；展开 Tasks 继续 `flex-1`，展开 Projects 继续 `max-h-[55%]`。保留排序容器 `flex min-h-0 flex-1 flex-col overflow-hidden`、Projects/Tasks 内部 `overflow-y-auto`、底部设置 `mt-auto shrink-0`，未改顶层/项目 DnD、顺序持久化或桌面/移动共享接线。
- 测试：扩展 `tests/frontend/sidebar-section-order.test.ts` 源码契约，覆盖 collapsed 传递、折叠 shrink-0、展开 Tasks/Projects 尺寸、排序容器、内部滚动及设置底部固定边界。
- 文档：同步 `docs/wiki/src/components/README.md`；`DESIGN_LANGUAGE.md` 无需修改（既有布局 bugfix，无新视觉模式）。
- 验证：定向 vitest 2 files / 20 tests；目标 eslint 0 error；`npx tsc -b --pretty false` 通过；完整 `npm run test` 236 files / 2019 tests 全通过；`npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX/chunk warnings）；`git diff --check` 通过。
- 边界：未新增依赖，未修改/覆盖 `package-lock.json` 既有并行变更，未手工修改生成目录，未创建 commit/tag/push；工作区其他并行修改全部保留。

---

## 当前状态：unify-neutral-slash-icons（已完成）

- 目标：所有 Slash 图标去类别色，并让斜杠菜单 command/skill/agent 复用项目已有 Lucide `SquareTerminal` / `BookOpen` / `Bot`；不扩大到非 Slash 能力菜单。
- 实现：新增 `src/components/chat/slash-icons.ts`，使用项目已有 React 静态渲染模式把三个 Lucide 组件转换为 SVG 字符串；`command-suggestions.ts` 三类菜单行和骨架统一读取该映射，并与 canonical-name 显示调整一并收口；`slash-invocation-chip.ts` 的 skill/agent chip 同样读取映射，并删除旧 `slashAgentIcon` 自绘 glyph。CSS 菜单三类图标默认 `var(--muted-foreground)`，hover/selected 为 `var(--foreground)`；共享 `.quickforge-slash-chip-icon` 单独设为 `var(--muted-foreground)`，覆盖输入框与消息流全部复用位置。
- 颜色边界：按用户字面只中性化图标。skill/agent chip 的既有蓝/绿背景与文字语义色可通过图标子元素独立分离，因此保持不变；chip 结构、类型信息、边框/背景与行为未改。非 Slash `+ → 能力`、@ 文件引用等继续使用 `capability-icons.ts`，未受影响。
- 测试：`command-suggestions.test.ts` 断言菜单输出 `lucide-square-terminal` / `lucide-book-open` / `lucide-bot`，并锁定三类默认/hover/selected 中性 token、无类别 RGB；`slash-invocation-chip.test.ts` 断言 skill/agent 分别输出 BookOpen/Bot，旧 `slashAgentIcon` 不存在，chip icon 使用中性 token。
- 文档：`docs/wiki/src/components/README.md` 新增 slash-icons 导航，更新 command-suggestions/slash-invocation-chip 图标映射、颜色边界和模块行数。
- 验证：定向 vitest 2 files / 35 tests 全通过；改动 TS/测试 eslint 0 error；`npx tsc -b --pretty false` exit 0；`npm run lint` 为 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` 通过。
- 边界：未新增依赖，未手工修改生成目录；已随 canonical-name 合并提交为 `924e8c5`，未 tag、未 push。`package-lock.json` 噪音未纳入提交且未丢弃。

---

## 当前状态：sidebar-section-reorder（已完成）

- 目标：完成已开始的侧栏 section reorder，让 Projects 与当前 Tasks（源码 conversations UI）两个完整区块可安全拖拽换位并在桌面/移动共用、刷新持久化。
- 实现：`src/lib/sidebar-section-order.ts` 定义 `projects/tasks` 规范化、排序和 `localStorage` 安全读写；`src/App.tsx` 持有唯一状态并传给两个 ChatSidebar。`ChatSidebar.tsx` 保持置顶区在外部固定，在区块级 `DndContext + SortableContext` 中按 `sectionOrder` 动态渲染完整 Projects / Tasks；`SortableSidebarSection` 使用 `sidebar-section:*` 命名空间 ID，水平 transform 锁定为 0、顶层 autoScroll 关闭。标题旁弱化 `GripVertical` 按钮是唯一 activator：PointerSensor 保留 6px 阈值以支持鼠标/触摸，外层另接入 KeyboardSensor + `sortableKeyboardCoordinates`，聚焦手柄后可用 Space → 方向键 → Space 完成排序；`useSortable` attributes/listeners、`aria-label` / `title` 仍绑定该手柄，折叠、添加、筛选、菜单等按钮不绑定监听。Projects 内原嵌套 DnD、视口 modifier/autoScroll、拖动折叠会话和 `onReorderProjects` 持久化未改。
- 测试：保留纯函数/storage 5 用例，源码接线契约现为 7 个，覆盖动态顺序、完整区块映射、置顶外置、外层 `sectionSensors` 同时配置 PointerSensor 与 KeyboardSensor/`sortableKeyboardCoordinates`、命名空间和安全手柄、start/cancel/end+x 锁定、项目嵌套 DnD/持久化保留、App 桌面/移动共用状态；与 project-drag-boundary 合计 19/19 通过。现有测试架构以源码契约为主，没有可低成本复用的真实 DOM dnd-kit 键盘行为 harness，因此未为本修复扩大测试基础设施。
- 文档：更新 `docs/wiki/src/components/README.md` 的 ChatSidebar 行数与交互契约；`docs/wiki/src/lib/README.md` 新增 sidebar-section-order 模块条目。未修改 DESIGN_LANGUAGE（实现直接遵循既有轻盈、克制、icon-only 可访问命名规范）。
- 验证：定向 vitest 2 文件 / 19 用例全过；`npx eslint src/components/sidebar/ChatSidebar.tsx tests/frontend/sidebar-section-order.test.ts` 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；feature JSON 解析与 `git diff --check` 通过。
- 边界：未触碰 `package-lock.json` 及 Workspace Inspector、command suggestions、session actions 等并行改动；未手工修改生成目录，未新增依赖，未创建 commit/tag/push。

---

## 当前状态：session-scoped-workspace-inspector-state（已完成）

- 目标：Workspace Inspector 的展开/收起、tabs、`activePanelTabId` 与 Reader 左侧导航显示按 session 隔离恢复；Inspector 整体宽度等纯布局偏好继续全局。
- 实现：`useAgentManager` 新增稳定的 `currentRuntimeScopeId`。pending deferred session 使用自身 `pending-*` 身份；首次发送创建真实 Agent 时，`createAgent` 仅在原 deferred 仍是当前视图时附着，并通过 `attachTaskToView(task, previousAgent.sessionId)` 沿用原 scope，使 `WorkspaceInspector` 的 React `key` 不变化，组件内 open、tabs、activePanelTabId、Review 子视图、readerNavigationVisible 原样存活；`sessionId` 更新后 open hook 的 effect 与 Inspector tabs effect 把当前内存快照写入真实 `projectId + sessionId` localStorage。切换普通会话或成功附着另一 deferred session 才更换 scope；pending 自身仍不落盘。
- 请求隔离：`WorkspaceInspectorOpenRequest` 新增 `scope={projectId,runtimeScopeId}`。App 的 request bridge 发起前校验当前 scope；聊天文件 `resolveWorkspacePath` 完成/失败后同时校验 request id、project 和 runtime scope；Inspector 消费时再次校验。session A 的迟到请求不能打开或持久化到同项目 session B。历史无项目、无 scope 的 subagent 请求继续兼容。
- 新建边界：删除 App wrapper 预先递增 pending scope 的逻辑；`useChatActions` 新建动作返回 `created/reused/cancelled`，reuse、模型设置取消、无项目和异常均不会由 wrapper 提前滚动 Inspector scope。
- 测试/文档：扩展 `workspace-inspector-request.test.ts` 与 `workspace-inspector-tabs.test.ts`，覆盖同项目跨 session 拒绝、projectless subagent 兼容、pending→real key 不变及落盘接线、异步文件 scope 校验、新建 reuse/cancel 不提前滚动；同步 `docs/wiki/src/README.md`、`docs/wiki/src/components/README.md`。
- 验证：定向 6 files / 41 tests；相关 eslint 0 error；`npx tsc -b --pretty false` exit 0；最终合并工作区 `npm run test` 236 files / 2020 tests 全通过；`npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX/chunk warnings）；feature/package/lock JSON 与 `git diff --check` 通过。
- 边界：未新增依赖，未手工修改生成目录；已提交为 `d66a3e7`，未 tag、未 push。`package-lock.json` 噪音未纳入提交且未丢弃。

---

## 当前状态：composer-controls-hover-background（已完成）

- 目标：调整对话输入区 +、权限、模型、发送/停止按钮 hover，使用背景反馈代替 `translateY(-1px)` 跳动，同时保持中性/主操作/停止态层级。
- 实现：`src/index.css` 保留 `.quickforge-composer button:hover:not(:disabled)` 全局规则；新增精确覆盖——+、权限、模型 hover 使用 `var(--quickforge-sidebar-hover-bg)`、`var(--foreground)`、`transform:none` 且带 `:not(:disabled)`；发送 hover 使用 `color-mix(in oklab, var(--primary) 92%, var(--quickforge-sidebar-hover-bg))`、`primary-foreground`、`transform:none`；停止 hover 保留原 foreground/background 混合背景并补 `transform:none`。未改变 Plan、OpenCode config、chip/菜单项；model trigger 覆盖 OpenCode mode 为预期。
- 测试：新增 `tests/frontend/composer-control-hover.test.ts`，结构化读取 CSS 规则，验证全局规则仍存在、三个中性目标的精确 selector/token/前景/不位移、发送态 primary 混色与前景、停止态既有背景与不位移。
- 验证：定向 3 files / 16 tests 全通过；新增测试 eslint 0 error；最终合并工作区 `npm run test` 236 files / 2020 tests 全通过；`npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX/chunk warnings）；feature/package/lock JSON 与 `git diff --check` 通过。
- 边界：未更新 `docs/wiki` 或 `DESIGN_LANGUAGE.md`（纯视觉反馈且现有“hover 有感知、不跳动”规范已覆盖）；未手工修改生成目录、未新增依赖；已提交为 `b64a4b2`，未 tag、未 push。`package-lock.json` 噪音未纳入提交且未丢弃。
- 待确认：可选真机检查深浅主题 hover 对比度、发送 primary 层级和五类控件无垂直跳动。

---

## 当前状态：fix-session-state-clear-actions（已完成）

- 目标：修复两个同根因状态清除缺陷——取消置顶与归档恢复均需通过可序列化的 `null` 触发服务端 clear 语义。
- 实现：`src/hooks/useSessionActions.ts` 将取消置顶从 `pinnedAt:undefined` 改为 `pinnedAt:null`；`src/lib/archived-conversations-settings-tab.ts` 将删除 `archivedAt` 字段改为 session/metadata 两个 payload 都显式写 `archivedAt:null`。服务端代码未改，继续使用字符串=设置、null=清除、字段缺失=保留的三态契约。
- 测试：新增 `tests/frontend/session-state-clear-actions.test.ts`（2 用例），行为验证取消置顶传给 backend 的对象及 JSON 均含 `pinnedAt:null`，并验证归档恢复 helper 产生的两个 JSON payload 均含 `archivedAt:null`；扩展 `tests/server/storage.session-state-facade.test.mjs`，验证 null 同时清除 state/metadata、SQLite 提升列及 pinned/archive 查询过滤状态。
- 验证：合并定向 vitest 2 文件 / 27 用例全部通过；改动文件 eslint 0 error；`npx tsc -b --pretty false`、`npm run build`、`git diff --check` 通过。build 仅既有 KaTeX 字体解析与 chunk size warning。
- 边界：未修改 Wiki（仅恢复既有行为承诺，不影响架构/入口）；未修改用户已有 `package-lock.json`；未触碰生成目录，未新增依赖，未提交 Git。工作区同时存在并行会话的 slash-menu-canonical-name-display 改动，均已保留。

---

## 当前状态：slash-menu-canonical-name-display（已完成）

- 目标：普通 command 继续显示完整命令；skill/agent 菜单行只显示具体 canonical name，同时保持完整插入文本和既有类型前缀搜索。
- 实现：`command-suggestions.ts` 的 `appendUsageText` 仅切换可见主文本来源——command 继续使用 `usage`（并保留 argumentHint），skill/agent 使用 `name`；`usage`、`entryHaystack`、`insertText`、选中 chip 逻辑均未改变。
- 测试：`command-suggestions.test.ts` 断言 `/plan [task]`、`skill-creator`、`explore` 三类主文本；skill/agent 的 `data-quickforge-insert` 仍为完整命令；`/skill ` 与 `/agent ` 前缀过滤仍命中对应类型。
- 文档：`docs/wiki/src/components/README.md` 已同步显示、搜索和插入契约，并更新 command-suggestions 行数为 481。
- 验证：定向 vitest 1 文件 / 13 用例全过；改动源码/测试 eslint 0 error；`npx tsc -b --pretty false`、`npm run build`、`git diff --check` 均通过。build 仅既有 KaTeX 字体解析与 chunk size warning。
- 边界：未新增依赖、未手工修改生成目录；已与中性 Slash 图标合并提交为 `924e8c5`，未 tag、未 push。`package-lock.json` 噪音未纳入提交且未丢弃。无 blocker。

---

## 当前状态：file-reference-mention（已完成）

- 目标：让聊天输入框使用 `@` 引用当前项目文件，并把插件能力选择解耦到 `+ → 能力`，保持结构化草稿、一次性发送与服务端安全边界一致。
- 关键实现：`@` 仅 files-only；裸 `@`/1 字符只提示，2+ 字符 300ms debounce 调 `/api/workspace/mention-search?projectId&query&limit=8`，支持键盘选择并生成结构化文件 chip。`+ → 能力` 生成独立能力 chip，不再插入 `@Documents`、不从正文推断。`text`、`contextReferences`、`selectedCapabilities` 写入 localStorage 草稿（能力防御规范化、按 `type+pluginName+name` 去重、最多 4；附件仍不持久化）；`contextReferences` 随下一次 prompt 一次性发送。服务端重新校验会话项目、路径、安全边界并只注入项目相对路径提示，history user message `details.contextReferences` 用于恢复文件 chip，失败回滚/retry 已覆盖。mention-search 过滤敏感文件与不安全符号链接，对未知/已删除 `projectId` 严格返回 404 `PROJECT_NOT_FOUND`，普通 workspace search/children 等兼容回退保持不变；OpenCode/shared 禁用或显式拒绝非空引用。
- 设计稿：`design-mockups/file-reference-mention.html`。
- 验证：合并定向 vitest 20 files / 242 tests passed；相关 eslint 0；`tsc -b` passed；`npm run build` passed（仅既有 KaTeX/chunk warnings）；`git diff --check` passed。未声称运行全量 `npm test` / `npm lint`。
- 限制 / 下一步：输入框只有 chip、没有正文且没有附件时不能发送；裸 `@` 不提供最近文件；真机目视待用户，重点确认键盘/IME、深浅主题、草稿恢复、发送后历史 chip、敏感路径及 404/重试提示。无代码 blocker。

---

## 当前状态：wiki-sync-uncommitted-features（已完成）

- 用户需求：同步更新当前 wiki 文档；**明令禁止修改代码，只能维护文档**。
- 最终状态：**已完成**。纯文档会话，未改任何代码/测试/生成产物。对照工作区两条未提交功能链（slash-menu-expansion 已 done、file-reference-mention 并行开发中）逐页审计 docs/wiki 并补缺口，改动集中在 6 个 md 文件：
  - `docs/wiki/server/README.md`：新增 `context-references.mjs` 独立小节（导出清单 + `CONTEXT_REFERENCE_SENSITIVE/OUTSIDE_PROJECT/NOT_FOUND/FORBIDDEN/VALIDATION_FAILED` 与 `CONTEXT_REFERENCES_INVALID/LIMIT` 错误码）；skills.mjs 小节补 `summarizeSkills()` 导出；修正 index/agent-manager/custom-commands/skills 过期行数（1006/3763/614/654）。
  - `docs/wiki/server/routes/README.md`：修正 agent/skills/agent-profiles/shared-conversation/workspace 行数（558/213/236/444/1614）。mention-search、prompt contextReferences、skills ?available、agent-profiles ?projectId、shared 拒绝等端点描述此前已由并行会话同步，核对无误。
  - `docs/wiki/server/utils/README.md`：workspace.mjs（232 行）更新为现状行为——敏感路径**大小写不敏感**匹配、realpath 后对真实目标**复查**（防符号链接伪装）、稳定 errorCode `WORKSPACE_SENSITIVE_PATH` / `WORKSPACE_PATH_ESCAPE`（403）、`createWorkspacePathValidator`。
  - `docs/wiki/src/README.md`：lib 模块数 28→86、index.css 行数 293/346→5345。
  - `docs/wiki/src/components/README.md`：ChatPanelHost 1456 / chat-utils 300（补 `FileContextReference`、`ComposerCapabilitySelection`、`MessageEditorElement` 扩展与 `hasDraft` 四元口径）/ command-suggestions 479（IME 描述更正 + 图标来源改 capability-icons.ts）/ file-reference-suggestions 404 / slash-invocation-chip 541（**行为更正为最终实现**：composition 期间覆盖层保持显示 + `.quickforge-slash-preedit` 预编辑镜像（Chromium 剥离去重 / WebKit end 拼接兜底）；selectionchange 光标入前缀区**降级显示**而非自毁、光标回尾部自愈；update 对外部移除的 overlay/textarea **自愈重建**）/ panel-decoration 286（message-actions 补 `decorateUserFileReferences`——用户消息 `details.contextReferences` 渲染 `.quickforge-message-context-references` chip 行；composer-plus-menu 补 `selectPluginCapability` 语义与浮层互斥）。
  - `docs/wiki/src/lib/README.md`：表新增 `deferred-session-agent.ts`（296 行，此前 wiki 完全未收录）+ 独立章节；server-agent 2047 行小节补 `setPromptMode('plan'|'ask'|null)` 泛化（'ask' 预留值、无发送方；`setPlanMode` 兼容包装）；shared-server-agent 488 行补结构化选择 no-op；i18n 3337；slash-catalog 102。
- 注意：`setPromptMode('ask')` 在 server-agent / deferred-session-agent / shared-server-agent 三处 API 均已存在但**当前无任何 UI 调用方**、服务端也无对应 command 消费——按源码现状如实文档化为预留值；若 file-reference 会话后续实现 ask 模式，记得回来更新。
- 验证：全部事实与源码逐一核对（wc -l / grep 导出 / 阅读最终实现）；git status 确认除并行会话既有改动外无代码变更。未创建 commit/tag/push。

---

## 前轮状态：rename-sidebar-conversations-to-tasks（已完成）

- 用户需求：左侧边栏的“对话”分组标题更名为“任务”。
- 最终状态：**已完成并验证**。`src/lib/i18n.ts` 的 `conversations` key（唯一使用处为 `src/components/sidebar/ChatSidebar.tsx` 左侧边栏分组标题 `t('conversations')`）：中文 `对话` → `任务`，英文 `Conversations` → `Tasks`；key 名、`conversationsCollapsed` 等组件状态与折叠逻辑未动。`DESIGN_LANGUAGE.md` 中 3 处以 Conversations 作为侧栏分组标题示例的提及同步为 Tasks。
- 验证：`npx eslint src/lib/i18n.ts` → 0 error；`npx vitest run tests/frontend/i18n-language-snapshot.test.ts tests/frontend/sidebar-session-sort-mode.test.ts` → 2 files / 11 tests 全通过。`npx tsc -b` 报错全部来自并行会话 file-reference-mention 功能中间态文件（file-reference-suggestions.ts、ChatPanelHost.tsx、capability-suggestions.ts、composer-plus-menu.ts、panel-decoration.ts），无一涉及 `src/lib/i18n.ts`。
- 遗留：真机目视确认左栏标题显示“任务”/英文 "Tasks"；其余“对话”相关文案（置顶、暂无对话、已归档对话、重命名对话等）按最小范围保持不变，如需一并更名待用户确认。本会话未创建 commit/tag/push，未手工修改生成目录。

---

## 前轮状态：slash-menu-expansion · 方案 A 选中态 chip（已完成）

- 用户需求演进：①/ 触发「指令/技能/子智能体」菜单（已完成）→ ②选中后输入框内联 chip + 消息流 chip（设计稿两轮澄清后定稿方案 A：输入行内联）。
- 最终状态：**已完成并验证**。新增 `src/components/chat/slash-invocation-chip.ts`（纯逻辑前缀解析/匹配/剥前缀计划/spacer 宽度 + env 注入可单测的控制器：engage/isActive/isDismissed/update/clear/removePrefix/cleanup；覆盖层挂 .quickforge-composer-shell，幽灵层同步 computed 字体/行高/padding/tabSize/scrollTop，ResizeObserver 重同步；IME compositionstart 隐藏恢复；selectionchange 光标入前缀区自毁不记 dismissed）；command-suggestions 集成（skill/agent 选中 engage、激活抑制菜单、catalog ready 自动 engage 含草稿恢复/手输、Backspace 在 cmd 长度处一次删前缀、Esc 退出记 dismissed）；message-actions decorateUserSlashInvocationChip（用户消息前缀 chip，chip 自带 dataset.quickforgeSlashChipPrefix 幂等还原，复制走 draftTextFromUserMessage 原文）；index.css slash-overlay/-ghost/-source-text/-spacer/-chip 全套 + html.dark 变体（.quickforge-composer-shell 已有 relative 未重复加）。
- 关键取舍（subagent 偏差均合理）：还原机制按 chip 标记而非 container 快照（Lit 重渲染会整体替换 markdown 子树）；selectionchange 自毁不记 dismissed（Esc 才记，防 Esc 被下次输入覆盖）；update 校验加词边界（/agent explore-deep 不匹配 /agent explore）；消息流装饰测试走纯函数 + 源码/CSS 断言（现有 harness 无浏览器 DOM 渲染 markdown-block）。
- 验证：npm run test → 226 files / 1945 tests 全通过（含 input-clamp 既有断言随 if 块化修正，守卫语义不变）；npm run lint → 0 errors / 1 existing warning；npx tsc -b → 0；npm run build 成功（仅既有 warning）；git diff --check 通过。
- 遗留：真机目视留待用户——重点验证方案 A 风险点（光标与幽灵文本对齐、中文 IME composition、窄列宽换行、字号设置缩放后重同步）；消息流 chip 深浅主题观感。若对齐在真机不可接受，回退路径：保留消息流 chip + 输入框退回纯文本（或改方案 B chip 行）。
- **追加修复（用户真机反馈「打字后 chip 消失」）**：最小复现环境（真实 MessageEditor + 真实装饰代码 + 无头 Edge CDP：选中→打字→多行→逐字符→IME 全链路）无法复现，判定破坏源为真实 app 的 React/Lit 生命周期操作（静态排查未定位唯一移除者）。修复为自愈式三层防御：① update 时 overlay/textarea 被外部移除或重建（isConnected 检查）→ 重建挂载而非放弃选中态（重 resolve targets、重建 overlay/chip/listeners/透明 class）；② selectionchange 光标入前缀区由「自毁」改为「降级显示原文」，光标回尾部自动恢复（防 selection 被程序重置的瞬时值 + 用户误点不再永久丢 chip）；③ 既有自动 engage（catalog 命中即重挂）继续兜底。测试更新：selectionchange 用例改降级/自愈语义，新增 overlay 外部移除重建、textarea 重建重挂两用例（19 通过）。临时复现文件已删（repro-slash.html/repro-slash-main.ts/repro-cdp.mjs），临时 vite(5199)/无头 Edge 进程已清理。
- 本会话未创建 commit/tag/push，未新增依赖，未手工修改生成目录。设计稿 design-mockups/slash-menu-expansion.html 已标注方案 A 定稿。

- **并行会话冲突记录（本轮）**：用户要求 build 时发现另一并行会话正在开发 file-reference-mention 功能（@ 文件引用，新增 file-reference-suggestions.ts / capability-icons.ts，改写 capability-suggestions.ts / chat-utils.ts / ChatPanelHost.tsx / composer-plus-menu.ts），其中图标注册表被抽到新模块 capability-icons.ts 导致 slash-invocation-chip.ts import 断链——已修复（改 import './capability-icons'）。该会话其余中间态错误（i18n key 缺失、类型未同步）未触碰，等其收尾后 build 才能恢复全绿；dist/ 保持本会话上次完整成功构建产物（含自愈修复，已验证）。

- **IME 期间 chip 保持显示（用户第二轮真机反馈「中文输入过程中标签消失，输入完恢复」）**：原 compositionstart 防护是「隐藏覆盖层 + 移除透明 class 回退原文」——正是消失元凶。改为 composition 期间覆盖层持续渲染：新增 compositionupdate 监听，预编辑（拼音串）镜像进幽灵层尾部（.quickforge-slash-preedit 弱下划线提示输入中；Chromium 下 value 已含预编辑则从任务文本中剥离避免重复，WebKit 兼容 end 手动拼接）；update 在 composition 中改为实时 render 而非挂起（pendingText 机制整体移除）；顺手修复 renderChipContent 重建时旧 textNode/preeditEl 残留 bug。测试：composition 用例重写为保持显示 + 预编辑镜像 + WebKit/Chromium 双路径 + 残留清理断言（19 全过）。验证：定向 vitest 32/32、eslint 0 error；全量 npm run test 有 29 个失败**全部来自并行 file-reference 会话中间态**（updateFileReferenceSuggestions/setPromptMode/composer-plus-menu 等，与本 feature 无关）；`npx vite build` 直接产出成功（tsc -b 被并行半成品阻断，vite 不做类型检查），三个 slash 标记（overlay/preedit/self-heal）均确认进入 dist。

---

## 前轮状态：slash-menu-expansion 主功能（已完成）

- 本会话目标：聊天输入框 `/` 触发的补全菜单扩展为「指令 / 技能 / 子智能体」三类。
- 最终状态：**已完成并验证**。设计稿 design-mockups/slash-menu-expansion.html 用户定稿选档（行图标开、Enter 发送原文、子智能体描述 label·description），由两个并行 subagent 实现（服务端 / 前端，契约：/api/skills?available=true、/api/agent-profiles?projectId、插入文本 /skill <name> 与 /agent <name> ），主 Agent 复查 diff 并跑完整门禁。
- 服务端：custom-commands.mjs 新增 /skill、/agent 解析与 formatSkillCommandPrompt/formatAgentCommandPrompt；agent-manager resolveCommandState 在 handleInternalCommand 前拦截（skill 用 loadSkillToolContext 同源校验、agent 按 workspaceRoot getAgentProfile 校验 enabledAsSubagent；失败 textResponse 用法+可用列表；通过注入 commandPrompt、无 permissions）；routes/skills.mjs ?available=true 合并视图；routes/agent-profiles.mjs 可选 projectId；skills.mjs summarizeSkills 导出。内部命令优先于同名自定义命令。
- 前端：command-suggestions.ts 三分组重写（sticky 组头+条数、图标行、argumentHint muted、命中加粗、底部键位提示条、骨架 shimmer+reduced-motion、aria-busy/option/selected）；懒加载状态机（idle→loading→ready/error，error 降级仅指令组、菜单关闭重开重试一次）；键盘 ↑↓ 循环/Tab 补全 active/Esc 关闭/Enter 不拦截；slash-catalog.ts（并行 fetch、enabledAsSubagent 过滤、失败 null、按 projectId 缓存）；ChatPanelHost ref 传 projectId；capabilityIcons 导出复用 + agent 翠绿新图标；i18n 7 新 key 双语、删孤儿 customCommandsHint/EmptyHint。
- 验证：npm run test → 225 files / 1918 tests 全通过；npm run lint → 0 errors / 1 existing warning（identity.mjs:92）；npx tsc -b → 0；npm run build 成功（仅既有 warning）；git diff --check 通过。
- 遗留：真机目视留待用户（/ 三分组、懒加载骨架、键盘、深浅主题；选中技能/子智能体发送验证语义；未知名称提示文本）。已知名义：/skill 任务可省略（激活后询问），/agent 任务必填；user-guide 无斜杠命令清单段落故未改（检索确认）。
- 本会话未创建 commit/tag/push，未新增依赖，未手工修改 dist/、package-dist/、package-offline/。

---

## 前轮状态：fix-sidebar-project-drag-bottom-boundary（已完成）

- 本会话目标：限制左侧 Projects 排序拖拽的顶部/底部边界，并让 dnd-kit 自动滚动只作用于 Projects 自身滚动视口。
- 最终状态：**已完成并验证**。`ChatSidebar.tsx` 为 Projects 的 `h-full overflow-y-auto` 容器增加 ref；`project-drag-boundary.ts` 纯函数按 `draggingNodeRect`、实时视口矩形和拖拽开始后的 `scrollTop` 增量锁定 `x=0` 并夹紧 `y`。滚动增量用于抵消 dnd-kit 非 DragOverlay 路径在 modifier 后追加的 scroll adjustment，确保预览在自动滚动后仍停于真实视口边界。
- 自动滚动：`DndContext autoScroll.canScroll` 仅接受 Projects 容器，拒绝 document 与所有外层滚动祖先；该容器到真实顶部/底部时由 dnd-kit 6.3.1 的 scroll-position 判断停止。
- 保留契约：`closestCenter`、`verticalListSortingStrategy`、`MeasuringStrategy.Always`、拖动期间折叠项目会话、`onReorderProjects` 排序持久化、现有拖拽视觉样式均未改变。
- 类型核对：实际安装 `@dnd-kit/core@6.3.1`；`Modifier` 由 core 导出，参数包含 `draggingNodeRect`；`autoScroll.canScroll` 类型是 `(element: Element) => boolean`。
- 改动文件：`src/components/sidebar/ChatSidebar.tsx`、`src/lib/project-drag-boundary.ts`、`tests/frontend/project-drag-boundary.test.ts`、`docs/wiki/src/components/README.md`，以及增量更新的 `feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：定向 vitest 1 文件 / 7 用例全通过；改动文件 eslint 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` 通过。
- 遗留：未做手工浏览器验证。建议准备超过 Projects 视口高度的项目列表，分别拖到最顶部/最底部，确认预览不越界、只有 Projects 区滚动、到真实边界停止且放下后排序持久化。
- 并发保护：开始时 Wiki 与三份状态文件已有 generate_image / system-prompt 等其他任务未提交改动；本轮只在现有内容上增量追加，未覆盖或回退。未新增依赖，未创建 commit/tag/push，未手工修改 `dist/`、`package-dist/`、`package-offline/`。

---

## 前轮状态：temporarily-disable-generate-image-tool（已完成）

- 本会话目标：暂时下线 `generate_image` 工具，同时完整保留历史会话兼容链路。
- 最终状态：**已完成并验证**。`server/tools/definitions.mjs` 的 `workspaceTools` 已移除 `generate_image`，因此 Agent 与 `GET /api/tools` 不再暴露该能力；`server/tools/index.mjs` handler、`server/image-generation.mjs`、`server/routes/tools.mjs` 的 `directRouteDisabledTools`、会话资产路由、前端 renderer/i18n/process-folding 等均未删除。
- 改动文件：`server/tools/definitions.mjs`、`tests/server/tools/definitions.test.mjs`、中英文用户指南、`docs/wiki/server/{README.md,tools/README.md}`、`docs/wiki/src/{lib,components}/README.md`，以及簿记文件 `feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：definitions 定向测试 1 文件 / 20 用例全通过；图片生成历史兼容测试 4 文件 / 63 用例全通过；`npm run lint` 为 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体解析和 chunk size warning）；`git diff --check` 通过。
- 文档：当前能力文档已明确图片生成暂时不可调用；源码/组件 Wiki 的 handler、资产和 renderer 描述改为仅历史会话兼容；未修改 CHANGELOG。
- Blocker：无。未新增依赖，未创建 commit/tag/push，未手工修改 `dist/`、`package-dist/`、`package-offline/`；`npm run build` 生成的 `dist/` 仍为被忽略产物。
- 并发保护：任务开始时 `feature_list.json`、`progress.md`、`session-handoff.md` 及系统提示词文件已有其他任务修改，本轮均在现有内容基础上增量追加，未覆盖。

---

## 前轮状态：remove-base-prompt-minimalism-rules（已完成）

- 本会话目标：按用户要求删除基础系统提示词中的“选择最简单的实现”和“只做最小、局部修改”规则。
- 最终状态：**已完成并验证**。`server/system-prompt.mjs` 的 `BASE_SYSTEM_PROMPT` 删除了 `Prefer the simplest solution that satisfies the request.`、`Make surgical changes only.`，并一并删除同义重复的 `Make minimal, focused changes.`；保留 `Do not refactor unrelated code.` 及其他规则。
- 改动文件：`server/system-prompt.mjs`、`tests/server/system-prompt.test.mjs`，以及簿记文件 `feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证：`npm run test -- --run tests/server/system-prompt.test.mjs` → 1 file / 5 tests 全通过；grep 确认三条规则在基础提示词中无匹配。
- 文档：未修改 Wiki，因为这只是基础提示词措辞调整，不改变模块职责、公共入口或配置方式。
- 注意：`progress.md` 在本会话开始前已有其他智能体写入的“中止双消息根因”笔记，本次保留未覆盖；未创建 commit/tag/push。

---

## 前轮状态：release-v1.7.12（已完成，发布记录）

- 本会话目标：完成 v1.7.12 打包与发布状态收尾，记录 release commit、tag/push 与用户执行 npm publish 的发布顺序。
- 前置与版本：起始工作区干净、当前分支 `master`，发布准备阶段已确认目标 tag `v1.7.12` 尚未创建；`package.json` / `package-lock.json` 已由 1.7.11 更新为 1.7.12，CHANGELOG 1.7.12 已按 `v1.7.11..HEAD` 的 12 个提交准备；README 无固定版本引用，未修改。
- 发布门禁：`npm run test` → 219 files / 1865 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` → 成功。
- 打包结果：`node scripts/prepare-runtime-package.cjs` 成功；`node scripts/prepare-offline-package.cjs` 成功；在 `package-offline` 目录运行 `npm pack` 成功。
- tarball：`package-offline/shawnstack-quickforge-1.7.12.tgz` 存在，大小 25,255,113 bytes（24.09 MiB）；清单 324 files，包含 `bin/`、`server/`、`skills/`、`plugins/`、`runtime-assets/`、`dist/`、`README.md`、`LICENSE`、`package.json`。
- 元数据：`package-dist/package.json` 与 `package-offline/package.json` 均为 `@shawnstack/quickforge@1.7.12`，均无 `devDependencies` / `scripts`；offline 包按脚本将 `@vscode/ripgrep` 从 `dependencies` 移至 `optionalDependencies`，并保留 `node-pty` optional dependency。
- Git：`dist/`、`package-dist/`、`package-offline/` 均由 `.gitignore` 排除；生成产物不进入版本控制，release commit 范围为 6 个发布文件：`CHANGELOG.md`、`package.json`、`package-lock.json`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 发布顺序：本变更用于 release commit，随后创建并推送 tag `v1.7.12`；npm publish 由用户执行：`npm publish ./package-offline/shawnstack-quickforge-1.7.12.tgz --access public`。

---

## 前轮会话：fix-workspace-inspector-subagent-trace-outer-card（已完成，要点归档）

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
- 前轮遗留（更新）：v1.7.11 npm publish 待办已由当前 v1.7.12 release 流程取代；根目录空目录 design-preview/ 重启后可删；既有 lint warning server/cloud/identity.mjs:92。

---

## 前轮会话：ask-user-tool（已完成，要点归档）

- 服务端：`server/tools/definitions.mjs` 新增 `askUserTool`（questions 1-4，每问 options≤4 / multiSelect / allowCustom）；`server/ask-store.mjs`（pendingAsks Map、ASK_TIMEOUT_MS=30min、`normalizeAskQuestions` 兼容单问简写、`formatAskResult` 超时/跳过/abort→按默认方案继续）；`server/agent-manager.mjs` `wrapAskUserToolDefinition` + `createAskUserPromise`（SSE `ask_user_required`/`ask_user_answered`）+ `answerAsk` + state `pendingAsk` + 免审批；`server/approval-store.mjs` planAllowedTools 加 ask_user；`server/routes/agent.mjs` `POST /api/agents/:id/answer-ask`。
- 前端：`src/lib/server-agent.ts` 事件与 pendingAsk 全套、`answerAsk()`；`panel-decoration/ask-user-card.ts` 向导式卡（单选自动前进、末步统一提交、可跳过/回改，`data-ask-id`+displaySignature 去重）；ChatPanelHost/App 接线；i18n en/zh 各 18 键；`.quickforge-ask-*` 样式。
- 真机反馈修复：①propsRef effect 漏 `onAnswerAsk` 致卡片误禁用（已补+回归断言）；②ask_user 工具消息新增 `AskUserToolRenderer` 纳入工具显示模式（summary「N 问 · 首问」、output=回答文本）。
- 验证：全量 test 217 文件 1795 用例 / lint 0 error / build 通过；真实会话目视确认留待用户（可要求"用 ask_user 问我一个问题"触发）。
- 前轮未提交改动（diff-odometer-counter / scroll-to-bottom-button / marquee / thinking-cap 等）仍保持未提交状态。
